import type { CherryUIMessage } from '@shared/data/types/message'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Drive the coordinator deterministically.
const { coord } = vi.hoisted(() => {
  type Cb = (r: unknown) => void
  const subs = new Map<string, Set<Cb>>()
  return {
    coord: {
      subscribe: (topicId: string, cb: Cb) => {
        let s = subs.get(topicId)
        if (!s) {
          s = new Set()
          subs.set(topicId, s)
        }
        s.add(cb)
        return () => s.delete(cb)
      },
      emit(topicId: string, r: unknown) {
        for (const cb of subs.get(topicId) ?? []) cb(r)
      },
      reset: () => subs.clear()
    }
  }
})

vi.mock('@renderer/transport/streamDispatchCoordinator', () => ({
  streamDispatchCoordinator: { subscribe: coord.subscribe }
}))

import { usePendingMessages } from '../usePendingMessages'

const TOPIC = 'topic-1'
const dbMsg = (id: string): CherryUIMessage => ({ id, role: 'user', parts: [] }) as CherryUIMessage

beforeEach(() => coord.reset())
afterEach(() => vi.clearAllMocks())

describe('usePendingMessages', () => {
  it('addPending shows a user bubble immediately (single-model adds an assistant placeholder)', () => {
    const { result } = renderHook(({ ui }) => usePendingMessages(TOPIC, ui), {
      initialProps: { ui: [] as CherryUIMessage[] }
    })
    act(() => result.current.addPending({ text: 'hi', parentId: null, withAssistantPlaceholder: true }))

    expect(result.current.pendingMessages).toHaveLength(2)
    expect(result.current.pendingMessages[0].role).toBe('user')
    expect(result.current.pendingMessages[0].id).toMatch(/^pending-user-/)
    expect(result.current.pendingMessages[1].role).toBe('assistant')
    expect(result.current.pendingMessages[1].metadata?.status).toBe('pending')
  })

  it('multi-model send adds no assistant placeholder', () => {
    const { result } = renderHook(() => usePendingMessages(TOPIC, []))
    act(() => result.current.addPending({ text: 'hi', parentId: null, withAssistantPlaceholder: false }))
    expect(result.current.pendingMessages).toHaveLength(1)
    expect(result.current.pendingMessages[0].role).toBe('user')
  })

  it('clears the group once a joined id appears in uiMessages (ack join)', () => {
    const { result, rerender } = renderHook(({ ui }) => usePendingMessages(TOPIC, ui), {
      initialProps: { ui: [] as CherryUIMessage[] }
    })
    act(() => result.current.addPending({ text: 'hi', parentId: null, withAssistantPlaceholder: true }))
    expect(result.current.pendingMessages).toHaveLength(2)

    // ack arrives with authoritative ids
    act(() => coord.emit(TOPIC, { ok: true, topicId: TOPIC, ack: { mode: 'started', placeholderIds: ['real-a'] } }))
    // still pending — DB hasn't caught up yet
    expect(result.current.pendingMessages).toHaveLength(2)

    // DB revalidation brings the real placeholder row → group claimed
    rerender({ ui: [dbMsg('real-a')] })
    expect(result.current.pendingMessages).toHaveLength(0)
  })

  it('drops the group when the dispatch errors', () => {
    const { result } = renderHook(() => usePendingMessages(TOPIC, []))
    act(() => result.current.addPending({ text: 'hi', parentId: null, withAssistantPlaceholder: true }))
    expect(result.current.pendingMessages).toHaveLength(2)

    act(() => coord.emit(TOPIC, { ok: false, topicId: TOPIC, error: new Error('boom') }))
    expect(result.current.pendingMessages).toHaveLength(0)
  })

  it('resets pending on topic switch', () => {
    const { result, rerender } = renderHook(({ t }) => usePendingMessages(t, []), {
      initialProps: { t: TOPIC }
    })
    act(() => result.current.addPending({ text: 'hi', parentId: null, withAssistantPlaceholder: false }))
    expect(result.current.pendingMessages).toHaveLength(1)

    rerender({ t: 'topic-2' })
    expect(result.current.pendingMessages).toHaveLength(0)
  })
})
