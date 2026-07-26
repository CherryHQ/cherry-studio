import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()
vi.mock('@data/CacheService', () => ({
  cacheService: {
    getCasual: vi.fn((key: string) => store.get(key)),
    setCasual: vi.fn((key: string, value: unknown) => {
      store.set(key, value)
    })
  }
}))

const { useFollowupQueue } = await import('../useFollowupQueue')

const draft = (text: string) => ({ text, tokens: [] }) as any
const payload = (text: string) => ({ text, userMessageParts: [{ type: 'text', text }] }) as any
const item = (id: string, text: string) => ({ id, draft: draft(text), payload: payload(text) })

const persistedTexts = (key: string) => (store.get(key) as Array<{ draft: { text: string } }>).map((i) => i.draft.text)

describe('useFollowupQueue', () => {
  beforeEach(() => store.clear())

  it('enqueues (storing draft + payload, persisting) and removeId dequeues', () => {
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )

    act(() => result.current.enqueue(draft('a'), payload('a')))
    act(() => result.current.enqueue(draft('b'), payload('b')))

    expect(result.current.items.map((i) => i.draft.text)).toEqual(['a', 'b'])
    expect(result.current.items.map((i) => i.payload.text)).toEqual(['a', 'b'])
    expect(persistedTexts('followup-queue.s1')).toEqual(['a', 'b'])

    act(() => result.current.removeId(result.current.items[0].id))
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['b'])
  })

  it('reorders the queue and persists the new order', () => {
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )

    act(() => result.current.enqueue(draft('a'), payload('a')))
    act(() => result.current.enqueue(draft('b'), payload('b')))
    const [first, second] = result.current.items

    act(() => result.current.reorder([second, first]))

    expect(result.current.items.map((i) => i.draft.text)).toEqual(['b', 'a'])
    expect(persistedTexts('followup-queue.s1')).toEqual(['b', 'a'])
  })

  it('reloads the queue from the cache when the scopeKey changes', () => {
    store.set('followup-queue.s2', [item('x', 'queued')])
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useFollowupQueue({ scopeKey, isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() }),
      { initialProps: { scopeKey: 's1' } }
    )

    expect(result.current.items).toEqual([])
    rerender({ scopeKey: 's2' })
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['queued'])
  })

  it('drains the head on the live→idle edge, then dequeues on success', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    const markSeen = vi.fn()
    const headPayload = payload('head')
    store.set('followup-queue.s1', [{ id: 'h', draft: draft('head'), payload: headPayload }])

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

  it('keeps the head queued and reports failure when auto-drain fails', async () => {
    const onDrain = vi.fn().mockResolvedValue(false)
    const onDrainFailed = vi.fn()
    const markSeen = vi.fn()
    const head = item('h', 'head')
    store.set('followup-queue.s1', [head])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain, onDrainFailed }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(markSeen).toHaveBeenCalled()
    expect(onDrain).toHaveBeenCalledWith(head.payload)
    expect(onDrainFailed).toHaveBeenCalledOnce()
    expect(result.current.items).toEqual([head])
  })

  it('keeps the head queued and reports failure when auto-drain rejects', async () => {
    const onDrain = vi.fn().mockRejectedValue(new Error('drain blew up'))
    const onDrainFailed = vi.fn()
    const markSeen = vi.fn()
    const head = item('h', 'head')
    store.set('followup-queue.s1', [head])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain, onDrainFailed }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(onDrain).toHaveBeenCalledWith(head.payload)
    expect(onDrainFailed).toHaveBeenCalledOnce()
    expect(result.current.items).toEqual([head])
  })

  it('does not drain while paused', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    store.set('followup-queue.s1', [item('h', 'head')])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    act(() => result.current.setPaused(true))
    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(onDrain).not.toHaveBeenCalled()
    expect(result.current.items).toHaveLength(1)
  })
})
