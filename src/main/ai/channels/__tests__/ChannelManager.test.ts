import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChannelAdapter, type ChannelAdapterConfig } from '../ChannelAdapter'
import { ChannelManager, registerAdapterFactory } from '../ChannelManager'
import { channelMessageHandler } from '../ChannelMessageHandler'
import { ChannelTerminalDeliveryService } from '../ChannelTerminalDeliveryService'

// Real delivery service: these tests exercise FIFO, dedupe, the bounded send and drain, so a
// stub would assert nothing. Held indirectly because `vi.mock` factories are hoisted above
// module-level initialization; it resolves adapters back through the manager under test.
const holder = vi.hoisted(() => ({ manager: undefined as any, delivery: undefined as any }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    ChannelManager: { getAdapter: (channelId: string) => holder.manager?.getAdapter(channelId) },
    ChannelTerminalDeliveryService: {
      enqueue: (request: unknown) => holder.delivery.enqueue(request),
      open: () => holder.delivery.open(),
      block: (channelId: string) => holder.delivery.block(channelId),
      reopen: (channelId: string) => holder.delivery.reopen(channelId),
      close: () => holder.delivery.close(),
      drain: (channelIds?: ReadonlySet<string>) => holder.delivery.drain(channelIds)
    }
  } as never)
})

const channelManager = new ChannelManager()
holder.manager = channelManager
holder.delivery = new ChannelTerminalDeliveryService()

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
    vi.mocked(channelService.listChannels).mockReturnValueOnce([])
    await expect(channelManager.start()).resolves.not.toThrow()
    expect(createdAdapters).toHaveLength(0)
  })

  it('start() connects adapters for active channels', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])

    await channelManager.start()

    expect(createdAdapters).toHaveLength(1)
    expect(createdAdapters[0].connect).toHaveBeenCalledTimes(1)
  })

  it('stop() disconnects all adapters', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([
      makeChannelRow({ id: 'ch-1', config: { bot_token: 'tok' } }),
      makeChannelRow({ id: 'ch-2', config: { bot_token: 'tok2' } })
    ])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)
    createdAdapters.forEach((a) => expect(a.connect).toHaveBeenCalledTimes(1))

    await channelManager.stop()
    createdAdapters.forEach((a) => expect(a.disconnect).toHaveBeenCalledTimes(1))
  })

  it('serializes terminal deliveries for the same channel chat', async () => {
    // Requests are data now, so FIFO is observable where it matters: at the adapter's send.
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])
    await channelManager.start()
    const events: string[] = []
    let releaseFirst!: () => void
    createdAdapters[0].sendMessage.mockImplementation(async (_chatId: string, text: string) => {
      if (text === 'first') {
        events.push('first:start')
        await new Promise<void>((resolve) => {
          releaseFirst = () => {
            events.push('first:end')
            resolve()
          }
        })
        return
      }
      events.push('second')
    })

    channelManager.enqueueTerminalDelivery({
      id: 'delivery-1',
      channelId: 'ch-1',
      chatId: 'chat-1',
      event: 'done',
      text: 'first'
    })
    channelManager.enqueueTerminalDelivery({
      id: 'delivery-2',
      channelId: 'ch-1',
      chatId: 'chat-1',
      event: 'done',
      text: 'second'
    })

    await vi.waitFor(() => expect(events).toEqual(['first:start']))
    releaseFirst()
    await vi.waitFor(() => expect(events).toEqual(['first:start', 'first:end', 'second']))
  })

  it('accepts a terminal delivery id at most once', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])
    await channelManager.start()
    const deliver = createdAdapters[0].sendMessage
    const delivery = {
      id: 'deduplicated-delivery',
      channelId: 'ch-1',
      chatId: 'chat-1',
      event: 'done' as const,
      text: 'once'
    }

    expect(channelManager.enqueueTerminalDelivery(delivery)).toBe(true)
    expect(channelManager.enqueueTerminalDelivery(delivery)).toBe(false)
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
  })

  it('drains terminal deliveries before disconnecting adapters', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])
    await channelManager.start()
    let releaseDelivery!: () => void
    createdAdapters[0].sendMessage.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseDelivery = resolve
        })
    )

    channelManager.enqueueTerminalDelivery({
      id: 'delivery-before-stop',
      channelId: 'ch-1',
      chatId: 'chat-1',
      event: 'done',
      text: 'pending'
    })

    const stopping = channelManager.stop()
    await vi.waitFor(() => expect(releaseDelivery).toBeTypeOf('function'))
    expect(createdAdapters[0].disconnect).not.toHaveBeenCalled()

    releaseDelivery()
    await stopping
    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
  })

  // C2: a hung adapter must not own the queue forever, and a timed-out send may in fact have
  // been delivered — so the channel is blocked rather than retried.
  it('bounds a hung delivery, blocks the channel, and never retries it', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])
      await channelManager.start()
      createdAdapters[0].sendMessage.mockImplementation(() => new Promise<void>(() => {}))

      channelManager.enqueueTerminalDelivery({
        id: 'hung-delivery',
        channelId: 'ch-1',
        chatId: 'chat-1',
        event: 'done',
        text: 'never lands'
      })
      await vi.waitFor(() => expect(createdAdapters[0].sendMessage).toHaveBeenCalledTimes(1))

      await vi.advanceTimersByTimeAsync(15_000)

      // Ownership released without a second attempt...
      expect(createdAdapters[0].sendMessage).toHaveBeenCalledTimes(1)
      // ...and the channel stops accepting, so the queue behind it is not pushed through a
      // link we no longer trust.
      expect(
        channelManager.enqueueTerminalDelivery({
          id: 'follow-up',
          channelId: 'ch-1',
          chatId: 'chat-1',
          event: 'done',
          text: 'blocked'
        })
      ).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // Refusing new work is the delivery service's own gate now; the lifecycle DAG stops it before
  // ChannelManager, so producers can no longer enqueue past a shutdown that already began.
  it('rejects new terminal deliveries after shutdown starts', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([])
    await channelManager.start()
    holder.delivery.close()

    const accepted = channelManager.enqueueTerminalDelivery({
      id: 'delivery-after-stop',
      channelId: 'ch-1',
      chatId: 'chat-1',
      event: 'done',
      text: 'after-stop'
    })

    expect(accepted).toBe(false)
  })

  it('disconnectAgent disconnects all adapters for agent and clears session tracker', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([
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
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(1)

    await channelManager.disconnectAgent('unknown-agent')

    expect(createdAdapters[0].disconnect).not.toHaveBeenCalled()
  })

  it('disconnectChannel only disconnects the target channel without reconnecting', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([
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
    vi.mocked(channelService.listChannels).mockReturnValueOnce([
      makeChannelRow({ id: 'ch-1', config: { bot_token: 'tok1' } }),
      makeChannelRow({ id: 'ch-2', config: { bot_token: 'tok2' } })
    ])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)

    // Toggle ch-1 inactive — syncChannel should only disconnect ch-1
    vi.mocked(channelService.getChannel).mockReturnValueOnce(makeChannelRow({ id: 'ch-1', isActive: false }))

    await channelManager.syncChannel('ch-1')

    // ch-1 disconnected, ch-2 untouched
    expect(createdAdapters[0].disconnect).toHaveBeenCalledTimes(1)
    expect(createdAdapters[1].disconnect).not.toHaveBeenCalled()
    // No new adapter created since ch-1 is inactive
    expect(createdAdapters).toHaveLength(2)
  })

  it('syncChannel reconnects the channel when toggled active', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([
      makeChannelRow({ id: 'ch-1', config: { bot_token: 'tok1' } }),
      makeChannelRow({ id: 'ch-2', config: { bot_token: 'tok2' } })
    ])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(2)

    // Toggle ch-1 with updated config — syncChannel reconnects only ch-1
    vi.mocked(channelService.getChannel).mockReturnValueOnce(
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
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow({ isActive: false })])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(0)
  })
})
