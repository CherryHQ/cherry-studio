import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getTopicByIdMock = vi.fn()
vi.mock('@data/services/TopicService', () => ({
  topicService: {
    getById: getTopicByIdMock
  }
}))

const getAssistantByIdMock = vi.fn()
vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: {
    getById: getAssistantByIdMock
  }
}))

const createMessageMock = vi.fn()
const createUserMessageWithPlaceholdersMock = vi.fn()
vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    create: createMessageMock,
    createUserMessageWithPlaceholders: createUserMessageWithPlaceholdersMock,
    getChildrenByParentId: vi.fn(),
    getById: vi.fn()
  }
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: {
    getByKey: vi.fn()
  }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: {
    maybeRenameFromFirstUserMessage: vi.fn(),
    maybeRenameFromConversationSummary: vi.fn()
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => 'openai::gpt-4o') }
      if (name === 'SpanCacheService') return { setTopicId: vi.fn() }
      return undefined
    })
  }
}))

const { PersistentChatContextProvider } = await import('../PersistentChatContextProvider')

const makeSubscriber = () => ({
  id: 'wc:1:topic-1',
  onChunk: vi.fn(),
  onDone: vi.fn(),
  onPaused: vi.fn(),
  onError: vi.fn(),
  isAlive: () => true
})

const openReq = (overrides: Partial<AiStreamOpenRequest> = {}): AiStreamOpenRequest =>
  ({
    topicId: 'topic-1',
    trigger: 'submit-message',
    userMessageParts: [{ type: 'text', text: 'queued follow-up' }],
    ...overrides
  }) as AiStreamOpenRequest

describe('PersistentChatContextProvider', () => {
  beforeEach(() => {
    getTopicByIdMock.mockReset()
    getAssistantByIdMock.mockReset()
    createMessageMock.mockReset()
    createUserMessageWithPlaceholdersMock.mockReset()

    getTopicByIdMock.mockResolvedValue({ id: 'topic-1', assistantId: 'assistant-1' })
    getAssistantByIdMock.mockResolvedValue({ id: 'assistant-1', modelId: 'openai::gpt-4o' })
    createMessageMock.mockResolvedValue({
      id: 'user-1',
      topicId: 'topic-1',
      parentId: 'assistant-streaming',
      role: 'user',
      data: { parts: [{ type: 'text', text: 'queued follow-up' }] },
      searchableText: 'queued follow-up',
      status: 'success',
      siblingsGroupId: 0,
      modelId: 'openai::gpt-4o',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  })

  it('persists only the user row when submitting into a live stream', async () => {
    const provider = new PersistentChatContextProvider()
    const subscriber = makeSubscriber()

    const prepared = await provider.prepareDispatch(subscriber, openReq({ parentAnchorId: 'assistant-streaming' }), {
      hasLiveStream: true
    })

    expect(createMessageMock).toHaveBeenCalledWith('topic-1', {
      role: 'user',
      parentId: 'assistant-streaming',
      data: { parts: [{ type: 'text', text: 'queued follow-up' }] },
      status: 'success',
      modelId: 'openai::gpt-4o',
      modelSnapshot: { id: 'gpt-4o', name: 'gpt-4o', provider: 'openai' }
    })
    expect(createUserMessageWithPlaceholdersMock).not.toHaveBeenCalled()
    expect(prepared.models).toEqual([])
    expect(prepared.listeners).toEqual([subscriber])
    expect(prepared.userMessage?.id).toBe('user-1')
    expect(prepared.userMessageId).toBe('user-1')
    expect(prepared.reservedMessages).toEqual([
      expect.objectContaining({
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'queued follow-up' }],
        metadata: expect.objectContaining({
          parentId: 'assistant-streaming',
          status: 'success',
          modelId: 'openai::gpt-4o'
        })
      })
    ])
  })
})
