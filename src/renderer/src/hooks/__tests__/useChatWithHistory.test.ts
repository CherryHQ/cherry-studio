import type { CherryUIMessage } from '@shared/data/types/message'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatWithHistory } from '../useChatWithHistory'

const mockUseChat = vi.fn()

vi.mock('@ai-sdk/react', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args)
}))

// `useTopicStreamStatus` is driven by the shared
// `topic.stream.statuses.${topicId}` cache entry in production. Tests
// stub it here so each `it()` can advance the per-topic view
// synchronously by calling `setMockStatus`.
const mockTopicStreamStatus = vi.fn()
vi.mock('../useTopicStreamStatus', () => ({
  useTopicStreamStatus: (topicId: string) => mockTopicStreamStatus(topicId)
}))

describe('useChatWithHistory', () => {
  const doneListeners: Array<(data: { topicId: string; executionId?: string; isTopicDone?: boolean }) => void> = []
  const errorListeners: Array<
    (data: { topicId: string; executionId?: string; isTopicDone?: boolean; error: { message: string } }) => void
  > = []

  const resumeStream = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const setMessages = vi.fn()
  const stop = vi.fn()
  const sendMessage = vi.fn()
  const regenerate = vi.fn()
  const originalApi = window.api as any
  const refreshedMessages = [{ id: 'user-1', role: 'user', parts: [] }] as unknown as CherryUIMessage[]

  /**
   * Per-topic status map the stubbed `useTopicStreamStatus` reads from.
   * Component re-renders are driven by mutating this map and calling
   * `rerender()` at the test site.
   */
  const statuses = new Map<string, string | undefined>()

  const setMockStatus = (topicId: string, status: string | undefined) => {
    statuses.set(topicId, status)
  }

  beforeEach(() => {
    doneListeners.length = 0
    errorListeners.length = 0
    statuses.clear()

    mockTopicStreamStatus.mockImplementation((topicId: string) => ({
      status: statuses.get(topicId),
      activeExecutionIds: [],
      isPending: statuses.get(topicId) === 'pending' || statuses.get(topicId) === 'streaming',
      isFulfilled: statuses.get(topicId) === 'done',
      markSeen: vi.fn()
    }))

    resumeStream.mockClear()
    setMessages.mockClear()
    stop.mockClear()
    sendMessage.mockClear()
    regenerate.mockClear()

    mockUseChat.mockReturnValue({
      messages: [] as CherryUIMessage[],
      setMessages,
      stop,
      status: 'ready',
      error: undefined,
      sendMessage,
      regenerate,
      resumeStream
    })

    ;(window as any).api = {
      ...originalApi,
      ai: {
        ...originalApi.ai,
        onStreamDone: vi.fn((cb: (data: { topicId: string; executionId?: string; isTopicDone?: boolean }) => void) => {
          doneListeners.push(cb)
          return () => {
            const index = doneListeners.indexOf(cb)
            if (index >= 0) doneListeners.splice(index, 1)
          }
        }),
        onStreamError: vi.fn(
          (
            cb: (data: {
              topicId: string
              executionId?: string
              isTopicDone?: boolean
              error: { message: string }
            }) => void
          ) => {
            errorListeners.push(cb)
            return () => {
              const index = errorListeners.indexOf(cb)
              if (index >= 0) errorListeners.splice(index, 1)
            }
          }
        )
      }
    }
  })

  afterEach(() => {
    ;(window as any).api = originalApi
    vi.clearAllMocks()
  })

  it('refreshes history before resuming the matching topic when another window starts streaming', async () => {
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)

    const { rerender } = renderHook(() => useChatWithHistory('topic-1', [], refresh))

    await waitFor(() => {
      expect(resumeStream).toHaveBeenCalledTimes(1)
    })

    // Status change on a different topic must not trigger reattach —
    // `useTopicStreamStatus` is keyed by topicId so the hook under test
    // never sees this change.
    setMockStatus('other-topic', 'pending')
    rerender()

    await waitFor(() => {
      expect(resumeStream).toHaveBeenCalledTimes(1)
    })
    expect(refresh).not.toHaveBeenCalled()

    // Non-`pending` transitions on our topic must not retrigger reattach
    // (streaming / done / error / aborted describe ongoing lifecycle,
    // not a brand-new stream creation).
    setMockStatus('topic-1', 'streaming')
    rerender()
    await waitFor(() => {
      expect(resumeStream).toHaveBeenCalledTimes(1)
    })

    // A fresh `pending` on our topic = new ActiveStream created → reattach.
    // The effect guards on the prev-value ref so transitioning via
    // `streaming → pending` still counts as a new pending.
    setMockStatus('topic-1', 'pending')
    rerender()

    await waitFor(() => {
      expect(resumeStream).toHaveBeenCalledTimes(2)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(setMessages).toHaveBeenCalledWith(refreshedMessages)
    expect(setMessages.mock.invocationCallOrder[0]).toBeLessThan(resumeStream.mock.invocationCallOrder[1])
  })
})
