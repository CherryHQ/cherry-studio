import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { FOLLOWUP_QUEUE_LIMIT, type FollowupQueueItem as FollowupQueueRow } from '@shared/data/types/followupQueue'

import { useFollowupQueue } from '../useFollowupQueue'

const SCOPE = 's1'

const row = (id: string, text: string, status: FollowupQueueRow['status'] = 'pending'): FollowupQueueRow => ({
  id,
  scopeKey: SCOPE,
  draft: { text, tokens: [] },
  payload: { text, userMessageParts: [] },
  status,
  orderKey: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
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
  const failTrigger = vi.fn(async (): Promise<any> => undefined)
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
    if (method === 'POST' && path === '/followup-queues/:id/fail')
      return { trigger: failTrigger, isLoading: false, error: undefined }
    if (method === 'PUT' && path === '/followup-queue-states')
      return { trigger: setPausedTrigger, isLoading: false, error: undefined }
    throw new Error(`unexpected mutation ${method} ${path}`)
  })
  return { postTrigger, deleteTrigger, reorderTrigger, claimTrigger, failTrigger, setPausedTrigger }
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
      body: { scopeKey: SCOPE, draft: draft('new'), payload: payload('new') }
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
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
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
    expect(claimTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(onDrain).toHaveBeenCalledWith(head.payload)
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(failTrigger).not.toHaveBeenCalled()
  })

  it('marks the head failed and reports when the send fails', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
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
    const { claimTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
    const onDrain = vi.fn(async () => true)
    const markSeen = vi.fn()

    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue(baseProps({ isFulfilled, markSeen, onDrain })),
      { initialProps: { isFulfilled: true } }
    )

    await act(async () => {})
    expect(claimTrigger).not.toHaveBeenCalled()
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

    expect(claimTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(markSeen).toHaveBeenCalled()
    expect(onDrain).toHaveBeenCalledWith(head.payload)
  })

  it('retries the claim once after a transient failure', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger } = wireMutations()
    claimTrigger.mockRejectedValueOnce(new Error('ipc down'))
    claimTrigger.mockResolvedValueOnce({ claimed: true })
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

    expect(claimTrigger).toHaveBeenCalledTimes(2)
    expect(markSeen).toHaveBeenCalledOnce()
    expect(onDrain).toHaveBeenCalledOnce()
    expect(deleteTrigger).toHaveBeenCalledWith({ params: { id: 'h' } })
    expect(onDrainFailed).not.toHaveBeenCalled()
  })

  it('leaves the completion edge unacked when the claim keeps failing', async () => {
    const { refetch } = wireQuery([row('h', 'head')])
    const { claimTrigger } = wireMutations()
    claimTrigger.mockRejectedValue(new Error('ipc down'))
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

    expect(claimTrigger).toHaveBeenCalledTimes(2)
    expect(markSeen).not.toHaveBeenCalled()
    expect(onDrain).not.toHaveBeenCalled()
    expect(onDrainFailed).toHaveBeenCalledOnce()
    expect(refetch).toHaveBeenCalled()
  })

  it('retries the dequeue write after a successful send instead of replaying it', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger, failTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
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
    const { claimTrigger, deleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: true })
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

  it('skips the send silently when another window wins the claim', async () => {
    wireQuery([row('h', 'head')])
    const { claimTrigger, deleteTrigger } = wireMutations()
    claimTrigger.mockResolvedValueOnce({ claimed: false })
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

  it('removes and reorders through the API', () => {
    const first = row('a', 'a')
    const second = row('b', 'b')
    wireQuery([first, second])
    const { deleteTrigger, reorderTrigger } = wireMutations()

    const { result } = renderHook(() => useFollowupQueue(baseProps()))

    act(() => result.current.removeId('a'))
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
