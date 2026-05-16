import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { autoRenameTopic, useActiveTopic } from '../useTopic'

const mockDispatch = vi.fn()
const mockGetStoreSetting = vi.fn()
const mockFetchMessagesSummary = vi.fn()
const mockUpdateTopic = vi.fn((payload) => ({ type: 'assistants/updateTopic', payload }))
const mockSetRenamingTopics = vi.fn((payload) => ({ type: 'runtime/setRenamingTopics', payload }))
const mockSetNewlyRenamedTopics = vi.fn((payload) => ({ type: 'runtime/setNewlyRenamedTopics', payload }))
const mockLoadTopicMessagesThunk = vi.fn((topicId: string) => ({
  type: 'messages/loadTopicMessages',
  payload: topicId
}))
const mockDbGetTopic = vi.fn()
const mockFindMainTextBlocks = vi.fn()

let mockState: {
  assistants: { assistants: Assistant[] }
  runtime: { chat: { renamingTopics: string[]; newlyRenamedTopics: string[] } }
}

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/databases', () => ({
  default: {
    topics: {
      get: (...args: unknown[]) => mockDbGetTopic(...args),
      delete: vi.fn(),
      update: vi.fn()
    },
    message_blocks: {
      where: vi.fn()
    },
    transaction: vi.fn()
  }
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => (key === 'chat.default.topic.name' ? 'New Topic' : key)
  }
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchMessagesSummary: (...args: unknown[]) => mockFetchMessagesSummary(...args)
}))

vi.mock('@renderer/services/EventService', () => ({
  EVENT_NAMES: {
    CHANGE_TOPIC: 'CHANGE_TOPIC'
  },
  EventEmitter: {
    emit: vi.fn()
  }
}))

vi.mock('@renderer/services/MessagesService', () => ({
  safeDeleteFiles: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => mockState,
    dispatch: (...args: unknown[]) => mockDispatch(...args)
  }
}))

vi.mock('@renderer/store/assistants', () => ({
  updateTopic: (payload: unknown) => mockUpdateTopic(payload)
}))

vi.mock('@renderer/store/runtime', () => ({
  setNewlyRenamedTopics: (payload: unknown) => mockSetNewlyRenamedTopics(payload),
  setRenamingTopics: (payload: unknown) => mockSetRenamingTopics(payload)
}))

vi.mock('@renderer/store/thunk/messageThunk', () => ({
  loadTopicMessagesThunk: (topicId: string) => mockLoadTopicMessagesThunk(topicId)
}))

vi.mock('@renderer/utils/messageUtils/find', () => ({
  findMainTextBlocks: (message: Message) => mockFindMainTextBlocks(message)
}))

vi.mock('../useAssistant', () => ({
  useAssistant: () => ({ assistant: undefined })
}))

vi.mock('../useSettings', () => ({
  getStoreSetting: (...args: unknown[]) => mockGetStoreSetting(...args)
}))

function createMessage(id: string, role: 'user' | 'assistant'): Message {
  return {
    id,
    role,
    assistantId: 'assistant-1',
    topicId: 'topic-1',
    createdAt: '2026-05-16T00:00:00.000Z',
    status: 'success',
    blocks: [`${id}-block`]
  } as Message
}

function createTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 'topic-1',
    assistantId: 'assistant-1',
    name: 'New Topic',
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
    messages: [createMessage('user-1', 'user'), createMessage('assistant-1', 'assistant')],
    isNameManuallyEdited: false,
    ...overrides
  }
}

function createAssistant(topic: Topic): Assistant {
  return {
    id: 'assistant-1',
    name: 'Assistant',
    prompt: '',
    topics: [topic],
    type: 'assistant'
  }
}

function setupTopic(topic: Topic) {
  const assistant = createAssistant(topic)
  mockState = {
    assistants: { assistants: [assistant] },
    runtime: { chat: { renamingTopics: [], newlyRenamedTopics: [] } }
  }
  mockDbGetTopic.mockResolvedValue(topic)
  mockFindMainTextBlocks.mockReturnValue([{ content: 'First user message' }])

  return assistant
}

describe('autoRenameTopic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockFetchMessagesSummary.mockResolvedValue({ text: 'Generated Topic' })
    mockGetStoreSetting.mockImplementation((key: string) => {
      if (key === 'enableTopicNaming') return true
      return undefined
    })
    mockState = {
      assistants: { assistants: [] },
      runtime: { chat: { renamingTopics: [], newlyRenamedTopics: [] } }
    }
    ;(window as unknown as { toast: { error: ReturnType<typeof vi.fn> } }).toast = { error: vi.fn() }
  })

  it('does not rename or request a summary when auto topic naming is disabled', async () => {
    const topic = createTopic()
    const assistant = setupTopic(topic)
    mockGetStoreSetting.mockImplementation((key: string) => {
      if (key === 'enableTopicNaming') return false
      return undefined
    })

    await autoRenameTopic(assistant, topic.id)

    expect(mockFetchMessagesSummary).not.toHaveBeenCalled()
    expect(mockUpdateTopic).not.toHaveBeenCalled()
    expect(mockSetRenamingTopics).not.toHaveBeenCalled()
    expect(mockSetNewlyRenamedTopics).not.toHaveBeenCalled()
  })

  it('still requests a summary and updates eligible topics when auto topic naming is enabled', async () => {
    const topic = createTopic()
    const assistant = setupTopic(topic)
    await act(async () => {
      renderHook(() => useActiveTopic(assistant.id, topic))
    })

    await autoRenameTopic(assistant, topic.id)

    expect(mockFetchMessagesSummary).toHaveBeenCalledWith({ messages: topic.messages })
    expect(mockUpdateTopic).toHaveBeenCalledWith({
      assistantId: assistant.id,
      topic: expect.objectContaining({ name: 'Generated Topic' })
    })
    expect(mockSetRenamingTopics).toHaveBeenCalledWith([topic.id])
    expect(mockSetNewlyRenamedTopics).toHaveBeenCalledWith([topic.id])
  })

  it('preserves first-message fallback when summary generation returns no text', async () => {
    const topic = createTopic()
    const assistant = setupTopic(topic)
    mockFetchMessagesSummary.mockResolvedValue({ text: null })
    await act(async () => {
      renderHook(() => useActiveTopic(assistant.id, topic))
    })

    await autoRenameTopic(assistant, topic.id)

    expect(mockUpdateTopic).toHaveBeenCalledWith({
      assistantId: assistant.id,
      topic: expect.objectContaining({ name: 'First user message' })
    })
  })

  it('does not overwrite manually edited topic names', async () => {
    const topic = createTopic({ isNameManuallyEdited: true, name: 'Manual Name' })
    const assistant = setupTopic(topic)

    await autoRenameTopic(assistant, topic.id)

    expect(mockFetchMessagesSummary).not.toHaveBeenCalled()
    expect(mockUpdateTopic).not.toHaveBeenCalled()
    expect(mockSetRenamingTopics).not.toHaveBeenCalled()
  })
})
