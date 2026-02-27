/**
 * ModelResolver Tests
 * Tests model resolution logic for language, embedding, and image models
 * The resolver passes modelId directly to provider - all routing is handled by the provider
 */

import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3 } from '@ai-sdk/provider'
import {
  createMockEmbeddingModel,
  createMockImageModel,
  createMockLanguageModel,
  createMockProviderV3
} from '@test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelResolver } from '../ModelResolver'

vi.mock('../../middleware/wrapper', () => ({
  wrapModelWithMiddlewares: vi.fn((model: LanguageModelV3) => {
    return {
      ...model,
      _wrapped: true
    } as LanguageModelV3
  })
}))

describe('ModelResolver', () => {
  let resolver: ModelResolver
  let mockLanguageModel: LanguageModelV3
  let mockEmbeddingModel: EmbeddingModelV3
  let mockImageModel: ImageModelV3
  let mockProvider: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Create properly typed mock models
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

    // Create mock provider with model methods as spies
    mockProvider = createMockProviderV3({
      provider: 'test-provider',
      languageModel: vi.fn(() => mockLanguageModel),
      embeddingModel: vi.fn(() => mockEmbeddingModel),
      imageModel: vi.fn(() => mockImageModel)
    })

    // Create resolver with mock provider
    resolver = new ModelResolver(mockProvider)
  })

  describe('resolveLanguageModel', () => {
    it('should resolve modelId by passing it to provider', async () => {
      const result = await resolver.resolveLanguageModel('gpt-4')

      expect(mockProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(result).toBe(mockLanguageModel)
    })

    it('should pass various modelIds directly to provider', async () => {
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
        await resolver.resolveLanguageModel(modelId)

        expect(mockProvider.languageModel).toHaveBeenCalledWith(modelId)
      }
    })

    it('should pass namespaced modelIds directly to provider (provider handles routing)', async () => {
      // HubProvider handles routing internally - ModelResolver just passes through
      const namespacedId = 'openai|gpt-4'

      await resolver.resolveLanguageModel(namespacedId)

      expect(mockProvider.languageModel).toHaveBeenCalledWith(namespacedId)
    })

    it('should handle empty model IDs', async () => {
      await resolver.resolveLanguageModel('')

      expect(mockProvider.languageModel).toHaveBeenCalledWith('')
    })

    it('should throw if provider throws', async () => {
      const error = new Error('Model not found')
      vi.mocked(mockProvider.languageModel).mockImplementation(() => {
        throw error
      })

      await expect(resolver.resolveLanguageModel('invalid-model')).rejects.toThrow('Model not found')
    })

    it('should handle concurrent resolution requests', async () => {
      const promises = [
        resolver.resolveLanguageModel('gpt-4'),
        resolver.resolveLanguageModel('claude-3'),
        resolver.resolveLanguageModel('gemini-2.0')
      ]

      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      expect(mockProvider.languageModel).toHaveBeenCalledTimes(3)
    })
  })

  describe('resolveEmbeddingModel', () => {
    it('should resolve embedding model ID', async () => {
      const result = await resolver.resolveEmbeddingModel('text-embedding-ada-002')

      expect(mockProvider.embeddingModel).toHaveBeenCalledWith('text-embedding-ada-002')
      expect(result).toBe(mockEmbeddingModel)
    })

    it('should resolve different embedding models', async () => {
      const modelIds = ['text-embedding-3-small', 'text-embedding-3-large', 'embed-english-v3.0', 'voyage-2']

      for (const modelId of modelIds) {
        vi.clearAllMocks()
        await resolver.resolveEmbeddingModel(modelId)

        expect(mockProvider.embeddingModel).toHaveBeenCalledWith(modelId)
      }
    })

    it('should pass namespaced embedding modelIds directly to provider', async () => {
      const namespacedId = 'openai|text-embedding-3-small'

      await resolver.resolveEmbeddingModel(namespacedId)

      expect(mockProvider.embeddingModel).toHaveBeenCalledWith(namespacedId)
    })
  })

  describe('resolveImageModel', () => {
    it('should resolve image model ID', async () => {
      const result = await resolver.resolveImageModel('dall-e-3')

      expect(mockProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
      expect(result).toBe(mockImageModel)
    })

    it('should resolve different image models', async () => {
      const modelIds = ['dall-e-2', 'stable-diffusion-xl', 'imagen-2', 'grok-2-image']

      for (const modelId of modelIds) {
        vi.clearAllMocks()
        await resolver.resolveImageModel(modelId)

        expect(mockProvider.imageModel).toHaveBeenCalledWith(modelId)
      }
    })

    it('should pass namespaced image modelIds directly to provider', async () => {
      const namespacedId = 'openai|dall-e-3'

      await resolver.resolveImageModel(namespacedId)

      expect(mockProvider.imageModel).toHaveBeenCalledWith(namespacedId)
    })
  })

  describe('Type Safety', () => {
    it('should return properly typed LanguageModelV3', async () => {
      const result = await resolver.resolveLanguageModel('gpt-4')

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doGenerate')
      expect(result).toHaveProperty('doStream')
    })

    it('should return properly typed EmbeddingModelV3', async () => {
      const result = await resolver.resolveEmbeddingModel('text-embedding-ada-002')

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doEmbed')
    })

    it('should return properly typed ImageModelV3', async () => {
      const result = await resolver.resolveImageModel('dall-e-3')

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doGenerate')
    })
  })

  describe('All model types for same provider', () => {
    it('should handle all model types correctly', async () => {
      await resolver.resolveLanguageModel('gpt-4')
      await resolver.resolveEmbeddingModel('text-embedding-3-small')
      await resolver.resolveImageModel('dall-e-3')

      expect(mockProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(mockProvider.embeddingModel).toHaveBeenCalledWith('text-embedding-3-small')
      expect(mockProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
    })
  })
})
