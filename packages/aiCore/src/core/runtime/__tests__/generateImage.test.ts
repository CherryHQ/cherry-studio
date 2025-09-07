import { ImageModelV2 } from '@ai-sdk/provider'
import { experimental_generateImage as aiGenerateImage, NoImageGeneratedError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AiPlugin } from '../../plugins'
import { globalRegistryManagement } from '../../providers/RegistryManagement'
import { ImageGenerationError, ImageModelResolutionError } from '../errors'
import { RuntimeExecutor } from '../executor'

// Mock dependencies
vi.mock('ai', () => ({
  experimental_generateImage: vi.fn(),
  NoImageGeneratedError: class NoImageGeneratedError extends Error {
    static isInstance = vi.fn()
    constructor() {
      super('No image generated')
      this.name = 'NoImageGeneratedError'
    }
  }
}))

vi.mock('../../providers/RegistryManagement', () => ({
  globalRegistryManagement: {
    imageModel: vi.fn()
  },
  DEFAULT_SEPARATOR: '|'
}))

describe('RuntimeExecutor.generateImage', () => {
  let executor: RuntimeExecutor<'openai'>
  let mockImageModel: ImageModelV2
  let mockGenerateImageResult: any

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Create executor instance
    executor = RuntimeExecutor.create('openai', {
      apiKey: 'test-key'
    })

    // Mock image model
    mockImageModel = {
      modelId: 'dall-e-3',
      provider: 'openai'
    } as ImageModelV2

    // Mock generateImage result
    mockGenerateImageResult = {
      image: {
        base64: 'base64-encoded-image-data',
        uint8Array: new Uint8Array([1, 2, 3]),
        mediaType: 'image/png'
      },
      images: [
        {
          base64: 'base64-encoded-image-data',
          uint8Array: new Uint8Array([1, 2, 3]),
          mediaType: 'image/png'
        }
      ],
      warnings: [],
      providerMetadata: {
        openai: {
          images: [{ revisedPrompt: 'A detailed prompt' }]
        }
      },
      responses: []
    }

    // Setup mocks to avoid "No providers registered" error
    vi.mocked(globalRegistryManagement.imageModel).mockReturnValue(mockImageModel)
    vi.mocked(aiGenerateImage).mockResolvedValue(mockGenerateImageResult)
  })

  describe('Basic functionality', () => {
    it('should generate a single image with minimal parameters', async () => {
      const result = await executor.generateImage({ model: 'dall-e-3', prompt: 'A futuristic cityscape at sunset' })

      expect(globalRegistryManagement.imageModel).toHaveBeenCalledWith('openai|dall-e-3')

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A futuristic cityscape at sunset'
      })

      expect(result).toEqual(mockGenerateImageResult)
    })

    it('should generate image with pre-created model', async () => {
      const result = await executor.generateImage({
        model: mockImageModel,
        prompt: 'A beautiful landscape'
      })

      // Note: globalRegistryManagement.imageModel may still be called due to resolveImageModel logic
      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A beautiful landscape'
      })

      expect(result).toEqual(mockGenerateImageResult)
    })

    it('should support multiple images generation', async () => {
      await executor.generateImage({ model: 'dall-e-3', prompt: 'A futuristic cityscape', n: 3 })

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A futuristic cityscape',
        n: 3
      })
    })

    it('should support size specification', async () => {
      await executor.generateImage({ model: 'dall-e-3', prompt: 'A beautiful sunset', size: '1024x1024' })

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A beautiful sunset',
        size: '1024x1024'
      })
    })

    it('should support aspect ratio specification', async () => {
      await executor.generateImage({ model: 'dall-e-3', prompt: 'A mountain landscape', aspectRatio: '16:9' })

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A mountain landscape',
        aspectRatio: '16:9'
      })
    })

    it('should support seed for consistent output', async () => {
      await executor.generateImage({ model: 'dall-e-3', prompt: 'A cat in space', seed: 1234567890 })

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A cat in space',
        seed: 1234567890
      })
    })

    it('should support abort signal', async () => {
      const abortController = new AbortController()

      await executor.generateImage({ model: 'dall-e-3', prompt: 'A cityscape', abortSignal: abortController.signal })

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A cityscape',
        abortSignal: abortController.signal
      })
    })

    it('should support provider-specific options', async () => {
      await executor.generateImage({
        model: 'dall-e-3',
        prompt: 'A space station',
        providerOptions: {
          openai: {
            quality: 'hd',
            style: 'vivid'
          }
        }
      })

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A space station',
        providerOptions: {
          openai: {
            quality: 'hd',
            style: 'vivid'
          }
        }
      })
    })

    it('should support custom headers', async () => {
      await executor.generateImage({
        model: 'dall-e-3',
        prompt: 'A robot',
        headers: {
          'X-Custom-Header': 'test-value'
        }
      })

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A robot',
        headers: {
          'X-Custom-Header': 'test-value'
        }
      })
    })
  })

  describe('Plugin integration', () => {
    it('should execute plugins in correct order', async () => {
      const pluginCallOrder: string[] = []

      const testPlugin: AiPlugin = {
        name: 'test-plugin',
        onRequestStart: vi.fn(async () => {
          pluginCallOrder.push('onRequestStart')
        }),
        transformParams: vi.fn(async (params) => {
          pluginCallOrder.push('transformParams')
          return { ...params, size: '512x512' }
        }),
        transformResult: vi.fn(async (result) => {
          pluginCallOrder.push('transformResult')
          return { ...result, processed: true }
        }),
        onRequestEnd: vi.fn(async () => {
          pluginCallOrder.push('onRequestEnd')
        })
      }

      const executorWithPlugin = RuntimeExecutor.create(
        'openai',
        {
          apiKey: 'test-key'
        },
        [testPlugin]
      )

      const result = await executorWithPlugin.generateImage({ model: 'dall-e-3', prompt: 'A test image' })

      expect(pluginCallOrder).toEqual(['onRequestStart', 'transformParams', 'transformResult', 'onRequestEnd'])

      expect(testPlugin.transformParams).toHaveBeenCalledWith(
        { prompt: 'A test image' },
        expect.objectContaining({
          providerId: 'openai',
          modelId: 'dall-e-3'
        })
      )

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A test image',
        size: '512x512' // Should be transformed by plugin
      })

      expect(result).toEqual({
        ...mockGenerateImageResult,
        processed: true // Should be transformed by plugin
      })
    })

    it('should handle model resolution through plugins', async () => {
      const customImageModel = {
        modelId: 'custom-model',
        provider: 'openai'
      } as ImageModelV2

      const modelResolutionPlugin: AiPlugin = {
        name: 'model-resolver',
        resolveModel: vi.fn(async () => customImageModel)
      }

      const executorWithPlugin = RuntimeExecutor.create(
        'openai',
        {
          apiKey: 'test-key'
        },
        [modelResolutionPlugin]
      )

      await executorWithPlugin.generateImage({ model: 'dall-e-3', prompt: 'A test image' })

      expect(modelResolutionPlugin.resolveModel).toHaveBeenCalledWith(
        'dall-e-3',
        expect.objectContaining({
          providerId: 'openai',
          modelId: 'dall-e-3'
        })
      )

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: customImageModel,
        prompt: 'A test image'
      })
    })

    it('should support recursive calls from plugins', async () => {
      const recursivePlugin: AiPlugin = {
        name: 'recursive-plugin',
        transformParams: vi.fn(async (params, context) => {
          if (!context.isRecursiveCall && params.prompt === 'original') {
            // Make a recursive call with modified prompt
            await context.recursiveCall({
              model: 'dall-e-3',
              prompt: 'modified'
            })
          }
          return params
        })
      }

      const executorWithPlugin = RuntimeExecutor.create(
        'openai',
        {
          apiKey: 'test-key'
        },
        [recursivePlugin]
      )

      await executorWithPlugin.generateImage({ model: 'dall-e-3', prompt: 'original' })

      expect(recursivePlugin.transformParams).toHaveBeenCalledTimes(2)
      expect(aiGenerateImage).toHaveBeenCalledTimes(2)
    })
  })

  describe('Error handling', () => {
    it('should handle model creation errors', async () => {
      const modelError = new Error('Failed to get image model')
      vi.mocked(globalRegistryManagement.imageModel).mockImplementation(() => {
        throw modelError
      })

      await expect(executor.generateImage({ model: 'invalid-model', prompt: 'A test image' })).rejects.toThrow(
        ImageGenerationError
      )
    })

    it('should handle ImageModelResolutionError correctly', async () => {
      const resolutionError = new ImageModelResolutionError('invalid-model', 'openai', new Error('Model not found'))
      vi.mocked(globalRegistryManagement.imageModel).mockImplementation(() => {
        throw resolutionError
      })

      const thrownError = await executor
        .generateImage({ model: 'invalid-model', prompt: 'A test image' })
        .catch((error) => error)

      expect(thrownError).toBeInstanceOf(ImageGenerationError)
      expect(thrownError.message).toContain('Failed to generate image:')
      expect(thrownError.providerId).toBe('openai')
      expect(thrownError.modelId).toBe('invalid-model')
      expect(thrownError.cause).toBeInstanceOf(ImageModelResolutionError)
      expect(thrownError.cause.message).toContain('Failed to resolve image model: invalid-model')
    })

    it('should handle ImageModelResolutionError without provider', async () => {
      const resolutionError = new ImageModelResolutionError('unknown-model')
      vi.mocked(globalRegistryManagement.imageModel).mockImplementation(() => {
        throw resolutionError
      })

      await expect(executor.generateImage({ model: 'unknown-model', prompt: 'A test image' })).rejects.toThrow(
        ImageGenerationError
      )
    })

    it('should handle image generation API errors', async () => {
      const apiError = new Error('API request failed')
      vi.mocked(aiGenerateImage).mockRejectedValue(apiError)

      await expect(executor.generateImage({ model: 'dall-e-3', prompt: 'A test image' })).rejects.toThrow(
        'Failed to generate image:'
      )
    })

    it('should handle NoImageGeneratedError', async () => {
      const noImageError = new NoImageGeneratedError({
        cause: new Error('No image generated'),
        responses: []
      })

      vi.mocked(aiGenerateImage).mockRejectedValue(noImageError)
      vi.mocked(NoImageGeneratedError.isInstance).mockReturnValue(true)

      await expect(executor.generateImage({ model: 'dall-e-3', prompt: 'A test image' })).rejects.toThrow(
        'Failed to generate image:'
      )
    })

    it('should execute onError plugin hook on failure', async () => {
      const error = new Error('Generation failed')
      vi.mocked(aiGenerateImage).mockRejectedValue(error)

      const errorPlugin: AiPlugin = {
        name: 'error-handler',
        onError: vi.fn()
      }

      const executorWithPlugin = RuntimeExecutor.create(
        'openai',
        {
          apiKey: 'test-key'
        },
        [errorPlugin]
      )

      await expect(executorWithPlugin.generateImage({ model: 'dall-e-3', prompt: 'A test image' })).rejects.toThrow(
        'Failed to generate image:'
      )

      expect(errorPlugin.onError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          providerId: 'openai',
          modelId: 'dall-e-3'
        })
      )
    })

    it('should handle abort signal timeout', async () => {
      const abortError = new Error('Operation was aborted')
      abortError.name = 'AbortError'
      vi.mocked(aiGenerateImage).mockRejectedValue(abortError)

      const abortController = new AbortController()
      setTimeout(() => abortController.abort(), 10)

      await expect(
        executor.generateImage({ model: 'dall-e-3', prompt: 'A test image', abortSignal: abortController.signal })
      ).rejects.toThrow('Failed to generate image:')
    })
  })

  describe('Multiple providers support', () => {
    it('should work with different providers', async () => {
      const googleExecutor = RuntimeExecutor.create('google', {
        apiKey: 'google-key'
      })

      await googleExecutor.generateImage({ model: 'imagen-3.0-generate-002', prompt: 'A landscape' })

      expect(globalRegistryManagement.imageModel).toHaveBeenCalledWith('google|imagen-3.0-generate-002')
    })

    it('should support xAI Grok image models', async () => {
      const xaiExecutor = RuntimeExecutor.create('xai', {
        apiKey: 'xai-key'
      })

      await xaiExecutor.generateImage({ model: 'grok-2-image', prompt: 'A futuristic robot' })

      expect(globalRegistryManagement.imageModel).toHaveBeenCalledWith('xai|grok-2-image')
    })
  })

  describe('Advanced features', () => {
    it('should support batch image generation with maxImagesPerCall', async () => {
      await executor.generateImage({ model: 'dall-e-3', prompt: 'A test image', n: 10, maxImagesPerCall: 5 })

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A test image',
        n: 10,
        maxImagesPerCall: 5
      })
    })

    it('should support retries with maxRetries', async () => {
      await executor.generateImage({ model: 'dall-e-3', prompt: 'A test image', maxRetries: 3 })

      expect(aiGenerateImage).toHaveBeenCalledWith({
        model: mockImageModel,
        prompt: 'A test image',
        maxRetries: 3
      })
    })

    it('should handle warnings from the model', async () => {
      const resultWithWarnings = {
        ...mockGenerateImageResult,
        warnings: [
          {
            type: 'unsupported-setting',
            message: 'Size parameter not supported for this model'
          }
        ]
      }

      vi.mocked(aiGenerateImage).mockResolvedValue(resultWithWarnings)

      const result = await executor.generateImage({
        model: 'dall-e-3',
        prompt: 'A test image',
        size: '2048x2048' // Unsupported size
      })

      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0].type).toBe('unsupported-setting')
    })

    it('should provide access to provider metadata', async () => {
      const result = await executor.generateImage({ model: 'dall-e-3', prompt: 'A test image' })

      expect(result.providerMetadata).toBeDefined()
      expect(result.providerMetadata.openai).toBeDefined()
    })

    it('should provide response metadata', async () => {
      const resultWithMetadata = {
        ...mockGenerateImageResult,
        responses: [
          {
            timestamp: new Date(),
            modelId: 'dall-e-3',
            headers: { 'x-request-id': 'test-123' }
          }
        ]
      }

      vi.mocked(aiGenerateImage).mockResolvedValue(resultWithMetadata)

      const result = await executor.generateImage({ model: 'dall-e-3', prompt: 'A test image' })

      expect(result.responses).toHaveLength(1)
      expect(result.responses[0].modelId).toBe('dall-e-3')
      expect(result.responses[0].headers).toEqual({ 'x-request-id': 'test-123' })
    })
  })
})
