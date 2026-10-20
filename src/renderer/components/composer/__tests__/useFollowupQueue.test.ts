import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import { createElement, StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'
import type { TopicStreamStatus } from '@shared/ai/transport'

const store = {
  get: (key: string) => cacheService.getCasual(key),
  set: (key: string, value: unknown) => cacheService.setCasual(key, value),
  clear: () => MockCacheUtils.resetMocks()
}

const { useFollowupQueue } = await import('../useFollowupQueue')

const draft = (text: string) => ({ text, tokens: [] }) as any
const payload = (text: string) => ({ text, userMessageParts: [{ type: 'text', text }] }) as any
const item = (id: string, text: string) => ({ id, draft: draft(text), payload: payload(text) })

const persistedTexts = (key: string) => (store.get(key) as Array<{ draft: { text: string } }>).map((i) => i.draft.text)

describe('useFollowupQueue', () => {
  beforeEach(() => store.clear())

  it('enqueues (storing draft + payload, persisting) and removeId dequeues', () => {
    const { result } = renderHook(() =>
      useFollowupQueue({
        scopeKey: 's1',
        status: 'streaming',
        turnId: 'turn-1',
        autoSendEnabled: true,
        markSeen: vi.fn(),
        onDrain: vi.fn()
      })
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
      useFollowupQueue({
        scopeKey: 's1',
        status: 'streaming',
        turnId: 'turn-1',
        autoSendEnabled: true,
        markSeen: vi.fn(),
        onDrain: vi.fn()
      })
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
      ({ scopeKey }) =>
        useFollowupQueue({
          scopeKey,
          status: 'streaming',
          turnId: 'turn-1',
          autoSendEnabled: true,
          markSeen: vi.fn(),
          onDrain: vi.fn()
        }),
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
      ({ status, turnId, autoSendEnabled }) =>
        useFollowupQueue({ scopeKey: 's1', status, turnId, autoSendEnabled, markSeen, onDrain }),
      { initialProps: { status: 'streaming' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true } }
    )

    expect(onDrain).not.toHaveBeenCalled()

    await act(async () => {
      rerender({ status: 'done' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
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
      ({ status, turnId, autoSendEnabled }) =>
        useFollowupQueue({ scopeKey: 's1', status, turnId, autoSendEnabled, markSeen, onDrain, onDrainFailed }),
      { initialProps: { status: 'streaming' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true } }
    )

    await act(async () => {
      rerender({ status: 'done' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
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
      ({ status, turnId, autoSendEnabled }) =>
        useFollowupQueue({ scopeKey: 's1', status, turnId, autoSendEnabled, markSeen, onDrain, onDrainFailed }),
      { initialProps: { status: 'streaming' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true } }
    )

    await act(async () => {
      rerender({ status: 'done' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
    })

    expect(onDrain).toHaveBeenCalledWith(head.payload)
    expect(onDrainFailed).toHaveBeenCalledOnce()
    expect(result.current.items).toEqual([head])
  })

  it('does not drain while paused', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    store.set('followup-queue.s1', [item('h', 'head')])

    const { result, rerender } = renderHook(
      ({ status, turnId, autoSendEnabled }) =>
        useFollowupQueue({ scopeKey: 's1', status, turnId, autoSendEnabled, markSeen: vi.fn(), onDrain }),
      { initialProps: { status: 'streaming' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true } }
    )

    act(() => result.current.setPaused(true))
    await act(async () => {
      rerender({ status: 'done' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
    })

    expect(onDrain).not.toHaveBeenCalled()
    expect(result.current.items).toHaveLength(1)
  })

  it('keeps each conversation paused until the user resumes it', async () => {
    const onDrain = vi.fn().mockResolvedValue(true)
    store.set('followup-queue.s1', [item('h', 'head')])

    const { result, rerender } = renderHook(
      ({ scopeKey, status, turnId, autoSendEnabled }) =>
        useFollowupQueue({ scopeKey, status, turnId, autoSendEnabled, markSeen: vi.fn(), onDrain }),
      {
        initialProps: {
          scopeKey: 's1',
          status: 'streaming' as TopicStreamStatus,
          turnId: 'turn-1',
          autoSendEnabled: true
        }
      }
    )

    act(() => result.current.setPaused(true))
    act(() =>
      rerender({ scopeKey: 's2', status: 'streaming' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
    )
    expect(result.current.paused).toBe(false)
    await act(async () =>
      rerender({ scopeKey: 's1', status: 'done' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
    )

    expect(result.current.paused).toBe(true)
    expect(onDrain).not.toHaveBeenCalled()
    expect(result.current.items).toHaveLength(1)
  })
})

describe('queued edit switching', () => {
  beforeEach(() => {
    store.clear()
    vi.mocked(cacheService.setCasual).mockClear()
  })

  const setup = (ids = ['A', 'B']) => {
    const entries = ids.map((id) => item(id, id))
    store.set('followup-queue.s1', entries)
    vi.mocked(cacheService.setCasual).mockClear()
    const markSeen = vi.fn()
    const onDrain = vi.fn().mockResolvedValue(true)
    const onDrainFailed = vi.fn()
    const hook = renderHook(
      ({ scopeKey, status, turnId, autoSendEnabled }) =>
        useFollowupQueue({ scopeKey, status, turnId, autoSendEnabled, markSeen, onDrain, onDrainFailed }),
      {
        initialProps: {
          scopeKey: 's1',
          status: 'streaming' as TopicStreamStatus,
          turnId: 'turn-1',
          autoSendEnabled: true
        }
      }
    )
    return { ...hook, entries, markSeen, onDrain, onDrainFailed }
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
    expect(store.get('followup-queue.s1'), 'refusal must retain persisted B').toEqual([b])
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
        rerender({ scopeKey: 's1', status: 'done' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
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

  it('admits each visible id once, refuses taking it and permits another id until idempotent release', () => {
    const {
      result,
      entries: [a, b]
    } = setup()
    let release!: () => void
    act(() => {
      expect(result.current.beginSend('missing'), 'absent ids cannot dispatch').toBeNull()
      release = result.current.beginSend(a.id)!
      expect(result.current.beginSend(a.id), 'duplicate dispatch must refuse').toBeNull()
      expect(result.current.takeForEdit(a.id, capture), 'admitted dispatch must refuse Edit').toBeNull()
    })
    expect(result.current.items, 'admission must not change visible items').toEqual([a, b])
    expect(vi.mocked(cacheService.setCasual).mock.calls.length, 'admission must not persist').toBe(0)
    act(() => {
      result.current.takeForEdit(b.id, capture)
      release()
      release()
      result.current.takeForEdit(a.id, capture)
    })
    expect(result.current.items, 'another id remains editable and released A can open').toEqual([b])
  })

  it('does not let an old admission release cancel a subsequent admission of the same id', () => {
    const { result } = setup()
    const release = result.current.beginSend('A')!
    release()
    const nextRelease = result.current.beginSend('A')!
    release()
    expect(
      result.current.takeForEdit('A', capture),
      'idempotent release must not reopen a newly admitted item'
    ).toBeNull()
    nextRelease()
    act(() => {
      expect(result.current.takeForEdit('A', capture), 'the current admission release must reopen A').toEqual(
        item('A', 'A')
      )
    })
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
        rerender({ scopeKey: 's1', status: 'done' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
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

  it('discards taken metadata and admissions on scope change and ignores old-scope success', async () => {
    const {
      result,
      rerender,
      entries: [a, b],
      onDrain
    } = setup()
    const c = item('C', 'C'),
      d = item('D', 'D')
    store.set('followup-queue.s2', [c, d])
    let resolve!: (sent: boolean) => void
    onDrain.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done
        })
    )
    act(() => {
      result.current.takeForEdit(b.id, capture)
      rerender({ scopeKey: 's1', status: 'done' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
    })
    act(() => {
      rerender({ scopeKey: 's2', status: 'streaming' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
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
    expect(store.get('followup-queue.s1'), 'old success must not mutate the prior scope cache').toEqual([a])
    act(() => {
      rerender({ scopeKey: 's1', status: 'streaming' as TopicStreamStatus, turnId: 'turn-1', autoSendEnabled: true })
    })
    act(() => {
      expect(result.current.takeForEdit(a.id, capture), 'scope reload must discard old admission').toEqual(a)
    })
    expect(result.current.items, 'scope reload must not reinsert old taken B').toEqual([])
  })
})

describe('terminal admission regressions', () => {
  beforeEach(() => store.clear())
  const observation = (status: TopicStreamStatus | undefined, turnId: string | undefined = 'turn-1') => ({
    status,
    turnId: turnId as string | undefined,
    autoSendEnabled: true,
    scopeKey: 's1'
  })
  const setup = (initial = observation('streaming'), strict = false) => {
    store.set('followup-queue.s1', [item('B', 'B'), item('C', 'C')])
    const onDrain = vi.fn().mockResolvedValue(true)
    const markSeen = vi.fn()
    const onDrainFailed = vi.fn()
    const hook = () =>
      renderHook((props) => useFollowupQueue({ ...props, onDrain, markSeen, onDrainFailed }), {
        initialProps: initial,
        wrapper: strict ? ({ children }) => createElement(StrictMode, null, children) : undefined
      })
    return { ...hook(), hook, onDrain, markSeen, onDrainFailed }
  }

  it.each(['done', 'error', 'aborted'] as const)(
    'does not strand the head after %s or dequeue before acceptance',
    async (status) => {
      const { result, rerender, onDrain, markSeen } = setup()
      let accept!: (accepted: boolean) => void
      onDrain.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            accept = resolve
          })
      )
      act(() => {
        rerender(observation(status))
      })
      expect(result.current.items.map((entry) => entry.id)).toEqual(['B', 'C'])
      expect(onDrain.mock.calls).toEqual([[payload('B')]])
      expect(markSeen).toHaveBeenCalledTimes(status === 'done' ? 1 : 0)
      await act(async () => {
        accept(true)
      })
      expect(result.current.items.map((entry) => entry.id)).toEqual(['C'])
    }
  )

  it.each([
    ['done', 'error'],
    ['error', 'done'],
    ['aborted', 'aborted']
  ] as const)(
    'does not double-send the same id across %s to %s, but admits a new id without a live render',
    async (first, second) => {
      const { rerender, onDrain, result } = setup()
      await act(async () => {
        rerender(observation(first))
      })
      await act(async () => {
        rerender(observation(second))
      })
      expect(onDrain.mock.calls).toEqual([[payload('B')]])
      expect(result.current.items.map((entry) => entry.id)).toEqual(['C'])
      await act(async () => {
        rerender(observation(second, 'turn-2'))
      })
      expect(onDrain.mock.calls).toEqual([[payload('B')], [payload('C')]])
      expect(result.current.items).toEqual([])
    }
  )

  it('persists admission through StrictMode replay, remount and a second same-window instance', async () => {
    const { rerender, onDrain, unmount, hook } = setup(observation('error'), true)
    await act(async () => {
      rerender(observation('error'))
    })
    const second = hook()
    await act(async () => {
      second.rerender(observation('error'))
    })
    unmount()
    const remount = hook()
    await act(async () => {
      remount.rerender(observation('error'))
    })
    expect(onDrain.mock.calls).toEqual([[payload('B')]])
    expect(remount.result.current.items.map((entry) => entry.id)).toEqual(['C'])
  })

  it('respects another instance pause without consuming the terminal, then admits it on resume', async () => {
    const { rerender, result, onDrain } = setup()
    store.set('followup-queue-paused.s1', true)
    await act(async () => {
      rerender(observation('error'))
    })
    expect(onDrain).not.toHaveBeenCalled()
    expect(store.get('followup-queue-last-drained-turn.s1')).toBeUndefined()
    act(() => {
      result.current.setPaused(true)
    })
    await act(async () => {
      result.current.setPaused(false)
    })
    expect(onDrain.mock.calls).toEqual([[payload('B')]])
    expect(result.current.items.map((entry) => entry.id)).toEqual(['C'])
  })

  it.each(['false', 'reject', 'throw'] as const)(
    'retains and pauses after %s without retrying on rerender, resume or remount',
    async (outcome) => {
      const { rerender, result, onDrain, onDrainFailed, hook, unmount } = setup()
      if (outcome === 'false') onDrain.mockResolvedValueOnce(false)
      else if (outcome === 'reject') onDrain.mockRejectedValueOnce(new Error('failed'))
      else
        onDrain.mockImplementationOnce(() => {
          throw new Error('sync failure')
        })
      await act(async () => {
        rerender(observation('error'))
      })
      expect(result.current.items.map((entry) => entry.id)).toEqual(['B', 'C'])
      expect(result.current.paused).toBe(true)
      expect(store.get('followup-queue-paused.s1')).toBe(true)
      await act(async () => {
        result.current.setPaused(false)
      })
      rerender(observation('error'))
      unmount()
      const remount = hook()
      await act(async () => {
        remount.rerender(observation('error'))
      })
      expect(onDrain.mock.calls).toEqual([[payload('B')]])
      expect(onDrainFailed).toHaveBeenCalledOnce()
      const release = remount.result.current.beginSend('B')
      expect(release).toBeTypeOf('function')
      release?.()
      act(() => {
        expect(remount.result.current.takeForEdit('B', () => null)?.id).toBe('B')
      })
      expect(remount.result.current.items.map((entry) => entry.id)).toEqual(['C'])
    }
  )

  it('does not consume a terminal when manual admission holds the head', async () => {
    const { result, rerender, onDrain } = setup()
    const release = result.current.beginSend('B')!
    await act(async () => {
      rerender(observation('done'))
    })
    expect(store.get('followup-queue-last-drained-turn.s1')).toBeUndefined()
    expect(onDrain).not.toHaveBeenCalled()
    release()
    await act(async () => {
      rerender(observation('error'))
    })
    expect(onDrain.mock.calls).toEqual([[payload('B')]])
  })

  it('never sends the document taken for editing and drains the next visible head', async () => {
    const { result, rerender, onDrain } = setup()
    act(() => {
      result.current.takeForEdit('B', () => null)
    })
    await act(async () => {
      rerender(observation('aborted'))
    })
    expect(onDrain.mock.calls).toEqual([[payload('C')]])
    expect(result.current.items).toEqual([])
  })

  it('keeps receipts independent and pauses only the originating scope on a late failure', async () => {
    const { result, rerender, onDrain, onDrainFailed } = setup()
    store.set('followup-queue.s2', [item('X', 'X'), item('Y', 'Y')])
    let fail!: (accepted: boolean) => void
    onDrain.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          fail = resolve
        })
    )
    act(() => {
      rerender(observation('error'))
    })
    await act(async () => {
      rerender({ ...observation('error'), scopeKey: 's2' })
    })
    expect(result.current.items.map((entry) => entry.id)).toEqual(['Y'])
    await act(async () => {
      fail(false)
    })
    expect(result.current.paused).toBe(false)
    expect(store.get('followup-queue-paused.s1')).toBe(true)
    expect(store.get('followup-queue-paused.s2')).toBeUndefined()
    expect(onDrainFailed).toHaveBeenCalledOnce()
    await act(async () => {
      rerender(observation('error'))
    })
    expect(result.current.paused).toBe(true)
    expect(result.current.items.map((entry) => entry.id)).toEqual(['B', 'C'])
    expect(onDrain.mock.calls).toEqual([[payload('B')], [payload('X')]])
  })

  it.each(['awaiting-approval', undefined] as const)(
    'does not send, pause or consume on %s even without identity',
    async (status) => {
      const { rerender, result, onDrain, onDrainFailed } = setup()
      await act(async () => {
        rerender({ ...observation(status), turnId: undefined })
      })
      expect(onDrain).not.toHaveBeenCalled()
      expect(onDrainFailed).not.toHaveBeenCalled()
      expect(result.current.paused).toBe(false)
      expect(result.current.items).toHaveLength(2)
      expect(store.get('followup-queue-last-drained-turn.s1')).toBeUndefined()
    }
  )

  it('stops unidentified terminal sending and notifies once across remounts', async () => {
    const { rerender, result, onDrain, onDrainFailed, unmount, hook } = setup()
    await act(async () => {
      rerender({ ...observation('error'), turnId: undefined })
    })
    expect(result.current.paused).toBe(true)
    expect(result.current.items).toHaveLength(2)
    unmount()
    const remount = hook()
    await act(async () => {
      remount.rerender({ ...observation('done'), turnId: undefined })
    })
    expect(onDrain).not.toHaveBeenCalled()
    expect(onDrainFailed).toHaveBeenCalledOnce()
  })

  it('does not consume a disabled terminal so enabling later can send it', async () => {
    const { rerender, onDrain, result } = setup()
    await act(async () => {
      rerender({ ...observation('aborted'), autoSendEnabled: false })
    })
    expect(onDrain).not.toHaveBeenCalled()
    expect(store.get('followup-queue-last-drained-turn.s1')).toBeUndefined()
    await act(async () => {
      rerender(observation('aborted'))
    })
    expect(onDrain.mock.calls).toEqual([[payload('B')]])
    expect(result.current.items.map((entry) => entry.id)).toEqual(['C'])
  })
})
