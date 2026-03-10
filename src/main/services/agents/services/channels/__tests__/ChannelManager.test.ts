import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentService } from '../../AgentService'
import { ChannelAdapter, type ChannelAdapterConfig } from '../ChannelAdapter'
import { channelManager, registerAdapterFactory } from '../ChannelManager'
import { channelMessageHandler } from '../ChannelMessageHandler'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('../../AgentService', () => ({
  agentService: {
    listAgents: vi.fn().mockResolvedValue({ agents: [], total: 0 }),
    getAgent: vi.fn()
  }
}))

vi.mock('../ChannelMessageHandler', () => ({
  channelMessageHandler: {
    handleIncoming: vi.fn(),
    handleCommand: vi.fn(),
    clearSessionTracker: vi.fn()
  }
}))

class MockAdapter extends ChannelAdapter {
  connect = vi.fn().mockResolvedValue(undefined)
  disconnect = vi.fn().mockResolvedValue(undefined)
  sendMessage = vi.fn().mockResolvedValue(undefined)
  sendTypingIndicator = vi.fn().mockResolvedValue(undefined)

  constructor(config: ChannelAdapterConfig) {
    super(config)
  }
}

// Track adapters created by the factory
let createdAdapters: MockAdapter[] = []

describe('ChannelManager', () => {
  beforeEach(async () => {
    // Defensively stop any leftover adapters from a previous failed test
    await channelManager.stop()
    vi.clearAllMocks()
    createdAdapters = []
    // Re-register the mock factory (the map persists across tests since we don't resetModules)
    registerAdapterFactory('telegram', (channel, agentId) => {
      const adapter = new MockAdapter({
        channelId: channel.id,
        agentId,
        channelConfig: channel.config
      })
      createdAdapters.push(adapter)
      return adapter
    })
  })

  afterEach(async () => {
    await channelManager.stop()
  })

  it('start() with no agents does not error', async () => {
    vi.mocked(agentService.listAgents).mockResolvedValueOnce({ agents: [] as any[], total: 0 })
    await expect(channelManager.start()).resolves.not.toThrow()
    expect(createdAdapters).toHaveLength(0)
  })

  it('start() connects adapters for agents with channels', async () => {
    vi.mocked(agentService.listAgents).mockResolvedValueOnce({
      agents: [
        {
          id: 'agent-1',
          type: 'cherry-claw',
          configuration: {
            channels: [
              {
                id: 'ch-1',
                type: 'telegram',
                enabled: true,
                config: { bot_token: 'tok', allowed_chat_ids: [] }
              }
            ]
          }
        }
      ] as any[],
      total: 1
    })

    await channelManager.start()

    expect(createdAdapters).toHaveLength(1)
    expect(createdAdapters[0].connect).toHaveBeenCalledTimes(1)
  })

  it('stop() disconnects all adapters', async () => {
    vi.mocked(agentService.listAgents).mockResolvedValueOnce({
      agents: [
        {
          id: 'agent-1',
          type: 'cherry-claw',
          configuration: {
            channels: [
              { id: 'ch-1', type: 'telegram', enabled: true, config: { bot_token: 'tok' } },
              { id: 'ch-2', type: 'telegram', enabled: true, config: { bot_token: 'tok2' } }
            ]
          }
        }
      ] as any[],
      total: 1
    })

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)
    createdAdapters.forEach((a) => expect(a.connect).toHaveBeenCalledTimes(1))

    await channelManager.stop()
    createdAdapters.forEach((a) => expect(a.disconnect).toHaveBeenCalledTimes(1))
  })

  it('syncAgent disconnects old and reconnects', async () => {
    vi.mocked(agentService.listAgents).mockResolvedValueOnce({
      agents: [
        {
          id: 'agent-1',
          type: 'cherry-claw',
          configuration: {
            channels: [{ id: 'ch-1', type: 'telegram', enabled: true, config: { bot_token: 'tok' } }]
          }
        }
      ] as any[],
      total: 1
    })

    await channelManager.start()
    expect(createdAdapters).toHaveLength(1)

    // Sync with updated config
    vi.mocked(agentService.getAgent).mockResolvedValueOnce({
      id: 'agent-1',
      type: 'cherry-claw',
      configuration: {
        channels: [{ id: 'ch-1', type: 'telegram', enabled: true, config: { bot_token: 'new-tok' } }]
      }
    } as any)

    await channelManager.syncAgent('agent-1')

    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters).toHaveLength(2) // new adapter created
    expect(createdAdapters[1].connect).toHaveBeenCalledTimes(1)
    expect(channelMessageHandler.clearSessionTracker).toHaveBeenCalledWith('agent-1')
  })

  it('syncAgent for deleted agent disconnects without reconnecting', async () => {
    vi.mocked(agentService.listAgents).mockResolvedValueOnce({
      agents: [
        {
          id: 'agent-1',
          type: 'cherry-claw',
          configuration: {
            channels: [{ id: 'ch-1', type: 'telegram', enabled: true, config: { bot_token: 'tok' } }]
          }
        }
      ] as any[],
      total: 1
    })

    await channelManager.start()
    expect(createdAdapters).toHaveLength(1)

    vi.mocked(agentService.getAgent).mockResolvedValueOnce(null as any)
    await channelManager.syncAgent('agent-1')

    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters).toHaveLength(1) // no new adapter
  })

  it('disabled channels are skipped', async () => {
    vi.mocked(agentService.listAgents).mockResolvedValueOnce({
      agents: [
        {
          id: 'agent-1',
          type: 'cherry-claw',
          configuration: {
            channels: [{ id: 'ch-1', type: 'telegram', enabled: false, config: { bot_token: 'tok' } }]
          }
        }
      ] as any[],
      total: 1
    })

    await channelManager.start()
    expect(createdAdapters).toHaveLength(0)
  })
})
