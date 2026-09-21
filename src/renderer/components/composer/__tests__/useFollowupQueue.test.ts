import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { FOLLOWUP_QUEUE_LIMIT, type FollowupQueueItem as FollowupQueueRow } from '@shared/data/types/followupQueue'

import { useFollowupQueue } from '../useFollowupQueue'

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

function wireQuery(rows: FollowupQueueRow[], paused = false) {
  const refetch = vi.fn()
  const refetchState = vi.fn()
  mockUseQuery.mockImplementation((path: string) => {
    if (path === '/followup-queues') {
      return { data: rows, isLoading: false, isRefreshing: false, error: undefined, refetch, mutate: vi.fn() }
    }
    if (path === '/followup-queue-states') {
      return {
        data: { scopeKey: SCOPE, paused, createdAt: '', updatedAt: '' },
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
    if (method === 'DELETE' && path === '/followup-queues/:id')
      return { trigger: deleteTrigger, isLoading: false, error: undefined }
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
    isFulfilled: false,
    markSeen: vi.fn(),
    onDrain: vi.fn(async () => true),
    ...overrides
  }
}

describe('useFollowupQueue', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
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
    const markSeen = vi.fn()

    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain })),
      {
        initialProps: { isFulfilled: false }
      }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(markSeen).toHaveBeenCalled()
    expect(claimHeadTrigger).toHaveBeenCalledWith({ body: { scopeKey: SCOPE } })
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
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain, onDrainFailed })),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
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
    const markSeen = vi.fn()

    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain })),
      { initialProps: { isFulfilled: true } }
    )

    await act(async () => {})
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(markSeen).not.toHaveBeenCalled()

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
      rerender({ isFulfilled: true })
    })

    expect(claimHeadTrigger).toHaveBeenCalledWith({ body: { scopeKey: SCOPE } })
    expect(markSeen).toHaveBeenCalled()
    expect(onDrain).toHaveBeenCalledWith(head.payload)
  })

  it('retries the claim once after a transient failure', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger } = wireMutations()
    claimHeadTrigger.mockRejectedValueOnce(new Error('ipc down'))
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h' })
    const onDrain = vi.fn(async () => true)
    const markSeen = vi.fn()
    const onDrainFailed = vi.fn()

    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain, onDrainFailed })),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
    expect(markSeen).toHaveBeenCalledOnce()
    expect(onDrain).toHaveBeenCalledOnce()
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(onDrainFailed).not.toHaveBeenCalled()
  })

  it('leaves the completion edge unacked when the claim keeps failing', async () => {
    const { refetch } = wireQuery([row('h', 'head')])
    const { claimHeadTrigger } = wireMutations()
    claimHeadTrigger.mockRejectedValue(new Error('ipc down'))
    const onDrain = vi.fn(async () => true)
    const markSeen = vi.fn()
    const onDrainFailed = vi.fn()

    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain, onDrainFailed })),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
    expect(markSeen).not.toHaveBeenCalled()
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

    const { rerender } = renderHook(({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })), {
      initialProps: { isFulfilled: false }
    })

    await act(async () => {
      rerender({ isFulfilled: true })
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
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain, onDrainFailed })),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
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
    expect(claimTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(send).toHaveBeenCalledWith(head.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(failTrigger).not.toHaveBeenCalled()
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
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
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
    const markSeen = vi.fn()

    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain })),
      { initialProps: { isFulfilled: true } }
    )

    await act(async () => {})
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(markSeen).not.toHaveBeenCalled()

    mockUseQuery.mockImplementation(queryImpl([head]))
    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(claimHeadTrigger).toHaveBeenCalledWith({ body: { scopeKey: SCOPE } })
    expect(markSeen).toHaveBeenCalled()
    expect(onDrain).toHaveBeenCalledWith(head.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
  })

  it('ignores rows from other scopes', async () => {
    const foreign = { ...row('h', 'head'), scopeKey: 'other-topic:other-assistant' }
    wireQuery([foreign])
    wireMutations()
    const markSeen = vi.fn()

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen })),
      { initialProps: { isFulfilled: false } }
    )

    expect(result.current.items).toEqual([])

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(markSeen).not.toHaveBeenCalled()
  })

  it('refuses to remove a freshly claimed item', async () => {
    wireQuery([row('h', 'head', 'sending', new Date().toISOString())])
    const { claimTrigger, deleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: false })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    await act(async () => {
      result.current.removeId('h')
    })

    expect(claimTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
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
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('takes an item for edit and drops it from the queue', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown
    await act(async () => {
      taken = await result.current.takeForEdit('h')
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('head')
    expect(claimTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('refuses the edit take when another window owns the send', async () => {
    wireQuery([row('h', 'head', 'sending', new Date().toISOString())])
    const { claimTrigger, deleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: false })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h')
    })

    expect(taken).toBeUndefined()
    expect(deleteTrigger).not.toHaveBeenCalled()
  })

  it('releases the take back to the queue when its delete keeps failing', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    deleteTrigger.mockRejectedValue(new Error('db down'))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h')
    })

    expect(taken).toBeUndefined()
    expect(deleteTrigger).toHaveBeenCalledTimes(2)
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(toast.error).toHaveBeenCalledWith('message.error.operation_unavailable')
  })

  it('retries the take delete once before releasing it', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    deleteTrigger.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h')
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('head')
    expect(deleteTrigger).toHaveBeenCalledTimes(2)
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('returns the take when the delete commits but its response is lost', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    // First DELETE commits server-side but times out; the retry then reports
    // NOT_FOUND, proving the row is already gone — the draft must be handed
    // to the editor instead of dropped.
    deleteTrigger
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new DataApiError(ErrorCode.NOT_FOUND, 'fake queue: missing id h', 404))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h')
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('head')
    expect(deleteTrigger).toHaveBeenCalledTimes(2)
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('returns the take when the first delete attempt reports the row already gone', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    // The transport retries a timed-out DELETE and surfaces the retry's
    // NOT_FOUND on the first attempt — our own commit, so hand over the draft.
    deleteTrigger.mockRejectedValue(new DataApiError(ErrorCode.NOT_FOUND, 'fake queue: missing id h', 404))

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h')
    })

    expect((taken as { draft: { text: string } }).draft.text).toBe('head')
    expect(deleteTrigger).toHaveBeenCalledTimes(1)
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('returns the draft to its scope when the scope moves during the take delete', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, postTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
    let resolveDelete!: () => void
    deleteTrigger.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDelete = () => resolve(undefined)
      })
    )

    const { result, rerender } = renderHook(({ scopeKey }) => useFollowupQueue(baseProps({ scopeKey })), {
      initialProps: { scopeKey: SCOPE }
    })

    let taken: unknown = 'unset'
    await act(async () => {
      void result.current.takeForEdit('h').then((value) => {
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

  it('does not restore a take for an item that was already sent', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: true })

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    let taken: unknown = 'unset'
    await act(async () => {
      taken = await result.current.takeForEdit('h')
    })

    // The delete above is the correct dequeue; restoring its draft would
    // invite resending content that already went out.
    expect(taken).toBeUndefined()
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
  })

  it('retries the scope-mismatch restore until the replacement enqueue lands', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, postTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
    let resolveDelete!: () => void
    deleteTrigger.mockReturnValueOnce(
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
      void result.current.takeForEdit('h').then((value) => {
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
      const { claimTrigger, deleteTrigger, postTrigger } = wireMutations()
      claimTrigger.mockResolvedValueOnce({ claimed: true, alreadySent: false })
      let resolveDelete!: () => void
      deleteTrigger.mockReturnValueOnce(
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
        void result.current.takeForEdit('h').then((value) => {
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
      ({ scopeKey, isFulfilled }) => useFollowupQueue(baseProps({ scopeKey, isFulfilled, onDrain })),
      { initialProps: { scopeKey: SCOPE, isFulfilled: false } }
    )

    await act(async () => {
      rerender({ scopeKey: SCOPE, isFulfilled: true })
    })
    expect(claimHeadTrigger).toHaveBeenCalledWith({ body: { scopeKey: SCOPE } })
    await act(async () => {
      rerender({ scopeKey: 's2', isFulfilled: true })
    })
    await act(async () => {
      resolveClaim({ claimed: true, id: 'h', alreadySent: false })
    })
    await act(async () => {})

    expect(onDrain).not.toHaveBeenCalled()
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
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
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(claimHeadTrigger).toHaveBeenCalledWith({ body: { scopeKey: SCOPE } })
    await act(async () => {
      unmount()
    })
    await act(async () => {
      resolveClaim({ claimed: true, id: 'h', alreadySent: false })
    })
    await act(async () => {})

    expect(onDrain).not.toHaveBeenCalled()
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
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
      ({ isFulfilled, onDrain }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })),
      { initialProps: { isFulfilled: false, onDrain: firstDrain } }
    )

    await act(async () => {
      rerender({ isFulfilled: true, onDrain: firstDrain })
    })
    await act(async () => {
      rerender({ isFulfilled: true, onDrain: secondDrain })
    })
    await act(async () => {
      resolveClaim({ claimed: true, id: 'h', alreadySent: false })
    })
    await act(async () => {})

    expect(firstDrain).toHaveBeenCalledTimes(1)
    expect(secondDrain).not.toHaveBeenCalled()
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
  })

  it('reclaims and dequeues a late send success without resending it', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head'), row('t', 'tail')])
      const { claimHeadTrigger, claimTrigger, deleteTrigger, failTrigger, markSentTrigger } = wireMutations()
      claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: false })
      claimTrigger.mockResolvedValue({ claimed: true, alreadySent: false })
      let resolveSend!: (value: boolean) => void
      const onDrain = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSend = resolve
          })
      )
      const onDrainFailed = vi.fn()
      const { rerender } = renderHook(
        ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain, onDrainFailed })),
        { initialProps: { isFulfilled: false } }
      )

      await act(async () => {
        rerender({ isFulfilled: true })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      })
      expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })

      await act(async () => {
        resolveSend(true)
      })
      await act(async () => {})

      // Repaired, not resent: the row is marked sent and dequeued on the
      // reclaim, while the payload itself went out exactly once.
      expect(onDrain).toHaveBeenCalledTimes(1)
      expect(claimTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
      expect(markSentTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
      expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
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
      const { rerender } = renderHook(({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })), {
        initialProps: { isFulfilled: false }
      })

      await act(async () => {
        rerender({ isFulfilled: true })
      })
      expect(onDrain).toHaveBeenCalledOnce()
      expect(heartbeatTrigger).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      })
      expect(heartbeatTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })

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

  it('abandons a hung auto-drain send instead of wedging FIFO', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head'), row('t', 'tail')])
      const { claimHeadTrigger, deleteTrigger, failTrigger, heartbeatTrigger } = wireMutations()
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
        ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain, onDrainFailed })),
        { initialProps: { isFulfilled: false } }
      )

      await act(async () => {
        rerender({ isFulfilled: true })
      })
      expect(onDrain).toHaveBeenCalledOnce()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      })
      expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
      expect(deleteTrigger).not.toHaveBeenCalled()
      expect(onDrainFailed).toHaveBeenCalledOnce()

      // The orphaned send settling late is repaired, not resent: here the reclaim
      // fails, so nothing is dequeued and no duplicate goes out.
      await act(async () => {
        resolveSend(true)
      })
      expect(deleteTrigger).not.toHaveBeenCalled()
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

  it('abandons a hung steer send and releases the claim', async () => {
    vi.useFakeTimers()
    try {
      wireQuery([row('h', 'head')])
      const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
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
      expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
      expect(deleteTrigger).not.toHaveBeenCalled()

      await act(async () => {
        resolveSend(true)
      })
      expect(deleteTrigger).not.toHaveBeenCalled()
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
    const markSeen = vi.fn()

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen })),
      { initialProps: { isFulfilled: true } }
    )

    await act(async () => {})
    expect(result.current.items.map((item) => item.draft.text)).toEqual(['head'])
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(markSeen).not.toHaveBeenCalled()

    await act(async () => {
      rerender({ isFulfilled: true })
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
      const markSeen = vi.fn()
      const onDrainFailed = vi.fn()

      const { rerender } = renderHook(
        ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain, onDrainFailed })),
        { initialProps: { isFulfilled: false } }
      )

      await act(async () => {
        rerender({ isFulfilled: true })
      })

      expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
      expect(markSeen).not.toHaveBeenCalled()
      expect(onDrainFailed).toHaveBeenCalledOnce()

      claimHeadTrigger.mockResolvedValue({ claimed: true, id: 'h' })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(markSeen).toHaveBeenCalled()
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
        ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })),
        { initialProps: { isFulfilled: false } }
      )

      await act(async () => {
        rerender({ isFulfilled: true })
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

      const { rerender } = renderHook(({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })), {
        initialProps: { isFulfilled: false }
      })

      await act(async () => {
        rerender({ isFulfilled: true })
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

    const { rerender } = renderHook(({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })), {
      initialProps: { isFulfilled: false }
    })

    await act(async () => {
      rerender({ isFulfilled: true })
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
    const markSeen = vi.fn()

    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain })),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    // A concurrent reorder swaps the head while the first claim is in flight.
    mockUseQuery.mockImplementation(queryImpl([second, first]))
    await act(async () => {
      rerender({ isFulfilled: true })
    })
    await act(async () => {
      resolveClaim({ claimed: true, id: 'x' })
    })

    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(onDrain).toHaveBeenCalledWith(first.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'x' } })
    expect(markSeen).toHaveBeenCalledOnce()
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
    const markSeen = vi.fn()

    const { rerender } = renderHook(
      ({ scopeKey, isFulfilled }: { scopeKey: string; isFulfilled: boolean }) =>
        useFollowupQueue(baseProps({ scopeKey, isFulfilled, markSeen, onDrain })),
      { initialProps: { scopeKey: SCOPE, isFulfilled: false } }
    )

    await act(async () => {
      rerender({ scopeKey: SCOPE, isFulfilled: true })
    })
    expect(pending).toHaveLength(1)

    // Switch conversations while scope A's drain is still in flight: scope B
    // must start its own drain instead of stalling on the shared guard, while
    // A's cycle releases its claim without sending into the new scope.
    await act(async () => {
      rerender({ scopeKey: 's2', isFulfilled: true })
    })
    expect(pending).toHaveLength(2)

    await act(async () => {
      pending[0]({ claimed: true, id: 'a' })
      pending[1]({ claimed: true, id: 'b' })
    })

    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(onDrain).toHaveBeenCalledWith(headB.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'b' } })
    expect(failTrigger).toHaveBeenCalledWith({ params: { id: 'a' } })
    expect(markSeen).toHaveBeenCalledOnce()
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
    const markSeen = vi.fn()

    const { rerender } = renderHook(
      ({ scopeKey, isFulfilled }: { scopeKey: string; isFulfilled: boolean }) =>
        useFollowupQueue(baseProps({ scopeKey, isFulfilled, markSeen })),
      { initialProps: { scopeKey: SCOPE, isFulfilled: false } }
    )

    await act(async () => {
      rerender({ scopeKey: SCOPE, isFulfilled: true })
    })
    // Switch scopes while A's claim is in flight, then lose it: only B's own
    // cycle may ack, never A's stale one.
    await act(async () => {
      rerender({ scopeKey: 's2', isFulfilled: true })
    })
    await act(async () => {
      resolveClaim({ claimed: false })
    })

    expect(markSeen).toHaveBeenCalledTimes(1)
  })

  it('skips the send for a row this profile already sent', async () => {
    wireQuery([row('h', 'head')])
    const { claimHeadTrigger, deleteTrigger, markSentTrigger } = wireMutations()
    claimHeadTrigger.mockResolvedValueOnce({ claimed: true, id: 'h', alreadySent: true })
    const onDrain = vi.fn(async () => true)
    const markSeen = vi.fn()
    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain })),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(onDrain).not.toHaveBeenCalled()
    expect(markSentTrigger).not.toHaveBeenCalled()
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(markSeen).toHaveBeenCalledOnce()
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
        ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })),
        {
          initialProps: { isFulfilled: false }
        }
      )

      await act(async () => {
        rerender({ isFulfilled: true })
      })

      expect(onDrain).toHaveBeenCalledOnce()
      // The send is journaled on the row before the dequeue write, so a crash
      // between the two replays as a skip instead of a second send.
      expect(markSentTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
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
    const { rerender } = renderHook(({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })), {
      initialProps: { isFulfilled: false }
    })

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(onDrain).toHaveBeenCalledOnce()
    expect(markSentTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
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
    const markSeen = vi.fn()

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain })),
      { initialProps: { isFulfilled: false } }
    )

    // Pause while the PUT is still in flight...
    act(() => {
      result.current.setPaused(true)
    })
    expect(result.current.paused).toBe(true)

    // ...then the completion edge lands before the server echoes it back: the
    // drain must stay parked instead of sending into a paused queue.
    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(onDrain).not.toHaveBeenCalled()
    expect(markSeen).not.toHaveBeenCalled()

    // When the server echoes the pause, the hold releases onto the same value.
    await act(async () => {
      resolvePause()
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
      const markSeen = vi.fn()

      const { rerender } = renderHook(({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen })), {
        initialProps: { isFulfilled: false }
      })

      await act(async () => {
        rerender({ isFulfilled: true })
      })

      expect(claimHeadTrigger).toHaveBeenCalledTimes(2)
      for (let tick = 0; tick < 3; tick++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000)
        })
      }

      expect(claimHeadTrigger).toHaveBeenCalledTimes(8)
      expect(markSeen).not.toHaveBeenCalled()
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
    const markSeen = vi.fn()

    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain })),
      { initialProps: { isFulfilled: true } }
    )

    await act(async () => {})
    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(markSeen).not.toHaveBeenCalled()

    mockUseQuery.mockImplementation(queryImpl(false))
    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(claimHeadTrigger).toHaveBeenCalledWith({ body: { scopeKey: SCOPE } })
    expect(markSeen).toHaveBeenCalled()
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

      const { rerender } = renderHook(({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })), {
        initialProps: { isFulfilled: false }
      })

      await act(async () => {
        rerender({ isFulfilled: true })
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
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain, onDrainFailed })),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
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
    const markSeen = vi.fn()

    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain })),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(claimHeadTrigger).toHaveBeenCalledWith({ body: { scopeKey: SCOPE } })
    expect(markSeen).toHaveBeenCalled()
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
    const markSeen = vi.fn()

    const { rerender } = renderHook(({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen })), {
      initialProps: { isFulfilled: false }
    })

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(claimHeadTrigger).not.toHaveBeenCalled()
    expect(markSeen).not.toHaveBeenCalled()
  })

  it('does not drain while paused and toggles pause through the API', async () => {
    wireQuery([row('h', 'head')], true)
    const { setPausedTrigger } = wireMutations()
    const onDrain = vi.fn(async () => true)

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, onDrain })),
      { initialProps: { isFulfilled: false } }
    )

    expect(result.current.paused).toBe(true)
    await act(async () => {
      rerender({ isFulfilled: true })
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
