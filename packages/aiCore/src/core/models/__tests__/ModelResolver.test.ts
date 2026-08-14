/**
 * ProviderRegistry Model Resolution Tests
 * Tests model resolution via AI SDK's createProviderRegistry
 * The registry routes 'providerId:modelId' to the correct provider
 */

import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3 } from '@ai-sdk/provider'
import {
  createMockEmbeddingModel,
  createMockImageModel,
  createMockLanguageModel,
  createMockProviderV3
} from '@test-utils'
import { createProviderRegistry } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('ProviderRegistry Model Resolution', () => {
  let registry: ReturnType<typeof createProviderRegistry>
  let mockLanguageModel: LanguageModelV3
  let mockEmbeddingModel: EmbeddingModelV3
  let mockImageModel: ImageModelV3
  let mockProvider: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockLanguageModel = createMockLanguageModel({
      provider: 'test-provider',
      modelId: 'test-model'
    })

    mockEmbeddingModel = createMockEmbeddingModel({
      provider: 'test-provider',
      modelId: 'test-embedding'
    })

    mockImageModel = createMockImageModel({
      provider: 'test-provider',
      modelId: 'test-image'
    })

    mockProvider = createMockProviderV3({
      provider: 'test-provider',
      languageModel: vi.fn(() => mockLanguageModel),
      embeddingModel: vi.fn(() => mockEmbeddingModel),
      imageModel: vi.fn(() => mockImageModel)
    })

    registry = createProviderRegistry({
      'test-provider': mockProvider
    })
  })

  describe('languageModel', () => {
    it('should resolve modelId via provider registry', () => {
      const result = registry.languageModel('test-provider:gpt-4')

      expect(mockProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(result).toBe(mockLanguageModel)
    })

    it('should pass various modelIds to the correct provider', () => {
      const modelIds = [
        'claude-3-5-sonnet',
        'gemini-2.0-flash',
        'grok-2-latest',
        'deepseek-chat',
        'model-v1.0',
        'model_v2',
        'model.2024'
      ]

      for (const modelId of modelIds) {
        vi.clearAllMocks()
        registry.languageModel(`test-provider:${modelId}`)

        expect(mockProvider.languageModel).toHaveBeenCalledWith(modelId)
      }
    })

    it('should throw if provider throws', () => {
      const error = new Error('Model not found')
      vi.mocked(mockProvider.languageModel).mockImplementation(() => {
        throw error
      })

      expect(() => registry.languageModel('test-provider:invalid-model')).toThrow('Model not found')
    })

    it('should handle concurrent resolution requests', () => {
      const results = [
        registry.languageModel('test-provider:gpt-4'),
        registry.languageModel('test-provider:claude-3'),
        registry.languageModel('test-provider:gemini-2.0')
      ]

      expect(results).toHaveLength(3)
      expect(mockProvider.languageModel).toHaveBeenCalledTimes(3)
    })

    it('should throw for unknown provider', () => {
      expect(() => registry.languageModel('unknown:gpt-4' as `${string}:${string}`)).toThrow()
    })
  })

  describe('embeddingModel', () => {
    it('should resolve embedding model ID', () => {
      const result = registry.embeddingModel('test-provider:text-embedding-ada-002')

      expect(mockProvider.embeddingModel).toHaveBeenCalledWith('text-embedding-ada-002')
      expect(result).toBe(mockEmbeddingModel)
    })

    it('should resolve different embedding models', () => {
      const modelIds = ['text-embedding-3-small', 'text-embedding-3-large', 'embed-english-v3.0', 'voyage-2']

      for (const modelId of modelIds) {
        vi.clearAllMocks()
        registry.embeddingModel(`test-provider:${modelId}`)

        expect(mockProvider.embeddingModel).toHaveBeenCalledWith(modelId)
      }
    })
  })

  describe('imageModel', () => {
    it('should resolve image model ID', () => {
      const result = registry.imageModel('test-provider:dall-e-3')

      expect(mockProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
      expect(result).toBe(mockImageModel)
    })

    it('should resolve different image models', () => {
      const modelIds = ['dall-e-2', 'stable-diffusion-xl', 'imagen-2', 'grok-2-image']

      for (const modelId of modelIds) {
        vi.clearAllMocks()
        registry.imageModel(`test-provider:${modelId}`)

        expect(mockProvider.imageModel).toHaveBeenCalledWith(modelId)
      }
    })
  })

  describe('Type Safety', () => {
    it('should return properly typed LanguageModelV3', () => {
      const result = registry.languageModel('test-provider:gpt-4')

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doGenerate')
      expect(result).toHaveProperty('doStream')
    })

    it('should return properly typed EmbeddingModelV3', () => {
      const result = registry.embeddingModel('test-provider:text-embedding-ada-002')

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doEmbed')
    })

    it('should return properly typed ImageModelV3', () => {
      const result = registry.imageModel('test-provider:dall-e-3')

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doGenerate')
    })
  })

  describe('Multi-provider registry', () => {
    it('should route to correct provider in multi-provider registry', () => {
      const mockProvider2 = createMockProviderV3({
        provider: 'second-provider',
        languageModel: vi.fn(() =>
          createMockLanguageModel({
            provider: 'second-provider',
            modelId: 'other-model'
          })
        )
      })

      const multiRegistry = createProviderRegistry({
        first: mockProvider,
        second: mockProvider2
      })

      multiRegistry.languageModel('first:gpt-4')
      multiRegistry.languageModel('second:other-model')

      expect(mockProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(mockProvider2.languageModel).toHaveBeenCalledWith('other-model')
    })
  })

  describe('All model types for same provider', () => {
    it('should handle all model types correctly', () => {
      registry.languageModel('test-provider:gpt-4')
      registry.embeddingModel('test-provider:text-embedding-3-small')
      registry.imageModel('test-provider:dall-e-3')

      expect(mockProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(mockProvider.embeddingModel).toHaveBeenCalledWith('text-embedding-3-small')
      expect(mockProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
    })
  })
})
