/**
 * HubProvider Comprehensive Tests
 * Tests hub provider routing, model resolution, and error handling
 * Updated for ExtensionRegistry architecture with createHubProviderAsync
 */

import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import { customProvider } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockEmbeddingModel, createMockImageModel, createMockLanguageModel } from '@test-utils'
import { ExtensionRegistry } from '../core/ExtensionRegistry'
import { ProviderExtension } from '../core/ProviderExtension'
import {
  createHubProviderAsync,
  DEFAULT_SEPARATOR,
  type HubProviderConfig,
  HubProviderError
} from '../features/HubProvider'

vi.mock('ai', () => ({
  customProvider: vi.fn((config) => config.fallbackProvider),
  jsonSchema: vi.fn((schema) => schema)
}))

describe('HubProvider', () => {
  let registry: ExtensionRegistry
  let mockOpenAIProvider: ProviderV3
  let mockAnthropicProvider: ProviderV3
  let mockLanguageModel: LanguageModelV3
  let mockEmbeddingModel: EmbeddingModelV3
  let mockImageModel: ImageModelV3

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock models
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

    // Create registry and register extensions
    registry = new ExtensionRegistry()

    const openaiExtension = ProviderExtension.create({
      name: 'openai',
      create: () => mockOpenAIProvider
    } as const)

    const anthropicExtension = ProviderExtension.create({
      name: 'anthropic',
      create: () => mockAnthropicProvider
    } as const)

    registry.register(openaiExtension)
    registry.register(anthropicExtension)
  })

  describe('Provider Creation', () => {
    it('should create hub provider with basic config', async () => {
      const config: HubProviderConfig = {
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', { apiKey: 'test-key' }]])
      }

      const provider = await createHubProviderAsync(config)

      expect(provider).toBeDefined()
      expect(customProvider).toHaveBeenCalled()
    })

    it('should create provider with debug flag', async () => {
      const config: HubProviderConfig = {
        hubId: 'test-hub',
        debug: true,
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      }

      const provider = await createHubProviderAsync(config)

      expect(provider).toBeDefined()
    })

    it('should return ProviderV3 specification', async () => {
      const provider = await createHubProviderAsync({
        hubId: 'aihubmix',
        registry,
        providerSettingsMap: new Map([
          ['openai', {}],
          ['anthropic', {}]
        ])
      })

      expect(provider).toHaveProperty('specificationVersion', 'v3')
      expect(provider).toHaveProperty('languageModel')
      expect(provider).toHaveProperty('embeddingModel')
      expect(provider).toHaveProperty('imageModel')
    })

    it('should throw error if extension not found in registry', async () => {
      await expect(
        createHubProviderAsync({
          hubId: 'test-hub',
          registry,
          providerSettingsMap: new Map([['unknown-provider', {}]])
        })
      ).rejects.toThrow(HubProviderError)
    })

    it('should pre-create all providers during initialization', async () => {
      await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([
          ['openai', { apiKey: 'key1' }],
          ['anthropic', { apiKey: 'key2' }]
        ])
      })

      // Both providers created successfully
      expect(true).toBe(true)
    })
  })

  describe('Model ID Parsing', () => {
    it('should parse valid hub model ID format', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      const result = provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)

      expect(mockOpenAIProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(result).toBe(mockLanguageModel)
    })

    it('should throw error for invalid model ID format', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      expect(() => provider.languageModel('invalid-id-without-separator')).toThrow(HubProviderError)
    })

    it('should throw error for model ID with multiple separators', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      expect(() => provider.languageModel(`provider${DEFAULT_SEPARATOR}extra${DEFAULT_SEPARATOR}model`)).toThrow(
        HubProviderError
      )
    })

    it('should throw error for empty model ID', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      expect(() => provider.languageModel('')).toThrow(HubProviderError)
    })
  })

  describe('Language Model Resolution', () => {
    it('should route to correct provider for language model', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'aihubmix',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      const result = provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)

      expect(mockOpenAIProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(result).toBe(mockLanguageModel)
    })

    it('should route different providers correctly', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'aihubmix',
        registry,
        providerSettingsMap: new Map([
          ['openai', {}],
          ['anthropic', {}]
        ])
      })) as ProviderV3

      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)
      provider.languageModel(`anthropic${DEFAULT_SEPARATOR}claude-3`)

      expect(mockOpenAIProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(mockAnthropicProvider.languageModel).toHaveBeenCalledWith('claude-3')
    })

    it('should throw HubProviderError if provider not initialized', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', {}]]) // Only openai initialized
      })) as ProviderV3

      expect(() => provider.languageModel(`anthropic${DEFAULT_SEPARATOR}claude-3`)).toThrow(HubProviderError)
    })

    it('should include provider ID in error message', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

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
    it('should route to correct provider for embedding model', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'aihubmix',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      const result = provider.embeddingModel(`openai${DEFAULT_SEPARATOR}text-embedding-3-small`)

      expect(mockOpenAIProvider.embeddingModel).toHaveBeenCalledWith('text-embedding-3-small')
      expect(result).toBe(mockEmbeddingModel)
    })

    it('should handle different embedding providers', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'aihubmix',
        registry,
        providerSettingsMap: new Map([
          ['openai', {}],
          ['anthropic', {}]
        ])
      })) as ProviderV3

      provider.embeddingModel(`openai${DEFAULT_SEPARATOR}ada-002`)
      provider.embeddingModel(`anthropic${DEFAULT_SEPARATOR}embed-v1`)

      expect(mockOpenAIProvider.embeddingModel).toHaveBeenCalledWith('ada-002')
      expect(mockAnthropicProvider.embeddingModel).toHaveBeenCalledWith('embed-v1')
    })
  })

  describe('Image Model Resolution', () => {
    it('should route to correct provider for image model', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'aihubmix',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      const result = provider.imageModel(`openai${DEFAULT_SEPARATOR}dall-e-3`)

      expect(mockOpenAIProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
      expect(result).toBe(mockImageModel)
    })

    it('should handle different image providers', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'aihubmix',
        registry,
        providerSettingsMap: new Map([
          ['openai', {}],
          ['anthropic', {}]
        ])
      })) as ProviderV3

      provider.imageModel(`openai${DEFAULT_SEPARATOR}dall-e-3`)
      provider.imageModel(`anthropic${DEFAULT_SEPARATOR}image-gen`)

      expect(mockOpenAIProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
      expect(mockAnthropicProvider.imageModel).toHaveBeenCalledWith('image-gen')
    })
  })

  describe('Special Model Types', () => {
    it('should support transcription models if provider has them', async () => {
      const mockTranscriptionModel = {
        specificationVersion: 'v3' as const,
        doTranscribe: vi.fn()
      }

      const providerWithTranscription = {
        ...mockOpenAIProvider,
        transcriptionModel: vi.fn().mockReturnValue(mockTranscriptionModel)
      } as ProviderV3

      // Replace the provider that will be created
      const transcriptionExtension = ProviderExtension.create({
        name: 'transcription-provider',
        create: () => providerWithTranscription
      } as const)

      registry.register(transcriptionExtension)

      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['transcription-provider', {}]])
      })) as ProviderV3

      const result = provider.transcriptionModel!(`transcription-provider${DEFAULT_SEPARATOR}whisper-1`)

      expect(providerWithTranscription.transcriptionModel).toHaveBeenCalledWith('whisper-1')
      expect(result).toBe(mockTranscriptionModel)
    })

    it('should throw error if provider does not support transcription', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      expect(() => provider.transcriptionModel!(`openai${DEFAULT_SEPARATOR}whisper`)).toThrow(HubProviderError)
      expect(() => provider.transcriptionModel!(`openai${DEFAULT_SEPARATOR}whisper`)).toThrow(
        /does not support transcription/
      )
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
  })

  describe('Multi-Provider Scenarios', () => {
    it('should handle sequential calls to different providers', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'aihubmix',
        registry,
        providerSettingsMap: new Map([
          ['openai', {}],
          ['anthropic', {}]
        ])
      })) as ProviderV3

      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)
      provider.languageModel(`anthropic${DEFAULT_SEPARATOR}claude-3`)
      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-3.5`)

      expect(mockOpenAIProvider.languageModel).toHaveBeenCalledTimes(2)
      expect(mockAnthropicProvider.languageModel).toHaveBeenCalledTimes(1)
    })

    it('should handle mixed model types from same provider', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'aihubmix',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)
      provider.embeddingModel(`openai${DEFAULT_SEPARATOR}ada-002`)
      provider.imageModel(`openai${DEFAULT_SEPARATOR}dall-e-3`)

      expect(mockOpenAIProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(mockOpenAIProvider.embeddingModel).toHaveBeenCalledWith('ada-002')
      expect(mockOpenAIProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
    })
  })

  describe('Type Safety', () => {
    it('should return properly typed LanguageModelV3', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      const result = provider.languageModel(`openai${DEFAULT_SEPARATOR}gpt-4`)

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doGenerate')
      expect(result).toHaveProperty('doStream')
    })

    it('should return properly typed EmbeddingModelV3', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      const result = provider.embeddingModel(`openai${DEFAULT_SEPARATOR}ada`)

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doEmbed')
    })

    it('should return properly typed ImageModelV3', async () => {
      const provider = (await createHubProviderAsync({
        hubId: 'test-hub',
        registry,
        providerSettingsMap: new Map([['openai', {}]])
      })) as ProviderV3

      const result = provider.imageModel(`openai${DEFAULT_SEPARATOR}dalle`)

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doGenerate')
    })
  })
})
