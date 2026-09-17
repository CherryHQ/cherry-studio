import { randomUUID } from 'node:crypto'

import { session, type WebContents, webContents } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { type Disposable, Emitter } from '@main/core/lifecycle'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { WindowId } from '@shared/ipc/types'
import { normalizeBrowserUrl } from '@shared/utils/browserUrl'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { BrowserCursor } from './BrowserCursor'
import { BrowserSessionError } from './session/BrowserSessionError'

const logger = loggerService.withContext('BrowserGuestRegistry')

export interface BrowserGuestContext {
  ownerId: string
  sessionId: string
}

export interface BrowserGuestTarget extends BrowserGuestContext {
  tabId: string
  guest: WebContents
  windowId: WindowId
  abort: AbortController
  cursor: BrowserCursor
  popupBlocked?: boolean
  beginExecution: () => Disposable
  dispose: () => void
}

export class BrowserGuestRegistry implements Disposable {
  private readonly targets = new Map<string, BrowserGuestTarget>()
  private readonly changed = new Emitter<void>()

  constructor(
    private readonly resolveOwner: (id: string) => string,
    readonly scope: 'agent' | 'topic',
    private readonly claims = new Map<WebContents, BrowserGuestTarget>()
  ) {}

  attach(sessionId: string, webviewId: number, senderId: WindowId | null): { tabId: string } {
    const ownerId = this.getOwner(sessionId)
    const window = senderId ? application.get('WindowManager').getWindow(senderId) : undefined
    const guest = webContents.fromId(webviewId)
    const profiles = [
      WebviewSecurityProfile.AgentBrowser,
      WebviewSecurityProfile.AgentDevPreview,
      WebviewSecurityProfile.AgentHtmlArtifact
    ]
    if (
      !ownerId ||
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
    const claim = this.claims.get(guest)
    if (claim && claim !== existing) throw new BrowserSessionError('not_allowed')
    if (existing && existing.windowId !== senderId) throw new BrowserSessionError('not_allowed')
    existing?.dispose()
    const tabId = randomUUID()
    const abort = new AbortController()
    const cursor = new BrowserCursor(
      { sessionId, tabId, scope: this.scope },
      (state) => {
        try {
          application.get('IpcApiService').send(senderId, 'browser.cursor.state', state)
        } catch (error) {
          logger.debug('Cursor owner is unavailable', { error })
        }
      },
      () => !window.isDestroyed() && window.isFocused() && !window.isMinimized(),
      () => guest.getZoomFactor() / window.webContents.getZoomFactor()
    )
    const hideCursor = () => cursor.hide()
    const invalidateCursor = () => cursor.hide(new BrowserSessionError('stale_ref'))
    const onNavigation = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
      if (isMainFrame && !isInPlace) invalidateCursor()
    }
    window.on('blur', hideCursor)
    guest.on('did-start-navigation', onNavigation)
    const debuggerEvents = guest.debugger
    debuggerEvents.on('detach', invalidateCursor)
    abort.signal.addEventListener(
      'abort',
      () => {
        cursor.dispose()
        guest.removeListener('did-start-navigation', onNavigation)
        debuggerEvents.removeListener('detach', invalidateCursor)
        window.removeListener('blur', hideCursor)
      },
      { once: true }
    )
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
      this.claims.delete(guest)
      guest.removeListener('destroyed', dispose)
      abort.abort(new BrowserSessionError('not_found'))
      this.changed.fire()
    }
    this.targets.set(sessionId, {
      ownerId,
      sessionId,
      tabId,
      guest,
      windowId: senderId,
      abort,
      cursor,
      beginExecution,
      dispose
    })
    this.claims.set(guest, this.targets.get(sessionId)!)
    guest.once('destroyed', dispose)
    this.changed.fire()
    return { tabId }
  }

  getCursor(sessionId: string, tabId: string, senderId: WindowId | null): BrowserCursor | undefined {
    const target = this.targets.get(sessionId)
    if (!target || target.tabId !== tabId || target.abort.signal.aborted) return undefined
    if (target.windowId !== senderId) throw new BrowserSessionError('not_allowed')
    return target.cursor
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

  private getOwner(sessionId: string): string {
    try {
      return this.resolveOwner(sessionId)
    } catch (error) {
      if (isDataApiNotFoundError(error)) throw new BrowserSessionError('not_allowed')
      throw error
    }
  }

  get(context: BrowserGuestContext): BrowserGuestTarget | undefined {
    const ownerId = this.getOwner(context.sessionId)
    if (ownerId !== context.ownerId) throw new BrowserSessionError('not_allowed')
    const target = this.targets.get(context.sessionId)
    if (!target || target.guest.isDestroyed() || target.abort.signal.aborted) return undefined
    target.ownerId = ownerId
    return target
  }

  async ensureGuest(context: BrowserGuestContext, signal: AbortSignal, url?: string): Promise<BrowserGuestTarget> {
    signal.throwIfAborted()
    const existing = this.get(context)
    const isFile = url?.startsWith('file:')
    const expectedSession = session.fromPartition(
      getWebviewPartition(isFile ? WebviewSecurityProfile.AgentHtmlArtifact : WebviewSecurityProfile.AgentBrowser)
    )
    const matches = (target: BrowserGuestTarget) =>
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
          ...(this.scope === 'topic' ? { scope: this.scope } : {}),
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
