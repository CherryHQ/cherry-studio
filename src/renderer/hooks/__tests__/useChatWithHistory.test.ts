import type { CherryUIMessage } from '@shared/data/types/message'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatWithHistory } from '../useChatWithHistory'

const mockUseChat = vi.fn()

vi.mock('@ai-sdk/react', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args),
  Chat: class {
    id: string
    constructor(opts: { id: string }) {
      this.id = opts.id
    }
  }
}))

// `useTopicStreamStatus` is driven by the shared
// `topic.stream.statuses.${topicId}` cache entry in production. Tests
// stub it here so each `it()` can advance the per-topic view
// synchronously by calling `setMockStatus`.
const mockTopicStreamStatus = vi.fn()
const LIVE_STATUSES = new Set(['streaming', 'pending'])
const TERMINAL_STATUSES = new Set(['done', 'aborted', 'error'])
vi.mock('../useTopicStreamStatus', () => ({
  useTopicStreamStatus: (topicId: string) => mockTopicStreamStatus(topicId),
  useTopicDbRefreshOnTerminal: (topicId: string, refresh: () => Promise<unknown>) => {
    const status = mockTopicStreamStatus(topicId)?.status as string | undefined
    const prevRef = useRef<string | undefined>(undefined)
    const refreshRef = useRef(refresh)
    refreshRef.current = refresh
    useEffect(() => {
      const prev = prevRef.current
      prevRef.current = status
      if (prev && LIVE_STATUSES.has(prev) && status && TERMINAL_STATUSES.has(status)) {
        void refreshRef.current().catch(() => {})
      }
    }, [status])
  }
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
      activeExecutions: [],
      awaitingApprovalAnchors: [],
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
        streamAbort: vi.fn().mockResolvedValue(undefined),
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
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(resumeStream.mock.invocationCallOrder[1])
  })

  it('refreshes when the topic transitions from a live status to a terminal one', async () => {
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)
    setMockStatus('topic-1', 'streaming')
    const { rerender } = renderHook(() => useChatWithHistory('topic-1', [], refresh))

    await waitFor(() => expect(resumeStream).toHaveBeenCalled())
    refresh.mockClear()

    // streaming → done: ChatStreamLifecycle.onTerminal broadcasts this only
    // after persistence, so it is the safe point to pull DB-final rows.
    setMockStatus('topic-1', 'done')
    rerender()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))

    // Idempotent on re-render at the same terminal status.
    rerender()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('stop() fires streamAbort IPC even on reconnected streams', async () => {
    // The AI SDK's `ChatTransport.reconnectToStream` contract doesn't carry an
    // abortSignal, so streams produced by reconnect lack the listener that
    // normally fans `chat.stop()` out as `streamAbort`. The hook wraps `stop`
    // to fire the IPC directly; this test guards against regression.
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)
    const { result } = renderHook(() => useChatWithHistory('topic-abort', [], refresh))

    await act(async () => {
      await result.current.stop()
    })

    expect((window as any).api.ai.streamAbort).toHaveBeenCalledWith({ topicId: 'topic-abort' })
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('refreshes on streaming → aborted and → error transitions', async () => {
    for (const terminal of ['aborted', 'error'] as const) {
      const refresh = vi.fn().mockResolvedValue(refreshedMessages)
      setMockStatus('topic-x', 'streaming')
      const { rerender, unmount } = renderHook(() => useChatWithHistory('topic-x', [], refresh))
      await waitFor(() => expect(resumeStream).toHaveBeenCalled())
      refresh.mockClear()

      setMockStatus('topic-x', terminal)
      rerender()
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
      unmount()
    }
  })
})
