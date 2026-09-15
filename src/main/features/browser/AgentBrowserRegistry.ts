import { randomUUID } from 'node:crypto'

import { session, type WebContents, webContents } from 'electron'

import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { type Disposable, Emitter } from '@main/core/lifecycle'
import type { WindowId } from '@shared/ipc/types'
import { normalizeBrowserUrl } from '@shared/utils/browserUrl'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { BrowserSessionError } from './session/BrowserSessionError'

const logger = loggerService.withContext('AgentBrowserRegistry')

export interface AgentBrowserContext {
  agentId: string
  sessionId: string
}

export interface AgentBrowserTarget extends AgentBrowserContext {
  tabId: string
  guest: WebContents
  windowId: WindowId
  abort: AbortController
  popupBlocked?: boolean
  beginExecution: () => Disposable
  dispose: () => void
}

export class AgentBrowserRegistry implements Disposable {
  private readonly targets = new Map<string, AgentBrowserTarget>()
  private readonly changed = new Emitter<void>()

  attach(sessionId: string, webviewId: number, senderId: WindowId | null): { tabId: string } {
    const owner = agentSessionService.getById(sessionId)
    const window = senderId ? application.get('WindowManager').getWindow(senderId) : undefined
    const guest = webContents.fromId(webviewId)
    const profiles = [
      WebviewSecurityProfile.AgentBrowser,
      WebviewSecurityProfile.AgentDevPreview,
      WebviewSecurityProfile.AgentHtmlArtifact
    ]
    if (
      !owner.agentId ||
      !senderId ||
      !window ||
      !guest ||
      guest.isDestroyed() ||
      guest.getType() !== 'webview' ||
      guest.hostWebContents !== window.webContents ||
      !profiles.some((profile) => guest.session === session.fromPartition(getWebviewPartition(profile)))
    ) {
      throw new BrowserSessionError('not_allowed')
    }
    const existing = this.targets.get(sessionId)
    if (existing?.guest === guest && existing.windowId === senderId && !existing.abort.signal.aborted)
      return { tabId: existing.tabId }
    for (const target of this.targets.values()) {
      if (target.guest === guest && target !== existing) throw new BrowserSessionError('not_allowed')
    }
    if (existing && existing.windowId !== senderId) throw new BrowserSessionError('not_allowed')
    existing?.dispose()
    const tabId = randomUUID()
    const abort = new AbortController()
    let executions = 0
    let throttling = true
    const restoreThrottling = () => {
      if (executions && !guest.isDestroyed()) guest.setBackgroundThrottling(throttling)
      executions = 0
    }
    abort.signal.addEventListener('abort', restoreThrottling, { once: true })
    const beginExecution = (): Disposable => {
      abort.signal.throwIfAborted()
      if (executions++ === 0) {
        throttling = guest.getBackgroundThrottling()
        guest.setBackgroundThrottling(false)
      }
      let released = false
      return {
        dispose: () => {
          if (released) return
          released = true
          if (executions === 1) restoreThrottling()
          else if (executions > 1) executions--
        }
      }
    }
    const dispose = () => {
      if (this.targets.get(sessionId)?.tabId !== tabId) return
      this.targets.delete(sessionId)
      guest.removeListener('destroyed', dispose)
      abort.abort(new BrowserSessionError('not_found'))
      this.changed.fire()
    }
    this.targets.set(sessionId, {
      agentId: owner.agentId,
      sessionId,
      tabId,
      guest,
      windowId: senderId,
      abort,
      beginExecution,
      dispose
    })
    guest.once('destroyed', dispose)
    this.changed.fire()
    return { tabId }
  }

  handlePopup(guest: WebContents, details: Electron.HandlerDetails): boolean {
    const target = [...this.targets.values()].find((target) => target.guest === guest)
    if (!target) return false
    if (
      guest.session !== session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser)) ||
      details.postBody
    ) {
      target.popupBlocked = true
      return true
    }
    let url: string
    try {
      url = normalizeBrowserUrl(details.url)
    } catch {
      target.popupBlocked = true
      return true
    }
    void guest.loadURL(url, { httpReferrer: details.referrer }).catch((error) => {
      logger.warn('Failed to navigate browser popup in the Agent pane', { error })
    })
    return true
  }

  detach(sessionId: string, tabId: string, senderId: WindowId | null): void {
    const target = this.targets.get(sessionId)
    if (!target || target.tabId !== tabId) return
    if (target.windowId !== senderId) throw new BrowserSessionError('not_allowed')
    target.abort.abort(new BrowserSessionError('not_found'))
  }

  get(context: AgentBrowserContext): AgentBrowserTarget | undefined {
    const owner = agentSessionService.getById(context.sessionId)
    if (owner.agentId !== context.agentId) throw new BrowserSessionError('not_allowed')
    const target = this.targets.get(context.sessionId)
    return target?.agentId === context.agentId && !target.guest.isDestroyed() && !target.abort.signal.aborted
      ? target
      : undefined
  }

  async ensureGuest(context: AgentBrowserContext, signal: AbortSignal, url?: string): Promise<AgentBrowserTarget> {
    signal.throwIfAborted()
    const existing = this.get(context)
    const isFile = url?.startsWith('file:')
    const expectedSession = session.fromPartition(
      getWebviewPartition(isFile ? WebviewSecurityProfile.AgentHtmlArtifact : WebviewSecurityProfile.AgentBrowser)
    )
    const matches = (target: AgentBrowserTarget) =>
      !url || (target.guest.session === expectedSession && (!isFile || target.guest.getURL() === url))
    if (existing && matches(existing)) {
      return existing
    }
    const timeout = AbortSignal.timeout(10_000)
    const abort = AbortSignal.any([signal, timeout])
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        subscription.dispose()
        abort.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        reject(abort.reason)
      }
      const subscription = this.changed.event(() => {
        try {
          const target = this.get(context)
          if (target && matches(target)) {
            cleanup()
            resolve(target)
          }
        } catch (error) {
          cleanup()
          reject(error)
        }
      })
      abort.addEventListener('abort', onAbort, { once: true })
      try {
        abort.throwIfAborted()
        application.get('IpcApiService').broadcast('browser.guest.ensure_requested', {
          sessionId: context.sessionId,
          url: isFile ? url : url ? 'about:blank' : undefined
        })
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  }

  dispose(): void {
    for (const target of this.targets.values()) target.dispose()
    this.changed.dispose()
  }
}
