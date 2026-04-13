import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLightweightAssistantFlow } from '../useLightweightAssistantFlow'

const { mockSendMessage, mockStop, mockSetMessages, getUseChatState, getAiEventState } = vi.hoisted(() => {
  const mockSendMessage = vi.fn().mockResolvedValue(undefined)
  const mockStop = vi.fn()
  const mockSetMessages = vi.fn()
  const state = {
    messages: [] as any[],
    status: 'ready' as 'ready' | 'submitted' | 'streaming' | 'error',
    error: undefined as Error | undefined
  }
  const aiEventState = {
    onStreamDone: null as null | ((data: { topicId: string; status: 'success' | 'paused' }) => void)
  }

  return {
    mockSendMessage,
    mockStop,
    mockSetMessages,
    getUseChatState: () => state,
    getAiEventState: () => aiEventState
  }
})

vi.mock('@ai-sdk/react', () => ({
  useChat: () => {
    const state = getUseChatState()
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

vi.mock('@renderer/transport/IpcChatTransport', () => ({
  ipcChatTransport: { sendMessages: vi.fn(), reconnectToStream: vi.fn() },
  IpcChatTransport: vi.fn()
}))

describe('useLightweightAssistantFlow', () => {
  let originalApi: unknown

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
    const state = getUseChatState()
    const aiEvents = getAiEventState()
    state.messages = []
    state.status = 'ready'
    state.error = undefined
    aiEvents.onStreamDone = null
    mockSendMessage.mockClear()
    mockStop.mockClear()
    mockSetMessages.mockClear()

    originalApi = (window as unknown as { api?: unknown }).api
    ;(
      window as unknown as {
        api: {
          ai: {
            onStreamDone: (cb: (data: { topicId: string; status: 'success' | 'paused' }) => void) => () => void
          }
        }
      }
    ).api = {
      ...(typeof originalApi === 'object' && originalApi ? originalApi : {}),
      ai: {
        onStreamDone: vi.fn((cb) => {
          aiEvents.onStreamDone = cb
          return () => {
            if (aiEvents.onStreamDone === cb) {
              aiEvents.onStreamDone = null
            }
          }
        })
      }
    }
  })

  afterEach(() => {
    ;(window as unknown as { api?: unknown }).api = originalApi
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
          topicId: 'topic-1',
          assistantId: 'assistant-1',
          providerId: 'provider-1',
          modelId: 'model-1',
          mcpToolIds: []
        })
      })
    )
  })

  it('maps an aborted completion to a paused assistant message via onStreamDone', async () => {
    const state = getUseChatState()
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
    act(() => {
      getAiEventState().onStreamDone?.({ topicId: 'topic-1', status: 'paused' })
    })
    rerender()

    expect(result.current.latestAssistantMessage?.status).toBe('paused')
  })

  it('maps a failed completion to an error assistant message', () => {
    const state = getUseChatState()
    state.messages = [{ id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'partial' }] }]
    state.error = new Error('boom')

    const { result, rerender } = renderHook(() =>
      useLightweightAssistantFlow({
        chatId: 'chat-1',
        topicId: 'topic-1',
        assistantId: assistant.id
      })
    )
    rerender()

    expect(result.current.error).toBe('boom')
    expect(result.current.latestAssistantMessage?.status).toBe('error')
  })

  it('preserves existing messages when run is called with reset=false', async () => {
    const state = getUseChatState()
    state.messages = [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'existing' }] }]

    const { result } = renderHook(() =>
      useLightweightAssistantFlow({
        chatId: 'chat-1',
        topicId: 'topic-1',
        assistantId: assistant.id
      })
    )

    await act(async () => {
      await result.current.run({ assistant, prompt: 'follow-up', reset: false })
    })

    // stop and setMessages([]) should NOT be called when reset=false
    expect(mockStop).not.toHaveBeenCalled()
    expect(mockSetMessages).not.toHaveBeenCalledWith([])
  })
})
