import { act, renderHook, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

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

// stop() now fires ipcApi.request('ai.stream.abort', …); route it to a spy for assertions.
const { streamAbortMock } = vi.hoisted(() => ({ streamAbortMock: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: async (route: string, input: unknown) =>
      route === 'ai.stream.abort' ? streamAbortMock(input) : undefined,
    on: () => () => {}
  }
}))

// `useTopicStreamStatus` is driven by the shared
// `topic.stream.statuses.${topicId}` cache entry in production. Tests
// stub it here so each `it()` can advance the per-topic view
// synchronously by calling `setMockStatus`.
const mockTopicStreamStatus = vi.fn()
const LIVE_STATUSES = new Set(['streaming', 'pending'])
vi.mock('../useTopicStreamStatus', () => ({
  useTopicStreamStatus: (topicId: string) => mockTopicStreamStatus(topicId),
  useTopicDbRefreshOnAwaitingApproval: (topicId: string, refresh: () => Promise<unknown>) => {
    const status = mockTopicStreamStatus(topicId)?.status as string | undefined
    const prevRef = useRef<string | undefined>(undefined)
    const refreshRef = useRef(refresh)
    refreshRef.current = refresh
    useEffect(() => {
      const prev = prevRef.current
      prevRef.current = status
      if (prev && LIVE_STATUSES.has(prev) && status === 'awaiting-approval') {
        void refreshRef.current().catch(() => {})
      }
    }, [status])
  }
}))

describe('useChatWithHistory', () => {
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
    streamAbortMock.mockReset()
    streamAbortMock.mockResolvedValue(undefined)
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

    ;(window as any).api = { ...originalApi }
  })

  afterEach(() => {
    ;(window as any).api = originalApi
    vi.clearAllMocks()
  })

  it('creates a fresh Chat instance when the stable owner switches topics', () => {
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)
    const { result, rerender } = renderHook(
      ({ topicId }: { topicId: string }) => useChatWithHistory(topicId, [], refresh),
      { initialProps: { topicId: 'topic-1' } }
    )
    const firstChat = result.current.chat

    rerender({ topicId: 'topic-2' })

    expect(result.current.chat.id).toBe('topic-2')
    expect(result.current.chat).not.toBe(firstChat)
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

  it('refreshes when the topic transitions from a live status to awaiting approval', async () => {
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)
    setMockStatus('topic-1', 'streaming')
    const { rerender } = renderHook(() => useChatWithHistory('topic-1', [], refresh))

    await waitFor(() => expect(resumeStream).toHaveBeenCalled())
    refresh.mockClear()

    setMockStatus('topic-1', 'awaiting-approval')
    rerender()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))

    // Idempotent on re-render at the same paused status.
    rerender()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('does not re-resume when the SDK status flaps after the mount attach', async () => {
    // Regression: the mount-resume effect used to depend on `status`, so every
    // ready/error edge of a terminated resumed stream immediately re-attached,
    // spinning a hot reconnect loop while main still reported the stream live.
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)
    let sdkStatus = 'ready'
    mockUseChat.mockImplementation(() => ({
      messages: [] as CherryUIMessage[],
      setMessages,
      stop,
      status: sdkStatus,
      error: undefined,
      sendMessage,
      regenerate,
      resumeStream
    }))

    const { rerender } = renderHook(() => useChatWithHistory('topic-1', [], refresh))
    await waitFor(() => expect(resumeStream).toHaveBeenCalledTimes(1))

    for (const nextStatus of ['submitted', 'streaming', 'error', 'ready', 'error', 'ready']) {
      sdkStatus = nextStatus
      rerender()
    }

    await waitFor(() => expect(resumeStream).toHaveBeenCalledTimes(1))
  })

  it('does not let a stale topic refresh resume the newly selected topic', async () => {
    let resolveTopicOneRefresh!: () => void
    const topicOneRefresh = vi.fn(
      () =>
        new Promise<CherryUIMessage[]>((resolve) => {
          resolveTopicOneRefresh = () => resolve(refreshedMessages)
        })
    )
    const topicTwoRefresh = vi.fn().mockResolvedValue(refreshedMessages)
    const resumeTopicOne = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const resumeTopicTwo = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    mockUseChat.mockImplementation(({ chat }: { chat: { id: string } }) => ({
      messages: [] as CherryUIMessage[],
      setMessages,
      stop,
      status: 'ready',
      error: undefined,
      sendMessage,
      regenerate,
      resumeStream: chat.id === 'topic-1' ? resumeTopicOne : resumeTopicTwo
    }))

    const { rerender } = renderHook(
      ({ topicId, refresh }: { topicId: string; refresh: () => Promise<CherryUIMessage[]> }) =>
        useChatWithHistory(topicId, [], refresh),
      { initialProps: { topicId: 'topic-1', refresh: topicOneRefresh } }
    )
    await waitFor(() => expect(resumeTopicOne).toHaveBeenCalledTimes(1))

    setMockStatus('topic-1', 'pending')
    rerender({ topicId: 'topic-1', refresh: topicOneRefresh })
    await waitFor(() => expect(topicOneRefresh).toHaveBeenCalledTimes(1))

    rerender({ topicId: 'topic-2', refresh: topicTwoRefresh })
    await waitFor(() => expect(resumeTopicTwo).toHaveBeenCalledTimes(1))

    await act(async () => {
      resolveTopicOneRefresh()
    })

    await waitFor(() => expect(resumeTopicTwo).toHaveBeenCalledTimes(1))
  })

  it('does not reuse a stale in-flight refresh after selecting the same topic again', async () => {
    let resolveFirstTopicRefresh!: () => void
    const topicOneRefresh = vi.fn(
      () =>
        new Promise<CherryUIMessage[]>((resolve) => {
          resolveFirstTopicRefresh = () => resolve(refreshedMessages)
        })
    )
    const topicTwoRefresh = vi.fn().mockResolvedValue(refreshedMessages)
    const resumeTopicOne = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const resumeTopicTwo = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    mockUseChat.mockImplementation(({ chat }: { chat: { id: string } }) => ({
      messages: [] as CherryUIMessage[],
      setMessages,
      stop,
      status: chat.id === 'topic-2' ? 'streaming' : 'ready',
      error: undefined,
      sendMessage,
      regenerate,
      resumeStream: chat.id === 'topic-1' ? resumeTopicOne : resumeTopicTwo
    }))

    const { rerender } = renderHook(
      ({ topicId, refresh }: { topicId: string; refresh: () => Promise<CherryUIMessage[]> }) =>
        useChatWithHistory(topicId, [], refresh),
      { initialProps: { topicId: 'topic-1', refresh: topicOneRefresh } }
    )
    await waitFor(() => expect(resumeTopicOne).toHaveBeenCalledTimes(1))

    setMockStatus('topic-1', 'pending')
    rerender({ topicId: 'topic-1', refresh: topicOneRefresh })
    await waitFor(() => expect(topicOneRefresh).toHaveBeenCalledTimes(1))

    rerender({ topicId: 'topic-2', refresh: topicTwoRefresh })
    expect(resumeTopicTwo).not.toHaveBeenCalled()

    rerender({ topicId: 'topic-1', refresh: topicOneRefresh })
    await waitFor(() => expect(resumeTopicOne).toHaveBeenCalledTimes(2))

    await act(async () => {
      resolveFirstTopicRefresh()
    })
    await waitFor(() => expect(resumeTopicOne).toHaveBeenCalledTimes(2))
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

    expect(streamAbortMock).toHaveBeenCalledWith({ topicId: 'topic-abort' })
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('starts the main-process abort before stopping the local SDK stream', async () => {
    const calls: string[] = []
    streamAbortMock.mockImplementationOnce(async () => {
      calls.push('main-abort')
    })
    stop.mockImplementationOnce(async () => {
      calls.push('sdk-stop')
    })
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)
    const { result } = renderHook(() => useChatWithHistory('topic-abort', [], refresh))

    await act(async () => {
      await result.current.stop()
    })

    expect(calls).toEqual(['main-abort', 'sdk-stop'])
  })

  it('does not resolve stop() until the main-process stream has drained', async () => {
    let finishDrain!: () => void
    streamAbortMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDrain = resolve
      })
    )
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)
    const { result } = renderHook(() => useChatWithHistory('topic-abort', [], refresh))

    const stopping = result.current.stop()
    let settled = false
    void stopping.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(stop).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)

    finishDrain()
    await expect(stopping).resolves.toBeUndefined()
  })

  it('waits for the main-process drain before rejecting a local stop failure', async () => {
    let finishDrain!: () => void
    streamAbortMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDrain = resolve
      })
    )
    const stopError = new Error('local stop failed')
    stop.mockRejectedValueOnce(stopError)
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)
    const { result } = renderHook(() => useChatWithHistory('topic-abort', [], refresh))

    const stopping = result.current.stop()
    let settled = false
    void stopping.catch(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(settled).toBe(false)

    finishDrain()
    await expect(stopping).rejects.toBe(stopError)
  })

  it('rejects stop() when the main-process stream cannot be aborted', async () => {
    const abortError = new Error('main abort failed')
    streamAbortMock.mockRejectedValueOnce(abortError)
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)
    const { result } = renderHook(() => useChatWithHistory('topic-abort', [], refresh))

    await expect(result.current.stop()).rejects.toBe(abortError)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('does not refresh on streaming → aborted/error because page handoff owns final refresh', async () => {
    for (const terminal of ['aborted', 'error'] as const) {
      const refresh = vi.fn().mockResolvedValue(refreshedMessages)
      setMockStatus('topic-x', 'streaming')
      const { rerender, unmount } = renderHook(() => useChatWithHistory('topic-x', [], refresh))
      await waitFor(() => expect(resumeStream).toHaveBeenCalled())
      refresh.mockClear()

      setMockStatus('topic-x', terminal)
      rerender()
      expect(refresh).not.toHaveBeenCalled()
      unmount()
    }
  })
})
