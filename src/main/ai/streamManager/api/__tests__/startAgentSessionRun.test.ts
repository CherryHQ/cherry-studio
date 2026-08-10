import { BaseService } from '@main/core/lifecycle/BaseService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '../../types'

// Relative order of prepareDispatch (writes the PENDING placeholder) vs send, across runs.
const events: string[] = []
// Deferred resolvers so the test controls when each run's prepareDispatch completes.
const prepareResolvers: Array<() => void> = []
let preparedMessageId: string | undefined

const prepareDispatchMock = vi.fn((primary: StreamListener, req: { topicId: string }) => {
  const seq = prepareResolvers.length
  events.push(`prepare:${req.topicId}:${seq}`)
  return new Promise((resolve) => {
    prepareResolvers.push(() =>
      resolve({
        topicId: req.topicId,
        models: preparedMessageId ? [{ request: { messageId: preparedMessageId } }] : [],
        listeners: [primary],
        isMultiModel: false,
        userMessage: undefined,
        siblingsGroupId: undefined,
        lifecycle: undefined
      })
    )
  })
})

const { listRecoverableDeliveries, sessionGetById, runtimeBusy, transitionDelivery } = vi.hoisted(() => ({
  listRecoverableDeliveries: vi.fn<() => unknown[]>(() => []),
  sessionGetById: vi.fn(),
  runtimeBusy: vi.fn(() => false),
  transitionDelivery: vi.fn()
}))

vi.mock('../../context/AgentChatContextProvider', () => ({
  agentChatContextProvider: { prepareDispatch: prepareDispatchMock }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: sessionGetById }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listRecoverableSessionDeliveries: listRecoverableDeliveries,
    transitionSessionDelivery: transitionDelivery
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
const { recoverAcceptedAgentSessionDeliveries, startAgentSessionRun } = await import('../startAgentSessionRun')

type ManagerInstance = InstanceType<typeof AiStreamManager>

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const text = (t: string) => ({ type: 'text' as const, text: t })
function listener(id: string): StreamListener {
  return { id, onChunk: vi.fn(), onDone: vi.fn(), onPaused: vi.fn(), onError: vi.fn(), isAlive: () => true }
}

function deliveryMessage(mode: 'queue' | 'auto' = 'auto', replyPolicy: 'none' | 'completion' = 'none') {
  const acceptedAt = new Date().toISOString()
  const sender = { agentId: 'agent-a', sessionId: 'sender' }
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
      version: 1 as const,
      sender,
      receiver: { agentId: 'agent-b', sessionId: 'target' },
      senderSnapshot: { agentName: 'A', sessionName: 'Sender' },
      receiverSnapshot: { agentName: 'B', sessionName: 'Target' },
      replyPolicy,
      mode,
      turnRef: null,
      sourceMessageId: null,
      outcome: null,
      error: null,
      statusAt: acceptedAt,
      status: 'accepted' as const,
      inReplyTo: null
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
    preparedMessageId = undefined
    prepareDispatchMock.mockClear()
    sessionGetById.mockReset().mockReturnValue({ agentId: 'agent-1' })
    runtimeBusy.mockReset().mockReturnValue(false)
    transitionDelivery.mockReset()
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
    preparedMessageId = 'assistant-1'
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
    expect(transitionDelivery).toHaveBeenCalledWith(message.sessionId, message.id, 'delivering', {
      expected: ['accepted', 'queued'],
      turnRef: 'assistant-1'
    })
    expect(transitionDelivery.mock.invocationCallOrder[0]).toBeLessThan(sendSpy.mock.invocationCallOrder[0])
  })

  it('persists an idle queue-only delivery as delivering before starting its turn', async () => {
    const message = deliveryMessage('queue')
    preparedMessageId = 'assistant-queue'
    const run = startAgentSessionRun({
      sessionId: message.sessionId,
      userParts: message.data.parts,
      listeners: [listener('delivery')],
      deliveryMessage: message,
      queueOnly: true
    })
    await flush()
    prepareResolvers[0]()

    await expect(run).resolves.toEqual({ mode: 'started', disposition: 'delivering' })
    expect(prepareDispatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentDeliveryQueueOnly: true }),
      expect.anything()
    )
    expect(transitionDelivery).toHaveBeenCalledWith(message.sessionId, message.id, 'delivering', {
      expected: ['accepted', 'queued'],
      turnRef: 'assistant-queue'
    })
    expect(transitionDelivery.mock.invocationCallOrder[0]).toBeLessThan(sendSpy.mock.invocationCallOrder[0])
  })

  it('keeps a queue-only delivery queued when it enters the runtime FIFO', async () => {
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
    expect(transitionDelivery).toHaveBeenCalledWith(message.sessionId, message.id, 'queued', {
      expected: ['accepted', 'queued']
    })
  })

  it('replays a recoverable delivery after restart through the same dispatch lock', async () => {
    const message = deliveryMessage()
    preparedMessageId = 'assistant-recovered'
    listRecoverableDeliveries.mockReturnValue([message])
    const recovery = recoverAcceptedAgentSessionDeliveries()
    await flush()
    prepareResolvers[0]()

    await recovery
    expect(sendSpy).toHaveBeenCalledOnce()
    expect(transitionDelivery).toHaveBeenCalledWith(message.sessionId, message.id, 'delivering', {
      expected: ['accepted', 'queued'],
      turnRef: 'assistant-recovered'
    })
  })
})
