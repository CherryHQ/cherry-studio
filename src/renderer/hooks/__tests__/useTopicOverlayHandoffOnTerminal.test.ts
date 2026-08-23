import { ConversationKind, type ConversationRef, conversationRefKey } from '@shared/ai/conversation'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => {
  const refreshPorts = new Map<string, () => Promise<unknown>>()
  const view = {
    overlay: {},
    liveAssistants: [],
    records: [],
    optimisticMessages: [],
    projectedExecutions: [],
    activeNodeOverride: null,
    refreshError: null
  }
  return {
    refreshPorts,
    service: {
      acquire: vi.fn(),
      release: vi.fn(),
      syncExecutions: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      getView: vi.fn(() => view),
      seedReservations: vi.fn(),
      disposeOverlay: vi.fn(),
      reset: vi.fn(),
      clear: vi.fn(),
      onFinish: vi.fn(() => () => {}),
      registerRefreshPort: vi.fn((conversation: ConversationRef, refresh: () => Promise<unknown>) => {
        const key = conversationRefKey(conversation)
        refreshPorts.set(key, refresh)
        return () => refreshPorts.delete(key)
      })
    }
  }
})

vi.mock('@renderer/services/aiTransport', () => ({ executionStreamOverlayService: mock.service }))

import { useExecutionOverlay } from '../useExecutionOverlay'

const conversation = (id: string): ConversationRef => ({ kind: ConversationKind.Chat, id })

describe('Conversation overlay quiescence handoff binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.refreshPorts.clear()
  })

  it('registers one refresh port for a mounted Conversation binding', () => {
    const refresh = vi.fn(async () => undefined)
    const ref = conversation('topic-1')
    const { rerender } = renderHook(() => useExecutionOverlay(ref, [], [], { refreshOnQuiesced: refresh }))

    rerender()

    expect(mock.service.registerRefreshPort).toHaveBeenCalledTimes(1)
    expect(mock.refreshPorts.get(conversationRefKey(ref))).toBeDefined()
  })

  it('does not install a refresh handoff while no durable refresh port is available', () => {
    renderHook(() => useExecutionOverlay(conversation('topic-1'), [], []))

    expect(mock.service.registerRefreshPort).not.toHaveBeenCalled()
    expect(mock.refreshPorts).toEqual(new Map())
  })

  it('allows the service to invoke the durable refresh after a later quiescence fact', async () => {
    const refresh = vi.fn(async () => undefined)
    const ref = conversation('topic-1')
    renderHook(() => useExecutionOverlay(ref, [], [], { refreshOnQuiesced: refresh }))

    await act(async () => mock.refreshPorts.get(conversationRefKey(ref))!())

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the refresh promise pending so the service can retire only after durable history resolves', async () => {
    let finish!: () => void
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const ref = conversation('topic-1')
    renderHook(() => useExecutionOverlay(ref, [], [], { refreshOnQuiesced: refresh }))

    let settled = false
    const handoff = mock.refreshPorts.get(conversationRefKey(ref))!().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    finish()
    await handoff
    expect(settled).toBe(true)
  })

  it('does not carry a refresh callback across Conversation identities', async () => {
    const refreshA = vi.fn(async () => undefined)
    const refreshB = vi.fn(async () => undefined)
    const conversationA = conversation('topic-1')
    const conversationB = conversation('topic-2')
    const { rerender } = renderHook(
      ({ ref, refresh }) => useExecutionOverlay(ref, [], [], { refreshOnQuiesced: refresh }),
      { initialProps: { ref: conversationA, refresh: refreshA } }
    )
    const staleRefresh = mock.refreshPorts.get(conversationRefKey(conversationA))!

    rerender({ ref: conversationB, refresh: refreshB })
    await staleRefresh()

    expect(refreshA).toHaveBeenCalledTimes(1)
    expect(refreshB).not.toHaveBeenCalled()
    expect(mock.refreshPorts.get(conversationRefKey(conversationB))).toBeDefined()
  })
})
