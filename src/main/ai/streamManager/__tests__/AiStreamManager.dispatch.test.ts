import { BaseService } from '@main/core/lifecycle/BaseService'
import { ipcMain } from 'electron'
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

vi.mock('../context', () => ({
  dispatchStreamRequest: mockDispatchStreamRequest
}))

// Boot-sweep reconcile reads/writes through MessageService.
const findPendingAssistantMessageIds = vi.fn<() => Promise<string[]>>(async () => [])
const markMessagesError = vi.fn<(ids: string[]) => Promise<void>>(async () => undefined)
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

describe('AiStreamManager.dispatch — per-topic serialization', () => {
  let mgr: ManagerInstance

  beforeEach(() => {
    vi.clearAllMocks()
    dispatchEvents.length = 0
    dispatchResolvers.length = 0
    findPendingAssistantMessageIds.mockResolvedValue([])
    mgr = createManager()
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
})

describe('AiStreamManager IPC handlers — boundary validation', () => {
  let mgr: ManagerInstance
  /** channel → registered IPC listener captured from the ipcMain.handle mock. */
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  // WebContentsListener wires once()/isDestroyed() on the sender; stub a minimal shape.
  const fakeEvent = { sender: { id: 1, isDestroyed: () => false, send: vi.fn(), once: vi.fn() } } as unknown

  beforeEach(async () => {
    vi.clearAllMocks()
    dispatchEvents.length = 0
    dispatchResolvers.length = 0
    findPendingAssistantMessageIds.mockResolvedValue([])
    handlers.clear()
    vi.mocked(ipcMain.handle).mockImplementation(((channel: string, listener: never) => {
      handlers.set(channel, listener as unknown as (event: unknown, ...args: unknown[]) => unknown)
    }) as never)
    mgr = createManager()
    await (mgr as unknown as { onInit(): Promise<void> }).onInit()
  })

  afterEach(() => {
    BaseService.resetInstances()
  })

  it('rejects Ai_Stream_Open with a non-string topicId before dispatching', async () => {
    const open = handlers.get('ai:stream:open')!
    await expect(open(fakeEvent, { trigger: 'submit-message', userMessageParts: [], topicId: 42 })).rejects.toThrow(
      'Invalid Ai_Stream_Open request'
    )
    expect(mockDispatchStreamRequest).not.toHaveBeenCalled()
  })

  it('rejects Ai_Stream_Open with a missing trigger before dispatching', async () => {
    const open = handlers.get('ai:stream:open')!
    await expect(open(fakeEvent, { topicId: 't', userMessageParts: [] })).rejects.toThrow(
      'Invalid Ai_Stream_Open request'
    )
    expect(mockDispatchStreamRequest).not.toHaveBeenCalled()
  })

  it('rejects a submit-message Ai_Stream_Open missing userMessageParts', async () => {
    const open = handlers.get('ai:stream:open')!
    await expect(open(fakeEvent, { trigger: 'submit-message', topicId: 't' })).rejects.toThrow(
      'Invalid Ai_Stream_Open request'
    )
    expect(mockDispatchStreamRequest).not.toHaveBeenCalled()
  })

  it('rejects a regenerate-message Ai_Stream_Open missing parentAnchorId', async () => {
    const open = handlers.get('ai:stream:open')!
    await expect(open(fakeEvent, { trigger: 'regenerate-message', topicId: 't' })).rejects.toThrow(
      'Invalid Ai_Stream_Open request'
    )
    expect(mockDispatchStreamRequest).not.toHaveBeenCalled()
  })

  it('dispatches a well-formed submit-message Ai_Stream_Open', async () => {
    const open = handlers.get('ai:stream:open')!
    void open(fakeEvent, { trigger: 'submit-message', topicId: 't', userMessageParts: [] })
    await flush()
    expect(mockDispatchStreamRequest).toHaveBeenCalledTimes(1)
  })

  it('returns not-found for an Ai_Stream_Attach with an empty topicId', () => {
    const attach = handlers.get('ai:stream:attach')!
    expect(attach(fakeEvent, { topicId: '' })).toEqual({ status: 'not-found' })
  })

  it('no-ops Ai_Stream_Abort with an invalid topicId', () => {
    const abort = handlers.get('ai:stream:abort')!
    const abortSpy = vi.spyOn(mgr, 'abort')
    expect(abort(fakeEvent, { topicId: 99 })).toBeUndefined()
    expect(abortSpy).not.toHaveBeenCalled()
  })
})

describe('AiStreamManager.onInit — boot sweep ordering', () => {
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

  it('flips orphaned pending → error before the Ai_Stream_Open handler is registered', async () => {
    const order: string[] = []
    findPendingAssistantMessageIds.mockResolvedValue(['stale-1', 'stale-2'])
    markMessagesError.mockImplementation(async (ids: string[]) => {
      order.push(`sweep:${ids.join(',')}`)
    })
    vi.mocked(ipcMain.handle).mockImplementation(((channel: string) => {
      order.push(`register:${channel}`)
    }) as never)

    await (mgr as unknown as { onInit(): Promise<void> }).onInit()

    // Every stale row was flipped to `error` in one serialized write...
    expect(markMessagesError).toHaveBeenCalledWith(['stale-1', 'stale-2'])
    // ...and that write completed before any IPC handler — including the open
    // handler — was registered, so a fresh open can never race the sweep.
    const sweepIdx = order.indexOf('sweep:stale-1,stale-2')
    const openIdx = order.findIndex((e) => e === 'register:ai:stream:open')
    expect(sweepIdx).toBeGreaterThanOrEqual(0)
    expect(openIdx).toBeGreaterThan(sweepIdx)
  })
})
