import { randomUUID } from 'node:crypto'

import { Mutex } from 'async-mutex'

import type { Disposable } from '@main/core/lifecycle'
import { normalizeBrowserEntryUrl } from '@shared/utils/browserUrl'

import { settleAction } from '../actions/settle'
import type { BrowserPointerFeedback } from '../BrowserCursor'
import type { BrowserGuestTarget } from '../BrowserGuestRegistry'
import type { BrowserSessionService } from '../BrowserSessionService'
import type { CommandOptions } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import { sanitizeSnapshotUrl } from '../snapshot/serializeSnapshot'
import { BrowserPageController } from './BrowserPageController'

export interface BrowserSessionBinding {
  assertAvailable(): void
  get(tabId?: string): BrowserGuestTarget | undefined
  list(): BrowserGuestTarget[]
  ensureGuest(
    signal: AbortSignal,
    url?: string,
    options?: { pageId?: string; newTab?: boolean }
  ): Promise<BrowserGuestTarget>
  focusInput(target: BrowserGuestTarget, options: CommandOptions): Promise<void>
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
  private defaultTabId?: string
  private readonly leases = new Map<string, { session: GuestSession; release: () => void }>()

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
      const requested = tabId ?? this.defaultTabId
      const target = requested ? this.binding.get(requested) : await this.binding.ensureGuest(this.operationSignal)
      if (!target) throw new BrowserSessionError('not_found')
      this.defaultTabId ??= target.tabId
      if (this.execution?.target !== target) {
        this.execution?.lease.dispose()
        this.execution = { target, lease: target.beginExecution() }
      }
      let lease = this.leases.get(target.tabId)
      if (!lease) {
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
          this.leases.delete(target.tabId)
        }
        const signal = AbortSignal.any([this.signal, target.abort.signal])
        if (signal.aborted) {
          release()
          signal.throwIfAborted()
        }
        target.abort.signal.addEventListener('abort', release, { once: true })
        lease = { session, release }
        this.leases.set(target.tabId, lease)
      }
      return {
        tabId: target.tabId,
        session: lease.session,
        pointer: this.pointerFeedback(target, lease.session),
        focusInput: async (options: CommandOptions) => {
          this.assertAvailable()
          this.binding.reveal(target)
          await this.binding.focusInput(target, options)
          this.assertAvailable()
        },
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
        this.binding.reveal(target)
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
    signal?: AbortSignal,
    targetId?: string
  ) {
    this.assertAvailable()
    if (privateMode) throw new BrowserSessionError('not_allowed')
    url = this.validateUrl(url)
    signal = AbortSignal.any(signal ? [this.signal, signal] : [this.signal])
    const requested = targetId ?? this.defaultTabId
    const previous = requested ? this.binding.get(requested) : undefined
    if (requested && !previous && !newTab) throw new BrowserSessionError('not_found')
    const target = await this.binding.ensureGuest(signal, url, {
      pageId: newTab ? undefined : previous?.pageId,
      newTab
    })
    if (!this.defaultTabId || (!newTab && this.defaultTabId === previous?.tabId)) this.defaultTabId = target.tabId
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
    const target = this.binding.get(tabId)
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
    return this.binding.list().map((target) => ({
      tabId: target.tabId,
      url: sanitizeSnapshotUrl(target.guest.getURL()),
      title: target.guest.getTitle()
    }))
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
    for (const lease of this.leases.values()) lease.release()
    return (this.closing ??= this.leaseMutex.runExclusive(() => {
      for (const lease of this.leases.values()) lease.release()
    }))
  }
}
