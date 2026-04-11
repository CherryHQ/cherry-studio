import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatSession } from '../useChatSession'

const mockChat = vi.hoisted(() => ({
  messages: [],
  status: 'ready',
  error: undefined,
  sendMessage: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  regenerate: vi.fn().mockResolvedValue(undefined),
  '~registerMessagesCallback': vi.fn(() => () => {}),
  '~registerStatusCallback': vi.fn(() => () => {}),
  '~registerErrorCallback': vi.fn(() => () => {})
}))

const mockSession = vi.hoisted(() => ({
  chat: mockChat,
  updateContext: vi.fn()
}))

const mockManager = vi.hoisted(() => ({
  getOrCreate: vi.fn(() => mockSession),
  retain: vi.fn(),
  release: vi.fn(),
  MESSAGE_THROTTLE_MS: 50
}))

vi.mock('@renderer/services/ChatSessionManager', () => ({
  chatSessionManager: mockManager,
  MESSAGE_THROTTLE_MS: 50
}))

describe('useChatSession', () => {
  beforeEach(() => {
    mockManager.getOrCreate.mockClear()
    mockManager.retain.mockClear()
    mockManager.release.mockClear()
    mockSession.updateContext.mockClear()
    mockChat.sendMessage.mockClear()
    mockChat.regenerate.mockClear()
  })

  it('should inject topicId and assistantId into sendMessage body', async () => {
    const assistant = {
      id: 'asst-1',
      model: {
        id: 'gpt-4o',
        provider: 'openai'
      }
    }

    const { result } = renderHook(() =>
      useChatSession('topic-1', {
        topicId: 'topic-1',
        assistantId: 'asst-1',
        topic: { id: 'topic-1' } as never,
        assistant: assistant as never
      })
    )

    await result.current.sendMessage({ text: 'hello' })

    expect(mockChat.sendMessage).toHaveBeenCalledWith(
      { text: 'hello' },
      expect.objectContaining({
        body: expect.objectContaining({
          topicId: 'topic-1',
          assistantId: 'asst-1'
        })
      })
    )
  })

  it('should inject topicId and assistantId into regenerate body', async () => {
    const assistant = {
      id: 'asst-1',
      model: {
        id: 'claude-sonnet-4-20250514',
        provider: 'anthropic'
      }
    }

    const { result } = renderHook(() =>
      useChatSession('topic-1', {
        topicId: 'topic-1',
        assistantId: 'asst-1',
        topic: { id: 'topic-1' } as never,
        assistant: assistant as never
      })
    )

    await result.current.regenerate('msg-99')

    expect(mockChat.regenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-99',
        body: expect.objectContaining({
          topicId: 'topic-1',
          assistantId: 'asst-1'
        })
      })
    )
  })
})
