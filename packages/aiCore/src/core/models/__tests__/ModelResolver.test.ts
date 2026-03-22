/**
 * ModelResolver Comprehensive Tests
 * Tests model resolution logic for language, embedding, and image models
 * Covers both traditional and namespaced format resolution
 */

import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3 } from '@ai-sdk/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockEmbeddingModel, createMockImageModel, createMockLanguageModel } from '../../../__tests__'
import { DEFAULT_SEPARATOR, globalRegistryManagement } from '../../providers/RegistryManagement'
import { ModelResolver } from '../ModelResolver'

// Mock the dependencies
vi.mock('../../providers/RegistryManagement', () => ({
  globalRegistryManagement: {
    languageModel: vi.fn(),
    embeddingModel: vi.fn(),
    imageModel: vi.fn()
  },
  DEFAULT_SEPARATOR: '|'
}))

vi.mock('../../middleware/wrapper', () => ({
  wrapModelWithMiddlewares: vi.fn((model: LanguageModelV3) => {
    // Return a wrapped model with a marker
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

  beforeEach(() => {
    vi.clearAllMocks()
    resolver = new ModelResolver()

    // Create properly typed mock models using global utilities
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

    // Setup default mock implementations
    vi.mocked(globalRegistryManagement.languageModel).mockReturnValue(mockLanguageModel)
    vi.mocked(globalRegistryManagement.embeddingModel).mockReturnValue(mockEmbeddingModel)
    vi.mocked(globalRegistryManagement.imageModel).mockReturnValue(mockImageModel)
  })

  describe('resolveLanguageModel', () => {
    describe('Traditional Format Resolution', () => {
      it('should resolve traditional format modelId without separator', async () => {
        const result = await resolver.resolveLanguageModel('gpt-4', 'openai')

        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(`openai${DEFAULT_SEPARATOR}gpt-4`)
        expect(result).toBe(mockLanguageModel)
      })

      it('should resolve with different provider and modelId combinations', async () => {
        const testCases: Array<{ modelId: string; providerId: string; expected: string }> = [
          { modelId: 'claude-3-5-sonnet', providerId: 'anthropic', expected: 'anthropic|claude-3-5-sonnet' },
          { modelId: 'gemini-2.0-flash', providerId: 'google', expected: 'google|gemini-2.0-flash' },
          { modelId: 'grok-2-latest', providerId: 'xai', expected: 'xai|grok-2-latest' },
          { modelId: 'deepseek-chat', providerId: 'deepseek', expected: 'deepseek|deepseek-chat' }
        ]

        for (const testCase of testCases) {
          vi.clearAllMocks()
          await resolver.resolveLanguageModel(testCase.modelId, testCase.providerId)

          expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(testCase.expected)
        }
      })

      it('should handle modelIds with special characters', async () => {
        const modelIds = ['model-v1.0', 'model_v2', 'model.2024', 'model:free']

        for (const modelId of modelIds) {
          vi.clearAllMocks()
          await resolver.resolveLanguageModel(modelId, 'provider')

          expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(`provider${DEFAULT_SEPARATOR}${modelId}`)
        }
      })
    })

    describe('Namespaced Format Resolution', () => {
      it('should resolve namespaced format with hub', async () => {
        const namespacedId = `aihubmix${DEFAULT_SEPARATOR}anthropic${DEFAULT_SEPARATOR}claude-3-5-sonnet`

        const result = await resolver.resolveLanguageModel(namespacedId, 'openai')

        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(namespacedId)
        expect(result).toBe(mockLanguageModel)
      })

      it('should resolve simple namespaced format', async () => {
        const namespacedId = `provider${DEFAULT_SEPARATOR}model-id`

        await resolver.resolveLanguageModel(namespacedId, 'fallback-provider')

        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(namespacedId)
      })

      it('should handle complex namespaced IDs', async () => {
        const complexIds = [
          `hub${DEFAULT_SEPARATOR}provider${DEFAULT_SEPARATOR}model`,
          `hub${DEFAULT_SEPARATOR}provider${DEFAULT_SEPARATOR}model-v1.0`,
          `custom${DEFAULT_SEPARATOR}openai${DEFAULT_SEPARATOR}gpt-4-turbo`
        ]

        for (const id of complexIds) {
          vi.clearAllMocks()
          await resolver.resolveLanguageModel(id, 'fallback')

          expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(id)
        }
      })
    })

    describe('OpenAI Mode Selection', () => {
      it('should append "-chat" suffix for OpenAI provider with chat mode', async () => {
        await resolver.resolveLanguageModel('gpt-4', 'openai', { mode: 'chat' })

        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('openai-chat|gpt-4')
      })

      it('should append "-chat" suffix for Azure provider with chat mode', async () => {
        await resolver.resolveLanguageModel('gpt-4', 'azure', { mode: 'chat' })

        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('azure-chat|gpt-4')
      })

      it('should not append suffix for OpenAI with responses mode', async () => {
        await resolver.resolveLanguageModel('gpt-4', 'openai', { mode: 'responses' })

        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('openai|gpt-4')
      })

      it('should not append suffix for OpenAI without mode', async () => {
        await resolver.resolveLanguageModel('gpt-4', 'openai')

        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('openai|gpt-4')
      })

      it('should not append suffix for other providers with chat mode', async () => {
        await resolver.resolveLanguageModel('claude-3', 'anthropic', { mode: 'chat' })

        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('anthropic|claude-3')
      })

      it('should handle namespaced IDs with OpenAI chat mode', async () => {
        const namespacedId = `hub${DEFAULT_SEPARATOR}openai${DEFAULT_SEPARATOR}gpt-4`

        await resolver.resolveLanguageModel(namespacedId, 'openai', { mode: 'chat' })

        // Should use the namespaced ID directly, not apply mode logic
        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(namespacedId)
      })
    })

    describe('Provider Options Handling', () => {
      it('should pass provider options correctly', async () => {
        const options = { baseURL: 'https://api.example.com', apiKey: 'test-key' }

        await resolver.resolveLanguageModel('gpt-4', 'openai', options)

        // Provider options are used for mode selection logic
        expect(globalRegistryManagement.languageModel).toHaveBeenCalled()
      })

      it('should handle empty provider options', async () => {
        await resolver.resolveLanguageModel('gpt-4', 'openai', {})

        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('openai|gpt-4')
      })

      it('should handle undefined provider options', async () => {
        await resolver.resolveLanguageModel('gpt-4', 'openai', undefined)

        expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('openai|gpt-4')
      })
    })
  })

  describe('resolveTextEmbeddingModel', () => {
    describe('Traditional Format', () => {
      it('should resolve traditional embedding model ID', async () => {
        const result = await resolver.resolveTextEmbeddingModel('text-embedding-ada-002', 'openai')

        expect(globalRegistryManagement.embeddingModel).toHaveBeenCalledWith('openai|text-embedding-ada-002')
        expect(result).toBe(mockEmbeddingModel)
      })

      it('should resolve different embedding models', async () => {
        const testCases = [
          { modelId: 'text-embedding-3-small', providerId: 'openai' },
          { modelId: 'text-embedding-3-large', providerId: 'openai' },
          { modelId: 'embed-english-v3.0', providerId: 'cohere' },
          { modelId: 'voyage-2', providerId: 'voyage' }
        ]

        for (const { modelId, providerId } of testCases) {
          vi.clearAllMocks()
          await resolver.resolveTextEmbeddingModel(modelId, providerId)

          expect(globalRegistryManagement.embeddingModel).toHaveBeenCalledWith(`${providerId}|${modelId}`)
        }
      })
    })

    describe('Namespaced Format', () => {
      it('should resolve namespaced embedding model ID', async () => {
        const namespacedId = `aihubmix${DEFAULT_SEPARATOR}openai${DEFAULT_SEPARATOR}text-embedding-3-small`

        const result = await resolver.resolveTextEmbeddingModel(namespacedId, 'openai')

        expect(globalRegistryManagement.embeddingModel).toHaveBeenCalledWith(namespacedId)
        expect(result).toBe(mockEmbeddingModel)
      })

      it('should handle complex namespaced embedding IDs', async () => {
        const complexIds = [
          `hub${DEFAULT_SEPARATOR}cohere${DEFAULT_SEPARATOR}embed-multilingual`,
          `custom${DEFAULT_SEPARATOR}provider${DEFAULT_SEPARATOR}embedding-model`
        ]

        for (const id of complexIds) {
          vi.clearAllMocks()
          await resolver.resolveTextEmbeddingModel(id, 'fallback')

          expect(globalRegistryManagement.embeddingModel).toHaveBeenCalledWith(id)
        }
      })
    })
  })

  describe('resolveImageModel', () => {
    describe('Traditional Format', () => {
      it('should resolve traditional image model ID', async () => {
        const result = await resolver.resolveImageModel('dall-e-3', 'openai')

        expect(globalRegistryManagement.imageModel).toHaveBeenCalledWith('openai|dall-e-3')
        expect(result).toBe(mockImageModel)
      })

      it('should resolve different image models', async () => {
        const testCases = [
          { modelId: 'dall-e-2', providerId: 'openai' },
          { modelId: 'stable-diffusion-xl', providerId: 'stability' },
          { modelId: 'imagen-2', providerId: 'google' },
          { modelId: 'midjourney-v6', providerId: 'midjourney' }
        ]

        for (const { modelId, providerId } of testCases) {
          vi.clearAllMocks()
          await resolver.resolveImageModel(modelId, providerId)

          expect(globalRegistryManagement.imageModel).toHaveBeenCalledWith(`${providerId}|${modelId}`)
        }
      })
    })

    describe('Namespaced Format', () => {
      it('should resolve namespaced image model ID', async () => {
        const namespacedId = `aihubmix${DEFAULT_SEPARATOR}openai${DEFAULT_SEPARATOR}dall-e-3`

        const result = await resolver.resolveImageModel(namespacedId, 'openai')

        expect(globalRegistryManagement.imageModel).toHaveBeenCalledWith(namespacedId)
        expect(result).toBe(mockImageModel)
      })

      it('should handle complex namespaced image IDs', async () => {
        const complexIds = [
          `hub${DEFAULT_SEPARATOR}stability${DEFAULT_SEPARATOR}sdxl-turbo`,
          `custom${DEFAULT_SEPARATOR}provider${DEFAULT_SEPARATOR}image-gen-v2`
        ]

        for (const id of complexIds) {
          vi.clearAllMocks()
          await resolver.resolveImageModel(id, 'fallback')

          expect(globalRegistryManagement.imageModel).toHaveBeenCalledWith(id)
        }
      })
    })
  })

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle empty model IDs', async () => {
      await resolver.resolveLanguageModel('', 'openai')

      expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('openai|')
    })

    it('should handle model IDs with multiple separators', async () => {
      const multiSeparatorId = `hub${DEFAULT_SEPARATOR}sub${DEFAULT_SEPARATOR}provider${DEFAULT_SEPARATOR}model`

      await resolver.resolveLanguageModel(multiSeparatorId, 'fallback')

      expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(multiSeparatorId)
    })

    it('should handle model IDs with only separator', async () => {
      const onlySeparator = DEFAULT_SEPARATOR

      await resolver.resolveLanguageModel(onlySeparator, 'provider')

      expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(onlySeparator)
    })

    it('should throw if globalRegistryManagement throws', async () => {
      const error = new Error('Model not found in registry')
      vi.mocked(globalRegistryManagement.languageModel).mockImplementation(() => {
        throw error
      })

      await expect(resolver.resolveLanguageModel('invalid-model', 'openai')).rejects.toThrow(
        'Model not found in registry'
      )
    })

    it('should handle concurrent resolution requests', async () => {
      const promises = [
        resolver.resolveLanguageModel('gpt-4', 'openai'),
        resolver.resolveLanguageModel('claude-3', 'anthropic'),
        resolver.resolveLanguageModel('gemini-2.0', 'google')
      ]

      const results = await Promise.all(promises)

      expect(results).toHaveLength(3)
      expect(globalRegistryManagement.languageModel).toHaveBeenCalledTimes(3)
    })
  })

  describe('Type Safety', () => {
    it('should return properly typed LanguageModelV3', async () => {
      const result = await resolver.resolveLanguageModel('gpt-4', 'openai')

      // Type assertions
      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doGenerate')
      expect(result).toHaveProperty('doStream')
    })

    it('should return properly typed EmbeddingModelV3', async () => {
      const result = await resolver.resolveTextEmbeddingModel('text-embedding-ada-002', 'openai')

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doEmbed')
    })

    it('should return properly typed ImageModelV3', async () => {
      const result = await resolver.resolveImageModel('dall-e-3', 'openai')

      expect(result.specificationVersion).toBe('v3')
      expect(result).toHaveProperty('doGenerate')
    })
  })

  describe('Global ModelResolver Instance', () => {
    it('should have a global instance available', async () => {
      const { globalModelResolver } = await import('../ModelResolver')

      expect(globalModelResolver).toBeInstanceOf(ModelResolver)
    })
  })

  describe('Integration with Different Provider Types', () => {
    it('should work with OpenAI compatible providers', async () => {
      await resolver.resolveLanguageModel('custom-model', 'openai-compatible')

      expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('openai-compatible|custom-model')
    })

    it('should work with hub providers', async () => {
      const hubId = `aihubmix${DEFAULT_SEPARATOR}custom${DEFAULT_SEPARATOR}model-v1`

      await resolver.resolveLanguageModel(hubId, 'aihubmix')

      expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(hubId)
    })

    it('should handle all model types for same provider', async () => {
      const providerId = 'openai'
      const languageModel = 'gpt-4'
      const embeddingModel = 'text-embedding-3-small'
      const imageModel = 'dall-e-3'

      await resolver.resolveLanguageModel(languageModel, providerId)
      await resolver.resolveTextEmbeddingModel(embeddingModel, providerId)
      await resolver.resolveImageModel(imageModel, providerId)

      expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith(`${providerId}|${languageModel}`)
      expect(globalRegistryManagement.embeddingModel).toHaveBeenCalledWith(`${providerId}|${embeddingModel}`)
      expect(globalRegistryManagement.imageModel).toHaveBeenCalledWith(`${providerId}|${imageModel}`)
    })
  })
})
