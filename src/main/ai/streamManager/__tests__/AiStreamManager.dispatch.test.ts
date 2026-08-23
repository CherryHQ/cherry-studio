import { BaseService } from '@main/core/lifecycle'
import { ConversationKind, type ConversationRef } from '@shared/ai/conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationActor, ConversationAdmissionOperationKind } from '../../conversation/ConversationActor'
import { ConversationRuntimeService } from '../../conversation/ConversationRuntimeService'

const mocks = vi.hoisted(() => ({
  findCrashOrphanedAssistantMessages: vi.fn<() => Array<{ id: string; topicId: string; data: { parts: unknown[] } }>>(
    () => []
  ),
  resolveCrashOrphanedMessages: vi.fn(),
  cache: { getShared: vi.fn(), setShared: vi.fn() },
  namingWrites: new Map<string, Promise<void>>()
}))

vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    findCrashOrphanedAssistantMessages: mocks.findCrashOrphanedAssistantMessages,
    resolveCrashOrphanedMessages: mocks.resolveCrashOrphanedMessages
  }
}))

vi.mock('@application', () => ({
  application: { get: vi.fn(() => mocks.cache) }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { inFlightWrites: () => mocks.namingWrites }
}))

const ref = (id: string): ConversationRef => ({ kind: ConversationKind.Chat, id })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function actor(id: string) {
  return new ConversationActor(ref(id), () => {})
}

describe('ConversationActor admission FIFO — per-Conversation serialization', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.namingWrites.clear()
  })

  it('serializes two concurrent admissions on the same Conversation — the second waits for the first', async () => {
    const lane = actor('topic-1')
    const events: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = lane.enqueue(ConversationAdmissionOperationKind.Dispatch, async () => {
      events.push('start:first')
      await firstGate
      events.push('end:first')
    })
    const second = lane.enqueue(ConversationAdmissionOperationKind.Dispatch, async () => {
      events.push('start:second')
      events.push('end:second')
    })
    await flush()

    expect(events).toEqual(['start:first'])
    releaseFirst()
    await Promise.all([first, second])

    expect(events).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
  })

  it('does not serialize admissions on different Conversations', async () => {
    const firstLane = actor('topic-a')
    const secondLane = actor('topic-b')
    const events: string[] = []
    let releaseA!: () => void
    let releaseB!: () => void
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve
    })

    const first = firstLane.enqueue(ConversationAdmissionOperationKind.Dispatch, async () => {
      events.push('start:a')
      await gateA
      events.push('end:a')
    })
    const second = secondLane.enqueue(ConversationAdmissionOperationKind.Dispatch, async () => {
      events.push('start:b')
      await gateB
      events.push('end:b')
    })
    await flush()

    expect(events).toEqual(['start:a', 'start:b'])
    releaseA()
    releaseB()
    await Promise.all([first, second])
  })
})

describe('ConversationRuntimeService — boot reconcile boundary', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.namingWrites.clear()
    mocks.findCrashOrphanedAssistantMessages.mockReturnValue([])
  })

  it('finishes the synchronous crash reconcile before lifecycle initialization admits callers', async () => {
    const order: string[] = []
    mocks.findCrashOrphanedAssistantMessages.mockImplementation(() => {
      order.push('reconcile')
      return []
    })
    const service = new ConversationRuntimeService({ providers: [] })

    await service._doInit()
    order.push('initialized')

    expect(order).toEqual(['reconcile', 'initialized'])
  })

  it('resolves orphaned pending rows with interrupted terminal parts during the reconcile sweep', async () => {
    mocks.findCrashOrphanedAssistantMessages.mockReturnValue([
      { id: 'stale-1', topicId: 'topic-1', data: { parts: [] } },
      { id: 'stale-2', topicId: 'topic-2', data: { parts: [] } }
    ])
    const service = new ConversationRuntimeService({ providers: [] })

    await service._doInit()

    expect(mocks.resolveCrashOrphanedMessages).toHaveBeenCalledOnce()
    expect(mocks.resolveCrashOrphanedMessages).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'stale-1', data: { parts: expect.any(Array) } }),
      expect.objectContaining({ id: 'stale-2', data: { parts: expect.any(Array) } })
    ])
  })
})
