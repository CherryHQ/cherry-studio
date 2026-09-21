import { defaultServiceInstances } from '@test-mocks/main/application'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { BaseService, Injectable, ServiceContainer } from '@main/core/lifecycle'

import { ChannelAdapter, type ChannelAdapterConfig } from '../ChannelAdapter'
import { loadChannelAdapter } from '../channelAdapterLoader'
import { ChannelManager } from '../ChannelManager'
import { channelMessageHandler } from '../ChannelMessageHandler'

const mocks = vi.hoisted(() => ({
  getLifecycleState: vi.fn()
}))

vi.mock('../channelAdapterLoader', () => ({ loadChannelAdapter: vi.fn() }))

@Injectable('WindowManager')
class TestWindowManager {
  constructor() {
    Object.assign(this, defaultServiceInstances.WindowManager)
  }
}

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    getLifecycleState: mocks.getLifecycleState
  }
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    listChannels: vi.fn().mockReturnValue([]),
    getChannel: vi.fn(),
    updateChannel: vi.fn(),
    addActiveChatId: vi.fn()
  }
}))

vi.mock('../ChannelMessageHandler', () => ({
  channelMessageHandler: {
    isWriteQuiesced: false,
    handleIncoming: vi.fn().mockResolvedValue(undefined),
    handleCommand: vi.fn().mockResolvedValue(undefined),
    clearSessionTracker: vi.fn(),
    pause: vi.fn(),
    drainInFlight: vi.fn(),
    listActiveWork: vi.fn()
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

describe('ChannelManager', () => {
  let rows: any[]
  let adapters: MockAdapter[]
  let manager: ChannelManager
  let qrOnConnect: string | undefined

  const makeChannel = (overrides: Record<string, unknown> = {}) => ({
    id: 'ch-1',
    type: 'telegram' as const,
    name: 'Test',
    agentId: 'agent-1',
    sessionId: null,
    workspace: { type: 'system' as const },
    config: { bot_token: 'token', allowed_chat_ids: [] },
    isActive: true,
    activeChatIds: [],
    permissionMode: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  })

  beforeEach(() => {
    BaseService.resetInstances()
    ServiceContainer.reset()
    vi.clearAllMocks()
    mocks.getLifecycleState.mockReturnValue('active')
    rows = []
    adapters = []
    qrOnConnect = undefined
    vi.mocked(channelService.listChannels).mockImplementation((filters) =>
      filters?.agentId ? rows.filter((row) => row.agentId === filters.agentId) : rows
    )
    vi.mocked(channelService.getChannel).mockImplementation(
      (channelId) => rows.find((row) => row.id === channelId) ?? null
    )
    vi.mocked(loadChannelAdapter).mockImplementation(async (channel, agentId) => {
      const adapter = new MockAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
      adapter.connect.mockImplementation(async () => {
        if (qrOnConnect) adapter.emit('qr', qrOnConnect)
      })
      adapters.push(adapter)
      return adapter
    })
    const container = ServiceContainer.getInstance()
    container.register(TestWindowManager)
    container.register(ChannelManager)
    manager = container.get(ChannelManager)
  })

  afterEach(async () => {
    await manager._doStop()
    BaseService.resetInstances()
    ServiceContainer.reset()
  })

  it('connects only when both channel intent and Agent lifecycle are active', async () => {
    rows = [makeChannel(), makeChannel({ id: 'ch-paused', isActive: false })]
    mocks.getLifecycleState.mockImplementation((agentId) => (agentId === 'agent-1' ? 'active' : 'trashed'))

    await manager.start()
    await vi.waitFor(() => expect(adapters).toHaveLength(1))

    expect(adapters[0].channelId).toBe('ch-1')
    expect(adapters[0].connect).toHaveBeenCalledOnce()
  })

  it('treats archive and restore events as hints and preserves channel intent', async () => {
    rows = [makeChannel()]
    await manager._doInit()
    await vi.waitFor(() => expect(adapters).toHaveLength(1))

    mocks.getLifecycleState.mockReturnValue('trashed')
    manager.reconcileAgent('agent-1', true)
    await vi.waitFor(() => expect(adapters[0].disconnect).toHaveBeenCalledOnce())

    expect(rows[0].isActive).toBe(true)
    expect(rows[0].agentId).toBe('agent-1')
    expect(channelService.updateChannel).not.toHaveBeenCalled()
    expect(channelMessageHandler.clearSessionTracker).toHaveBeenCalledWith('agent-1')

    mocks.getLifecycleState.mockReturnValue('active')
    manager.reconcileAgent('agent-1')
    await vi.waitFor(() => expect(adapters).toHaveLength(2))
    expect(adapters[1].connect).toHaveBeenCalledOnce()
  })

  it('disconnects after purge even though the Agent foreign key was already cleared', async () => {
    rows = [makeChannel()]
    await manager._doInit()
    await vi.waitFor(() => expect(adapters).toHaveLength(1))

    rows[0] = makeChannel({ agentId: null })
    manager.reconcileAgent('agent-1', true)

    await vi.waitFor(() => expect(adapters[0].disconnect).toHaveBeenCalledOnce())
    expect(rows[0].isActive).toBe(true)
    expect(adapters).toHaveLength(1)
  })

  it('clears runtime state, status, logs, and adapters when the channel entity is deleted', async () => {
    rows = [makeChannel()]
    await manager.start()
    await vi.waitFor(() => expect(adapters).toHaveLength(1))
    adapters[0].emit('log', { timestamp: 1, level: 'info', message: 'connected', channelId: 'ch-1' })
    adapters[0].emit('statusChange', { channelId: 'ch-1', connected: true })
    expect(manager.getChannelLogs('ch-1')).toHaveLength(1)

    rows = []
    await manager.removeChannel('ch-1')

    expect(manager.getAdapter('ch-1')).toBeUndefined()
    expect(manager.getChannelLogs('ch-1')).toEqual([])
    expect(MockMainCacheServiceExport.cacheService.getShared('channel.status.ch-1')).toBeUndefined()
  })

  it('installs the QR waiter before starting reconciliation', async () => {
    rows = [makeChannel({ type: 'wechat', config: { token_path: '', allowed_chat_ids: [] } })]
    await manager.start()
    await vi.waitFor(() => expect(adapters).toHaveLength(1))

    qrOnConnect = 'https://example.com/qr'
    await expect(manager.waitForQrAndReconcile('agent-1', 'ch-1')).resolves.toBe('https://example.com/qr')
  })
})
