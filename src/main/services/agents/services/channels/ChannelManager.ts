import { application } from '@application'
import type { AgentChannelRow as ChannelRow } from '@data/db/schemas/agentChannel'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { loggerService } from '@logger'
import { WindowType } from '@main/core/window/types'
import type { ChannelLogEntry, ChannelStatusEvent } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'

import type { ChannelAdapter } from './ChannelAdapter'
import type { ChannelConfig } from './channelConfig'
import { ChannelLogBuffer } from './ChannelLogBuffer'
import { channelMessageHandler } from './ChannelMessageHandler'

const logger = loggerService.withContext('ChannelManager')

// Adapter factory registry -- adapters register themselves here
type AdapterFactory = (channel: ChannelRow, agentId: string) => ChannelAdapter
const adapterFactories = new Map<string, AdapterFactory>()

export function registerAdapterFactory(type: string, factory: AdapterFactory): void {
  adapterFactories.set(type, factory)
}

/**
 * Lazy-load map: adapter type → dynamic import of the adapter module.
 * Each module registers itself via `registerAdapterFactory()` as a side effect.
 * This avoids eagerly importing all 6 heavy adapter modules at startup.
 */
const adapterImportMap: Record<string, () => Promise<unknown>> = {
  discord: () => import('./adapters/discord/DiscordAdapter'),
  feishu: () => import('./adapters/feishu/FeishuAdapter'),
  qq: () => import('./adapters/qq/QQAdapter'),
  slack: () => import('./adapters/slack/SlackAdapter'),
  telegram: () => import('./adapters/telegram/TelegramAdapter'),
  wechat: () => import('./adapters/wechat/WeChatAdapter')
}

/** Ensure the adapter factory for the given type is loaded (idempotent). */
async function ensureAdapterLoaded(type: string): Promise<void> {
  if (adapterFactories.has(type)) return
  const loader = adapterImportMap[type]
  if (!loader) return
  await loader()
}

class ChannelManager {
  private static instance: ChannelManager | null = null
  private readonly adapters = new Map<string, ChannelAdapter>() // key: `${agentId}:${channelId}`
  private readonly qrWaiters = new Map<
    string,
    { resolve: (url: string) => void; timer: ReturnType<typeof setTimeout> }
  >()
  private readonly channelLogs = new ChannelLogBuffer()
  private readonly channelStatuses = new Map<string, ChannelStatusEvent>()

  static getInstance(): ChannelManager {
    if (!ChannelManager.instance) {
      ChannelManager.instance = new ChannelManager()
    }
    return ChannelManager.instance
  }

  async start(): Promise<void> {
    let channels: Awaited<ReturnType<typeof channelService.listChannels>>
    try {
      channels = await channelService.listChannels()
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

  private sendToRenderer(channel: string, data: unknown): void {
    application.get('WindowManager').broadcastToType(WindowType.Main, channel, data)
  }

  /** Disconnect the adapter for a single channel without reconnecting. */
  async disconnectChannel(channelId: string): Promise<void> {
    for (const [key, adapter] of this.adapters) {
      if (adapter.channelId === channelId) {
        await adapter.disconnect().catch((err) => {
          logger.warn('Error disconnecting adapter', {
            key,
            error: err instanceof Error ? err.message : String(err)
          })
        })
        this.adapters.delete(key)
      }
    }
  }

  /**
   * Sync a single channel: disconnect its adapter (if any) and reconnect if active.
   * Use this instead of disconnectAgent() when only one channel changed.
   */
  async syncChannel(channelId: string): Promise<void> {
    await this.disconnectChannel(channelId)

    // Re-read from DB and reconnect if active
    const channel = await channelService.getChannel(channelId)
    if (channel && channel.isActive && channel.agentId) {
      await ensureAdapterLoaded(channel.type)
      await this.connectChannelFromRow(channel)
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
    const channel = await channelService.getChannel(channelId)
    if (!channel) return

    const config = channel.config as ChannelConfig & Record<string, unknown>
    await channelService.updateChannel(channelId, {
      config: { ...config, app_id: creds.appId, app_secret: creds.appSecret } as ChannelConfig
    })

    logger.info('Saved QR registration credentials, reconnecting', { agentId, channelId })
    await this.syncChannel(channelId)
  }

  private async connectChannelFromRow(row: ChannelRow): Promise<void> {
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
        channelService.addActiveChatId(row.id, chatId).catch((err) => {
          logger.warn('Failed to persist activeChatId', {
            channelId: row.id,
            chatId,
            error: err instanceof Error ? err.message : String(err)
          })
        })
      }

      adapter.on('message', (msg) => {
        trackChatId(msg.chatId)
        channelMessageHandler.handleIncoming(adapter, msg).catch((err) => {
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
        trackChatId(cmd.chatId)
        channelMessageHandler.handleCommand(adapter, cmd).catch((err) => {
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
        this.sendToRenderer(IpcChannel.Channel_Log, entry)
      })

      adapter.on('statusChange', (status) => {
        this.channelStatuses.set(status.channelId, status)
        this.sendToRenderer(IpcChannel.Channel_StatusChange, status)
      })

      // Register adapter immediately so it's discoverable, then connect in background.
      // Network I/O (WebSocket handshake, HTTP auth) should not block startup.
      this.adapters.set(key, adapter)
      adapter.connect().then(
        () => logger.info('Channel adapter connected', { agentId, channelId: row.id, type: row.type }),
        (error) =>
          logger.error('Failed to connect channel adapter', {
            agentId,
            channelId: row.id,
            type: row.type,
            error: error instanceof Error ? error.message : String(error)
          })
      )
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
      this.sendToRenderer(IpcChannel.Channel_StatusChange, errorStatus)
    }
  }
}

export const channelManager = ChannelManager.getInstance()
