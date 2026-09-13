import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QUEUE_LIMIT, useFollowupQueue } from '../useFollowupQueue'

const keyFor = (scopeKey: string) => `followup-queue.${scopeKey}`

const draft = (text: string) => ({ text, tokens: [] }) as any
const payload = (text: string) => ({ text, userMessageParts: [{ type: 'text', text }] }) as any
const item = (id: string, text: string) => ({ id, draft: draft(text), payload: payload(text) })

const queues = () => MockCacheUtils.getCurrentState().memoryCache as Map<string, { value: unknown }>
const persistedTexts = (scopeKey: string): string[] => {
  const entry = queues().get(keyFor(scopeKey))?.value as { items?: Array<{ draft?: { text?: string } }> } | undefined
  const items = (entry?.items ?? []) as Array<{ draft?: { text?: string } }>
  return items.map((i) => i.draft?.text).filter((text): text is string => typeof text === 'string')
}

const seedQueue = (scopeKey: string, items: unknown[], paused = false, failedItemId?: string) => {
  MockCacheUtils.setInitialState({
    memory: [[keyFor(scopeKey), { items, paused, ...(failedItemId ? { failedItemId } : {}) }]]
  })
}

beforeEach(() => {
  MockCacheUtils.resetMocks()
})

describe('useFollowupQueue', () => {
  it('enqueues (storing draft + payload, caching) and removeId dequeues', () => {
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )

    act(() => {
      result.current.enqueue(draft('a'), payload('a'))
    })
    act(() => {
      result.current.enqueue(draft('b'), payload('b'))
    })

    expect(result.current.items.map((i) => i.draft.text)).toEqual(['a', 'b'])
    expect(result.current.items.map((i) => i.payload.text)).toEqual(['a', 'b'])
    expect(persistedTexts('s1')).toEqual(['a', 'b'])

    act(() => {
      result.current.removeId(result.current.items[0].id)
    })
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['b'])
  })

  it('reorders the queue and caches the new order', () => {
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )

    act(() => {
      result.current.enqueue(draft('a'), payload('a'))
    })
    act(() => {
      result.current.enqueue(draft('b'), payload('b'))
    })
    const [first, second] = result.current.items

    act(() => {
      result.current.reorder([second, first])
    })

    expect(result.current.items.map((i) => i.draft.text)).toEqual(['b', 'a'])
    expect(persistedTexts('s1')).toEqual(['b', 'a'])
  })

  it('restores a queue (items + paused) cached in an earlier session', () => {
    seedQueue('s1', [item('x', 'queued')], true)
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )

    expect(result.current.items.map((i) => i.draft.text)).toEqual(['queued'])
    expect(result.current.paused).toBe(true)
  })

  it('reloads the queue from the memory cache when the scopeKey changes', () => {
    seedQueue('s2', [item('x', 'queued')])
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useFollowupQueue({ scopeKey, isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() }),
      { initialProps: { scopeKey: 's1' } }
    )

    expect(result.current.items).toEqual([])
    rerender({ scopeKey: 's2' })
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['queued'])
  })

  it('rejects enqueues beyond the per-conversation limit and drops the drained entry', () => {
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )

    for (let index = 0; index < QUEUE_LIMIT; index += 1) {
      act(() => {
        expect(result.current.enqueue(draft(`m${index}`), payload(`m${index}`))).toBe('ok')
      })
    }
    act(() => {
      expect(result.current.enqueue(draft('overflow'), payload('overflow'))).toBe('full')
    })
    expect(result.current.items).toHaveLength(QUEUE_LIMIT)
    expect(persistedTexts('s1')).toHaveLength(QUEUE_LIMIT)

    // Drain every item; the queue empties in the memory cache.
    for (const queued of [...result.current.items]) {
      act(() => {
        result.current.removeId(queued.id)
      })
    }
    expect(result.current.items).toEqual([])
    expect(persistedTexts('s1')).toEqual([])
  })

  it('drains the head on the live→idle edge, then dequeues on success', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    const markSeen = vi.fn()
    const headPayload = payload('head')
    seedQueue('s1', [{ id: 'h', draft: draft('head'), payload: headPayload }])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    expect(onDrain).not.toHaveBeenCalled()

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(markSeen).toHaveBeenCalled()
    expect(onDrain).toHaveBeenCalledWith(headPayload)
    expect(result.current.items).toEqual([])
  })

  it('auto-pauses and marks the head failed when auto-drain fails, and retry resolves it', async () => {
    const onDrain = vi
      .fn()
      .mockResolvedValueOnce(false) // auto-drain fails
      .mockResolvedValueOnce(false) // retry fails again
      .mockResolvedValueOnce(true) // retry succeeds
    const markSeen = vi.fn()
    const head = item('h', 'head')
    seedQueue('s1', [head])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(markSeen).toHaveBeenCalled()
    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(result.current.failedItemId).toBe(head.id)
    expect(result.current.paused).toBe(true)
    expect(result.current.items).toEqual([head])

    // Retry fails again → stays failed.
    await act(async () => {
      result.current.retryFailed()
    })
    expect(onDrain).toHaveBeenCalledTimes(2)
    expect(result.current.failedItemId).toBe(head.id)

    // Retry succeeds → dequeued, failure cleared, auto-drain resumes.
    await act(async () => {
      result.current.retryFailed()
    })
    expect(onDrain).toHaveBeenCalledTimes(3)
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items).toEqual([])
  })

  it('auto-pauses and marks the head failed when auto-drain rejects', async () => {
    const onDrain = vi.fn().mockRejectedValue(new Error('drain blew up'))
    const markSeen = vi.fn()
    const head = item('h', 'head')
    seedQueue('s1', [head])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(onDrain).toHaveBeenCalledWith(head.payload)
    expect(result.current.failedItemId).toBe(head.id)
    expect(result.current.paused).toBe(true)
    expect(result.current.items).toEqual([head])
  })

  it('skip drops the failed head and keeps the queue moving with the next message', async () => {
    const onDrain = vi
      .fn()
      .mockResolvedValueOnce(false) // head fails
      .mockResolvedValueOnce(true) // next head sends
    const markSeen = vi.fn()
    seedQueue('s1', [item('h1', 'first'), item('h2', 'second')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(result.current.failedItemId).toBe('h1')

    await act(async () => {
      result.current.skipFailed()
    })

    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(onDrain).toHaveBeenLastCalledWith(payload('second'))
    expect(result.current.items.map((i) => i.draft.text)).toEqual([])
  })

  it('drops a cached failure marker for an item that is no longer queued', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    // A skip whose follow-up drain settled before the failure reset committed can cache
    // a failure for an absent item; the restored queue must not stay blocked with no banner.
    MockCacheUtils.setInitialState({
      memory: [[keyFor('s1'), { items: [item('h2', 'second')], paused: true, failedItemId: 'h1' }]]
    })

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    expect(result.current.failedItemId).toBeNull()

    act(() => {
      result.current.setPaused(false)
    })
    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(onDrain).toHaveBeenCalledWith(payload('second'))
  })

  it('clear (abort) drops every pending message and the failure state', async () => {
    const onDrain = vi.fn().mockResolvedValue(false)
    seedQueue('s1', [item('h1', 'first'), item('h2', 'second')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(result.current.failedItemId).toBe('h1')

    act(() => {
      result.current.clear()
    })

    expect(result.current.items).toEqual([])
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(persistedTexts('s1')).toEqual([])
  })

  it('does not drain while paused', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    seedQueue('s1', [item('h', 'head')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    act(() => {
      result.current.setPaused(true)
    })
    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(onDrain).not.toHaveBeenCalled()
    expect(result.current.items).toHaveLength(1)
  })

  it('does not auto-drain while a failure is unresolved', async () => {
    const onDrain = vi.fn().mockResolvedValue(false)
    seedQueue('s1', [item('h1', 'first')])

    const { rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    // A second completion edge must not re-drain the failed head on its own.
    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
  })

  it('keeps each conversation paused until the user resumes it', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    seedQueue('s1', [item('h', 'head')])

    const { result, rerender } = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )

    act(() => {
      result.current.setPaused(true)
    })
    act(() => rerender({ scopeKey: 's2', isFulfilled: false }))
    expect(result.current.paused).toBe(false)
    await act(async () => rerender({ scopeKey: 's1', isFulfilled: true }))

    expect(result.current.paused).toBe(true)
    expect(onDrain).not.toHaveBeenCalled()
    expect(result.current.items).toHaveLength(1)
  })

  it('removing the failed head from the dock resolves the failure and resumes', async () => {
    const onDrain = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    seedQueue('s1', [item('h1', 'first'), item('h2', 'second')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(result.current.failedItemId).toBe('h1')

    await act(async () => {
      result.current.removeId('h1')
    })

    // Deleting the failed head re-arms the queue like Skip does: the next message
    // drains immediately even though the completion edge was already consumed.
    expect(onDrain).toHaveBeenCalledTimes(2)
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items).toEqual([])
  })

  it('clear during an in-flight drain drops the resolution instead of resurrecting failure state', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first'), item('h2', 'second')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.clear()
    })
    expect(result.current.items).toEqual([])

    // The in-flight send settles with failure after the queue was cleared — must not stick the
    // queue in the hidden-banner state (failedItemId set, banner gone, drains blocked forever).
    await act(async () => {
      resolveDrain(false)
    })

    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items).toEqual([])
    expect(persistedTexts('s1')).toEqual([])
  })

  it('abort during an in-flight retry leaves the queue clean when the retry fails', async () => {
    let resolveRetry!: (sent: boolean) => void
    const onDrain = vi
      .fn()
      .mockResolvedValueOnce(false) // auto-drain fails
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveRetry = resolve)))
    seedQueue('s1', [item('h1', 'first'), item('h2', 'second')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(result.current.failedItemId).toBe('h1')

    await act(async () => {
      result.current.retryFailed()
    })
    expect(onDrain).toHaveBeenCalledTimes(2)

    act(() => {
      result.current.clear() // the dock's Abort action
    })
    expect(result.current.items).toEqual([])
    expect(result.current.failedItemId).toBeNull()

    await act(async () => {
      resolveRetry(false)
    })

    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items).toEqual([])
  })

  it('removing the item an in-flight drain is sending drops the pending resolution', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.removeId('h1')
    })

    await act(async () => {
      resolveDrain(false)
    })

    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items).toEqual([])
  })

  it('switching conversations while a drain is in flight drops the stale resolution', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first')])

    const { result, rerender } = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )

    await act(async () => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ scopeKey: 's2', isFulfilled: false })
    })

    await act(async () => {
      resolveDrain(false)
    })

    // The stale failure must not poison the new conversation's queue (banner hidden, drains blocked).
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items).toEqual([])
  })

  it('skip and retry are no-ops while a retry is already in flight (no concurrent sends)', async () => {
    let resolveRetry!: (sent: boolean) => void
    const onDrain = vi
      .fn()
      .mockResolvedValueOnce(false) // auto-drain fails
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveRetry = resolve)))
      .mockResolvedValueOnce(true) // next head sends after the retried head succeeds
    const markSeen = vi.fn()
    seedQueue('s1', [item('h1', 'first'), item('h2', 'second')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(result.current.failedItemId).toBe('h1')

    await act(async () => {
      result.current.retryFailed()
    })
    expect(onDrain).toHaveBeenCalledTimes(2)

    // Double-click Retry + Skip while the retry send is pending — no second send may start.
    act(() => {
      result.current.retryFailed()
    })
    act(() => {
      result.current.skipFailed()
    })
    expect(onDrain).toHaveBeenCalledTimes(2)
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['first', 'second'])

    // The retried head succeeds → dequeued; like Skip, the queue continues
    // with the next message immediately instead of stalling.
    await act(async () => {
      resolveRetry(true)
    })
    expect(onDrain).toHaveBeenCalledTimes(3)
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.items).toEqual([])
  })

  it('queueing one conversation does not clobber another conversation\u2019s entry', () => {
    const first = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )
    const second = renderHook(() =>
      useFollowupQueue({ scopeKey: 's2', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )

    act(() => {
      first.result.current.enqueue(draft('a'), payload('a'))
    })
    act(() => {
      second.result.current.enqueue(draft('b'), payload('b'))
    })

    expect(persistedTexts('s1')).toEqual(['a'])
    expect(persistedTexts('s2')).toEqual(['b'])
  })

  it('a claimed manual send blocks the auto-drain until released', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    const markSeen = vi.fn()
    seedQueue('s1', [item('h1', 'first')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    const headId = result.current.items[0].id
    act(() => {
      expect(result.current.tryClaimSend(headId)).toBe(true)
    })
    expect(result.current.drainingId).toBe(headId)

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    // The fulfilled edge must not start a second send for the claimed item.
    expect(onDrain).not.toHaveBeenCalled()

    act(() => {
      result.current.releaseSend(headId)
    })
    expect(result.current.drainingId).toBeNull()

    // A fresh completion edge drains normally once the claim is released.
    await act(async () => {
      rerender({ isFulfilled: false })
    })
    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
  })

  it('removing the failed head while its retry is in flight does not start a second send', async () => {
    let resolveRetry!: (sent: boolean) => void
    const onDrain = vi
      .fn()
      .mockResolvedValueOnce(false) // auto-drain fails
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveRetry = resolve)))
      .mockResolvedValueOnce(true) // next head sends on the following completion edge
    // Stable like the production markSeen (useTopicStreamStatus): the drain effect
    // only re-fires on a new completion edge, not on every re-render.
    const markSeen = vi.fn()
    seedQueue('s1', [item('h1', 'first'), item('h2', 'second')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(result.current.failedItemId).toBe('h1')

    await act(async () => {
      result.current.retryFailed()
    })
    expect(onDrain).toHaveBeenCalledTimes(2)

    // Delete the failed head mid-retry: the next item must not send while the
    // retry's send is still pending (single-send serialization).
    act(() => {
      result.current.removeId('h1')
    })
    expect(onDrain).toHaveBeenCalledTimes(2)
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['second'])

    // The invalidated retry settles successfully — dropped, never resurrects failure state.
    await act(async () => {
      resolveRetry(true)
    })
    expect(onDrain).toHaveBeenCalledTimes(2)
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['second'])
    expect(persistedTexts('s1')).toEqual(['second'])

    // The next item still drains on the following completion edge (no stall).
    await act(async () => {
      rerender({ isFulfilled: false })
    })
    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(3)
    expect(result.current.items).toEqual([])
  })

  it('a successful drain that settles after a scope switch dequeues from its original scope', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first')])

    const { result, rerender } = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )

    await act(async () => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ scopeKey: 's2', isFulfilled: false })
    })

    await act(async () => {
      resolveDrain(true)
    })

    // Sent is sent: h1 leaves s1's persisted entry, so returning to s1 never redelivers it.
    expect(persistedTexts('s1')).toEqual([])
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items).toEqual([])
  })

  it('a failed drain that settles after a scope switch keeps the original scope queued', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first')])

    const { result, rerender } = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )

    await act(async () => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ scopeKey: 's2', isFulfilled: false })
    })

    await act(async () => {
      resolveDrain(false)
    })

    // Not sent: h1 stays queued in s1 (redrains on return) and s2 stays clean.
    expect(persistedTexts('s1')).toEqual(['first'])
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items).toEqual([])

    // Returning to s1 surfaces the honest failure banner instead of stalling.
    act(() => {
      rerender({ scopeKey: 's1', isFulfilled: false })
    })
    expect(result.current.failedItemId).toBe('h1')
    expect(result.current.paused).toBe(true)
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['first'])
  })

  it('a late failure from an unmounted hook surfaces as a failure on the remounted queue', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first')])

    const { rerender, unmount } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    unmount()

    const second = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain })
    )
    act(() => {
      second.result.current.enqueue(draft('new'), payload('new'))
    })

    // The stale failure records an honest banner instead of stalling silently.
    await act(async () => {
      resolveDrain(false)
    })

    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(second.result.current.failedItemId).toBe('h1')
    expect(second.result.current.paused).toBe(true)
    expect(second.result.current.items.map((i) => i.draft.text)).toEqual(['first', 'new'])
    expect(persistedTexts('s1')).toEqual(['first', 'new'])
  })

  it('a late success from an unmounted hook dequeues the sent item but keeps newer work', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first')])

    const { rerender, unmount } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    unmount()

    const second = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain })
    )
    act(() => {
      second.result.current.enqueue(draft('new'), payload('new'))
    })

    await act(async () => {
      resolveDrain(true)
    })

    // h1 was sent: it leaves the persisted entry while the newer item survives.
    expect(persistedTexts('s1')).toEqual(['new'])
    expect(second.result.current.failedItemId).toBeNull()
    expect(second.result.current.paused).toBe(false)
  })

  it('discards cached entries with a misshapen draft instead of crashing the dock', () => {
    const validPayload = payload('x')
    seedQueue('s1', [
      item('good', 'fine'),
      { id: 'bad-text', draft: { text: 42, tokens: [] }, payload: payload('x') },
      { id: 'bad-tokens', draft: { text: 'x', tokens: 'nope' }, payload: payload('x') },
      { id: 'bad-token-element', draft: { text: 'x', tokens: [null] }, payload: payload('x') },
      { id: 'bad-token-id', draft: { text: 'x', tokens: [{ kind: 'skill', label: 'pdf' }] }, payload: payload('x') },
      { id: 'bad-draft', draft: null, payload: payload('x') },
      { id: 'bad-payload', draft: draft('x'), payload: 'nope' },
      { id: 'bad-models', draft: draft('x'), payload: { ...validPayload, mentionedModels: 'nope' } },
      { id: 'bad-attachments', draft: draft('x'), payload: { ...validPayload, attachments: {} } },
      { id: 'bad-attachment-element', draft: draft('x'), payload: { ...validPayload, attachments: [null] } },
      { id: 'bad-part-element', draft: draft('x'), payload: { ...validPayload, userMessageParts: [null] } },
      { id: 'bad-part-type', draft: draft('x'), payload: { ...validPayload, userMessageParts: [{}] } },
      { id: 'bad-part-text', draft: draft('x'), payload: { ...validPayload, userMessageParts: [{ type: 'text' }] } },
      { id: 'bad-payload-text', draft: draft('x'), payload: { ...validPayload, text: undefined } },
      { id: 'bad-no-parts', draft: draft('x'), payload: { text: 'x' } },
      { id: '', draft: draft('x'), payload: payload('x') }
    ])
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )

    // Only the well-formed entry survives (the dock calls tokens.some/text.trim,
    // filters on token.kind, and edit-restore reads part types/text + payload text).
    expect(result.current.items.map((i) => i.id)).toEqual(['good'])
  })

  it('switching away and back mid-drain sends the head exactly once on success', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
      .mockResolvedValue(true)
    const markSeen = vi.fn()
    seedQueue('s1', [item('h1', 'first')])

    const { result, rerender } = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen, onDrain }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )

    await act(async () => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ scopeKey: 's2', isFulfilled: true })
    })
    act(() => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    // The re-arm must not start a replacement send for the still-pending payload.
    expect(onDrain).toHaveBeenCalledTimes(1)

    // The original send succeeds: applied to the same live queue, never resent.
    await act(async () => {
      resolveDrain(true)
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(result.current.items).toEqual([])
    expect(result.current.failedItemId).toBeNull()
    expect(persistedTexts('s1')).toEqual([])
  })

  it('switching away and back mid-drain records an honest failure instead of resending', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first')])

    const { result, rerender } = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )

    await act(async () => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ scopeKey: 's2', isFulfilled: true })
    })
    act(() => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    // Nothing was sent and the head is still live: the failure banner is honest.
    await act(async () => {
      resolveDrain(false)
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(result.current.failedItemId).toBe('h1')
    expect(result.current.paused).toBe(true)
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['first'])
  })

  it('a manual steer cannot claim an item whose auto-send is still pending', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first')])

    const { result, rerender } = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )

    await act(async () => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    const headId = result.current.items[0].id
    act(() => {
      rerender({ scopeKey: 's2', isFulfilled: true })
    })
    // The claim slot looks free after the switch, but the send is pending.
    act(() => {
      expect(result.current.tryClaimSend(headId)).toBe(false)
    })

    await act(async () => {
      resolveDrain(true)
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
  })

  it('a remount does not resend a head another instance is still sending', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first')])

    const first = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )
    await act(async () => {
      first.rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    first.unmount()

    // Remount while the original send is still pending, already fulfilled: the
    // durable claim blocks a replacement send for the same payload.
    const second = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: true } }
    )
    expect(onDrain).toHaveBeenCalledTimes(1)

    // The original send succeeds: dequeued from the shared entry, still one send.
    await act(async () => {
      resolveDrain(true)
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(persistedTexts('s1')).toEqual([])

    // The remounted hook still lists the ghost row; the next edge syncs it away
    // instead of resending it.
    await act(async () => {
      second.rerender({ isFulfilled: false })
    })
    await act(async () => {
      second.rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(second.result.current.items).toEqual([])
  })

  it('a stale failure records an honest failure for the scope to show on return', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
      .mockResolvedValue(true)
    seedQueue('s1', [item('h1', 'first')])

    const { result, rerender } = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )

    await act(async () => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ scopeKey: 's2', isFulfilled: true })
    })
    await act(async () => {
      resolveDrain(false)
    })
    // Nothing sent: the head stays queued and the claim is released.
    expect(persistedTexts('s1')).toEqual(['first'])

    // Returning to the scope surfaces the honest failure banner (retry path),
    // and the durable claim is released so nothing stalls silently.
    await act(async () => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(result.current.failedItemId).toBe('h1')
    expect(result.current.paused).toBe(true)
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['first'])
  })

  it('removing an in-flight head blocks the next item until the send settles, across remount', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
      .mockResolvedValue(true)
    // Stable like production markSeen: the drain effect only re-fires on a new
    // completion edge, not on every re-render.
    const markSeen = vi.fn()
    seedQueue('s1', [item('h1', 'first'), item('h2', 'second')])

    const first = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: false } }
    )
    await act(async () => {
      first.rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    // Delete the head while its send is pending, then remount: the durable claim
    // for the removed head must still serialize the next item.
    act(() => {
      first.result.current.removeId('h1')
    })
    first.unmount()

    const second = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: true } }
    )
    expect(second.result.current.items.map((i) => i.draft.text)).toEqual(['second'])
    expect(onDrain).toHaveBeenCalledTimes(1)

    // The removed send succeeds: claim released, nothing resurrected.
    await act(async () => {
      resolveDrain(true)
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(persistedTexts('s1')).toEqual(['second'])

    // The next head drains on the following edge (no stall, no concurrency).
    await act(async () => {
      second.rerender({ isFulfilled: false })
    })
    await act(async () => {
      second.rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(2)
    expect(second.result.current.items).toEqual([])
  })

  it('a stale settlement never clears a newer send’s durable claim', async () => {
    let resolveFirst!: (sent: boolean) => void
    let resolveSecond!: (sent: boolean) => void
    const onDrain = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveSecond = resolve)))
    // One seed call: setInitialState resets the whole memory map.
    MockCacheUtils.setInitialState({
      memory: [
        [keyFor('s1'), { items: [item('h1', 'first')], paused: false }],
        [keyFor('s2'), { items: [item('h2', 'second')], paused: false }]
      ]
    })

    const { rerender } = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )
    await act(async () => {
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    // Newer send in another scope takes its own durable claim.
    act(() => {
      rerender({ scopeKey: 's2', isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(2)

    // The older send settles stale: the newer claim must survive it.
    await act(async () => {
      resolveFirst(true)
    })
    const secondEntry = queues().get(keyFor('s2'))?.value as { pendingDrainId?: unknown } | undefined
    expect(secondEntry?.pendingDrainId).toBe('h2')
    expect(persistedTexts('s1')).toEqual([])

    await act(async () => {
      resolveSecond(true)
    })
    expect(onDrain).toHaveBeenCalledTimes(2)
    expect(persistedTexts('s2')).toEqual([])
  })

  it('a manual steer holds a durable claim across remount until released', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    seedQueue('s1', [item('h1', 'first')])

    const first = renderHook(() => useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain }))
    const headId = first.result.current.items[0].id
    // Manual steer claims without sending through the hook: the composer owns
    // the send and holds the claim until it releases it.
    act(() => {
      expect(first.result.current.tryClaimSend(headId)).toBe(true)
    })
    first.unmount()

    // Remount while fulfilled: the durable manual claim blocks an auto redrain.
    const second = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: true } }
    )
    expect(onDrain).not.toHaveBeenCalled()

    // Releasing the manual claim lets the queue drain normally (single send).
    act(() => {
      first.result.current.releaseSend(headId)
    })
    await act(async () => {
      second.rerender({ isFulfilled: false })
    })
    await act(async () => {
      second.rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(second.result.current.items).toEqual([])
  })

  it('a second hook instance reloads external queue changes', () => {
    const first = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )
    const second = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )
    expect(second.result.current.items).toEqual([])

    act(() => {
      first.result.current.enqueue(draft('a'), payload('a'))
    })
    expect(second.result.current.items.map((i) => i.draft.text)).toEqual(['a'])

    act(() => {
      first.result.current.setPaused(true)
    })
    expect(second.result.current.paused).toBe(true)
  })

  it('an unrelated write preserves another instance’s live durable claim', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
      .mockResolvedValue(true)
    // Stable like production markSeen: the drain effect only re-fires on a new
    // completion edge, not on every re-render.
    const markSeen = vi.fn()
    seedQueue('s1', [item('h1', 'first')])

    const first = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: false } }
    )
    await act(async () => {
      first.rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    // A second instance mutates the queue while the first send is pending: the
    // persist must not drop the live claim.
    const second = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain })
    )
    act(() => {
      second.result.current.enqueue(draft('new'), payload('new'))
    })
    const entry = queues().get(keyFor('s1'))?.value as { pendingDrainId?: unknown } | undefined
    expect(entry?.pendingDrainId).toBe('h1')

    await act(async () => {
      resolveDrain(true)
    })
    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(persistedTexts('s1')).toEqual(['new'])
  })

  it('a manual steer success after a scope switch dequeues from the claim scope', async () => {
    MockCacheUtils.setInitialState({
      memory: [
        [keyFor('sA'), { items: [item('x', 'ex')], paused: false }],
        [keyFor('sB'), { items: [], paused: false }]
      ]
    })
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useFollowupQueue({ scopeKey, isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() }),
      { initialProps: { scopeKey: 'sA' } }
    )
    const headId = result.current.items[0].id
    act(() => {
      expect(result.current.tryClaimSend(headId)).toBe(true)
    })

    // Scope switches while the manual send is pending; the send succeeds.
    act(() => {
      rerender({ scopeKey: 'sB' })
    })
    act(() => {
      result.current.removeId(headId)
    })
    act(() => {
      result.current.releaseSend(headId)
    })

    // The sent item is gone from its own scope (not redelivered on revisit),
    // and the other scope is untouched.
    expect(persistedTexts('sA')).toEqual([])
    expect(persistedTexts('sB')).toEqual([])
    act(() => {
      rerender({ scopeKey: 'sA' })
    })
    expect(result.current.items).toEqual([])
  })

  it('the cross-instance subscription follows scope switches', () => {
    const s1Writer = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )
    const s2Writer = renderHook(() =>
      useFollowupQueue({ scopeKey: 's2', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useFollowupQueue({ scopeKey, isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() }),
      { initialProps: { scopeKey: 's1' } }
    )

    act(() => {
      rerender({ scopeKey: 's2' })
    })
    expect(result.current.items).toEqual([])

    // Writes to the previous scope after switching away must not leak in...
    act(() => {
      s1Writer.result.current.enqueue(draft('a'), payload('a'))
    })
    expect(result.current.items).toEqual([])

    // ...while writes to the current scope reload live.
    act(() => {
      s2Writer.result.current.enqueue(draft('b'), payload('b'))
    })
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['b'])
  })

  it('a manual-steer success landing after unmount preserves newer queued work', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    seedQueue('s1', [item('h1', 'first')])

    const first = renderHook(() => useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain }))
    const headId = first.result.current.items[0].id
    act(() => {
      expect(first.result.current.tryClaimSend(headId)).toBe(true)
    })
    first.unmount()

    // Same-scope remount queues newer work while the manual send is pending.
    const second = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain })
    )
    act(() => {
      second.result.current.enqueue(draft('new'), payload('new'))
    })

    // The dead instance's success continuation must dequeue surgically — the
    // frozen snapshot write would drop the newer item.
    act(() => {
      first.result.current.removeId(headId)
      first.result.current.releaseSend(headId)
    })
    expect(persistedTexts('s1')).toEqual(['new'])
    expect(second.result.current.items.map((i) => i.draft.text)).toEqual(['new'])
    expect(onDrain).not.toHaveBeenCalled()
  })

  it('overlapping manual steers across a scope switch clean up in their own scopes', () => {
    const onDrain = vi.fn()
    // One seed call: setInitialState resets the whole memory map.
    MockCacheUtils.setInitialState({
      memory: [
        [keyFor('sA'), { items: [item('x', 'ex')], paused: false }],
        [keyFor('sB'), { items: [item('y', 'why')], paused: false }]
      ]
    })
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useFollowupQueue({ scopeKey, isFulfilled: false, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 'sA' } }
    )
    const xId = result.current.items[0].id
    act(() => {
      expect(result.current.tryClaimSend(xId)).toBe(true)
    })

    // Second steer after a scope switch: the first claim's scope must survive it.
    act(() => {
      rerender({ scopeKey: 'sB' })
    })
    const yId = result.current.items[0].id
    act(() => {
      expect(result.current.tryClaimSend(yId)).toBe(true)
    })

    // First send succeeds: dequeued from its own scope, second claim intact.
    act(() => {
      result.current.removeId(xId)
      result.current.releaseSend(xId)
    })
    expect(persistedTexts('sA')).toEqual([])
    expect(persistedTexts('sB')).toEqual(['why'])

    // Second send succeeds: dequeued normally, no auto-send ever fired.
    act(() => {
      result.current.removeId(yId)
      result.current.releaseSend(yId)
    })
    expect(persistedTexts('sB')).toEqual([])
    expect(onDrain).not.toHaveBeenCalled()
  })

  it('an unmounted manual steer after a scope switch dequeues from the claim scope', () => {
    const onDrain = vi.fn()
    // One seed call: setInitialState resets the whole memory map.
    MockCacheUtils.setInitialState({
      memory: [
        [keyFor('sA'), { items: [item('x', 'ex')], paused: false }],
        [keyFor('sB'), { items: [], paused: false }]
      ]
    })
    const { result, rerender, unmount } = renderHook(
      ({ scopeKey }) => useFollowupQueue({ scopeKey, isFulfilled: false, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 'sA' } }
    )
    const headId = result.current.items[0].id
    act(() => {
      expect(result.current.tryClaimSend(headId)).toBe(true)
    })

    // Scope switches, then the composer unmounts while the manual send is pending.
    act(() => {
      rerender({ scopeKey: 'sB' })
    })
    unmount()

    // The dead instance's success continuation must route by the claim scope
    // (sA), not the frozen ref scope (sB) — otherwise the sent item stays queued
    // in sA and is delivered again on revisit.
    act(() => {
      result.current.removeId(headId)
      result.current.releaseSend(headId)
    })
    expect(persistedTexts('sA')).toEqual([])
    expect(persistedTexts('sB')).toEqual([])
    expect(onDrain).not.toHaveBeenCalled()

    // Revisiting the original scope finds nothing to redeliver.
    const revisit = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 'sA', isFulfilled: false } }
    )
    expect(revisit.result.current.items).toEqual([])
    act(() => {
      revisit.rerender({ scopeKey: 'sA', isFulfilled: true })
    })
    expect(onDrain).not.toHaveBeenCalled()
  })

  it('tryClaimSend fails while an auto-drain is in flight', async () => {
    let resolveDrain!: (sent: boolean) => void
    const onDrain = vi.fn(() => new Promise<boolean>((resolve) => (resolveDrain = resolve)))
    seedQueue('s1', [item('h1', 'first')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })
    expect(onDrain).toHaveBeenCalledTimes(1)

    const headId = result.current.items[0].id
    act(() => {
      expect(result.current.tryClaimSend(headId)).toBe(false)
    })

    await act(async () => {
      resolveDrain(true)
    })
    expect(result.current.drainingId).toBeNull()
    expect(result.current.items).toEqual([])
  })
})
