import { ConversationKind, type ConversationRef, ConversationStatus } from '@shared/ai/conversation'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEntry = vi.fn()
let lastSeenCompletion: number | null = null
const setLastSeenCompletion = vi.fn((next: number | null) => {
  lastSeenCompletion = next
})

vi.mock('@renderer/data/hooks/useCache', () => ({
  useSharedCache: () => [lastSeenCompletion, setLastSeenCompletion],
  useSharedCacheValue: () => mockEntry()
}))

import {
  useConversationAwaitingInteraction,
  useConversationDbRefreshOnAwaitingInteraction,
  useConversationStreamStatus
} from '../useConversationStreamStatus'

const conversation = { kind: ConversationKind.Chat, id: 'topic-1' } as const

function setEntry(status: ConversationStatus | undefined, lastCompletedAt?: number): void {
  mockEntry.mockReturnValue({
    status,
    lastCompletedAt,
    activeExecutions: [],
    awaitingInteractionExecutions: []
  })
}

describe('useConversationAwaitingInteraction', () => {
  beforeEach(() => {
    mockEntry.mockReset()
    setLastSeenCompletion.mockClear()
    lastSeenCompletion = null
  })

  it('is true iff the Main-owned status is WaitingInteraction', () => {
    setEntry(ConversationStatus.AwaitingInteraction)
    expect(renderHook(() => useConversationAwaitingInteraction(conversation)).result.current).toBe(true)
  })

  it.each<ConversationStatus | undefined>([
    ConversationStatus.Pending,
    ConversationStatus.Streaming,
    ConversationStatus.Aborted,
    ConversationStatus.Done,
    ConversationStatus.Error,
    undefined
  ])('is false for status %s without scanning per-window message parts', (status) => {
    setEntry(status)
    expect(renderHook(() => useConversationAwaitingInteraction(conversation)).result.current).toBe(false)
  })

  it('treats every durable completion as unread until that exact completion is marked seen', () => {
    setEntry(ConversationStatus.Done, 1000)
    const { result, rerender } = renderHook(() => useConversationStreamStatus(conversation))
    expect(result.current.isFulfilled).toBe(true)

    act(() => result.current.markSeen())
    rerender()
    expect(result.current.isFulfilled).toBe(false)

    setEntry(ConversationStatus.Done, 2000)
    rerender()
    expect(result.current.isFulfilled).toBe(true)
  })

  it.each([ConversationStatus.Pending, ConversationStatus.Streaming])(
    'refreshes once on %s to WaitingInteraction',
    async (liveStatus) => {
      const refresh = vi.fn(async () => {})
      setEntry(liveStatus)
      const { rerender } = renderHook(() => useConversationDbRefreshOnAwaitingInteraction(conversation, refresh))

      setEntry(ConversationStatus.AwaitingInteraction)
      await act(async () => rerender())
      await act(async () => rerender())
      expect(refresh).toHaveBeenCalledOnce()
    }
  )

  it.each([ConversationStatus.Done, ConversationStatus.Error, ConversationStatus.Aborted])(
    'does not refresh on Streaming to %s',
    async (terminalStatus) => {
      const refresh = vi.fn(async () => {})
      setEntry(ConversationStatus.Streaming)
      const { rerender } = renderHook(() => useConversationDbRefreshOnAwaitingInteraction(conversation, refresh))

      setEntry(terminalStatus)
      await act(async () => rerender())
      expect(refresh).not.toHaveBeenCalled()
    }
  )

  it('does not carry a live edge across Conversation identities', async () => {
    const refresh = vi.fn(async () => {})
    setEntry(ConversationStatus.Streaming)
    const { rerender } = renderHook(
      ({ value }: { value: ConversationRef }) => useConversationDbRefreshOnAwaitingInteraction(value, refresh),
      { initialProps: { value: conversation as ConversationRef } }
    )

    const other = { kind: ConversationKind.Chat, id: 'topic-2' } as const
    setEntry(ConversationStatus.AwaitingInteraction)
    await act(async () => rerender({ value: other }))
    expect(refresh).not.toHaveBeenCalled()
  })
})
