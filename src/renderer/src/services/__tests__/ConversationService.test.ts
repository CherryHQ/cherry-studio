import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { messageBlocksSlice } from '@renderer/store/messageBlock'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { createErrorBlock, createMainTextBlock, createMessage } from '@renderer/utils/messageUtils/create'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationService } from '../ConversationService'

// Create a lightweight mock store for selectors used in the filtering pipeline
const reducer = combineReducers({
  messageBlocks: messageBlocksSlice.reducer
})

const createMockStore = () => {
  return configureStore({
    reducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false })
  })
}

let mockStore: ReturnType<typeof createMockStore>

vi.mock('@renderer/services/AssistantService', () => {
  const createDefaultTopic = () => ({
    id: 'topic-default',
    assistantId: 'assistant-default',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Default Topic',
    messages: [],
    isNameManuallyEdited: false
  })

  const defaultAssistantSettings = { contextCount: 10 }

  const createDefaultAssistant = () => ({
    id: 'assistant-default',
    name: 'Default Assistant',
    emoji: '😀',
    topics: [createDefaultTopic()],
    messages: [],
    type: 'assistant',
    regularPhrases: [],
    settings: defaultAssistantSettings
  })

  return {
    DEFAULT_ASSISTANT_SETTINGS: defaultAssistantSettings,
    getAssistantSettings: () => ({ contextCount: 10 }),
    getDefaultModel: () => ({ id: 'default-model' }),
    getDefaultAssistant: () => createDefaultAssistant(),
    getDefaultTopic: () => createDefaultTopic(),
    getAssistantProvider: () => ({}),
    getProviderByModel: () => ({}),
    getProviderByModelId: () => ({}),
    getAssistantById: () => createDefaultAssistant(),
    getQuickModel: () => null,
    getTranslateModel: () => null,
    getDefaultTranslateAssistant: () => createDefaultAssistant()
  }
})

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action)
  }
}))

describe('ConversationService.filterMessagesPipeline', () => {
  beforeEach(() => {
    mockStore = createMockStore()
    vi.clearAllMocks()
  })

  it('removes error-only assistant replies together with their user message before trimming trailing assistants', () => {
    const topicId = 'topic-1'
    const assistantId = 'assistant-1'

    const user1Block = createMainTextBlock('user-1', 'First question', { status: MessageBlockStatus.SUCCESS })
    const user1 = createMessage('user', topicId, assistantId, { id: 'user-1', blocks: [user1Block.id] })

    const assistant1Block = createMainTextBlock('assistant-1', 'First answer', {
      status: MessageBlockStatus.SUCCESS
    })
    const assistant1 = createMessage('assistant', topicId, assistantId, {
      id: 'assistant-1',
      askId: 'user-1',
      blocks: [assistant1Block.id]
    })

    const user2Block = createMainTextBlock('user-2', 'Second question', { status: MessageBlockStatus.SUCCESS })
    const user2 = createMessage('user', topicId, assistantId, { id: 'user-2', blocks: [user2Block.id] })

    const errorBlock = createErrorBlock(
      'assistant-2',
      { message: 'Error occurred', name: 'Error', stack: null },
      { status: MessageBlockStatus.ERROR }
    )
    const assistantError = createMessage('assistant', topicId, assistantId, {
      id: 'assistant-2',
      askId: 'user-2',
      blocks: [errorBlock.id]
    })

    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user1Block))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(assistant1Block))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user2Block))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(errorBlock))

    const filtered = ConversationService.filterMessagesPipeline(
      [user1, assistant1, user2, assistantError],
      /* contextCount */ 10
    )

    expect(filtered.map((m) => m.id)).toEqual(['user-1'])
    expect(filtered.find((m) => m.id === 'user-2')).toBeUndefined()
  })

  it('preserves context while removing leading assistants and adjacent user duplicates', () => {
    const topicId = 'topic-1'
    const assistantId = 'assistant-1'

    const leadingAssistantBlock = createMainTextBlock('assistant-leading', 'Hi there', {
      status: MessageBlockStatus.SUCCESS
    })
    const leadingAssistant = createMessage('assistant', topicId, assistantId, {
      id: 'assistant-leading',
      blocks: [leadingAssistantBlock.id]
    })

    const user1Block = createMainTextBlock('user-1', 'First question', { status: MessageBlockStatus.SUCCESS })
    const user1 = createMessage('user', topicId, assistantId, { id: 'user-1', blocks: [user1Block.id] })

    const assistant1Block = createMainTextBlock('assistant-1', 'First answer', {
      status: MessageBlockStatus.SUCCESS
    })
    const assistant1 = createMessage('assistant', topicId, assistantId, {
      id: 'assistant-1',
      askId: 'user-1',
      blocks: [assistant1Block.id]
    })

    const user2Block = createMainTextBlock('user-2', 'Draft question', { status: MessageBlockStatus.SUCCESS })
    const user2 = createMessage('user', topicId, assistantId, { id: 'user-2', blocks: [user2Block.id] })

    const user3Block = createMainTextBlock('user-3', 'Final question', { status: MessageBlockStatus.SUCCESS })
    const user3 = createMessage('user', topicId, assistantId, { id: 'user-3', blocks: [user3Block.id] })

    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(leadingAssistantBlock))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user1Block))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(assistant1Block))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user2Block))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user3Block))

    const filtered = ConversationService.filterMessagesPipeline(
      [leadingAssistant, user1, assistant1, user2, user3],
      /* contextCount */ 10
    )

    expect(filtered.map((m) => m.id)).toEqual(['user-1', 'assistant-1', 'user-3'])
    expect(filtered.find((m) => m.id === 'user-2')).toBeUndefined()
    expect(filtered[0].role).toBe('user')
    expect(filtered[filtered.length - 1].role).toBe('user')
  })
})
