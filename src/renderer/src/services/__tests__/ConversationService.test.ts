import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { messageBlocksSlice } from '@renderer/store/messageBlock'
import { MessageBlockStatus } from '@renderer/types/newMessage'
import { createErrorBlock, createImageBlock, createMainTextBlock, createMessage } from '@renderer/utils/messageUtils/create'
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

  const defaultAssistantSettings = { contextCount: 10, imageContextCount: 100000 }

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
    getAssistantSettings: (assistant: any) => ({
      contextCount: assistant?.settings?.contextCount ?? 10,
      imageContextCount: assistant?.settings?.imageContextCount ?? 100000
    }),
    getDefaultModel: () => ({ id: 'default-model', name: 'Default Model', provider: 'openai', group: 'openai' }),
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

describe('ConversationService.prepareMessagesForModel', () => {
  beforeEach(() => {
    mockStore = createMockStore()
    vi.clearAllMocks()
  })

  it('limits historical images while keeping images in the current user message', async () => {
    const topicId = 'topic-1'
    const assistantId = 'assistant-1'

    const user1Text = createMainTextBlock('user-1', 'Here are two images', { status: MessageBlockStatus.SUCCESS })
    const user1Img1 = createImageBlock('user-1', { url: 'https://example.com/1.png', status: MessageBlockStatus.SUCCESS })
    const user1Img2 = createImageBlock('user-1', { url: 'https://example.com/2.png', status: MessageBlockStatus.SUCCESS })
    const user1 = createMessage('user', topicId, assistantId, {
      id: 'user-1',
      blocks: [user1Text.id, user1Img1.id, user1Img2.id]
    })

    const assistant1Text = createMainTextBlock('assistant-1', 'Thanks!', { status: MessageBlockStatus.SUCCESS })
    const assistant1 = createMessage('assistant', topicId, assistantId, {
      id: 'assistant-1',
      askId: 'user-1',
      blocks: [assistant1Text.id]
    })

    const user2Text = createMainTextBlock('user-2', 'New message with an image', { status: MessageBlockStatus.SUCCESS })
    const user2Img = createImageBlock('user-2', { url: 'https://example.com/3.png', status: MessageBlockStatus.SUCCESS })
    const user2 = createMessage('user', topicId, assistantId, { id: 'user-2', blocks: [user2Text.id, user2Img.id] })

    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user1Text))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user1Img1))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user1Img2))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(assistant1Text))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user2Text))
    mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user2Img))

    const assistant = {
      id: assistantId,
      name: 'Test Assistant',
      emoji: '😀',
      prompt: '',
      topics: [],
      type: 'assistant',
      regularPhrases: [],
      model: { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'openai', group: 'openai' },
      settings: { contextCount: 10, imageContextCount: 1 }
    } as any

    const result = await ConversationService.prepareMessagesForModel([user1, assistant1, user2], assistant)

    const userMessages = result.modelMessages.filter((m) => m.role === 'user') as any[]
    expect(userMessages).toHaveLength(2)

    const user1Sdk = userMessages[0]
    const user2Sdk = userMessages[1]

    const user1Images = (user1Sdk.content as any[]).filter((p: any) => p.type === 'image').map((p: any) => p.image)
    const user2Images = (user2Sdk.content as any[]).filter((p: any) => p.type === 'image').map((p: any) => p.image)

    expect(user1Images).toEqual(['https://example.com/2.png'])
    expect(user2Images).toEqual(['https://example.com/3.png'])
  })
})
