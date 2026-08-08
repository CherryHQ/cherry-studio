import { BaseService } from '@main/core/lifecycle/BaseService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '../../types'

// Relative order of prepareDispatch (writes the PENDING placeholder) vs send, across runs.
const events: string[] = []
// Deferred resolvers so the test controls when each run's prepareDispatch completes.
const prepareResolvers: Array<() => void> = []

const prepareDispatchMock = vi.fn((primary: StreamListener, req: { topicId: string }) => {
  const seq = prepareResolvers.length
  events.push(`prepare:${req.topicId}:${seq}`)
  return new Promise((resolve) => {
    prepareResolvers.push(() =>
      resolve({
        topicId: req.topicId,
        models: [],
        listeners: [primary],
        isMultiModel: false,
        userMessage: undefined,
        siblingsGroupId: undefined,
        lifecycle: undefined
      })
    )
  })
})

const { acceptDelivery, listRecoverableDeliveries, sessionGetById, runtimeBusy, updateDeliveryStatus } = vi.hoisted(
  () => ({
    acceptDelivery: vi.fn(),
    listRecoverableDeliveries: vi.fn<() => unknown[]>(() => []),
    sessionGetById: vi.fn(),
    runtimeBusy: vi.fn(() => false),
    updateDeliveryStatus: vi.fn()
  })
)

vi.mock('../../context/AgentChatContextProvider', () => ({
  agentChatContextProvider: { prepareDispatch: prepareDispatchMock }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: sessionGetById }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    acceptSessionDelivery: acceptDelivery,
    listRecoverableSessionDeliveries: listRecoverableDeliveries,
    updateSessionDeliveryStatus: updateDeliveryStatus
  }
}))

// startAgentSessionRun reaches for `application.get('AiStreamManager')`; hand it a real
// manager so the actual `withDispatchLock` / `dispatchLock` serialization is exercised.
const managerHolder: { current: unknown } = { current: undefined }
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'AiStreamManager') return managerHolder.current
      if (name === 'AgentSessionRuntimeService') return { isSessionBusy: runtimeBusy }
      throw new Error(`startAgentSessionRun.test: unexpected application.get('${name}')`)
    }
  }
}))

const { AiStreamManager } = await import('../../AiStreamManager')
const { dispatchAcceptedAgentSessionDelivery, recoverAcceptedAgentSessionDeliveries, startAgentSessionRun } =
  await import('../startAgentSessionRun')

type ManagerInstance = InstanceType<typeof AiStreamManager>

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const text = (t: string) => ({ type: 'text' as const, text: t })
function listener(id: string): StreamListener {
  return { id, onChunk: vi.fn(), onDone: vi.fn(), onPaused: vi.fn(), onError: vi.fn(), isAlive: () => true }
}

function deliveryMessage(mode: 'send-now' | 'queue' | 'auto' = 'auto', expectsReply = false) {
  const acceptedAt = new Date().toISOString()
  const sender = { agentId: 'agent-a', sessionId: 'sender', agentName: 'A', sessionName: 'Sender' }
  return {
    id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001',
    sessionId: 'target',
    role: 'user' as const,
    data: { parts: [text('delegated work')] },
    searchableText: 'delegated work',
    status: 'success' as const,
    modelId: null,
    messageSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    delivery: {
      id: 'delivery-1',
      sender,
      receiver: { agentId: 'agent-b', sessionId: 'target', agentName: 'B', sessionName: 'Target' },
      replyTo: sender,
      ...(expectsReply ? { expectsReply: true as const } : {}),
      mode,
      status: 'accepted' as const,
      acceptedAt,
      scheduledAt: null,
      consumedAt: null,
      failedAt: null,
      error: null
    },
    createdAt: acceptedAt,
    updatedAt: acceptedAt
  }
}

describe('startAgentSessionRun — per-topic dispatch serialization (B2 agent-session path)', () => {
  let sendSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    BaseService.resetInstances()
    events.length = 0
    prepareResolvers.length = 0
    prepareDispatchMock.mockClear()
    sessionGetById.mockReset().mockReturnValue({ agentId: 'agent-1' })
    runtimeBusy.mockReset().mockReturnValue(false)
    updateDeliveryStatus.mockReset()
    acceptDelivery.mockReset()
    listRecoverableDeliveries.mockReset().mockReturnValue([])

    const Ctor = AiStreamManager as unknown as new () => ManagerInstance
    const manager = new Ctor()
    managerHolder.current = manager
    vi.spyOn(manager, 'hasLiveStream').mockReturnValue(false)
    sendSpy = vi.spyOn(manager, 'send').mockImplementation((input: { topicId: string }) => {
      events.push(`send:${input.topicId}`)
      return { mode: 'started', executionIds: [] }
    }) as unknown as ReturnType<typeof vi.spyOn>
  })

  afterEach(() => {
    BaseService.resetInstances()
  })

  it('serializes two concurrent runs on the same session — the second prepares only after the first sends', async () => {
    const p1 = startAgentSessionRun({ sessionId: 's1', userParts: [text('a')], listeners: [listener('l1')] })
    const p2 = startAgentSessionRun({ sessionId: 's1', userParts: [text('b')], listeners: [listener('l2')] })
    await flush()

    // Only the first run is inside prepareDispatch; the second is parked on the per-topic lock,
    // so it can't read `hasLiveStream` / write its placeholder yet.
    expect(events).toEqual(['prepare:agent-session:s1:0'])

    prepareResolvers[0]()
    await flush()
    await p1

    // First sent → lock released → second now prepares.
    expect(events).toEqual(['prepare:agent-session:s1:0', 'send:agent-session:s1', 'prepare:agent-session:s1:1'])

    prepareResolvers[1]()
    await flush()
    await p2
    expect(events).toEqual([
      'prepare:agent-session:s1:0',
      'send:agent-session:s1',
      'prepare:agent-session:s1:1',
      'send:agent-session:s1'
    ])
  })

  it('does not serialize runs on different sessions — the lock is per-topic', async () => {
    const pa = startAgentSessionRun({ sessionId: 'a', userParts: [text('a')], listeners: [listener('la')] })
    const pb = startAgentSessionRun({ sessionId: 'b', userParts: [text('b')], listeners: [listener('lb')] })
    await flush()

    expect(events).toEqual(['prepare:agent-session:a:0', 'prepare:agent-session:b:1'])

    prepareResolvers[0]()
    prepareResolvers[1]()
    await flush()
    await Promise.all([pa, pb])
  })

  it('forwards the extra listeners (the reason it can not just use dispatch()) to send', async () => {
    const primary = listener('primary')
    const extra = listener('extra')
    const run = startAgentSessionRun({ sessionId: 's', userParts: [text('a')], listeners: [primary, extra] })
    await flush()
    prepareResolvers[0]()
    await flush()
    await run

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ listeners: [primary, extra] }))
  })

  it('returns busy before preparing or injecting task listeners into a live user stream', async () => {
    const manager = managerHolder.current as ManagerInstance
    vi.spyOn(manager, 'hasLiveStream').mockReturnValue(true)

    await expect(
      startAgentSessionRun({
        sessionId: 's',
        userParts: [text('scheduled')],
        listeners: [listener('task')],
        requireIdle: { expectedAgentId: 'agent-1' }
      })
    ).resolves.toEqual({ mode: 'not-started', reason: 'busy' })

    expect(prepareDispatchMock).not.toHaveBeenCalled()
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('returns busy when the runtime becomes active during preparation', async () => {
    prepareDispatchMock.mockRejectedValueOnce(
      DataApiErrorFactory.resourceLocked('Agent session', 's', 'an active turn') as never
    )

    await expect(
      startAgentSessionRun({
        sessionId: 's',
        userParts: [text('scheduled')],
        listeners: [listener('task')],
        requireIdle: { expectedAgentId: 'agent-1' }
      })
    ).resolves.toEqual({ mode: 'not-started', reason: 'busy' })

    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('places task listeners before the runtime terminal listener', async () => {
    const runtimeTerminal = listener('agent-runtime:s')
    prepareDispatchMock.mockImplementationOnce(async (primary: StreamListener, req: { topicId: string }) => ({
      topicId: req.topicId,
      models: [],
      listeners: [primary, runtimeTerminal],
      isMultiModel: false
    }))
    const task = listener('task')
    const channel = listener('channel')

    await startAgentSessionRun({
      sessionId: 's',
      userParts: [text('scheduled')],
      listeners: [task, channel],
      requireIdle: { expectedAgentId: 'agent-1' }
    })

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ listeners: [task, channel, runtimeTerminal] }))
  })

  it('starts an idle durable delivery and advances its persisted status', async () => {
    const message = deliveryMessage()
    const run = startAgentSessionRun({
      sessionId: message.sessionId,
      userParts: message.data.parts,
      listeners: [listener('delivery')],
      deliveryMessage: message
    })
    await flush()
    prepareResolvers[0]()

    await expect(run).resolves.toEqual({ mode: 'started', disposition: 'delivering' })
    expect(prepareDispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentDeliveryMessage: message }),
      expect.anything()
    )
    expect(updateDeliveryStatus).toHaveBeenCalledWith(message.sessionId, message.id, 'delivering')
  })

  it('queues a busy delivery without overwriting the running turn', async () => {
    runtimeBusy.mockReturnValue(true)
    const message = deliveryMessage('queue')
    const run = startAgentSessionRun({
      sessionId: message.sessionId,
      userParts: message.data.parts,
      listeners: [listener('delivery')],
      deliveryMessage: message,
      queueOnly: true
    })
    await flush()
    prepareResolvers[0]()

    await expect(run).resolves.toEqual({ mode: 'started', disposition: 'queued' })
    expect(prepareDispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentDeliveryQueueOnly: true }),
      expect.anything()
    )
    expect(updateDeliveryStatus).toHaveBeenCalledWith(message.sessionId, message.id, 'queued')
  })

  it('replays a recoverable delivery after restart through the same dispatch lock', async () => {
    const message = deliveryMessage()
    listRecoverableDeliveries.mockReturnValue([message])
    const recovery = recoverAcceptedAgentSessionDeliveries()
    await flush()
    prepareResolvers[0]()

    await recovery
    expect(sendSpy).toHaveBeenCalledOnce()
    expect(updateDeliveryStatus).toHaveBeenCalledWith(message.sessionId, message.id, 'delivering')
  })

  it('returns a creation delivery result to its creator through a new durable delivery', async () => {
    const message = deliveryMessage('auto', true)
    const replyMessage = {
      ...deliveryMessage(),
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002',
      sessionId: 'sender'
    }
    acceptDelivery.mockReturnValue(replyMessage)

    const initialDispatch = dispatchAcceptedAgentSessionDelivery(message)
    await flush()
    prepareResolvers[0]()
    await initialDispatch

    const firstSend = sendSpy.mock.calls[0][0] as { listeners: StreamListener[] }
    const completion = firstSend.listeners[0].onDone({
      status: 'success',
      finalMessage: { id: 'assistant-1', role: 'assistant', parts: [text('Completed work')] }
    })
    await flush()
    prepareResolvers[1]()
    await completion

    expect(acceptDelivery).toHaveBeenCalledWith({
      senderAgentId: 'agent-b',
      senderSessionId: 'target',
      receiverSessionId: 'sender',
      content: 'Completed work',
      mode: 'auto'
    })
    expect(sendSpy).toHaveBeenCalledTimes(2)
  })

  it('does not manufacture completion replies for ordinary session_send deliveries', async () => {
    const message = deliveryMessage()
    const initialDispatch = dispatchAcceptedAgentSessionDelivery(message)
    await flush()
    prepareResolvers[0]()
    await initialDispatch

    const firstSend = sendSpy.mock.calls[0][0] as { listeners: StreamListener[] }
    await firstSend.listeners[0].onDone({
      status: 'success',
      finalMessage: { id: 'assistant-1', role: 'assistant', parts: [text('No return requested')] }
    })

    expect(acceptDelivery).not.toHaveBeenCalled()
    expect(sendSpy).toHaveBeenCalledOnce()
  })
})
