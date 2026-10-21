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

  it('enqueues (storing draft + payload, persisting) and removeId dequeues', () => {
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', status: undefined, lastCompletedAt: null, onDrain: vi.fn() })
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
      useFollowupQueue({ scopeKey: 's1', status: undefined, lastCompletedAt: null, onDrain: vi.fn() })
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
      ({ scopeKey }) => useFollowupQueue({ scopeKey, status: undefined, lastCompletedAt: null, onDrain: vi.fn() }),
      { initialProps: { scopeKey: 's1' } }
    )

    expect(result.current.items).toEqual([])
    rerender({ scopeKey: 's2' })
    expect(result.current.items.map((i) => i.draft.text)).toEqual(['queued'])
  })

  it('drains the head on the live→idle edge, then dequeues on success', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    const headPayload = payload('head')
    cacheService.setCasual('followup-queue.s1', [{ id: 'h', draft: draft('head'), payload: headPayload }])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) =>
        useFollowupQueue({ scopeKey: 's1', status: isFulfilled ? 'done' : 'streaming', lastCompletedAt: 100, onDrain }),
      { initialProps: { isFulfilled: false } }
    )

    expect(onDrain).not.toHaveBeenCalled()

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(onDrain).toHaveBeenCalledWith(headPayload)
    expect(result.current.items).toEqual([])
  })

  it('keeps the head queued and reports failure when auto-drain fails', async () => {
    const onDrain = vi.fn().mockResolvedValue(false)
    const onDrainFailed = vi.fn()
    const head = item('h', 'head')
    cacheService.setCasual('followup-queue.s1', [head])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) =>
        useFollowupQueue({
          scopeKey: 's1',
          status: isFulfilled ? 'done' : 'streaming',
          lastCompletedAt: 100,
          onDrain,
          onDrainFailed
        }),
      { initialProps: { isFulfilled: false } }
    )

    await act(async () => {
      rerender({ isFulfilled: true })
    })

    expect(onDrain).toHaveBeenCalledWith(head.payload)
    expect(onDrainFailed).toHaveBeenCalledOnce()
    expect(result.current.items).toEqual([head])
  })

  it('keeps the head queued and reports failure when auto-drain rejects', async () => {
    const onDrain = vi.fn().mockRejectedValue(new Error('drain blew up'))
    const onDrainFailed = vi.fn()
    const head = item('h', 'head')
    cacheService.setCasual('followup-queue.s1', [head])

    const { result, rerender } = renderHook(
      ({ isFulfilled }) =>
        useFollowupQueue({
          scopeKey: 's1',
          status: isFulfilled ? 'done' : 'streaming',
          lastCompletedAt: 100,
          onDrain,
          onDrainFailed
        }),
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
      ({ isFulfilled }) =>
        useFollowupQueue({ scopeKey: 's1', status: isFulfilled ? 'done' : 'streaming', lastCompletedAt: 100, onDrain }),
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
      ({ scopeKey, isFulfilled }) =>
        useFollowupQueue({ scopeKey, status: isFulfilled ? 'done' : 'streaming', lastCompletedAt: 100, onDrain }),
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

describe('queued edit switching', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    vi.mocked(cacheService.setCasual).mockClear()
  })

  const setup = (ids = ['A', 'B']) => {
    const entries = ids.map((id) => item(id, id))
    cacheService.setCasual('followup-queue.s1', entries)
    vi.mocked(cacheService.setCasual).mockClear()
    const onDrain = vi.fn().mockResolvedValue(true)
    const onDrainFailed = vi.fn()
    const hook = renderHook(
      ({ scopeKey, isFulfilled }) =>
        useFollowupQueue({
          scopeKey,
          status: isFulfilled ? 'done' : 'streaming',
          lastCompletedAt: 100,
          onDrain,
          onDrainFailed
        }),
      { initialProps: { scopeKey: 's1', isFulfilled: false } }
    )
    return { ...hook, entries, onDrain, onDrainFailed }
  }
  const capture = (taken: ReturnType<typeof item>) => ({ draft: taken.draft, payload: taken.payload })

  it('commits consecutive takes synchronously with one final visible-array write per take and the existing TTL', () => {
    const {
      result,
      entries: [a, b]
    } = setup()
    const outgoing = vi.fn(() => ({ draft: draft('A-prime'), payload: payload('A-prime') }))
    act(() => {
      expect(result.current.takeForEdit(a.id, outgoing), 'first take returns the whole incoming item').toEqual(a)
      expect(result.current.takeForEdit(b.id, outgoing), 'same-act take must see the authoritative queue').toEqual(b)
    })
    expect(result.current.items, 'switch must preserve edited A under its original identity').toEqual([
      { ...a, draft: draft('A-prime'), payload: payload('A-prime') }
    ])
    expect(outgoing.mock.calls.length, 'capture runs exactly once only for the outgoing taken document').toBe(1)
    expect(
      vi.mocked(cacheService.setCasual).mock.calls,
      'each successful transaction persists once with 24h TTL'
    ).toEqual([
      ['followup-queue.s1', [b], 86400000],
      ['followup-queue.s1', result.current.items, 86400000]
    ])
  })

  it('refuses missing, taken and invalid outgoing drafts without mutations or capture of invalid ids', () => {
    const {
      result,
      entries: [a, b]
    } = setup()
    const outgoing = vi.fn(() => null)
    act(() => {
      expect(result.current.takeForEdit('missing', outgoing), 'unknown ids must refuse').toBeNull()
      result.current.takeForEdit(a.id, outgoing)
      expect(result.current.takeForEdit(a.id, outgoing), 'already-taken ids must refuse').toBeNull()
    })
    expect(outgoing.mock.calls.length, 'invalid ids must not capture').toBe(0)
    const writes = vi.mocked(cacheService.setCasual).mock.calls.length
    act(() => {
      expect(result.current.takeForEdit(b.id, outgoing), 'invalid outgoing document must refuse').toBeNull()
    })
    expect(result.current.items, 'refusal must retain B').toEqual([b])
    expect(cacheService.getCasual('followup-queue.s1'), 'refusal must retain persisted B').toEqual([b])
    expect(vi.mocked(cacheService.setCasual).mock.calls.length, 'refusal must not write cache').toBe(writes)
    act(() => {
      result.current.takeForEdit(b.id, capture)
    })
    expect(result.current.items, 'refusal must retain ownership of A for a later valid switch').toEqual([a])
  })

  it.each(['remove', 'drain'])('adjusts the absent slot after a preceding %s, once only', async (mode) => {
    const {
      result,
      rerender,
      entries: [x, a, b, c]
    } = setup(['X', 'A', 'B', 'C'])
    act(() => {
      result.current.takeForEdit(a.id, capture)
    })
    if (mode === 'remove')
      act(() => {
        result.current.removeId(x.id)
      })
    else
      await act(async () => {
        rerender({ scopeKey: 's1', isFulfilled: true })
      })
    act(() => {
      result.current.removeId(x.id)
      result.current.takeForEdit(b.id, capture)
    })
    expect(result.current.items, 'removing or draining X must return A before C without double decrement').toEqual([
      a,
      c
    ])
  })

  it('keeps explicit visible reorder and the absent numerical slot, clamping only upon insertion', () => {
    const {
      result,
      entries: [x, a, b, c]
    } = setup(['X', 'A', 'B', 'C'])
    act(() => {
      result.current.takeForEdit(b.id, capture)
      result.current.reorder([c, a, x])
      result.current.takeForEdit(c.id, capture)
    })
    expect(result.current.items, 'reorder must keep the supplied order across the absent slot').toEqual([a, b, x])
    act(() => {
      result.current.takeForEdit(b.id, capture)
      result.current.reorder([x])
      result.current.takeForEdit(x.id, capture)
    })
    expect(result.current.items, 'an absent slot beyond the new queue length must clamp safely').toEqual([b])
  })

  it.each(['release', 'matching removal'])('ends a taken record through %s even when its id is absent', (mode) => {
    const {
      result,
      entries: [a, b]
    } = setup()
    act(() => {
      result.current.takeForEdit(a.id, capture)
    })
    const writes = vi.mocked(cacheService.setCasual).mock.calls.length
    act(() => {
      if (mode === 'release') {
        result.current.releaseEdit()
        result.current.releaseEdit()
      } else {
        result.current.removeId(a.id)
        result.current.removeId(a.id)
      }
    })
    expect(result.current.items, 'ending ownership must leave the visible queue untouched').toEqual([b])
    expect(vi.mocked(cacheService.setCasual).mock.calls.length, 'ending absent ownership must not persist').toBe(writes)
    const outgoing = vi.fn(capture)
    act(() => {
      result.current.takeForEdit(b.id, outgoing)
    })
    expect(result.current.items, 'ended ownership must never resurrect A').toEqual([])
    expect(outgoing.mock.calls.length, 'ended ownership must not capture an unrelated editor').toBe(0)
  })

  it('keeps a manually sending draft unavailable to edit until settlement', async () => {
    const {
      result,
      onDrain,
      entries: [a, b]
    } = setup()
    let finish!: (sent: boolean) => void
    onDrain.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)))
    act(() => {
      void result.current.sendId(a.id)
      expect(result.current.takeForEdit(a.id, capture), 'pending send must refuse Edit').toBeNull()
      expect(result.current.takeForEdit(b.id, capture), 'another draft remains editable').toEqual(b)
    })
    await act(async () => {
      expect(await result.current.sendId(a.id), 'duplicate send must refuse').toBe(false)
      finish(false)
    })
    act(() => {
      expect(result.current.takeForEdit(a.id, capture), 'failed draft is editable again').toEqual(a)
    })
    expect(result.current.items, 'switching edits preserves the outgoing draft').toEqual([b])
  })

  it.each(['success', 'false', 'reject'])(
    'holds drain admission until %s and preserves one head per completion',
    async (outcome) => {
      const {
        result,
        rerender,
        entries: [a, b],
        onDrain,
        onDrainFailed
      } = setup()
      let resolve!: (sent: boolean) => void
      let reject!: (error: Error) => void
      onDrain.mockImplementationOnce(
        () =>
          new Promise<boolean>((done, fail) => {
            resolve = done
            reject = fail
          })
      )
      act(() => {
        rerender({ scopeKey: 's1', isFulfilled: true })
      })
      act(() => {
        expect(result.current.takeForEdit(a.id, capture), 'draining head must refuse editing').toBeNull()
      })
      await act(async () => {
        if (outcome === 'reject') reject(new Error('rejected'))
        else resolve(outcome === 'success')
      })
      expect(result.current.items, 'only successful admission removes the head').toEqual(
        outcome === 'success' ? [b] : [a, b]
      )
      expect(onDrain.mock.calls, 'queue mutations must not dispatch a second head on the same completion').toEqual([
        [a.payload]
      ])
      expect(onDrainFailed.mock.calls.length, 'failed acceptance must keep existing failure reporting').toBe(
        outcome === 'success' ? 0 : 1
      )
      if (outcome !== 'success') {
        act(() => {
          expect(result.current.takeForEdit(a.id, capture), 'failure must release admission for retry/edit').toEqual(a)
        })
      }
    }
  )

  it('discards taken metadata on scope change and settles success in the originating scope', async () => {
    const {
      result,
      rerender,
      entries: [a, b],
      onDrain
    } = setup()
    const c = item('C', 'C'),
      d = item('D', 'D')
    cacheService.setCasual('followup-queue.s2', [c, d])
    let resolve!: (sent: boolean) => void
    onDrain.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done
        })
    )
    act(() => {
      result.current.takeForEdit(b.id, capture)
      rerender({ scopeKey: 's1', isFulfilled: true })
    })
    act(() => {
      rerender({ scopeKey: 's2', isFulfilled: false })
    })
    act(() => {
      result.current.takeForEdit(c.id, capture)
    })
    await act(async () => {
      resolve(true)
    })
    act(() => {
      result.current.takeForEdit(d.id, capture)
    })
    expect(result.current.items, 'old success must not clear the new scope taken record').toEqual([c])
    expect(cacheService.getCasual('followup-queue.s1'), 'accepted send must leave no delivered source item').toEqual([])
    act(() => {
      rerender({ scopeKey: 's1', isFulfilled: false })
    })
    act(() => {
      expect(result.current.takeForEdit(a.id, capture), 'delivered source item must remain removed').toBeNull()
    })
    expect(result.current.items, 'scope reload must not reinsert old taken B').toEqual([])
  })
})
