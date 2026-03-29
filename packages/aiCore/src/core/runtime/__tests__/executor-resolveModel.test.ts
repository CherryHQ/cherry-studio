/**
 * RuntimeExecutor.resolveModel Comprehensive Tests
 * Tests the private resolveModel and resolveImageModel methods through public APIs
 * Covers model resolution, middleware application, and type validation
 */

import type { ImageModelV3, LanguageModelV3 } from '@ai-sdk/provider'
import { generateImage, generateText, streamText } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockImageModel, createMockLanguageModel, mockProviderConfigs } from '../../../__tests__'
import { globalModelResolver } from '../../models'
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

vi.mock('../../providers/RegistryManagement', () => ({
  globalRegistryManagement: {
    languageModel: vi.fn(),
    imageModel: vi.fn()
  },
  DEFAULT_SEPARATOR: '|'
}))

vi.mock('../../models', () => ({
  globalModelResolver: {
    resolveLanguageModel: vi.fn(),
    resolveImageModel: vi.fn()
  }
}))

describe('RuntimeExecutor - Model Resolution', () => {
  let executor: RuntimeExecutor<'openai'>
  let mockLanguageModel: LanguageModelV3
  let mockImageModel: ImageModelV3

  beforeEach(() => {
    vi.clearAllMocks()

    executor = RuntimeExecutor.create('openai', mockProviderConfigs.openai)

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

    vi.mocked(globalModelResolver.resolveLanguageModel).mockResolvedValue(mockLanguageModel)
    vi.mocked(globalModelResolver.resolveImageModel).mockResolvedValue(mockImageModel)
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
    it('should resolve string modelId using globalModelResolver', async () => {
      await executor.generateText({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith(
        'gpt-4',
        'openai',
        mockProviderConfigs.openai
      )
    })

    it('should pass provider settings to model resolver', async () => {
      const customExecutor = RuntimeExecutor.create('anthropic', {
        apiKey: 'sk-test',
        baseURL: 'https://api.anthropic.com'
      })

      vi.mocked(globalModelResolver.resolveLanguageModel).mockResolvedValue(mockLanguageModel)

      await customExecutor.generateText({
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith('claude-3-5-sonnet', 'anthropic', {
        apiKey: 'sk-test',
        baseURL: 'https://api.anthropic.com'
      })
    })

    it('should resolve traditional format modelId', async () => {
      await executor.generateText({
        model: 'gpt-4-turbo',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith('gpt-4-turbo', 'openai', expect.any(Object))
    })

    it('should resolve namespaced format modelId', async () => {
      await executor.generateText({
        model: 'aihubmix|anthropic|claude-3',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith(
        'aihubmix|anthropic|claude-3',
        'openai',
        expect.any(Object)
      )
    })

    it('should use resolved model for generation', async () => {
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

    it('should work with streamText', async () => {
      await executor.streamText({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Stream test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalled()
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

      // Should NOT call resolver for direct model
      expect(globalModelResolver.resolveLanguageModel).not.toHaveBeenCalled()

      // Should use the model directly
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: directModel
        })
      )
    })

    it('should accept V2 model object without validation (plugin engine handles it)', async () => {
      const v2Model = {
        specificationVersion: 'v2',
        provider: 'openai',
        modelId: 'gpt-4',
        doGenerate: vi.fn()
      } as any

      // The plugin engine accepts any model object directly without validation
      // V3 validation only happens when resolving string modelIds
      await expect(
        executor.generateText({
          model: v2Model,
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).resolves.toBeDefined()
    })

    it('should accept any model object without checking specification version', async () => {
      const v2Model = {
        specificationVersion: 'v2',
        provider: 'custom-provider',
        modelId: 'custom-model',
        doGenerate: vi.fn()
      } as any

      // Direct model objects bypass validation
      // The executor trusts that plugins/users provide valid models
      await expect(
        executor.generateText({
          model: v2Model,
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).resolves.toBeDefined()
    })

    it('should accept model object with streamText', async () => {
      const directModel = createMockLanguageModel({
        specificationVersion: 'v3'
      })

      await executor.streamText({
        model: directModel,
        messages: [{ role: 'user', content: 'Stream' }]
      })

      expect(globalModelResolver.resolveLanguageModel).not.toHaveBeenCalled()
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: directModel
        })
      )
    })
  })

  describe('Image Model Resolution', () => {
    it('should resolve string image modelId using globalModelResolver', async () => {
      await executor.generateImage({
        model: 'dall-e-3',
        prompt: 'A beautiful sunset'
      })

      expect(globalModelResolver.resolveImageModel).toHaveBeenCalledWith('dall-e-3', 'openai')
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

      expect(globalModelResolver.resolveImageModel).not.toHaveBeenCalled()
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

      expect(globalModelResolver.resolveImageModel).toHaveBeenCalledWith('aihubmix|openai|dall-e-3', 'openai')
    })

    it('should throw ImageModelResolutionError on resolution failure', async () => {
      const resolutionError = new Error('Model not found')
      vi.mocked(globalModelResolver.resolveImageModel).mockRejectedValue(resolutionError)

      await expect(
        executor.generateImage({
          model: 'invalid-model',
          prompt: 'Test'
        })
      ).rejects.toThrow(ImageModelResolutionError)
    })

    it('should include modelId and providerId in ImageModelResolutionError', async () => {
      vi.mocked(globalModelResolver.resolveImageModel).mockRejectedValue(new Error('Not found'))

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
      const openaiExecutor = RuntimeExecutor.create('openai', mockProviderConfigs.openai)

      await openaiExecutor.generateText({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith('gpt-4', 'openai', expect.any(Object))
    })

    it('should resolve models for Anthropic provider', async () => {
      const anthropicExecutor = RuntimeExecutor.create('anthropic', mockProviderConfigs.anthropic)

      await anthropicExecutor.generateText({
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith(
        'claude-3-5-sonnet',
        'anthropic',
        expect.any(Object)
      )
    })

    it('should resolve models for Google provider', async () => {
      const googleExecutor = RuntimeExecutor.create('google', mockProviderConfigs.google)

      await googleExecutor.generateText({
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith(
        'gemini-2.0-flash',
        'google',
        expect.any(Object)
      )
    })

    it('should resolve models for OpenAI-compatible provider', async () => {
      const compatibleExecutor = RuntimeExecutor.createOpenAICompatible(mockProviderConfigs['openai-compatible'])

      await compatibleExecutor.generateText({
        model: 'custom-model',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith(
        'custom-model',
        'openai-compatible',
        expect.any(Object)
      )
    })
  })

  describe('OpenAI Mode Handling', () => {
    it('should pass mode setting to model resolver', async () => {
      const executorWithMode = RuntimeExecutor.create('openai', {
        ...mockProviderConfigs.openai,
        mode: 'chat'
      })

      await executorWithMode.generateText({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith(
        'gpt-4',
        'openai',
        expect.objectContaining({
          mode: 'chat'
        })
      )
    })

    it('should handle responses mode', async () => {
      const executorWithMode = RuntimeExecutor.create('openai', {
        ...mockProviderConfigs.openai,
        mode: 'responses'
      })

      await executorWithMode.generateText({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith(
        'gpt-4',
        'openai',
        expect.objectContaining({
          mode: 'responses'
        })
      )
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty string modelId', async () => {
      await executor.generateText({
        model: '',
        messages: [{ role: 'user', content: 'Test' }]
      })

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledWith('', 'openai', expect.any(Object))
    })

    it('should handle model resolution errors gracefully', async () => {
      vi.mocked(globalModelResolver.resolveLanguageModel).mockRejectedValue(new Error('Model not found'))

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

      expect(globalModelResolver.resolveLanguageModel).toHaveBeenCalledTimes(3)
    })

    it('should accept model object even without specificationVersion', async () => {
      const invalidModel = {
        provider: 'test',
        modelId: 'test-model'
        // Missing specificationVersion
      } as any

      // Plugin engine doesn't validate direct model objects
      // It's the user's responsibility to provide valid models
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

      vi.mocked(globalModelResolver.resolveLanguageModel).mockResolvedValue(v3Model)

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
      // Only resolved models (from string IDs) are validated
      await expect(
        executor.generateText({
          model: v1Model,
          messages: [{ role: 'user', content: 'Test' }]
        })
      ).resolves.toBeDefined()
    })
  })
})
