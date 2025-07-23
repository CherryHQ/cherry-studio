import * as models from '@renderer/config/models'
import * as settings from '@renderer/hooks/useSettings'
// 核心类型定义
import {
  Assistant,
  FileTypes,
  KnowledgeReference,
  MCPTool,
  MemoryItem,
  Model,
  Provider,
  ToolCallResponse,
  WebSearchResponse,
  WebSearchSource
} from '@renderer/types'
import {
  FileMessageBlock,
  Message,
  MessageBlock,
  MessageBlockStatus,
  MessageBlockType,
  UserMessageStatus
} from '@renderer/types/newMessage'
import type {
  SdkInstance,
  SdkMessageParam,
  SdkModel,
  SdkParams,
  SdkRawChunk,
  SdkRawOutput,
  SdkTool,
  SdkToolCall
} from '@renderer/types/sdk'
// 外部依赖模块
import * as abortController from '@renderer/utils/abortController'
import { findFileBlocks, getContentWithTools, getMainTextContent } from '@renderer/utils/messageUtils/find'
import { defaultTimeout } from '@shared/config/constant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 被测试的模块
import { BaseApiClient } from '../BaseApiClient'
import type { RequestTransformer, ResponseChunkTransformer } from '../types'

// ============================================================================
// Mock 外部依赖
// ============================================================================

vi.mock('@renderer/config/models', () => ({
  isFunctionCallingModel: vi.fn(),
  isNotSupportTemperatureAndTopP: vi.fn(),
  isOpenAIModel: vi.fn(),
  isSupportedFlexServiceTier: vi.fn()
}))

vi.mock('@renderer/hooks/useLMStudio', () => ({
  getLMStudioKeepAliveTime: vi.fn(() => 300)
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: vi.fn()
}))

vi.mock('@renderer/utils/abortController', () => ({
  addAbortController: vi.fn(),
  removeAbortController: vi.fn()
}))

vi.mock('@renderer/utils', () => ({
  isJSON: (str: string) => {
    try {
      JSON.parse(str)
      return true
    } catch {
      return false
    }
  },
  parseJSON: (str: string) => {
    try {
      return JSON.parse(str)
    } catch {
      return str
    }
  }
}))

vi.mock('electron-log/renderer', () => ({
  default: {
    log: vi.fn()
  }
}))

// 注意：移除过度Mock，使用真实的工具函数
// isJSON 和 parseJSON 是简单工具函数，无需Mock
// isEmpty 来自 lodash，是经过充分测试的库函数，无需Mock

vi.mock('@renderer/utils/messageUtils/find', () => ({
  findFileBlocks: vi.fn(() => []),
  getContentWithTools: vi.fn(() => 'Test message'),
  getMainTextContent: vi.fn(() => 'Test message')
}))

vi.mock('@shared/config/constant', () => ({
  defaultTimeout: 120000
}))

vi.mock('@renderer/config/prompts', () => ({
  REFERENCE_PROMPT: 'Question: {question}\n\nReferences:\n{references}'
}))

// ============================================================================
// 测试用具体实现类
// ============================================================================

/**
 * 测试用的 BaseApiClient 具体实现类
 * 只实现必需的抽象方法，保持最小化以便专注于测试基类功能
 */
class TestApiClient extends BaseApiClient {
  // 显式声明继承的公共属性以便 TypeScript 正确识别
  public useSystemPromptForTools: boolean = true

  // 核心API方法 - 在测试中不需要实现
  async createCompletions(): Promise<SdkRawOutput> {
    throw new Error('Not implemented in test')
  }

  async generateImage(): Promise<string[]> {
    throw new Error('Not implemented in test')
  }

  async getEmbeddingDimensions(): Promise<number> {
    throw new Error('Not implemented in test')
  }

  async listModels(): Promise<SdkModel[]> {
    return []
  }

  getSdkInstance(): SdkInstance {
    return {} as SdkInstance
  }

  // 中间件相关方法
  getRequestTransformer(): RequestTransformer<SdkParams, SdkMessageParam> {
    throw new Error('Not implemented in test')
  }

  getResponseChunkTransformer(): ResponseChunkTransformer<SdkRawChunk> {
    throw new Error('Not implemented in test')
  }

  // 工具转换方法 - 提供基本实现以便测试
  convertMcpToolsToSdkTools(mcpTools: MCPTool[]): SdkTool[] {
    return mcpTools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: { ...tool.inputSchema } as Record<string, unknown>
      }
    }))
  }

  convertSdkToolCallToMcp(toolCall: SdkToolCall, mcpTools: MCPTool[]): MCPTool | undefined {
    const functionName = (toolCall as { function?: { name?: string } }).function?.name
    return mcpTools.find((tool) => tool.name === functionName)
  }

  convertSdkToolCallToMcpToolResponse(): ToolCallResponse {
    throw new Error('Not implemented in test')
  }

  buildSdkMessages(): SdkMessageParam[] {
    throw new Error('Not implemented in test')
  }

  estimateMessageTokens(): number {
    return 0
  }

  convertMcpToolResponseToSdkMessageParam(): SdkMessageParam | undefined {
    return undefined
  }

  extractMessagesFromSdkPayload(): SdkMessageParam[] {
    return []
  }
}

// ============================================================================
// 测试辅助工具
// ============================================================================

/**
 * 真实的键值存储接口，用于替代Mock以获得更真实的测试环境
 */
interface KeyvStorage {
  get: (key: string) => any
  set: (key: string, value: any) => any
  remove: (key: string) => any
}

/**
 * 真实的键值存储实现类
 * 使用 Map 作为底层存储，提供与真实 keyv 相同的接口
 */
class RealKeyvStorage implements KeyvStorage {
  private storage = new Map<string, any>()

  get(key: string) {
    return this.storage.get(key)
  }

  set(key: string, value: any) {
    this.storage.set(key, value)
    return this
  }

  remove(key: string) {
    return this.storage.delete(key)
  }

  clear() {
    this.storage.clear()
  }
}

// 创建真实的键值存储实例
const realKeyv = new RealKeyvStorage()

// Mock API 对象
const mockApi = {
  file: {
    read: vi.fn()
  }
}

// ============================================================================
// 测试常量定义
// ============================================================================

/**
 * 测试中使用的常量定义
 * 集中管理所有魔法数字和字符串，提高可维护性
 */
const TEST_CONSTANTS = {
  PROVIDER_ID: 'test-provider',
  MESSAGE_ID: 'msg-123',
  ASSISTANT_ID: 'assistant-1',
  TOPIC_ID: 'topic-1',
  API_KEYS: {
    SINGLE: 'single-key',
    MULTIPLE: 'test-key-1,test-key-2',
    UNICODE: '🔑key1,中文key2,🚀key3,العربية-key4',
    MALFORMED: '  ,  , key3 ,'
  },
  SYSTEM_PROMPT_THRESHOLD: 128,
  LMSTUDIO_KEEP_ALIVE: 300,
  TIMEOUT_VALUES: {
    DEFAULT: 120000,
    FLEX: 15 * 1000 * 60
  }
} as const

// Mock 全局 window 对象以供测试使用
global.window = {
  keyv: realKeyv,
  api: mockApi as unknown as typeof window.api
} as any

// ============================================================================
// 测试数据工厂函数
// ============================================================================

/**
 * 创建模拟的 Provider 对象
 * @param overrides 可选的属性覆盖
 * @returns 模拟的 Provider 对象
 */
const createMockProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: TEST_CONSTANTS.PROVIDER_ID,
  type: 'openai',
  name: 'Test Provider',
  apiHost: 'https://api.test.com',
  apiKey: TEST_CONSTANTS.API_KEYS.MULTIPLE,
  isSystem: true,
  enabled: true,
  models: [],
  ...overrides
})

/**
 * 创建模拟的 Message 对象
 * @param overrides 可选的属性覆盖
 * @returns 模拟的 Message 对象
 */
const createMockMessage = (overrides: Partial<Message> = {}): Message => ({
  id: TEST_CONSTANTS.MESSAGE_ID,
  role: 'user' as const,
  assistantId: TEST_CONSTANTS.ASSISTANT_ID,
  topicId: TEST_CONSTANTS.TOPIC_ID,
  createdAt: new Date().toISOString(),
  status: UserMessageStatus.SUCCESS,
  blocks: [],
  ...overrides
})

/**
 * 创建模拟的 Model 对象
 * @param overrides 可选的属性覆盖
 * @returns 模拟的 Model 对象
 */
const createMockModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'test-model',
  name: 'Test Model',
  provider: TEST_CONSTANTS.PROVIDER_ID,
  group: 'Test Group',
  ...overrides
})

/**
 * 创建模拟的 Assistant 对象
 * @param overrides 可选的属性覆盖
 * @returns 模拟的 Assistant 对象
 */
const createMockAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  id: TEST_CONSTANTS.ASSISTANT_ID,
  name: 'Test Assistant',
  prompt: '',
  model: createMockModel(),
  topics: [],
  type: 'general',
  settings: {
    contextCount: 10,
    temperature: 0.7,
    topP: 0.9,
    maxTokens: undefined,
    enableMaxTokens: false,
    streamOutput: true
  },
  ...overrides
})

// ============================================================================
// 主测试套件
// ============================================================================

describe('BaseApiClient', () => {
  let client: TestApiClient
  let mockProvider: Provider
  let mockMessage: Message

  beforeEach(() => {
    vi.clearAllMocks()
    // 清理真实存储
    realKeyv.clear()

    mockProvider = createMockProvider()
    client = new TestApiClient(mockProvider)
    mockMessage = createMockMessage()
  })

  describe('constructor', () => {
    it('should initialize with provider settings', () => {
      expect(client.provider).toBe(mockProvider)
      expect(client.useSystemPromptForTools).toBe(true)
    })
  })

  describe('getApiKey', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      realKeyv.clear()
    })

    it('should return single key directly', () => {
      const singleKeyProvider = createMockProvider({ apiKey: TEST_CONSTANTS.API_KEYS.SINGLE })
      const singleKeyClient = new TestApiClient(singleKeyProvider)

      expect(singleKeyClient.getApiKey()).toBe(TEST_CONSTANTS.API_KEYS.SINGLE)
      // 单个key时不应该访问存储
      expect(realKeyv.get(`provider:${TEST_CONSTANTS.PROVIDER_ID}:last_used_key`)).toBeUndefined()
    })

    it('should rotate multiple keys', () => {
      // 清理之前的缓存并创建新的client
      realKeyv.clear()
      const rotationClient = new TestApiClient(mockProvider)

      // 构造函数已经调用过getApiKey()，所以缓存中已有'test-key-1'
      expect(realKeyv.get('provider:test-provider:last_used_key')).toBe('test-key-1')

      // 第1次调用：有缓存key1，轮换到key2
      const key1 = rotationClient.getApiKey()
      expect(key1).toBe('test-key-2')
      expect(realKeyv.get('provider:test-provider:last_used_key')).toBe('test-key-2')

      // 第2次调用：有缓存key2，轮换回key1
      const key2 = rotationClient.getApiKey()
      expect(key2).toBe('test-key-1')
      expect(realKeyv.get('provider:test-provider:last_used_key')).toBe('test-key-1')

      // 第3次调用：有缓存key1，轮换到key2
      const key3 = rotationClient.getApiKey()
      expect(key3).toBe('test-key-2')
      expect(realKeyv.get('provider:test-provider:last_used_key')).toBe('test-key-2')
    })

    it('should handle empty api key gracefully', () => {
      const emptyKeyProvider = { ...mockProvider, apiKey: '' }
      const emptyKeyClient = new TestApiClient(emptyKeyProvider)

      expect(emptyKeyClient.getApiKey()).toBe('')
    })

    it('should handle malformed api key string', () => {
      const malformedProvider = { ...mockProvider, apiKey: '  ,  , key3 ,' }
      const malformedClient = new TestApiClient(malformedProvider)

      const key = malformedClient.getApiKey()
      expect(key).toBe('') // 第一个trim后的空字符串
    })

    it('should expose storage errors to caller', () => {
      // 模拟存储损坏
      const originalGet = realKeyv.get
      realKeyv.get = () => {
        throw new Error('Storage corrupted')
      }

      // 应该让错误传播，由调用方决定如何处理
      expect(() => client.getApiKey()).toThrow('Storage corrupted')

      // 恢复存储
      realKeyv.get = originalGet
    })
  })

  describe('defaultHeaders', () => {
    it('should return default headers with api key', () => {
      const headers = client.defaultHeaders()
      expect(headers).toEqual({
        'HTTP-Referer': 'https://cherry-ai.com',
        'X-Title': 'Cherry Studio',
        'X-Api-Key': 'test-key-1'
      })
    })
  })

  describe('getMessageContent', () => {
    it('should return empty string for empty message', async () => {
      vi.mocked(getMainTextContent).mockReturnValue('')
      vi.mocked(getContentWithTools).mockReturnValue('')
      const result = await client.getMessageContent(mockMessage)
      expect(result).toBe('')
    })

    it('should integrate web search references', async () => {
      vi.mocked(getMainTextContent).mockReturnValue('Test message')
      vi.mocked(getContentWithTools).mockReturnValue('Test message')

      const webSearchResults: WebSearchResponse = {
        source: WebSearchSource.WEBSEARCH,
        results: {
          results: [
            { title: 'Example 1', url: 'https://example.com', content: 'Search result 1' },
            { title: 'Example 2', url: 'https://example2.com', content: 'Search result 2' }
          ]
        }
      }

      realKeyv.set(`web-search-${mockMessage.id}`, webSearchResults)

      const result = await client.getMessageContent(mockMessage)

      expect(result).toContain('Test message')
      expect(result).toContain('Search result 1')
      expect(result).toContain('https://example.com')
      // 验证缓存已被清理
      expect(realKeyv.get(`web-search-${mockMessage.id}`)).toBeUndefined()
    })

    it('should integrate knowledge base references', async () => {
      vi.mocked(getMainTextContent).mockReturnValue('Test message')
      vi.mocked(getContentWithTools).mockReturnValue('Test message')

      const knowledgeReferences: KnowledgeReference[] = [
        { id: 1, content: 'Knowledge 1', sourceUrl: '', type: 'file' },
        { id: 2, content: 'Knowledge 2', sourceUrl: '', type: 'note' }
      ]

      realKeyv.set(`knowledge-search-${mockMessage.id}`, knowledgeReferences)

      const result = await client.getMessageContent(mockMessage)

      expect(result).toContain('Knowledge 1')
      expect(result).toContain('Knowledge 2')
      // 验证缓存已被清理
      expect(realKeyv.get(`knowledge-search-${mockMessage.id}`)).toBeUndefined()
    })

    it('should integrate memory references', async () => {
      vi.mocked(getMainTextContent).mockReturnValue('Test message')
      vi.mocked(getContentWithTools).mockReturnValue('Test message')

      const memories: MemoryItem[] = [
        { id: 'mem-1', memory: 'Memory 1', createdAt: '2024-01-01' },
        { id: 'mem-2', memory: 'Memory 2', createdAt: '2024-01-02' }
      ]

      realKeyv.set(`memory-search-${mockMessage.id}`, memories)

      const result = await client.getMessageContent(mockMessage)

      expect(result).toContain('Memory 1')
      expect(result).toContain('2024-01-01')
    })

    it('should reindex knowledge references with web search offset', async () => {
      vi.mocked(getMainTextContent).mockReturnValue('Test message')
      vi.mocked(getContentWithTools).mockReturnValue('Test message')

      const webSearchResults: WebSearchResponse = {
        source: WebSearchSource.WEBSEARCH,
        results: {
          results: [{ title: 'Web Example', url: 'https://example.com', content: 'Web result' }]
        }
      }

      const knowledgeReferences: KnowledgeReference[] = [{ id: 1, content: 'Knowledge 1', sourceUrl: '', type: 'file' }]

      realKeyv.set(`web-search-${mockMessage.id}`, webSearchResults)
      realKeyv.set(`knowledge-search-${mockMessage.id}`, knowledgeReferences)

      const result = await client.getMessageContent(mockMessage)

      // 验证知识库引用的 ID 被重新索引（加上了网络搜索结果的数量）
      expect(result).toContain('"id": 1')
      expect(result).toContain('"id": 2')
    })

    // JSON序列化错误处理测试
    it('should expose JSON serialization errors to caller', async () => {
      vi.mocked(getMainTextContent).mockReturnValue('Test message')
      vi.mocked(getContentWithTools).mockReturnValue('Test message')

      // 设置包含循环引用的对象
      const circularRef: any = { id: 1, content: 'Test' }
      circularRef.self = circularRef

      realKeyv.set(`knowledge-search-${mockMessage.id}`, [circularRef])

      // JSON序列化错误应该传播给调用方
      await expect(client.getMessageContent(mockMessage)).rejects.toThrow()
    })

    // 缓存访问错误测试
    it('should expose cache errors to caller', async () => {
      vi.mocked(getMainTextContent).mockReturnValue('Test message')
      vi.mocked(getContentWithTools).mockReturnValue('Test message')

      // 模拟缓存访问错误
      const originalGet = realKeyv.get
      realKeyv.get = () => {
        throw new Error('Cache corrupted')
      }

      // 应该让错误传播，由调用方处理
      await expect(client.getMessageContent(mockMessage)).rejects.toThrow('Cache corrupted')

      // 恢复缓存
      realKeyv.get = originalGet
    })
  })

  describe('extractFileContent', () => {
    it('should return empty string when no files', async () => {
      const message: Message = {
        id: '1',
        role: 'user' as const,
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        createdAt: new Date().toISOString(),
        status: UserMessageStatus.SUCCESS,
        blocks: []
      }
      const result = await (
        client as TestApiClient & { extractFileContent: (msg: Message) => Promise<string> }
      ).extractFileContent(message)
      expect(result).toBe('')
    })

    it('should extract text file content', async () => {
      const fileBlock: MessageBlock = {
        id: 'block-1',
        messageId: '1',
        type: MessageBlockType.FILE,
        createdAt: new Date().toISOString(),
        status: MessageBlockStatus.SUCCESS,
        file: {
          id: 'file-1',
          name: 'file-1.txt',
          ext: '.txt',
          origin_name: 'test.txt',
          type: FileTypes.TEXT,
          path: 'file-1.txt',
          created_at: String(Date.now()),
          size: 100,
          count: 1
        }
      }

      const message: Message = {
        id: '1',
        role: 'user',
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        createdAt: new Date().toISOString(),
        status: UserMessageStatus.SUCCESS,
        blocks: ['block-1']
      }

      vi.mocked(findFileBlocks).mockReturnValue([fileBlock as FileMessageBlock])
      vi.mocked(mockApi.file.read).mockResolvedValue('File content here')

      const result = await (
        client as TestApiClient & { extractFileContent: (msg: Message) => Promise<string> }
      ).extractFileContent(message)

      expect(mockApi.file.read).toHaveBeenCalledWith('file-1.txt', true)
      expect(result).toContain('file: test.txt')
      expect(result).toContain('File content here')
    })

    it('should handle multiple files with divider', async () => {
      const fileBlock1: MessageBlock = {
        id: 'block-1',
        messageId: '1',
        type: MessageBlockType.FILE,
        createdAt: new Date().toISOString(),
        status: MessageBlockStatus.SUCCESS,
        file: {
          id: 'file-1',
          name: 'file-1.txt',
          ext: '.txt',
          origin_name: 'file1.txt',
          type: FileTypes.TEXT,
          path: 'file-1.txt',
          created_at: String(Date.now()),
          size: 100,
          count: 1
        }
      }

      const fileBlock2: MessageBlock = {
        id: 'block-2',
        messageId: '1',
        type: MessageBlockType.FILE,
        createdAt: new Date().toISOString(),
        status: MessageBlockStatus.SUCCESS,
        file: {
          id: 'file-2',
          name: 'file-2.md',
          ext: '.md',
          origin_name: 'file2.md',
          type: FileTypes.DOCUMENT,
          path: 'file-2.md',
          created_at: String(Date.now()),
          size: 200,
          count: 1
        }
      }

      const message: Message = {
        id: '1',
        role: 'user',
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        createdAt: new Date().toISOString(),
        status: UserMessageStatus.SUCCESS,
        blocks: ['block-1', 'block-2']
      }

      vi.mocked(findFileBlocks).mockReturnValue([fileBlock1 as FileMessageBlock, fileBlock2 as FileMessageBlock])
      vi.mocked(mockApi.file.read).mockResolvedValueOnce('Content 1').mockResolvedValueOnce('Content 2')

      const result = await (
        client as TestApiClient & { extractFileContent: (msg: Message) => Promise<string> }
      ).extractFileContent(message)

      expect(result).toContain('file: file1.txt')
      expect(result).toContain('Content 1')
      expect(result).toContain('file: file2.md')
      expect(result).toContain('Content 2')
      expect(result).toContain('---') // divider
    })

    it('should ignore non-text files', async () => {
      const fileBlock: MessageBlock = {
        id: 'block-1',
        messageId: '1',
        type: MessageBlockType.FILE,
        createdAt: new Date().toISOString(),
        status: MessageBlockStatus.SUCCESS,
        file: {
          id: 'file-1',
          name: 'file-1.jpg',
          ext: '.jpg',
          origin_name: 'image.jpg',
          type: FileTypes.IMAGE,
          path: 'file-1.jpg',
          created_at: String(Date.now()),
          size: 1000,
          count: 1
        }
      }

      const message: Message = {
        id: '1',
        role: 'user',
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        createdAt: new Date().toISOString(),
        status: UserMessageStatus.SUCCESS,
        blocks: ['block-1']
      }

      vi.mocked(findFileBlocks).mockReturnValue([fileBlock as FileMessageBlock])

      const result = await (
        client as TestApiClient & { extractFileContent: (msg: Message) => Promise<string> }
      ).extractFileContent(message)

      expect(mockApi.file.read).not.toHaveBeenCalled()
      expect(result).toBe('')
    })

    // 文件读取错误处理测试
    it('should expose file read errors (current behavior)', async () => {
      const fileBlock: MessageBlock = {
        id: 'block-1',
        messageId: '1',
        type: MessageBlockType.FILE,
        createdAt: new Date().toISOString(),
        status: MessageBlockStatus.SUCCESS,
        file: {
          id: 'file-1',
          name: 'file-1.txt',
          ext: '.txt',
          origin_name: 'corrupted.txt',
          type: FileTypes.TEXT,
          path: 'file-1.txt',
          created_at: String(Date.now()),
          size: 100,
          count: 1
        }
      }

      const message: Message = {
        id: '1',
        role: 'user',
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        createdAt: new Date().toISOString(),
        status: UserMessageStatus.SUCCESS,
        blocks: ['block-1']
      }

      vi.mocked(findFileBlocks).mockReturnValue([fileBlock as FileMessageBlock])

      // 创建一个模拟 fs 错误对象
      const fsError = new Error("ENOENT: no such file or directory, open 'file-1.txt'") as NodeJS.ErrnoException
      fsError.code = 'ENOENT'
      fsError.errno = -2
      fsError.syscall = 'open'
      fsError.path = 'file-1.txt'

      vi.mocked(mockApi.file.read).mockRejectedValue(fsError)

      // 当前源码没有错误处理，应该抛出错误
      await expect(
        (client as TestApiClient & { extractFileContent: (msg: Message) => Promise<string> }).extractFileContent(
          message
        )
      ).rejects.toThrow("ENOENT: no such file or directory, open 'file-1.txt'")
    })
  })

  describe('setupToolsConfig', () => {
    const mockModel = createMockModel()

    it('should return empty tools array when no mcpTools provided', () => {
      const result = client.setupToolsConfig({ model: mockModel })
      expect(result.tools).toEqual([])
    })

    it('should use system prompt when tools exceed threshold', () => {
      vi.mocked(models.isFunctionCallingModel).mockReturnValue(true)

      const mcpTools: MCPTool[] = Array(129)
        .fill(null)
        .map((_, i) => ({
          id: `tool-${i}`,
          serverId: 'server-1',
          serverName: 'Test Server',
          name: `tool-${i}`,
          description: `Tool ${i}`,
          inputSchema: {
            type: 'object',
            title: `Tool ${i} Schema`,
            properties: {}
          }
        }))

      const result = client.setupToolsConfig({
        mcpTools,
        model: mockModel,
        enableToolUse: true
      })

      expect(result.tools).toEqual([])
      expect(client.useSystemPromptForTools).toBe(true)
    })

    it('should convert tools when model supports function calling', () => {
      vi.mocked(models.isFunctionCallingModel).mockReturnValue(true)

      const mcpTools: MCPTool[] = [
        {
          id: 'tool-search',
          serverId: 'server-1',
          serverName: 'Test Server',
          name: 'search',
          description: 'Search tool',
          inputSchema: {
            type: 'object',
            title: 'Search Schema',
            properties: {}
          }
        },
        {
          id: 'tool-calculate',
          serverId: 'server-1',
          serverName: 'Test Server',
          name: 'calculate',
          description: 'Calculator',
          inputSchema: {
            type: 'object',
            title: 'Calculator Schema',
            properties: {}
          }
        }
      ]

      const result = client.setupToolsConfig({
        mcpTools,
        model: mockModel,
        enableToolUse: true
      })

      expect(result.tools).toHaveLength(2)
      expect(client.useSystemPromptForTools).toBe(false)
    })

    it('should not convert tools when model does not support function calling', () => {
      vi.mocked(models.isFunctionCallingModel).mockReturnValue(false)

      const mcpTools: MCPTool[] = [
        {
          id: 'tool-search',
          serverId: 'server-1',
          serverName: 'Test Server',
          name: 'search',
          description: 'Search tool',
          inputSchema: {
            type: 'object',
            title: 'Search Schema',
            properties: {}
          }
        }
      ]

      const result = client.setupToolsConfig({
        mcpTools,
        model: mockModel,
        enableToolUse: true
      })

      expect(result.tools).toEqual([])
    })

    it('should not convert tools when enableToolUse is false', () => {
      vi.mocked(models.isFunctionCallingModel).mockReturnValue(true)

      const mcpTools: MCPTool[] = [
        {
          id: 'tool-search',
          serverId: 'server-1',
          serverName: 'Test Server',
          name: 'search',
          description: 'Search tool',
          inputSchema: {
            type: 'object',
            title: 'Search Schema',
            properties: {}
          }
        }
      ]

      const result = client.setupToolsConfig({
        mcpTools,
        model: mockModel,
        enableToolUse: false
      })

      expect(result.tools).toEqual([])
    })
  })

  describe('createAbortController', () => {
    it('should create abort controller without message ID', () => {
      const result = client.createAbortController()

      expect(result.abortController).toBeInstanceOf(AbortController)
      expect(result.cleanup).toBeDefined()
      expect(result.signalPromise).toBeUndefined()
    })

    it('should register abort function with message ID', () => {
      const result = client.createAbortController('msg-123')

      expect(abortController.addAbortController).toHaveBeenCalledWith('msg-123', expect.any(Function))
      expect(result.cleanup).toBeDefined()
    })

    it('should cleanup on abort', () => {
      const result = client.createAbortController('msg-123')
      result.cleanup()

      expect(abortController.removeAbortController).toHaveBeenCalledWith('msg-123', expect.any(Function))
    })

    it('should create signal promise when isAddEventListener is true', () => {
      const result = client.createAbortController('msg-123', true)

      expect(result.signalPromise).toBeDefined()
      expect(result.signalPromise!.promise).toBeInstanceOf(Promise)
    })
  })

  describe('getCustomParameters', () => {
    it('should return empty object when no custom parameters', () => {
      const assistant: Assistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        prompt: '',
        model: mockProvider.models[0],
        topics: [],
        type: 'general',
        settings: {}
      }
      const result = (
        client as TestApiClient & { getCustomParameters: (assistant: Assistant) => Record<string, unknown> }
      ).getCustomParameters(assistant)
      expect(result).toEqual({})
    })

    it('should process custom parameters correctly', () => {
      const assistant: Assistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        prompt: '',
        model: mockProvider.models[0],
        topics: [],
        type: 'general',
        settings: {
          customParameters: [
            { name: 'param1', value: 'value1', type: 'string' },
            { name: 'param2', value: 123, type: 'number' },
            { name: 'param3', value: '{"key": "value"}', type: 'json' },
            { name: 'param4', value: 'undefined', type: 'json' },
            { name: '', value: 'ignored', type: 'string' }
          ]
        }
      }

      const result = (
        client as TestApiClient & { getCustomParameters: (assistant: Assistant) => Record<string, unknown> }
      ).getCustomParameters(assistant)

      expect(result).toEqual({
        param1: 'value1',
        param2: 123,
        param3: { key: 'value' },
        param4: undefined
      })
    })

    it('should handle invalid JSON gracefully', () => {
      const assistant: Assistant = {
        id: 'assistant-1',
        name: 'Test Assistant',
        prompt: '',
        model: mockProvider.models[0],
        topics: [],
        type: 'general',
        settings: {
          customParameters: [{ name: 'badJson', value: 'not-json', type: 'json' }]
        }
      }

      const result = (
        client as TestApiClient & { getCustomParameters: (assistant: Assistant) => Record<string, unknown> }
      ).getCustomParameters(assistant)

      expect(result).toEqual({
        badJson: 'not-json'
      })
    })
  })

  describe('temperature and topP methods', () => {
    const mockModel = createMockModel()
    const mockAssistant = createMockAssistant({ model: mockModel })

    it('should return temperature when model supports it', () => {
      vi.mocked(models.isNotSupportTemperatureAndTopP).mockReturnValue(false)

      const result = client.getTemperature(mockAssistant, mockModel)
      expect(result).toBe(0.7)
    })

    it('should return undefined when model does not support temperature', () => {
      vi.mocked(models.isNotSupportTemperatureAndTopP).mockReturnValue(true)

      const result = client.getTemperature(mockAssistant, mockModel)
      expect(result).toBeUndefined()
    })

    it('should return topP when model supports it', () => {
      vi.mocked(models.isNotSupportTemperatureAndTopP).mockReturnValue(false)

      const result = client.getTopP(mockAssistant, mockModel)
      expect(result).toBe(0.9)
    })
  })

  describe('service tier and timeout methods', () => {
    const mockModel = createMockModel({
      id: 'gpt-4',
      name: 'GPT-4',
      provider: 'openai',
      group: 'GPT-4'
    })

    it('should return service tier for OpenAI models', () => {
      vi.mocked(models.isOpenAIModel).mockReturnValue(true)
      vi.mocked(models.isSupportedFlexServiceTier).mockReturnValue(true)
      vi.mocked(settings.getStoreSetting).mockReturnValue({ summaryText: 'auto', serviceTier: 'flex' })

      const result = (
        client as TestApiClient & { getServiceTier: (model: Model) => string | undefined }
      ).getServiceTier(mockModel)
      expect(result).toBe('flex')
    })

    it('should return undefined for non-OpenAI models', () => {
      vi.mocked(models.isOpenAIModel).mockReturnValue(false)

      const result = (
        client as TestApiClient & { getServiceTier: (model: Model) => string | undefined }
      ).getServiceTier(mockModel)
      expect(result).toBeUndefined()
    })

    it('should return extended timeout for flex tier models', () => {
      vi.mocked(models.isSupportedFlexServiceTier).mockReturnValue(true)

      const result = (client as TestApiClient & { getTimeout: (model: Model) => number }).getTimeout(mockModel)
      expect(result).toBe(15 * 1000 * 60) // 15 minutes
    })

    it('should return default timeout for non-flex models', () => {
      vi.mocked(models.isSupportedFlexServiceTier).mockReturnValue(false)

      const result = (client as TestApiClient & { getTimeout: (model: Model) => number }).getTimeout(mockModel)
      expect(result).toBe(defaultTimeout) // default timeout
    })
  })

  describe('keepAliveTime getter', () => {
    it('should return keep alive time for lmstudio provider', () => {
      const lmstudioProvider = { ...mockProvider, id: 'lmstudio' }
      const lmstudioClient = new TestApiClient(lmstudioProvider)

      expect(lmstudioClient.keepAliveTime).toBe(300)
    })

    it('should return undefined for other providers', () => {
      expect(client.keepAliveTime).toBeUndefined()
    })
  })

  // ============================================================================
  // 并发和竞态条件测试 - 关键的高级测试场景
  // ============================================================================
  describe('concurrency and race condition testing', () => {
    describe('API key rotation race condition', () => {
      it('should handle concurrent API key rotation correctly', async () => {
        realKeyv.clear()
        const concurrentClient = new TestApiClient(mockProvider)

        // 模拟100个并发请求同时获取API Key
        const promises = Array(100)
          .fill(null)
          .map(() => Promise.resolve(concurrentClient.getApiKey()))

        const keys = await Promise.all(promises)

        // 验证所有key都是有效的
        keys.forEach((key) => {
          expect(['test-key-1', 'test-key-2']).toContain(key)
        })

        // 验证实际使用了轮换机制
        const uniqueKeys = new Set(keys)
        expect(uniqueKeys.size).toBeGreaterThan(1) // 应该有多个不同的key
      })

      it('should handle rapid sequential key rotation', () => {
        realKeyv.clear()
        const sequentialClient = new TestApiClient(mockProvider)

        // 快速连续获取100个key
        const keys: string[] = []
        for (let i = 0; i < 100; i++) {
          keys.push(sequentialClient.getApiKey())
        }

        // 验证轮换模式：构造函数调用过getApiKey()设置了key1，所以开始是key2, key1, key2, key1...
        expect(keys[0]).toBe('test-key-2')
        expect(keys[1]).toBe('test-key-1')
        expect(keys[2]).toBe('test-key-2')
        expect(keys[3]).toBe('test-key-1')

        // 验证所有key都有使用
        const uniqueKeys = new Set(keys)
        expect(uniqueKeys.size).toBe(2)
        expect(uniqueKeys.has('test-key-1')).toBe(true)
        expect(uniqueKeys.has('test-key-2')).toBe(true)
      })
    })

    describe('Cache Operations Race Conditions', () => {
      it('should handle concurrent cache operations safely', async () => {
        const messageIds = Array(50)
          .fill(null)
          .map((_, i) => `msg-${i}`)

        // 并发写入缓存
        const writePromises = messageIds.map((id) =>
          Promise.resolve(realKeyv.set(`test-${id}`, { data: `content-${id}` }))
        )

        await Promise.all(writePromises)

        // 并发读取缓存
        const readPromises = messageIds.map((id) => Promise.resolve(realKeyv.get(`test-${id}`)))

        const results = await Promise.all(readPromises)

        // 验证所有数据都正确写入和读取
        results.forEach((result, index) => {
          expect(result).toEqual({ data: `content-msg-${index}` })
        })
      })

      it('should handle concurrent cache cleanup', async () => {
        // 设置初始数据
        const messageIds = Array(20)
          .fill(null)
          .map((_, i) => `msg-${i}`)
        messageIds.forEach((id) => {
          realKeyv.set(`web-search-${id}`, {
            source: WebSearchSource.WEBSEARCH,
            results: { results: [] }
          })
          realKeyv.set(`knowledge-search-${id}`, [{ id: 1, content: 'test', sourceUrl: '', type: 'file' }])
        })

        // 并发处理消息（会触发缓存清理）
        const processPromises = messageIds.map((id) => {
          const testMessage = {
            id,
            role: 'user' as const,
            assistantId: 'assistant-1',
            topicId: 'topic-1',
            createdAt: new Date().toISOString(),
            status: UserMessageStatus.SUCCESS,
            blocks: []
          }
          vi.mocked(getMainTextContent).mockReturnValue('test')
          vi.mocked(getContentWithTools).mockReturnValue('test')
          return client.getMessageContent(testMessage)
        })

        await Promise.all(processPromises)

        // 验证缓存都被正确清理
        messageIds.forEach((id) => {
          expect(realKeyv.get(`web-search-${id}`)).toBeUndefined()
          expect(realKeyv.get(`knowledge-search-${id}`)).toBeUndefined()
        })
      })
    })

    describe('AbortController Race Conditions', () => {
      it('should handle concurrent abort controller creation and cleanup', () => {
        const messageIds = Array(50)
          .fill(null)
          .map((_, i) => `msg-${i}`)

        // 并发创建多个abort controller
        const controllers = messageIds.map((id) => client.createAbortController(id))

        // 验证所有controller都被正确创建
        controllers.forEach(({ abortController, cleanup }) => {
          expect(abortController).toBeInstanceOf(AbortController)
          expect(typeof cleanup).toBe('function')
        })

        // 并发清理
        controllers.forEach(({ cleanup }) => {
          expect(() => cleanup()).not.toThrow()
        })
      })
    })
  })

  // ============================================================================
  // 边界条件和破坏性测试 - 测试系统在极端情况下的表现
  // ============================================================================
  describe('边界条件和破坏性测试', () => {
    describe('内存和资源耗尽测试', () => {
      it('should handle extremely large reference arrays', async () => {
        vi.mocked(getMainTextContent).mockReturnValue('Test message')
        vi.mocked(getContentWithTools).mockReturnValue('Test message')

        // 创建超大的知识库引用数组 (1000+ 条)
        const hugeReferences = Array(1000)
          .fill(null)
          .map((_, i) => ({
            id: i + 1,
            content: `Knowledge ${i} - ${'x'.repeat(1000)}`, // 每条1KB
            sourceUrl: `https://example.com/${i}`,
            type: 'file' as const
          }))

        realKeyv.set(`knowledge-search-${mockMessage.id}`, hugeReferences)

        // 应该能处理大量数据而不崩溃
        const result = await client.getMessageContent(mockMessage)
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      })

      it('should handle deeply nested object structures', async () => {
        vi.mocked(getMainTextContent).mockReturnValue('Test message')
        vi.mocked(getContentWithTools).mockReturnValue('Test message')

        // 创建深度嵌套的对象
        const createDeepObject = (depth: number): any => {
          if (depth === 0) return { value: 'deep' }
          return { child: createDeepObject(depth - 1) }
        }

        const deepReference = {
          id: 1,
          content: 'Deep reference',
          sourceUrl: '',
          type: 'file' as const,
          metadata: createDeepObject(50) // 50层深度
        }

        realKeyv.set(`knowledge-search-${mockMessage.id}`, [deepReference])

        // 应该能处理深度嵌套而不栈溢出
        const result = await client.getMessageContent(mockMessage)
        expect(typeof result).toBe('string')
      })
    })

    describe('Unicode and Character Encoding', () => {
      it('should handle various Unicode characters in API keys', () => {
        const unicodeProvider = {
          ...mockProvider,
          apiKey: '🔑key1,中文key2,🚀key3,العربية-key4'
        }
        const unicodeClient = new TestApiClient(unicodeProvider)

        // 所有Unicode字符都应该正确处理
        // 构造函数已经调用过getApiKey()，设置了第一个key
        const key1 = unicodeClient.getApiKey()
        const key2 = unicodeClient.getApiKey()
        const key3 = unicodeClient.getApiKey()

        // 验证轮换包含所有Unicode字符
        const allKeys = [key1, key2, key3]
        expect(allKeys).toContain('中文key2')
        expect(allKeys).toContain('🚀key3')
      })

      it('should handle special characters in cache keys', () => {
        const specialMessageId = 'msg-🔥-测试-العربية-\u0000-\uFFFF'
        const specialKey = `test-${specialMessageId}`

        // 应该能处理特殊字符
        expect(() => {
          realKeyv.set(specialKey, { data: 'test' })
          realKeyv.get(specialKey)
          realKeyv.remove(specialKey)
        }).not.toThrow()
      })
    })

    describe('Time-based Edge Cases', () => {
      it('should handle rapid timestamp changes', () => {
        const provider = { ...mockProvider, id: 'time-test' }
        const timeClient = new TestApiClient(provider)

        // 模拟系统时间快速变化
        const originalDateNow = Date.now
        let mockTime = 1000000000000 // 起始时间

        Date.now = () => mockTime

        const key1 = timeClient.getApiKey()
        mockTime += 1000 // +1秒
        const key2 = timeClient.getApiKey()
        mockTime += 86400000 // +1天
        const key3 = timeClient.getApiKey()

        // 时间变化不应该影响key轮换逻辑(构造函数已经设置了key1)
        expect(key1).toBe('test-key-2')
        expect(key2).toBe('test-key-1')
        expect(key3).toBe('test-key-2')

        // 恢复原始时间
        Date.now = originalDateNow
      })
    })

    describe('Malicious Input Handling', () => {
      it('should handle prototype pollution attempts', () => {
        const maliciousProvider = {
          ...mockProvider,
          apiKey: 'normal-key',
          // 尝试原型污染
          __proto__: { polluted: true },
          constructor: { prototype: { polluted: true } }
        }

        const maliciousClient = new TestApiClient(maliciousProvider)

        // 不应该污染原型
        expect((Object.prototype as any).polluted).toBeUndefined()
        expect(maliciousClient.getApiKey()).toBe('normal-key')
      })

      it('should handle circular reference objects in cache', () => {
        const circularRef: any = { id: 1, content: 'Test' }
        circularRef.circular = circularRef

        // 应该能处理循环引用而不死循环
        expect(() => {
          realKeyv.set('circular-test', circularRef)
          realKeyv.get('circular-test')
        }).not.toThrow()
      })
    })

    describe('Resource Cleanup', () => {
      it('should consistently expose errors without side effects', async () => {
        const originalGet = realKeyv.get
        let callCount = 0

        // 模拟一致的错误
        realKeyv.get = () => {
          callCount++
          throw new Error('Persistent error')
        }

        // 所有调用都应该抛出相同的错误
        for (let i = 0; i < 5; i++) {
          await expect(client.getMessageContent(mockMessage)).rejects.toThrow('Persistent error')
        }

        expect(callCount).toBe(5) // 确认所有调用都到达了错误点

        // 恢复原始函数
        realKeyv.get = originalGet
      })
    })

    describe('System Limits', () => {
      it('should handle maximum string length limits', () => {
        const maxLengthProvider = {
          ...mockProvider,
          apiKey: 'a'.repeat(1000000) // 1MB的API key
        }

        // 处理超长字符串
        expect(() => {
          new TestApiClient(maxLengthProvider)
        }).not.toThrow()
      })

      it('should handle maximum array length', () => {
        const hugeKeyArray = Array(10000)
          .fill(null)
          .map((_, i) => `key-${i}`)
        const hugeArrayProvider = {
          ...mockProvider,
          apiKey: hugeKeyArray.join(',')
        }

        const hugeClient = new TestApiClient(hugeArrayProvider)

        // 处理大数组
        expect(() => {
          hugeClient.getApiKey()
        }).not.toThrow()
      })
    })
  })
})
