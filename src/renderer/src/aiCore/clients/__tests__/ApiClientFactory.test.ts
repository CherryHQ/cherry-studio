import { Provider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AihubmixAPIClient } from '../AihubmixAPIClient'
import { AnthropicAPIClient } from '../anthropic/AnthropicAPIClient'
import { ApiClientFactory, isOpenAIProvider } from '../ApiClientFactory'
import { GeminiAPIClient } from '../gemini/GeminiAPIClient'
import { VertexAPIClient } from '../gemini/VertexAPIClient'
import { NewAPIClient } from '../NewAPIClient'
import { OpenAIAPIClient } from '../openai/OpenAIApiClient'
import { OpenAIResponseAPIClient } from '../openai/OpenAIResponseAPIClient'
import { PPIOAPIClient } from '../ppio/PPIOAPIClient'

// Mock all client modules
vi.mock('../AihubmixAPIClient', () => ({
  AihubmixAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../anthropic/AnthropicAPIClient', () => ({
  AnthropicAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../gemini/GeminiAPIClient', () => ({
  GeminiAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../gemini/VertexAPIClient', () => ({
  VertexAPIClient: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('../NewAPIClient', () => ({
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

describe('ApiClientFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('create', () => {
    // 测试特殊 ID 的客户端创建
    it('should create AihubmixAPIClient for aihubmix provider', () => {
      const provider: Provider = {
        id: 'aihubmix',
        type: 'openai',
        name: 'Aihubmix',
        apiKey: 'test-key',
        apiHost: 'https://api.aihubmix.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(AihubmixAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create NewAPIClient for new-api provider', () => {
      const provider: Provider = {
        id: 'new-api',
        type: 'openai',
        name: 'New API',
        apiKey: 'test-key',
        apiHost: 'https://api.new-api.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(NewAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create PPIOAPIClient for ppio provider', () => {
      const provider: Provider = {
        id: 'ppio',
        type: 'openai',
        name: 'PPIO',
        apiKey: 'test-key',
        apiHost: 'https://api.ppio.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(PPIOAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    // 测试标准类型的客户端创建
    it('should create OpenAIAPIClient for openai type', () => {
      const provider: Provider = {
        id: 'custom-openai',
        type: 'openai',
        name: 'Custom OpenAI',
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(OpenAIAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create OpenAIResponseAPIClient for azure-openai type', () => {
      const provider: Provider = {
        id: 'azure-openai',
        type: 'azure-openai',
        name: 'Azure OpenAI',
        apiKey: 'test-key',
        apiHost: 'https://azure.openai.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(OpenAIResponseAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create OpenAIResponseAPIClient for openai-response type', () => {
      const provider: Provider = {
        id: 'response',
        type: 'openai-response',
        name: 'OpenAI Response',
        apiKey: 'test-key',
        apiHost: 'https://api.response.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(OpenAIResponseAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create GeminiAPIClient for gemini type', () => {
      const provider: Provider = {
        id: 'gemini',
        type: 'gemini',
        name: 'Google Gemini',
        apiKey: 'test-key',
        apiHost: 'https://generativelanguage.googleapis.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(GeminiAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create VertexAPIClient for vertexai type', () => {
      const provider: Provider = {
        id: 'vertex',
        type: 'vertexai',
        name: 'Vertex AI',
        apiKey: 'test-key',
        apiHost: 'https://vertexai.googleapis.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(VertexAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    it('should create AnthropicAPIClient for anthropic type', () => {
      const provider: Provider = {
        id: 'anthropic',
        type: 'anthropic',
        name: 'Anthropic',
        apiKey: 'test-key',
        apiHost: 'https://api.anthropic.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(AnthropicAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    // 测试默认情况
    it('should create OpenAIAPIClient as default for unknown type', () => {
      const provider: Provider = {
        id: 'unknown',
        type: 'unknown-type' as any,
        name: 'Unknown Provider',
        apiKey: 'test-key',
        apiHost: 'https://api.unknown.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(OpenAIAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    // 测试边界条件
    it('should handle provider with minimal configuration', () => {
      const provider: Provider = {
        id: 'minimal',
        type: 'openai',
        name: '',
        apiKey: '',
        apiHost: '',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      expect(OpenAIAPIClient).toHaveBeenCalledWith(provider)
      expect(client).toBeDefined()
    })

    // 测试特殊 ID 优先级高于类型
    it('should prioritize special ID over type', () => {
      const provider: Provider = {
        id: 'aihubmix',
        type: 'anthropic', // 即使类型是 anthropic
        name: 'Aihubmix',
        apiKey: 'test-key',
        apiHost: 'https://api.aihubmix.com',
        models: []
      }

      const client = ApiClientFactory.create(provider)

      // 应该创建 AihubmixAPIClient 而不是 AnthropicAPIClient
      expect(AihubmixAPIClient).toHaveBeenCalledWith(provider)
      expect(AnthropicAPIClient).not.toHaveBeenCalled()
      expect(client).toBeDefined()
    })
  })

  describe('isOpenAIProvider', () => {
    it('should return true for openai type', () => {
      const provider: Provider = {
        id: 'openai',
        type: 'openai',
        name: 'OpenAI',
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com',
        models: []
      }

      expect(isOpenAIProvider(provider)).toBe(true)
    })

    it('should return true for azure-openai type', () => {
      const provider: Provider = {
        id: 'azure-openai',
        type: 'azure-openai',
        name: 'Azure OpenAI',
        apiKey: 'test-key',
        apiHost: 'https://azure.openai.com',
        models: []
      }

      expect(isOpenAIProvider(provider)).toBe(true)
    })

    it('should return true for unknown type', () => {
      const provider: Provider = {
        id: 'unknown',
        type: 'unknown' as any,
        name: 'Unknown',
        apiKey: 'test-key',
        apiHost: 'https://api.unknown.com',
        models: []
      }

      expect(isOpenAIProvider(provider)).toBe(true)
    })

    it('should return false for anthropic type', () => {
      const provider: Provider = {
        id: 'anthropic',
        type: 'anthropic',
        name: 'Anthropic',
        apiKey: 'test-key',
        apiHost: 'https://api.anthropic.com',
        models: []
      }

      expect(isOpenAIProvider(provider)).toBe(false)
    })

    it('should return false for gemini type', () => {
      const provider: Provider = {
        id: 'gemini',
        type: 'gemini',
        name: 'Gemini',
        apiKey: 'test-key',
        apiHost: 'https://api.gemini.com',
        models: []
      }

      expect(isOpenAIProvider(provider)).toBe(false)
    })
  })
})
