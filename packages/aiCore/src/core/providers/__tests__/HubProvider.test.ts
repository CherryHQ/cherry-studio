/**
 * HubProvider Comprehensive Tests
 * Tests hub provider routing, model resolution, and error handling
 * Covers multi-provider routing with namespaced model IDs
 */

import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import { customProvider, wrapProvider } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockEmbeddingModel, createMockImageModel, createMockLanguageModel } from '../../../__tests__'
import { createHubProvider, type HubProviderConfig, HubProviderError } from '../HubProvider'
import { DEFAULT_SEPARATOR, globalRegistryManagement } from '../RegistryManagement'

// Mock dependencies
vi.mock('../RegistryManagement', () => ({
  globalRegistryManagement: {
    getProvider: vi.fn()
  },
  DEFAULT_SEPARATOR: '|'
}))

vi.mock('ai', () => ({
  customProvider: vi.fn((config) => config.fallbackProvider),
  wrapProvider: vi.fn((config) => config.provider),
  jsonSchema: vi.fn((schema) => schema)
}))

describe('HubProvider', () => {
  let mockOpenAIProvider: ProviderV3
  let mockAnthropicProvider: ProviderV3
  let mockLanguageModel: LanguageModelV3
  let mockEmbeddingModel: EmbeddingModelV3
  let mockImageModel: ImageModelV3

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock models using global utilities
    mockLanguageModel = createMockLanguageModel({
      provider: 'test',
      modelId: 'test-model'
    })

    mockEmbeddingModel = createMockEmbeddingModel({
      provider: 'test',
      modelId: 'test-embedding'
    })

    mockImageModel = createMockImageModel({
      provider: 'test',
      modelId: 'test-image'
    })

    // Create mock providers
    mockOpenAIProvider = {
      specificationVersion: 'v3',
      languageModel: vi.fn().mockReturnValue(mockLanguageModel),
      embeddingModel: vi.fn().mockReturnValue(mockEmbeddingModel),
      imageModel: vi.fn().mockReturnValue(mockImageModel)
    } as ProviderV3

    mockAnthropicProvider = {
      specificationVersion: 'v3',
      languageModel: vi.fn().mockReturnValue(mockLanguageModel),
      embeddingModel: vi.fn().mockReturnValue(mockEmbeddingModel),
      imageModel: vi.fn().mockReturnValue(mockImageModel)
    } as ProviderV3

    // Setup default mock implementation
    vi.mocked(globalRegistryManagement.getProvider).mockImplementation((id) => {
      if (id === 'openai') return mockOpenAIProvider
      if (id === 'anthropic') return mockAnthropicProvider
      return undefined
    })
  })

  describe('Provider Creation', () => {
    it('should create hub provider with basic config', () => {
      const config: HubProviderConfig = {
        hubId: 'test-hub'
      }

      const provider = createHubProvider(config)

      expect(provider).toBeDefined()
      expect(customProvider).toHaveBeenCalled()
    })

    it('should create provider with debug flag', () => {
      const config: HubProviderConfig = {
        hubId: 'test-hub',
        debug: true
      }

      const provider = createHubProvider(config)

      expect(provider).toBeDefined()
    })

    it('should return ProviderV3 specification', () => {
      const config: HubProviderConfig = {
        hubId: 'aihubmix'
      }

      const provider = createHubProvider(config)

      expect(provider).toHaveProperty('specificationVersion', 'v3')
      expect(provider).toHaveProperty('languageModel')
      expect(provider).toHaveProperty('embeddingModel')
      expect(provider).toHaveProperty('imageModel')
    })
  })

  describe('Model ID Parsing', () => {
    it('should parse valid hub model ID format', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      const modelId = `openai${DEFAULT_SEPARATOR}gpt-4`

      const result = provider.languageModel(modelId)

      expect(globalRegistryManagement.getProvider).toHaveBeenCalledWith('openai')
      expect(mockOpenAIProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(result).toBe(mockLanguageModel)
    })

    it('should throw error for invalid model ID format', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      const invalidId = 'invalid-id-without-separator'

      expect(() => provider.languageModel(invalidId)).toThrow(HubProviderError)
    })

    it('should throw error for model ID with multiple separators', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      const multiSeparatorId = `provider${DEFAULT_SEPARATOR}extra${DEFAULT_SEPARATOR}model`

      expect(() => provider.languageModel(multiSeparatorId)).toThrow(HubProviderError)
    })

    it('should throw error for empty model ID', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      expect(() => provider.languageModel('')).toThrow(HubProviderError)
    })

    it('should throw error for model ID with only separator', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      expect(() => provider.languageModel(DEFAULT_SEPARATOR)).toThrow(HubProviderError)
    })
  })

  describe('Language Model Resolution', () => {
    it('should route to correct provider for language model', () => {
      const config: HubProviderConfig = { hubId: 'aihubmix' }
      const provider = createHubProvider(config) as ProviderV3

      const result = provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)

      expect(globalRegistryManagement.getProvider).toHaveBeenCalledWith('openai')
      expect(mockOpenAIProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(result).toBe(mockLanguageModel)
    })

    it('should route different providers correctly', () => {
      const config: HubProviderConfig = { hubId: 'aihubmix' }
      const provider = createHubProvider(config) as ProviderV3

      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)
      provider.languageModel(`anthropic${DEFAULT_SEPARATOR}claude-3`)

      expect(globalRegistryManagement.getProvider).toHaveBeenCalledWith('openai')
      expect(globalRegistryManagement.getProvider).toHaveBeenCalledWith('anthropic')
      expect(mockOpenAIProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(mockAnthropicProvider.languageModel).toHaveBeenCalledWith('claude-3')
    })

    it('should wrap provider with wrapProvider', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)

      expect(wrapProvider).toHaveBeenCalledWith({
        provider: mockOpenAIProvider,
        languageModelMiddleware: []
      })
    })

    it('should throw HubProviderError if provider not initialized', () => {
      vi.mocked(globalRegistryManagement.getProvider).mockReturnValue(undefined)

      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      expect(() => provider.languageModel(`uninitialized${DEFAULT_SEPARATOR}model`)).toThrow(HubProviderError)
      expect(() => provider.languageModel(`uninitialized${DEFAULT_SEPARATOR}model`)).toThrow(/not initialized/)
    })

    it('should include provider ID in error message', () => {
      vi.mocked(globalRegistryManagement.getProvider).mockReturnValue(undefined)

      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      try {
        provider.languageModel(`missing${DEFAULT_SEPARATOR}model`)
        expect.fail('Should have thrown HubProviderError')
      } catch (error) {
        expect(error).toBeInstanceOf(HubProviderError)
        const hubError = error as HubProviderError
        expect(hubError.providerId).toBe('missing')
        expect(hubError.hubId).toBe('test-hub')
      }
    })
  })

  describe('Embedding Model Resolution', () => {
    it('should route to correct provider for embedding model', () => {
      const config: HubProviderConfig = { hubId: 'aihubmix' }
      const provider = createHubProvider(config) as ProviderV3

      const result = provider.embeddingModel(`openai${DEFAULT_SEPARATOR}text-embedding-3-small`)

      expect(globalRegistryManagement.getProvider).toHaveBeenCalledWith('openai')
      expect(mockOpenAIProvider.embeddingModel).toHaveBeenCalledWith('text-embedding-3-small')
      expect(result).toBe(mockEmbeddingModel)
    })

    it('should handle different embedding providers', () => {
      const config: HubProviderConfig = { hubId: 'aihubmix' }
      const provider = createHubProvider(config) as ProviderV3

      provider.embeddingModel(`openai${DEFAULT_SEPARATOR}ada-002`)
      provider.embeddingModel(`anthropic${DEFAULT_SEPARATOR}embed-v1`)

      expect(mockOpenAIProvider.embeddingModel).toHaveBeenCalledWith('ada-002')
      expect(mockAnthropicProvider.embeddingModel).toHaveBeenCalledWith('embed-v1')
    })

    it('should throw error for uninitialized embedding provider', () => {
      vi.mocked(globalRegistryManagement.getProvider).mockReturnValue(undefined)

      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      expect(() => provider.embeddingModel(`missing${DEFAULT_SEPARATOR}embed`)).toThrow(HubProviderError)
    })
  })

  describe('Image Model Resolution', () => {
    it('should route to correct provider for image model', () => {
      const config: HubProviderConfig = { hubId: 'aihubmix' }
      const provider = createHubProvider(config) as ProviderV3

      const result = provider.imageModel(`openai${DEFAULT_SEPARATOR}dall-e-3`)

      expect(globalRegistryManagement.getProvider).toHaveBeenCalledWith('openai')
      expect(mockOpenAIProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
      expect(result).toBe(mockImageModel)
    })

    it('should handle different image providers', () => {
      const config: HubProviderConfig = { hubId: 'aihubmix' }
      const provider = createHubProvider(config) as ProviderV3

      provider.imageModel(`openai${DEFAULT_SEPARATOR}dall-e-3`)
      provider.imageModel(`anthropic${DEFAULT_SEPARATOR}image-gen`)

      expect(mockOpenAIProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
      expect(mockAnthropicProvider.imageModel).toHaveBeenCalledWith('image-gen')
    })
  })

  describe('Special Model Types', () => {
    it('should support transcription models', () => {
      const mockTranscriptionModel = {
        specificationVersion: 'v3',
        doTranscribe: vi.fn()
      }

      const providerWithTranscription = {
        ...mockOpenAIProvider,
        transcriptionModel: vi.fn().mockReturnValue(mockTranscriptionModel)
      } as ProviderV3

      vi.mocked(globalRegistryManagement.getProvider).mockReturnValue(providerWithTranscription)

      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      const result = provider.transcriptionModel!(`openai${DEFAULT_SEPARATOR}whisper-1`)

      expect(providerWithTranscription.transcriptionModel).toHaveBeenCalledWith('whisper-1')
      expect(result).toBe(mockTranscriptionModel)
    })

    it('should throw error if provider does not support transcription', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      expect(() => provider.transcriptionModel!(`openai${DEFAULT_SEPARATOR}whisper`)).toThrow(HubProviderError)
      expect(() => provider.transcriptionModel!(`openai${DEFAULT_SEPARATOR}whisper`)).toThrow(
        /does not support transcription/
      )
    })

    it('should support speech models', () => {
      const mockSpeechModel = {
        specificationVersion: 'v3',
        doGenerate: vi.fn()
      }

      const providerWithSpeech = {
        ...mockOpenAIProvider,
        speechModel: vi.fn().mockReturnValue(mockSpeechModel)
      } as ProviderV3

      vi.mocked(globalRegistryManagement.getProvider).mockReturnValue(providerWithSpeech)

      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      const result = provider.speechModel!(`openai${DEFAULT_SEPARATOR}tts-1`)

      expect(providerWithSpeech.speechModel).toHaveBeenCalledWith('tts-1')
      expect(result).toBe(mockSpeechModel)
    })

    it('should throw error if provider does not support speech', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      expect(() => provider.speechModel!(`openai${DEFAULT_SEPARATOR}tts-1`)).toThrow(HubProviderError)
      expect(() => provider.speechModel!(`openai${DEFAULT_SEPARATOR}tts-1`)).toThrow(/does not support speech/)
    })

    it('should support reranking models', () => {
      const mockRerankingModel = {
        specificationVersion: 'v3',
        doRerank: vi.fn()
      }

      const providerWithReranking = {
        ...mockOpenAIProvider,
        rerankingModel: vi.fn().mockReturnValue(mockRerankingModel)
      } as ProviderV3

      vi.mocked(globalRegistryManagement.getProvider).mockReturnValue(providerWithReranking)

      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      const result = provider.rerankingModel!(`openai${DEFAULT_SEPARATOR}rerank-v1`)

      expect(providerWithReranking.rerankingModel).toHaveBeenCalledWith('rerank-v1')
      expect(result).toBe(mockRerankingModel)
    })

    it('should throw error if provider does not support reranking', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      expect(() => provider.rerankingModel!(`openai${DEFAULT_SEPARATOR}rerank`)).toThrow(HubProviderError)
      expect(() => provider.rerankingModel!(`openai${DEFAULT_SEPARATOR}rerank`)).toThrow(/does not support reranking/)
    })
  })

  describe('Error Handling', () => {
    it('should create HubProviderError with all properties', () => {
      const originalError = new Error('Original error')
      const error = new HubProviderError('Test message', 'test-hub', 'test-provider', originalError)

      expect(error.message).toBe('Test message')
      expect(error.hubId).toBe('test-hub')
      expect(error.providerId).toBe('test-provider')
      expect(error.originalError).toBe(originalError)
      expect(error.name).toBe('HubProviderError')
    })

    it('should create HubProviderError without optional parameters', () => {
      const error = new HubProviderError('Test message', 'test-hub')

      expect(error.message).toBe('Test message')
      expect(error.hubId).toBe('test-hub')
      expect(error.providerId).toBeUndefined()
      expect(error.originalError).toBeUndefined()
    })

    it('should wrap provider errors in HubProviderError', () => {
      const providerError = new Error('Provider failed')
      vi.mocked(globalRegistryManagement.getProvider).mockImplementation(() => {
        throw providerError
      })

      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      try {
        provider.languageModel(`failing${DEFAULT_SEPARATOR}model`)
        expect.fail('Should have thrown HubProviderError')
      } catch (error) {
        expect(error).toBeInstanceOf(HubProviderError)
        const hubError = error as HubProviderError
        expect(hubError.originalError).toBe(providerError)
        expect(hubError.message).toContain('Failed to get provider')
      }
    })

    it('should handle null provider from registry', () => {
      vi.mocked(globalRegistryManagement.getProvider).mockReturnValue(null as any)

      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      expect(() => provider.languageModel(`null-provider${DEFAULT_SEPARATOR}model`)).toThrow(HubProviderError)
    })
  })

  describe('Multi-Provider Scenarios', () => {
    it('should handle sequential calls to different providers', () => {
      const config: HubProviderConfig = { hubId: 'aihubmix' }
      const provider = createHubProvider(config) as ProviderV3

      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)
      provider.languageModel(`anthropic${DEFAULT_SEPARATOR}claude-3`)
      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-3.5`)

      expect(globalRegistryManagement.getProvider).toHaveBeenCalledTimes(3)
      expect(mockOpenAIProvider.languageModel).toHaveBeenCalledTimes(2)
      expect(mockAnthropicProvider.languageModel).toHaveBeenCalledTimes(1)
    })

    it('should handle mixed model types from same provider', () => {
      const config: HubProviderConfig = { hubId: 'aihubmix' }
      const provider = createHubProvider(config) as ProviderV3

      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)
      provider.embeddingModel(`openai${DEFAULT_SEPARATOR}ada-002`)
      provider.imageModel(`openai${DEFAULT_SEPARATOR}dall-e-3`)

      expect(globalRegistryManagement.getProvider).toHaveBeenCalledTimes(3)
      expect(mockOpenAIProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(mockOpenAIProvider.embeddingModel).toHaveBeenCalledWith('ada-002')
      expect(mockOpenAIProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
    })

    it('should cache provider lookups', () => {
      const config: HubProviderConfig = { hubId: 'aihubmix' }
      const provider = createHubProvider(config) as ProviderV3

      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)
      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-3.5`)

      // Should call getProvider twice (once per model call)
      expect(globalRegistryManagement.getProvider).toHaveBeenCalledTimes(2)
    })
  })

  describe('Provider Wrapping', () => {
    it('should wrap all providers with empty middleware', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)

      expect(wrapProvider).toHaveBeenCalledWith({
        provider: mockOpenAIProvider,
        languageModelMiddleware: []
      })
    })

    it('should wrap providers for all model types', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)
      provider.embeddingModel(`openai${DEFAULT_SEPARATOR}ada`)
      provider.imageModel(`openai${DEFAULT_SEPARATOR}dalle`)

      expect(wrapProvider).toHaveBeenCalledTimes(3)
    })
  })

  describe('Type Safety', () => {
    it('should return properly typed LanguageModelV3', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      const result = provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doGenerate')
      expect(result).toHaveProperty('doStream')
    })

    it('should return properly typed EmbeddingModelV3', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      const result = provider.embeddingModel(`openai${DEFAULT_SEPARATOR}ada`)

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doEmbed')
    })

    it('should return properly typed ImageModelV3', () => {
      const config: HubProviderConfig = { hubId: 'test-hub' }
      const provider = createHubProvider(config) as ProviderV3

      const result = provider.imageModel(`openai${DEFAULT_SEPARATOR}dalle`)

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doGenerate')
    })
  })
})
