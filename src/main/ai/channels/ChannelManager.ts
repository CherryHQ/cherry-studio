import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { t } from '@main/i18n'
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

function canConnectChannel(channel: ChannelRow): boolean {
  if (!channel.isActive || !channel.agentId) return false
  return agentService.getLifecycleState(channel.agentId) === 'active'
}

interface ConnectionGuard {
  managerGeneration: number
  agentGeneration: number
  agentId: string
}

interface AdapterOwnership {
  adapter: ChannelAdapter
  guard: ConnectionGuard
  quarantined: boolean
}

interface ChannelTransitionWork {
  completion?: Promise<void>
}

@Injectable('ChannelManager')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class ChannelManager extends BaseService {
  private readonly adapters = new Map<string, AdapterOwnership>() // key: channelId
  private readonly channelTransitions = new KeyedMutex()
  private readonly qrWaiters = new Map<
    string,
    { resolve: (url: string) => void; timer: ReturnType<typeof setTimeout> }
  >()
  private readonly channelLogs = new ChannelLogBuffer()
  private readonly channelStatuses = new Map<string, ChannelStatusEvent>()
  private readonly agentLifecycleGenerations = new Map<string, number>()
  private readonly agentLifecycleTasks = new Map<string, Promise<void>>()
  private readonly pendingConnections = new Set<Promise<void>>()
  private managerGeneration = 0
  private acceptingConnections = true

  protected async onReady(): Promise<void> {
    this.acceptingConnections = true
    this.registerDisposable(
      agentService.onAgentTrashed(({ agentId }) => {
        const generation = this.invalidateAgentLifecycle(agentId)
        const guard = this.captureConnectionGuard(agentId, this.managerGeneration, generation)
        const channelIds = this.captureAgentChannelIds(agentId)
        this.runAgentLifecycleAction('trashed', agentId, () =>
          this.disconnectAgentWithGuard(agentId, guard, channelIds)
        )
      })
    )
    this.registerDisposable(
      agentService.onAgentRestored(({ agentId }) => {
        const generation = this.invalidateAgentLifecycle(agentId)
        const guard = this.captureConnectionGuard(agentId, this.managerGeneration, generation)
        this.runAgentLifecycleAction('restored', agentId, () => this.restoreAgentChannels(agentId, guard))
      })
    )
    this.registerDisposable(
      agentService.onAgentPurged(({ agentId }) => {
        const generation = this.invalidateAgentLifecycle(agentId)
        const guard = this.captureConnectionGuard(agentId, this.managerGeneration, generation)
        const channelIds = this.captureAgentChannelIds(agentId)
        this.runAgentLifecycleAction('purged', agentId, () => this.disconnectAgentWithGuard(agentId, guard, channelIds))
      })
    )
    await this.start()
  }

  protected async onStop(): Promise<void> {
    await this.stop()
    await Promise.allSettled(this.pendingConnections)
    await this.waitForAgentLifecycleActions()
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

  async start(): Promise<void> {
    this.acceptingConnections = true
    const managerGeneration = ++this.managerGeneration
    let channels: Awaited<ReturnType<typeof channelService.listChannels>>
    try {
      channels = channelService.listChannels()
    } catch (error) {
      logger.error('Failed to list channels during startup', {
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }

    const activeChannels = channels.filter(canConnectChannel).map((channel) => ({
      channel,
      guard: this.captureConnectionGuard(channel.agentId!, managerGeneration)
    }))

    await Promise.all(
      activeChannels.map(({ channel, guard }) =>
        this.runChannelTransition(channel.id, false, () => this.replaceChannelAdapter(channel.id, guard, false))
      )
    )

    logger.info('Channel manager started', { adapterCount: this.adapters.size })
  }

  async stop(): Promise<void> {
    this.acceptingConnections = false
    this.managerGeneration++
    logger.info('Stopping channel manager')
    const disconnects = [...this.adapters.keys()].map((channelId) =>
      this.channelTransitions.runExclusive(channelId, async () => {
        await this.disconnectOwnedAdapter(channelId, true)
      })
    )
    await Promise.all(disconnects)
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
    for (const [channelId, { adapter }] of this.adapters) {
      if (adapter.agentId !== agentId) continue
      result.push({ channelId, connected: adapter.connected })
    }
    return result
  }

  /** Return all registered adapters for an agent, connected or not (a dropped one stays for reconnect). */
  getAgentAdapters(agentId: string): ChannelAdapter[] {
    const result: ChannelAdapter[] = []
    for (const [, { adapter }] of this.adapters) {
      if (adapter.agentId !== agentId) continue
      result.push(adapter)
    }
    return result
  }

  /** Return the adapter for a specific channel, if connected. */
  getAdapter(channelId: string): ChannelAdapter | undefined {
    return this.adapters.get(channelId)?.adapter
  }

  /** Get buffered logs for a channel. */
  getChannelLogs(channelId: string): ChannelLogEntry[] {
    return this.channelLogs.get(channelId)
  }

  /** Get live connection status for all active adapters. */
  getAllStatuses(): ChannelStatusEvent[] {
    const result: ChannelStatusEvent[] = []
    for (const [, { adapter }] of this.adapters) {
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

  private async runChannelTransition(
    channelId: string,
    awaitCompletion: boolean,
    work: () => Promise<ChannelTransitionWork>
  ): Promise<void> {
    if (awaitCompletion) {
      await this.channelTransitions.runExclusive(channelId, async () => {
        const transition = await work()
        await transition.completion
      })
      return
    }

    let resolveStarted!: () => void
    let rejectStarted!: (reason: unknown) => void
    let startedSettled = false
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve
      rejectStarted = reject
    })
    const completion = this.channelTransitions.runExclusive(channelId, async () => {
      try {
        const transition = await work()
        startedSettled = true
        resolveStarted()
        await transition.completion
      } catch (error) {
        if (!startedSettled) {
          startedSettled = true
          rejectStarted(error)
        }
        throw error
      }
    })
    this.trackPendingConnection(completion)
    await started
  }

  private trackPendingConnection(connection: Promise<void>): void {
    this.pendingConnections.add(connection)
    void connection
      .catch(() => {})
      .finally(() => {
        this.pendingConnections.delete(connection)
      })
  }

  private async replaceChannelAdapter(
    channelId: string,
    guard: ConnectionGuard | undefined,
    strictDisconnect: boolean
  ): Promise<ChannelTransitionWork> {
    const disconnected = await this.disconnectOwnedAdapter(channelId, !strictDisconnect)
    if (!disconnected || !guard || !this.isConnectionGuardCurrent(guard)) return {}

    let channel = channelService.getChannel(channelId)
    if (!channel || channel.agentId !== guard.agentId || !canConnectChannel(channel)) return {}

    await ensureAdapterLoaded(channel.type)

    if (!this.isConnectionGuardCurrent(guard)) return {}
    channel = channelService.getChannel(channelId)
    if (!channel || channel.agentId !== guard.agentId || !canConnectChannel(channel)) return {}
    return { completion: this.connectChannelFromRow(channel, guard) }
  }

  private async disconnectOwnedAdapter(channelId: string, suppressErrors: boolean): Promise<boolean> {
    const ownership = this.adapters.get(channelId)
    if (!ownership) return true

    ownership.quarantined = true
    try {
      await ownership.adapter.disconnect()
      if (this.adapters.get(channelId) === ownership) this.adapters.delete(channelId)
      return true
    } catch (error) {
      if (!suppressErrors) throw error
      logger.warn('Error disconnecting adapter', {
        agentId: ownership.adapter.agentId,
        channelId,
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  private captureChannelConnectionGuard(channelId: string): ConnectionGuard | undefined {
    const channel = channelService.getChannel(channelId)
    const agentId = channel?.agentId ?? this.adapters.get(channelId)?.adapter.agentId
    return agentId ? this.captureConnectionGuard(agentId) : undefined
  }

  private captureAgentChannelIds(agentId: string): string[] {
    const channelIds = new Set(
      [...this.adapters.entries()]
        .filter(([, ownership]) => ownership.adapter.agentId === agentId)
        .map(([channelId]) => channelId)
    )
    try {
      for (const channel of channelService.listChannels({ agentId })) channelIds.add(channel.id)
    } catch (error) {
      logger.warn('Failed to list Agent channels for disconnect', {
        agentId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return [...channelIds]
  }

  private isOwnershipAtOrBeforeGuard(ownership: AdapterOwnership, guard: ConnectionGuard): boolean {
    return (
      ownership.guard.agentId === guard.agentId &&
      ownership.guard.managerGeneration <= guard.managerGeneration &&
      ownership.guard.agentGeneration <= guard.agentGeneration
    )
  }

  /** Disconnect the adapter for a single channel without reconnecting. */
  async disconnectChannel(channelId: string, options: { suppressErrors?: boolean } = {}): Promise<void> {
    const { suppressErrors = true } = options
    await this.channelTransitions.runExclusive(channelId, async () => {
      await this.disconnectOwnedAdapter(channelId, suppressErrors)
    })
  }

  /**
   * Sync a single channel: disconnect its adapter (if any) and reconnect if active.
   * Use this instead of disconnectAgent() when only one channel changed.
   */
  async syncChannel(
    channelId: string,
    options: { awaitConnect?: boolean; strictDisconnect?: boolean } = {}
  ): Promise<void> {
    const guard = this.captureChannelConnectionGuard(channelId)
    await this.syncChannelWithGuard(channelId, options, guard)
  }

  private async syncChannelWithGuard(
    channelId: string,
    options: { awaitConnect?: boolean; strictDisconnect?: boolean },
    lifecycleGuard: ConnectionGuard | undefined
  ): Promise<void> {
    const { awaitConnect = false, strictDisconnect = false } = options
    await this.runChannelTransition(channelId, awaitConnect, () =>
      this.replaceChannelAdapter(channelId, lifecycleGuard, strictDisconnect)
    )
  }

  /**
   * Disconnect all adapters for an agent without reconnecting.
   * Use when the agent is deleted or its channels should all be torn down.
   */
  async disconnectAgent(agentId: string): Promise<void> {
    const guard = this.captureConnectionGuard(agentId)
    const channelIds = this.captureAgentChannelIds(agentId)
    await this.disconnectAgentWithGuard(agentId, guard, channelIds)
  }

  private async disconnectAgentWithGuard(agentId: string, guard: ConnectionGuard, channelIds: string[]): Promise<void> {
    await Promise.all(
      channelIds.map((channelId) =>
        this.channelTransitions.runExclusive(channelId, async () => {
          const ownership = this.adapters.get(channelId)
          if (ownership?.adapter.agentId !== agentId) return
          if (!this.isOwnershipAtOrBeforeGuard(ownership, guard)) return
          await this.disconnectOwnedAdapter(channelId, true)
        })
      )
    )

    channelMessageHandler.clearSessionTracker(agentId)
  }

  private async restoreAgentChannels(agentId: string, guard: ConnectionGuard): Promise<void> {
    if (!this.isConnectionGuardCurrent(guard)) return
    const channels = channelService.listChannels({ agentId })
    await Promise.all(channels.map((channel) => this.syncChannelWithGuard(channel.id, { awaitConnect: true }, guard)))
  }

  private runAgentLifecycleAction(
    action: 'trashed' | 'restored' | 'purged',
    agentId: string,
    work: () => Promise<void>
  ): void {
    const previous = this.agentLifecycleTasks.get(agentId) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(work)
    this.agentLifecycleTasks.set(agentId, task)
    void task
      .catch((error) => {
        logger.error('Failed to handle Agent lifecycle action for channels', { action, agentId, error })
      })
      .finally(() => {
        if (this.agentLifecycleTasks.get(agentId) === task) this.agentLifecycleTasks.delete(agentId)
      })
  }

  private invalidateAgentLifecycle(agentId: string): number {
    const generation = (this.agentLifecycleGenerations.get(agentId) ?? 0) + 1
    this.agentLifecycleGenerations.set(agentId, generation)
    return generation
  }

  private captureConnectionGuard(
    agentId: string,
    managerGeneration = this.managerGeneration,
    agentGeneration = this.agentLifecycleGenerations.get(agentId) ?? 0
  ): ConnectionGuard {
    return { managerGeneration, agentGeneration, agentId }
  }

  private isConnectionGuardCurrent(guard: ConnectionGuard): boolean {
    return (
      this.acceptingConnections &&
      this.managerGeneration === guard.managerGeneration &&
      (this.agentLifecycleGenerations.get(guard.agentId) ?? 0) === guard.agentGeneration
    )
  }

  private isAdapterEventCurrent(channelId: string, ownership: AdapterOwnership): boolean {
    return (
      this.adapters.get(channelId) === ownership &&
      !ownership.quarantined &&
      this.isConnectionGuardCurrent(ownership.guard)
    )
  }

  private async waitForAgentLifecycleActions(): Promise<void> {
    while (this.agentLifecycleTasks.size > 0) {
      await Promise.allSettled(this.agentLifecycleTasks.values())
    }
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
    const channel = channelService.getChannel(channelId)
    if (!channel) return

    const config = channel.config as ChannelConfig & Record<string, unknown>
    channelService.updateChannel(channelId, {
      config: { ...config, app_id: creds.appId, app_secret: creds.appSecret } as ChannelConfig
    })

    logger.info('Saved QR registration credentials, reconnecting', { agentId, channelId })
    await this.syncChannel(channelId)
  }

  private async connectChannelFromRow(row: ChannelRow, guard: ConnectionGuard): Promise<void> {
    const agentId = row.agentId
    if (!agentId || !this.isConnectionGuardCurrent(guard)) return

    const factory = adapterFactories.get(row.type)
    if (!factory) {
      logger.warn('No adapter factory for channel type', { type: row.type, agentId })
      return
    }

    const key = row.id
    try {
      const adapter = factory(row, agentId)
      const ownership: AdapterOwnership = { adapter, guard, quarantined: false }

      // Seed notifyChatIds from DB-persisted activeChatIds (when allowed_chat_ids is empty)
      const hasAllowedIds = adapter.notifyChatIds.length > 0
      if (!hasAllowedIds) {
        const dbChatIds = row.activeChatIds ?? []
        adapter.notifyChatIds = [...dbChatIds]
      }

      const trackChatId = (chatId: string) => {
        if (hasAllowedIds) return
        if (adapter.notifyChatIds.includes(chatId)) return
        adapter.notifyChatIds.push(chatId)
        try {
          channelService.addActiveChatId(row.id, chatId)
        } catch (err) {
          logger.warn('Failed to persist activeChatId', {
            channelId: row.id,
            chatId,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }

      adapter.on('message', (msg) => {
        if (!this.isAdapterEventCurrent(key, ownership)) return
        // Write-quiesce intake gate — also skips trackChatId's `activeChatIds` DB write. The
        // handler's own gate is defense in depth; this one stops the config write too.
        if (channelMessageHandler.isWriteQuiesced) {
          logger.warn('Channel message dropped: intake is write-quiesced', { agentId, channelId: row.id })
          return
        }
        trackChatId(msg.chatId)
        channelMessageHandler.handleIncoming(adapter, msg).catch((err) => {
          logger.error('Unhandled error in message handler', {
            agentId,
            channelId: row.id,
            error: err instanceof Error ? err.message : String(err)
          })
          adapter
            .sendMessage(msg.chatId, t('common.channel_message_processing_error'), {
              replyToMessageId: msg.messageId,
              ...(msg.replyInThread && { replyInThread: true })
            })
            .catch(() => {})
        })
      })

      adapter.on('command', (cmd) => {
        if (!this.isAdapterEventCurrent(key, ownership)) return
        if (channelMessageHandler.isWriteQuiesced) {
          logger.warn('Channel command dropped: intake is write-quiesced', { agentId, channelId: row.id })
          return
        }
        trackChatId(cmd.chatId)
        channelMessageHandler.handleCommand(adapter, cmd).catch((err) => {
          logger.error('Unhandled error in command handler', {
            agentId,
            channelId: row.id,
            error: err instanceof Error ? err.message : String(err)
          })
          adapter
            .sendMessage(cmd.chatId, t('common.channel_command_processing_error'), {
              replyToMessageId: cmd.messageId,
              ...(cmd.replyInThread && { replyInThread: true })
            })
            .catch(() => {})
        })
      })

      // Forward QR events to any pending waiters
      adapter.on('qr', (url) => {
        if (!this.isAdapterEventCurrent(key, ownership)) return
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
        if (!this.isAdapterEventCurrent(key, ownership)) return
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
        if (!this.isAdapterEventCurrent(key, ownership)) return
        this.channelLogs.append(entry.channelId, entry)
        this.sendToRenderer('channel.log', entry)
      })

      adapter.on('statusChange', (status) => {
        if (!this.isAdapterEventCurrent(key, ownership)) return
        this.channelStatuses.set(status.channelId, status)
        this.sendToRenderer('channel.status_changed', status)
      })

      // Register adapter immediately so it's discoverable. Callers can either
      // await connect for strict workflows or leave it in the background.
      this.adapters.set(key, ownership)

      const connect = async () => {
        try {
          await adapter.connect()
          const current = channelService.getChannel(row.id)
          if (
            !this.isAdapterEventCurrent(key, ownership) ||
            !current ||
            current.agentId !== agentId ||
            !canConnectChannel(current)
          ) {
            await this.disconnectOwnedAdapter(key, true)
            return
          }
          logger.info('Channel adapter connected', { agentId, channelId: row.id, type: row.type })
        } catch (error) {
          if (this.adapters.get(key) === ownership) this.adapters.delete(key)
          logger.error('Failed to connect channel adapter', {
            agentId,
            channelId: row.id,
            type: row.type,
            error: error instanceof Error ? error.message : String(error)
          })
          throw error
        }
      }

      await connect()
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
      throw error
    }
  }
}
