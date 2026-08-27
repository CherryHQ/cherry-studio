import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChannelAdapter, type ChannelAdapterConfig, ChannelStreamCompletionResult } from '../ChannelAdapter'
import { ChannelDeliveryService } from '../ChannelDeliveryService'
import {
  ChannelDeliveryEvent,
  ChannelManager,
  ChannelTerminalAdmissionResult,
  registerAdapterFactory
} from '../ChannelManager'
import { channelMessageHandler } from '../ChannelMessageHandler'

// Real delivery service: these tests exercise FIFO, dedupe, the bounded send and drain, so a
// stub would assert nothing. Held indirectly because `vi.mock` factories are hoisted above
// module-level initialization; it resolves adapters back through the manager under test.
const holder = vi.hoisted(() => ({ manager: undefined as any, delivery: undefined as any }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    ChannelManager: {
      resolveConnectedAdapter: (channelId: string) => holder.manager?.resolveConnectedAdapter(channelId)
    },
    ChannelDeliveryService: {
      updateLive: (request: unknown) => holder.delivery.updateLive(request),
      enqueueTerminal: (request: unknown) => holder.delivery.enqueueTerminal(request),
      isActive: () => holder.delivery.isActive(),
      open: () => holder.delivery.open(),
      replacementStarted: (channelId: string) => holder.delivery.replacementStarted(channelId),
      connectionLost: (channelId: string, connectionEpoch?: number) =>
        holder.delivery.connectionLost(channelId, connectionEpoch),
      connected: (channelId: string, connectionEpoch: number) => holder.delivery.connected(channelId, connectionEpoch),
      close: () => holder.delivery.close(),
      drain: (channelIds?: ReadonlySet<string>) => holder.delivery.drain(channelIds)
    }
  } as never)
})

const channelManager = new ChannelManager()
holder.manager = channelManager
holder.delivery = new ChannelDeliveryService()

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
  connect = vi.fn(async () => this.markConnected())
  disconnect = vi.fn().mockResolvedValue(undefined)
  sendMessage = vi.fn().mockResolvedValue(undefined)
  sendTypingIndicator = vi.fn().mockResolvedValue(undefined)
  onStreamComplete = vi.fn().mockResolvedValue(ChannelStreamCompletionResult.NotHandled)

  protected async performConnect(): Promise<void> {}
  protected async performDisconnect(): Promise<void> {}

  constructor(config: ChannelAdapterConfig) {
    super(config)
  }
}

// Track adapters created by the factory
let createdAdapters: MockAdapter[] = []
let nextConnectError: Error | undefined

describe('ChannelManager', () => {
  beforeEach(async () => {
    // Defensively stop any leftover adapters from a previous failed test
    await channelManager.stop()
    vi.clearAllMocks()
    createdAdapters = []
    nextConnectError = undefined
    // Re-register the mock factory (the map persists across tests since we don't resetModules)
    registerAdapterFactory('telegram', (channel, agentId) => {
      const adapter = new MockAdapter({
        channelId: channel.id,
        channelType: channel.type,
        agentId,
        channelConfig: channel.config
      })
      if (nextConnectError) adapter.connect.mockRejectedValue(nextConnectError)
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
      event: ChannelDeliveryEvent.Done,
      text: 'first'
    })
    channelManager.enqueueTerminalDelivery({
      id: 'delivery-2',
      channelId: 'ch-1',
      chatId: 'chat-1',
      event: ChannelDeliveryEvent.Done,
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
      event: ChannelDeliveryEvent.Done,
      text: 'once'
    }

    expect(channelManager.enqueueTerminalDelivery(delivery)).toBe(ChannelTerminalAdmissionResult.Accepted)
    expect(channelManager.enqueueTerminalDelivery(delivery)).toBe(ChannelTerminalAdmissionResult.AlreadyOwned)
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
      event: ChannelDeliveryEvent.Done,
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

      expect(
        channelManager.enqueueTerminalDelivery({
          id: 'hung-delivery',
          channelId: 'ch-1',
          chatId: 'chat-1',
          event: ChannelDeliveryEvent.Done,
          text: 'never lands'
        })
      ).toBe(ChannelTerminalAdmissionResult.Accepted)
      // B is already in the owned FIFO before A times out. Blocking must purge it rather than
      // letting its pre-created continuation run through the now-untrusted channel.
      expect(
        channelManager.enqueueTerminalDelivery({
          id: 'queued-before-timeout',
          channelId: 'ch-1',
          chatId: 'chat-1',
          event: ChannelDeliveryEvent.Done,
          text: 'must be skipped'
        })
      ).toBe(ChannelTerminalAdmissionResult.Accepted)
      await vi.waitFor(() => expect(createdAdapters[0].sendMessage).toHaveBeenCalledTimes(1))

      await vi.advanceTimersByTimeAsync(15_000)

      // Ownership released and the already-queued request was skipped without a second send...
      expect(createdAdapters[0].sendMessage).toHaveBeenCalledTimes(1)
      // ...and later arrivals are rejected by the same channel-wide gate.
      expect(
        channelManager.enqueueTerminalDelivery({
          id: 'follow-up',
          channelId: 'ch-1',
          chatId: 'chat-1',
          event: ChannelDeliveryEvent.Done,
          text: 'blocked'
        })
      ).toBe(ChannelTerminalAdmissionResult.DroppedByPolicy)
      expect(channelManager.updateLive({ channelId: 'ch-1', chatId: 'chat-1', text: 'later chunk' })).toBe(false)
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
      event: ChannelDeliveryEvent.Done,
      text: 'after-stop'
    })

    expect(accepted).toBe(ChannelTerminalAdmissionResult.DroppedByPolicy)
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
    expect(
      channelManager.enqueueTerminalDelivery({
        id: 'after-successful-reconnect',
        channelId: 'ch-1',
        chatId: 'chat-1',
        event: ChannelDeliveryEvent.Done,
        text: 'new epoch'
      })
    ).toBe(ChannelTerminalAdmissionResult.Accepted)
    await vi.waitFor(() => expect(createdAdapters[2].sendMessage).toHaveBeenCalledTimes(1))
  })

  it('moves an explicitly unhandled terminal to the replacement epoch without using the old fallback', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])
    await channelManager.start()
    const adapterA = createdAdapters[0]
    let finishStream!: (result: ChannelStreamCompletionResult) => void
    adapterA.onStreamComplete.mockImplementationOnce(
      () => new Promise<ChannelStreamCompletionResult>((resolve) => (finishStream = resolve))
    )

    channelManager.enqueueTerminalDelivery({
      id: 'delivery-across-epoch',
      channelId: 'ch-1',
      chatId: 'chat-1',
      event: ChannelDeliveryEvent.Done,
      text: 'terminal',
      finalizeStream: true
    })
    await vi.waitFor(() => expect(adapterA.onStreamComplete).toHaveBeenCalledOnce())
    adapterA.emit('statusChange', { channelId: 'ch-1', connected: false })
    finishStream(ChannelStreamCompletionResult.NotHandled)
    await vi.waitFor(() => expect(adapterA.sendMessage).not.toHaveBeenCalled())

    vi.mocked(channelService.getChannel).mockReturnValueOnce(makeChannelRow())
    await channelManager.syncChannel('ch-1', { awaitConnect: true })
    const adapterB = createdAdapters[1]

    await vi.waitFor(() =>
      expect(adapterB.sendMessage).toHaveBeenCalledExactlyOnceWith('chat-1', 'terminal', expect.any(Object))
    )
    expect(adapterA.sendMessage).not.toHaveBeenCalled()
  })

  it('does not retry a terminal whose external completion result became unknown during disconnect', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])
    await channelManager.start()
    const adapterA = createdAdapters[0]
    let rejectStream!: (error: Error) => void
    adapterA.onStreamComplete.mockImplementationOnce(
      () => new Promise<ChannelStreamCompletionResult>((_resolve, reject) => (rejectStream = reject))
    )

    channelManager.enqueueTerminalDelivery({
      id: 'delivery-unknown-result',
      channelId: 'ch-1',
      chatId: 'chat-1',
      event: ChannelDeliveryEvent.Done,
      text: 'terminal',
      finalizeStream: true
    })
    await vi.waitFor(() => expect(adapterA.onStreamComplete).toHaveBeenCalledOnce())
    adapterA.emit('statusChange', { channelId: 'ch-1', connected: false })
    rejectStream(new Error('connection lost after send'))

    vi.mocked(channelService.getChannel).mockReturnValueOnce(makeChannelRow())
    await channelManager.syncChannel('ch-1', { awaitConnect: true })
    const adapterB = createdAdapters[1]
    await Promise.resolve()

    expect(adapterA.sendMessage).not.toHaveBeenCalled()
    expect(adapterB.onStreamComplete).not.toHaveBeenCalled()
    expect(adapterB.sendMessage).not.toHaveBeenCalled()
  })

  it('drains an owned terminal attempt before a planned adapter replacement', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])
    await channelManager.start()
    const adapterA = createdAdapters[0]
    let finishSend!: () => void
    adapterA.sendMessage.mockImplementationOnce(() => new Promise<void>((resolve) => (finishSend = resolve)))
    channelManager.enqueueTerminalDelivery({
      id: 'delivery-before-replacement',
      channelId: 'ch-1',
      chatId: 'chat-1',
      event: ChannelDeliveryEvent.Done,
      text: 'old epoch'
    })
    await vi.waitFor(() => expect(adapterA.sendMessage).toHaveBeenCalledOnce())

    vi.mocked(channelService.getChannel).mockReturnValueOnce(makeChannelRow())
    const replacing = channelManager.syncChannel('ch-1', { awaitConnect: true })
    await Promise.resolve()
    expect(adapterA.disconnect).not.toHaveBeenCalled()
    expect(createdAdapters).toHaveLength(1)

    finishSend()
    await replacing
    expect(adapterA.disconnect).toHaveBeenCalledOnce()
    expect(createdAdapters).toHaveLength(2)
  })

  it('retains terminal work arriving during replacement for the new adapter', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])
    await channelManager.start()
    const adapterA = createdAdapters[0]
    let finishClaimed!: () => void
    adapterA.sendMessage.mockImplementationOnce(() => new Promise<void>((resolve) => (finishClaimed = resolve)))
    channelManager.enqueueTerminalDelivery({
      id: 'claimed-before-replacement',
      channelId: 'ch-1',
      chatId: 'chat-1',
      event: ChannelDeliveryEvent.Done,
      text: 'claimed'
    })
    await vi.waitFor(() => expect(adapterA.sendMessage).toHaveBeenCalledOnce())

    vi.mocked(channelService.getChannel).mockReturnValueOnce(makeChannelRow())
    const replacing = channelManager.syncChannel('ch-1', { awaitConnect: true })
    await Promise.resolve()
    expect(
      channelManager.enqueueTerminalDelivery({
        id: 'retained-during-replacement',
        channelId: 'ch-1',
        chatId: 'chat-1',
        event: ChannelDeliveryEvent.Done,
        text: 'retained'
      })
    ).toBe(ChannelTerminalAdmissionResult.Accepted)
    expect(adapterA.sendMessage).toHaveBeenCalledOnce()

    finishClaimed()
    await replacing
    const adapterB = createdAdapters[1]
    await vi.waitFor(() =>
      expect(adapterB.sendMessage).toHaveBeenCalledExactlyOnceWith('chat-1', 'retained', expect.any(Object))
    )
    expect(adapterA.sendMessage).toHaveBeenCalledOnce()
  })

  it('aborts the old live epoch and routes later chunks through the replacement adapter', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow()])
    await channelManager.start()
    const adapterA = createdAdapters[0]
    adapterA.onTextUpdate = vi.fn().mockResolvedValue(undefined)

    expect(channelManager.updateLive({ channelId: 'ch-1', chatId: 'chat-1', text: 'first' })).toBe(true)
    const oldSignal = vi.mocked(adapterA.onTextUpdate).mock.calls[0][2]?.signal
    expect(oldSignal?.aborted).toBe(false)

    vi.mocked(channelService.getChannel).mockReturnValueOnce(makeChannelRow())
    await channelManager.syncChannel('ch-1', { awaitConnect: true })
    const adapterB = createdAdapters[1]
    adapterB.onTextUpdate = vi.fn().mockResolvedValue(undefined)

    adapterA.emit('message', { chatId: 'stale', userId: 'user', userName: 'stale', text: 'late' })
    adapterA.emit('statusChange', { channelId: 'ch-1', connected: false })

    expect(oldSignal?.aborted).toBe(true)
    expect(channelMessageHandler.handleIncoming).not.toHaveBeenCalled()
    expect(channelManager.updateLive({ channelId: 'ch-1', chatId: 'chat-1', text: 'second' })).toBe(true)
    expect(adapterA.onTextUpdate).toHaveBeenCalledOnce()
    expect(adapterB.onTextUpdate).toHaveBeenCalledWith(
      'chat-1',
      'second',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('keeps delivery blocked when an awaited reconnect fails', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([])
    await channelManager.start()
    vi.mocked(channelService.getChannel).mockReturnValueOnce(makeChannelRow())
    nextConnectError = new Error('awaited connect failed')

    await expect(channelManager.syncChannel('ch-1', { awaitConnect: true })).rejects.toThrow('awaited connect failed')

    expect(
      channelManager.enqueueTerminalDelivery({
        id: 'after-awaited-connect-failure',
        channelId: 'ch-1',
        chatId: 'chat-1',
        event: ChannelDeliveryEvent.Done,
        text: 'must stay blocked'
      })
    ).toBe(ChannelTerminalAdmissionResult.Accepted)
  })

  it('keeps delivery blocked when a background reconnect fails', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([])
    await channelManager.start()
    vi.mocked(channelService.getChannel).mockReturnValueOnce(makeChannelRow())
    nextConnectError = new Error('background connect failed')

    await channelManager.syncChannel('ch-1')
    await vi.waitFor(() => expect(createdAdapters[0].connect).toHaveBeenCalledTimes(1))

    expect(
      channelManager.enqueueTerminalDelivery({
        id: 'after-background-connect-failure',
        channelId: 'ch-1',
        chatId: 'chat-1',
        event: ChannelDeliveryEvent.Done,
        text: 'must stay blocked'
      })
    ).toBe(ChannelTerminalAdmissionResult.Accepted)
  })

  it('inactive channels are skipped', async () => {
    vi.mocked(channelService.listChannels).mockReturnValueOnce([makeChannelRow({ isActive: false })])

    await channelManager.start()
    expect(createdAdapters).toHaveLength(0)
  })
})
