import { loggerService } from '@logger'
import type { CherryClawChannel, CherryClawConfiguration } from '@types'

import { agentService } from '../AgentService'
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

  static getInstance(): ChannelManager {
    if (!ChannelManager.instance) {
      ChannelManager.instance = new ChannelManager()
    }
    return ChannelManager.instance
  }

  async start(): Promise<void> {
    logger.info('Starting channel manager')
    try {
      const { agents } = await agentService.listAgents()
      const clawAgents = agents.filter((a) => a.type === 'cherry-claw')

      for (const agent of clawAgents) {
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

  async syncAgent(agentId: string): Promise<void> {
    // Disconnect existing adapters for this agent
    for (const [key, adapter] of this.adapters) {
      if (adapter.agentId === agentId) {
        await adapter.disconnect().catch((err) => {
          logger.warn('Error disconnecting adapter during sync', {
            key,
            error: err instanceof Error ? err.message : String(err)
          })
        })
        this.adapters.delete(key)
      }
    }

    channelMessageHandler.clearSessionTracker(agentId)

    // Re-create from current config (agent may have been deleted)
    const agent = await agentService.getAgent(agentId)
    if (!agent || agent.type !== 'cherry-claw') return

    const config = agent.configuration as CherryClawConfiguration
    await this.startAgentChannels(agentId, config?.channels)
  }

  private async startAgentChannels(agentId: string, channels?: CherryClawChannel[]): Promise<void> {
    if (!channels || channels.length === 0) return

    for (const channel of channels) {
      if (channel.enabled === false) continue

      const factory = adapterFactories.get(channel.type)
      if (!factory) {
        logger.warn('No adapter factory for channel type', { type: channel.type, agentId })
        continue
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

        await adapter.connect()
        this.adapters.set(key, adapter)
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
}

export const channelManager = ChannelManager.getInstance()
