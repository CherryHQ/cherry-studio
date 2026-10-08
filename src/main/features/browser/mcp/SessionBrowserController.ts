import { randomUUID } from 'node:crypto'

import { Mutex } from 'async-mutex'

import type { Disposable } from '@main/core/lifecycle'
import { normalizeBrowserEntryUrl } from '@shared/utils/browserUrl'

import { settleAction } from '../actions/settle'
import type { BrowserPointerFeedback } from '../BrowserCursor'
import type { BrowserGuestTarget } from '../BrowserGuestRegistry'
import type { BrowserSessionService } from '../BrowserSessionService'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import { sanitizeSnapshotUrl } from '../snapshot/serializeSnapshot'
import { BrowserPageController } from './BrowserPageController'

export interface BrowserSessionBinding {
  assertAvailable(): void
  get(): BrowserGuestTarget | undefined
  ensureGuest(signal: AbortSignal, url?: string): Promise<BrowserGuestTarget>
  reveal(target: BrowserGuestTarget): void
  cursorMoved?(): void
  trackCursor?(hide: () => void): Disposable
}

export class SessionBrowserController extends BrowserPageController {
  private readonly owner = `session-browser:${randomUUID()}`
  private readonly abort = new AbortController()
  private toolSignal?: AbortSignal
  readonly signal = this.abort.signal
  private get operationSignal(): AbortSignal {
    return this.toolSignal ?? this.signal
  }
  beginTool(signal: AbortSignal): void {
    this.toolSignal = AbortSignal.any([signal, this.abort.signal])
  }
  private closing?: Promise<void>
  private turnSubscription?: Disposable
  private execution?: { target: BrowserGuestTarget; lease: Disposable }
  private readonly leaseMutex = new Mutex()
  private lease?: { target: BrowserGuestTarget; session: GuestSession; release: () => void }

  constructor(
    private readonly service: BrowserSessionService,
    private readonly binding: BrowserSessionBinding
  ) {
    super()
  }

  assertAvailable(): void {
    this.signal.throwIfAborted()
    this.binding.assertAvailable()
  }

  validateUrl(url: string): string {
    return normalizeBrowserEntryUrl(url)
  }

  async getSession(privateMode = false, tabId?: string) {
    return this.leaseMutex.runExclusive(async () => {
      this.operationSignal.throwIfAborted()
      this.assertAvailable()
      if (privateMode) throw new BrowserSessionError('not_allowed')
      const target = tabId ? this.binding.get() : await this.binding.ensureGuest(this.operationSignal)
      if (!target || (tabId && target.tabId !== tabId)) throw new BrowserSessionError('not_found')
      if (this.execution?.target !== target) {
        this.execution?.lease.dispose()
        this.execution = { target, lease: target.beginExecution() }
      }
      if (this.lease?.target !== target) {
        this.lease?.release()
        const session = await this.service.acquire(target.guest, this.owner, { ownership: 'borrowed' })
        let observation
        try {
          observation = await session.observe({ signal: AbortSignal.any([this.signal, target.abort.signal]) })
        } catch (error) {
          this.service.release(target.guest, this.owner)
          throw error
        }
        let released = false
        const release = () => {
          if (released) return
          released = true
          target.abort.signal.removeEventListener('abort', release)
          target.cursor.hide()
          observation.dispose()
          this.service.release(target.guest, this.owner)
          if (this.lease?.target === target) this.lease = undefined
        }
        const signal = AbortSignal.any([this.signal, target.abort.signal])
        if (signal.aborted) {
          release()
          signal.throwIfAborted()
        }
        target.abort.signal.addEventListener('abort', release, { once: true })
        this.lease = { target, session, release }
      }
      return {
        tabId: target.tabId,
        session: this.lease.session,
        pointer: this.pointerFeedback(target, this.lease.session),
        signal: AbortSignal.any([this.operationSignal, target.abort.signal])
      }
    })
  }

  private pointerFeedback(target: BrowserGuestTarget, session: GuestSession): BrowserPointerFeedback {
    return {
      move: async (point, options) => {
        options.signal?.throwIfAborted()
        this.assertAvailable()
        this.binding.cursorMoved?.()
        this.turnSubscription ??= this.binding.trackCursor?.(() =>
          target.cursor.hide(new BrowserSessionError('not_found'))
        )
        const documentId = session.documentId
        const waited = await target.cursor.move(point, documentId, options)
        if (documentId !== session.documentId) throw new BrowserSessionError('stale_ref')
        return waited
      },
      update: (point) => target.cursor.update(point),
      pressed: () => target.cursor.pressed(),
      hide: () => target.cursor.hide()
    }
  }

  async open(
    url: string,
    timeout = 10_000,
    privateMode = false,
    newTab = false,
    _showWindow = true,
    signal?: AbortSignal
  ) {
    this.assertAvailable()
    if (privateMode || newTab) throw new BrowserSessionError('not_allowed')
    url = this.validateUrl(url)
    signal = AbortSignal.any(signal ? [this.signal, signal] : [this.signal])
    const target = await this.binding.ensureGuest(signal, url)
    this.binding.reveal(target)
    const { session, tabId } = await this.getSession(false, target.tabId)
    const options = {
      deadline: Date.now() + Math.min(Math.max(timeout, 1), 30_000),
      signal: AbortSignal.any([signal, target.abort.signal])
    }
    await session.run(
      () =>
        settleAction(
          session,
          async () => {
            const result = await session.send('Page.navigate', { url }, options)
            if (result.errorText) throw new Error(result.errorText)
          },
          options
        ),
      options
    )
    return { tabId, currentUrl: sanitizeSnapshotUrl(target.guest.getURL()), title: target.guest.getTitle() }
  }

  takeHostEvents(tabId: string) {
    const target = this.binding.get()
    if (!target || target.tabId !== tabId || !target.popupBlocked) return {}
    target.popupBlocked = false
    return { popupUnsupported: true }
  }

  async takeNewTabId(): Promise<string | undefined> {
    return undefined
  }
  async listTabs(privateMode = false) {
    this.assertAvailable()
    if (privateMode) throw new BrowserSessionError('not_allowed')
    const target = this.binding.get()
    return target
      ? [{ tabId: target.tabId, url: sanitizeSnapshotUrl(target.guest.getURL()), title: target.guest.getTitle() }]
      : []
  }
  finishTool(): void {
    this.toolSignal = undefined
    this.execution?.lease.dispose()
    this.execution = undefined
  }

  dispose(): Promise<void> {
    this.turnSubscription?.dispose()
    this.turnSubscription = undefined
    this.finishTool()
    this.abort.abort(new BrowserSessionError('debugger_unavailable'))
    this.lease?.release()
    return (this.closing ??= this.leaseMutex.runExclusive(() => {
      this.lease?.release()
    }))
  }
}
