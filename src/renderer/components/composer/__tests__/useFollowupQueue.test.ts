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

    act(() => void result.current.enqueue(draft('a'), payload('a')))
    act(() => void result.current.enqueue(draft('b'), payload('b')))

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

    act(() => void result.current.enqueue(draft('a'), payload('a')))
    act(() => void result.current.enqueue(draft('b'), payload('b')))
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

describe('editing a queued item from the composer', () => {
  beforeEach(() => MockCacheUtils.resetMocks())

  const seededQueue = (...items: ReturnType<typeof item>[]) => {
    cacheService.setCasual('followup-queue.s1', items)
    return renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', status: undefined, lastCompletedAt: null, onDrain: vi.fn() })
    ).result
  }
  const composer = (text: string, overrides: Record<string, unknown> = {}) => ({
    editingMessage: false,
    getDraft: () => draft(text),
    buildPayload: (current: { text: string }) => (current.text ? payload(current.text) : null),
    hasFiles: false,
    restore: vi.fn(),
    ...overrides
  })

  it('swaps the composer draft back into its queue slot, keeping that item chat target', () => {
    const chatTarget = { mode: 'reserved-branch' } as any
    const a = { ...item('a', 'A'), payload: { ...payload('A'), chatTarget } }
    const result = seededQueue(a, item('b', 'B'))

    act(() => result.current.editItem('a', composer('')))
    act(() => result.current.editItem('b', composer('A edited')))

    expect(result.current.items.map((entry) => entry.id)).toEqual(['a'])
    expect(result.current.items[0].draft.text).toBe('A edited')
    expect(result.current.items[0].payload).toEqual({ ...payload('A edited'), chatTarget })
  })

  it('puts the original item back when the composer draft was emptied', () => {
    const a = item('a', 'A')
    const result = seededQueue(a, item('b', 'B'))

    act(() => result.current.editItem('a', composer('')))
    act(() => result.current.editItem('b', composer('')))

    expect(result.current.items).toEqual([a])
  })

  it('refuses the switch when a non-empty composer draft cannot become a payload', () => {
    const result = seededQueue(item('a', 'A'), item('b', 'B'))
    const refused = composer('unsendable', { buildPayload: () => null })

    act(() => result.current.editItem('a', composer('')))
    act(() => result.current.editItem('b', refused))

    expect(refused.restore).not.toHaveBeenCalled()
    expect(result.current.items.map((entry) => entry.id)).toEqual(['b'])
  })

  it('refuses the switch when an attachment-only composer draft cannot become a payload', () => {
    const result = seededQueue(item('a', 'A'), item('b', 'B'))
    const refused = composer('', { hasFiles: true })

    act(() => result.current.editItem('a', composer('')))
    act(() => result.current.editItem('b', refused))

    expect(refused.restore).not.toHaveBeenCalled()
    expect(result.current.items.map((entry) => entry.id)).toEqual(['b'])
  })

  it('consumes the item without swapping anything back while a message is being edited', () => {
    const b = item('b', 'B')
    const result = seededQueue(item('a', 'A'), b, item('c', 'C'))
    const editingMessage = composer('message under edit', { editingMessage: true })

    act(() => result.current.editItem('a', composer('')))
    act(() => result.current.editItem('b', editingMessage))

    expect(editingMessage.restore).toHaveBeenCalledWith(b)
    expect(result.current.items.map((entry) => entry.id)).toEqual(['c'])

    act(() => result.current.editItem('c', composer('next draft')))

    expect(result.current.items, 'the draft taken before the message edit must not come back').toEqual([])
  })

  it('ignores an item that is no longer queued while a message is being edited', () => {
    const result = seededQueue(item('a', 'A'))
    const editingMessage = composer('', { editingMessage: true })

    act(() => result.current.editItem('missing', editingMessage))

    expect(editingMessage.restore).not.toHaveBeenCalled()
    expect(result.current.items.map((entry) => entry.id)).toEqual(['a'])
  })
})

describe('feature recovery on the current completion contract', () => {
  beforeEach(() => MockCacheUtils.resetMocks())
  it.each(['false', 'reject', 'success'] as const)(
    'settles a removed manual steer (%s) and releases deferred completion',
    async (outcome) => {
      cacheService.setCasual('followup-queue.s1', [item('h1', 'first'), item('h2', 'second')])
      let finish!: (sent: boolean) => void
      let fail!: (error: Error) => void
      const onDrain = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve, reject) => {
              finish = resolve
              fail = reject
            })
        )
        .mockResolvedValue(true)
      const { result, rerender } = renderHook(
        ({ done }) =>
          useFollowupQueue({
            scopeKey: 's1',
            status: done ? 'done' : 'streaming',
            lastCompletedAt: done ? 100 : null,
            onDrain
          }),
        { initialProps: { done: false } }
      )
      act(() => {
        void result.current.sendId('h2')
      })
      act(() => result.current.removeId('h2'))
      act(() => rerender({ done: true }))
      expect(onDrain).toHaveBeenCalledTimes(1)
      await act(async () => {
        if (outcome === 'reject') fail(new Error('not accepted'))
        else finish(outcome === 'success')
      })
      // A steer dispatched before completion does not own that later completion.
      expect(onDrain.mock.calls.map(([p]) => p.text)).toEqual(['second', 'first'])
      expect(result.current.items).toEqual([])
      expect(result.current.failedItemId).toBeNull()
      expect(result.current.paused).toBe(false)
    }
  )

  it.each(['remount', 'scope-switch'] as const)('reconciles removed failed steer after %s', async (mode) => {
    cacheService.setCasual('followup-queue.s1', [item('h1', 'first'), item('h2', 'second')])
    let finish!: (sent: boolean) => void
    const onDrain = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue(true)
    const mount = () =>
      renderHook(
        ({ scopeKey, done }) =>
          useFollowupQueue({
            scopeKey,
            status: done ? 'done' : 'streaming',
            lastCompletedAt: done ? 100 : null,
            onDrain
          }),
        { initialProps: { scopeKey: 's1', done: false } }
      )
    const old = mount()
    act(() => {
      void old.result.current.sendId('h2')
    })
    act(() => old.result.current.removeId('h2'))
    if (mode === 'remount') old.unmount()
    else act(() => old.rerender({ scopeKey: 's2', done: false }))
    const current = mode === 'remount' ? mount() : old
    act(() => current.rerender({ scopeKey: 's1', done: true }))
    await act(async () => finish(false))
    expect(onDrain.mock.calls.map(([p]) => p.text)).toEqual(['second', 'first'])
    expect(current.result.current.items).toEqual([])
    expect(current.result.current.failedItemId).toBeNull()
  })

  it('retries a failed draft, then waits for the next completion before draining another', async () => {
    cacheService.setCasual('followup-queue.s1', [item('h1', 'first'), item('h2', 'second')])
    const onDrain = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const { result, rerender } = renderHook(
      ({ time }) => useFollowupQueue({ scopeKey: 's1', status: 'done', lastCompletedAt: time, onDrain }),
      { initialProps: { time: 100 } }
    )
    await act(async () => {})
    expect(result.current.failedItemId).toBe('h1')
    expect(result.current.paused).toBe(true)
    await act(async () => result.current.retryFailed())
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
    expect(result.current.items.map((i) => i.id)).toEqual(['h2'])
    expect(onDrain).toHaveBeenCalledTimes(2)
    await act(async () => rerender({ time: 200 }))
    expect(onDrain).toHaveBeenCalledTimes(3)
  })

  it('Skip continues explicitly and Abort drops remaining failed drafts', async () => {
    cacheService.setCasual('followup-queue.s1', [item('h1', 'first'), item('h2', 'second')])
    const onDrain = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', status: 'done', lastCompletedAt: 100, onDrain })
    )
    await act(async () => {})
    await act(async () => result.current.skipFailed())
    expect(onDrain.mock.calls.map(([p]) => p.text)).toEqual(['first', 'second'])
    expect(result.current.failedItemId).toBe('h2')
    act(() => result.current.clear())
    expect(result.current.items).toEqual([])
    expect(result.current.failedItemId).toBeNull()
    expect(result.current.paused).toBe(false)
  })

  it('rejects overflow without losing the draft and filters malformed cache rows', () => {
    cacheService.setCasual('followup-queue.s1', [item('good', 'ok'), { id: 'bad', draft: null, payload: payload('x') }])
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', status: undefined, lastCompletedAt: null, onDrain: vi.fn() })
    )
    expect(result.current.items.map((i) => i.id)).toEqual(['good'])
    act(() => {
      for (let i = 1; i < 20; i++) expect(result.current.enqueue(draft(String(i)), payload(String(i)))).toBe('ok')
      expect(result.current.enqueue(draft('rejected'), payload('rejected'))).toBe('full')
    })
    expect(result.current.items).toHaveLength(20)
    const stale = result.current.items
    act(() => cacheService.setCasual('followup-queue.s1', []))
    act(() => result.current.reorder(stale))
    expect(result.current.items).toEqual([])
  })
})

describe('failed admission dismissal and retry pause ownership', () => {
  beforeEach(() => MockCacheUtils.resetMocks())
  it.each(['remove', 'edit', 'message-edit'] as const)(
    'does not auto-send the next draft after %s of a failed head',
    async (mode) => {
      cacheService.setCasual('followup-queue.s1', [item('a', 'first'), item('b', 'second')])
      const onDrain = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
      const { result, rerender } = renderHook(
        ({ time }) => useFollowupQueue({ scopeKey: 's1', status: 'done', lastCompletedAt: time, onDrain }),
        { initialProps: { time: 100 } }
      )
      await act(async () => {})
      expect(result.current.failedItemId).toBe('a')
      await act(async () => {
        if (mode === 'remove') result.current.removeId('a')
        else
          result.current.editItem('a', {
            editingMessage: mode === 'message-edit',
            getDraft: () => draft(''),
            buildPayload: () => null,
            hasFiles: false,
            restore: vi.fn()
          })
      })
      expect(onDrain.mock.calls.map(([p]) => p.text)).toEqual(['first'])
      expect(result.current.items.map((i) => i.id)).toEqual(['b'])
      expect(result.current.failedItemId).toBeNull()
      await act(async () => rerender({ time: 200 }))
      expect(onDrain.mock.calls.map(([p]) => p.text)).toEqual(['first', 'second'])
    }
  )
  it.each(['pause', 'clear-and-pause'] as const)('retains a newer user %s when an old Retry succeeds', async (mode) => {
    cacheService.setCasual('followup-queue.s1', [item('a', 'first')])
    let finish!: (sent: boolean) => void
    const onDrain = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue(true)
    const { result, rerender } = renderHook(
      ({ time }) => useFollowupQueue({ scopeKey: 's1', status: 'done', lastCompletedAt: time, onDrain }),
      { initialProps: { time: 100 } }
    )
    await act(async () => {})
    act(() => result.current.retryFailed())
    act(() => {
      if (mode === 'clear-and-pause') result.current.clear()
      result.current.enqueue(draft('new'), payload('new'))
      result.current.setPaused(true)
    })
    await act(async () => finish(true))
    expect(result.current.paused).toBe(true)
    await act(async () => rerender({ time: 200 }))
    expect(onDrain.mock.calls.map(([p]) => p.text)).toEqual(['first', 'first'])
    expect(result.current.items.map((i) => i.payload.text)).toEqual(['new'])
  })
})

describe('retry admission recovery boundaries', () => {
  beforeEach(() => MockCacheUtils.resetMocks())
  it.each(['false', 'reject'] as const)('reinstates failure controls when Retry returns %s', async (outcome) => {
    cacheService.setCasual('followup-queue.s1', [item('a', 'first'), item('b', 'second')])
    const onDrain = vi.fn().mockResolvedValueOnce(false)
    if (outcome === 'reject') onDrain.mockRejectedValueOnce(new Error('retry failed'))
    else onDrain.mockResolvedValueOnce(false)
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 's1', status: 'done', lastCompletedAt: 100, onDrain })
    )
    await act(async () => {})
    await act(async () => result.current.retryFailed())
    expect(result.current.failedItemId).toBe('a')
    expect(result.current.paused).toBe(true)
    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(onDrain).toHaveBeenCalledTimes(2)
  })
  it('persists a dismissed completion across remount without blocking the next completion', async () => {
    cacheService.setCasual('followup-queue.s1', [item('a', 'first'), item('b', 'second')])
    const onDrain = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const mount = () =>
      renderHook(({ time }) => useFollowupQueue({ scopeKey: 's1', status: 'done', lastCompletedAt: time, onDrain }), {
        initialProps: { time: 100 }
      })
    const first = mount()
    await act(async () => {})
    act(() => first.result.current.removeId('a'))
    first.unmount()
    const next = mount()
    await act(async () => {})
    expect(onDrain).toHaveBeenCalledTimes(1)
    await act(async () => next.rerender({ time: 200 }))
    expect(onDrain).toHaveBeenCalledTimes(2)
  })
})

describe('Blob-backed followup attachments', () => {
  beforeEach(() => MockCacheUtils.resetMocks())

  it.each([true, false])('keeps generated-image bytes through queueing and drain acceptance=%s', async (accepted) => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    const queued = {
      ...payload('follow up'),
      attachments: [
        {
          blob,
          name: 'generated',
          origin_name: 'generated.png',
          ext: '.png',
          type: 'image',
          size: blob.size,
          fileTokenSourceId: 'generated-1'
        }
      ]
    }
    const onDrain = vi.fn().mockResolvedValue(accepted)
    const onDrainFailed = vi.fn()
    const { result, rerender } = renderHook(
      ({ done }) =>
        useFollowupQueue({
          scopeKey: 'blob',
          status: done ? 'done' : 'streaming',
          lastCompletedAt: done ? 100 : null,
          onDrain,
          onDrainFailed
        }),
      { initialProps: { done: false } }
    )
    act(() => {
      expect(result.current.enqueue(draft('follow up'), queued)).toBe('ok')
    })
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].payload.attachments?.[0].blob).toBe(blob)
    expect(onDrain).not.toHaveBeenCalled()
    await act(async () => {
      rerender({ done: true })
    })
    expect(onDrain).toHaveBeenCalledExactlyOnceWith(queued)
    if (accepted) {
      expect(result.current.items).toEqual([])
      expect(onDrainFailed).not.toHaveBeenCalled()
    } else {
      expect(result.current.items).toHaveLength(1)
      expect(result.current.items[0].payload.attachments?.[0].blob).toBe(blob)
      expect(result.current.paused).toBe(true)
      expect(onDrainFailed).toHaveBeenCalledOnce()
    }
  })

  it('rejects pathless attachment objects that only imitate a Blob', () => {
    const invalid = {
      ...item('invalid', 'bad'),
      payload: { ...payload('bad'), attachments: [{ blob: { size: 3, type: 'image/png' } }] }
    }
    cacheService.setCasual('followup-queue.blob', [invalid])
    const { result } = renderHook(() =>
      useFollowupQueue({ scopeKey: 'blob', status: 'streaming', lastCompletedAt: null, onDrain: vi.fn() })
    )
    expect(result.current.items).toEqual([])
  })
})
