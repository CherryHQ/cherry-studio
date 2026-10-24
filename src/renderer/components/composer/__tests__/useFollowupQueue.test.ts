import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import { toast } from '@renderer/services/toast'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const ipcMocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcMocks.request } }))

import {
  FOLLOWUP_QUEUE_LIMIT,
  STALE_SENDING_CLAIM_MS,
  type FollowupQueueItem as FollowupQueueRow
} from '@shared/data/types/followupQueue'

import { persistBlobAttachments, useFollowupQueue } from '../useFollowupQueue'

const SCOPE = 's1'

const row = (
  id: string,
  text: string,
  status: FollowupQueueRow['status'] = 'pending',
  updatedAt = '2026-01-01T00:00:00.000Z'
): FollowupQueueRow => ({
  id,
  scopeKey: SCOPE,
  draft: { text, tokens: [] },
  payload: { text, userMessageParts: [] },
  status,
  sentAt: null,
  orderKey: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt
})

const draft = (text: string) => ({ text, tokens: [] }) as never
const payload = (text: string) => ({ text, userMessageParts: [] }) as never

function wireQuery(rows: FollowupQueueRow[], paused = false, stateUpdatedAt = '') {
  const refetch = vi.fn()
  const refetchState = vi.fn()
  mockUseQuery.mockImplementation((path: string) => {
    if (path === '/followup-queues') {
      return { data: rows, isLoading: false, isRefreshing: false, error: undefined, refetch, mutate: vi.fn() }
    }
    if (path === '/followup-queue-states') {
      return {
        data: { scopeKey: SCOPE, paused, createdAt: '', updatedAt: stateUpdatedAt },
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: refetchState,
        mutate: vi.fn()
      }
    }
    throw new Error(`unexpected query path ${path}`)
  })
  return { refetch, refetchState }
}

function wireMutations() {
  const postTrigger = vi.fn(async (): Promise<any> => undefined)
  const deleteTrigger = vi.fn(async (): Promise<any> => undefined)
  // Takes delete on their own SWR mutation instance (see useFollowupQueue):
  // the hook calls useMutation('DELETE', …) twice per render — remove/resolve
  // first, take second — so odd calls get the shared trigger, even the take one.
  const takeDeleteTrigger = vi.fn(async (): Promise<any> => undefined)
  let deleteCalls = 0
  const reorderTrigger = vi.fn(async (): Promise<any> => undefined)
  const claimTrigger = vi.fn(async (): Promise<any> => undefined)
  const claimHeadTrigger = vi.fn(async (): Promise<any> => undefined)
  const failTrigger = vi.fn(async (): Promise<any> => undefined)
  const markSentTrigger = vi.fn(async (): Promise<any> => undefined)
  const heartbeatTrigger = vi.fn(async (): Promise<any> => ({ live: true }))
  const setPausedTrigger = vi.fn(async (): Promise<any> => undefined)
  mockUseMutation.mockImplementation((method: string, path: string) => {
    if (method === 'POST' && path === '/followup-queues')
      return { trigger: postTrigger, isLoading: false, error: undefined }
    if (method === 'DELETE' && path === '/followup-queues/:id') {
      deleteCalls += 1
      const trigger = deleteCalls % 2 === 1 ? deleteTrigger : takeDeleteTrigger
      return { trigger, isLoading: false, error: undefined }
    }
    if (method === 'PATCH' && path === '/followup-queues/order:batch')
      return { trigger: reorderTrigger, isLoading: false, error: undefined }
    if (method === 'POST' && path === '/followup-queues/:id/claim')
      return { trigger: claimTrigger, isLoading: false, error: undefined }
    if (method === 'POST' && path === '/followup-queues/claim:head')
      return { trigger: claimHeadTrigger, isLoading: false, error: undefined }
    if (method === 'POST' && path === '/followup-queues/:id/fail')
      return { trigger: failTrigger, isLoading: false, error: undefined }
    if (method === 'POST' && path === '/followup-queues/:id/sent')
      return { trigger: markSentTrigger, isLoading: false, error: undefined }
    if (method === 'POST' && path === '/followup-queues/:id/heartbeat')
      return { trigger: heartbeatTrigger, isLoading: false, error: undefined }
    if (method === 'PUT' && path === '/followup-queue-states')
      return { trigger: setPausedTrigger, isLoading: false, error: undefined }
    throw new Error(`unexpected mutation ${method} ${path}`)
  })
  return {
    postTrigger,
    deleteTrigger,
    takeDeleteTrigger,
    reorderTrigger,
    claimTrigger,
    claimHeadTrigger,
    failTrigger,
    markSentTrigger,
    heartbeatTrigger,
    setPausedTrigger
  }
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    scopeKey: SCOPE,
    status: 'streaming' as const,
    lastCompletedAt: null as number | null,
    onDrain: vi.fn(async () => true),
    ...overrides
  }
}

describe('useFollowupQueue', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    MockCacheUtils.resetMocks()
    ipcMocks.request.mockReset()
  })

  it('surfaces the persisted rows as items', () => {
    wireQuery([row('h', 'head'), row('t', 'tail')])
    wireMutations()

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    expect(result.current.items.map((item) => item.draft.text)).toEqual(['head', 'tail'])
    expect(result.current.items.map((item) => item.payload.text)).toEqual(['head', 'tail'])
    expect(result.current.paused).toBe(false)
  })

  it('enqueues through the API and reports success', async () => {
    wireQuery([])
    const { postTrigger } = wireMutations()
    postTrigger.mockResolvedValueOnce(row('n', 'new'))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let queued = false
    await act(async () => {
      queued = await result.current.enqueue(draft('new'), payload('new'))
    })

    expect(queued).toBe(true)
    expect(postTrigger).toHaveBeenCalledWith({
      body: { id: expect.any(String), scopeKey: SCOPE, draft: draft('new'), payload: payload('new') }
    })
  })

  it('refuses to enqueue past the limit without calling the API', async () => {
    wireQuery(Array.from({ length: FOLLOWUP_QUEUE_LIMIT }, (_, i) => row(`id-${i}`, `item-${i}`)))
    const { postTrigger } = wireMutations()

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let queued = true
    await act(async () => {
      queued = await result.current.enqueue(draft('overflow'), payload('overflow'))
    })

    expect(queued).toBe(false)
    expect(postTrigger).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('chat.input.followup_queue.limit_reached')
  })

  it('reports a failed enqueue without clearing the draft', async () => {
    wireQuery([])
    const { postTrigger } = wireMutations()
    postTrigger.mockRejectedValueOnce(new Error('db down'))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let queued = true
    await act(async () => {
      queued = await result.current.enqueue(draft('a'), payload('a'))
    })

    expect(queued).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('drains the head through claim → send → delete on the idle edge', async () => {
    const head = row('h', 'head')
    wireQuery([head, row('t', 'tail')])
    const { claimHeadTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
    const onDrain = vi.fn(async () => true)

    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
      initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
    })

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
    expect(claimHeadTrigger).toHaveBeenCalledWith({
      body: { scopeKey: SCOPE, claimToken: expect.any(String), completionAt: 100 }
    })
    expect(onDrain).toHaveBeenCalledWith(head.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('marks the head failed and reports when the send fails', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
    const onDrain = vi.fn(async () => false)
    const onDrainFailed = vi.fn()

    const { rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain, onDrainFailed })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    expect(deleteTrigger).not.toHaveBeenCalled()
    expect(onDrainFailed).toHaveBeenCalledOnce()
  })

  it('waits for the initial queue and paused reads before draining', async () => {
    const head = row('h', 'head')
    const refetch = vi.fn()
    const refetchState = vi.fn()
    mockUseQuery.mockImplementation((path: string) => ({
      data: undefined,
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      refetch: path === '/followup-queues' ? refetch : refetchState,
      mutate: vi.fn()
    }))
    const { claimHeadTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
    const onDrain = vi.fn(async () => true)

    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
      initialProps: { completion: { status: 'done', lastCompletedAt: 100 } }
    })

    await act(async () => {})
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()

    mockUseQuery.mockImplementation((path: string) => {
      if (path === '/followup-queues') {
        return { data: [head], isLoading: false, isRefreshing: false, error: undefined, refetch, mutate: vi.fn() }
      }
      return {
        data: { scopeKey: SCOPE, paused: false, createdAt: '', updatedAt: '' },
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: refetchState,
        mutate: vi.fn()
      }
    })

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(claimHeadTrigger).toHaveBeenCalledWith({
      body: { scopeKey: SCOPE, claimToken: expect.any(String), completionAt: 100 }
    })
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
    expect(onDrain).toHaveBeenCalledWith(head.payload)
  })

  it('retries the claim once after a transient failure', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger } = wireMutations()
    claimHeadTrigger.mockRejectedValueOnce(new Error('ipc down'))
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
    const onDrain = vi.fn(async () => true)
    const onDrainFailed = vi.fn()

    const { rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain, onDrainFailed })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
    expect(onDrain).toHaveBeenCalledOnce()
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(onDrainFailed).not.toHaveBeenCalled()
  })

  it('leaves the completion edge unacked when the claim keeps failing', async () => {
    const { refetch } = wireQuery([row('h', 'head')])
    const { claimHeadTrigger } = wireMutations()
    claimHeadTrigger.mockRejectedValue(new Error('ipc down'))
    const onDrain = vi.fn(async () => true)
    const onDrainFailed = vi.fn()

    const { rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain, onDrainFailed })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()
    expect(onDrain).not.toHaveBeenCalled()
    expect(onDrainFailed).toHaveBeenCalledOnce()
    expect(refetch).toHaveBeenCalled()
  })

  it('retries the dequeue write after a successful send instead of replaying it', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
    deleteTrigger.mockRejectedValueOnce(new Error('db busy'))
    const onDrain = vi.fn(async () => true)

    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
      initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
    })

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(onDrain).toHaveBeenCalledOnce()
    expect(deleteTrigger).toHaveBeenCalledTimes(2)
    expect(failTrigger).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts when the dequeue write keeps failing after a successful send', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
    deleteTrigger.mockRejectedValue(new Error('db down'))
    const onDrain = vi.fn(async () => true)
    const onDrainFailed = vi.fn()

    const { rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain, onDrainFailed })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(onDrain).toHaveBeenCalledOnce()
    expect(deleteTrigger).toHaveBeenCalledTimes(3)
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
    expect(onDrainFailed).not.toHaveBeenCalled()
  })

  it('steers through claim → send → delete', async () => {
    const head = row('h', 'head')
    wireQuery([head])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    const send = vi.fn(async () => true)

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let steered = false
    await act(async () => {
      steered = await result.current.steer('h', send)
    })

    expect(steered).toBe(true)
    expect(claimTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    expect(send).toHaveBeenCalledWith(head.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('routes a steer through the shared completion accounting', async () => {
    // The manual send must record the current completion: a delayed automatic
    // claim for the same turn is then fenced instead of delivering a second
    // follow-up behind the steered one (cherry-pr-review). The turn is still
    // streaming so the automatic drain stays parked and the steer goes first.
    wireQuery([row('h', 'head')])
    const { claimTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    const send = vi.fn(async () => true)

    const { result } = renderHook(() => useFollowupQueue(baseProps({ lastCompletedAt: 100 })))

    let steered = false
    await act(async () => {
      steered = await result.current.steer('h', send)
    })

    expect(steered).toBe(true)
    expect(claimTrigger).toHaveBeenCalledWith({
      params: { id: 'h' },
      body: { claimToken: expect.any(String), completionAt: 100 }
    })
  })

  it('marks the steered item failed when its send fails', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    const send = vi.fn(async () => false)

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let steered = true
    await act(async () => {
      steered = await result.current.steer('h', send)
    })

    expect(steered).toBe(false)
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    expect(deleteTrigger).not.toHaveBeenCalled()
  })

  it('does not send a steer when another window wins the claim', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: false })
    const send = vi.fn(async () => true)

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let steered = true
    await act(async () => {
      steered = await result.current.steer('h', send)
    })

    expect(steered).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(deleteTrigger).not.toHaveBeenCalled()
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('returns false without sending a steer for an unknown id', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger } = wireMutations()
    const send = vi.fn(async () => true)

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let steered = true
    await act(async () => {
      steered = await result.current.steer('missing', send)
    })

    expect(steered).toBe(false)
    expect(claimTrigger).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('toasts when the steer claim request keeps failing', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger } = wireMutations()
    claimTrigger.mockRejectedValue(new Error('ipc down'))
    const send = vi.fn(async () => true)

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let steered = true
    await act(async () => {
      steered = await result.current.steer('h', send)
    })

    expect(steered).toBe(false)
    expect(claimTrigger).toHaveBeenCalledTimes(2)
    expect(send).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('drains the head that arrives after the completion edge', async () => {
    const head = row('h', 'head')
    const refetch = vi.fn()
    const refetchState = vi.fn()
    const queryImpl = (rows: FollowupQueueRow[]) => (path: string) => {
      if (path === '/followup-queues') {
        return { data: rows, isLoading: false, isRefreshing: false, error: undefined, refetch, mutate: vi.fn() }
      }
      return {
        data: { scopeKey: SCOPE, paused: false, createdAt: '', updatedAt: '' },
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: refetchState,
        mutate: vi.fn()
      }
    }
    mockUseQuery.mockImplementation(queryImpl([]))
    const { claimHeadTrigger, deleteTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
    const onDrain = vi.fn(async () => true)

    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
      initialProps: { completion: { status: 'done', lastCompletedAt: 100 } }
    })

    await act(async () => {})
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()

    mockUseQuery.mockImplementation(queryImpl([head]))
    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(claimHeadTrigger).toHaveBeenCalledWith({
      body: { scopeKey: SCOPE, claimToken: expect.any(String), completionAt: 100 }
    })
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
    expect(onDrain).toHaveBeenCalledWith(head.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
  })

  it('ignores rows from other scopes', async () => {
    const foreign = { ...row('h', 'head'), scopeKey: 'other-topic:other-assistant' }
    wireQuery([foreign])
    wireMutations()

    const { result, rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion })), {
      initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
    })

    expect(result.current.items).toEqual([])

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()
  })

  it('refuses to remove a freshly claimed item', async () => {
    wireQuery([row('h', 'head', 'sending', new Date().toISOString())])
    const { claimTrigger, deleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: false })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      result.current.removeId('h')
    })

    expect(claimTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    expect(deleteTrigger).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('removes a crash-orphaned sending item', async () => {
    wireQuery([row('h', 'head', 'sending', '2026-01-01T00:00:00.000Z')])
    const { claimTrigger, deleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      result.current.removeId('h')
    })

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
  })

  it('releases the remove back to the queue when its delete fails', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    deleteTrigger.mockRejectedValueOnce(new Error('db down'))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      result.current.removeId('h')
    })

    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('takes an item for edit and drops it from the queue', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, takeDeleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown
    await act(async () => {
      taken = await result.current.takeForEdit('h', () => null)
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('head')
    expect(claimTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    expect(takeDeleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('hydrates a taken persisted attachment into an editor-owned Blob before deleting the row', async () => {
    const persisted = row('h', 'head')
    ;(persisted as any).payload = {
      text: 'head',
      userMessageParts: [],
      attachments: [
        {
          id: 'shot',
          name: 'screenshot.png',
          origin_name: 'screenshot.png',
          ext: '.png',
          path: '/data/files/entry-1.png',
          entryId: 'entry-1'
        }
      ]
    }
    wireQuery([persisted])
    const { claimTrigger, takeDeleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    const bytes = new Uint8Array([1, 2, 3])
    ipcMocks.request.mockResolvedValueOnce({ content: bytes, mime: 'image/png' })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: any
    await act(async () => {
      taken = await result.current.takeForEdit('h', () => null)
    })

    const attachment = taken.payload.attachments[0]
    expect(attachment.blob).toBeInstanceOf(Blob)
    expect(attachment.blob.type).toBe('image/png')
    expect(attachment.blob.size).toBe(bytes.length)
    expect(ipcMocks.request).toHaveBeenCalledWith('file.read', {
      handle: { kind: 'entry', entryId: 'entry-1' },
      options: { mode: 'full', encoding: 'binary' }
    })
    // Ownership must be continuous: the editor owns the bytes before the
    // queue row's file refs close (cherry-pr-review inv_e39933046420a12b).
    expect(ipcMocks.request.mock.invocationCallOrder[0]).toBeLessThan(takeDeleteTrigger.mock.invocationCallOrder[0])
  })

  it('refuses the take and keeps the row queued when attachment hydration fails', async () => {
    const persisted = row('h', 'head')
    ;(persisted as any).payload = {
      text: 'head',
      userMessageParts: [],
      attachments: [
        {
          id: 'shot',
          name: 'screenshot.png',
          origin_name: 'screenshot.png',
          ext: '.png',
          path: '/data/files/entry-1.png',
          entryId: 'entry-1'
        }
      ]
    }
    wireQuery([persisted])
    const { claimTrigger, takeDeleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    ipcMocks.request.mockRejectedValueOnce(new Error('transient read failure'))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: any = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h', () => null)
    })

    // The take is refused: the row (and its file refs) stays queued, the claim
    // is released, and nothing reaches the editor (cherry-pr-review
    // inv_3643f7c7dc08a171).
    expect(taken).toBeUndefined()
    expect(takeDeleteTrigger).not.toHaveBeenCalled()
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('refuses the edit take when another window owns the send', async () => {
    wireQuery([row('h', 'head', 'sending', new Date().toISOString())])
    const { claimTrigger, takeDeleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: false })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h', () => null)
    })

    expect(taken).toBeUndefined()
    expect(takeDeleteTrigger).not.toHaveBeenCalled()
  })

  it('releases the take back to the queue when its delete keeps failing', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, takeDeleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    takeDeleteTrigger.mockRejectedValue(new Error('db down'))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h', () => null)
    })

    expect(taken).toBeUndefined()
    expect(takeDeleteTrigger).toHaveBeenCalledTimes(2)
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('retries the take delete once before releasing it', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, takeDeleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    takeDeleteTrigger.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h', () => null)
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('head')
    expect(takeDeleteTrigger).toHaveBeenCalledTimes(2)
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('returns the take when the delete commits but its response is lost', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, takeDeleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    // First DELETE commits server-side but times out; the retry then reports
    // NOT_FOUND, proving the row is already gone — the draft must be handed
    // to the editor instead of dropped.
    takeDeleteTrigger
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new DataApiError(ErrorCode.NOT_FOUND, 'fake queue: missing id h', 404))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h', () => null)
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('head')
    expect(takeDeleteTrigger).toHaveBeenCalledTimes(2)
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('returns the take when the first delete attempt reports the row already gone', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, takeDeleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    // The transport retries a timed-out DELETE and surfaces the retry's
    // NOT_FOUND on the first attempt — our own commit, so hand over the draft.
    takeDeleteTrigger.mockRejectedValue(new DataApiError(ErrorCode.NOT_FOUND, 'fake queue: missing id h', 404))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h', () => null)
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('head')
    expect(takeDeleteTrigger).toHaveBeenCalledTimes(1)
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('returns the draft to its scope when the scope moves during the take delete', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, takeDeleteTrigger, postTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
    let resolveDelete!: () => void
    takeDeleteTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      })
    )

    const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
      initialProps: { scopeKey: SCOPE }
    })

    let taken: unknown = 'unset'
    await act(async () => {
      void result.current
        .takeForEdit('h', () => null)
        .then((value) => {
          taken = value
        })
    })
    // Switch conversations while DELETE is pending: the deleted row must go
    // back to its own scope instead of restoring into the new composer.
    await act(async () => {
      rerender({ scopeKey: 's2' })
    })
    await act(async () => {
      resolveDelete()
    })

    expect(taken).toBeUndefined()
    expect(postTrigger).toHaveBeenCalledWith({
      body: { id: expect.any(String), scopeKey: SCOPE, draft: draft('head'), payload: payload('head') }
    })
  })

  it('releases the take claim without deleting when the hook unmounts mid-claim', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, takeDeleteTrigger, failTrigger, postTrigger } = wireMutations()
    let resolveClaim!: (value: { claimed: true; alreadySent: boolean }) => void
    claimTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClaim = resolve
      })
    )

    const { result, unmount } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      void result.current
        .takeForEdit('h', () => null)
        .then((value) => {
          taken = value
        })
    })
    // Navigate away while the claim is in flight.
    await act(async () => {
      unmount()
    })
    await act(async () => {
      resolveClaim({ claimed: true, alreadySent: false })
    })
    await act(async () => {})

    expect(taken).toBeUndefined()
    expect(takeDeleteTrigger).not.toHaveBeenCalled()
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    expect(postTrigger).not.toHaveBeenCalled()
  })

  it('re-enqueues the taken item when the hook unmounts while its delete is pending', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, takeDeleteTrigger, failTrigger, postTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
    let resolveDelete!: () => void
    takeDeleteTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      })
    )

    const { result, unmount } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      void result.current
        .takeForEdit('h', () => null)
        .then((value) => {
          taken = value
        })
    })
    // Navigate away while DELETE is pending: the committed delete must not lose
    // the draft — it goes back to the end of its own scope's queue.
    await act(async () => {
      unmount()
    })
    await act(async () => {
      resolveDelete()
    })

    expect(taken).toBeUndefined()
    expect(failTrigger).not.toHaveBeenCalled()
    expect(postTrigger).toHaveBeenCalledWith({
      body: { id: expect.any(String), scopeKey: SCOPE, draft: draft('head'), payload: payload('head') }
    })
  })

  it('restores a scope-moved take from the hydrated attachment bytes, not the stale entry id', async () => {
    // The taken row's managed attachment becomes cleanup-eligible in the
    // window between the committed DELETE and the restore; a recovery that
    // keeps only the row's old entry id loses the draft's bytes with it
    // (cherry-pr-review inv_47152cb370dd7fef).
    const persisted = row('h', 'head')
    ;(persisted as any).payload = {
      text: 'head',
      userMessageParts: [],
      attachments: [
        {
          id: 'shot',
          name: 'screenshot.png',
          origin_name: 'screenshot.png',
          ext: '.png',
          path: '/data/files/entry-1.png',
          entryId: 'entry-1'
        }
      ]
    }
    wireQuery([persisted])
    const { claimTrigger, takeDeleteTrigger, postTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
    let resolveDelete!: () => void
    takeDeleteTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      })
    )
    const bytes = new Uint8Array([1, 2, 3])
    ipcMocks.request.mockResolvedValueOnce({ content: bytes, mime: 'image/png' })
    // jsdom's Blob lacks arrayBuffer(); the renderer's Chromium Blob has it.
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer
    })
    const createInternalEntry = vi.fn(async () => ({ id: 'entry-fresh' }))
    const getPhysicalPath = vi.fn(async () => '/data/files/entry-fresh.png')
    const previousApi = (window as any).api
    ;(window as any).api = { ...previousApi, file: { ...previousApi?.file, createInternalEntry, getPhysicalPath } }

    try {
      const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
        initialProps: { scopeKey: SCOPE }
      })

      let taken: unknown = 'unset'
      await act(async () => {
        void result.current
          .takeForEdit('h', () => null)
          .then((value) => {
            taken = value
          })
      })
      await act(async () => {
        rerender({ scopeKey: 's2' })
      })
      await act(async () => {
        resolveDelete()
      })

      expect(taken).toBeUndefined()
      expect(postTrigger).toHaveBeenCalledTimes(1)
      const body = (postTrigger.mock.calls as unknown as Array<[{ body: any }]>)[0][0].body
      expect(body.scopeKey).toBe(SCOPE)
      const restored = body.payload.attachments[0]
      // Recovery owns live bytes: a fresh managed entry persisted from the
      // hydrated Blob, never the taken row's reclaimable entry id.
      expect(restored.entryId).toBe('entry-fresh')
      expect(restored.path).toBe('/data/files/entry-fresh.png')
      expect(restored.blob).toBeUndefined()
      expect(body.fileEntryIds).toEqual(['entry-fresh'])
      expect(createInternalEntry).toHaveBeenCalledTimes(1)
    } finally {
      ;(window as any).api = previousApi
      delete (Blob.prototype as any).arrayBuffer
    }
  })

  it('rebuilds an orphaned scope-moved restore from the hydrated bytes on each background retry', async () => {
    vi.useFakeTimers()
    const persisted = row('h', 'head')
    ;(persisted as any).payload = {
      text: 'head',
      userMessageParts: [],
      attachments: [
        {
          id: 'shot',
          name: 'screenshot.png',
          origin_name: 'screenshot.png',
          ext: '.png',
          path: '/data/files/entry-1.png',
          entryId: 'entry-1'
        }
      ]
    }
    wireQuery([persisted])
    const { claimTrigger, takeDeleteTrigger, postTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
    let resolveDelete!: () => void
    takeDeleteTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      })
    )
    const bytes = new Uint8Array([1, 2, 3])
    ipcMocks.request.mockResolvedValueOnce({ content: bytes, mime: 'image/png' })
    // jsdom's Blob lacks arrayBuffer(); the renderer's Chromium Blob has it.
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer
    })
    // Inline persistence fails; the background retry's rebuild must still
    // persist from the hydrated Blob rather than the taken row's stale entry id.
    const createInternalEntry = vi.fn(async () => ({ id: 'entry-fresh' })).mockRejectedValueOnce(new Error('disk busy'))
    const getPhysicalPath = vi.fn(async () => '/data/files/entry-fresh.png')
    const previousApi = (window as any).api
    ;(window as any).api = { ...previousApi, file: { ...previousApi?.file, createInternalEntry, getPhysicalPath } }

    try {
      const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
        initialProps: { scopeKey: SCOPE }
      })

      await act(async () => {
        void result.current.takeForEdit('h', () => null)
      })
      await act(async () => {
        rerender({ scopeKey: 's2' })
      })
      await act(async () => {
        resolveDelete()
      })
      await act(async () => {})
      expect(postTrigger).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(1)
      const body = (postTrigger.mock.calls as unknown as Array<[{ body: any }]>)[0][0].body
      const restored = body.payload.attachments[0]
      expect(restored.entryId).toBe('entry-fresh')
      expect(restored.blob).toBeUndefined()
      expect(body.fileEntryIds).toEqual(['entry-fresh'])
    } finally {
      ;(window as any).api = previousApi
      delete (Blob.prototype as any).arrayBuffer
      vi.useRealTimers()
    }
  })

  it('does not restore a take for an item that was already sent', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, takeDeleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h', () => null)
    })

    // The delete above is the correct dequeue; restoring its draft would
    // invite resending content that already went out.
    expect(taken).toBeUndefined()
    expect(takeDeleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
  })

  it('deletes takes on their own trigger instance', async () => {
    // SWR discards an older trigger's rejection once a newer trigger starts on
    // the same mutation instance, which would mask a failed take delete as
    // success and hand out a draft whose row remains. Takes therefore delete
    // on a dedicated instance that remove/resolve never share.
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, takeDeleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValue({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h', () => null)
    })
    await act(async () => {
      result.current.removeId('h')
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('head')
    expect(takeDeleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(takeDeleteTrigger).not.toBe(deleteTrigger)
  })

  it('retries the scope-mismatch restore until the replacement enqueue lands', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, takeDeleteTrigger, postTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
    let resolveDelete!: () => void
    takeDeleteTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      })
    )
    postTrigger
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({})

    const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
      initialProps: { scopeKey: SCOPE }
    })

    let taken: unknown = 'unset'
    await act(async () => {
      void result.current
        .takeForEdit('h', () => null)
        .then((value) => {
          taken = value
        })
    })
    await act(async () => {
      rerender({ scopeKey: 's2' })
    })
    await act(async () => {
      resolveDelete()
    })
    await act(async () => {})

    expect(taken).toBeUndefined()
    expect(postTrigger).toHaveBeenCalledTimes(3)
    expect(postTrigger).toHaveBeenCalledWith({
      body: { id: expect.any(String), scopeKey: SCOPE, draft: draft('head'), payload: payload('head') }
    })
    // Retries reuse one idempotency key so a committed insert is not duplicated.
    const retryIds = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>).map(
      ([args]) => args.body.id
    )
    expect(new Set(retryIds).size).toBe(1)
  })

  it('retries an orphaned restore in the background until the enqueue lands', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimTrigger, takeDeleteTrigger, postTrigger } = wireMutations()
      claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
      let resolveDelete!: () => void
      takeDeleteTrigger.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDelete = () => resolve(undefined)
        })
      )
      postTrigger.mockRejectedValue(new Error('db down'))

      const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
        initialProps: { scopeKey: SCOPE }
      })

      let taken: unknown = 'unset'
      await act(async () => {
        void result.current
          .takeForEdit('h', () => null)
          .then((value) => {
            taken = value
          })
      })
      await act(async () => {
        rerender({ scopeKey: 's2' })
      })
      await act(async () => {
        resolveDelete()
      })
      await act(async () => {})
      expect(taken).toBeUndefined()
      expect(postTrigger).toHaveBeenCalledTimes(3)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(4)
      expect(postTrigger).toHaveBeenLastCalledWith({
        body: { id: expect.any(String), scopeKey: SCOPE, draft: draft('head'), payload: payload('head') }
      })
      const backgroundIds = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>).map(
        ([args]) => args.body.id
      )
      expect(new Set(backgroundIds).size).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops retrying an orphaned restore once its conversation is permanently deleted', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimTrigger, takeDeleteTrigger, postTrigger } = wireMutations()
      claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
      let resolveDelete!: () => void
      takeDeleteTrigger.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDelete = () => resolve(undefined)
        })
      )
      postTrigger
        .mockRejectedValueOnce(new Error('db down'))
        .mockRejectedValueOnce(new Error('db down'))
        .mockRejectedValueOnce(new Error('db down'))
        // The conversation is deleted before the background retry: the service refuses the insert.
        .mockRejectedValue(new DataApiError(ErrorCode.NOT_FOUND, "Topic with id 's1' not found", 404))

      const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
        initialProps: { scopeKey: SCOPE }
      })

      await act(async () => {
        void result.current.takeForEdit('h', () => null)
      })
      await act(async () => {
        rerender({ scopeKey: 's2' })
      })
      await act(async () => {
        resolveDelete()
      })
      await act(async () => {})
      expect(postTrigger).toHaveBeenCalledTimes(3)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(4)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the outgoing edit to its slot with the rebuilt draft when switching targets', async () => {
    wireQuery([row('a', 'first'), row('b', 'second')])
    const { claimTrigger, takeDeleteTrigger, postTrigger, reorderTrigger } = wireMutations()
    claimTrigger.mockResolvedValue({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      await result.current.takeForEdit('a', () => null)
    })
    const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
    let taken: unknown
    await act(async () => {
      taken = await result.current.takeForEdit('b', captureOutgoing)
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('second')
    expect(captureOutgoing).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
    // The restored copy carries a fresh id: the original row closed when it
    // was taken, so a same-id enqueue would settle against the receipt
    // without storing the edited draft.
    expect(postTrigger).toHaveBeenCalledWith({
      body: {
        id: expect.any(String),
        scopeKey: SCOPE,
        draft: { text: 'first edited', tokens: [] },
        payload: { text: 'first edited', userMessageParts: [] },
        held: true,
        // The restore lands at its slot atomically with the insert — no
        // reorder can be claim-barred out of it (inv_9ecff9fca3bdab04).
        anchor: { position: 'first' }
      }
    })
    const restoreId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0][0].body.id
    expect(restoreId).not.toBe('a')
    // The restore is born held; once the incoming take commits and editor
    // ownership transfers, the same copy is re-POSTed unheld so it becomes
    // claimable as ordinary pending content (cherry-pr-review).
    expect(postTrigger).toHaveBeenCalledTimes(2)
    const releaseBody = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string; held?: boolean } }]>)[1][0]
      .body
    expect(releaseBody).toEqual(expect.objectContaining({ id: restoreId, held: false }))
    // 'a' was taken from slot 0, so its rebuilt copy goes back to the head.
    expect(reorderTrigger).toHaveBeenCalledWith({ body: { moves: [{ id: restoreId, anchor: { position: 'first' } }] } })
    expect(takeDeleteTrigger).toHaveBeenCalledWith({ params: { id: 'b' } })
  })

  it('retries the slot restore across a peer claim conflict so the edit keeps its position (inv_9ecff9fca3bdab04)', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second'), row('c', 'third')])
      const { claimTrigger, takeDeleteTrigger, postTrigger, reorderTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      // A peer's live claim (its in-flight send) bars the first reorder; the
      // barrier lifts once the send settles.
      reorderTrigger
        .mockRejectedValueOnce(new DataApiError(ErrorCode.CONFLICT, 'reorder conflicts with an in-flight send', 409))
        .mockResolvedValue(undefined)

      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        void result.current.takeForEdit('a', () => null)
      })
      await act(async () => {})
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      let switched = false
      await act(async () => {
        void result.current.takeForEdit('b', captureOutgoing).then(() => {
          switched = true
        })
      })
      await act(async () => {})
      // The first attempt conflicts with the peer's claim; the flow parks in
      // the retry window instead of swallowing the position.
      expect(reorderTrigger).toHaveBeenCalledTimes(1)
      expect(switched).toBe(false)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      expect(switched).toBe(true)
      expect(reorderTrigger).toHaveBeenCalledTimes(2)
      expect(postTrigger).toHaveBeenCalledTimes(2)
      expect(takeDeleteTrigger).toHaveBeenCalledWith({ params: { id: 'b' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('completes the handoff at the tail when a peer claim outlives the retry window (inv_9ecff9fca3bdab04)', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second'), row('c', 'third')])
      const { claimTrigger, takeDeleteTrigger, postTrigger, reorderTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      // A peer's send holds the live-claim barrier past the bounded recovery
      // window: every attempt conflicts. The switch must still complete —
      // the restored copy stays safe (and deliverable) at the tail rather
      // than blocking the handoff or dropping the draft.
      reorderTrigger.mockRejectedValue(
        new DataApiError(ErrorCode.CONFLICT, 'reorder conflicts with an in-flight send', 409)
      )

      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        void result.current.takeForEdit('a', () => null)
      })
      await act(async () => {})
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      let switched = false
      await act(async () => {
        void result.current.takeForEdit('b', captureOutgoing).then(() => {
          switched = true
        })
      })
      await act(async () => {})
      expect(reorderTrigger).toHaveBeenCalledTimes(1)
      expect(switched).toBe(false)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400 * 4)
      })
      expect(switched).toBe(true)
      expect(reorderTrigger).toHaveBeenCalledTimes(4)
      expect(postTrigger).toHaveBeenCalledTimes(2)
      expect(takeDeleteTrigger).toHaveBeenCalledWith({ params: { id: 'b' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('anchors the restore after the row preceding its slot when taken from mid-queue (inv_9ecff9fca3bdab04)', async () => {
    wireQuery([row('a', 'first'), row('b', 'second'), row('c', 'third')])
    const { claimTrigger, postTrigger } = wireMutations()
    claimTrigger.mockResolvedValue({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      await result.current.takeForEdit('b', () => null)
    })
    const captureOutgoing = vi.fn(() => ({ draft: draft('second edited'), payload: payload('second edited') }))
    await act(async () => {
      await result.current.takeForEdit('c', captureOutgoing)
    })
    const body = (postTrigger.mock.calls as unknown as Array<[{ body: { anchor?: unknown } }]>)[0][0].body
    // 'b' was taken from slot 1: the restore anchors after the row preceding
    // that slot, so the insert itself carries the position.
    expect(body.anchor).toEqual({ after: 'a' })
  })

  it('skips the reorder pass once refreshed items confirm the anchored placement, however long the claim lasts (inv_9ecff9fca3bdab04)', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, postTrigger, reorderTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      // The reorder stays claim-barred — a peer's send outlives the whole
      // retry window.
      reorderTrigger.mockRejectedValue(
        new DataApiError(ErrorCode.CONFLICT, 'reorder conflicts with an in-flight send', 409)
      )

      const { result, rerender } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        void result.current.takeForEdit('a', () => null)
      })
      await act(async () => {})
      let switched = false
      await act(async () => {
        void result.current
          .takeForEdit('b', () => ({ draft: draft('first edited'), payload: payload('first edited') }))
          .then(() => {
            switched = true
          })
      })
      await act(async () => {})
      expect(reorderTrigger).toHaveBeenCalledTimes(1)

      // The anchored INSERT already placed the copy: once the refreshed items
      // confirm it, no further reorder is attempted and nothing surfaces.
      const restoreId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0][0].body.id
      wireQuery([row(restoreId, 'first edited'), row('b', 'second')])
      rerender()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400 * 5)
      })
      expect(switched).toBe(true)
      expect(reorderTrigger).toHaveBeenCalledTimes(1)
      expect(toast.error).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry the slot restore on a non-conflict failure (inv_9ecff9fca3bdab04)', async () => {
    wireQuery([row('a', 'first'), row('b', 'second')])
    const { claimTrigger, takeDeleteTrigger, reorderTrigger } = wireMutations()
    claimTrigger.mockResolvedValue({ claimed: true })
    reorderTrigger.mockRejectedValueOnce(new Error('db gone'))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      await result.current.takeForEdit('a', () => null)
    })
    const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
    await act(async () => {
      await result.current.takeForEdit('b', captureOutgoing)
    })
    // A non-transient failure keeps the draft safe at the tail: no retry.
    expect(reorderTrigger).toHaveBeenCalledTimes(1)
    expect(takeDeleteTrigger).toHaveBeenCalledWith({ params: { id: 'b' } })
  })

  it('refuses the switch when captureOutgoing cannot build a message', async () => {
    wireQuery([row('a', 'first'), row('b', 'second')])
    const { claimTrigger, takeDeleteTrigger, postTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValue({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      await result.current.takeForEdit('a', () => null)
    })
    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('b', () => null)
    })

    expect(taken).toBeUndefined()
    expect(postTrigger).not.toHaveBeenCalled()
    expect(takeDeleteTrigger).not.toHaveBeenCalledWith({ params: { id: 'b' } })
    // The won claim on 'b' is released so the row returns to the queue.
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'b' }, body: { claimToken: expect.any(String) } })
  })

  it('ignores a re-take of the item already being edited', async () => {
    wireQuery([row('a', 'first')])
    const { claimTrigger } = wireMutations()
    claimTrigger.mockResolvedValue({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      await result.current.takeForEdit('a', () => null)
    })
    let again: unknown = 'unset'
    await act(async () => {
      again = await result.current.takeForEdit('a', () => null)
    })

    expect(again).toBeUndefined()
    expect(claimTrigger).toHaveBeenCalledTimes(1)
  })

  it('does not requeue the previous edit after releaseEdit', async () => {
    wireQuery([row('a', 'first'), row('b', 'second')])
    const { claimTrigger, takeDeleteTrigger, postTrigger } = wireMutations()
    claimTrigger.mockResolvedValue({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      await result.current.takeForEdit('a', () => null)
    })
    act(() => {
      result.current.releaseEdit()
    })
    const captureOutgoing = vi.fn(() => ({ draft: draft('x'), payload: payload('x') }))
    let taken: unknown
    await act(async () => {
      taken = await result.current.takeForEdit('b', captureOutgoing)
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('second')
    expect(captureOutgoing).not.toHaveBeenCalled()
    expect(postTrigger).not.toHaveBeenCalled()
    expect(takeDeleteTrigger).toHaveBeenCalledWith({ params: { id: 'b' } })
  })

  it('cancels the background restore retry of a refused switch when the edit session ends', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, postTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      postTrigger.mockRejectedValue(new Error('queue full'))

      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      let taken: unknown = 'unset'
      await act(async () => {
        taken = await result.current.takeForEdit('b', captureOutgoing)
      })
      // Refused: 'a' stays in the editor and the restore retries in the background.
      expect(taken).toBeUndefined()
      expect(postTrigger).toHaveBeenCalledTimes(3)

      act(() => {
        result.current.releaseEdit()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 1000)
      })
      // The retry never re-creates the edited item after send/clear.
      expect(postTrigger).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removes a background restore that landed while the item was still edited when the session ends', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, postTrigger, deleteTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      postTrigger
        .mockRejectedValueOnce(new Error('queue full'))
        .mockRejectedValueOnce(new Error('queue full'))
        .mockRejectedValueOnce(new Error('queue full'))

      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      let taken: unknown = 'unset'
      await act(async () => {
        taken = await result.current.takeForEdit('b', captureOutgoing)
      })
      expect(taken).toBeUndefined()

      // Space opens while 'a' is still in the editor: the retry lands.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(4)
      const restoreId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0][0].body.id

      // Ending the session (sent/cleared/replaced) removes the landed copy:
      // the queue must not keep a deliverable duplicate of what was in the editor.
      await act(async () => {
        result.current.releaseEdit()
      })
      await act(async () => {})
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: restoreId } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers no restore retry when the edit session ends while the claim release is in flight (inv_dc0d409a37700e67)', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, postTrigger, failTrigger, deleteTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      // All three restoration requests fail; the claim release stays pending
      // until the composer has already unmounted.
      postTrigger.mockRejectedValue(new Error('queue full'))
      let resolveRelease!: () => void
      failTrigger.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveRelease = () => resolve(undefined)
        })
      )

      const { result, unmount } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      let settle!: () => void
      const switched = new Promise<void>((resolve) => {
        settle = resolve
      })
      await act(async () => {
        void result.current.takeForEdit('b', captureOutgoing).then(() => settle())
        await Promise.resolve()
      })
      // The three restore attempts have failed; the release is still in flight.
      expect(postTrigger).toHaveBeenCalledTimes(3)
      const restoreId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0][0].body.id

      // Navigate away before the release settles: cleanup runs before any
      // recovery record exists, so the old code's uncancelled retry would
      // insert the copy into the retired session (cherry-pr-review
      // inv_dc0d409a37700e67#f1).
      act(() => {
        unmount()
      })
      await act(async () => {
        resolveRelease()
        await switched
      })

      // No retry was registered: the copy is never re-inserted, and any copy
      // a failed attempt already committed is closed instead.
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: restoreId } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 1000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes a possibly committed restore copy when the session ends before an insert is acknowledged (inv_7deabefd1c4c947c)', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, postTrigger, deleteTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      // Every restore write reports failure; any of them may still have
      // committed server-side (lost response), so the tracked record stays
      // restored: false with the row possibly live in the queue
      // (cherry-pr-review inv_7deabefd1c4c947c#f1).
      postTrigger.mockRejectedValue(new Error('response lost'))

      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      await act(async () => {
        await result.current.takeForEdit('b', captureOutgoing)
      })
      expect(postTrigger).toHaveBeenCalledTimes(3)
      const restoreId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0][0].body.id

      // The background retry's insert is also unacknowledged: as far as the
      // hook knows, nothing ever landed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(4)

      // Clearing the still-visible outgoing draft ends the edit session: the
      // possibly committed copy must be closed, not abandoned to the hold
      // expiry and a cleared-content or duplicate delivery
      // (cherry-pr-review inv_7deabefd1c4c947c#f1).
      await act(async () => {
        result.current.releaseEdit()
      })
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: restoreId } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps cleanup ownership of the landed copy when the abandon-path removal fails transiently (inv_f89db3564dc86774)', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, takeDeleteTrigger, postTrigger, deleteTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true, alreadySent: false })
      // A's take delete resolves; B's stays pending until the scope has moved.
      let resolveDelete!: () => void
      takeDeleteTrigger.mockResolvedValueOnce(undefined).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDelete = () => resolve(undefined)
        })
      )

      const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
        initialProps: { scopeKey: SCOPE }
      })

      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      await act(async () => {
        void result.current.takeForEdit('b', captureOutgoing)
      })
      await act(async () => {})
      expect(postTrigger).toHaveBeenCalledTimes(1)

      await act(async () => {
        rerender({ scopeKey: 's2' })
      })
      // The abandon-path removal keeps failing transiently: cleanup ownership
      // must move to the resolve retry chain instead of abandoning the held
      // copy to the hold expiry and a duplicate delivery (cherry-pr-review
      // inv_f89db3564dc86774).
      deleteTrigger.mockRejectedValue(new Error('temporary outage'))
      await act(async () => {
        resolveDelete()
      })
      await act(async () => {})
      expect(deleteTrigger).toHaveBeenCalledTimes(3)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(deleteTrigger.mock.calls.length).toBeGreaterThan(3)
      deleteTrigger.mockClear().mockResolvedValue(undefined)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      // The retried removal succeeded: the chain stops.
      expect(deleteTrigger.mock.calls.length).toBeLessThanOrEqual(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the held recovery copy when the consumer unmounts with a live edit session (inv_4e8303d70c4d5b9d)', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, takeDeleteTrigger, postTrigger, deleteTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true, alreadySent: false })
      // A's take delete resolves; BOTH of B's take-delete attempts fail, so
      // the take refuses and A's restored copy stays held and tracked — the
      // edit session is still live.
      takeDeleteTrigger.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('delete failed'))

      const { result, unmount } = renderHook(() => useFollowupQueue(baseProps({ scopeKey: SCOPE })))
      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      await act(async () => {
        await result.current.takeForEdit('b', captureOutgoing)
      })
      await act(async () => {})
      expect(postTrigger).toHaveBeenCalled()
      const heldCopyId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0]?.[0].body.id

      // Navigate away with the edit session live: the composer cache owns the
      // draft, so the held recovery row is redundant. Unmount must close it —
      // a transient failure joins the resolve retry chain, which survives
      // unmount — instead of abandoning renewal and letting the row age back
      // into claimability for a duplicate delivery (cherry-pr-review
      // inv_4e8303d70c4d5b9d).
      const deletionsBeforeUnmount = deleteTrigger.mock.calls.length
      deleteTrigger.mockRejectedValueOnce(new Error('temporary outage'))
      await act(async () => {
        unmount()
      })
      await act(async () => {})
      const closesForCopy = () =>
        (deleteTrigger.mock.calls as unknown as Array<[{ params?: { id?: string } }]>).filter(
          (c) => c[0].params?.id === heldCopyId
        ).length
      expect(closesForCopy()).toBeGreaterThanOrEqual(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      // The first close failed transiently: the retry chain fired again.
      expect(deleteTrigger.mock.calls.length).toBeGreaterThan(deletionsBeforeUnmount + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes a recovery copy whose registration lands after unmount cleanup (inv_b47d9657e7639e5b)', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, takeDeleteTrigger, postTrigger, deleteTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true, alreadySent: false })
      // A's take delete resolves; B's take delete stays in flight until the
      // test releases it — both attempts fail AFTER unmount.
      const deleteRejections: Array<(error: Error) => void> = []
      takeDeleteTrigger.mockResolvedValueOnce(undefined).mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            deleteRejections.push(reject)
          })
      )

      const { result, unmount } = renderHook(() => useFollowupQueue(baseProps({ scopeKey: SCOPE })))
      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      let switchPromise!: Promise<unknown>
      act(() => {
        switchPromise = result.current.takeForEdit('b', captureOutgoing)
      })
      // Flush until B's first take-delete attempt is in flight.
      await act(async () => {})
      await act(async () => {})
      expect(takeDeleteTrigger.mock.calls.length).toBe(2)
      expect(postTrigger).toHaveBeenCalled()
      const heldCopyId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0]?.[0].body.id

      // Navigate away while the DELETE response is pending: unmount cleanup
      // runs before the registration below lands.
      await act(async () => {
        unmount()
      })

      // Both DELETE attempts fail now: the refused switch tries to register
      // A's held recovery after cleanup already ran. The late registration
      // must close the redundant copy (retaining cleanup retries) instead of
      // attaching it to a session nobody will end — renewal maintenance exits
      // on unmount, so the row would age back into claimability and duplicate
      // the composer-cached draft (cherry-pr-review inv_b47d9657e7639e5b).
      deleteTrigger.mockRejectedValueOnce(new Error('temporary outage'))
      await act(async () => {
        deleteRejections[0](new Error('delete failed'))
      })
      await act(async () => {
        deleteRejections[1](new Error('delete failed'))
      })
      await act(async () => {
        await switchPromise
      })
      await act(async () => {})
      const closesForCopy = () =>
        (deleteTrigger.mock.calls as unknown as Array<[{ params?: { id?: string } }]>).filter(
          (c) => c[0].params?.id === heldCopyId
        ).length
      expect(closesForCopy()).toBeGreaterThanOrEqual(1)
      // The first close failed transiently: the retry chain fires again.
      const closesSoFar = closesForCopy()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(closesForCopy()).toBeGreaterThan(closesSoFar)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the held recovery copy when the scope switches with a live edit session (inv_4e8303d70c4d5b9d)', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, takeDeleteTrigger, postTrigger, deleteTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true, alreadySent: false })
      takeDeleteTrigger.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('delete failed'))

      const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
        initialProps: { scopeKey: SCOPE }
      })
      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      await act(async () => {
        await result.current.takeForEdit('b', captureOutgoing)
      })
      await act(async () => {})
      expect(postTrigger).toHaveBeenCalled()
      const heldCopyId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0]?.[0].body.id

      // Switching scope retires the old scope's edit session: its held
      // recovery row must be closed, not left to the hold expiry
      // (cherry-pr-review inv_4e8303d70c4d5b9d).
      await act(async () => {
        rerender({ scopeKey: 's2' })
      })
      await act(async () => {})
      expect(
        (deleteTrigger.mock.calls as unknown as Array<[{ params?: { id?: string } }]>).filter(
          (c) => c[0].params?.id === heldCopyId
        ).length
      ).toBeGreaterThanOrEqual(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispatches a won claim when only its own broadcast refresh is in flight (inv_16b576017347a966)', async () => {
    let refreshing = false
    mockUseQuery.mockImplementation((path: string) => {
      if (path === '/followup-queues') {
        return {
          data: [row('h', 'head')],
          isLoading: false,
          isRefreshing: refreshing,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }
      }
      if (path === '/followup-queue-states') {
        return {
          data: { scopeKey: SCOPE, paused: false, createdAt: '', updatedAt: '' },
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }
      }
      throw new Error(`unexpected query path ${path}`)
    })
    const { claimHeadTrigger } = wireMutations()
    let resolveClaim!: (value: unknown) => void
    claimHeadTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClaim = resolve
      })
    )
    const onDrain = vi.fn(async () => true)
    const { rerender } = renderHook(
      ({ status, lastCompletedAt }: { status: 'streaming' | 'done'; lastCompletedAt: number | null }) =>
        useFollowupQueue(baseProps({ status, lastCompletedAt, onDrain })),
      { initialProps: { status: 'streaming' as 'streaming' | 'done', lastCompletedAt: null as number | null } }
    )

    await act(async () => {
      rerender({ status: 'done', lastCompletedAt: 100 })
    })
    expect(claimHeadTrigger).toHaveBeenCalledTimes(1)

    // The claim's own broadcast starts queue revalidation before the grant
    // lands. Pre-claim readiness must not read as post-claim dispatch
    // safety: only Pause/ownership may release a won claim without delivery
    // (cherry-pr-review inv_16b576017347a966).
    refreshing = true
    await act(async () => {
      rerender({ status: 'done', lastCompletedAt: 100 })
    })
    await act(async () => {
      resolveClaim({ claimed: true, id: 'h', alreadySent: false })
      await Promise.resolve()
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
  })

  it('retries the restored-copy cleanup when the delete fails transiently after the edit session ends', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, postTrigger, deleteTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      postTrigger
        .mockRejectedValueOnce(new Error('queue full'))
        .mockRejectedValueOnce(new Error('queue full'))
        .mockRejectedValueOnce(new Error('queue full'))

      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      await act(async () => {
        await result.current.takeForEdit('b', captureOutgoing)
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(4)
      const restoreId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0][0].body.id

      // A transient DELETE failure must not strand the copy past the held
      // window, where a later completion would deliver cleared or duplicated
      // content (cherry-pr-review inv_a9a4ae6a7ed17c68).
      deleteTrigger.mockRejectedValueOnce(new Error('temporary outage'))
      await act(async () => {
        result.current.releaseEdit()
      })
      await act(async () => {})
      expect(deleteTrigger).toHaveBeenCalledTimes(1)
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: restoreId } })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(deleteTrigger).toHaveBeenCalledTimes(2)
      expect(deleteTrigger).toHaveBeenLastCalledWith({ params: { id: restoreId } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries the cleanup when the session is cancelled during an in-flight restoration', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, postTrigger, deleteTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      let resolveRestore: ((value: unknown) => void) | undefined
      postTrigger
        .mockRejectedValueOnce(new Error('queue full'))
        .mockRejectedValueOnce(new Error('queue full'))
        .mockRejectedValueOnce(new Error('queue full'))
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveRestore = resolve
            })
        )

      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      await act(async () => {
        await result.current.takeForEdit('b', captureOutgoing)
      })

      // The restore write is in flight when the session ends.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(4)
      const restoreId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0][0].body.id
      deleteTrigger.mockRejectedValueOnce(new Error('temporary outage'))
      await act(async () => {
        result.current.releaseEdit()
      })
      await act(async () => {
        resolveRestore?.({})
      })
      await act(async () => {})
      // Two closes: the cancel path closes every potentially committed copy
      // regardless of acknowledgment (cherry-pr-review
      // inv_7deabefd1c4c947c#f1) — it fails transiently here — and the
      // acknowledged insert's cancelled-reconcile closes the copy it just
      // committed.
      expect(deleteTrigger).toHaveBeenCalledTimes(2)
      expect(deleteTrigger).toHaveBeenLastCalledWith({ params: { id: restoreId } })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      // The transiently failed cancel close settles through the resolve
      // retry chain; the row is already closed, so the retried delete is a
      // harmless NOT_FOUND.
      expect(deleteTrigger).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks the background restore retry of a still-edited item as held', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, postTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      postTrigger
        .mockRejectedValueOnce(new Error('queue full'))
        .mockRejectedValueOnce(new Error('queue full'))
        .mockRejectedValueOnce(new Error('queue full'))

      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      await act(async () => {
        await result.current.takeForEdit('b', captureOutgoing)
      })

      // Space opens while 'a' is still in the editor: the retry lands, marked
      // held so a completion cannot drain the edited content mid-session and
      // duplicate it on the later submission (cherry-pr-review).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(4)
      const bodies = postTrigger.mock.calls as unknown as Array<[{ body: { held?: boolean } }]>
      // The inline attempts are born held (they failed on the full queue);
      // the landing retry keeps the copy held while the session owns it.
      expect(bodies[0][0].body.held).toBe(true)
      expect(bodies[1][0].body.held).toBe(true)
      expect(bodies[2][0].body.held).toBe(true)
      expect(bodies[3][0].body.held).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes the held stamp of a landed restore while the edit session stays live', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, postTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      postTrigger
        .mockRejectedValueOnce(new Error('queue full'))
        .mockRejectedValueOnce(new Error('queue full'))
        .mockRejectedValueOnce(new Error('queue full'))

      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      await act(async () => {
        await result.current.takeForEdit('b', captureOutgoing)
      })

      // The retry lands held (4th call). A live edit session can outlast the
      // service's stale-claim window: the hook re-stamps the landed copy on
      // the refresh cadence so it never ages back into claimability mid-edit
      // (cherry-pr-review).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(postTrigger).toHaveBeenCalledTimes(4)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.floor(STALE_SENDING_CLAIM_MS / 2) + 1)
      })
      expect(postTrigger).toHaveBeenCalledTimes(5)
      const bodies = postTrigger.mock.calls as unknown as Array<[{ body: { id: string; held?: boolean } }]>
      expect(bodies[4][0].body.id).toBe(bodies[3][0].body.id)
      expect(bodies[4][0].body.held).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renews the held stamp after a successful re-stamp while the edit session stays live', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('a', 'first'), row('b', 'second')])
      const { claimTrigger, postTrigger, takeDeleteTrigger } = wireMutations()
      claimTrigger.mockResolvedValue({ claimed: true })
      takeDeleteTrigger.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('db down'))

      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      await act(async () => {
        await result.current.takeForEdit('a', () => null)
      })
      const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
      await act(async () => {
        await result.current.takeForEdit('b', captureOutgoing)
      })
      // Restore POST, then the held re-stamp POST lands immediately.
      await act(async () => {})
      expect(postTrigger).toHaveBeenCalledTimes(2)

      // A successful stamp still needs renewal: the edit session can outlive
      // the service's stale-claim window, and an unrenewed held copy would age
      // back into claimability mid-edit, letting a completion send the
      // unfinished draft (cherry-pr-review inv_e1f6ae28d84c7e71).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(Math.floor(STALE_SENDING_CLAIM_MS / 2) + 1)
      })
      expect(postTrigger).toHaveBeenCalledTimes(3)
      const bodies = postTrigger.mock.calls as unknown as Array<[{ body: { id: string; held?: boolean } }]>
      expect(bodies[2][0].body.id).toBe(bodies[0][0].body.id)
      expect(bodies[2][0].body.held).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds the restored outgoing copy when the switch fails after the restore landed', async () => {
    wireQuery([row('a', 'first'), row('b', 'second')])
    const { claimTrigger, postTrigger, takeDeleteTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValue({ claimed: true })
    // The outgoing restore lands, but both deletes of the incoming row fail:
    // the composer keeps showing the outgoing draft, so the session is live
    // and the landed copy must be held out of delivery (cherry-pr-review).
    takeDeleteTrigger.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('db down'))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      await result.current.takeForEdit('a', () => null)
    })
    const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('b', captureOutgoing)
    })
    expect(taken).toBeUndefined()

    // Restore POST (born held at creation) then the held re-stamp POST for
    // the same copy; the failed take's claim is released.
    await act(async () => {})
    expect(postTrigger).toHaveBeenCalledTimes(2)
    const bodies = postTrigger.mock.calls as unknown as Array<[{ body: { id: string; held?: boolean } }]>
    expect(bodies[0][0].body.held).toBe(true)
    expect(bodies[1][0].body.id).toBe(bodies[0][0].body.id)
    expect(bodies[1][0].body.held).toBe(true)
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'b' }, body: { claimToken: expect.any(String) } })

    // The session still owns the outgoing item: ending it removes the held copy.
    await act(async () => {
      result.current.releaseEdit()
    })
    await act(async () => {})
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: bodies[0][0].body.id } })
  })

  it('does not mark an orphaned restore retry as held', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimTrigger, takeDeleteTrigger, postTrigger } = wireMutations()
      claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
      let resolveDelete!: () => void
      takeDeleteTrigger.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDelete = () => resolve(undefined)
        })
      )
      postTrigger.mockRejectedValue(new Error('db down'))

      const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
        initialProps: { scopeKey: SCOPE }
      })

      await act(async () => {
        void result.current.takeForEdit('h', () => null)
      })
      // The session is gone (scope changed) before the take settles: the
      // orphaned restore retries WITHOUT held, so the copy stays deliverable.
      await act(async () => {
        rerender({ scopeKey: 's2' })
      })
      await act(async () => {
        resolveDelete()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      const bodies = postTrigger.mock.calls as unknown as Array<[{ body: { held?: boolean } }]>
      expect(bodies.length).toBeGreaterThan(0)
      for (const [args] of bodies) expect(args.body.held).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves the restore slot up when an earlier row leaves the queue', async () => {
    wireQuery([row('x', 'head'), row('a', 'first'), row('b', 'second')])
    const { claimTrigger, takeDeleteTrigger, postTrigger, reorderTrigger } = wireMutations()
    claimTrigger.mockResolvedValue({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    // Take 'a' from slot 1, then remove the earlier row 'x': the restore slot follows to 0.
    await act(async () => {
      await result.current.takeForEdit('a', () => null)
    })
    await act(async () => {
      result.current.removeId('x')
    })
    await act(async () => {
      await result.current.takeForEdit('b', () => ({ draft: draft('first edited'), payload: payload('first edited') }))
    })

    expect(postTrigger).toHaveBeenCalledWith({
      body: {
        id: expect.any(String),
        scopeKey: SCOPE,
        draft: { text: 'first edited', tokens: [] },
        payload: { text: 'first edited', userMessageParts: [] },
        held: true,
        // The restore lands at its slot atomically with the insert — no
        // reorder can be claim-barred out of it (inv_9ecff9fca3bdab04).
        anchor: { position: 'first' }
      }
    })
    const restoreId = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string } }]>)[0][0].body.id
    expect(restoreId).not.toBe('a')
    // The restore is born held; once the incoming take commits and editor
    // ownership transfers, the same copy is re-POSTed unheld so it becomes
    // claimable as ordinary pending content (cherry-pr-review).
    expect(postTrigger).toHaveBeenCalledTimes(2)
    const releaseBody = (postTrigger.mock.calls as unknown as Array<[{ body: { id: string; held?: boolean } }]>)[1][0]
      .body
    expect(releaseBody).toEqual(expect.objectContaining({ id: restoreId, held: false }))
    expect(reorderTrigger).toHaveBeenCalledWith({ body: { moves: [{ id: restoreId, anchor: { position: 'first' } }] } })
    expect(takeDeleteTrigger).toHaveBeenCalledWith({ params: { id: 'b' } })
  })

  it('restores the outgoing edit but returns nothing when the incoming take was already sent', async () => {
    wireQuery([row('a', 'first'), row('b', 'second')])
    const { claimTrigger, takeDeleteTrigger, postTrigger, deleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true }).mockResolvedValueOnce({ claimed: true, alreadySent: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      await result.current.takeForEdit('a', () => null)
    })
    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('b', () => ({
        draft: draft('first edited'),
        payload: payload('first edited')
      }))
    })

    expect(taken).toBeUndefined()
    expect(takeDeleteTrigger).toHaveBeenCalledWith({ params: { id: 'b' } })
    // The restored copy is re-stamped held: the composer still shows the
    // outgoing draft (an undefined take changes nothing there), so the copy
    // must not be deliverable while the edit session owns it
    // (cherry-pr-review).
    await act(async () => {})
    expect(postTrigger).toHaveBeenCalledTimes(2)
    const bodies = postTrigger.mock.calls as unknown as Array<[{ body: { id: string; held?: boolean } }]>
    expect(bodies[1][0].body.id).toBe(bodies[0][0].body.id)
    expect(bodies[1][0].body.held).toBe(true)
    // The session stays live on the outgoing item: re-taking it is refused,
    // and ending the session removes the held copy.
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    let third: unknown = 'unset'
    await act(async () => {
      third = await result.current.takeForEdit('a', () => ({ draft: draft('z'), payload: payload('z') }))
    })
    expect(third).toBeUndefined()
    expect(postTrigger).toHaveBeenCalledTimes(2)
    await act(async () => {
      result.current.releaseEdit()
    })
    await act(async () => {})
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: bodies[0][0].body.id } })
  })

  it('releases the head claim without sending when the scope moves mid-claim', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, failTrigger } = wireMutations()
    let resolveClaim!: (value: { claimed: true; id: string; alreadySent: boolean }) => void
    claimHeadTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClaim = resolve
      })
    )
    const onDrain = vi.fn(async () => true)
    const { rerender } = renderHook(
      ({ scopeKey, completion }) => useFollowupQueue(baseProps({ scopeKey, ...completion, onDrain })),
      { initialProps: { scopeKey: SCOPE, completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    await act(async () => {
      rerender({ scopeKey: SCOPE, completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).toHaveBeenCalledWith({
      body: { scopeKey: SCOPE, claimToken: expect.any(String), completionAt: 100 }
    })
    await act(async () => {
      rerender({ scopeKey: 's2', completion: { status: 'done', lastCompletedAt: 100 } })
    })
    await act(async () => {
      resolveClaim({ claimed: true, id: 'h', alreadySent: false })
    })
    await act(async () => {})

    expect(onDrain).not.toHaveBeenCalled()
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
  })

  it('releases the head claim without sending when the hook unmounts mid-claim', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, failTrigger } = wireMutations()
    let resolveClaim!: (value: { claimed: true; id: string; alreadySent: boolean }) => void
    claimHeadTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClaim = resolve
      })
    )
    const onDrain = vi.fn(async () => true)
    const { rerender, unmount } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).toHaveBeenCalledWith({
      body: { scopeKey: SCOPE, claimToken: expect.any(String), completionAt: 100 }
    })
    await act(async () => {
      unmount()
    })
    await act(async () => {
      resolveClaim({ claimed: true, id: 'h', alreadySent: false })
    })
    await act(async () => {})

    expect(onDrain).not.toHaveBeenCalled()
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
  })

  it('sends through the drain-start handler when onDrain changes mid-claim', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger } = wireMutations()
    let resolveClaim!: (value: { claimed: true; id: string; alreadySent: boolean }) => void
    claimHeadTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClaim = resolve
      })
    )
    const firstDrain = vi.fn(async () => true)
    const secondDrain = vi.fn(async () => true)
    const { rerender } = renderHook(
      ({ completion, onDrain }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      {
        initialProps: {
          completion: { status: 'streaming', lastCompletedAt: null as number | null },
          onDrain: firstDrain
        }
      }
    )

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 }, onDrain: firstDrain })
    })
    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 }, onDrain: secondDrain })
    })
    await act(async () => {
      resolveClaim({ claimed: true, id: 'h', alreadySent: false })
    })
    await act(async () => {})

    expect(firstDrain).toHaveBeenCalledTimes(1)
    expect(secondDrain).not.toHaveBeenCalled()
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
  })

  it('holds the claim until a timed-out send resolves, then dequeues a late success without resending', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head'), row('t', 'tail')])
      const { claimHeadTrigger, claimTrigger, deleteTrigger, failTrigger, markSentTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
      let resolveSend!: (value: boolean) => void
      const onDrain = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSend = resolve
          })
      )
      const onDrainFailed = vi.fn()
      const { rerender } = renderHook(
        ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain, onDrainFailed })),
        { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
      )

      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      })
      // Not settled failed: the outcome is unknown, so the row stays claimed
      // and no completion can redrain it into a duplicate delivery.
      expect(failTrigger).not.toHaveBeenCalled()

      await act(async () => {
        resolveSend(true)
      })
      await act(async () => {})

      // Repaired, not resent: the held claim marks sent and dequeues on the
      // late resolution, while the payload itself went out exactly once.
      expect(onDrain).toHaveBeenCalledTimes(1)
      expect(claimTrigger).not.toHaveBeenCalled()
      expect(markSentTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases a timed-out send back to failed only after the send definitively fails', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger, deleteTrigger, failTrigger, markSentTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
      let resolveSend!: (value: boolean) => void
      const onDrain = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSend = resolve
          })
      )
      const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
        initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
      })

      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      })
      expect(failTrigger).not.toHaveBeenCalled()

      await act(async () => {
        resolveSend(false)
      })
      await act(async () => {})

      // Definitive failure: the claim is released and the row is claimable again.
      expect(markSentTrigger).not.toHaveBeenCalled()
      expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
      expect(deleteTrigger).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes an owned claim while the send is in flight and stops after settle', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger, deleteTrigger, heartbeatTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
      let resolveSend!: (value: boolean) => void
      const onDrain = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSend = resolve
          })
      )
      const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
        initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
      })

      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })
      expect(onDrain).toHaveBeenCalledOnce()
      expect(heartbeatTrigger).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      })
      expect(heartbeatTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })

      await act(async () => {
        resolveSend(true)
      })
      const beats = heartbeatTrigger.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      })
      expect(heartbeatTrigger.mock.calls.length).toBe(beats)
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds a hung auto-drain send until the send resolves, then dequeues without resending', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head'), row('t', 'tail')])
      const { claimHeadTrigger, deleteTrigger, failTrigger, heartbeatTrigger, markSentTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
      let resolveSend!: (value: boolean) => void
      const onDrain = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSend = resolve
          })
      )
      const onDrainFailed = vi.fn()
      const { rerender } = renderHook(
        ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain, onDrainFailed })),
        { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
      )

      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })
      expect(onDrain).toHaveBeenCalledOnce()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      })
      // The claim is HELD while the outcome is unknown: no failed settle, so no
      // completion can redrain the row into a duplicate delivery. The heartbeat
      // keeps the claim live the whole time.
      expect(failTrigger).not.toHaveBeenCalled()
      expect(deleteTrigger).not.toHaveBeenCalled()
      expect(onDrainFailed).toHaveBeenCalledOnce()
      const beatsBeforeResolve = heartbeatTrigger.mock.calls.length
      expect(beatsBeforeResolve).toBeGreaterThan(0)

      // The send settling late is repaired through the held claim, not resent:
      // marked sent and dequeued, with exactly one payload delivery.
      await act(async () => {
        resolveSend(true)
      })
      await act(async () => {})
      expect(markSentTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
      expect(onDrain).toHaveBeenCalledOnce()

      const beats = heartbeatTrigger.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      })
      expect(heartbeatTrigger.mock.calls.length).toBe(beats)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds a hung steer send until the send resolves, then dequeues without resending', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimTrigger, deleteTrigger, failTrigger, markSentTrigger } = wireMutations()
      claimTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
      let resolveSend!: (value: boolean) => void
      const send = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSend = resolve
          })
      )
      const { result } = renderHook(() => useFollowupQueue(baseProps()))

      let steered!: Promise<boolean>
      act(() => {
        steered = result.current.steer('h', send)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      })

      await act(async () => {
        expect(await steered).toBe(false)
      })
      // Held, not released: the send's outcome is still unknown, and releasing
      // the claim here is what let a redrain duplicate the delivery.
      expect(failTrigger).not.toHaveBeenCalled()
      expect(deleteTrigger).not.toHaveBeenCalled()

      await act(async () => {
        resolveSend(true)
      })
      await act(async () => {})
      expect(markSentTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
      expect(claimTrigger).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not drain while the pause-state read errors', async () => {
    const refetch = vi.fn()
    mockUseQuery.mockImplementation((path: string) => {
      if (path === '/followup-queues') {
        return {
          data: [row('h', 'head')],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch,
          mutate: vi.fn()
        }
      }
      return {
        data: undefined,
        isLoading: false,
        isRefreshing: false,
        error: new Error('db down'),
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    })
    const { claimHeadTrigger } = wireMutations()

    const { result, rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion })), {
      initialProps: { completion: { status: 'done', lastCompletedAt: 100 } }
    })

    await act(async () => {})
    expect(result.current.items.map((item) => item.draft.text)).toEqual(['head'])
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).not.toHaveBeenCalled()
  })

  it('retries the claim in the background while the edge stays unacked', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger, deleteTrigger } = wireMutations()
      claimHeadTrigger.mockRejectedValue(new Error('ipc down'))
      const onDrain = vi.fn(async () => true)
      const onDrainFailed = vi.fn()

      const { rerender } = renderHook(
        ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain, onDrainFailed })),
        { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
      )

      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })

      expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
      expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()
      expect(onDrainFailed).toHaveBeenCalledOnce()

      claimHeadTrigger.mockResolvedValue({ claimed: true, id: 'h' })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
      expect(onDrain).toHaveBeenCalledOnce()
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps retrying the dequeue after unmount', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger, deleteTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
      deleteTrigger.mockRejectedValue(new Error('db down'))
      const onDrain = vi.fn(async () => true)

      const { rerender, unmount } = renderHook(
        ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
        { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
      )

      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })

      expect(deleteTrigger).toHaveBeenCalledTimes(3)

      unmount()
      deleteTrigger.mockResolvedValueOnce(undefined)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(deleteTrigger).toHaveBeenCalledTimes(4)
      expect(onDrain).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('chains background resolve retries until the write succeeds', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger, deleteTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
      deleteTrigger.mockRejectedValue(new Error('db down'))
      const onDrain = vi.fn(async () => true)

      const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
        initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
      })

      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })

      expect(deleteTrigger).toHaveBeenCalledTimes(3)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(deleteTrigger).toHaveBeenCalledTimes(4)

      deleteTrigger.mockResolvedValueOnce(undefined)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(deleteTrigger).toHaveBeenCalledTimes(5)
      expect(onDrain).toHaveBeenCalledOnce()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000)
      })
      expect(deleteTrigger).toHaveBeenCalledTimes(5)
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a missing row as resolved instead of retrying forever', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
    deleteTrigger.mockRejectedValue(new DataApiError(ErrorCode.NOT_FOUND, 'gone', 404))
    const onDrain = vi.fn(async () => true)

    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
      initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
    })

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(onDrain).toHaveBeenCalledOnce()
    expect(deleteTrigger).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('sends only once when the head changes mid-claim', async () => {
    const first = row('x', 'first')
    const second = row('y', 'second')
    const refetch = vi.fn()
    const queryImpl = (rows: FollowupQueueRow[]) => (path: string) => {
      if (path === '/followup-queues') {
        return { data: rows, isLoading: false, isRefreshing: false, error: undefined, refetch, mutate: vi.fn() }
      }
      return {
        data: { scopeKey: SCOPE, paused: false, createdAt: '', updatedAt: '' },
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    }
    mockUseQuery.mockImplementation(queryImpl([first, second]))
    const { claimHeadTrigger, deleteTrigger } = wireMutations()
    let resolveClaim!: (value: unknown) => void
    claimHeadTrigger.mockImplementationOnce(
      () => new Promise((resolve) => (resolveClaim = resolve as (value: unknown) => void))
    )
    const onDrain = vi.fn(async () => true)

    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
      initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
    })

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    // A concurrent reorder swaps the head while the first claim is in flight.
    mockUseQuery.mockImplementation(queryImpl([second, first]))
    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    await act(async () => {
      resolveClaim({ claimed: true, id: 'x' })
    })

    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(onDrain).toHaveBeenCalledWith(first.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'x' } })
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
  })

  it('drains the new scope while the previous scope drain is in flight', async () => {
    const headA = row('a', 'A')
    const headB = { ...row('b', 'B'), scopeKey: 's2' }
    const refetch = vi.fn()
    mockUseQuery.mockImplementation((path: string, options?: { query?: { scopeKey?: string } }) => {
      if (path === '/followup-queues') {
        return {
          data: [headA, headB],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch,
          mutate: vi.fn()
        }
      }
      return {
        data: { scopeKey: options?.query?.scopeKey ?? SCOPE, paused: false, createdAt: '', updatedAt: '' },
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    })
    const { claimHeadTrigger, deleteTrigger, failTrigger } = wireMutations()
    const pending: Array<(value: unknown) => void> = []
    claimHeadTrigger.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve as (value: unknown) => void))
    )
    const onDrain = vi.fn(async () => true)

    const { rerender } = renderHook(
      ({
        scopeKey,
        completion
      }: {
        scopeKey: string
        completion: { status: 'streaming' | 'done'; lastCompletedAt: number | null }
      }) => useFollowupQueue(baseProps({ scopeKey, ...completion, onDrain })),
      { initialProps: { scopeKey: SCOPE, completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    await act(async () => {
      rerender({ scopeKey: SCOPE, completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(pending).toHaveLength(1)

    // Switch conversations while scope A's drain is still in flight: scope B
    // must start its own drain instead of stalling on the shared guard, while
    // A's cycle releases its claim without sending into the new scope.
    await act(async () => {
      rerender({ scopeKey: 's2', completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(pending).toHaveLength(2)

    await act(async () => {
      pending[0]({ claimed: true, id: 'a' })
      pending[1]({ claimed: true, id: 'b' })
    })

    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(onDrain).toHaveBeenCalledWith(headB.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'b' } })
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'a' }, body: { claimToken: expect.any(String) } })
    expect(cacheService.getShared('followup_queue.consumed.s2')).toBe(100)
  })

  it('does not ack the new scope edge on a lost claim from the old scope', async () => {
    const headA = row('a', 'A')
    const headB = { ...row('b', 'B'), scopeKey: 's2' }
    mockUseQuery.mockImplementation((path: string, options?: { query?: { scopeKey?: string } }) => {
      if (path === '/followup-queues') {
        return {
          data: [headA, headB],
          isLoading: false,
          isRefreshing: false,
          error: undefined,
          refetch: vi.fn(),
          mutate: vi.fn()
        }
      }
      return {
        data: { scopeKey: options?.query?.scopeKey ?? SCOPE, paused: false, createdAt: '', updatedAt: '' },
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    })
    const { claimHeadTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValue({ claimed: false })
    let resolveClaim!: (value: unknown) => void
    claimHeadTrigger.mockImplementationOnce(
      () => new Promise((resolve) => (resolveClaim = resolve as (value: unknown) => void))
    )

    const { rerender } = renderHook(
      ({
        scopeKey,
        completion
      }: {
        scopeKey: string
        completion: { status: 'streaming' | 'done'; lastCompletedAt: number | null }
      }) => useFollowupQueue(baseProps({ scopeKey, ...completion })),
      { initialProps: { scopeKey: SCOPE, completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    await act(async () => {
      rerender({ scopeKey: SCOPE, completion: { status: 'done', lastCompletedAt: 100 } })
    })
    // Switch scopes while A's claim is in flight, then lose it: only B's own
    // cycle may ack, never A's stale one.
    await act(async () => {
      rerender({ scopeKey: 's2', completion: { status: 'done', lastCompletedAt: 100 } })
    })
    await act(async () => {
      resolveClaim({ claimed: false })
    })

    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()
    // B's own lost claim parks the edge only in-session, never in the durable
    // marker: if the winning window abandons the dispatch without sending,
    // nothing survives and a reopen drains the stranded row (cherry-pr-review).
    expect(cacheService.getShared('followup_queue.consumed.s2')).toBeUndefined()
    // The local park still suppresses a duplicate drain cycle for the same edge.
    await act(async () => {
      rerender({ scopeKey: 's2', completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
  })

  it('retries a parked completion when the winning claim is abandoned without delivery', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger, deleteTrigger } = wireMutations()
      // The first claim loses (another window owns the head); the reconcile
      // tick's retry wins once the winner's reservation is released.
      claimHeadTrigger
        .mockResolvedValueOnce({ claimed: false })
        .mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
      const onDrain = vi.fn(async () => true)
      const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
        initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
      })
      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })

      // Parked: no send and no durable marker while the reservation is live.
      expect(onDrain).not.toHaveBeenCalled()
      expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      // The abandoned reservation is gone, so the retry delivers the row
      // (cherry-pr-review inv_d411c32e0bd3cc85).
      expect(onDrain).toHaveBeenCalledWith(row('h', 'head').payload)
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
      expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops reconciling a parked completion once the winner delivers it', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValueOnce({ claimed: false })
      const onDrain = vi.fn(async () => true)
      const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
        initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
      })
      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })
      expect(claimHeadTrigger).toHaveBeenCalledTimes(1)

      // The winner's pre-send ack lands in the durable shared marker.
      act(() => {
        cacheService.setShared('followup_queue.consumed.s1', 100)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000)
      })

      // The park is redundant once the durable fence lands: no retry fires.
      expect(claimHeadTrigger).toHaveBeenCalledTimes(1)
      expect(onDrain).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-parks and keeps retrying while the winner is still mid-send', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValue({ claimed: false })
      const onDrain = vi.fn(async () => true)
      const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
        initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
      })
      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })
      expect(claimHeadTrigger).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      // The winner's claim is still live, so the retry loses and re-parks.
      expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(claimHeadTrigger).toHaveBeenCalledTimes(3)

      expect(onDrain).not.toHaveBeenCalled()
      expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the parked marker when the scope switches before the reconcile tick, and retries on return', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger, deleteTrigger } = wireMutations()
      claimHeadTrigger
        .mockResolvedValueOnce({ claimed: false })
        .mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
      const onDrain = vi.fn(async () => true)
      const { rerender } = renderHook(
        ({ scope, completion }) => useFollowupQueue(baseProps({ scopeKey: scope, ...completion, onDrain })),
        {
          initialProps: {
            scope: 's1',
            completion: { status: 'streaming', lastCompletedAt: null as number | null }
          }
        }
      )
      await act(async () => {
        rerender({ scope: 's1', completion: { status: 'done', lastCompletedAt: 100 } })
      })
      // Parked on the lost claim.
      expect(onDrain).not.toHaveBeenCalled()

      // Switch away before the reconcile tick fires: the tick drops the park
      // for s1 instead of suppressing the completion forever
      // (cherry-pr-review inv_cf435068dde27e9a). s2 stays mid-stream so no
      // drain fires there.
      await act(async () => {
        rerender({ scope: 's2', completion: { status: 'streaming', lastCompletedAt: null } })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(claimHeadTrigger).toHaveBeenCalledTimes(1)

      // Returning to s1 re-drives the drain; the abandoned reservation is gone,
      // so the retry delivers.
      await act(async () => {
        rerender({ scope: 's1', completion: { status: 'done', lastCompletedAt: 100 } })
      })
      expect(onDrain).toHaveBeenCalledWith(row('h', 'head').payload)
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
      expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets a reopened window drain a completion whose winning claim was abandoned without sending', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger } = wireMutations()
    // The first window loses the claim: another window owns the head.
    claimHeadTrigger.mockResolvedValueOnce({ claimed: false })
    const onDrainFirst = vi.fn(async () => true)

    const first = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain: onDrainFirst })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )
    await act(async () => {
      first.rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    // No durable consumption marker: the winner held only an in-flight
    // reservation and abandoned it without sending (zero sends, row released
    // failed), so the completion must stay drainable for a reopen.
    expect(onDrainFirst).not.toHaveBeenCalled()
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()
    first.unmount()

    const onDrainSecond = vi.fn(async () => true)
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
    await act(async () => {
      renderHook(() => useFollowupQueue(baseProps({ status: 'done', lastCompletedAt: 100, onDrain: onDrainSecond })))
    })

    expect(onDrainSecond).toHaveBeenCalledWith(row('h', 'head').payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
  })

  it('skips the send for a row this profile already sent', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger, markSentTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: true })
    const onDrain = vi.fn(async () => true)
    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
      initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
    })

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(onDrain).not.toHaveBeenCalled()
    expect(markSentTrigger).not.toHaveBeenCalled()
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
  })

  it('records a sent row server-side before dequeuing it', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger, deleteTrigger, markSentTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
      deleteTrigger.mockRejectedValue(new Error('db down'))
      const onDrain = vi.fn(async () => true)
      const { rerender, unmount } = renderHook(
        ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
        {
          initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
        }
      )

      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })

      expect(onDrain).toHaveBeenCalledOnce()
      // The send is journaled on the row before the dequeue write, so a crash
      // between the two replays as a skip instead of a second send.
      expect(markSentTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
      // The failed dequeue keeps retrying in the background while mounted...
      const attempts = deleteTrigger.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000)
      })
      expect(deleteTrigger.mock.calls.length).toBeGreaterThan(attempts)
      // ...and unmounting plus restoring real timers drops the pending retry
      // instead of leaking it into later tests.
      act(() => {
        unmount()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles the inline resolve when the row is already gone', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger, markSentTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
    deleteTrigger.mockRejectedValue(new DataApiError(ErrorCode.NOT_FOUND, 'gone', 404))
    const onDrain = vi.fn(async () => true)
    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
      initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
    })

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(onDrain).toHaveBeenCalledOnce()
    expect(markSentTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    // The row is already gone, so the dequeue already took effect: no
    // background retry is scheduled.
    expect(deleteTrigger).toHaveBeenCalledOnce()
  })

  it('holds an explicit Pause across the persistence round-trip', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, setPausedTrigger } = wireMutations()
    let resolvePause!: () => void
    setPausedTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePause = () => resolve({ scopeKey: SCOPE, paused: true, createdAt: '', updatedAt: '' })
      })
    )
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    // Pause while the PUT is still in flight...
    act(() => {
      result.current.setPaused(true)
    })
    expect(result.current.paused).toBe(true)

    // ...then the completion edge lands before the server echoes it back: the
    // drain must stay parked instead of sending into a paused queue.
    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(onDrain).not.toHaveBeenCalled()
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()

    // When the server echoes the pause, the hold releases onto the same value.
    await act(async () => {
      resolvePause()
    })
    expect(result.current.paused).toBe(true)
  })

  it('keeps the newest Pause hold when an older Pause write fails mid-toggle (inv_b1a53e2ac3bacba5)', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, setPausedTrigger } = wireMutations()
    let rejectFirst!: (reason?: unknown) => void
    setPausedTrigger
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject
          })
      )
      .mockResolvedValue({ scopeKey: SCOPE, paused: true, createdAt: '', updatedAt: '' } as any)
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    // Pause -> Resume -> Pause while the first PUT is in flight: the newest
    // request owns the optimistic hold.
    act(() => {
      result.current.setPaused(true)
    })
    act(() => {
      result.current.setPaused(false)
    })
    act(() => {
      result.current.setPaused(true)
    })
    expect(result.current.paused).toBe(true)

    // The FIRST write fails now: its obsolete failure must not release the
    // newer Pause hold - Boolean equality would delete it and persisted
    // unpaused would permit automatic delivery.
    await act(async () => {
      rejectFirst(new Error('network down'))
    })
    expect(result.current.paused).toBe(true)

    // A completion edge in that window stays parked until the final write
    // settles.
    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(onDrain).not.toHaveBeenCalled()
  })

  it('keeps a pending Pause override until its own write is acknowledged, not on a stale cache echo (inv_2defea073e0ba391)', async () => {
    // Start paused: the cache echo already matches the Pause value the user
    // is about to request.
    wireQuery([row('h', 'head')], true)
    const { claimHeadTrigger, setPausedTrigger } = wireMutations()
    let resolveResume!: () => void
    let resolvePause!: () => void
    setPausedTrigger
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveResume = () => resolve({ scopeKey: SCOPE, paused: false, createdAt: '', updatedAt: '' })
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePause = () => resolve({ scopeKey: SCOPE, paused: true, createdAt: '', updatedAt: '' })
          })
      )
      .mockResolvedValue({ scopeKey: SCOPE, paused: true, createdAt: '', updatedAt: '' } as any)
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    // Resume, then Pause before the Resume write settles. The stale cache
    // echo (still paused=true) matches the newest override, but the Pause
    // write has not even been sent: Boolean equality must not release the
    // hold (cherry-pr-review inv_2defea073e0ba391).
    act(() => {
      result.current.setPaused(false)
    })
    act(() => {
      result.current.setPaused(true)
    })
    expect(result.current.paused).toBe(true)

    // The Resume write commits and the cache catches up to it: automatic
    // delivery must stay parked behind the still-pending Pause write.
    await act(async () => {
      resolveResume()
    })
    wireQuery([row('h', 'head')], false)
    rerender({ completion: { status: 'streaming', lastCompletedAt: null as number | null } })
    expect(result.current.paused).toBe(true)
    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(onDrain).not.toHaveBeenCalled()

    // Once the Pause write itself is acknowledged and the cache echoes it,
    // the hold clears against the echoed value.
    await act(async () => {
      resolvePause()
    })
    wireQuery([row('h', 'head')], true)
    rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    expect(result.current.paused).toBe(true)
  })

  it('clears an acknowledged Resume override whose cache echo beat the ack, so a later peer Pause is honored (inv_76edd56d71ac5e03)', async () => {
    // Race from review: Resume's PUT is still in flight when the refreshed
    // cache already echoes paused=false. The generation fence keeps the
    // override at that point; the acknowledgement arriving afterwards must
    // rerun the reconciliation, or the optimistic `false` stays held and
    // masks a subsequent peer Pause (cherry-pr-review inv_76edd56d71ac5e03).
    wireQuery([row('h', 'head')], true)
    const { claimHeadTrigger, setPausedTrigger } = wireMutations()
    let resolveResume!: () => void
    setPausedTrigger.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResume = () => resolve({ scopeKey: SCOPE, paused: false, createdAt: '', updatedAt: '' })
        })
    )
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    act(() => {
      result.current.setPaused(false)
    })
    expect(result.current.paused).toBe(false)

    // The cache echo (paused=false) arrives BEFORE the Resume write settles:
    // the fence retains the override.
    wireQuery([row('h', 'head')], false)
    rerender({ completion: { status: 'streaming', lastCompletedAt: null as number | null } })
    expect(result.current.paused).toBe(false)

    // The ack lands: acknowledgment triggers reconciliation and clears the
    // override against the matching echo.
    await act(async () => {
      resolveResume()
    })

    // A peer window pauses afterwards: with the override cleared the server
    // value owns the flag, so the completion must NOT drain.
    wireQuery([row('h', 'head')], true)
    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(result.current.paused).toBe(true)
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(onDrain).not.toHaveBeenCalled()
  })

  it('drops an acknowledged Resume override when the server persists a newer peer Pause (round-10)', async () => {
    // Interleaving from review: Resume's PUT is in flight while a peer Pause
    // keeps the persisted flag true. The refreshed cache reports paused=true
    // before the ack, so no echo can ever match the optimistic `false`; once
    // the delayed ack lands the stale override must be dropped or a
    // completion drains against persisted `paused=true`.
    wireQuery([row('h', 'head')], true)
    const { claimHeadTrigger, setPausedTrigger } = wireMutations()
    let resolveResume!: () => void
    setPausedTrigger.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResume = () => resolve({ scopeKey: SCOPE, paused: false, createdAt: '', updatedAt: '' })
        })
    )
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    act(() => {
      result.current.setPaused(false)
    })
    expect(result.current.paused).toBe(false)

    // The peer Pause persists while Resume is in flight: the cache reports
    // paused=true, contradicting the optimistic override.
    wireQuery([row('h', 'head')], true)
    rerender({ completion: { status: 'streaming', lastCompletedAt: null } })

    // The delayed ack lands: the stale Resume override must be dropped so
    // the persisted peer Pause owns the flag.
    await act(async () => {
      resolveResume()
    })
    expect(result.current.paused).toBe(true)

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(onDrain).not.toHaveBeenCalled()
  })

  it('drops an acknowledged Pause override once the refreshed state provably postdates its write (inv_a8056ce80780fca8)', async () => {
    // Interleaving from review: A's Pause PUT commits, then B's Resume
    // commits, then A's ack arrives. A's refreshed cache already shows the
    // peer Resume with a strictly newer updatedAt, so the acknowledged `true`
    // override is spent — retaining it parks the drain forever once B closes
    // (cherry-pr-review inv_a8056ce80780fca8#f1).
    wireQuery([row('h', 'head')], false, '2026-01-01T00:00:00.000Z')
    const { claimHeadTrigger, setPausedTrigger } = wireMutations()
    let resolvePause!: () => void
    setPausedTrigger.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePause = () =>
            resolve({ scopeKey: SCOPE, paused: true, createdAt: '', updatedAt: '2026-01-01T00:00:10.000Z' })
        })
    )
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    act(() => {
      result.current.setPaused(true)
    })
    expect(result.current.paused).toBe(true)

    // B's Resume commits while A's ack is in flight: the refreshed cache
    // reports unpaused with an updatedAt newer than A's acknowledged write.
    wireQuery([row('h', 'head')], false, '2026-01-01T00:00:20.000Z')
    rerender({ completion: { status: 'streaming', lastCompletedAt: null } })

    // The delayed ack lands: the override must yield to the newer
    // authoritative write, or completions never drain again.
    await act(async () => {
      resolvePause()
    })
    expect(result.current.paused).toBe(false)

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).toHaveBeenCalled()
  })

  it('drops an acknowledged Pause override when the peer Resume commits within the same millisecond (inv_9dd8c2937847bcc9)', async () => {
    // Interleaving from review: the production service permits identical
    // updatedAt values, so A's Pause and B's Resume commit within the same
    // millisecond and A's ack arrives after the refresh already shows B's
    // unpaused state. A strict timestamp comparison cannot order the tie -
    // but A's acknowledged write RESULTED in `paused=true` at that
    // timestamp, so a refreshed `false` at the same timestamp provably
    // postdates it; retaining the override parks the drain forever
    // (cherry-pr-review inv_9dd8c2937847bcc9#f1).
    wireQuery([row('h', 'head')], false, '2026-01-01T00:00:00.000Z')
    const { claimHeadTrigger, setPausedTrigger } = wireMutations()
    let resolvePause!: () => void
    setPausedTrigger.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePause = () =>
            resolve({ scopeKey: SCOPE, paused: true, createdAt: '', updatedAt: '2026-01-01T00:00:10.000Z' })
        })
    )
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    act(() => {
      result.current.setPaused(true)
    })
    expect(result.current.paused).toBe(true)

    // B's Resume commits at the SAME timestamp as A's acknowledged Pause.
    wireQuery([row('h', 'head')], false, '2026-01-01T00:00:10.000Z')
    rerender({ completion: { status: 'streaming', lastCompletedAt: null } })

    // The delayed ack lands: the tie must resolve to the peer's write, or
    // completions never drain again.
    await act(async () => {
      resolvePause()
    })
    expect(result.current.paused).toBe(false)

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).toHaveBeenCalled()
  })

  it('retains an acknowledged Pause override when the unpaused read predates its write (inv_a8056ce80780fca8)', async () => {
    // Same race, but the refreshed cache is a STALE read issued before A's
    // Pause committed: its updatedAt predates the acknowledged write, so the
    // override stays held — dropping it would drain against the persisted
    // pause. This pins the fail-safe direction of the reconciliation.
    wireQuery([row('h', 'head')], false, '2025-12-31T23:59:50.000Z')
    const { claimHeadTrigger, setPausedTrigger } = wireMutations()
    let resolvePause!: () => void
    setPausedTrigger.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePause = () =>
            resolve({ scopeKey: SCOPE, paused: true, createdAt: '', updatedAt: '2026-01-01T00:00:10.000Z' })
        })
    )
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    act(() => {
      result.current.setPaused(true)
    })
    expect(result.current.paused).toBe(true)

    wireQuery([row('h', 'head')], false, '2025-12-31T23:59:50.000Z')
    rerender({ completion: { status: 'streaming', lastCompletedAt: null } })

    await act(async () => {
      resolvePause()
    })
    expect(result.current.paused).toBe(true)

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(onDrain).not.toHaveBeenCalled()
  })

  it('retains a pending Pause per scope when another scope pauses before the write settles', async () => {
    // Pause assistant A while its PUT awaits retry, switch to assistant B in
    // the same topic (the composer stays mounted) and pause it, then return
    // to completed A before A's write lands. A single optimistic slot is
    // clobbered by B here, so A falls back to persisted unpaused and drains
    // despite Pause; holds must be retained per scope until acknowledgement
    // or failure (cherry-pr-review inv_389ec2ffbe28356e).
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, setPausedTrigger } = wireMutations()
    let resolvePauseA!: () => void
    // Optional parameter: the shared trigger mock is typed `() => Promise<any>`,
    // and a required argument would fail variance under the project typecheck.
    setPausedTrigger.mockImplementation((args?: { body: { scopeKey: string; paused: boolean } }) => {
      if (args?.body.scopeKey === SCOPE) {
        return new Promise((resolve) => {
          resolvePauseA = () => resolve({ scopeKey: SCOPE, paused: true, createdAt: '', updatedAt: '' })
        }) as Promise<any>
      }
      return Promise.resolve(undefined) as Promise<any>
    })
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({
        scopeKey,
        status,
        lastCompletedAt
      }: {
        scopeKey: string
        status: 'streaming' | 'done'
        lastCompletedAt: number | null
      }) => useFollowupQueue(baseProps({ scopeKey, status, lastCompletedAt, onDrain })),
      {
        initialProps: {
          scopeKey: SCOPE,
          status: 'streaming',
          lastCompletedAt: null
        }
      }
    )

    act(() => {
      result.current.setPaused(true)
    })
    expect(result.current.paused).toBe(true)

    // Switch to assistant B in the same topic and pause it too.
    await act(async () => {
      rerender({ scopeKey: 's2', status: 'streaming', lastCompletedAt: null })
    })
    act(() => {
      result.current.setPaused(true)
    })
    expect(result.current.paused).toBe(true)

    // Back to A, now completed, before A's PUT settles: A's hold must survive.
    await act(async () => {
      rerender({ scopeKey: SCOPE, status: 'done', lastCompletedAt: 100 })
    })
    expect(result.current.paused).toBe(true)
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(onDrain).not.toHaveBeenCalled()

    await act(async () => {
      resolvePauseA()
    })
    expect(result.current.paused).toBe(true)
  })

  it('coalesces rapid Pause/Resume so the server ends with the latest choice', async () => {
    wireQuery([])
    const { setPausedTrigger } = wireMutations()
    let resolveFirst!: (value: unknown) => void
    setPausedTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve as (value: unknown) => void
      })
    )

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    act(() => {
      result.current.setPaused(true)
    })
    expect(setPausedTrigger).toHaveBeenCalledTimes(1)
    expect(setPausedTrigger).toHaveBeenLastCalledWith({ body: { scopeKey: SCOPE, paused: true } })

    // Second toggle while the first PUT is in flight: coalesced, not sent yet.
    act(() => {
      result.current.setPaused(false)
    })
    expect(setPausedTrigger).toHaveBeenCalledTimes(1)
    expect(result.current.paused).toBe(false)

    await act(async () => {
      resolveFirst(undefined)
    })
    expect(setPausedTrigger).toHaveBeenCalledTimes(2)
    expect(setPausedTrigger).toHaveBeenLastCalledWith({ body: { scopeKey: SCOPE, paused: false } })
  })

  it('keeps retrying the claim while the edge stays unacked', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger } = wireMutations()
      claimHeadTrigger.mockRejectedValue(new Error('ipc down'))

      const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion })), {
        initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
      })

      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })

      expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
      for (let tick = 0; tick < 3; tick++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000)
        })
      }

      expect(claimHeadTrigger).toHaveBeenCalledTimes(8)
      expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits out background revalidation before draining', async () => {
    const head = row('h', 'head')
    const refetch = vi.fn()
    const refetchState = vi.fn()
    const queryImpl = (refreshing: boolean) => (path: string) => {
      if (path === '/followup-queues') {
        return {
          data: [head],
          isLoading: false,
          isRefreshing: refreshing,
          error: undefined,
          refetch,
          mutate: vi.fn()
        }
      }
      return {
        data: { scopeKey: SCOPE, paused: false, createdAt: '', updatedAt: '' },
        isLoading: false,
        isRefreshing: refreshing,
        error: undefined,
        refetch: refetchState,
        mutate: vi.fn()
      }
    }
    mockUseQuery.mockImplementation(queryImpl(true))
    const { claimHeadTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
    const onDrain = vi.fn(async () => true)

    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
      initialProps: { completion: { status: 'done', lastCompletedAt: 100 } }
    })

    await act(async () => {})
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()

    mockUseQuery.mockImplementation(queryImpl(false))
    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(claimHeadTrigger).toHaveBeenCalledWith({
      body: { scopeKey: SCOPE, claimToken: expect.any(String), completionAt: 100 }
    })
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
    expect(onDrain).toHaveBeenCalledWith(head.payload)
  })

  it('keeps retrying the dequeue in the background after a successful send', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimHeadTrigger, deleteTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
      deleteTrigger.mockRejectedValue(new Error('db down'))
      const onDrain = vi.fn(async () => true)

      const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
        initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
      })

      await act(async () => {
        rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
      })

      expect(onDrain).toHaveBeenCalledOnce()
      expect(deleteTrigger).toHaveBeenCalledTimes(3)
      expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')

      deleteTrigger.mockResolvedValueOnce(undefined)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(deleteTrigger).toHaveBeenCalledTimes(4)
      expect(onDrain).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips the send silently when another window wins the claim', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: false })
    const onDrain = vi.fn(async () => true)
    const onDrainFailed = vi.fn()

    const { rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain, onDrainFailed })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(onDrain).not.toHaveBeenCalled()
    expect(onDrainFailed).not.toHaveBeenCalled()
    expect(deleteTrigger).not.toHaveBeenCalled()
  })

  it('sends the true head when a reorder lands mid-drain', async () => {
    const first = row('x', 'stale-head')
    const second = row('y', 'true-head')
    wireQuery([first, second])
    const { claimHeadTrigger, deleteTrigger } = wireMutations()
    // A concurrent reorder moved the mirrored head aside: the atomic claim
    // wins the true head, and the drain sends its payload — not the mirror's.
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'y' })
    const onDrain = vi.fn(async () => true)

    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })), {
      initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
    })

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(claimHeadTrigger).toHaveBeenCalledWith({
      body: { scopeKey: SCOPE, claimToken: expect.any(String), completionAt: 100 }
    })
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBe(100)
    expect(onDrain).toHaveBeenCalledWith(second.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'y' } })
  })

  it('does not drain while the queue read errors', async () => {
    const refetch = vi.fn()
    mockUseQuery.mockImplementation((path: string) => {
      if (path === '/followup-queues') {
        return {
          data: [row('h', 'head')],
          isLoading: false,
          isRefreshing: false,
          error: new Error('db down'),
          refetch,
          mutate: vi.fn()
        }
      }
      return {
        data: { scopeKey: SCOPE, paused: false, createdAt: '', updatedAt: '' },
        isLoading: false,
        isRefreshing: false,
        error: undefined,
        refetch: vi.fn(),
        mutate: vi.fn()
      }
    })
    const { claimHeadTrigger } = wireMutations()

    const { rerender } = renderHook(({ completion }) => useFollowupQueue(baseProps({ ...completion })), {
      initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } }
    })

    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })

    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()
  })

  it('does not drain while paused and toggles pause through the API', async () => {
    wireQuery([row('h', 'head')], true)
    const { setPausedTrigger } = wireMutations()
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({ completion }) => useFollowupQueue(baseProps({ ...completion, onDrain })),
      { initialProps: { completion: { status: 'streaming', lastCompletedAt: null as number | null } } }
    )

    expect(result.current.paused).toBe(true)
    await act(async () => {
      rerender({ completion: { status: 'done', lastCompletedAt: 100 } })
    })
    expect(onDrain).not.toHaveBeenCalled()

    act(() => result.current.setPaused(false))
    expect(setPausedTrigger).toHaveBeenCalledWith({
      body: { scopeKey: SCOPE, paused: false }
    })
  })

  it('removes and reorders through the API', async () => {
    const first = row('a', 'a')
    const second = row('b', 'b')
    wireQuery([first, second])
    const { claimTrigger, deleteTrigger, reorderTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      result.current.removeId('a')
    })
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'a' } })

    act(() => result.current.reorder([result.current.items[1], result.current.items[0]]))
    expect(reorderTrigger).toHaveBeenCalledWith({
      body: { moves: [{ id: 'a', anchor: { after: 'b' } }] }
    })
  })

  it('refetches on cross-window queue changes', () => {
    const { refetch } = wireQuery([row('h', 'head')])
    wireMutations()
    renderHook(() => useFollowupQueue(baseProps()))

    MockUseDataApiUtils.emitDataChange([{ endpoint: '/followup-queues', kind: 'membership' }])

    expect(refetch).toHaveBeenCalled()
  })
})

describe('persistBlobAttachments', () => {
  it('replaces a pathless screenshot Blob with a durable managed file path that survives JSON persistence', async () => {
    const createInternalEntry = vi.fn(async () => ({ id: 'entry-1' }))
    const getPhysicalPath = vi.fn(async () => '/data/files/entry-1.png')
    const previousApi = (window as any).api
    ;(window as any).api = { ...previousApi, file: { ...previousApi?.file, createInternalEntry, getPhysicalPath } }
    try {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
      // jsdom's Blob lacks arrayBuffer(); the renderer's Chromium Blob has it.
      Object.defineProperty(blob, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
      const payload = {
        text: 'look',
        userMessageParts: [],
        attachments: [
          { id: 'shot', name: 'screenshot.png', origin_name: 'screenshot.png', ext: '.png', blob },
          { id: 'disk', name: 'a.txt', ext: '.txt', path: '/tmp/a.txt' }
        ]
      }

      const persisted = await persistBlobAttachments(payload)
      const roundTripped = JSON.parse(JSON.stringify(persisted))

      expect(createInternalEntry).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ source: 'bytes', name: 'screenshot.png', ext: 'png' })
      )
      expect(roundTripped.attachments[0]).toEqual({
        id: 'shot',
        name: 'screenshot.png',
        origin_name: 'screenshot.png',
        ext: '.png',
        path: '/data/files/entry-1.png',
        // The managed entry id rides along so enqueue can register durable
        // file ownership for the draft's queue lifetime.
        entryId: 'entry-1'
      })
      expect(roundTripped.attachments[1]).toEqual(payload.attachments[1])
    } finally {
      ;(window as any).api = previousApi
    }
  })

  it('returns the payload unchanged when no attachment carries a Blob', async () => {
    const payload = { text: 'x', userMessageParts: [], attachments: [{ id: 'a', path: '/tmp/a' }] }
    await expect(persistBlobAttachments(payload as any)).resolves.toBe(payload)
  })

  it('releases a claim won while Pause took effect without dispatching the send', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, failTrigger } = wireMutations()
    let resolveClaim!: (value: unknown) => void
    claimHeadTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClaim = resolve
      })
    )
    const onDrain = vi.fn(async () => true)
    const { result, rerender } = renderHook(
      ({ status, lastCompletedAt }: { status: 'streaming' | 'done'; lastCompletedAt: number | null }) =>
        useFollowupQueue(baseProps({ status, lastCompletedAt, onDrain })),
      { initialProps: { status: 'streaming' as 'streaming' | 'done', lastCompletedAt: null as number | null } }
    )

    // Fire the completion edge: the drain claims the head; keep the claim in flight.
    await act(async () => {
      rerender({ status: 'done', lastCompletedAt: 100 })
    })
    expect(claimHeadTrigger).toHaveBeenCalledTimes(1)

    // Pause takes effect before the claim resolves (cherry-pr-review
    // inv_d8f850bf38694710): the late grant must not dispatch.
    await act(async () => {
      result.current.setPaused(true)
    })
    expect(result.current.paused).toBe(true)
    await act(async () => {
      resolveClaim({ claimed: true, id: 'h', alreadySent: false })
      await Promise.resolve()
    })

    expect(onDrain).not.toHaveBeenCalled()
    // The owned claim is released without consuming the completion edge.
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' }, body: { claimToken: expect.any(String) } })
    expect(cacheService.getShared('followup_queue.consumed.s1')).toBeUndefined()
  })

  it('re-drives the pending completion when Resume lands while the pause release is in flight (inv_b17cab8d94fd1281)', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, failTrigger } = wireMutations()
    let resolveClaim!: (value: unknown) => void
    claimHeadTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveClaim = resolve
      })
    )
    let resolveFail!: () => void
    failTrigger.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFail = () => resolve(undefined)
      })
    )
    const onDrain = vi.fn(async () => true)
    const { result, rerender } = renderHook(
      ({ status, lastCompletedAt }: { status: 'streaming' | 'done'; lastCompletedAt: number | null }) =>
        useFollowupQueue(baseProps({ status, lastCompletedAt, onDrain })),
      { initialProps: { status: 'streaming' as 'streaming' | 'done', lastCompletedAt: null as number | null } }
    )

    await act(async () => {
      rerender({ status: 'done', lastCompletedAt: 100 })
    })
    expect(claimHeadTrigger).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.setPaused(true)
    })
    // The claim resolves after Pause took effect: the drain releases it
    // without dispatching, and the release stays in flight.
    await act(async () => {
      resolveClaim({ claimed: true, id: 'h', alreadySent: false })
      await Promise.resolve()
    })
    expect(failTrigger).toHaveBeenCalledTimes(1)
    expect(onDrain).not.toHaveBeenCalled()

    // Resume while the release is in flight: the drain effect exits at the
    // busy-scope guard, so the settlement itself must re-drive the still
    // unconsumed completion (cherry-pr-review inv_b17cab8d94fd1281).
    await act(async () => {
      result.current.setPaused(false)
    })
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
    await act(async () => {
      resolveFail()
    })
    await act(async () => {})

    expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
    expect(onDrain).toHaveBeenCalledTimes(1)
  })

  it('removes the landed outgoing copy when a switch abandons on a scope change', async () => {
    wireQuery([row('a', 'first'), row('b', 'second')])
    const { claimTrigger, takeDeleteTrigger, postTrigger, deleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValue({ claimed: true, alreadySent: false })
    // A's take delete resolves; B's stays pending until the scope has moved.
    let resolveDelete!: () => void
    takeDeleteTrigger.mockResolvedValueOnce(undefined).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      })
    )

    const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
      initialProps: { scopeKey: SCOPE }
    })

    await act(async () => {
      await result.current.takeForEdit('a', () => null)
    })
    const captureOutgoing = vi.fn(() => ({ draft: draft('first edited'), payload: payload('first edited') }))
    await act(async () => {
      void result.current.takeForEdit('b', captureOutgoing)
    })
    // A's recovery copy lands (born held) while B's delete is still pending.
    await act(async () => {})
    expect(postTrigger).toHaveBeenCalledTimes(1)
    const restoreBodies = postTrigger.mock.calls as unknown as Array<[{ body: { id: string; held?: boolean } }]>
    const restoreId = restoreBodies[0][0].body.id
    expect(restoreBodies[0][0].body.held).toBe(true)

    // Navigate away mid-flight: the composer unmounts and caches the visible
    // outgoing draft, so the landed copy must be removed rather than linger
    // and age out into a duplicate delivery (cherry-pr-review
    // inv_ab5b303505a45104).
    await act(async () => {
      rerender({ scopeKey: 's2' })
    })
    await act(async () => {
      resolveDelete()
    })
    await act(async () => {})
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: restoreId } })
  })
})
