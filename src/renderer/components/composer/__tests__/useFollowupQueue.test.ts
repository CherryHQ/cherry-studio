import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QUEUE_LIMIT, useFollowupQueue } from '../useFollowupQueue'

const QUEUE_KEY = 'ui.composer.followup_queue'

const draft = (text: string) => ({ text, tokens: [] }) as any
const payload = (text: string) => ({ text, userMessageParts: [{ type: 'text', text }] }) as any
const item = (id: string, text: string) => ({ id, draft: draft(text), payload: payload(text) })

const queues = () =>
  (MockCacheUtils.getCurrentState().persistCache.get(QUEUE_KEY) as Record<string, any> | undefined) ?? {}
const persistedTexts = (scopeKey: string) => (queues()[scopeKey]?.items ?? []).map((i: any) => i.draft.text)

const seedQueue = (scopeKey: string, items: unknown[], paused = false) => {
  MockCacheUtils.setInitialState({
    persist: [[QUEUE_KEY, { [scopeKey]: { items, paused } }]]
  })
}

beforeEach(() => {
  MockCacheUtils.resetMocks()
})

describe('useFollowupQueue', () => {
  it('enqueues (storing draft + payload, persisting) and removeId dequeues', () => {
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

  it('reorders the queue and persists the new order', () => {
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

  it('restores a queue (items + paused) persisted in an earlier session', () => {
    seedQueue('s1', [item('x', 'queued')], true)
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )

    expect(result.current.items.map((i) => i.draft.text)).toEqual(['queued'])
    expect(result.current.paused).toBe(true)
  })

  it('reloads the queue from the persist cache when the scopeKey changes', () => {
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
        expect(result.current.enqueue(draft(`m${index}`), payload(`m${index}`))).toBe(true)
      })
    }
    act(() => {
      expect(result.current.enqueue(draft('overflow'), payload('overflow'))).toBe(false)
    })
    expect(result.current.items).toHaveLength(QUEUE_LIMIT)
    expect(persistedTexts('s1')).toHaveLength(QUEUE_LIMIT)

    // Drain every item; the now-empty entry is removed from the persist map.
    for (const queued of [...result.current.items]) {
      act(() => {
        result.current.removeId(queued.id)
      })
    }
    expect(result.current.items).toEqual([])
    expect(queues()['s1'] ?? undefined).toBeUndefined()
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
    expect(queues()['s1'] ?? undefined).toBeUndefined()
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
      result.current.removeId('h1')
    })

    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['second'])
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
    expect(queues()['s1'] ?? undefined).toBeUndefined()
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

    // The retried head succeeds → dequeued; the failure resolves like a normal success.
    await act(async () => {
      resolveRetry(true)
    })
    expect(onDrain).toHaveBeenCalledTimes(2)
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['second'])
  })

  it('persisting one conversation does not clobber another conversation\u2019s entry', () => {
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
})
