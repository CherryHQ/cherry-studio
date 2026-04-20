import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { channelService } from '../../ChannelService'
import { ChannelAdapter, type ChannelAdapterConfig } from '../ChannelAdapter'
import { channelManager, registerAdapterFactory } from '../ChannelManager'
import { channelMessageHandler } from '../ChannelMessageHandler'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@main/services/MainWindowService', () => ({
  windowService: {
    getMainWindow: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../ChannelService', () => ({
  channelService: {
    listChannels: vi.fn().mockResolvedValue([]),
    getChannel: vi.fn(),
    updateChannel: vi.fn()
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

  protected async performConnect(): Promise<void> {}
  protected async performDisconnect(): Promise<void> {}

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
        channelType: channel.type,
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

  const makeChannelRow = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'ch-1',
      type: 'telegram',
      name: 'Test',
      agentId: 'agent-1',
      sessionId: null,
      config: { bot_token: 'tok', allowed_chat_ids: [] },
      isActive: true,
      permissionMode: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides
    }) as any

  it('start() with no channels does not error', async () => {
    vi.mocked(channelService.listChannels).mockResolvedValueOnce([])
    await expect(channelManager.start()).resolves.not.toThrow()
    expect(createdAdapters).toHaveLength(0)
  })

  it('start() connects adapters for active channels', async () => {
    vi.mocked(channelService.listChannels).mockResolvedValueOnce([makeChannelRow()])

    await channelManager.start()

    expect(createdAdapters).toHaveLength(1)
    expect(createdAdapters[0].connect).toHaveBeenCalledTimes(1)
  })

  it('stop() disconnects all adapters', async () => {
    vi.mocked(channelService.listChannels).mockResolvedValueOnce([
      makeChannelRow({ id: 'ch-1', config: { bot_token: 'tok' } }),
      makeChannelRow({ id: 'ch-2', config: { bot_token: 'tok2' } })
    ])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)
    createdAdapters.forEach((a) => expect(a.connect).toHaveBeenCalledTimes(1))

    await channelManager.stop()
    createdAdapters.forEach((a) => expect(a.disconnect).toHaveBeenCalledTimes(1))
  })

  it('disconnectAgent disconnects all adapters for agent and clears session tracker', async () => {
    vi.mocked(channelService.listChannels).mockResolvedValueOnce([
      makeChannelRow({ id: 'ch-1', config: { bot_token: 'tok1' } }),
      makeChannelRow({ id: 'ch-2', config: { bot_token: 'tok2' } })
    ])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)

    await channelManager.disconnectAgent('agent-1')

    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters[1].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters).toHaveLength(2) // no new adapters created
    expect(channelMessageHandler.clearSessionTracker).toHaveBeenCalledWith('agent-1')
  })

  it('disconnectAgent for unknown agent is a no-op', async () => {
    vi.mocked(channelService.listChannels).mockResolvedValueOnce([makeChannelRow()])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(1)

    await channelManager.disconnectAgent('unknown-agent')

    expect(createdAdapters[0].disconnect).not.toHaveBeenCalled()
  })

  it('disconnectChannel only disconnects the target channel without reconnecting', async () => {
    vi.mocked(channelService.listChannels).mockResolvedValueOnce([
      makeChannelRow({ id: 'ch-1', config: { bot_token: 'tok1' } }),
      makeChannelRow({ id: 'ch-2', config: { bot_token: 'tok2' } })
    ])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)

    await channelManager.disconnectChannel('ch-1')

    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters[1].disconnect).not.toHaveBeenCalled()
    // No new adapter created — disconnect only
    expect(createdAdapters).toHaveLength(2)
  })

  it('syncChannel only disconnects the target channel, leaving others untouched', async () => {
    vi.mocked(channelService.listChannels).mockResolvedValueOnce([
      makeChannelRow({ id: 'ch-1', config: { bot_token: 'tok1' } }),
      makeChannelRow({ id: 'ch-2', config: { bot_token: 'tok2' } })
    ])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)

    // Toggle ch-1 inactive — syncChannel should only disconnect ch-1
    vi.mocked(channelService.getChannel).mockResolvedValueOnce(makeChannelRow({ id: 'ch-1', isActive: false }))

    await channelManager.syncChannel('ch-1')

    // ch-1 disconnected, ch-2 untouched
    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters[1].disconnect).not.toHaveBeenCalled()
    // No new adapter created since ch-1 is inactive
    expect(createdAdapters).toHaveLength(2)
  })

  it('syncChannel reconnects the channel when toggled active', async () => {
    vi.mocked(channelService.listChannels).mockResolvedValueOnce([
      makeChannelRow({ id: 'ch-1', config: { bot_token: 'tok1' } }),
      makeChannelRow({ id: 'ch-2', config: { bot_token: 'tok2' } })
    ])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)

    // Toggle ch-1 with updated config — syncChannel reconnects only ch-1
    vi.mocked(channelService.getChannel).mockResolvedValueOnce(
      makeChannelRow({ id: 'ch-1', isActive: true, config: { bot_token: 'new-tok' } })
    )

    await channelManager.syncChannel('ch-1')

    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters[1].disconnect).not.toHaveBeenCalled()
    // New adapter created for ch-1
    expect(createdAdapters).toHaveLength(3)
    expect(createdAdapters[2].connect).toHaveBeenCalledTimes(1)
  })

  it('inactive channels are skipped', async () => {
    vi.mocked(channelService.listChannels).mockResolvedValueOnce([makeChannelRow({ isActive: false })])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(0)
  })
})
