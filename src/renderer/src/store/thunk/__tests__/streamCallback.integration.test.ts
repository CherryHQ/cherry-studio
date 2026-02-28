import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { BlockManager } from '@renderer/services/messageStreaming/BlockManager'
import { createCallbacks } from '@renderer/services/messageStreaming/callbacks'
import { streamingService } from '@renderer/services/messageStreaming/StreamingService'
import { createStreamProcessor } from '@renderer/services/StreamProcessingService'
import { messageBlocksSlice } from '@renderer/store/messageBlock'
import { messagesSlice } from '@renderer/store/newMessage'
import type { Assistant, ExternalToolResult, MCPTool, Model } from '@renderer/types'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus } from '@renderer/types/newMessage'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Create mock callbacks for testing.
 *
 * NOTE: Updated to use simplified dependencies after StreamingService refactoring.
 * Now we need to initialize StreamingService task before creating callbacks.
 */
const createMockCallbacks = (
  mockAssistantMsgId: string,
  mockTopicId: string,
  mockAssistant: Assistant
  // dispatch and getState are no longer needed after StreamingService refactoring
) => {
  // Initialize streaming task for tests
  streamingService.startTask(mockTopicId, mockAssistantMsgId, {
    parentId: 'test-user-msg-id',
    role: 'assistant',
    assistantId: mockAssistant.id,
    model: mockAssistant.model
  })

  return createCallbacks({
    blockManager: new BlockManager({
      assistantMsgId: mockAssistantMsgId,
      topicId: mockTopicId,
      throttledBlockUpdate: vi.fn((blockId, changes) => {
        // In tests, immediately update the block
        streamingService.updateBlock(blockId, changes)
      }),
      cancelThrottledBlockUpdate: vi.fn()
    }),
    topicId: mockTopicId,
    assistantMsgId: mockAssistantMsgId,
    assistant: mockAssistant
  })
}

// Mock external dependencies
// NOTE: CacheService and DataApiService are globally mocked in tests/renderer.setup.ts
// Use MockCacheUtils and MockDataApiUtils for testing utilities

/**
 * Helper function to get persisted data from mock DataApiService calls
 * Finds the PATCH call for a specific message path and returns the body
 */
const getPersistedDataForMessage = (messageId: string) => {
  const patchCalls = MockDataApiUtils.getCalls('patch')
  // Find the last call for this message (most recent state)
  const matchingCalls = patchCalls.filter(([path]: [string]) => path === `/messages/${messageId}`)
  if (matchingCalls.length === 0) return undefined
  const lastCall = matchingCalls[matchingCalls.length - 1]
  return lastCall[1]?.body
}

vi.mock('@renderer/config/models', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    // Override functions that need mocking for tests
    getModelLogo: vi.fn(),
    isVisionModel: vi.fn(() => false),
    isFunctionCallingModel: vi.fn(() => false),
    isEmbeddingModel: vi.fn(() => false),
    isReasoningModel: vi.fn(() => false)
  }
})

vi.mock('@renderer/databases', () => ({
  default: {
    message_blocks: {
      bulkPut: vi.fn(),
      update: vi.fn(),
      bulkDelete: vi.fn(),
      put: vi.fn(),
      bulkAdd: vi.fn(),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          modify: vi.fn()
        }),
        anyOf: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([])
        })
      })
    },
    topics: {
      get: vi.fn(),
      update: vi.fn(),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          modify: vi.fn()
        })
      })
    },
    files: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          modify: vi.fn()
        })
      })
    },
    transaction: vi.fn((callback) => {
      if (typeof callback === 'function') {
        return callback()
      }
      return Promise.resolve()
    })
  }
}))

vi.mock('@renderer/services/FileManager', () => ({
  default: {
    deleteFile: vi.fn()
  }
}))

vi.mock('@renderer/services/NotificationService', () => ({
  NotificationService: {
    getInstance: vi.fn(() => ({
      send: vi.fn()
    }))
  }
}))

vi.mock('@renderer/services/db/DbService', () => ({
  DbService: {
    getInstance: vi.fn(() => ({
      createMessage: vi.fn(),
      updateMessage: vi.fn(),
      deleteMessage: vi.fn(),
      createBlock: vi.fn(),
      updateBlock: vi.fn(),
      deleteBlock: vi.fn(),
      createBlocks: vi.fn(),
      getMessageById: vi.fn(),
      getBlocksByMessageId: vi.fn()
    }))
  },
  dbService: {
    createMessage: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    createBlock: vi.fn(),
    updateBlock: vi.fn(),
    deleteBlock: vi.fn(),
    createBlocks: vi.fn(),
    getMessageById: vi.fn(),
    getBlocksByMessageId: vi.fn()
  }
}))

vi.mock('@renderer/services/EventService', () => ({
  EventEmitter: {
    emit: vi.fn(),
    on: vi.fn()
  },
  EVENT_NAMES: {
    MESSAGE_COMPLETE: 'MESSAGE_COMPLETE',
    SEND_MESSAGE: 'SEND_MESSAGE'
  }
}))

vi.mock('@renderer/utils/window', () => ({
  isOnHomePage: vi.fn(() => true),
  isFocused: vi.fn(() => true)
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  autoRenameTopic: vi.fn()
}))

vi.mock('@renderer/store/assistants', () => {
  const mockAssistantsSlice = {
    name: 'assistants',
    reducer: vi.fn((state = { entities: {}, ids: [] }) => state),
    actions: {
      updateTopicUpdatedAt: vi.fn(() => ({ type: 'UPDATE_TOPIC_UPDATED_AT' }))
    }
  }

  return {
    default: mockAssistantsSlice.reducer,
    updateTopicUpdatedAt: vi.fn(() => ({ type: 'UPDATE_TOPIC_UPDATED_AT' })),
    assistantsSlice: mockAssistantsSlice
  }
})

vi.mock('@renderer/services/TokenService', () => ({
  estimateMessagesUsage: vi.fn(() =>
    Promise.resolve({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150
    })
  )
}))

vi.mock('@renderer/utils/queue', () => ({
  getTopicQueue: vi.fn(() => ({
    add: vi.fn((task) => task())
  })),
  waitForTopicQueue: vi.fn()
}))

vi.mock('@renderer/utils/messageUtils/find', () => ({
  default: {},
  findMainTextBlocks: vi.fn(() => []),
  getMainTextContent: vi.fn(() => 'Test content'),
  findAllBlocks: vi.fn(() => [])
}))

vi.mock('i18next', () => {
  const mockI18n = {
    use: vi.fn().mockReturnThis(),
    init: vi.fn().mockResolvedValue(undefined),
    t: vi.fn((key) => key),
    changeLanguage: vi.fn().mockResolvedValue(undefined),
    language: 'en',
    languages: ['en', 'zh'],
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    store: {},
    services: {},
    options: {}
  }

  return {
    default: mockI18n,
    ...mockI18n
  }
})

vi.mock('@renderer/utils/error', () => ({
  formatErrorMessage: vi.fn((error) => error.message || 'Unknown error'),
  isAbortError: vi.fn((error) => error.name === 'AbortError'),
  serializeError: vi.fn((error) => ({
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause ? String(error.cause) : undefined
  }))
}))

vi.mock('@renderer/utils', () => ({
  default: {},
  uuid: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 11))
}))

interface MockTopicsState {
  entities: Record<string, unknown>
}

const reducer = combineReducers({
  messages: messagesSlice.reducer,
  messageBlocks: messageBlocksSlice.reducer,
  topics: (state: MockTopicsState = { entities: {} }) => state
})

const createMockStore = () => {
  return configureStore({
    reducer: reducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false })
  })
}

// Helper function to simulate processing chunks through the stream processor
const processChunks = async (chunks: Chunk[], callbacks: ReturnType<typeof createCallbacks>) => {
  const streamProcessor = createStreamProcessor(callbacks)

  const stream = new ReadableStream<Chunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    }
  })

  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) {
        break
      }

      if (chunk) {
        streamProcessor(chunk)

        // Add small delay to simulate real streaming
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
  } catch (error) {
    console.error('Error processing chunks:', error)
    throw error
  } finally {
    reader.releaseLock()
  }
}

describe('streamCallback Integration Tests', () => {
  let store: ReturnType<typeof createMockStore>
  // dispatch and getState are no longer needed after StreamingService refactoring

  const mockTopicId = 'test-topic-id'
  const mockAssistantMsgId = 'test-assistant-msg-id'
  const mockAssistant: Assistant = {
    id: 'test-assistant',
    name: 'Test Assistant',
    model: {
      id: 'test-model',
      name: 'Test Model'
    } as Model,
    prompt: '',
    enableWebSearch: false,
    enableGenerateImage: false,
    knowledge_bases: [],
    topics: [],
    type: 'test'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    MockCacheUtils.resetMocks()
    MockDataApiUtils.resetMocks()
    store = createMockStore()

    // Add initial message state for tests
    store.dispatch(
      messagesSlice.actions.addMessage({
        topicId: mockTopicId,
        message: {
          id: mockAssistantMsgId,
          assistantId: mockAssistant.id,
          role: 'assistant',
          topicId: mockTopicId,
          blocks: [],
          status: AssistantMessageStatus.PENDING,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      })
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle complete text streaming flow', async () => {
    const callbacks = createMockCallbacks(mockAssistantMsgId, mockTopicId, mockAssistant)

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.TEXT_START },
      { type: ChunkType.TEXT_DELTA, text: 'Hello ' },
      { type: ChunkType.TEXT_DELTA, text: 'Hello world!' },
      { type: ChunkType.TEXT_COMPLETE, text: 'Hello world!' },
      {
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: {
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          metrics: { completion_tokens: 50, time_completion_millsec: 1000 }
        }
      },
      {
        type: ChunkType.BLOCK_COMPLETE,
        response: {
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          metrics: { completion_tokens: 50, time_completion_millsec: 1000 }
        }
      }
    ]

    await processChunks(chunks, callbacks)

    // 验证持久化数据 (v2架构通过DataApiService持久化)
    const persistedData = getPersistedDataForMessage(mockAssistantMsgId) as {
      status?: string
      stats?: { totalTokens?: number }
      data?: { blocks?: Array<{ type: string; content?: string }> }
    }
    expect(persistedData).toBeDefined()

    // 验证blocks (data.blocks 格式)
    const blocks = persistedData?.data?.blocks || []
    expect(blocks.length).toBeGreaterThan(0)

    const textBlock = blocks.find((block) => block.type === 'main_text')
    expect(textBlock).toBeDefined()
    expect(textBlock?.content).toBe('Hello world!')

    // 验证消息状态更新
    expect(persistedData?.status).toBe('success')
    expect(persistedData?.stats?.totalTokens).toBe(150)
  })

  it('should handle thinking flow', async () => {
    const callbacks = createMockCallbacks(mockAssistantMsgId, mockTopicId, mockAssistant)

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.THINKING_START },
      { type: ChunkType.THINKING_DELTA, text: 'Let me think...', thinking_millsec: 1000 },
      { type: ChunkType.THINKING_DELTA, text: 'I need to consider...', thinking_millsec: 2000 },
      { type: ChunkType.THINKING_DELTA, text: 'Final thoughts', thinking_millsec: 3000 },
      { type: ChunkType.THINKING_COMPLETE, text: 'Final thoughts' },
      { type: ChunkType.BLOCK_COMPLETE }
    ]

    await processChunks(chunks, callbacks)

    // 验证持久化数据 (v2架构通过DataApiService持久化)
    const persistedData = getPersistedDataForMessage(mockAssistantMsgId) as {
      data?: { blocks?: Array<{ type: string; content?: string; thinking_millsec?: number }> }
    }
    expect(persistedData).toBeDefined()

    const blocks = persistedData?.data?.blocks || []
    const thinkingBlock = blocks.find((block) => block.type === 'thinking')
    expect(thinkingBlock).toBeDefined()
    expect(thinkingBlock?.content).toBe('Final thoughts')
    // thinking_millsec 现在是本地计算的，只验证它存在且是一个合理的数字
    expect(thinkingBlock?.thinking_millsec).toBeDefined()
    expect(typeof thinkingBlock?.thinking_millsec).toBe('number')
    expect(thinkingBlock?.thinking_millsec).toBeGreaterThanOrEqual(0)
  })

  it('should handle tool call flow', async () => {
    const callbacks = createMockCallbacks(mockAssistantMsgId, mockTopicId, mockAssistant)

    const mockTool: MCPTool = {
      id: 'tool-1',
      serverId: 'server-1',
      serverName: 'Test Server',
      name: 'test-tool',
      description: 'Test tool',
      inputSchema: {
        type: 'object',
        title: 'Test Tool Input',
        properties: {}
      },
      type: 'mcp'
    }

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      {
        type: ChunkType.MCP_TOOL_PENDING,
        responses: [
          {
            id: 'tool-call-1',
            tool: mockTool,
            arguments: { testArg: 'value' },
            status: 'pending' as const,
            response: ''
          }
        ]
      },
      // {
      //   type: ChunkType.MCP_TOOL_PENDING,
      //   responses: [
      //     {
      //       id: 'tool-call-1',
      //       tool: mockTool,
      //       arguments: { testArg: 'value' },
      //       status: 'invoking' as const,
      //       response: ''
      //     }
      //   ]
      // },
      {
        type: ChunkType.MCP_TOOL_COMPLETE,
        responses: [
          {
            id: 'tool-call-1',
            tool: mockTool,
            arguments: { testArg: 'value' },
            status: 'done' as const,
            response: 'Tool result'
          }
        ]
      },
      { type: ChunkType.BLOCK_COMPLETE }
    ]

    await processChunks(chunks, callbacks)

    // 验证持久化数据
    const persistedData = getPersistedDataForMessage(mockAssistantMsgId) as {
      data?: { blocks?: Array<{ type: string; content?: string; toolName?: string }> }
    }
    expect(persistedData).toBeDefined()

    const blocks = persistedData?.data?.blocks || []
    const toolBlock = blocks.find((block) => block.type === 'tool')
    expect(toolBlock).toBeDefined()
    expect(toolBlock?.content).toBe('Tool result')
    expect(toolBlock?.toolName).toBe('test-tool')
  })

  it('should handle image generation flow', async () => {
    const callbacks = createMockCallbacks(mockAssistantMsgId, mockTopicId, mockAssistant)

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.IMAGE_CREATED },
      {
        type: ChunkType.IMAGE_DELTA,
        image: {
          type: 'base64',
          images: [
            'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAFwAAAwEAAAAAAAAAAAAAAAAAAQMEB//EACMQAAIBAwMEAwAAAAAAAAAAAAECAwAEEQUSIQYxQVExUYH/xAAVAQEBAAAAAAAAAAAAAAAAAAAAAf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AM/8A//Z'
          ]
        }
      },
      {
        type: ChunkType.IMAGE_COMPLETE,
        image: {
          type: 'base64',
          images: [
            'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAFwAAAwEAAAAAAAAAAAAAAAAAAQMEB//EACMQAAIBAwMEAwAAAAAAAAAAAAECAwAEEQUSIQYxQVExUYH/xAAVAQEBAAAAAAAAAAAAAAAAAAAAAf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AM/8A//Z'
          ]
        }
      },
      { type: ChunkType.BLOCK_COMPLETE }
    ]

    await processChunks(chunks, callbacks)

    // 验证持久化数据
    const persistedData = getPersistedDataForMessage(mockAssistantMsgId) as {
      data?: { blocks?: Array<{ type: string; url?: string }> }
    }
    expect(persistedData).toBeDefined()

    const blocks = persistedData?.data?.blocks || []
    const imageBlock = blocks.find((block) => block.type === 'image')
    expect(imageBlock).toBeDefined()
    expect(imageBlock?.url).toBe(
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAFwAAAwEAAAAAAAAAAAAAAAAAAQMEB//EACMQAAIBAwMEAwAAAAAAAAAAAAECAwAEEQUSIQYxQVExUYH/xAAVAQEBAAAAAAAAAAAAAAAAAAAAAf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AM/8A//Z'
    )
  })

  it('should handle web search flow', async () => {
    const callbacks = createMockCallbacks(mockAssistantMsgId, mockTopicId, mockAssistant)

    const mockWebSearchResult = {
      source: WEB_SEARCH_SOURCE.WEBSEARCH,
      results: [{ title: 'Test Result', url: 'http://example.com', snippet: 'Test snippet' }]
    }

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.LLM_WEB_SEARCH_IN_PROGRESS },
      { type: ChunkType.LLM_WEB_SEARCH_COMPLETE, llm_web_search: mockWebSearchResult },
      { type: ChunkType.BLOCK_COMPLETE }
    ]

    await processChunks(chunks, callbacks)

    // 验证持久化数据
    const persistedData = getPersistedDataForMessage(mockAssistantMsgId) as {
      data?: { blocks?: Array<{ type: string; response?: { source?: string } }> }
    }
    expect(persistedData).toBeDefined()

    const blocks = persistedData?.data?.blocks || []
    const citationBlock = blocks.find((block) => block.type === 'citation')
    expect(citationBlock).toBeDefined()
    expect(citationBlock?.response?.source).toEqual(mockWebSearchResult.source)
  })

  it('should handle mixed content flow (thinking + tool + text)', async () => {
    const callbacks = createMockCallbacks(mockAssistantMsgId, mockTopicId, mockAssistant)

    const mockCalculatorTool: MCPTool = {
      id: 'tool-1',
      serverId: 'server-1',
      serverName: 'Test Server',
      name: 'calculator',
      description: 'Calculator tool',
      inputSchema: {
        type: 'object',
        title: 'Calculator Input',
        properties: {}
      },
      type: 'mcp'
    }

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },

      // 思考阶段
      { type: ChunkType.THINKING_START },
      { type: ChunkType.THINKING_DELTA, text: 'Let me calculate this...', thinking_millsec: 1000 },
      {
        type: ChunkType.THINKING_DELTA,
        text: 'Let me calculate this..., I need to use a calculator',
        thinking_millsec: 1000
      },
      {
        type: ChunkType.THINKING_COMPLETE,
        text: 'Let me calculate this..., I need to use a calculator',
        thinking_millsec: 2000
      },

      // 工具调用阶段
      {
        type: ChunkType.MCP_TOOL_PENDING,
        responses: [
          {
            id: 'tool-call-1',
            tool: mockCalculatorTool,
            arguments: { operation: 'add', a: 1, b: 2 },
            status: 'pending' as const,
            response: ''
          }
        ]
      },
      // {
      //   type: ChunkType.MCP_TOOL_PENDING,
      //   responses: [
      //     {
      //       id: 'tool-call-1',
      //       tool: mockCalculatorTool,
      //       arguments: { operation: 'add', a: 1, b: 2 },
      //       status: 'invoking' as const,
      //       response: ''
      //     }
      //   ]
      // },
      {
        type: ChunkType.MCP_TOOL_COMPLETE,
        responses: [
          {
            id: 'tool-call-1',
            tool: mockCalculatorTool,
            arguments: { operation: 'add', a: 1, b: 2 },
            status: 'done' as const,
            response: '42'
          }
        ]
      },

      // 文本响应阶段
      { type: ChunkType.TEXT_START },
      { type: ChunkType.TEXT_DELTA, text: 'The answer is ' },
      { type: ChunkType.TEXT_DELTA, text: '42' },
      { type: ChunkType.TEXT_COMPLETE, text: 'The answer is 42' },

      { type: ChunkType.BLOCK_COMPLETE }
    ]

    await processChunks(chunks, callbacks)

    // 验证持久化数据
    const persistedData = getPersistedDataForMessage(mockAssistantMsgId) as {
      data?: { blocks?: Array<{ type: string; content?: string }> }
    }
    expect(persistedData).toBeDefined()

    const blocks = persistedData?.data?.blocks || []
    expect(blocks.length).toBeGreaterThan(2) // 至少有思考块、工具块、文本块

    const thinkingBlock = blocks.find((block) => block.type === 'thinking')
    expect(thinkingBlock?.content).toBe('Let me calculate this..., I need to use a calculator')

    const toolBlock = blocks.find((block) => block.type === 'tool')
    expect(toolBlock?.content).toBe('42')

    const textBlock = blocks.find((block) => block.type === 'main_text')
    expect(textBlock?.content).toBe('The answer is 42')
  })

  it('should handle error flow', async () => {
    const callbacks = createMockCallbacks(mockAssistantMsgId, mockTopicId, mockAssistant)

    const mockError = new Error('Test error')

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.TEXT_START },
      { type: ChunkType.TEXT_DELTA, text: 'Hello ' },
      { type: ChunkType.ERROR, error: mockError }
    ]

    await processChunks(chunks, callbacks)

    // 验证持久化数据
    const persistedData = getPersistedDataForMessage(mockAssistantMsgId) as {
      status?: string
      data?: { blocks?: Array<{ type: string; error?: { message: string } }> }
    }
    expect(persistedData).toBeDefined()

    const blocks = persistedData?.data?.blocks || []
    expect(blocks.length).toBeGreaterThan(0)

    const errorBlock = blocks.find((block) => block.type === 'error')
    expect(errorBlock).toBeDefined()
    expect(errorBlock?.error?.message).toBe('Test error')

    // 验证消息状态更新
    expect(persistedData?.status).toBe('error')
  })

  it('should handle external tool flow', async () => {
    const callbacks = createMockCallbacks(mockAssistantMsgId, mockTopicId, mockAssistant)

    const mockExternalToolResult: ExternalToolResult = {
      webSearch: {
        source: WEB_SEARCH_SOURCE.WEBSEARCH,
        results: [{ title: 'External Result', url: 'http://external.com', snippet: 'External snippet' }]
      },
      knowledge: [
        {
          id: 1,
          content: 'Knowledge content',
          sourceUrl: 'http://external.com',
          type: 'url'
        }
      ]
    }

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.EXTERNEL_TOOL_IN_PROGRESS },
      { type: ChunkType.EXTERNEL_TOOL_COMPLETE, external_tool: mockExternalToolResult },
      { type: ChunkType.BLOCK_COMPLETE }
    ]

    await processChunks(chunks, callbacks)

    // 验证持久化数据
    const persistedData = getPersistedDataForMessage(mockAssistantMsgId) as {
      data?: { blocks?: Array<{ type: string; response?: unknown; knowledge?: unknown }> }
    }
    expect(persistedData).toBeDefined()

    const blocks = persistedData?.data?.blocks || []
    const citationBlock = blocks.find((block) => block.type === 'citation')
    expect(citationBlock).toBeDefined()
    expect(citationBlock?.response).toEqual(mockExternalToolResult.webSearch)
    expect(citationBlock?.knowledge).toEqual(mockExternalToolResult.knowledge)
  })

  it('should handle abort error correctly', async () => {
    const callbacks = createMockCallbacks(mockAssistantMsgId, mockTopicId, mockAssistant)

    // 创建一个模拟的 abort 错误
    const abortError = new Error('Request aborted')
    abortError.name = 'AbortError'

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.TEXT_START },
      { type: ChunkType.TEXT_DELTA, text: 'Partial text...' },
      { type: ChunkType.ERROR, error: abortError }
    ]

    await processChunks(chunks, callbacks)

    // 验证持久化数据
    const persistedData = getPersistedDataForMessage(mockAssistantMsgId) as {
      status?: string
      data?: { blocks?: Array<{ type: string }> }
    }
    expect(persistedData).toBeDefined()

    const blocks = persistedData?.data?.blocks || []
    expect(blocks.length).toBeGreaterThan(0)

    const errorBlock = blocks.find((block) => block.type === 'error')
    expect(errorBlock).toBeDefined()

    // 验证消息状态更新为成功（因为是暂停，不是真正的错误）
    expect(persistedData?.status).toBe('success')
  })

  it('should maintain block reference integrity during streaming', async () => {
    const callbacks = createMockCallbacks(mockAssistantMsgId, mockTopicId, mockAssistant)

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.TEXT_START },
      { type: ChunkType.TEXT_DELTA, text: 'First chunk' },
      { type: ChunkType.TEXT_DELTA, text: 'Second chunk' },
      { type: ChunkType.TEXT_COMPLETE, text: 'First chunkSecond chunk' },
      { type: ChunkType.BLOCK_COMPLETE }
    ]

    await processChunks(chunks, callbacks)

    // 验证持久化数据
    const persistedData = getPersistedDataForMessage(mockAssistantMsgId) as {
      data?: { blocks?: Array<{ type: string; content?: string }> }
    }
    expect(persistedData).toBeDefined()

    const blocks = persistedData?.data?.blocks || []

    // 验证blocks包含正确的内容
    expect(blocks.length).toBeGreaterThan(0)

    // 验证有main_text block
    const textBlock = blocks.find((block) => block.type === 'main_text')
    expect(textBlock).toBeDefined()
    expect(textBlock?.content).toBe('First chunkSecond chunk')
  })
})
