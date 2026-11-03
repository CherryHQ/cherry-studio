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
  guest: WebContents
  windowId: WindowId
  abort: AbortController
  cursor: BrowserCursor
  popupBlocked?: boolean
  beginExecution: () => Disposable
  dispose: () => void
}

export class BrowserGuestRegistry implements Disposable {
  private readonly shutdown = new AbortController()
  private readonly targets = new Map<string, BrowserGuestTarget>()
  private readonly identities = new Map<
    string,
    { ownerId: string; windowId: WindowId; webContentsId: number; tabId: string }
  >()
  private readonly repairs = new Map<
    string,
    {
      requestId: string
      kind: 'reattach' | 'recreate'
      expiresAt: number
      identity: { ownerId: string; windowId: WindowId; webContentsId: number; tabId: string }
      finish: (target: BrowserGuestTarget) => void
    }
  >()
  private readonly recovering = new Map<
    string,
    { promise: Promise<BrowserGuestTarget>; abort: AbortController; waiters: number }
  >()
  private readonly changed = new Emitter<void>()
  private readonly pendingFocus = new Map<string, { target: BrowserGuestTarget; finish: (error?: unknown) => void }>()

  constructor(
    private readonly resolveOwner: (id: string) => string,
    readonly scope: 'agent' | 'topic',
    private readonly claims = new Map<WebContents, BrowserGuestTarget>(),
    private readonly checkGuest?: (target: BrowserGuestTarget) => Promise<boolean>
  ) {}

  attach(sessionId: string, webviewId: number, senderId: WindowId | null, requestId?: string): { tabId: string } {
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
    const repair = requestId ? this.repairs.get(sessionId) : undefined
    if (
      requestId &&
      (!repair ||
        repair.requestId !== requestId ||
        repair.expiresAt <= Date.now() ||
        repair.identity.ownerId !== ownerId ||
        repair.identity.windowId !== senderId ||
        this.identities.get(sessionId) !== repair.identity ||
        (repair.kind === 'reattach'
          ? webviewId !== repair.identity.webContentsId
          : webviewId === repair.identity.webContentsId) ||
        guest.session !== session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser)))
    ) {
      throw new BrowserSessionError('not_allowed')
    }
    if (existing?.guest === guest && existing.windowId === senderId && !existing.abort.signal.aborted && !repair)
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
    this.identities.set(sessionId, { ownerId, windowId: senderId, webContentsId: webviewId, tabId })
    this.claims.set(guest, this.targets.get(sessionId)!)
    guest.once('destroyed', dispose)
    this.changed.fire()
    if (repair) repair.finish(this.targets.get(sessionId)!)
    return { tabId }
  }

  getCursor(sessionId: string, tabId: string, senderId: WindowId | null): BrowserCursor | undefined {
    const target = this.targets.get(sessionId)
    if (!target || target.tabId !== tabId || target.abort.signal.aborted) return undefined
    if (target.windowId !== senderId) throw new BrowserSessionError('not_allowed')
    return target.cursor
  }

  async focusInput(context: BrowserGuestContext, target: BrowserGuestTarget, options: CommandOptions): Promise<void> {
    if (this.get(context) !== target) throw new BrowserSessionError('not_found')
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
    if (this.get(context) !== target) throw new BrowserSessionError('not_found')
  }

  inputFocused(
    sessionId: string,
    tabId: string,
    requestId: string,
    status: InputFor<'browser.input.focused'>['status'],
    senderId: WindowId | null
  ): void {
    const pending = this.pendingFocus.get(requestId)
    if (!pending || pending.target !== this.targets.get(sessionId) || pending.target.tabId !== tabId) return
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
    void guest.loadURL(url, { httpReferrer: details.referrer }).catch((error) => {
      logger.warn('Failed to navigate browser popup in the Agent pane', { error })
      if (this.checkGuest && this.targets.get(target.sessionId) === target && !target.abort.signal.aborted) {
        void this.checkGuest(target)
          .then((healthy) => {
            if (!healthy && this.targets.get(target.sessionId) === target && !target.abort.signal.aborted)
              void this.recover(target, 'recreate').catch(() => undefined)
          })
          .catch(() => undefined)
      }
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
    const pending = this.recovering.get(context.sessionId)
    if (pending) return await this.waitForRecovery(context.sessionId, signal)
    const identity = this.identities.get(context.sessionId)
    if (!existing && identity && this.scope === 'agent' && !url?.startsWith('file:')) {
      if (identity.ownerId !== context.ownerId) throw new BrowserSessionError('not_allowed')
      const previous = webContents.fromId(identity.webContentsId)
      return await this.recover(identity, previous && !previous.isDestroyed() ? 'reattach' : 'recreate', signal)
    }
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

  private recover(
    identity: {
      ownerId: string
      sessionId?: string
      windowId: WindowId
      webContentsId?: number
      tabId: string
      guest?: WebContents
    },
    kind: 'reattach' | 'recreate',
    signal?: AbortSignal
  ): Promise<BrowserGuestTarget> {
    const sessionId = identity.sessionId ?? [...this.identities].find(([, value]) => value === identity)?.[0]
    if (!sessionId) return Promise.reject(new BrowserSessionError('not_found'))
    const current = this.recovering.get(sessionId)
    if (current) return this.waitForRecovery(sessionId, signal)
    const expected = this.identities.get(sessionId)
    if (!expected) return Promise.reject(new BrowserSessionError('not_found'))
    const deadline = Date.now() + 10_000
    const abort = new AbortController()
    const repairSignal = AbortSignal.any([abort.signal, this.shutdown.signal])
    const request = (requestKind: 'reattach' | 'recreate', expiresAt: number) =>
      new Promise<BrowserGuestTarget>((resolve, reject) => {
        const timeout = setTimeout(
          () => finish(undefined, new BrowserSessionError('timeout')),
          Math.max(0, expiresAt - Date.now())
        )
        const onAbort = () => finish(undefined, repairSignal.reason)
        const finish = (target?: BrowserGuestTarget, error?: unknown) => {
          clearTimeout(timeout)
          repairSignal.removeEventListener('abort', onAbort)
          if (this.repairs.get(sessionId)?.requestId === requestId) this.repairs.delete(sessionId)
          if (target) resolve(target)
          else reject(error)
        }
        const requestId = randomUUID()
        this.repairs.set(sessionId, {
          requestId,
          kind: requestKind,
          expiresAt,
          identity: expected,
          finish: (target) => finish(target)
        })
        repairSignal.addEventListener('abort', onAbort, { once: true })
        try {
          repairSignal.throwIfAborted()
          application.get('IpcApiService').send(expected.windowId, 'browser.guest.ensure_requested', {
            sessionId,
            repair: { requestId, kind: requestKind, expiresAt }
          })
        } catch (error) {
          finish(undefined, error)
        }
      })
    const operation = (async () => {
      if (kind === 'reattach') {
        try {
          return await request('reattach', Math.min(deadline, Date.now() + 2000))
        } catch (error) {
          if (repairSignal.aborted || !(error instanceof BrowserSessionError && error.code === 'timeout')) throw error
        }
      }
      return await request('recreate', deadline)
    })()
    const recovery = { promise: operation, abort, waiters: 0 }
    this.recovering.set(sessionId, recovery)
    void operation
      .finally(() => {
        if (this.recovering.get(sessionId) === recovery) this.recovering.delete(sessionId)
      })
      .catch(() => undefined)
    return this.waitForRecovery(sessionId, signal)
  }

  private waitForRecovery(sessionId: string, signal?: AbortSignal): Promise<BrowserGuestTarget> {
    const recovery = this.recovering.get(sessionId)!
    recovery.waiters++
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (target?: BrowserGuestTarget, error?: unknown) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        recovery.waiters--
        if (target) resolve(target)
        else reject(error)
      }
      const onAbort = () => {
        finish(undefined, signal?.reason)
        if (!recovery.waiters) {
          if (this.recovering.get(sessionId) === recovery) this.recovering.delete(sessionId)
          recovery.abort.abort(signal?.reason)
        }
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      void recovery.promise.then(
        (target) => finish(target),
        (error) => finish(undefined, error)
      )
      if (signal?.aborted) onAbort()
    })
  }

  dispose(): void {
    this.shutdown.abort(new BrowserSessionError('not_found'))
    this.identities.clear()
    this.repairs.clear()
    for (const target of this.targets.values()) target.dispose()
    this.changed.dispose()
  }
}
