import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import type { AgentChannelEntity as ChannelRow, AgentChannelType } from '@shared/data/api/schemas/agentChannels'
import type { ChannelConfig } from '@shared/data/types/channel'
import type { IpcEventName } from '@shared/ipc/schemas/ipcSchemas'
import type { EventPayload } from '@shared/ipc/types'

import type { ChannelAdapter } from './ChannelAdapter'
import { ChannelLogBuffer } from './ChannelLogBuffer'
import { channelMessageHandler } from './ChannelMessageHandler'
import type { ChannelLogEntry, ChannelStatusEvent } from './types'

const logger = loggerService.withContext('ChannelManager')

// Adapter factory registry -- adapters register themselves here. The factory
// for a given channel type receives the matching variant of the discriminated
// `ChannelRow` union, so `channel.config` is strongly typed per adapter.
type AdapterFactory<T extends AgentChannelType = AgentChannelType> = (
  channel: Extract<ChannelRow, { type: T }>,
  agentId: string
) => ChannelAdapter
const adapterFactories = new Map<AgentChannelType, AdapterFactory>()

export function registerAdapterFactory<T extends AgentChannelType>(type: T, factory: AdapterFactory<T>): void {
  // A factory is always stored under, and looked up by, its own channel type
  // (see `connectChannelFromRow`), so the row handed to it is guaranteed to be
  // this variant. That invariant is the one thing the type system can't see, so
  // we narrow the row to the factory's variant here — nothing wider is asserted.
  adapterFactories.set(type, (channel, agentId) => factory(channel as Extract<ChannelRow, { type: T }>, agentId))
}

/**
 * Lazy-load map: adapter type → dynamic import of the adapter module.
 * Each module registers itself via `registerAdapterFactory()` as a side effect.
 * This avoids eagerly importing all 6 heavy adapter modules at startup.
 */
const adapterImportMap: Record<AgentChannelType, () => Promise<unknown>> = {
  discord: () => import('./adapters/discord/DiscordAdapter'),
  feishu: () => import('./adapters/feishu/FeishuAdapter'),
  qq: () => import('./adapters/qq/QqAdapter'),
  slack: () => import('./adapters/slack/SlackAdapter'),
  telegram: () => import('./adapters/telegram/TelegramAdapter'),
  wechat: () => import('./adapters/wechat/WeChatAdapter')
}

/** Ensure the adapter factory for the given type is loaded (idempotent). */
async function ensureAdapterLoaded(type: AgentChannelType): Promise<void> {
  if (adapterFactories.has(type)) return
  await adapterImportMap[type]()
}

@Injectable('ChannelManager')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class ChannelManager extends BaseService {
  private readonly adapters = new Map<string, ChannelAdapter>() // key: `${agentId}:${channelId}`
  private readonly adapterRuntimeHolds = new Map<
    symbol,
    { reason?: string; adapterHolds: Map<ChannelAdapter, Disposable> }
  >()
  private readonly adapterRuntimeResumeWaiters = new Set<{
    resolve: () => void
    reject: (error: Error) => void
  }>()
  private readonly inFlightAdapterManagerWork = new Map<Promise<unknown>, string>()
  private stopping = false
  private readonly qrWaiters = new Map<
    string,
    { resolve: (url: string) => void; timer: ReturnType<typeof setTimeout> }
  >()
  private readonly channelLogs = new ChannelLogBuffer()
  private readonly channelStatuses = new Map<string, ChannelStatusEvent>()

  protected async onReady(): Promise<void> {
    this.stopping = false
    await this.start()
  }

  protected async onStop(): Promise<void> {
    this.stopping = true
    const waiters = [...this.adapterRuntimeResumeWaiters]
    this.adapterRuntimeResumeWaiters.clear()
    for (const waiter of waiters) waiter.reject(new Error('ChannelManager is stopping'))
    await this.stop()
  }

  // ── Write quiesce (backup restore) ───────────────────────────────
  // Thin delegates so the restore orchestrator reaches the channel writer via
  // `application.get('ChannelManager')`. State lives on the `channelMessageHandler`
  // singleton (it owns the debounce buffers); see its docs for the contract.

  /** Stop channel intake and flush buffered debounce batches immediately. */
  pause(reason?: string): Disposable {
    return channelMessageHandler.pause(reason)
  }

  /** Await the flushed batches' agent-turn admissions, bounded by timeoutMs. */
  drainInFlight(opts: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    return channelMessageHandler.drainInFlight(opts)
  }

  /** Advisory pre-flight enumeration for the restore orchestrator. */
  listActiveWork(): Array<{ id: string; summary: string }> {
    return channelMessageHandler.listActiveWork()
  }

  /** Pause adapter lifecycle and profile-write work after channel intake has drained. */
  pauseAdapterRuntime(reason?: string): Disposable {
    const token = Symbol(reason ?? 'channel-adapter-runtime-pause')
    const adapterHolds = new Map<ChannelAdapter, Disposable>()
    for (const adapter of this.adapters.values()) {
      adapterHolds.set(adapter, adapter.pauseRuntime(reason))
    }
    this.adapterRuntimeHolds.set(token, { reason, adapterHolds })
    logger.info('Channel adapter runtime paused', { reason: reason ?? null, holds: this.adapterRuntimeHolds.size })

    return {
      dispose: () => {
        const hold = this.adapterRuntimeHolds.get(token)
        if (!hold) return
        this.adapterRuntimeHolds.delete(token)
        for (const adapterHold of hold.adapterHolds.values()) adapterHold.dispose()
        logger.info('Channel adapter runtime pause hold released', {
          reason: reason ?? null,
          holds: this.adapterRuntimeHolds.size
        })
        if (this.adapterRuntimeHolds.size > 0 || this.stopping) return
        const waiters = [...this.adapterRuntimeResumeWaiters]
        this.adapterRuntimeResumeWaiters.clear()
        for (const waiter of waiters) waiter.resolve()
      }
    }
  }

  async drainAdapterRuntimeInFlight(opts: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    const startedAt = Date.now()
    const managerDrain = this.drainManagerRuntimeWork(opts)
    const adapterDrains = [...this.adapters.values()].map(async (adapter) => {
      const elapsed = Date.now() - startedAt
      const verdict = await adapter.drainRuntimeInFlight({ timeoutMs: Math.max(0, opts.timeoutMs - elapsed) })
      return verdict.stragglerIds.map((id) => `adapter:${adapter.channelId}:${id}`)
    })
    const [managerVerdict, ...adapterVerdicts] = await Promise.all([managerDrain, ...adapterDrains])
    return { stragglerIds: [...managerVerdict.stragglerIds, ...adapterVerdicts.flat()] }
  }

  listActiveAdapterWork(): Array<{ id: string; summary: string }> {
    const work: Array<{ id: string; summary: string }> = []
    for (const label of new Set(this.inFlightAdapterManagerWork.values())) {
      work.push({ id: label, summary: 'channel manager runtime work in flight' })
    }
    for (const adapter of this.adapters.values()) {
      for (const item of adapter.listActiveRuntimeWork()) {
        work.push({ id: `adapter:${adapter.channelId}:${item.id}`, summary: item.summary })
      }
    }
    return work
  }

  async start(): Promise<void> {
    let channels: Awaited<ReturnType<typeof channelService.listChannels>>
    try {
      channels = channelService.listChannels()
    } catch (error) {
      logger.error('Failed to list channels during startup', {
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }

    const activeChannels = channels.filter((ch) => ch.isActive && ch.agentId)

    // Lazy-load only the adapter modules needed for active channels
    const neededTypes = [...new Set(activeChannels.map((ch) => ch.type))]
    await Promise.all(neededTypes.map((type) => ensureAdapterLoaded(type)))

    await Promise.all(activeChannels.map((channel) => this.connectChannelFromRow(channel)))

    logger.info('Channel manager started', { adapterCount: this.adapters.size })
  }

  async stop(): Promise<void> {
    logger.info('Stopping channel manager')
    const disconnects = Array.from(this.adapters.values()).map((adapter) =>
      adapter.disconnect().catch((err) => {
        logger.warn('Error disconnecting adapter', {
          agentId: adapter.agentId,
          channelId: adapter.channelId,
          error: err instanceof Error ? err.message : String(err)
        })
      })
    )
    await Promise.all(disconnects)
    this.adapters.clear()
    logger.info('Channel manager stopped')
  }

  /**
   * Wait for a QR URL from a specific channel adapter during connect.
   * Resolves when the adapter emits 'qr', or rejects on timeout.
   */
  waitForQrUrl(agentId: string, channelId: string, timeoutMs = 30_000): Promise<string> {
    const key = `${agentId}:${channelId}`
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.qrWaiters.delete(key)
        reject(new Error('Timed out waiting for QR code'))
      }, timeoutMs)
      this.qrWaiters.set(key, { resolve, timer })
    })
  }

  /** Return connection state for all adapters of an agent. */
  getAdapterStatuses(agentId: string): Array<{ channelId: string; connected: boolean }> {
    const result: Array<{ channelId: string; connected: boolean }> = []
    for (const [key, adapter] of this.adapters) {
      if (adapter.agentId !== agentId) continue
      const channelId = key.split(':')[1]
      result.push({ channelId, connected: adapter.connected })
    }
    return result
  }

  /** Return all connected adapters for an agent. */
  getAgentAdapters(agentId: string): ChannelAdapter[] {
    const result: ChannelAdapter[] = []
    for (const [, adapter] of this.adapters) {
      if (adapter.agentId !== agentId) continue
      result.push(adapter)
    }
    return result
  }

  /** Return the adapter for a specific channel, if connected. */
  getAdapter(channelId: string): ChannelAdapter | undefined {
    for (const [, adapter] of this.adapters) {
      if (adapter.channelId === channelId) return adapter
    }
    return undefined
  }

  /** Get buffered logs for a channel. */
  getChannelLogs(channelId: string): ChannelLogEntry[] {
    return this.channelLogs.get(channelId)
  }

  /** Get live connection status for all active adapters. */
  getAllStatuses(): ChannelStatusEvent[] {
    const result: ChannelStatusEvent[] = []
    for (const [, adapter] of this.adapters) {
      const cached = this.channelStatuses.get(adapter.channelId)
      result.push({
        channelId: adapter.channelId,
        connected: adapter.connected,
        ...(cached?.error && !adapter.connected ? { error: cached.error } : {})
      })
    }
    return result
  }

  private sendToRenderer<E extends IpcEventName>(event: E, data: EventPayload<E>): void {
    application.get('IpcApiService').broadcastToType(WindowType.Main, event, data)
  }

  private runAdapterManagerWork<T>(label: string, work: () => Promise<T> | T): Promise<T> {
    if (this.adapterRuntimeHolds.size > 0) {
      return this.waitForAdapterRuntimeResume().then(() => this.runAdapterManagerWork(label, work))
    }

    const operation = Promise.resolve().then(work)
    this.inFlightAdapterManagerWork.set(operation, label)
    void operation.then(
      () => this.inFlightAdapterManagerWork.delete(operation),
      () => this.inFlightAdapterManagerWork.delete(operation)
    )
    return operation
  }

  private waitForAdapterRuntimeResume(): Promise<void> {
    if (this.stopping) return Promise.reject(new Error('ChannelManager is stopping'))
    if (this.adapterRuntimeHolds.size === 0) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      this.adapterRuntimeResumeWaiters.add({ resolve, reject })
    })
  }

  private async drainManagerRuntimeWork(opts: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    const snapshot = [...this.inFlightAdapterManagerWork.entries()]
    if (snapshot.length === 0) return { stragglerIds: [] }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), opts.timeoutMs)
    })
    try {
      const winner = await Promise.race([
        Promise.allSettled(snapshot.map(([operation]) => operation)).then(() => 'done' as const),
        timeout
      ])
      if (winner === 'done') return { stragglerIds: [] }
      return {
        stragglerIds: snapshot
          .filter(([operation]) => this.inFlightAdapterManagerWork.has(operation))
          .map(([, label]) => label)
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  /** Disconnect the adapter for a single channel without reconnecting. */
  async disconnectChannel(channelId: string, options: { suppressErrors?: boolean } = {}): Promise<void> {
    const { suppressErrors = true } = options
    for (const [key, adapter] of this.adapters) {
      if (adapter.channelId !== channelId) continue

      try {
        await adapter.disconnect()
        this.adapters.delete(key)
      } catch (err) {
        if (suppressErrors) {
          logger.warn('Error disconnecting adapter', {
            key,
            error: err instanceof Error ? err.message : String(err)
          })
          this.adapters.delete(key)
          continue
        }
        throw err
      }
    }
  }

  /**
   * Sync a single channel: disconnect its adapter (if any) and reconnect if active.
   * Use this instead of disconnectAgent() when only one channel changed.
   */
  async syncChannel(
    channelId: string,
    options: { awaitConnect?: boolean; strictDisconnect?: boolean } = {}
  ): Promise<void> {
    await this.waitForAdapterRuntimeResume()
    const { awaitConnect = false, strictDisconnect = false } = options
    await this.disconnectChannel(channelId, { suppressErrors: !strictDisconnect })

    // Re-read from DB and reconnect if active
    const channel = channelService.getChannel(channelId)
    if (channel && channel.isActive && channel.agentId) {
      await ensureAdapterLoaded(channel.type)
      await this.connectChannelFromRow(channel, { awaitConnect })
    }
  }

  /**
   * Disconnect all adapters for an agent without reconnecting.
   * Use when the agent is deleted or its channels should all be torn down.
   */
  async disconnectAgent(agentId: string): Promise<void> {
    const toDisconnect = [...this.adapters.entries()].filter(([, a]) => a.agentId === agentId)
    await Promise.all(
      toDisconnect.map(([key, adapter]) =>
        adapter
          .disconnect()
          .catch((err) => {
            logger.warn('Error disconnecting adapter', {
              key,
              error: err instanceof Error ? err.message : String(err)
            })
          })
          .finally(() => {
            this.adapters.delete(key)
          })
      )
    )

    channelMessageHandler.clearSessionTracker(agentId)
  }

  /**
   * Persist credentials obtained from QR registration into the channel config,
   * then re-sync so a new adapter connects with the saved credentials.
   */
  private async saveCredentialsAndReconnect(
    agentId: string,
    channelId: string,
    creds: { appId: string; appSecret: string }
  ): Promise<void> {
    const updated = await this.runAdapterManagerWork(`credentials:${channelId}`, () =>
      application.get('ProfileWriteBarrierService').runWrite(`channel:credentials:${channelId}`, () => {
        const channel = channelService.getChannel(channelId)
        if (!channel) return false

        const config = channel.config as ChannelConfig & Record<string, unknown>
        channelService.updateChannel(channelId, {
          config: { ...config, app_id: creds.appId, app_secret: creds.appSecret } as ChannelConfig
        })
        return true
      })
    )
    if (!updated) return

    logger.info('Saved QR registration credentials, reconnecting', { agentId, channelId })
    await this.waitForAdapterRuntimeResume()
    await this.syncChannel(channelId)
  }

  private async connectChannelFromRow(row: ChannelRow, options: { awaitConnect?: boolean } = {}): Promise<void> {
    const agentId = row.agentId
    if (!agentId) return

    const factory = adapterFactories.get(row.type)
    if (!factory) {
      logger.warn('No adapter factory for channel type', { type: row.type, agentId })
      return
    }

    const key = `${agentId}:${row.id}`
    try {
      const adapter = factory(row, agentId)
      for (const hold of this.adapterRuntimeHolds.values()) {
        hold.adapterHolds.set(adapter, adapter.pauseRuntime(hold.reason))
      }

      // Seed notifyChatIds from DB-persisted activeChatIds (when allowed_chat_ids is empty)
      const hasAllowedIds = adapter.notifyChatIds.length > 0
      if (!hasAllowedIds) {
        const dbChatIds = row.activeChatIds ?? []
        adapter.notifyChatIds = [...dbChatIds]
      }

      const trackChatId = async (chatId: string): Promise<void> => {
        if (hasAllowedIds) return
        if (adapter.notifyChatIds.includes(chatId)) return
        try {
          await application.get('ProfileWriteBarrierService').runWrite(`channel:active-chat:${row.id}`, () => {
            if (adapter.notifyChatIds.includes(chatId)) return
            channelService.addActiveChatId(row.id, chatId)
            adapter.notifyChatIds.push(chatId)
          })
        } catch (err) {
          logger.warn('Failed to persist activeChatId', {
            channelId: row.id,
            chatId,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }

      adapter.on('message', (msg) => {
        // Defer the activeChatIds write and message admission together. The
        // intake drain joins this callback and the profile barrier owns the
        // direct DB mutation, so neither can straddle the snapshot gate.
        channelMessageHandler
          .runWhenResumed(async () => {
            await trackChatId(msg.chatId)
            return channelMessageHandler.handleIncoming(adapter, msg)
          })
          .catch((err) => {
            logger.error('Unhandled error in message handler', {
              agentId,
              channelId: row.id,
              error: err instanceof Error ? err.message : String(err)
            })
            adapter
              .sendMessage(msg.chatId, '⚠️ An error occurred while processing your message. Please try again later.')
              .catch(() => {})
          })
      })

      adapter.on('command', (cmd) => {
        channelMessageHandler
          .runWhenResumed(async () => {
            await trackChatId(cmd.chatId)
            return channelMessageHandler.handleCommand(adapter, cmd)
          })
          .catch((err) => {
            logger.error('Unhandled error in command handler', {
              agentId,
              channelId: row.id,
              error: err instanceof Error ? err.message : String(err)
            })
            adapter
              .sendMessage(cmd.chatId, '⚠️ An error occurred while processing the command. Please try again later.')
              .catch(() => {})
          })
      })

      // Forward QR events to any pending waiters
      adapter.on('qr', (url) => {
        const waiterKey = `${agentId}:${row.id}`
        const waiter = this.qrWaiters.get(waiterKey)
        if (waiter) {
          clearTimeout(waiter.timer)
          this.qrWaiters.delete(waiterKey)
          waiter.resolve(url)
        }
      })

      // When an adapter obtains credentials via QR registration, persist them
      // to the channel config and re-sync so a new adapter connects with creds.
      adapter.on('credentials', (creds) => {
        this.saveCredentialsAndReconnect(agentId, row.id, creds).catch((err) => {
          logger.error('Failed to save credentials and reconnect', {
            agentId,
            channelId: row.id,
            error: err instanceof Error ? err.message : String(err)
          })
        })
      })

      // Forward log & status events to renderer via IPC
      adapter.on('log', (entry) => {
        this.channelLogs.append(entry.channelId, entry)
        this.sendToRenderer('channel.log', entry)
      })

      adapter.on('statusChange', (status) => {
        this.channelStatuses.set(status.channelId, status)
        this.sendToRenderer('channel.status_changed', status)
      })

      // Register adapter immediately so it's discoverable. Callers can either
      // await connect for strict workflows or leave it in the background.
      this.adapters.set(key, adapter)

      const connect = async () => {
        try {
          await adapter.connect()
          logger.info('Channel adapter connected', { agentId, channelId: row.id, type: row.type })
        } catch (error) {
          this.adapters.delete(key)
          logger.error('Failed to connect channel adapter', {
            agentId,
            channelId: row.id,
            type: row.type,
            error: error instanceof Error ? error.message : String(error)
          })
          throw error
        }
      }

      if (options.awaitConnect) {
        await connect()
      } else {
        void connect().catch(() => {})
      }
    } catch (error) {
      logger.error('Failed to create channel adapter', {
        agentId,
        channelId: row.id,
        type: row.type,
        error: error instanceof Error ? error.message : String(error)
      })
      const errorStatus: ChannelStatusEvent = {
        channelId: row.id,
        connected: false,
        error: error instanceof Error ? error.message : String(error)
      }
      this.channelStatuses.set(row.id, errorStatus)
      this.sendToRenderer('channel.status_changed', errorStatus)
      if (options.awaitConnect) {
        throw error
      }
    }
  }
}
