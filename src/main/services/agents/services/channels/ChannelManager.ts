import { loggerService } from '@logger'
import type { CherryClawChannel, CherryClawConfiguration } from '@types'

import { agentService } from '../AgentService'
import { channelRateLimiter } from '../security'
import type { ChannelAdapter } from './ChannelAdapter'
import { channelMessageHandler } from './ChannelMessageHandler'

const logger = loggerService.withContext('ChannelManager')

// Adapter factory registry -- adapters register themselves here
type AdapterFactory = (channelConfig: CherryClawChannel, agentId: string) => ChannelAdapter
const adapterFactories = new Map<string, AdapterFactory>()

export function registerAdapterFactory(type: string, factory: AdapterFactory): void {
  adapterFactories.set(type, factory)
}

class ChannelManager {
  private static instance: ChannelManager | null = null
  private readonly adapters = new Map<string, ChannelAdapter>() // key: `${agentId}:${channelId}`
  private readonly notifyChannels = new Set<string>() // key: `${agentId}:${channelId}`
  private readonly qrWaiters = new Map<
    string,
    { resolve: (url: string) => void; timer: ReturnType<typeof setTimeout> }
  >()

  static getInstance(): ChannelManager {
    if (!ChannelManager.instance) {
      ChannelManager.instance = new ChannelManager()
    }
    return ChannelManager.instance
  }

  async start(): Promise<void> {
    logger.info('Starting channel manager')
    channelRateLimiter.start()
    try {
      const { agents } = await agentService.listAgents()
      const agentsWithChannels = agents.filter((a) => {
        const config = a.configuration as CherryClawConfiguration | undefined
        return config?.channels && config.channels.length > 0
      })

      for (const agent of agentsWithChannels) {
        await this.startAgentChannels(agent.id, (agent.configuration as CherryClawConfiguration)?.channels)
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
    channelRateLimiter.stop()
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
    this.notifyChannels.clear()
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

  /** Return connected adapters for an agent whose channel has `is_notify_receiver: true`. */
  getNotifyAdapters(agentId: string): ChannelAdapter[] {
    const result: ChannelAdapter[] = []
    for (const [key, adapter] of this.adapters) {
      if (adapter.agentId !== agentId) continue
      // Look up original channel config to check is_notify_receiver
      const channelId = key.split(':')[1]
      if (this.notifyChannels.has(`${agentId}:${channelId}`)) {
        result.push(adapter)
      }
    }
    return result
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
            this.notifyChannels.delete(key)
          })
      )
    )

    channelMessageHandler.clearSessionTracker(agentId)

    // Re-create from current config (agent may have been deleted)
    const agent = await agentService.getAgent(agentId)
    if (!agent) return

    const config = agent.configuration as CherryClawConfiguration | undefined
    if (!config?.channels?.length) return

    await this.startAgentChannels(agentId, config.channels)
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
    const agent = await agentService.getAgent(agentId)
    if (!agent) return

    const config = agent.configuration as CherryClawConfiguration | undefined
    const channels = [...(config?.channels ?? [])]
    const idx = channels.findIndex((ch) => ch.id === channelId)
    if (idx === -1) return

    channels[idx] = {
      ...channels[idx],
      config: { ...channels[idx].config, app_id: creds.appId, app_secret: creds.appSecret }
    }

    await agentService.updateAgent(agentId, {
      configuration: { ...config, channels } as CherryClawConfiguration
    })

    logger.info('Saved QR registration credentials, reconnecting', { agentId, channelId })
    await this.syncAgent(agentId)
  }

  private async startAgentChannels(agentId: string, channels?: CherryClawChannel[]): Promise<void> {
    if (!channels || channels.length === 0) return

    const connectTasks = channels
      .filter((channel) => channel.enabled !== false)
      .map((channel) => this.connectChannel(agentId, channel))

    // Connect all channels in parallel so one blocking login doesn't stall others
    await Promise.all(connectTasks)
  }

  private async connectChannel(agentId: string, channel: CherryClawChannel): Promise<void> {
    const factory = adapterFactories.get(channel.type)
    if (!factory) {
      logger.warn('No adapter factory for channel type', { type: channel.type, agentId })
      return
    }

    const key = `${agentId}:${channel.id}`
    try {
      const adapter = factory(channel, agentId)

      adapter.on('message', (msg) => {
        channelMessageHandler.handleIncoming(adapter, msg).catch((err) => {
          logger.error('Unhandled error in message handler', {
            agentId,
            channelId: channel.id,
            error: err instanceof Error ? err.message : String(err)
          })
        })
      })

      adapter.on('command', (cmd) => {
        channelMessageHandler.handleCommand(adapter, cmd).catch((err) => {
          logger.error('Unhandled error in command handler', {
            agentId,
            channelId: channel.id,
            error: err instanceof Error ? err.message : String(err)
          })
        })
      })

      // Forward QR events to any pending waiters
      adapter.on('qr', (url) => {
        const waiterKey = `${agentId}:${channel.id}`
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
        this.saveCredentialsAndReconnect(agentId, channel.id, creds).catch((err) => {
          logger.error('Failed to save credentials and reconnect', {
            agentId,
            channelId: channel.id,
            error: err instanceof Error ? err.message : String(err)
          })
        })
      })

      await adapter.connect()
      this.adapters.set(key, adapter)
      if (channel.is_notify_receiver) {
        this.notifyChannels.add(key)
      }
      logger.info('Channel adapter connected', { agentId, channelId: channel.id, type: channel.type })
    } catch (error) {
      logger.error('Failed to connect channel adapter', {
        agentId,
        channelId: channel.id,
        type: channel.type,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

export const channelManager = ChannelManager.getInstance()
