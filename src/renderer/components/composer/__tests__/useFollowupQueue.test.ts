import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

const { useFollowupQueue } = await import('../useFollowupQueue')

const draft = (text: string) => ({ text, tokens: [] }) as any
const payload = (text: string) => ({ text, userMessageParts: [{ type: 'text', text }] }) as any
const item = (id: string, text: string) => ({ id, draft: draft(text), payload: payload(text) })

const persistedTexts = (key: string) =>
  (cacheService.getCasual(key) as Array<{ draft: { text: string } }>).map((i) => i.draft.text)

describe('useFollowupQueue', () => {
  beforeEach(() => MockCacheUtils.resetMocks())

  it('restores the complete original item and its position when another edit replaces it', () => {
    const first = item('a', 'A')
    first.draft.tokens = [{ id: 'quote-1', kind: 'quote', label: 'Quote', index: 0, textOffset: 0 }]
    first.payload = { ...first.payload, reasoningEffort: 'high', fastMode: true, attachments: [{ name: 'file.txt' }] }
    const second = item('b', 'B')
    cacheService.setCasual('followup-queue.s1', [item('head', 'head'), first, second, item('tail', 'tail')])
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )

    act(() => {
      expect(result.current.takeForEdit('a')).toEqual(first)
      result.current.removeId('head')
      expect(result.current.takeForEdit('b')).toEqual(second)
    })

    expect(result.current.items).toEqual([first, item('tail', 'tail')])
    expect(persistedTexts('followup-queue.s1')).toEqual(['A', 'tail'])
    act(() => expect(result.current.takeForEdit('missing')).toBeUndefined())
    void act(() => result.current.takeForEdit('tail'))
    expect(result.current.items).toEqual([first, second])
  })

  it.each(['enqueue', 'send'] as const)('does not resurrect a submitted edit after %s', (submission) => {
    cacheService.setCasual('followup-queue.s1', [item('a', 'A'), item('b', 'B')])
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    )
    void act(() => result.current.takeForEdit('a'))
    act(() => {
      if (submission === 'enqueue') result.current.enqueue(draft('A edited'), payload('A edited'))
      else result.current.completeEdit()
      result.current.takeForEdit('b')
    })
    expect(persistedTexts('followup-queue.s1')).toEqual(submission === 'enqueue' ? ['A edited'] : [])
  })

  it('keeps editing snapshots scoped to the conversation across remounts', () => {
    cacheService.setCasual('followup-queue.s1', [item('a', 'A'), item('b', 'B')])
    cacheService.setCasual('followup-queue.s2', [item('x', 'X'), item('y', 'Y')])
    const useQueue = ({ scopeKey }: { scopeKey: string }) =>
      useFollowupQueue({ scopeKey, isFulfilled: false, markSeen: vi.fn(), onDrain: vi.fn() })
    const first = renderHook(useQueue, { initialProps: { scopeKey: 's1' } })
    void act(() => first.result.current.takeForEdit('a'))
    first.rerender({ scopeKey: 's2' })
    void act(() => first.result.current.takeForEdit('x'))
    expect(first.result.current.items.map((entry) => entry.draft.text)).toEqual(['Y'])
    first.unmount()

    const second = renderHook(useQueue, { initialProps: { scopeKey: 's1' } })
    void act(() => second.result.current.takeForEdit('b'))
    expect(second.result.current.items.map((entry) => entry.draft.text)).toEqual(['A'])
    second.rerender({ scopeKey: 's2' })
    void act(() => second.result.current.takeForEdit('y'))
    expect(second.result.current.items.map((entry) => entry.draft.text)).toEqual(['X'])
  })

  it('drains queued messages without sending the draft currently being edited', async () => {
    const editing = item('a', 'A')
    const next = item('b', 'B')
    cacheService.setCasual('followup-queue.s1', [editing, next, item('c', 'C')])
    const onDrain = vi.fn().mockResolvedValue(true)
    const markSeen = vi.fn()
    const { result, rerender } = renderHook(
      ({ isFulfilled }) => useFollowupQueue({ scopeKey: 's1', isFulfilled, markSeen, onDrain }),
      { initialProps: { isFulfilled: false } }
    )
    void act(() => result.current.takeForEdit('a'))
    await act(async () => rerender({ isFulfilled: true }))
    expect(onDrain).toHaveBeenCalledExactlyOnceWith(next.payload)
    void act(() => result.current.takeForEdit('c'))
    expect(result.current.items).toEqual([editing])
  })

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
    cacheService.setCasual('followup-queue.s2', [item('x', 'queued')])
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
    cacheService.setCasual('followup-queue.s1', [{ id: 'h', draft: draft('head'), payload: headPayload }])

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
    cacheService.setCasual('followup-queue.s1', [head])

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
    cacheService.setCasual('followup-queue.s1', [head])

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
    cacheService.setCasual('followup-queue.s1', [item('h', 'head')])

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

  it('keeps each conversation paused until the user resumes it', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    cacheService.setCasual('followup-queue.s1', [item('h', 'head')])

    const { result, rerender } = renderHook(
      ({ scopeKey, isFulfilled }) => useFollowupQueue({ scopeKey, isFulfilled, markSeen: vi.fn(), onDrain }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )

    act(() => result.current.setPaused(true))
    act(() => rerender({ scopeKey: 's2', isFulfilled: false }))
    expect(result.current.paused).toBe(false)
    await act(async () => rerender({ scopeKey: 's1', isFulfilled: true }))

    expect(result.current.paused).toBe(true)
    expect(onDrain).not.toHaveBeenCalled()
    expect(result.current.items).toHaveLength(1)
  })
})
