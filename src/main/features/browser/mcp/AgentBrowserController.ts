import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { BROWSER_TOOL_GROUP } from '@shared/ai/browserTools'
import { normalizeBrowserUrl } from '@shared/utils/browserUrl'
import { Mutex } from 'async-mutex'

import { settleAction } from '../actions/settle'
import type { AgentBrowserContext, AgentBrowserRegistry, AgentBrowserTarget } from '../AgentBrowserRegistry'
import type { BrowserSessionService } from '../BrowserSessionService'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import { sanitizeSnapshotUrl } from '../snapshot/serializeSnapshot'
import { BrowserPageController } from './BrowserPageController'

export class AgentBrowserController extends BrowserPageController {
  private readonly owner = `agent-browser:${randomUUID()}`
  private readonly abort = new AbortController()
  readonly signal = this.abort.signal
  private closing?: Promise<void>
  private readonly leaseMutex = new Mutex()
  private lease?: { target: AgentBrowserTarget; session: GuestSession; release: () => void }

  constructor(
    private readonly service: BrowserSessionService,
    private readonly registry: AgentBrowserRegistry,
    private readonly context: AgentBrowserContext
  ) {
    super()
  }

  assertAvailable(): void {
    this.signal.throwIfAborted()
    const agent = agentService.getAgent(this.context.agentId)
    if (!agent || agent.disabledTools?.includes(BROWSER_TOOL_GROUP)) throw new BrowserSessionError('not_allowed')
    if (!application.get('PreferenceService').get('app.browser.agent_control.enabled'))
      throw new BrowserSessionError('not_allowed')
  }

  validateUrl(url: string): string {
    return normalizeBrowserUrl(url)
  }

  async getSession(privateMode = false, tabId?: string) {
    return this.leaseMutex.runExclusive(async () => {
      this.assertAvailable()
      if (privateMode) throw new BrowserSessionError('not_allowed')
      const target = tabId ? this.registry.get(this.context) : await this.registry.reveal(this.context, this.signal)
      if (!target || (tabId && target.tabId !== tabId)) throw new BrowserSessionError('not_found')
      if (this.lease?.target !== target) {
        this.lease?.release()
        const session = this.service.acquire(target.guest, this.owner, { ownership: 'borrowed' })
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
        signal: AbortSignal.any([this.signal, target.abort.signal])
      }
    })
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
    const target = await this.registry.reveal(this.context, signal, url)
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
    const target = this.registry.get(this.context)
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
    const target = this.registry.get(this.context)
    return target
      ? [{ tabId: target.tabId, url: sanitizeSnapshotUrl(target.guest.getURL()), title: target.guest.getTitle() }]
      : []
  }
  async switchTab(): Promise<void> {
    throw new BrowserSessionError('not_allowed')
  }
  async closeTab(): Promise<void> {
    throw new BrowserSessionError('not_allowed')
  }
  async reset(): Promise<void> {
    throw new BrowserSessionError('not_allowed')
  }
  dispose(): Promise<void> {
    this.abort.abort(new BrowserSessionError('debugger_unavailable'))
    this.lease?.release()
    return (this.closing ??= this.leaseMutex.runExclusive(() => {
      this.lease?.release()
    }))
  }
}
