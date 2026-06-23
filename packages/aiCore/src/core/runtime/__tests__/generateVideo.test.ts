import type { Experimental_VideoModelV3 } from '@ai-sdk/provider'
import { createMockProviderV3, createMockVideoModel } from '@test-utils'
import { experimental_generateVideo as aiGenerateVideo, NoVideoGeneratedError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AiPlugin } from '../../plugins'
import { VideoGenerationError, VideoModelResolutionError } from '../errors'
import { RuntimeExecutor } from '../executor'

// Mock dependencies
vi.mock('ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    experimental_generateVideo: vi.fn(),
    jsonSchema: vi.fn((schema) => schema),
    NoVideoGeneratedError: class NoVideoGeneratedError extends Error {
      static isInstance = vi.fn()
      constructor() {
        super('No video generated')
        this.name = 'NoVideoGeneratedError'
      }
    }
  }
})

describe('RuntimeExecutor.generateVideo', () => {
  let executor: RuntimeExecutor
  let mockVideoModel: Experimental_VideoModelV3
  // Base ProviderV3 has no videoModel; the mock attaches it, so `any` mirrors generateImage.test.
  let mockProvider: any
  let mockGenerateVideoResult: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock video model
    mockVideoModel = createMockVideoModel({
      modelId: 'veo-3.1-generate',
      provider: 'google'
    })

    // Create mock provider with videoModel as a spy
    mockProvider = createMockProviderV3({
      provider: 'google',
      videoModel: vi.fn(() => mockVideoModel)
    })

    // Create executor instance
    executor = RuntimeExecutor.create('google', mockProvider, {
      apiKey: 'test-key'
    })

    // Mock generateVideo result
    mockGenerateVideoResult = {
      video: {
        base64: 'base64-encoded-video-data',
        uint8Array: new Uint8Array([1, 2, 3]),
        mediaType: 'video/mp4'
      },
      videos: [
        {
          base64: 'base64-encoded-video-data',
          uint8Array: new Uint8Array([1, 2, 3]),
          mediaType: 'video/mp4'
        }
      ],
      warnings: [],
      providerMetadata: {
        google: {}
      },
      responses: []
    }

    vi.mocked(aiGenerateVideo).mockResolvedValue(mockGenerateVideoResult)
  })

  describe('Basic functionality', () => {
    it('should generate a single video with minimal parameters', async () => {
      const result = await executor.generateVideo({ model: 'veo-3.1-generate', prompt: 'A cat walking on a treadmill' })

      // Video models are resolved via provider.videoModel() (not the registry)
      expect(mockProvider.videoModel).toHaveBeenCalledWith('veo-3.1-generate')

      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: mockVideoModel,
        prompt: 'A cat walking on a treadmill'
      })

      expect(result).toEqual(mockGenerateVideoResult)
    })

    it('should generate video with pre-created model', async () => {
      const result = await executor.generateVideo({
        model: mockVideoModel,
        prompt: 'A serene mountain lake'
      })

      // Pre-created model is used directly, provider.videoModel is not called
      expect(mockProvider.videoModel).not.toHaveBeenCalled()
      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: mockVideoModel,
        prompt: 'A serene mountain lake'
      })

      expect(result).toEqual(mockGenerateVideoResult)
    })

    it('should support image-to-video prompt (first frame)', async () => {
      await executor.generateVideo({
        model: 'veo-3.1-generate',
        prompt: { image: 'data:image/png;base64,abc', text: 'Make it move' }
      })

      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: mockVideoModel,
        prompt: { image: 'data:image/png;base64,abc', text: 'Make it move' }
      })
    })

    it('should support aspect ratio specification', async () => {
      await executor.generateVideo({ model: 'veo-3.1-generate', prompt: 'A city skyline', aspectRatio: '16:9' })

      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: mockVideoModel,
        prompt: 'A city skyline',
        aspectRatio: '16:9'
      })
    })

    it('should support resolution and duration', async () => {
      await executor.generateVideo({
        model: 'veo-3.1-generate',
        prompt: 'Ocean waves',
        resolution: '1280x720',
        duration: 5
      })

      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: mockVideoModel,
        prompt: 'Ocean waves',
        resolution: '1280x720',
        duration: 5
      })
    })

    it('should support seed for consistent output', async () => {
      await executor.generateVideo({ model: 'veo-3.1-generate', prompt: 'A spaceship', seed: 1234567890 })

      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: mockVideoModel,
        prompt: 'A spaceship',
        seed: 1234567890
      })
    })

    it('should support abort signal', async () => {
      const abortController = new AbortController()

      await executor.generateVideo({
        model: 'veo-3.1-generate',
        prompt: 'A waterfall',
        abortSignal: abortController.signal
      })

      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: mockVideoModel,
        prompt: 'A waterfall',
        abortSignal: abortController.signal
      })
    })

    it('should support provider-specific options', async () => {
      await executor.generateVideo({
        model: 'veo-3.1-generate',
        prompt: 'A forest at dawn',
        providerOptions: {
          google: {
            personGeneration: 'allow_adult',
            negativePrompt: 'blurry'
          }
        }
      })

      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: mockVideoModel,
        prompt: 'A forest at dawn',
        providerOptions: {
          google: {
            personGeneration: 'allow_adult',
            negativePrompt: 'blurry'
          }
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
          return { ...params, duration: 8 }
        }),
        transformResult: vi.fn(async (result) => {
          pluginCallOrder.push('transformResult')
          return { ...result, processed: true }
        }),
        onRequestEnd: vi.fn(async () => {
          pluginCallOrder.push('onRequestEnd')
        })
      }

      const executorWithPlugin = RuntimeExecutor.create('google', mockProvider, { apiKey: 'test-key' }, [testPlugin])

      const result = await executorWithPlugin.generateVideo({ model: 'veo-3.1-generate', prompt: 'A test video' })

      expect(pluginCallOrder).toEqual(['onRequestStart', 'transformParams', 'transformResult', 'onRequestEnd'])

      expect(testPlugin.transformParams).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'A test video' }),
        expect.objectContaining({
          providerId: 'google',
          model: 'veo-3.1-generate'
        })
      )

      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: mockVideoModel,
        prompt: 'A test video',
        duration: 8 // Should be transformed by plugin
      })

      expect(result).toEqual({
        ...mockGenerateVideoResult,
        processed: true // Should be transformed by plugin
      })
    })

    it('should handle model resolution through plugins', async () => {
      const customVideoModel = {
        modelId: 'custom-video-model',
        provider: 'google'
      } as Experimental_VideoModelV3

      const modelResolutionPlugin: AiPlugin = {
        name: 'model-resolver',
        resolveModel: vi.fn(async () => customVideoModel)
      }

      const executorWithPlugin = RuntimeExecutor.create('google', mockProvider, { apiKey: 'test-key' }, [
        modelResolutionPlugin
      ])

      await executorWithPlugin.generateVideo({ model: 'veo-3.1-generate', prompt: 'A test video' })

      expect(modelResolutionPlugin.resolveModel).toHaveBeenCalledWith(
        'veo-3.1-generate',
        expect.objectContaining({
          providerId: 'google',
          model: 'veo-3.1-generate'
        })
      )

      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: customVideoModel,
        prompt: 'A test video'
      })
    })

    it('should support recursive calls from plugins', async () => {
      const recursivePlugin: AiPlugin = {
        name: 'recursive-plugin',
        transformParams: vi.fn(async (params, context) => {
          if (!context.isRecursiveCall && params.prompt === 'original') {
            await context.recursiveCall({
              model: 'veo-3.1-generate',
              prompt: 'modified'
            })
          }
          return params
        })
      }

      const executorWithPlugin = RuntimeExecutor.create('google', mockProvider, { apiKey: 'test-key' }, [
        recursivePlugin
      ])

      await executorWithPlugin.generateVideo({ model: 'veo-3.1-generate', prompt: 'original' })

      expect(recursivePlugin.transformParams).toHaveBeenCalledTimes(2)
      expect(aiGenerateVideo).toHaveBeenCalledTimes(2)
    })
  })

  describe('Error handling', () => {
    it('should handle model creation errors', async () => {
      const modelError = new Error('Failed to get video model')
      mockProvider.videoModel.mockImplementation(() => {
        throw modelError
      })

      await expect(executor.generateVideo({ model: 'invalid-model', prompt: 'A test video' })).rejects.toThrow(
        VideoGenerationError
      )
    })

    it('should handle VideoModelResolutionError correctly', async () => {
      const resolutionError = new VideoModelResolutionError('invalid-model', 'google', new Error('Model not found'))
      mockProvider.videoModel.mockImplementation(() => {
        throw resolutionError
      })

      const thrownError = await executor
        .generateVideo({ model: 'invalid-model', prompt: 'A test video' })
        .catch((error) => error)

      expect(thrownError).toBeInstanceOf(VideoModelResolutionError)
      expect(thrownError.message).toContain('Failed to resolve video model: invalid-model')
      expect(thrownError.providerId).toBe('google')
      expect(thrownError.modelId).toBe('invalid-model')
    })

    it('should throw when the provider does not support video generation', async () => {
      // openai mock has no videoModel attached
      const noVideoProvider = createMockProviderV3({ provider: 'openai' })
      const noVideoExecutor = RuntimeExecutor.create('openai', noVideoProvider, { apiKey: 'test-key' })

      await expect(noVideoExecutor.generateVideo({ model: 'gpt-image', prompt: 'A test video' })).rejects.toThrow(
        VideoGenerationError
      )
    })

    it('should handle video generation API errors', async () => {
      const apiError = new Error('API request failed')
      vi.mocked(aiGenerateVideo).mockRejectedValue(apiError)

      await expect(executor.generateVideo({ model: 'veo-3.1-generate', prompt: 'A test video' })).rejects.toThrow(
        'API request failed'
      )
    })

    it('should handle NoVideoGeneratedError', async () => {
      const noVideoError = new NoVideoGeneratedError({ cause: new Error('No video generated'), responses: [] })

      vi.mocked(aiGenerateVideo).mockRejectedValue(noVideoError)
      vi.mocked(NoVideoGeneratedError.isInstance).mockReturnValue(true)

      await expect(executor.generateVideo({ model: 'veo-3.1-generate', prompt: 'A test video' })).rejects.toThrow(
        'No video generated'
      )
    })

    it('should execute onError plugin hook on failure', async () => {
      const error = new Error('Generation failed')
      vi.mocked(aiGenerateVideo).mockRejectedValue(error)

      const errorPlugin: AiPlugin = {
        name: 'error-handler',
        onError: vi.fn()
      }

      const executorWithPlugin = RuntimeExecutor.create('google', mockProvider, { apiKey: 'test-key' }, [errorPlugin])

      await expect(
        executorWithPlugin.generateVideo({ model: 'veo-3.1-generate', prompt: 'A test video' })
      ).rejects.toThrow('Generation failed')

      expect(errorPlugin.onError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          providerId: 'google',
          model: 'veo-3.1-generate'
        })
      )
    })
  })

  describe('Advanced features', () => {
    it('should support multiple videos generation', async () => {
      await executor.generateVideo({ model: 'veo-3.1-generate', prompt: 'A test video', n: 2 })

      expect(aiGenerateVideo).toHaveBeenCalledWith({
        model: mockVideoModel,
        prompt: 'A test video',
        n: 2
      })
    })

    it('should handle warnings from the model', async () => {
      const resultWithWarnings = {
        ...mockGenerateVideoResult,
        warnings: [
          {
            type: 'unsupported-setting',
            message: 'fps not supported for this model'
          }
        ]
      }

      vi.mocked(aiGenerateVideo).mockResolvedValue(resultWithWarnings)

      const result = await executor.generateVideo({ model: 'veo-3.1-generate', prompt: 'A test video', fps: 60 })

      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0].type).toBe('unsupported-setting')
    })

    it('should provide access to provider metadata', async () => {
      const result = await executor.generateVideo({ model: 'veo-3.1-generate', prompt: 'A test video' })

      expect(result.providerMetadata).toBeDefined()
      expect(result.providerMetadata.google).toBeDefined()
    })
  })

  describe('Multiple providers support', () => {
    it('should work with a different provider that exposes videoModel', async () => {
      const falVideoModel = createMockVideoModel({
        provider: 'fal',
        modelId: 'luma-dream-machine/ray-2'
      })

      const falProvider = createMockProviderV3({
        provider: 'fal',
        videoModel: vi.fn(() => falVideoModel)
      })

      const falExecutor = RuntimeExecutor.create('fal' as any, falProvider, { apiKey: 'fal-key' })

      await falExecutor.generateVideo({ model: 'luma-dream-machine/ray-2', prompt: 'A dreamy landscape' })

      expect((falProvider as any).videoModel).toHaveBeenCalledWith('luma-dream-machine/ray-2')
    })
  })
})
