import type { Provider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AihubmixAPIClient } from '../aihubmix/AihubmixAPIClient'
import { AnthropicAPIClient } from '../anthropic/AnthropicAPIClient'
import { ApiClientFactory } from '../ApiClientFactory'
import { AwsBedrockAPIClient } from '../aws/AwsBedrockAPIClient'
import { GeminiAPIClient } from '../gemini/GeminiAPIClient'
import { VertexAPIClient } from '../gemini/VertexAPIClient'
import { NewAPIClient } from '../newapi/NewAPIClient'
import { OpenAIAPIClient } from '../openai/OpenAIApiClient'
import { OpenAIResponseAPIClient } from '../openai/OpenAIResponseAPIClient'
import { PPIOAPIClient } from '../ppio/PPIOAPIClient'

// 为工厂测试创建最小化 provider 的辅助函数
// ApiClientFactory 只使用 'id' 和 'type' 字段来决定创建哪个客户端
// 其他字段会传递给客户端构造函数，但不影响工厂逻辑
const createTestProvider = (id: string, type: string): Provider => ({
  id,
  type: type as Provider['type'],
  name: '',
  apiKey: '',
  apiHost: '',
  models: []
})

// Mock 所有客户端模块
vi.mock('../aihubmix/AihubmixAPIClient', () => ({
  AihubmixAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../anthropic/AnthropicAPIClient', () => ({
  AnthropicAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../anthropic/AnthropicVertexClient', () => ({
  AnthropicVertexClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../gemini/GeminiAPIClient', () => ({
  GeminiAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../gemini/VertexAPIClient', () => ({
  VertexAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../newapi/NewAPIClient', () => ({
  NewAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../openai/OpenAIApiClient', () => ({
  OpenAIAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../openai/OpenAIResponseAPIClient', () => ({
  OpenAIResponseAPIClient: vi.fn().mockImplementation(() => ({
    getClient: vi.fn().mockReturnThis()
  }))
}))
vi.mock('../ppio/PPIOAPIClient', () => ({
  PPIOAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../aws/AwsBedrockAPIClient', () => ({
  AwsBedrockAPIClient: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('@renderer/services/AssistantService.ts', () => ({
  getDefaultAssistant: () => {
    return {
      id: 'default',
      name: 'default',
      emoji: '😀',
      prompt: '',
      topics: [],
      messages: [],
      type: 'assistant',
      regularPhrases: [],
      settings: {}
    }
  }
}))

// Mock the models config to prevent circular dependency issues
vi.mock('@renderer/config/models', () => ({
  findTokenLimit: vi.fn(),
  isReasoningModel: vi.fn(),
  isOpenAILLMModel: vi.fn(),
  SYSTEM_MODELS: {
    silicon: [],
    defaultModel: []
  },
  isOpenAIModel: vi.fn(() => false),
  glm45FlashModel: {},
  qwen38bModel: {}
}))

describe('ApiClientFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('create', () => {
    // 测试特殊 ID 的客户端创建
    it('should create AihubmixAPIClient for aihubmix provider', () => {
      const provider = createTestProvider('aihubmix', 'openai')

      const client = ApiClientFactory.create(provider)

      expect(AihubmixAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create NewAPIClient for new-api provider', () => {
      const provider = createTestProvider('new-api', 'openai')

      const client = ApiClientFactory.create(provider)

      expect(NewAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create PPIOAPIClient for ppio provider', () => {
      const provider = createTestProvider('ppio', 'openai')

      const client = ApiClientFactory.create(provider)

      expect(PPIOAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    // 测试标准类型的客户端创建
    it('should create OpenAIAPIClient for openai type', () => {
      const provider = createTestProvider('custom-openai', 'openai')

      const client = ApiClientFactory.create(provider)

      expect(OpenAIAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create OpenAIResponseAPIClient for azure-openai type', () => {
      const provider = createTestProvider('azure-openai', 'azure-openai')

      const client = ApiClientFactory.create(provider)

      expect(OpenAIResponseAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create OpenAIResponseAPIClient for openai-response type', () => {
      const provider = createTestProvider('response', 'openai-response')

      const client = ApiClientFactory.create(provider)

      expect(OpenAIResponseAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create GeminiAPIClient for gemini type', () => {
      const provider = createTestProvider('gemini', 'gemini')

      const client = ApiClientFactory.create(provider)

      expect(GeminiAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create VertexAPIClient for vertexai type', () => {
      const provider = createTestProvider('vertex', 'vertexai')

      const client = ApiClientFactory.create(provider)

      expect(VertexAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create AnthropicAPIClient for anthropic type', () => {
      const provider = createTestProvider('anthropic', 'anthropic')

      const client = ApiClientFactory.create(provider)

      expect(AnthropicAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create AwsBedrockAPIClient for aws-bedrock type', () => {
      const provider = createTestProvider('aws-bedrock', 'aws-bedrock')

      const client = ApiClientFactory.create(provider)

      expect(AwsBedrockAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    // 测试默认情况
    it('should create OpenAIAPIClient as default for unknown type', () => {
      const provider = createTestProvider('unknown', 'unknown-type')

      const client = ApiClientFactory.create(provider)

      expect(OpenAIAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    // 测试边界条件
    it('should handle provider with minimal configuration', () => {
      const provider = createTestProvider('minimal', 'openai')

      const client = ApiClientFactory.create(provider)

      expect(OpenAIAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    // 测试特殊 ID 优先级高于类型
    it('should prioritize special ID over type', () => {
      const provider = createTestProvider('aihubmix', 'anthropic') // 即使类型是 anthropic

      const client = ApiClientFactory.create(provider)

      // 应该创建 AihubmixAPIClient 而不是 AnthropicAPIClient
      expect(AihubmixAPIClient).toHaveBeenCalledWith(provider)
      expect(AnthropicAPIClient).not.toHaveBeenCalled()
      expect(client).toBeDefined()
    })
  })
})
