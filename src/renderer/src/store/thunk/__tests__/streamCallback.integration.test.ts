import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { createStreamProcessor } from '@renderer/services/StreamProcessingService'
import type { AppDispatch } from '@renderer/store'
import { messageBlocksSlice } from '@renderer/store/messageBlock'
import { messagesSlice } from '@renderer/store/newMessage'
import { streamCallback } from '@renderer/store/thunk/messageThunk'
import type { Assistant, ExternalToolResult, MCPTool, Model } from '@renderer/types'
import { WebSearchSource } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RootState } from '../../index'

// Mock external dependencies
vi.mock('@renderer/config/models', () => ({
  SYSTEM_MODELS: {
    defaultModel: [{}, {}, {}],
    silicon: [],
    aihubmix: [],
    ocoolai: [],
    deepseek: [],
    ppio: [],
    alayanew: [],
    qiniu: [],
    dmxapi: [],
    burncloud: [],
    tokenflux: [],
    '302ai': [],
    cephalon: [],
    lanyun: [],
    ph8: [],
    openrouter: [],
    ollama: [],
    'new-api': [],
    lmstudio: [],
    anthropic: [],
    openai: [],
    'azure-openai': [],
    gemini: [],
    vertexai: [],
    github: [],
    copilot: [],
    zhipu: [],
    yi: [],
    moonshot: [],
    baichuan: [],
    dashscope: [],
    stepfun: [],
    doubao: [],
    infini: [],
    minimax: [],
    groq: [],
    together: [],
    fireworks: [],
    nvidia: [],
    grok: [],
    hyperbolic: [],
    mistral: [],
    jina: [],
    perplexity: [],
    modelscope: [],
    xirang: [],
    hunyuan: [],
    'tencent-cloud-ti': [],
    'baidu-cloud': [],
    gpustack: [],
    voyageai: []
  },
  getModelLogo: vi.fn(),
  isVisionModel: vi.fn(() => false),
  isFunctionCallingModel: vi.fn(() => false),
  isEmbeddingModel: vi.fn(() => false),
  isReasoningModel: vi.fn(() => false)
  // ... 其他需要用到的函数也可以在这里 mock
}))

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

vi.mock('@renderer/services/EventService', () => ({
  EventEmitter: {
    emit: vi.fn()
  },
  EVENT_NAMES: {
    MESSAGE_COMPLETE: 'MESSAGE_COMPLETE'
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
  getMainTextContent: vi.fn(() => 'Test content')
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
  isAbortError: vi.fn((error) => error.name === 'AbortError')
}))

vi.mock('@renderer/utils', () => ({
  default: {},
  uuid: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substr(2, 9))
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
const processChunks = async (chunks: Chunk[], callbacks: ReturnType<typeof streamCallback>) => {
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
  let dispatch: AppDispatch
  let getState: () => ReturnType<typeof reducer> & RootState

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
    store = createMockStore()
    dispatch = store.dispatch
    getState = store.getState as () => ReturnType<typeof reducer> & RootState

    // 为测试消息添加初始状态
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
    const callbacks = streamCallback(dispatch, getState, mockTopicId, mockAssistant, mockAssistantMsgId)

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

    // 验证 Redux 状态
    const state = getState()
    const blocks = Object.values(state.messageBlocks.entities)
    expect(blocks.length).toBeGreaterThan(0)

    const textBlock = blocks.find((block) => block.type === MessageBlockType.MAIN_TEXT)
    expect(textBlock).toBeDefined()
    expect(textBlock?.content).toBe('Hello world!')
    expect(textBlock?.status).toBe(MessageBlockStatus.SUCCESS)

    // 验证消息状态更新
    const message = state.messages.entities[mockAssistantMsgId]
    expect(message?.status).toBe(AssistantMessageStatus.SUCCESS)
    expect(message?.usage?.total_tokens).toBe(150)
  })

  it('should handle thinking flow', async () => {
    const callbacks = streamCallback(dispatch, getState, mockTopicId, mockAssistant, mockAssistantMsgId)

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.THINKING_START },
      { type: ChunkType.THINKING_DELTA, text: 'Let me think...', thinking_millsec: 1000 },
      { type: ChunkType.THINKING_DELTA, text: 'I need to consider...', thinking_millsec: 2000 },
      { type: ChunkType.THINKING_COMPLETE, text: 'Final thoughts', thinking_millsec: 3000 },
      { type: ChunkType.BLOCK_COMPLETE }
    ]

    await processChunks(chunks, callbacks)

    // 验证 Redux 状态
    const state = getState()
    const blocks = Object.values(state.messageBlocks.entities)

    const thinkingBlock = blocks.find((block) => block.type === MessageBlockType.THINKING)
    expect(thinkingBlock).toBeDefined()
    expect(thinkingBlock?.content).toBe('Final thoughts')
    expect(thinkingBlock?.status).toBe(MessageBlockStatus.SUCCESS)
    expect((thinkingBlock as any)?.thinking_millsec).toBe(3000)
  })

  it('should handle tool call flow', async () => {
    const callbacks = streamCallback(dispatch, getState, mockTopicId, mockAssistant, mockAssistantMsgId)

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
      }
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
      {
        type: ChunkType.MCP_TOOL_IN_PROGRESS,
        responses: [
          {
            id: 'tool-call-1',
            tool: mockTool,
            arguments: { testArg: 'value' },
            status: 'invoking' as const,
            response: ''
          }
        ]
      },
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

    // 验证 Redux 状态
    const state = getState()
    const blocks = Object.values(state.messageBlocks.entities)

    const toolBlock = blocks.find((block) => block.type === MessageBlockType.TOOL)
    expect(toolBlock).toBeDefined()
    expect(toolBlock?.content).toBe('Tool result')
    expect(toolBlock?.status).toBe(MessageBlockStatus.SUCCESS)
    expect((toolBlock as any)?.toolName).toBe('test-tool')
  })

  it('should handle image generation flow', async () => {
    const callbacks = streamCallback(dispatch, getState, mockTopicId, mockAssistant, mockAssistantMsgId)

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

    // 验证 Redux 状态
    const state = getState()
    const blocks = Object.values(state.messageBlocks.entities)
    const imageBlock = blocks.find((block) => block.type === MessageBlockType.IMAGE)
    expect(imageBlock).toBeDefined()
    expect(imageBlock?.url).toBe(
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAFwAAAwEAAAAAAAAAAAAAAAAAAQMEB//EACMQAAIBAwMEAwAAAAAAAAAAAAECAwAEEQUSIQYxQVExUYH/xAAVAQEBAAAAAAAAAAAAAAAAAAAAAf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AM/8A//Z'
    )
    expect(imageBlock?.status).toBe(MessageBlockStatus.SUCCESS)
  })

  it('should handle web search flow', async () => {
    const callbacks = streamCallback(dispatch, getState, mockTopicId, mockAssistant, mockAssistantMsgId)

    const mockWebSearchResult = {
      source: WebSearchSource.WEBSEARCH,
      results: [{ title: 'Test Result', url: 'http://example.com', snippet: 'Test snippet' }]
    }

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.LLM_WEB_SEARCH_IN_PROGRESS },
      { type: ChunkType.LLM_WEB_SEARCH_COMPLETE, llm_web_search: mockWebSearchResult },
      { type: ChunkType.BLOCK_COMPLETE }
    ]

    await processChunks(chunks, callbacks)

    // 验证 Redux 状态
    const state = getState()
    const blocks = Object.values(state.messageBlocks.entities)

    const citationBlock = blocks.find((block) => block.type === MessageBlockType.CITATION)
    expect(citationBlock).toBeDefined()
    expect(citationBlock?.response?.source).toEqual(mockWebSearchResult.source)
    expect(citationBlock?.status).toBe(MessageBlockStatus.SUCCESS)
  })

  it('should handle mixed content flow (thinking + tool + text)', async () => {
    const callbacks = streamCallback(dispatch, getState, mockTopicId, mockAssistant, mockAssistantMsgId)

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
      }
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
      {
        type: ChunkType.MCP_TOOL_IN_PROGRESS,
        responses: [
          {
            id: 'tool-call-1',
            tool: mockCalculatorTool,
            arguments: { operation: 'add', a: 1, b: 2 },
            status: 'invoking' as const,
            response: ''
          }
        ]
      },
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

    // 验证 Redux 状态
    const state = getState()
    const blocks = Object.values(state.messageBlocks.entities)

    expect(blocks.length).toBeGreaterThan(2) // 至少有思考块、工具块、文本块

    const thinkingBlock = blocks.find((block) => block.type === MessageBlockType.THINKING)
    expect(thinkingBlock?.content).toBe('Let me calculate this..., I need to use a calculator')
    expect(thinkingBlock?.status).toBe(MessageBlockStatus.SUCCESS)

    const toolBlock = blocks.find((block) => block.type === MessageBlockType.TOOL)
    expect(toolBlock?.content).toBe('42')
    expect(toolBlock?.status).toBe(MessageBlockStatus.SUCCESS)

    const textBlock = blocks.find((block) => block.type === MessageBlockType.MAIN_TEXT)
    expect(textBlock?.content).toBe('The answer is 42')
    expect(textBlock?.status).toBe(MessageBlockStatus.SUCCESS)
  })

  it('should handle error flow', async () => {
    const callbacks = streamCallback(dispatch, getState, mockTopicId, mockAssistant, mockAssistantMsgId)

    const mockError = new Error('Test error')

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.TEXT_START },
      { type: ChunkType.TEXT_DELTA, text: 'Hello ' },
      { type: ChunkType.ERROR, error: mockError }
    ]

    await processChunks(chunks, callbacks)

    // 验证 Redux 状态
    const state = getState()
    const blocks = Object.values(state.messageBlocks.entities)

    expect(blocks.length).toBeGreaterThan(0)

    const errorBlock = blocks.find((block) => block.type === MessageBlockType.ERROR)
    expect(errorBlock).toBeDefined()
    expect(errorBlock?.status).toBe(MessageBlockStatus.SUCCESS)
    expect((errorBlock as any)?.error?.message).toBe('Test error')

    // 验证消息状态更新
    const message = state.messages.entities[mockAssistantMsgId]
    expect(message?.status).toBe(AssistantMessageStatus.ERROR)
  })

  it('should handle external tool flow', async () => {
    const callbacks = streamCallback(dispatch, getState, mockTopicId, mockAssistant, mockAssistantMsgId)

    const mockExternalToolResult: ExternalToolResult = {
      webSearch: {
        source: WebSearchSource.WEBSEARCH,
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

    // 验证 Redux 状态
    const state = getState()
    const blocks = Object.values(state.messageBlocks.entities)

    const citationBlock = blocks.find((block) => block.type === MessageBlockType.CITATION)
    expect(citationBlock).toBeDefined()
    expect((citationBlock as any)?.response).toEqual(mockExternalToolResult.webSearch)
    expect((citationBlock as any)?.knowledge).toEqual(mockExternalToolResult.knowledge)
    expect(citationBlock?.status).toBe(MessageBlockStatus.SUCCESS)
  })

  it('should handle abort error correctly', async () => {
    const callbacks = streamCallback(dispatch, getState, mockTopicId, mockAssistant, mockAssistantMsgId)

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

    // 验证 Redux 状态
    const state = getState()
    const blocks = Object.values(state.messageBlocks.entities)

    expect(blocks.length).toBeGreaterThan(0)

    const errorBlock = blocks.find((block) => block.type === MessageBlockType.ERROR)
    expect(errorBlock).toBeDefined()
    expect(errorBlock?.status).toBe(MessageBlockStatus.SUCCESS)

    // 验证消息状态更新为成功（因为是暂停，不是真正的错误）
    const message = state.messages.entities[mockAssistantMsgId]
    expect(message?.status).toBe(AssistantMessageStatus.SUCCESS)
  })

  it('should maintain block reference integrity during streaming', async () => {
    const callbacks = streamCallback(dispatch, getState, mockTopicId, mockAssistant, mockAssistantMsgId)

    const chunks: Chunk[] = [
      { type: ChunkType.LLM_RESPONSE_CREATED },
      { type: ChunkType.TEXT_START },
      { type: ChunkType.TEXT_DELTA, text: 'First chunk' },
      { type: ChunkType.TEXT_DELTA, text: 'Second chunk' },
      { type: ChunkType.TEXT_COMPLETE, text: 'First chunkSecond chunk' },
      { type: ChunkType.BLOCK_COMPLETE }
    ]

    await processChunks(chunks, callbacks)

    // 验证 Redux 状态
    const state = getState()
    const blocks = Object.values(state.messageBlocks.entities)
    const message = state.messages.entities[mockAssistantMsgId]

    // 验证消息的 blocks 数组包含正确的块ID
    expect(message?.blocks).toBeDefined()
    expect(message?.blocks?.length).toBeGreaterThan(0)

    // 验证所有块都存在于 messageBlocks 状态中
    message?.blocks?.forEach((blockId) => {
      const block = state.messageBlocks.entities[blockId]
      expect(block).toBeDefined()
      expect(block?.messageId).toBe(mockAssistantMsgId)
    })

    // 验证blocks包含正确的内容
    expect(blocks.length).toBeGreaterThan(0)
  })
})
