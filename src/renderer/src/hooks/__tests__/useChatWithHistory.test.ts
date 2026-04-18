import type { TopicStatusChangedPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatWithHistory } from '../useChatWithHistory'

const mockUseChat = vi.fn()

vi.mock('@ai-sdk/react', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args)
}))

describe('useChatWithHistory', () => {
  const statusListeners: Array<(data: TopicStatusChangedPayload) => void> = []
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

  beforeEach(() => {
    statusListeners.length = 0
    doneListeners.length = 0
    errorListeners.length = 0

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
        ),
        topic: {
          ...originalApi.ai?.topic,
          onStatusChanged: vi.fn((cb: (data: TopicStatusChangedPayload) => void) => {
            statusListeners.push(cb)
            return () => {
              const index = statusListeners.indexOf(cb)
              if (index >= 0) statusListeners.splice(index, 1)
            }
          })
        }
      }
    }
  })

  afterEach(() => {
    ;(window as any).api = originalApi
    vi.clearAllMocks()
  })

  it('refreshes history before resuming the matching topic when another window starts streaming', async () => {
    const refresh = vi.fn().mockResolvedValue(refreshedMessages)

    renderHook(() => useChatWithHistory('topic-1', [], refresh, { assistantId: 'assistant-1' }, {}))

    await waitFor(() => {
      expect(resumeStream).toHaveBeenCalledTimes(1)
    })

    // Status change on a different topic must not trigger reattach.
    for (const listener of statusListeners) {
      listener({ topicId: 'other-topic', status: 'pending', activeExecutionIds: [] })
    }

    await waitFor(() => {
      expect(resumeStream).toHaveBeenCalledTimes(1)
    })
    expect(refresh).not.toHaveBeenCalled()

    // Non-`pending` deltas on our topic must not retrigger reattach
    // (streaming / done / error / aborted / idle describe ongoing
    // lifecycle, not a brand-new stream creation).
    for (const listener of statusListeners) {
      listener({ topicId: 'topic-1', status: 'streaming', activeExecutionIds: ['p::m'] })
    }
    await waitFor(() => {
      expect(resumeStream).toHaveBeenCalledTimes(1)
    })

    // `pending` on our topic = new ActiveStream created → reattach.
    for (const listener of statusListeners) {
      listener({ topicId: 'topic-1', status: 'pending', activeExecutionIds: ['p::m'] })
    }

    await waitFor(() => {
      expect(resumeStream).toHaveBeenCalledTimes(2)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(setMessages).toHaveBeenCalledWith(refreshedMessages)
    expect(setMessages.mock.invocationCallOrder[0]).toBeLessThan(resumeStream.mock.invocationCallOrder[1])
  })
})
