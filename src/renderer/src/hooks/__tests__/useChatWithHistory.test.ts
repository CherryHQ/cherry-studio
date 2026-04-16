import type { CherryUIMessage } from '@shared/data/types/message'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatWithHistory } from '../useChatWithHistory'

const mockUseChat = vi.fn()

vi.mock('@ai-sdk/react', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args)
}))

describe('useChatWithHistory', () => {
  const startedListeners: Array<(data: { topicId: string }) => void> = []
  const doneListeners: Array<(data: { topicId: string; executionId?: string; isTopicDone?: boolean }) => void> = []
  const errorListeners: Array<
    (data: { topicId: string; executionId?: string; isTopicDone?: boolean; error: { message: string } }) => void
  > = []
  const chunkListeners: Array<(data: { topicId: string; executionId?: string }) => void> = []

  const resumeStream = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const setMessages = vi.fn()
  const stop = vi.fn()
  const sendMessage = vi.fn()
  const regenerate = vi.fn()
  const originalApi = window.api as any
  const refreshedMessages = [{ id: 'user-1', role: 'user', parts: [] }] as unknown as CherryUIMessage[]

  beforeEach(() => {
    startedListeners.length = 0
    doneListeners.length = 0
    errorListeners.length = 0
    chunkListeners.length = 0

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
        onStreamStarted: vi.fn((cb: (data: { topicId: string }) => void) => {
          startedListeners.push(cb)
          return () => {
            const index = startedListeners.indexOf(cb)
            if (index >= 0) startedListeners.splice(index, 1)
          }
        }),
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
        onStreamChunk: vi.fn((cb: (data: { topicId: string; executionId?: string }) => void) => {
          chunkListeners.push(cb)
          return () => {
            const index = chunkListeners.indexOf(cb)
            if (index >= 0) chunkListeners.splice(index, 1)
          }
        })
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

    for (const listener of startedListeners) {
      listener({ topicId: 'other-topic' })
    }

    await waitFor(() => {
      expect(resumeStream).toHaveBeenCalledTimes(1)
    })
    expect(refresh).not.toHaveBeenCalled()

    for (const listener of startedListeners) {
      listener({ topicId: 'topic-1' })
    }

    await waitFor(() => {
      expect(resumeStream).toHaveBeenCalledTimes(2)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(setMessages).toHaveBeenCalledWith(refreshedMessages)
    expect(setMessages.mock.invocationCallOrder[0]).toBeLessThan(resumeStream.mock.invocationCallOrder[1])
  })
})
