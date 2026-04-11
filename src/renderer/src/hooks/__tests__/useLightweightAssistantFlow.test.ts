import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLightweightAssistantFlow } from '../useLightweightAssistantFlow'

const { mockSendMessage, mockStop, mockSetMessages, getUseAiChatState } = vi.hoisted(() => {
  const mockSendMessage = vi.fn().mockResolvedValue(undefined)
  const mockStop = vi.fn()
  const mockSetMessages = vi.fn()
  const state = {
    messages: [] as any[],
    status: 'ready' as 'ready' | 'submitted' | 'streaming' | 'error',
    error: undefined as Error | undefined,
    options: null as any
  }

  return {
    mockSendMessage,
    mockStop,
    mockSetMessages,
    getUseAiChatState: () => state
  }
})

vi.mock('@renderer/hooks/useAiChat', () => ({
  useAiChat: (options: unknown) => {
    const state = getUseAiChatState()
    state.options = options
    return {
      messages: state.messages,
      status: state.status,
      error: state.error,
      sendMessage: mockSendMessage,
      stop: mockStop,
      setMessages: mockSetMessages
    }
  }
}))

describe('useLightweightAssistantFlow', () => {
  const assistant = {
    id: 'assistant-1',
    prompt: 'system prompt',
    settings: {},
    enableWebSearch: false,
    model: {
      id: 'model-1',
      provider: 'provider-1'
    }
  } as any

  beforeEach(() => {
    const state = getUseAiChatState()
    state.messages = []
    state.status = 'ready'
    state.error = undefined
    state.options = null
    mockSendMessage.mockClear()
    mockStop.mockClear()
    mockSetMessages.mockClear()
  })

  it('stops and clears the previous stream before running a new request', async () => {
    const { result } = renderHook(() =>
      useLightweightAssistantFlow({
        chatId: 'chat-1',
        topicId: 'topic-1',
        assistantId: assistant.id
      })
    )

    await act(async () => {
      await result.current.run({ assistant, prompt: 'hello' })
    })

    expect(mockStop).toHaveBeenCalledTimes(1)
    expect(mockSetMessages).toHaveBeenCalledWith([])
    expect(mockSendMessage).toHaveBeenCalledWith(
      { text: 'hello' },
      expect.objectContaining({
        body: expect.objectContaining({
          assistantId: 'assistant-1',
          providerId: 'provider-1',
          modelId: 'model-1',
          mcpToolIds: []
        })
      })
    )
  })

  it('maps an aborted completion to a paused assistant message', async () => {
    const state = getUseAiChatState()
    state.messages = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'partial' }] }
    ]

    const { result, rerender } = renderHook(() =>
      useLightweightAssistantFlow({
        chatId: 'chat-1',
        topicId: 'topic-1',
        assistantId: assistant.id
      })
    )

    await act(async () => {
      await result.current.run({ assistant, prompt: 'hello' })
    })
    const options = getUseAiChatState().options as {
      onFinish: (message: unknown, isAbort: boolean, isError: boolean) => void
    }
    act(() => {
      options.onFinish(state.messages[1], true, false)
    })
    rerender()

    expect(result.current.latestAssistantMessage?.status).toBe('paused')
  })

  it('maps a failed completion to an error assistant message', () => {
    const state = getUseAiChatState()
    state.messages = [{ id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'partial' }] }]

    const { result, rerender } = renderHook(() =>
      useLightweightAssistantFlow({
        chatId: 'chat-1',
        topicId: 'topic-1',
        assistantId: assistant.id
      })
    )

    const options = getUseAiChatState().options as { onError: (error: Error) => void }
    act(() => {
      options.onError(new Error('boom'))
    })
    rerender()

    expect(result.current.error).toBe('boom')
    expect(result.current.latestAssistantMessage?.status).toBe('error')
  })

  it('preserves existing messages when run is called with reset=false', async () => {
    const state = getUseAiChatState()
    state.messages = [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'existing' }] }]

    const { result } = renderHook(() =>
      useLightweightAssistantFlow({
        chatId: 'chat-1',
        topicId: 'topic-1',
        assistantId: assistant.id
      })
    )

    await act(async () => {
      await result.current.run({ assistant, prompt: 'next', reset: false })
    })

    expect(mockStop).not.toHaveBeenCalled()
    expect(mockSetMessages).not.toHaveBeenCalledWith([])
  })
})
