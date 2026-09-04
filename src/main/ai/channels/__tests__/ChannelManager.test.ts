import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChannelAdapter, type ChannelAdapterConfig } from '../ChannelAdapter'
import { ChannelManager, registerAdapterFactory } from '../ChannelManager'
import { channelMessageHandler } from '../ChannelMessageHandler'

const mocks = vi.hoisted(() => ({
  getLifecycleState: vi.fn(),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    silly: vi.fn()
  },
  trashedListeners: new Set<(event: { agentId: string }) => void>(),
  restoredListeners: new Set<(event: { agentId: string }) => void>(),
  purgedListeners: new Set<(event: { agentId: string }) => void>()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    getLifecycleState: mocks.getLifecycleState,
    onAgentTrashed: (listener: (event: { agentId: string }) => void) => {
      mocks.trashedListeners.add(listener)
      return { dispose: () => mocks.trashedListeners.delete(listener) }
    },
    onAgentRestored: (listener: (event: { agentId: string }) => void) => {
      mocks.restoredListeners.add(listener)
      return { dispose: () => mocks.restoredListeners.delete(listener) }
    },
    onAgentPurged: (listener: (event: { agentId: string }) => void) => {
      mocks.purgedListeners.add(listener)
      return { dispose: () => mocks.purgedListeners.delete(listener) }
    }
  }
}))

vi.mock('@main/services/MainWindowService', () => ({
  windowService: {
    getMainWindow: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    listChannels: vi.fn().mockReturnValue([]),
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
let channelManager: ChannelManager
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const createDeferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('ChannelManager', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.trashedListeners.clear()
    mocks.restoredListeners.clear()
    mocks.purgedListeners.clear()
    mocks.getLifecycleState.mockReturnValue('active')
    vi.mocked(channelService.listChannels).mockReturnValue([])
    vi.mocked(channelService.getChannel).mockReturnValue(null)
    createdAdapters = []
    channelManager = new ChannelManager()
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
    await channelManager._doStop()
    BaseService.resetInstances()
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

  const mockStoredChannels = (channels: ReturnType<typeof makeChannelRow>[]) => {
    vi.mocked(channelService.listChannels).mockReturnValue(channels)
    vi.mocked(channelService.getChannel).mockImplementation(
      (channelId) => channels.find((channel) => channel.id === channelId) ?? null
    )
  }

  it('start() with no channels does not error', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([])
    await expect(channelManager.start()).resolves.not.toThrow()
    expect(createdAdapters).toHaveLength(0)
  })

  it('start() connects adapters for active channels', async () => {
    mockStoredChannels([makeChannelRow()])

    await channelManager.start()

    expect(createdAdapters).toHaveLength(1)
    expect(createdAdapters[0].connect).toHaveBeenCalledTimes(1)
  })

  it('start() skips an active channel whose Agent is not active', async () => {
    mockStoredChannels([makeChannelRow()])
    mocks.getLifecycleState.mockReturnValue('trashed')

    await channelManager.start()

    expect(createdAdapters).toHaveLength(0)
  })

  it('stop() disconnects all adapters', async () => {
    mockStoredChannels([
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
    mockStoredChannels([
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
    mockStoredChannels([makeChannelRow()])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(1)

    await channelManager.disconnectAgent('unknown-agent')

    expect(createdAdapters[0].disconnect).not.toHaveBeenCalled()
  })

  it('disconnectChannel only disconnects the target channel without reconnecting', async () => {
    mockStoredChannels([
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
    const channels = [
      makeChannelRow({ id: 'ch-1', config: { bot_token: 'tok1' } }),
      makeChannelRow({ id: 'ch-2', config: { bot_token: 'tok2' } })
    ]
    mockStoredChannels(channels)

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)

    // Toggle ch-1 inactive — syncChannel should only disconnect ch-1
    channels[0] = makeChannelRow({ id: 'ch-1', isActive: false })

    await channelManager.syncChannel('ch-1')

    // ch-1 disconnected, ch-2 untouched
    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters[1].disconnect).not.toHaveBeenCalled()
    // No new adapter created since ch-1 is inactive
    expect(createdAdapters).toHaveLength(2)
  })

  it('syncChannel reconnects the channel when toggled active', async () => {
    const channels = [
      makeChannelRow({ id: 'ch-1', config: { bot_token: 'tok1' } }),
      makeChannelRow({ id: 'ch-2', config: { bot_token: 'tok2' } })
    ]
    mockStoredChannels(channels)

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)

    // Toggle ch-1 with updated config — syncChannel reconnects only ch-1
    channels[0] = makeChannelRow({ id: 'ch-1', isActive: true, config: { bot_token: 'new-tok' } })

    await channelManager.syncChannel('ch-1')

    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters[1].disconnect).not.toHaveBeenCalled()
    // New adapter created for ch-1
    expect(createdAdapters).toHaveLength(3)
    expect(createdAdapters[2].connect).toHaveBeenCalledTimes(1)
  })

  it('syncChannel disconnects without reconnecting when the owning Agent is not active', async () => {
    mockStoredChannels([makeChannelRow()])
    await channelManager.start()
    expect(createdAdapters).toHaveLength(1)
    mocks.getLifecycleState.mockReturnValue('missing')

    await channelManager.syncChannel('ch-1')

    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters).toHaveLength(1)
  })

  it.each([
    ['trashed', mocks.trashedListeners],
    ['purged', mocks.purgedListeners]
  ])('disconnects Agent adapters and clears tracking when the Agent is %s', async (_action, listeners) => {
    mockStoredChannels([makeChannelRow()])
    await channelManager._doInit()
    expect(createdAdapters).toHaveLength(1)

    for (const listener of listeners) listener({ agentId: 'agent-1' })
    await vi.waitFor(() => {
      expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
      expect(channelMessageHandler.clearSessionTracker).toHaveBeenCalledWith('agent-1')
    })

    expect(channelService.updateChannel).not.toHaveBeenCalled()
  })

  it('restores only active channel rows for an active Agent', async () => {
    const active = makeChannelRow({ id: 'ch-active' })
    const inactive = makeChannelRow({ id: 'ch-inactive', isActive: false })
    vi.mocked(channelService.listChannels).mockReturnValueOnce([]).mockReturnValueOnce([active, inactive])
    vi.mocked(channelService.getChannel).mockImplementation((channelId) =>
      channelId === active.id ? active : channelId === inactive.id ? inactive : null
    )
    await channelManager._doInit()

    for (const listener of mocks.restoredListeners) listener({ agentId: 'agent-1' })
    await vi.waitFor(() => expect(createdAdapters).toHaveLength(1))

    expect(channelService.listChannels).toHaveBeenLastCalledWith({ agentId: 'agent-1' })
    expect(createdAdapters[0].channelId).toBe('ch-active')
    expect(createdAdapters[0].connect).toHaveBeenCalledTimes(1)
    expect(channelService.updateChannel).not.toHaveBeenCalled()
  })

  it('disconnects a restored channel whose Agent is trashed while connect is in flight', async () => {
    const channel = makeChannelRow()
    const connectDeferred = createDeferred()
    let transportConnected = false
    vi.mocked(channelService.listChannels).mockReturnValueOnce([]).mockReturnValueOnce([channel])
    vi.mocked(channelService.getChannel).mockReturnValue(channel)
    registerAdapterFactory('telegram', (channel, agentId) => {
      const adapter = new MockAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
      adapter.connect.mockImplementation(async () => {
        await connectDeferred.promise
        transportConnected = true
      })
      adapter.disconnect.mockImplementation(async () => {
        transportConnected = false
      })
      createdAdapters.push(adapter)
      return adapter
    })
    await channelManager._doInit()

    for (const listener of mocks.restoredListeners) listener({ agentId: 'agent-1' })
    await vi.waitFor(() => expect(createdAdapters[0].connect).toHaveBeenCalledTimes(1))

    mocks.getLifecycleState.mockReturnValue('trashed')
    for (const listener of mocks.trashedListeners) listener({ agentId: 'agent-1' })

    connectDeferred.resolve()
    await flush()

    expect(transportConnected).toBe(false)
    expect(channelManager.getAdapter('ch-1')).toBeUndefined()
  })

  it('does not let a stale trash disconnect remove the adapter created by a later restore', async () => {
    const channel = makeChannelRow()
    const disconnectDeferred = createDeferred()
    vi.mocked(channelService.listChannels).mockReturnValueOnce([channel]).mockReturnValue([channel])
    vi.mocked(channelService.getChannel).mockReturnValue(channel)
    await channelManager._doInit()
    createdAdapters[0].disconnect.mockImplementationOnce(() => disconnectDeferred.promise)

    mocks.getLifecycleState.mockReturnValue('trashed')
    for (const listener of mocks.trashedListeners) listener({ agentId: 'agent-1' })
    await vi.waitFor(() => expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1))

    mocks.getLifecycleState.mockReturnValue('active')
    for (const listener of mocks.restoredListeners) listener({ agentId: 'agent-1' })

    disconnectDeferred.resolve()
    await flush()

    expect(createdAdapters).toHaveLength(2)
    expect(channelManager.getAdapter('ch-1')).toBe(createdAdapters[1])
  })

  it('does not leave an in-flight Agent restore connected after the manager stops', async () => {
    const channel = makeChannelRow()
    const connectDeferred = createDeferred()
    let transportConnected = false
    vi.mocked(channelService.listChannels).mockReturnValueOnce([]).mockReturnValueOnce([channel])
    vi.mocked(channelService.getChannel).mockReturnValue(channel)
    registerAdapterFactory('telegram', (channel, agentId) => {
      const adapter = new MockAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
      adapter.connect.mockImplementation(async () => {
        await connectDeferred.promise
        transportConnected = true
      })
      adapter.disconnect.mockImplementation(async () => {
        transportConnected = false
      })
      createdAdapters.push(adapter)
      return adapter
    })
    await channelManager._doInit()

    for (const listener of mocks.restoredListeners) listener({ agentId: 'agent-1' })
    await vi.waitFor(() => expect(createdAdapters[0].connect).toHaveBeenCalledTimes(1))

    const stop = channelManager._doStop()
    connectDeferred.resolve()
    await stop
    await flush()

    expect(transportConnected).toBe(false)
    expect(channelManager.getAdapter('ch-1')).toBeUndefined()
  })

  it('logs Agent lifecycle failures without throwing from the event listener', async () => {
    const error = new Error('restore channels failed')
    vi.mocked(channelService.listChannels)
      .mockReturnValueOnce([])
      .mockImplementationOnce(() => {
        throw error
      })
    await channelManager._doInit()

    expect(() => {
      for (const listener of mocks.restoredListeners) listener({ agentId: 'agent-1' })
    }).not.toThrow()
    await flush()

    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ action: 'restored', agentId: 'agent-1', error })
    )
  })

  it('inactive channels are skipped', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow({ isActive: false })])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(0)
  })
})
