import { randomUUID } from 'node:crypto'

import { session, type WebContents, webContents } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { type Disposable, Emitter } from '@main/core/lifecycle'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { InputFor, WindowId } from '@shared/ipc/types'
import { normalizeBrowserUrl } from '@shared/utils/browserUrl'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { BrowserCursor } from './BrowserCursor'
import type { CommandOptions } from './browserUse'
import { BrowserSessionError } from './session/BrowserSessionError'

const logger = loggerService.withContext('BrowserGuestRegistry')

export interface BrowserGuestContext {
  ownerId: string
  sessionId: string
}

export interface BrowserGuestTarget extends BrowserGuestContext {
  tabId: string
  pageId: string
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
  private readonly pendingFocus = new Map<string, { target: BrowserGuestTarget; finish: (error?: unknown) => void }>()

  constructor(
    private readonly resolveOwner: (id: string) => string,
    readonly scope: 'agent' | 'topic',
    private readonly claims = new Map<WebContents, BrowserGuestTarget>()
  ) {}

  attach(sessionId: string, webviewId: number, senderId: WindowId | null, pageId = sessionId): { tabId: string } {
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
    const existing = this.targets.get(pageId)
    if (existing && existing.sessionId !== sessionId) throw new BrowserSessionError('not_allowed')
    if ([...this.targets.values()].some((target) => target.sessionId === sessionId && target.windowId !== senderId))
      throw new BrowserSessionError('not_allowed')
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
    const reportExecution = (executing: boolean) => {
      if (!window.isDestroyed())
        application.get('IpcApiService').send(senderId, 'browser.page.execution', {
          sessionId,
          scope: this.scope,
          pageId,
          tabId,
          executing,
          webviewId: guest.id
        })
    }
    const restoreThrottling = () => {
      if (executions && !guest.isDestroyed()) guest.setBackgroundThrottling(throttling)
      executions = 0
      reportExecution(false)
    }
    abort.signal.addEventListener('abort', restoreThrottling, { once: true })
    const beginExecution = (): Disposable => {
      abort.signal.throwIfAborted()
      if (executions++ === 0) {
        throttling = guest.getBackgroundThrottling()
        guest.setBackgroundThrottling(false)
        reportExecution(true)
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
      if (this.targets.get(pageId)?.tabId !== tabId) return
      this.targets.delete(pageId)
      this.claims.delete(guest)
      guest.removeListener('destroyed', dispose)
      abort.abort(new BrowserSessionError('not_found'))
      this.changed.fire()
    }
    this.targets.set(pageId, {
      pageId,
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
    this.claims.set(guest, this.targets.get(pageId)!)
    guest.once('destroyed', dispose)
    this.changed.fire()
    return { tabId }
  }

  getCursor(sessionId: string, tabId: string, senderId: WindowId | null): BrowserCursor | undefined {
    const target = [...this.targets.values()].find((item) => item.sessionId === sessionId && item.tabId === tabId)
    if (!target || target.tabId !== tabId || target.abort.signal.aborted) return undefined
    if (target.windowId !== senderId) throw new BrowserSessionError('not_allowed')
    return target.cursor
  }

  async focusInput(context: BrowserGuestContext, target: BrowserGuestTarget, options: CommandOptions): Promise<void> {
    if (this.get(context, target.tabId) !== target) throw new BrowserSessionError('not_found')
    const expiresAt = Math.min(Date.now() + 2000, options.deadline ?? Infinity)
    if (expiresAt <= Date.now()) throw new BrowserSessionError('timeout')
    const signal = AbortSignal.any([
      target.abort.signal,
      AbortSignal.timeout(Math.max(1, expiresAt - Date.now())),
      ...(options.signal ? [options.signal] : [])
    ])
    signal.throwIfAborted()
    const requestId = randomUUID()
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        this.pendingFocus.delete(requestId)
        signal.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve()
      }
      const onAbort = () =>
        finish(signal.reason?.name === 'TimeoutError' ? new BrowserSessionError('timeout') : signal.reason)
      this.pendingFocus.set(requestId, { target, finish })
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        application.get('IpcApiService').send(target.windowId, 'browser.input.focus_requested', {
          sessionId: target.sessionId,
          scope: this.scope,
          tabId: target.tabId,
          requestId,
          expiresAt
        })
      } catch (error) {
        finish(error)
      }
    })
    signal.throwIfAborted()
    if (this.get(context, target.tabId) !== target) throw new BrowserSessionError('not_found')
  }

  inputFocused(
    sessionId: string,
    tabId: string,
    requestId: string,
    status: InputFor<'browser.input.focused'>['status'],
    senderId: WindowId | null
  ): void {
    const pending = this.pendingFocus.get(requestId)
    if (!pending || pending.target !== this.getPageTarget(sessionId, tabId) || pending.target.tabId !== tabId) return
    if (pending.target.windowId !== senderId) throw new BrowserSessionError('not_allowed')
    pending.finish(status === 'unavailable' ? new BrowserSessionError('not_found') : undefined)
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
    application.get('IpcApiService').send(target.windowId, 'browser.guest.ensure_requested', {
      sessionId: target.sessionId,
      scope: this.scope,
      pageId: randomUUID(),
      url,
      action: 'create',
      activate: details.disposition !== 'background-tab'
    })
    return true
  }

  detach(sessionId: string, tabId: string, senderId: WindowId | null): void {
    const target = [...this.targets.values()].find((item) => item.sessionId === sessionId && item.tabId === tabId)
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

  private getPageTarget(sessionId: string, tabId: string): BrowserGuestTarget | undefined {
    return [...this.targets.values()].find((target) => target.sessionId === sessionId && target.tabId === tabId)
  }

  list(context: BrowserGuestContext): BrowserGuestTarget[] {
    const ownerId = this.getOwner(context.sessionId)
    if (ownerId !== context.ownerId) throw new BrowserSessionError('not_allowed')
    return [...this.targets.values()].filter((target) => {
      if (target.sessionId !== context.sessionId || target.guest.isDestroyed() || target.abort.signal.aborted)
        return false
      target.ownerId = ownerId
      return true
    })
  }

  get(context: BrowserGuestContext, tabId?: string): BrowserGuestTarget | undefined {
    const targets = this.list(context)
    return tabId ? targets.find((target) => target.tabId === tabId) : targets[0]
  }

  async ensureGuest(
    context: BrowserGuestContext,
    signal: AbortSignal,
    url?: string,
    options: { pageId?: string; newTab?: boolean } = {}
  ): Promise<BrowserGuestTarget> {
    signal.throwIfAborted()
    const targets = this.list(context)
    const existing = options.newTab
      ? undefined
      : options.pageId
        ? targets.find((target) => target.pageId === options.pageId)
        : targets[0]
    if (options.pageId && !existing && !options.newTab) throw new BrowserSessionError('not_found')
    const isFile = url?.startsWith('file:')
    const expectedSession = session.fromPartition(
      getWebviewPartition(isFile ? WebviewSecurityProfile.AgentHtmlArtifact : WebviewSecurityProfile.AgentBrowser)
    )
    const matches = (target: BrowserGuestTarget) =>
      !url || (target.guest.session === expectedSession && (!isFile || target.guest.getURL() === url))
    if (existing && matches(existing)) return existing
    const pageId = existing?.pageId ?? options.pageId ?? randomUUID()
    const abort = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
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
          const target = this.list(context).find((item) => item.pageId === pageId)
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
          scope: this.scope,
          pageId,
          action: existing ? 'navigate' : 'create',
          url: isFile ? url : url ? 'about:blank' : undefined,
          activate: false
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
