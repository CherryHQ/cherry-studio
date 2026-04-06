import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAiChat } from '../useAiChat'

// Mock IpcChatTransport — use vi.hoisted to avoid TDZ issues with vi.mock hoisting
const { mockTransport, mockSendMessage, mockRegenerate } = vi.hoisted(() => {
  const mockTransport = { sendMessages: vi.fn(), reconnectToStream: vi.fn() }
  const mockSendMessage = vi.fn()
  const mockRegenerate = vi.fn().mockResolvedValue(undefined)
  return { mockTransport, mockSendMessage, mockRegenerate }
})
vi.mock('@renderer/transport/IpcChatTransport', () => ({
  IpcChatTransport: vi.fn(() => mockTransport)
}))

// Capture the config passed to useChat so we can assert on it
const mockUseChat = vi.fn()

vi.mock('@ai-sdk/react', () => ({
  useChat: (config: unknown) => {
    mockUseChat(config)
    return {
      messages: [],
      input: '',
      status: 'ready',
      error: undefined,
      setInput: vi.fn(),
      append: vi.fn(),
      stop: vi.fn(),
      reload: vi.fn(),
      setMessages: vi.fn(),
      sendMessage: mockSendMessage,
      regenerate: mockRegenerate,
      isLoading: false,
      handleInputChange: vi.fn(),
      handleSubmit: vi.fn()
    }
  }
}))

describe('useAiChat', () => {
  beforeEach(() => {
    mockUseChat.mockClear()
    mockSendMessage.mockClear()
    mockRegenerate.mockClear()
  })

  it('should pass chatId as id to useChat', () => {
    renderHook(() => useAiChat({ chatId: 'chat-123', topicId: 'topic-456' }))

    const config = mockUseChat.mock.calls[0][0] as Record<string, unknown>
    expect(config.id).toBe('chat-123')
  })

  it('should use the shared IpcChatTransport as transport', () => {
    renderHook(() => useAiChat({ chatId: 'chat-1', topicId: 'topic-1' }))

    const config = mockUseChat.mock.calls[0][0] as Record<string, unknown>
    expect(config.transport).toBe(mockTransport)
  })

  it('should set experimental_throttle to 50ms', () => {
    renderHook(() => useAiChat({ chatId: 'chat-1', topicId: 'topic-1' }))

    const config = mockUseChat.mock.calls[0][0] as Record<string, unknown>
    expect(config.experimental_throttle).toBe(50)
  })

  it('should forward initialMessages to useChat', () => {
    const initialMessages = [{ id: 'msg-1', role: 'user' as const, content: 'hello', parts: [] }]

    renderHook(() =>
      useAiChat({
        chatId: 'chat-1',
        topicId: 'topic-1',
        initialMessages: initialMessages as ReturnType<typeof useAiChat>['messages']
      })
    )

    const config = mockUseChat.mock.calls[0][0] as Record<string, unknown>
    expect(config.messages).toBe(initialMessages)
  })

  it('should provide onFinish and onError callbacks', () => {
    renderHook(() => useAiChat({ chatId: 'chat-1', topicId: 'topic-1' }))

    const config = mockUseChat.mock.calls[0][0] as Record<string, unknown>
    expect(typeof config.onFinish).toBe('function')
    expect(typeof config.onError).toBe('function')
  })

  it('should inject topicId and assistantId into sendMessage body', () => {
    const { result } = renderHook(() => useAiChat({ chatId: 'chat-1', topicId: 'topic-abc', assistantId: 'asst-42' }))

    result.current.sendMessage({ text: 'hello' })

    expect(mockSendMessage).toHaveBeenCalledWith(
      { text: 'hello' },
      expect.objectContaining({
        body: expect.objectContaining({ topicId: 'topic-abc', assistantId: 'asst-42' })
      })
    )
  })

  it('should merge per-call body with static topicId/assistantId in sendMessage', () => {
    const { result } = renderHook(() => useAiChat({ chatId: 'chat-1', topicId: 'topic-1', assistantId: 'asst-1' }))

    result.current.sendMessage({ text: 'hi' }, { body: { files: ['f1'] } })

    const callArgs = mockSendMessage.mock.calls[0]
    expect(callArgs[1].body).toEqual({
      topicId: 'topic-1',
      assistantId: 'asst-1',
      files: ['f1']
    })
  })

  it('should inject topicId and assistantId into regenerate body', async () => {
    const { result } = renderHook(() => useAiChat({ chatId: 'chat-1', topicId: 'topic-1', assistantId: 'asst-1' }))

    await result.current.regenerate('msg-99')

    expect(mockRegenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-99',
        body: expect.objectContaining({ topicId: 'topic-1', assistantId: 'asst-1' })
      })
    )
  })

  it('should expose a regenerate function', () => {
    const { result } = renderHook(() => useAiChat({ chatId: 'chat-1', topicId: 'topic-1' }))

    expect(typeof result.current.regenerate).toBe('function')
  })
})
