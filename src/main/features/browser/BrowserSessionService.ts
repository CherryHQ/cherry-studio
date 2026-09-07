import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, LifecycleState, Phase, ServicePhase } from '@main/core/lifecycle'
import type { BrowserImportOptions, BrowserImportResult } from '@shared/ipc/schemas/browserImport'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'
import { app, type BrowserWindow, dialog, session, webContents } from 'electron'

import { type AgentBrowserContext, AgentBrowserRegistry } from './AgentBrowserRegistry'
import type { SessionOwnership } from './browserUse'
import { listBrowserProfiles } from './import/browserProfiles'
import { emptyImportResult, importBrowserData } from './import/importBrowserData'
import { AgentBrowserController } from './mcp/AgentBrowserController'
import { BrowserServer } from './mcp/server'
import { BrowserSessionError } from './session/BrowserSessionError'
import { GuestSession } from './session/GuestSession'
import { trackBrowserHistory } from './trackBrowserHistory'

const logger = loggerService.withContext('BrowserSessionService')
const MAX_GUESTS_PER_OWNER = 4
const MAX_GUESTS_GLOBAL = 8
const TEMPORARY_IDLE_MS = 5 * 60_000

interface SessionEntry {
  session: GuestSession
  owners: Map<string, number>
  creator: string
  ownership: SessionOwnership
  onDestroyed: () => void
}

@Injectable('BrowserSessionService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager', 'ConversationNavigationService'])
export class BrowserSessionService extends BaseService {
  private readonly shutdown = new AbortController()
  private dataOperation?: Promise<unknown>
  readonly agentBrowser = new AgentBrowserRegistry()
  private readonly agentServers = new Set<BrowserServer>()
  private readonly servers = new Set<BrowserServer>()
  private readonly sessions = new Map<number, SessionEntry>()

  protected onInit(): void {
    const guests = new Map<Electron.WebContents, () => void>()
    const ordinary = session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
    const profiles = [
      ordinary,
      session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentDevPreview)),
      session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentHtmlArtifact))
    ]
    const track = (_event: Electron.Event | undefined, guest: Electron.WebContents) => {
      if (
        guest.isDestroyed() ||
        guest.getType() !== 'webview' ||
        !profiles.includes(guest.session) ||
        guests.has(guest)
      )
        return
      guest.setWindowOpenHandler((details) => {
        if (!this.agentBrowser.handlePopup(guest, details) && guest.session === ordinary && !details.postBody) {
          try {
            application.get('MainWindowService').openBrowserTab(details.url)
          } catch (error) {
            logger.warn('Blocked unsupported browser popup', { error })
          }
        }
        return { action: 'deny' }
      })
      const release = guest.session === ordinary ? trackBrowserHistory(guest) : () => {}
      const dispose = () => {
        if (!guest.isDestroyed()) guest.setWindowOpenHandler(() => ({ action: 'deny' }))
        release()
        guest.removeListener('destroyed', dispose)
        guests.delete(guest)
      }
      guests.set(guest, dispose)
      guest.once('destroyed', dispose)
    }
    for (const guest of webContents.getAllWebContents()) track(undefined, guest)
    app.on('web-contents-created', track)
    this.registerDisposable(() => {
      app.removeListener('web-contents-created', track)
      for (const dispose of guests.values()) dispose()
    })
    this.registerInterval(() => this.sweep(), 60_000)
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('app.browser.agent_control.enabled', (enabled) => {
        if (!enabled)
          for (const server of this.agentServers)
            void server.close().catch((error) => logger.warn('Failed to release browser control', { error }))
      })
    )
  }

  async createMcpServer() {
    if (this.state === LifecycleState.Stopping || this.isStopped || this.isDestroyed)
      throw new BrowserSessionError('debugger_unavailable')
    const server = new BrowserServer(this, () => this.servers.delete(server))
    this.servers.add(server)
    return server.server
  }

  createAgentMcpServer(context: AgentBrowserContext) {
    if (this.state === LifecycleState.Stopping || this.isStopped || this.isDestroyed)
      throw new BrowserSessionError('debugger_unavailable')
    const server = new BrowserServer(
      this,
      () => {
        this.servers.delete(server)
        this.agentServers.delete(server)
      },
      new AgentBrowserController(this, this.agentBrowser, context)
    )
    this.servers.add(server)
    this.agentServers.add(server)
    return server.server
  }

  async listImportSources() {
    return (await listBrowserProfiles()).map(({ id, browser, profile, displayName, account, history, cookies }) => ({
      id,
      browser,
      profile,
      displayName,
      account,
      history,
      cookies
    }))
  }

  async pickAndImport(options: BrowserImportOptions, window: BrowserWindow) {
    let file: string | undefined
    if (!options.sourceId) {
      const picked = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        filters: [{ name: 'JSON / Netscape cookies', extensions: ['json', 'txt'] }]
      })
      if (picked.canceled || !picked.filePaths[0]) return { ...emptyImportResult(), cancelled: true }
      file = picked.filePaths[0]
    }
    return this.runImport(options, file)
  }

  runImport(options: BrowserImportOptions, file?: string): Promise<BrowserImportResult> {
    return this.runDataOperation(() =>
      importBrowserData(options, file, AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(120_000)]))
    )
  }

  clearData(kind: 'site_data' | 'cache'): Promise<void> {
    return this.runDataOperation(async () => {
      const profile = session.fromPartition(getWebviewPartition(WebviewSecurityProfile.AgentBrowser))
      if (kind === 'cache') await profile.clearCache()
      else {
        await profile.clearStorageData()
        await profile.cookies.flushStore()
        profile.flushStorageData()
      }
    })
  }

  private async runDataOperation<T>(run: () => Promise<T>): Promise<T> {
    this.shutdown.signal.throwIfAborted()
    if (this.dataOperation) throw new BrowserSessionError('not_allowed')
    const operation = run()
    this.dataOperation = operation
    try {
      return await operation
    } finally {
      this.dataOperation = undefined
    }
  }

  closeGuest(guest: Electron.WebContents): void {
    this.remove(guest.id, true)
  }

  acquire(guest: Electron.WebContents, owner: string, ownership: SessionOwnership): GuestSession {
    if (this.state === LifecycleState.Stopping || this.isStopped || this.isDestroyed || guest.isDestroyed())
      throw new BrowserSessionError('debugger_unavailable')
    const existing = this.sessions.get(guest.id)
    if (existing) {
      if (existing.ownership.ownership !== ownership.ownership) throw new BrowserSessionError('not_allowed')
      existing.owners.set(owner, (existing.owners.get(owner) ?? 0) + 1)
      existing.session.lastActive = Date.now()
      return existing.session
    }
    if (ownership.ownership === 'managed') {
      this.makeRoom(owner)
    }
    const session = new GuestSession(guest, ownership.ownership)
    const onDestroyed = () => this.remove(guest.id, false)
    this.sessions.set(guest.id, { session, owners: new Map([[owner, 1]]), creator: owner, ownership, onDestroyed })
    guest.once('destroyed', onDestroyed)
    return session
  }

  get(webContentsId: number): GuestSession | undefined {
    return this.sessions.get(webContentsId)?.session
  }

  release(guest: Electron.WebContents, owner: string): void {
    const entry = this.sessions.get(guest.id)
    const count = entry?.owners.get(owner)
    if (!entry || !count) return
    if (count === 1) entry.owners.delete(owner)
    else entry.owners.set(owner, count - 1)
    if (!entry.owners.size && entry.ownership.ownership === 'borrowed') this.remove(guest.id, false)
  }

  endTurn(owner: string): void {
    for (const [id, entry] of this.sessions) {
      if (entry.ownership.ownership !== 'managed' || entry.creator !== owner) continue
      if (entry.session.retention === 'temporary' && !entry.session.busy) this.remove(id, true)
      else entry.session.retention = 'temporary'
    }
  }

  private makeRoom(owner: string): void {
    const managed = [...this.sessions.values()].filter((entry) => entry.ownership.ownership === 'managed')
    const own = managed.filter((entry) => entry.creator === owner)
    const candidates = own.length >= MAX_GUESTS_PER_OWNER ? own : managed.length >= MAX_GUESTS_GLOBAL ? managed : []
    if (!candidates.length) return
    const candidate = candidates
      .filter(
        (entry) =>
          !entry.session.busy &&
          entry.session.retention !== 'deliverable' &&
          (own.length < MAX_GUESTS_PER_OWNER || entry.session.retention === 'temporary')
      )
      .sort(
        (a, b) =>
          Number(a.session.retention === 'handoff') - Number(b.session.retention === 'handoff') ||
          a.session.lastActive - b.session.lastActive
      )[0]
    if (!candidate) throw new BrowserSessionError('budget_exceeded')
    this.remove(candidate.session.guest.id, true)
  }

  private sweep(): void {
    for (const [id, entry] of this.sessions) {
      if (
        entry.ownership.ownership === 'managed' &&
        entry.session.retention === 'temporary' &&
        !entry.session.busy &&
        Date.now() - entry.session.lastActive >= TEMPORARY_IDLE_MS
      )
        this.remove(id, true)
    }
  }

  private remove(id: number, close: boolean): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    this.sessions.delete(id)
    entry.session.guest.removeListener('destroyed', entry.onDestroyed)
    entry.session.dispose()
    if (close && entry.ownership.ownership === 'managed' && !entry.session.guest.isDestroyed()) {
      try {
        entry.ownership.close()
      } catch (error) {
        logger.warn('Failed to close managed browser tab', { error })
      }
    }
  }

  protected async onStop(): Promise<void> {
    this.shutdown.abort()
    await Promise.allSettled(this.dataOperation ? [this.dataOperation] : [])
    const results = await Promise.allSettled([...this.servers].map((server) => server.close()))
    this.servers.clear()
    this.agentServers.clear()
    this.agentBrowser.dispose()
    for (const id of this.sessions.keys()) this.remove(id, true)
    const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
    if (errors.length) {
      logger.warn('Browser server shutdown failed', { errors })
      throw new AggregateError(errors, 'Failed to stop browser sessions')
    }
  }
}
