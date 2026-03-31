import { loggerService } from '@logger'
import { windowService } from '@main/services/WindowService'
import type { ChannelLogEntry, ChannelStatusEvent } from '@shared/config/types'
import { IpcChannel } from '@shared/IpcChannel'

import type { ChannelConfig, ChannelRow } from '../../database/schema'
import { channelService } from '../ChannelService'
import type { ChannelAdapter } from './ChannelAdapter'
import { ChannelLogBuffer } from './ChannelLogBuffer'
import { channelMessageHandler } from './ChannelMessageHandler'

const logger = loggerService.withContext('ChannelManager')

// Adapter factory registry -- adapters register themselves here
type AdapterFactory = (channel: ChannelRow, agentId: string) => ChannelAdapter
const adapterFactories = new Map<string, AdapterFactory>()

export function registerAdapterFactory(type: string, factory: AdapterFactory): void {
  adapterFactories.set(type, factory)
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
    try {
      const channels = await channelService.listChannels()
      const activeChannels = channels.filter((ch) => ch.isActive && ch.agentId)

      for (const channel of activeChannels) {
        await this.connectChannelFromRow(channel)
      }

      logger.info('Channel manager started', { adapterCount: this.adapters.size })
    } catch (error) {
      logger.error('Failed to start channel manager', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
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
    const mainWindow = windowService.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  async syncAgent(agentId: string): Promise<void> {
    // Disconnect existing adapters for this agent in parallel
    const toDisconnect = [...this.adapters.entries()].filter(([, a]) => a.agentId === agentId)
    await Promise.all(
      toDisconnect.map(([key, adapter]) =>
        adapter
          .disconnect()
          .catch((err) => {
            logger.warn('Error disconnecting adapter during sync', {
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

    // Re-create from current DB rows
    const channels = await channelService.listChannels({ agentId })
    const activeChannels = channels.filter((ch) => ch.isActive)

    for (const channel of activeChannels) {
      await this.connectChannelFromRow(channel)
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
    const channel = await channelService.getChannel(channelId)
    if (!channel) return

    const config = channel.config as ChannelConfig & Record<string, unknown>
    await channelService.updateChannel(channelId, {
      config: { ...config, app_id: creds.appId, app_secret: creds.appSecret } as ChannelConfig
    })

    logger.info('Saved QR registration credentials, reconnecting', { agentId, channelId })
    await this.syncAgent(agentId)
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

      await adapter.connect()
      this.adapters.set(key, adapter)
      logger.info('Channel adapter connected', { agentId, channelId: row.id, type: row.type })
    } catch (error) {
      logger.error('Failed to connect channel adapter', {
        agentId,
        channelId: row.id,
        type: row.type,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

export const channelManager = ChannelManager.getInstance()
