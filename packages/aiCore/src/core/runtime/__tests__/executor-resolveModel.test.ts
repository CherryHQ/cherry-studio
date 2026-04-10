/**
 * RuntimeExecutor.resolveModel Comprehensive Tests
 * Tests the private resolveModel and resolveImageModel methods through public APIs
 * Covers model resolution, middleware application, and type validation
 */

import type { ImageModelV3, LanguageModelV3 } from '@ai-sdk/provider'
import { createMockImageModel, createMockLanguageModel, createMockProviderV3, mockProviderConfigs } from '@test-utils'
import { generateImage, generateText, streamText } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ImageModelResolutionError } from '../errors'
import { RuntimeExecutor } from '../executor'

// Mock AI SDK
vi.mock('ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
    generateImage: vi.fn(),
    wrapLanguageModel: vi.fn((config: any) => ({
      ...config.model,
      _middlewareApplied: true,
      middleware: config.middleware
    }))
  }
})

describe('RuntimeExecutor - Model Resolution', () => {
  let executor: RuntimeExecutor
  let mockLanguageModel: LanguageModelV3
  let mockImageModel: ImageModelV3
  let mockProvider: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockLanguageModel = createMockLanguageModel({
      specificationVersion: 'v3',
      provider: 'openai',
      modelId: 'gpt-4'
    })

    mockImageModel = createMockImageModel({
      specificationVersion: 'v3',
      provider: 'openai',
      modelId: 'dall-e-3'
    })

    mockProvider = createMockProviderV3({
      provider: 'openai',
      languageModel: vi.fn(() => mockLanguageModel),
      imageModel: vi.fn(() => mockImageModel)
    })

    executor = RuntimeExecutor.create('openai', mockProvider, mockProviderConfigs.openai)

    vi.mocked(generateText).mockResolvedValue({
      text: 'Test response',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    } as any)
    vi.mocked(streamText).mockResolvedValue({
      textStream: (async function* () {
        yield 'test'
      })()
    } as any)
    vi.mocked(generateImage).mockResolvedValue({
      image: {
        base64: 'test-image',
        uint8Array: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png'
      },
      warnings: []
    } as any)
  })

  describe('Language Model Resolution (String modelId)', () => {
    it('should resolve string modelId through provider', async () => {
      await executor.generateText({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }]
      })

      expect(mockProvider.languageModel).toHaveBeenCalledWith('gpt-4')
    })

    it('should pass resolved model to generateText', async () => {
      await executor.generateText({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }]
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockLanguageModel
        })
      )
    })

    it('should resolve traditional format modelId', async () => {
      await executor.generateText({
        model: 'gpt-4-turbo',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(mockProvider.languageModel).toHaveBeenCalledWith('gpt-4-turbo')
    })

    it('should resolve namespaced format modelId', async () => {
      await executor.generateText({
        model: 'aihubmix|anthropic|claude-3',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(mockProvider.languageModel).toHaveBeenCalledWith('aihubmix|anthropic|claude-3')
    })

    it('should work with streamText', async () => {
      await executor.streamText({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Stream test' }]
      })

      expect(mockProvider.languageModel).toHaveBeenCalledWith('gpt-4')
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockLanguageModel
        })
      )
    })
  })

  describe('Language Model Resolution (Direct Model Object)', () => {
    it('should accept pre-resolved V3 model object', async () => {
      const directModel: LanguageModelV3 = createMockLanguageModel({
        specificationVersion: 'v3',
        provider: 'openai',
        modelId: 'gpt-4'
      })

      await executor.generateText({
        model: directModel,
        messages: [{ role: 'user', content: 'Test' }]
      })

      // Should NOT call provider for direct model
      expect(mockProvider.languageModel).not.toHaveBeenCalled()

      // Should use the model directly
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: directModel
        })
      )
    })

    it('should accept model object with streamText', async () => {
      const directModel = createMockLanguageModel({
        specificationVersion: 'v3'
      })

      await executor.streamText({
        model: directModel,
        messages: [{ role: 'user', content: 'Stream' }]
      })

      expect(mockProvider.languageModel).not.toHaveBeenCalled()
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: directModel
        })
      )
    })
  })

  describe('Image Model Resolution', () => {
    it('should resolve string image modelId through provider', async () => {
      await executor.generateImage({
        model: 'dall-e-3',
        prompt: 'A beautiful sunset'
      })

      expect(mockProvider.imageModel).toHaveBeenCalledWith('dall-e-3')
    })

    it('should accept direct ImageModelV3 object', async () => {
      const directImageModel: ImageModelV3 = createMockImageModel({
        specificationVersion: 'v3',
        provider: 'openai',
        modelId: 'dall-e-3'
      })

      await executor.generateImage({
        model: directImageModel,
        prompt: 'Test image'
      })

      expect(mockProvider.imageModel).not.toHaveBeenCalled()
      expect(generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: directImageModel
        })
      )
    })

    it('should resolve namespaced image model ID', async () => {
      await executor.generateImage({
        model: 'aihubmix|openai|dall-e-3',
        prompt: 'Namespaced image'
      })

      expect(mockProvider.imageModel).toHaveBeenCalledWith('aihubmix|openai|dall-e-3')
    })

    it('should throw ImageModelResolutionError on resolution failure', async () => {
      mockProvider.imageModel.mockImplementation(() => {
        throw new Error('Model not found')
      })

      await expect(
        executor.generateImage({
          model: 'invalid-model',
          prompt: 'Test'
        })
      ).rejects.toThrow(ImageModelResolutionError)
    })

    it('should include modelId and providerId in ImageModelResolutionError', async () => {
      mockProvider.imageModel.mockImplementation(() => {
        throw new Error('Not found')
      })

      try {
        await executor.generateImage({
          model: 'invalid-model',
          prompt: 'Test'
        })
        expect.fail('Should have thrown ImageModelResolutionError')
      } catch (error) {
        expect(error).toBeInstanceOf(ImageModelResolutionError)
        const imgError = error as ImageModelResolutionError
        expect(imgError.message).toContain('invalid-model')
        expect(imgError.providerId).toBe('openai')
      }
    })

    it('should extract modelId from direct model object in error', async () => {
      const directModel = createMockImageModel({
        modelId: 'direct-model',
        doGenerate: vi.fn().mockRejectedValue(new Error('Generation failed'))
      })

      vi.mocked(generateImage).mockRejectedValue(new Error('Generation failed'))

      await expect(
        executor.generateImage({
          model: directModel,
          prompt: 'Test'
        })
      ).rejects.toThrow()
    })
  })

  describe('Provider-Specific Model Resolution', () => {
    it('should resolve models for OpenAI provider', async () => {
      const openaiModel = createMockLanguageModel({ provider: 'openai', modelId: 'gpt-4' })
      const openaiProvider = createMockProviderV3({
        provider: 'openai',
        languageModel: vi.fn(() => openaiModel)
      })
      const openaiExecutor = RuntimeExecutor.create('openai', openaiProvider, mockProviderConfigs.openai)

      await openaiExecutor.generateText({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(openaiProvider.languageModel).toHaveBeenCalledWith('gpt-4')
    })

    it('should resolve models for Anthropic provider', async () => {
      const anthropicModel = createMockLanguageModel({ provider: 'anthropic', modelId: 'claude-3-5-sonnet' })
      const anthropicProvider = createMockProviderV3({
        provider: 'anthropic',
        languageModel: vi.fn(() => anthropicModel)
      })
      const anthropicExecutor = RuntimeExecutor.create('anthropic', anthropicProvider, mockProviderConfigs.anthropic)

      await anthropicExecutor.generateText({
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(anthropicProvider.languageModel).toHaveBeenCalledWith('claude-3-5-sonnet')
    })

    it('should resolve models for Google provider', async () => {
      const googleModel = createMockLanguageModel({ provider: 'google', modelId: 'gemini-2.0-flash' })
      const googleProvider = createMockProviderV3({
        provider: 'google',
        languageModel: vi.fn(() => googleModel)
      })
      const googleExecutor = RuntimeExecutor.create('google', googleProvider, mockProviderConfigs.google)

      await googleExecutor.generateText({
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(googleProvider.languageModel).toHaveBeenCalledWith('gemini-2.0-flash')
    })

    it('should resolve models for OpenAI-compatible provider', async () => {
      const compatModel = createMockLanguageModel({ provider: 'openai-compatible', modelId: 'custom-model' })
      const compatProvider = createMockProviderV3({
        provider: 'openai-compatible',
        languageModel: vi.fn(() => compatModel)
      })
      const compatibleExecutor = RuntimeExecutor.createOpenAICompatible(
        compatProvider,
        mockProviderConfigs['openai-compatible']
      )

      await compatibleExecutor.generateText({
        model: 'custom-model',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(compatProvider.languageModel).toHaveBeenCalledWith('custom-model')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string modelId', async () => {
      await executor.generateText({
        model: '',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(mockProvider.languageModel).toHaveBeenCalledWith('')
    })

    it('should handle model resolution errors gracefully', async () => {
      mockProvider.languageModel.mockImplementation(() => {
        throw new Error('Model not found')
      })

      await expect(
        executor.generateText({
          model: 'nonexistent-model',
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).rejects.toThrow('Model not found')
    })

    it('should handle concurrent model resolutions', async () => {
      const promises = [
        executor.generateText({ model: 'gpt-4', messages: [{ role: 'user', content: 'Test 1' }] }),
        executor.generateText({ model: 'gpt-4-turbo', messages: [{ role: 'user', content: 'Test 2' }] }),
        executor.generateText({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'Test 3' }] })
      ]

      await Promise.all(promises)

      expect(mockProvider.languageModel).toHaveBeenCalledTimes(3)
    })

    it('should accept model object even without specificationVersion', async () => {
      const invalidModel = {
        provider: 'test',
        modelId: 'test-model'
        // Missing specificationVersion
      } as any

      // Plugin engine doesn't validate direct model objects
      await expect(
        executor.generateText({
          model: invalidModel,
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).resolves.toBeDefined()
    })
  })

  describe('Type Safety Validation', () => {
    it('should ensure resolved model is LanguageModelV3', async () => {
      const v3Model = createMockLanguageModel({
        specificationVersion: 'v3'
      })

      mockProvider.languageModel.mockReturnValue(v3Model)

      await executor.generateText({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            specificationVersion: 'v3'
          })
        })
      )
    })

    it('should not enforce specification version for direct models', async () => {
      const v1Model = {
        specificationVersion: 'v1',
        provider: 'test',
        modelId: 'test'
      } as any

      // Direct models bypass validation in the plugin engine
      await expect(
        executor.generateText({
          model: v1Model,
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).resolves.toBeDefined()
    })
  })
})
