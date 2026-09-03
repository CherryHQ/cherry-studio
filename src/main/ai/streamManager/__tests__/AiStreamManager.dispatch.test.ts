import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'
import {
  TOPIC_COMPLETION_SEEN_CACHE_KEY,
  TOPIC_STATUS_INDEX_CACHE_KEY,
  type TopicCompletionSeenEvent,
  type TopicStatusSnapshotEntry
} from '@shared/ai/transport'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiStreamManagerConfig, StreamListener } from '../types'

// ── Mocks ───────────────────────────────────────────────────────────

// `dispatchStreamRequest` is the work `dispatch()` wraps in the per-topic lock.
// Replace it with a deferred so the test controls when each dispatch "completes"
// and can observe whether a second dispatch on the same topic waits its turn.
const dispatchEvents: string[] = []
const dispatchResolvers: Array<() => void> = []
const mockDispatchStreamRequest = vi.fn(
  (_manager: unknown, _subscriber: unknown, req: { topicId: string }): Promise<unknown> => {
    const seq = dispatchResolvers.length
    dispatchEvents.push(`start:${req.topicId}:${seq}`)
    return new Promise((resolve) => {
      dispatchResolvers.push(() => {
        dispatchEvents.push(`end:${req.topicId}:${seq}`)
        resolve({ mode: 'started' })
      })
    })
  }
)

vi.mock('../context/dispatch', () => ({
  dispatchStreamRequest: mockDispatchStreamRequest
}))

// Boot-sweep reconcile reads/writes through MessageService.
const findPendingAssistantMessageIds = vi.fn<() => string[]>(() => [])
const markMessagesError = vi.fn<(ids: string[]) => void>(() => undefined)
vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    findPendingAssistantMessageIds: () => findPendingAssistantMessageIds(),
    markMessagesError: (ids: string[]) => markMessagesError(ids)
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { AiStreamManager } = await import('../AiStreamManager')

// ── Helpers ─────────────────────────────────────────────────────────

type ManagerInstance = InstanceType<typeof AiStreamManager>

function createManager(): ManagerInstance {
  BaseService.resetInstances()
  const Ctor = AiStreamManager as unknown as new (config?: Partial<AiStreamManagerConfig>) => ManagerInstance
  return new Ctor()
}

const fakeSubscriber = {} as StreamListener
const openReq = (topicId: string) => ({ trigger: 'submit-message', topicId, messages: [] }) as never

/** Drain pending microtasks + the async-mutex acquire (which resolves on a macrotask). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Resolve one outstanding dispatch and let the next queued waiter acquire the lock. */
async function settleDispatch(index: number): Promise<void> {
  dispatchResolvers[index]()
  await flush()
}

// ── Tests ───────────────────────────────────────────────────────────

const runOnInit = (mgr: ManagerInstance) => (mgr as unknown as { onInit(): Promise<void> }).onInit()

describe('AiStreamManager.dispatch — per-topic serialization', () => {
  let mgr: ManagerInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    dispatchEvents.length = 0
    dispatchResolvers.length = 0
    findPendingAssistantMessageIds.mockReturnValue([])
    mgr = createManager()
    // onInit resolves the reconcile gate `dispatch` awaits, so these lock tests run normally.
    await runOnInit(mgr)
  })

  afterEach(() => {
    BaseService.resetInstances()
  })

  it('serializes two concurrent dispatches on the same topic — the second waits for the first', async () => {
    const p1 = mgr.dispatch(fakeSubscriber, openReq('t'))
    const p2 = mgr.dispatch(fakeSubscriber, openReq('t'))
    await flush()

    // Only the first has entered dispatchStreamRequest; the second is parked on the lock.
    expect(dispatchEvents).toEqual(['start:t:0'])

    await settleDispatch(0)
    await p1

    // First finished → second now runs.
    expect(dispatchEvents).toEqual(['start:t:0', 'end:t:0', 'start:t:1'])

    await settleDispatch(1)
    await p2
    expect(dispatchEvents).toEqual(['start:t:0', 'end:t:0', 'start:t:1', 'end:t:1'])
  })

  it('does not serialize dispatches on different topics — the lock is per-topic', async () => {
    const pa = mgr.dispatch(fakeSubscriber, openReq('a'))
    const pb = mgr.dispatch(fakeSubscriber, openReq('b'))
    await flush()

    // Both started concurrently — neither blocks the other.
    expect(dispatchEvents).toEqual(['start:a:0', 'start:b:1'])

    await settleDispatch(0)
    await settleDispatch(1)
    await Promise.all([pa, pb])
  })

  it('prunes an acknowledged completion from the workspace status index', () => {
    const cacheService = application.get('CacheService')
    const doneEntry: TopicStatusSnapshotEntry = {
      status: 'done',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: 42
    }
    const approvalEntry: TopicStatusSnapshotEntry = {
      ...doneEntry,
      awaitingApprovalAnchors: [{ executionId: 'provider::model', attemptId: 1 }]
    }
    cacheService.setShared(TOPIC_STATUS_INDEX_CACHE_KEY, { completed: doneEntry, approval: approvalEntry })

    const subscription = vi
      .mocked(cacheService.subscribeSharedChange)
      .mock.calls.find(([key]) => key === TOPIC_COMPLETION_SEEN_CACHE_KEY)
    const onCompletionSeen = subscription?.[1] as
      | ((event: TopicCompletionSeenEvent | null | undefined) => void)
      | undefined

    expect(onCompletionSeen).toBeDefined()
    onCompletionSeen?.({ topicId: 'completed', completedAt: 42 })
    onCompletionSeen?.({ topicId: 'approval', completedAt: 42 })

    expect(cacheService.getShared(TOPIC_STATUS_INDEX_CACHE_KEY)).toEqual({ approval: approvalEntry })
  })

  it('removes deleted conversations from the workspace status index', () => {
    const cacheService = application.get('CacheService')
    const errorEntry: TopicStatusSnapshotEntry = {
      status: 'error',
      activeExecutions: [],
      awaitingApprovalAnchors: []
    }
    const doneEntry: TopicStatusSnapshotEntry = {
      status: 'done',
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      lastCompletedAt: 42
    }
    cacheService.setShared(TOPIC_STATUS_INDEX_CACHE_KEY, { failed: errorEntry, completed: doneEntry })
    cacheService.setShared('topic.stream.statuses.failed', errorEntry)
    cacheService.setShared('topic.stream.statuses.completed', doneEntry)

    mgr.clearConversationTaskStatuses(['failed', 'completed'])

    expect(cacheService.getShared(TOPIC_STATUS_INDEX_CACHE_KEY)).toEqual({})
    expect(cacheService.getShared('topic.stream.statuses.failed')).toBeNull()
    expect(cacheService.getShared('topic.stream.statuses.completed')).toBeNull()
  })
})

// Request-shape validation (non-string topicId, missing trigger / userMessageParts /
// parentAnchorId) now lives in the IpcApi router's zod parse of `aiRequestSchemas`
// ('ai.stream_*'), not in AiStreamManager — so it is no longer unit-tested here (a thin
// schema contract; see ipc-usage.md "Testing"). The handler→service delegation is covered
// in `src/main/ipc/handlers/__tests__/ai.test.ts`.

describe('AiStreamManager.dispatch — boot reconcile gate', () => {
  let mgr: ManagerInstance

  beforeEach(() => {
    vi.clearAllMocks()
    dispatchEvents.length = 0
    dispatchResolvers.length = 0
    mgr = createManager()
  })

  afterEach(() => {
    BaseService.resetInstances()
  })

  it('does not write a placeholder until the boot reconcile finishes, so a mid-boot open cannot race it', async () => {
    // A stream opens before onInit runs the crash-orphan reconcile — dispatch must stay parked on
    // the gate (the synchronous sweep runs entirely inside onInit before markReconciled fires).
    const dispatchPromise = mgr.dispatch(fakeSubscriber, openReq('t'))
    await flush()
    expect(dispatchEvents).toEqual([])
    expect(mockDispatchStreamRequest).not.toHaveBeenCalled()

    // onInit runs the reconcile → the gate opens and dispatch proceeds.
    await runOnInit(mgr)
    await flush()
    expect(dispatchEvents).toEqual(['start:t:0'])

    await settleDispatch(0)
    await dispatchPromise
  })

  it('flips orphaned pending rows to error during the reconcile sweep', async () => {
    findPendingAssistantMessageIds.mockReturnValue(['stale-1', 'stale-2'])
    await runOnInit(mgr)
    expect(markMessagesError).toHaveBeenCalledWith(['stale-1', 'stale-2'])
  })
})
