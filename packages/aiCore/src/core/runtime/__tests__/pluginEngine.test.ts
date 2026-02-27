/**
 * PluginEngine Comprehensive Tests
 * Tests plugin lifecycle, execution order, and coordination
 * Covers both streaming and non-streaming execution paths
 */

import type { ImageModelV3, LanguageModelV3 } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockImageModel, createMockLanguageModel, createMockMiddleware } from '../../../__tests__'
import { ModelResolutionError, RecursiveDepthError } from '../../errors'
import type { AiPlugin, GenerateTextParams, GenerateTextResult } from '../../plugins'
import { PluginEngine } from '../pluginEngine'

vi.mock('ai', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    wrapLanguageModel: vi.fn((config: any) => ({
      ...config.model,
      _middlewareApplied: true,
      _appliedMiddlewares: config.middleware
    }))
  }
})

describe('PluginEngine', () => {
  let engine: PluginEngine<'openai'>
  let mockLanguageModel: LanguageModelV3
  let mockImageModel: ImageModelV3

  beforeEach(() => {
    vi.clearAllMocks()

    mockLanguageModel = createMockLanguageModel({
      provider: 'openai',
      modelId: 'gpt-4'
    })

    mockImageModel = createMockImageModel({
      provider: 'openai',
      modelId: 'dall-e-3'
    })
  })

  describe('Plugin Registration and Management', () => {
    it('should create engine with empty plugins', () => {
      engine = new PluginEngine('openai', [])

      expect(engine.getPlugins()).toEqual([])
    })

    it('should create engine with initial plugins', () => {
      const plugin1: AiPlugin = { name: 'plugin-1' }
      const plugin2: AiPlugin = { name: 'plugin-2' }

      engine = new PluginEngine('openai', [plugin1, plugin2])

      expect(engine.getPlugins()).toHaveLength(2)
      expect(engine.getPlugins()).toEqual([plugin1, plugin2])
    })

    it('should add plugin with use()', () => {
      engine = new PluginEngine('openai', [])
      const plugin: AiPlugin = { name: 'test-plugin' }

      const result = engine.use(plugin)

      expect(result).toBe(engine) // Chainable
      expect(engine.getPlugins()).toContain(plugin)
    })

    it('should add multiple plugins with usePlugins()', () => {
      engine = new PluginEngine('openai', [])
      const plugins: AiPlugin[] = [{ name: 'plugin-1' }, { name: 'plugin-2' }, { name: 'plugin-3' }]

      const result = engine.usePlugins(plugins)

      expect(result).toBe(engine) // Chainable
      expect(engine.getPlugins()).toHaveLength(3)
    })

    it('should support method chaining', () => {
      engine = new PluginEngine('openai', [])

      engine
        .use({ name: 'plugin-1' })
        .use({ name: 'plugin-2' })
        .usePlugins([{ name: 'plugin-3' }])

      expect(engine.getPlugins()).toHaveLength(3)
    })

    it('should remove plugin by name', () => {
      const plugin1: AiPlugin = { name: 'plugin-1' }
      const plugin2: AiPlugin = { name: 'plugin-2' }

      engine = new PluginEngine('openai', [plugin1, plugin2])

      engine.removePlugin('plugin-1')

      expect(engine.getPlugins()).toHaveLength(1)
      expect(engine.getPlugins()[0]).toBe(plugin2)
    })

    it('should not error when removing non-existent plugin', () => {
      engine = new PluginEngine('openai', [{ name: 'existing' }])

      engine.removePlugin('non-existent')

      expect(engine.getPlugins()).toHaveLength(1)
    })

    it('should get plugin statistics', () => {
      const plugins: AiPlugin[] = [
        { name: 'plugin-1', enforce: 'pre' },
        { name: 'plugin-2' },
        { name: 'plugin-3', enforce: 'post' }
      ]

      engine = new PluginEngine('openai', plugins)

      const stats = engine.getPluginStats()

      expect(stats).toHaveProperty('total')
      expect(stats.total).toBe(3)
    })

    it('should preserve plugin order', () => {
      const plugins: AiPlugin[] = [{ name: 'first' }, { name: 'second' }, { name: 'third' }]

      engine = new PluginEngine('openai', plugins)

      const retrieved = engine.getPlugins()
      expect(retrieved[0].name).toBe('first')
      expect(retrieved[1].name).toBe('second')
      expect(retrieved[2].name).toBe('third')
    })
  })

  describe('Plugin Lifecycle - Non-Streaming', () => {
    it('should execute all plugin hooks in correct order', async () => {
      const executionOrder: string[] = []

      const plugin: AiPlugin = {
        name: 'lifecycle-test',
        configureContext: vi.fn(async () => {
          executionOrder.push('configureContext')
        }),
        onRequestStart: vi.fn(async () => {
          executionOrder.push('onRequestStart')
        }),
        resolveModel: vi.fn(async () => {
          executionOrder.push('resolveModel')
          return mockLanguageModel
        }),
        transformParams: vi.fn(async (params) => {
          executionOrder.push('transformParams')
          return params
        }),
        transformResult: vi.fn(async (result) => {
          executionOrder.push('transformResult')
          return result
        }),
        onRequestEnd: vi.fn(async () => {
          executionOrder.push('onRequestEnd')
        })
      }

      engine = new PluginEngine('openai', [plugin])

      const mockExecutor = vi.fn().mockResolvedValue({ text: 'test', finishReason: 'stop' })

      await engine.executeWithPlugins<GenerateTextParams, GenerateTextResult>(
        'generateText',
        { model: 'gpt-4', messages: [] },
        mockExecutor
      )

      expect(executionOrder).toEqual([
        'configureContext',
        'onRequestStart',
        'resolveModel',
        'transformParams',
        'transformResult',
        'onRequestEnd'
      ])
    })

    it('should call configureContext before other hooks', async () => {
      const configureContextSpy = vi.fn()
      const onRequestStartSpy = vi.fn()

      const plugin: AiPlugin = {
        name: 'test',
        configureContext: configureContextSpy,
        onRequestStart: onRequestStartSpy,
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel)
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      expect(configureContextSpy).toHaveBeenCalled()
      expect(onRequestStartSpy).toHaveBeenCalled()

      // configureContext should be called before onRequestStart
      expect(configureContextSpy.mock.invocationCallOrder[0]).toBeLessThan(
        onRequestStartSpy.mock.invocationCallOrder[0]
      )
    })

    it('should execute onRequestEnd after successful execution', async () => {
      const onRequestEndSpy = vi.fn()

      const plugin: AiPlugin = {
        name: 'test',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        onRequestEnd: onRequestEndSpy
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'result' })
      )

      expect(onRequestEndSpy).toHaveBeenCalledWith(
        expect.any(Object), // context
        expect.objectContaining({ text: 'result' })
      )
    })

    it('should execute onError on failure', async () => {
      const onErrorSpy = vi.fn()
      const testError = new Error('Test error')

      const plugin: AiPlugin = {
        name: 'error-handler',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        onError: onErrorSpy
      }

      engine = new PluginEngine('openai', [plugin])

      await expect(
        engine.executeWithPlugins(
          'generateText',
          { model: 'gpt-4', messages: [] },
          vi.fn().mockRejectedValue(testError)
        )
      ).rejects.toThrow('Test error')

      expect(onErrorSpy).toHaveBeenCalledWith(
        testError,
        expect.any(Object) // context
      )
    })

    it('should not call onRequestEnd when error occurs', async () => {
      const onRequestEndSpy = vi.fn()

      const plugin: AiPlugin = {
        name: 'test',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        onRequestEnd: onRequestEndSpy
      }

      engine = new PluginEngine('openai', [plugin])

      await expect(
        engine.executeWithPlugins(
          'generateText',
          { model: 'gpt-4', messages: [] },
          vi.fn().mockRejectedValue(new Error('Execution error'))
        )
      ).rejects.toThrow()

      expect(onRequestEndSpy).not.toHaveBeenCalled()
    })
  })

  describe('Model Resolution', () => {
    it('should resolve string model through plugin', async () => {
      const resolveModelSpy = vi.fn().mockResolvedValue(mockLanguageModel)

      const plugin: AiPlugin = {
        name: 'resolver',
        resolveModel: resolveModelSpy
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      expect(resolveModelSpy).toHaveBeenCalledWith('gpt-4', expect.any(Object))
    })

    it('should use first plugin that resolves model', async () => {
      const resolver1 = vi.fn().mockResolvedValue(mockLanguageModel)
      const resolver2 = vi.fn().mockResolvedValue(mockLanguageModel)

      const plugin1: AiPlugin = { name: 'resolver-1', resolveModel: resolver1 }
      const plugin2: AiPlugin = { name: 'resolver-2', resolveModel: resolver2 }

      engine = new PluginEngine('openai', [plugin1, plugin2])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      expect(resolver1).toHaveBeenCalled()
      expect(resolver2).not.toHaveBeenCalled() // Should stop after first resolver
    })

    it('should throw ModelResolutionError if no plugin resolves model', async () => {
      const plugin: AiPlugin = {
        name: 'no-resolver'
        // No resolveModel hook
      }

      engine = new PluginEngine('openai', [plugin])

      await expect(
        engine.executeWithPlugins(
          'generateText',
          { model: 'unknown-model', messages: [] },
          vi.fn().mockResolvedValue({ text: 'test' })
        )
      ).rejects.toThrow(ModelResolutionError)
    })

    it('should skip resolution for direct model objects', async () => {
      const resolveModelSpy = vi.fn()

      const plugin: AiPlugin = {
        name: 'resolver',
        resolveModel: resolveModelSpy
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: mockLanguageModel, messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      expect(resolveModelSpy).not.toHaveBeenCalled()
    })

    it('should throw if resolved model is null/undefined', async () => {
      const plugin: AiPlugin = {
        name: 'bad-resolver',
        resolveModel: vi.fn().mockResolvedValue(null)
      }

      engine = new PluginEngine('openai', [plugin])

      await expect(
        engine.executeWithPlugins(
          'generateText',
          { model: 'gpt-4', messages: [] },
          vi.fn().mockResolvedValue({ text: 'test' })
        )
      ).rejects.toThrow(ModelResolutionError)
    })
  })

  describe('Parameter Transformation', () => {
    it('should transform parameters through plugin', async () => {
      const transformParamsSpy = vi.fn().mockImplementation(async (params) => ({
        ...params,
        temperature: 0.8
      }))

      const plugin: AiPlugin = {
        name: 'transformer',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        transformParams: transformParamsSpy
      }

      engine = new PluginEngine('openai', [plugin])

      const mockExecutor = vi.fn().mockResolvedValue({ text: 'test' })

      await engine.executeWithPlugins('generateText', { model: 'gpt-4', messages: [] }, mockExecutor)

      expect(mockExecutor).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          temperature: 0.8
        })
      )
    })

    it('should chain parameter transformations across plugins', async () => {
      const plugin1: AiPlugin = {
        name: 'transform-1',
        transformParams: vi.fn().mockImplementation(async (params) => ({
          ...params,
          temperature: 0.5
        }))
      }

      const plugin2: AiPlugin = {
        name: 'transform-2',
        transformParams: vi.fn().mockImplementation(async (params) => ({
          ...params,
          maxTokens: 100
        }))
      }

      engine = new PluginEngine('openai', [plugin1, plugin2])
      engine.usePlugins([{ name: 'resolver', resolveModel: vi.fn().mockResolvedValue(mockLanguageModel) }])

      const mockExecutor = vi.fn().mockResolvedValue({ text: 'test' })

      await engine.executeWithPlugins('generateText', { model: 'gpt-4', messages: [] }, mockExecutor)

      expect(mockExecutor).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          temperature: 0.5,
          maxTokens: 100
        })
      )
    })
  })

  describe('Result Transformation', () => {
    it('should transform result through plugin', async () => {
      const transformResultSpy = vi.fn().mockImplementation(async (result) => ({
        ...result,
        text: `${result.text} [modified]`
      }))

      const plugin: AiPlugin = {
        name: 'result-transformer',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        transformResult: transformResultSpy
      }

      engine = new PluginEngine('openai', [plugin])

      const result = await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'original' })
      )

      expect(result.text).toBe('original [modified]')
    })

    it('should chain result transformations across plugins', async () => {
      const plugin1: AiPlugin = {
        name: 'transform-1',
        transformResult: vi.fn().mockImplementation(async (result) => ({
          ...result,
          text: `${result.text} + plugin1`
        }))
      }

      const plugin2: AiPlugin = {
        name: 'transform-2',
        transformResult: vi.fn().mockImplementation(async (result) => ({
          ...result,
          text: `${result.text} + plugin2`
        }))
      }

      engine = new PluginEngine('openai', [plugin1, plugin2])
      engine.usePlugins([{ name: 'resolver', resolveModel: vi.fn().mockResolvedValue(mockLanguageModel) }])

      const result = await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'base' })
      )

      expect(result.text).toBe('base + plugin1 + plugin2')
    })
  })

  describe('Recursive Calls', () => {
    it('should support recursive calls through context', async () => {
      let recursionCount = 0

      const plugin: AiPlugin = {
        name: 'recursive',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        transformParams: vi.fn().mockImplementation(async (params, context) => {
          if (recursionCount < 2 && context.recursiveCall) {
            recursionCount++
            await context.recursiveCall({ messages: [{ role: 'user', content: 'recursive' }] })
          }
          return params
        })
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      expect(recursionCount).toBe(2)
    })

    it('should track recursion depth', async () => {
      const depths: number[] = []

      const plugin: AiPlugin = {
        name: 'depth-tracker',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        transformParams: vi.fn().mockImplementation(async (params, context) => {
          depths.push(context.recursiveDepth)

          if (context.recursiveDepth < 3 && context.recursiveCall) {
            await context.recursiveCall({ messages: [] })
          }

          return params
        })
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      expect(depths).toEqual([0, 1, 2, 3])
    })

    it('should throw RecursiveDepthError when max depth exceeded', async () => {
      const plugin: AiPlugin = {
        name: 'infinite',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        transformParams: vi.fn().mockImplementation(async (params, context) => {
          if (context.recursiveCall) {
            await context.recursiveCall({ messages: [] })
          }
          return params
        })
      }

      engine = new PluginEngine('openai', [plugin])

      await expect(
        engine.executeWithPlugins(
          'generateText',
          { model: 'gpt-4', messages: [] },
          vi.fn().mockResolvedValue({ text: 'test' })
        )
      ).rejects.toThrow(RecursiveDepthError)
    })

    it('should restore recursion state after recursive call', async () => {
      const states: Array<{ depth: number; isRecursive: boolean }> = []

      const plugin: AiPlugin = {
        name: 'state-tracker',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        transformParams: vi.fn().mockImplementation(async (params, context) => {
          states.push({ depth: context.recursiveDepth, isRecursive: context.isRecursiveCall })

          if (context.recursiveDepth === 0 && context.recursiveCall) {
            await context.recursiveCall({ messages: [] })
            states.push({ depth: context.recursiveDepth, isRecursive: context.isRecursiveCall })
          }

          return params
        })
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      expect(states[0]).toEqual({ depth: 0, isRecursive: false })
      expect(states[1]).toEqual({ depth: 1, isRecursive: true })
      expect(states[2]).toEqual({ depth: 0, isRecursive: false })
    })
  })

  describe('Image Model Execution', () => {
    it('should execute image generation with plugins', async () => {
      const plugin: AiPlugin = {
        name: 'image-plugin',
        resolveModel: vi.fn().mockResolvedValue(mockImageModel),
        transformParams: vi.fn().mockImplementation(async (params) => params)
      }

      engine = new PluginEngine('openai', [plugin])

      const mockExecutor = vi.fn().mockResolvedValue({
        image: { base64: 'test', uint8Array: new Uint8Array(), mimeType: 'image/png' }
      })

      await engine.executeImageWithPlugins('generateImage', { model: 'dall-e-3', prompt: 'test' }, mockExecutor)

      expect(plugin.resolveModel).toHaveBeenCalledWith('dall-e-3', expect.any(Object))
      expect(mockExecutor).toHaveBeenCalled()
    })

    it('should skip resolution for direct image model objects', async () => {
      const resolveModelSpy = vi.fn()

      const plugin: AiPlugin = {
        name: 'image-resolver',
        resolveModel: resolveModelSpy
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeImageWithPlugins(
        'generateImage',
        { model: mockImageModel, prompt: 'test' },
        vi.fn().mockResolvedValue({ image: {} })
      )

      expect(resolveModelSpy).not.toHaveBeenCalled()
    })
  })

  describe('Streaming Execution', () => {
    it('should execute streaming with plugins', async () => {
      const plugin: AiPlugin = {
        name: 'stream-plugin',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        transformParams: vi.fn().mockImplementation(async (params) => params)
      }

      engine = new PluginEngine('openai', [plugin])

      const mockExecutor = vi.fn().mockResolvedValue({
        textStream: (async function* () {
          yield 'test'
        })()
      })

      await engine.executeStreamWithPlugins('streamText', { model: 'gpt-4', messages: [] }, mockExecutor)

      expect(plugin.resolveModel).toHaveBeenCalled()
      expect(mockExecutor).toHaveBeenCalled()
    })

    it('should collect stream transforms from plugins', async () => {
      const mockTransform = vi.fn()

      const plugin: AiPlugin = {
        name: 'stream-transformer',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        transformStream: mockTransform
      }

      engine = new PluginEngine('openai', [plugin])

      const mockExecutor = vi.fn().mockResolvedValue({ textStream: (async function* () {})() })

      await engine.executeStreamWithPlugins('streamText', { model: 'gpt-4', messages: [] }, mockExecutor)

      // Executor should receive stream transforms
      expect(mockExecutor).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), expect.arrayContaining([]))
    })
  })

  describe('Context Management', () => {
    it('should create context with correct provider and model', async () => {
      const configureContextSpy = vi.fn()

      const plugin: AiPlugin = {
        name: 'context-checker',
        configureContext: configureContextSpy,
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel)
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      expect(configureContextSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'openai',
          model: 'gpt-4'
        })
      )
    })

    it('should pass context to all hooks', async () => {
      const contextRefs: any[] = []

      const plugin: AiPlugin = {
        name: 'context-tracker',
        configureContext: vi.fn().mockImplementation(async (context) => {
          contextRefs.push(context)
        }),
        onRequestStart: vi.fn().mockImplementation(async (context) => {
          contextRefs.push(context)
        }),
        resolveModel: vi.fn().mockImplementation(async (_, context) => {
          contextRefs.push(context)
          return mockLanguageModel
        }),
        transformParams: vi.fn().mockImplementation(async (params, context) => {
          contextRefs.push(context)
          return params
        })
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      // All context refs should point to the same object
      expect(contextRefs.length).toBeGreaterThan(0)
      const firstContext = contextRefs[0]
      contextRefs.forEach((context) => {
        expect(context).toBe(firstContext)
      })
    })
  })

  describe('Error Handling', () => {
    it('should propagate errors from executor', async () => {
      const plugin: AiPlugin = {
        name: 'test',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel)
      }

      engine = new PluginEngine('openai', [plugin])

      const error = new Error('Executor failed')

      await expect(
        engine.executeWithPlugins('generateText', { model: 'gpt-4', messages: [] }, vi.fn().mockRejectedValue(error))
      ).rejects.toThrow('Executor failed')
    })

    it('should trigger onError for all plugins on failure', async () => {
      const onError1 = vi.fn()
      const onError2 = vi.fn()

      const plugin1: AiPlugin = { name: 'error-1', onError: onError1 }
      const plugin2: AiPlugin = { name: 'error-2', onError: onError2 }

      engine = new PluginEngine('openai', [plugin1, plugin2])
      engine.usePlugins([{ name: 'resolver', resolveModel: vi.fn().mockResolvedValue(mockLanguageModel) }])

      const error = new Error('Test failure')

      await expect(
        engine.executeWithPlugins('generateText', { model: 'gpt-4', messages: [] }, vi.fn().mockRejectedValue(error))
      ).rejects.toThrow()

      expect(onError1).toHaveBeenCalledWith(error, expect.any(Object))
      expect(onError2).toHaveBeenCalledWith(error, expect.any(Object))
    })

    it('should handle errors in plugin hooks gracefully', async () => {
      const plugin: AiPlugin = {
        name: 'failing-plugin',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        transformParams: vi.fn().mockRejectedValue(new Error('Transform failed'))
      }

      engine = new PluginEngine('openai', [plugin])

      await expect(
        engine.executeWithPlugins('generateText', { model: 'gpt-4', messages: [] }, vi.fn())
      ).rejects.toThrow('Transform failed')
    })
  })

  describe('Plugin Enforcement', () => {
    it('should respect plugin enforce ordering (pre, normal, post)', async () => {
      const executionOrder: string[] = []

      const prePlugin: AiPlugin = {
        name: 'pre-plugin',
        enforce: 'pre',
        onRequestStart: vi.fn(async () => {
          executionOrder.push('pre')
        })
      }

      const normalPlugin: AiPlugin = {
        name: 'normal-plugin',
        onRequestStart: vi.fn(async () => {
          executionOrder.push('normal')
        })
      }

      const postPlugin: AiPlugin = {
        name: 'post-plugin',
        enforce: 'post',
        onRequestStart: vi.fn(async () => {
          executionOrder.push('post')
        })
      }

      // Add in reverse order to test sorting
      engine = new PluginEngine('openai', [postPlugin, normalPlugin, prePlugin])
      engine.usePlugins([{ name: 'resolver', resolveModel: vi.fn().mockResolvedValue(mockLanguageModel) }])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      // Should execute in order: pre -> normal -> post
      expect(executionOrder).toEqual(['pre', 'normal', 'post'])
    })
  })

  describe('Middleware Application via context.middlewares', () => {
    it('should apply context.middlewares to model when plugin writes middlewares in configureContext', async () => {
      const middleware = createMockMiddleware()

      const plugin: AiPlugin = {
        name: 'middleware-writer',
        configureContext: vi.fn(async (context) => {
          context.middlewares = context.middlewares || []
          context.middlewares.push(middleware)
        }),
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel)
      }

      engine = new PluginEngine('openai', [plugin])

      const mockExecutor = vi.fn().mockResolvedValue({ text: 'test' })

      await engine.executeWithPlugins('generateText', { model: 'gpt-4', messages: [] }, mockExecutor)

      expect(wrapLanguageModel).toHaveBeenCalledWith({
        model: mockLanguageModel,
        middleware: [middleware]
      })
    })

    it('should apply context.middlewares when model is a direct object (not string)', async () => {
      const middleware = createMockMiddleware()

      const plugin: AiPlugin = {
        name: 'middleware-writer',
        configureContext: vi.fn(async (context) => {
          context.middlewares = context.middlewares || []
          context.middlewares.push(middleware)
        })
      }

      engine = new PluginEngine('openai', [plugin])

      const mockExecutor = vi.fn().mockResolvedValue({ text: 'test' })

      await engine.executeWithPlugins('generateText', { model: mockLanguageModel, messages: [] }, mockExecutor)

      // Key assertion: middlewares should be applied even for direct model objects
      expect(wrapLanguageModel).toHaveBeenCalledWith({
        model: mockLanguageModel,
        middleware: [middleware]
      })
    })

    it('should apply multiple middlewares from different plugins', async () => {
      const middleware1 = createMockMiddleware()
      const middleware2 = createMockMiddleware()

      const plugin1: AiPlugin = {
        name: 'plugin-1',
        enforce: 'pre',
        configureContext: vi.fn(async (context) => {
          context.middlewares = context.middlewares || []
          context.middlewares.push(middleware1)
        })
      }

      const plugin2: AiPlugin = {
        name: 'plugin-2',
        configureContext: vi.fn(async (context) => {
          context.middlewares = context.middlewares || []
          context.middlewares.push(middleware2)
        })
      }

      engine = new PluginEngine('openai', [plugin1, plugin2])
      engine.usePlugins([{ name: 'resolver', resolveModel: vi.fn().mockResolvedValue(mockLanguageModel) }])

      const mockExecutor = vi.fn().mockResolvedValue({ text: 'test' })

      await engine.executeWithPlugins('generateText', { model: 'gpt-4', messages: [] }, mockExecutor)

      expect(wrapLanguageModel).toHaveBeenCalledWith({
        model: mockLanguageModel,
        middleware: [middleware1, middleware2]
      })
    })

    it('should not call wrapLanguageModel when no middlewares are set', async () => {
      vi.mocked(wrapLanguageModel).mockClear()

      const plugin: AiPlugin = {
        name: 'no-middleware',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel)
      }

      engine = new PluginEngine('openai', [plugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test' })
      )

      expect(wrapLanguageModel).not.toHaveBeenCalled()
    })

    it('should apply context.middlewares in streamText path', async () => {
      const middleware = createMockMiddleware()

      const plugin: AiPlugin = {
        name: 'stream-middleware',
        configureContext: vi.fn(async (context) => {
          context.middlewares = context.middlewares || []
          context.middlewares.push(middleware)
        })
      }

      engine = new PluginEngine('openai', [plugin])

      const mockExecutor = vi.fn().mockResolvedValue({
        textStream: (async function* () {
          yield 'test'
        })()
      })

      await engine.executeStreamWithPlugins('streamText', { model: mockLanguageModel, messages: [] }, mockExecutor)

      expect(wrapLanguageModel).toHaveBeenCalledWith({
        model: mockLanguageModel,
        middleware: [middleware]
      })
    })
  })

  describe('Type Safety', () => {
    it('should properly type plugin parameters', async () => {
      const transformParamsSpy = vi.fn().mockImplementation(async (params) => {
        // Type assertions for safety
        expect(params).toHaveProperty('messages')
        return params
      })

      const transformResultSpy = vi.fn().mockImplementation(async (result) => {
        expect(result).toHaveProperty('text')
        return result
      })

      const typedPlugin: AiPlugin = {
        name: 'typed-plugin',
        resolveModel: vi.fn().mockResolvedValue(mockLanguageModel),
        transformParams: transformParamsSpy,
        transformResult: transformResultSpy
      }

      engine = new PluginEngine('openai', [typedPlugin])

      await engine.executeWithPlugins(
        'generateText',
        { model: 'gpt-4', messages: [] },
        vi.fn().mockResolvedValue({ text: 'test', finishReason: 'stop' })
      )

      expect(transformParamsSpy).toHaveBeenCalled()
      expect(transformResultSpy).toHaveBeenCalled()
    })
  })
})
