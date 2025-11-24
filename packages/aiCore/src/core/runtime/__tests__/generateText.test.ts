/**
 * RuntimeExecutor.generateText Comprehensive Tests
 * Tests non-streaming text generation across all providers with various parameters
 */

import { generateText } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createMockLanguageModel,
  mockCompleteResponses,
  mockProviderConfigs,
  testMessages,
  testTools
} from '../../../__tests__'
import type { AiPlugin } from '../../plugins'
import { globalRegistryManagement } from '../../providers/RegistryManagement'
import { RuntimeExecutor } from '../executor'

// Mock AI SDK
vi.mock('ai', () => ({
  generateText: vi.fn()
}))

vi.mock('../../providers/RegistryManagement', () => ({
  globalRegistryManagement: {
    languageModel: vi.fn()
  },
  DEFAULT_SEPARATOR: '|'
}))

describe('RuntimeExecutor.generateText', () => {
  let executor: RuntimeExecutor<'openai'>
  let mockLanguageModel: any

  beforeEach(() => {
    vi.clearAllMocks()

    executor = RuntimeExecutor.create('openai', mockProviderConfigs.openai)

    mockLanguageModel = createMockLanguageModel({
      provider: 'openai',
      modelId: 'gpt-4'
    })

    vi.mocked(globalRegistryManagement.languageModel).mockReturnValue(mockLanguageModel)
    vi.mocked(generateText).mockResolvedValue(mockCompleteResponses.simple as any)
  })

  describe('Basic Functionality', () => {
    it('should generate text with minimal parameters', async () => {
      const result = await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.simple
      })

      expect(generateText).toHaveBeenCalledWith({
        model: mockLanguageModel,
        messages: testMessages.simple
      })

      expect(result.text).toBe('This is a simple response.')
      expect(result.finishReason).toBe('stop')
      expect(result.usage).toBeDefined()
    })

    it('should generate with system messages', async () => {
      await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.withSystem
      })

      expect(generateText).toHaveBeenCalledWith({
        model: mockLanguageModel,
        messages: testMessages.withSystem
      })
    })

    it('should generate with conversation history', async () => {
      await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.conversation
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: testMessages.conversation
        })
      )
    })
  })

  describe('All Parameter Combinations', () => {
    it('should support all parameters together', async () => {
      await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.simple,
        temperature: 0.7,
        maxOutputTokens: 500,
        topP: 0.9,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        stopSequences: ['STOP'],
        seed: 12345
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          maxOutputTokens: 500,
          topP: 0.9,
          frequencyPenalty: 0.5,
          presencePenalty: 0.3,
          stopSequences: ['STOP'],
          seed: 12345
        })
      )
    })

    it('should support partial parameters', async () => {
      await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.simple,
        temperature: 0.5,
        maxOutputTokens: 100
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.5,
          maxOutputTokens: 100
        })
      )
    })
  })

  describe('Tool Calling', () => {
    beforeEach(() => {
      vi.mocked(generateText).mockResolvedValue(mockCompleteResponses.withToolCalls as any)
    })

    it('should support tool calling', async () => {
      const result = await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.toolUse,
        tools: testTools
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: testTools
        })
      )

      expect(result.toolCalls).toBeDefined()
      expect(result.toolCalls).toHaveLength(1)
    })

    it('should support toolChoice auto', async () => {
      await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.toolUse,
        tools: testTools,
        toolChoice: 'auto'
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          toolChoice: 'auto'
        })
      )
    })

    it('should support toolChoice required', async () => {
      await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.toolUse,
        tools: testTools,
        toolChoice: 'required'
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          toolChoice: 'required'
        })
      )
    })

    it('should support toolChoice none', async () => {
      vi.mocked(generateText).mockResolvedValue(mockCompleteResponses.simple as any)

      await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.simple,
        tools: testTools,
        toolChoice: 'none'
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          toolChoice: 'none'
        })
      )
    })

    it('should support specific tool selection', async () => {
      await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.toolUse,
        tools: testTools,
        toolChoice: {
          type: 'tool',
          toolName: 'getWeather'
        }
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          toolChoice: {
            type: 'tool',
            toolName: 'getWeather'
          }
        })
      )
    })
  })

  describe('Multiple Providers', () => {
    it('should work with Anthropic provider', async () => {
      const anthropicExecutor = RuntimeExecutor.create('anthropic', mockProviderConfigs.anthropic)

      const anthropicModel = createMockLanguageModel({
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022'
      })

      vi.mocked(globalRegistryManagement.languageModel).mockReturnValue(anthropicModel)

      await anthropicExecutor.generateText({
        model: 'claude-3-5-sonnet-20241022',
        messages: testMessages.simple
      })

      expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('anthropic|claude-3-5-sonnet-20241022')
    })

    it('should work with Google provider', async () => {
      const googleExecutor = RuntimeExecutor.create('google', mockProviderConfigs.google)

      const googleModel = createMockLanguageModel({
        provider: 'google',
        modelId: 'gemini-2.0-flash-exp'
      })

      vi.mocked(globalRegistryManagement.languageModel).mockReturnValue(googleModel)

      await googleExecutor.generateText({
        model: 'gemini-2.0-flash-exp',
        messages: testMessages.simple
      })

      expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('google|gemini-2.0-flash-exp')
    })

    it('should work with xAI provider', async () => {
      const xaiExecutor = RuntimeExecutor.create('xai', mockProviderConfigs.xai)

      const xaiModel = createMockLanguageModel({
        provider: 'xai',
        modelId: 'grok-2-latest'
      })

      vi.mocked(globalRegistryManagement.languageModel).mockReturnValue(xaiModel)

      await xaiExecutor.generateText({
        model: 'grok-2-latest',
        messages: testMessages.simple
      })

      expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('xai|grok-2-latest')
    })

    it('should work with DeepSeek provider', async () => {
      const deepseekExecutor = RuntimeExecutor.create('deepseek', mockProviderConfigs.deepseek)

      const deepseekModel = createMockLanguageModel({
        provider: 'deepseek',
        modelId: 'deepseek-chat'
      })

      vi.mocked(globalRegistryManagement.languageModel).mockReturnValue(deepseekModel)

      await deepseekExecutor.generateText({
        model: 'deepseek-chat',
        messages: testMessages.simple
      })

      expect(globalRegistryManagement.languageModel).toHaveBeenCalledWith('deepseek|deepseek-chat')
    })
  })

  describe('Plugin Integration', () => {
    it('should execute all plugin hooks', async () => {
      const pluginCalls: string[] = []

      const testPlugin: AiPlugin = {
        name: 'test-plugin',
        onRequestStart: vi.fn(async () => {
          pluginCalls.push('onRequestStart')
        }),
        transformParams: vi.fn(async (params) => {
          pluginCalls.push('transformParams')
          return { ...params, temperature: 0.8 }
        }),
        transformResult: vi.fn(async (result) => {
          pluginCalls.push('transformResult')
          return { ...result, text: result.text + ' [modified]' }
        }),
        onRequestEnd: vi.fn(async () => {
          pluginCalls.push('onRequestEnd')
        })
      }

      const executorWithPlugin = RuntimeExecutor.create('openai', mockProviderConfigs.openai, [testPlugin])

      const result = await executorWithPlugin.generateText({
        model: 'gpt-4',
        messages: testMessages.simple
      })

      expect(pluginCalls).toEqual(['onRequestStart', 'transformParams', 'transformResult', 'onRequestEnd'])

      // Verify transformed parameters
      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.8
        })
      )

      // Verify transformed result
      expect(result.text).toContain('[modified]')
    })

    it('should handle multiple plugins in order', async () => {
      const pluginOrder: string[] = []

      const plugin1: AiPlugin = {
        name: 'plugin-1',
        transformParams: vi.fn(async (params) => {
          pluginOrder.push('plugin-1')
          return { ...params, temperature: 0.5 }
        })
      }

      const plugin2: AiPlugin = {
        name: 'plugin-2',
        transformParams: vi.fn(async (params) => {
          pluginOrder.push('plugin-2')
          return { ...params, maxTokens: 200 }
        })
      }

      const executorWithPlugins = RuntimeExecutor.create('openai', mockProviderConfigs.openai, [plugin1, plugin2])

      await executorWithPlugins.generateText({
        model: 'gpt-4',
        messages: testMessages.simple
      })

      expect(pluginOrder).toEqual(['plugin-1', 'plugin-2'])

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.5,
          maxTokens: 200
        })
      )
    })
  })

  describe('Error Handling', () => {
    it('should handle API errors', async () => {
      const error = new Error('API request failed')
      vi.mocked(generateText).mockRejectedValue(error)

      await expect(
        executor.generateText({
          model: 'gpt-4',
          messages: testMessages.simple
        })
      ).rejects.toThrow('API request failed')
    })

    it('should execute onError plugin hook', async () => {
      const error = new Error('Generation failed')
      vi.mocked(generateText).mockRejectedValue(error)

      const errorPlugin: AiPlugin = {
        name: 'error-handler',
        onError: vi.fn()
      }

      const executorWithPlugin = RuntimeExecutor.create('openai', mockProviderConfigs.openai, [errorPlugin])

      await expect(
        executorWithPlugin.generateText({
          model: 'gpt-4',
          messages: testMessages.simple
        })
      ).rejects.toThrow('Generation failed')

      expect(errorPlugin.onError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          providerId: 'openai',
          modelId: 'gpt-4'
        })
      )
    })

    it('should handle model not found error', async () => {
      const error = new Error('Model not found: invalid-model')
      vi.mocked(globalRegistryManagement.languageModel).mockImplementation(() => {
        throw error
      })

      await expect(
        executor.generateText({
          model: 'invalid-model',
          messages: testMessages.simple
        })
      ).rejects.toThrow('Model not found')
    })
  })

  describe('Usage and Metadata', () => {
    it('should return usage information', async () => {
      const result = await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.simple
      })

      expect(result.usage).toBeDefined()
      expect(result.usage.inputTokens).toBe(15)
      expect(result.usage.outputTokens).toBe(8)
      expect(result.usage.totalTokens).toBe(23)
    })

    it('should handle warnings', async () => {
      vi.mocked(generateText).mockResolvedValue(mockCompleteResponses.withWarnings as any)

      const result = await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.simple,
        temperature: 2.5 // Unsupported value
      })

      expect(result.warnings).toBeDefined()
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings![0].type).toBe('unsupported-setting')
    })
  })

  describe('Abort Signal', () => {
    it('should support abort signal', async () => {
      const abortController = new AbortController()

      await executor.generateText({
        model: 'gpt-4',
        messages: testMessages.simple,
        abortSignal: abortController.signal
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: abortController.signal
        })
      )
    })

    it('should handle aborted request', async () => {
      const abortError = new Error('Request aborted')
      abortError.name = 'AbortError'

      vi.mocked(generateText).mockRejectedValue(abortError)

      const abortController = new AbortController()
      abortController.abort()

      await expect(
        executor.generateText({
          model: 'gpt-4',
          messages: testMessages.simple,
          abortSignal: abortController.signal
        })
      ).rejects.toThrow('Request aborted')
    })
  })
})
