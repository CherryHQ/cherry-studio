/**
 * RuntimeExecutor.streamText Comprehensive Tests
 * Tests streaming text generation across all providers with various parameters
 */

import {
  collectStreamChunks,
  createMockLanguageModel,
  createMockProviderV3,
  mockProviderConfigs,
  testMessages
} from '@test-utils'
import { streamText } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiPlugin } from '../../plugins'
import { RuntimeExecutor } from '../executor'

// Mock AI SDK - use importOriginal to keep jsonSchema and other non-mocked exports
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    streamText: vi.fn()
  }
})

describe('RuntimeExecutor.streamText', () => {
  let executor: RuntimeExecutor
  let mockLanguageModel: any
  let mockProvider: any

  beforeEach(() => {
    vi.clearAllMocks()

    mockLanguageModel = createMockLanguageModel({
      provider: 'openai',
      modelId: 'gpt-4'
    })

    mockProvider = createMockProviderV3({
      provider: 'openai',
      languageModel: () => mockLanguageModel
    })

    executor = RuntimeExecutor.create('openai', mockProvider, mockProviderConfigs.openai)
  })

  describe('Basic Functionality', () => {
    it('should stream text with minimal parameters', async () => {
      const mockStream = {
        textStream: (async function* () {
          yield 'Hello'
          yield ' '
          yield 'World'
        })(),
        fullStream: (async function* () {
          yield { type: 'text-delta', textDelta: 'Hello' }
          yield { type: 'text-delta', textDelta: ' ' }
          yield { type: 'text-delta', textDelta: 'World' }
        })(),
        usage: Promise.resolve({ promptTokens: 5, completionTokens: 3, totalTokens: 8 })
      }

      vi.mocked(streamText).mockResolvedValue(mockStream as any)

      const result = await executor.streamText({
        model: 'gpt-4',
        messages: testMessages.simple
      })

      expect(streamText).toHaveBeenCalledWith({
        model: mockLanguageModel,
        messages: testMessages.simple
      })

      const chunks = await collectStreamChunks(result.textStream)
      expect(chunks).toEqual(['Hello', ' ', 'World'])
    })

    it('should stream with system messages', async () => {
      const mockStream = {
        textStream: (async function* () {
          yield 'Response'
        })(),
        fullStream: (async function* () {
          yield { type: 'text-delta', textDelta: 'Response' }
        })()
      }

      vi.mocked(streamText).mockResolvedValue(mockStream as any)

      await executor.streamText({
        model: 'gpt-4',
        messages: testMessages.withSystem
      })

      expect(streamText).toHaveBeenCalledWith({
        model: mockLanguageModel,
        messages: testMessages.withSystem
      })
    })

    it('should stream multi-turn conversations', async () => {
      const mockStream = {
        textStream: (async function* () {
          yield 'Multi-turn response'
        })(),
        fullStream: (async function* () {
          yield { type: 'text-delta', textDelta: 'Multi-turn response' }
        })()
      }

      vi.mocked(streamText).mockResolvedValue(mockStream as any)

      await executor.streamText({
        model: 'gpt-4',
        messages: testMessages.multiTurn
      })

      expect(streamText).toHaveBeenCalled()
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: testMessages.multiTurn
        })
      )
    })
  })

  it('forwards sampling settings to the SDK, including zero and negative values', async () => {
    const settings = {
      temperature: 0,
      maxOutputTokens: 100,
      topP: 0.9,
      frequencyPenalty: -0.5,
      presencePenalty: 0.5,
      seed: 0
    }

    vi.mocked(streamText).mockResolvedValue({
      textStream: (async function* () {
        yield 'Response'
      })()
    } as any)

    await executor.streamText({ model: 'gpt-4', messages: testMessages.simple, ...settings })

    expect(streamText).toHaveBeenCalledWith(expect.objectContaining(settings))
  })

  describe('Abort Signal', () => {
    it('should support abort signal', async () => {
      const abortController = new AbortController()

      const mockStream = {
        textStream: (async function* () {
          yield 'Response'
        })(),
        fullStream: (async function* () {
          yield { type: 'text-delta', textDelta: 'Response' }
        })()
      }

      vi.mocked(streamText).mockResolvedValue(mockStream as any)

      await executor.streamText({
        model: 'gpt-4',
        messages: testMessages.simple,
        abortSignal: abortController.signal
      })

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: abortController.signal
        })
      )
    })

    it('should handle abort during streaming', async () => {
      const abortController = new AbortController()

      const mockStream = {
        textStream: (async function* () {
          yield 'Start'
          // Simulate abort
          abortController.abort()
          throw new Error('Aborted')
        })(),
        fullStream: (async function* () {
          yield { type: 'text-delta', textDelta: 'Start' }
          throw new Error('Aborted')
        })()
      }

      vi.mocked(streamText).mockResolvedValue(mockStream as any)

      const result = await executor.streamText({
        model: 'gpt-4',
        messages: testMessages.simple,
        abortSignal: abortController.signal
      })

      await expect(async () => {
        // oxlint-disable-next-line no-unused-vars
        for await (const _chunk of result.textStream) {
          // Stream should be interrupted
        }
      }).rejects.toThrow('Aborted')
    })
  })

  describe('Plugin Integration', () => {
    it('should execute plugins during streaming', async () => {
      const pluginCalls: string[] = []

      const testPlugin: AiPlugin = {
        name: 'test-plugin',
        onRequestStart: vi.fn(async () => {
          pluginCalls.push('onRequestStart')
        }),
        transformParams: vi.fn(async (params) => {
          pluginCalls.push('transformParams')
          return { ...params, temperature: 0.5 }
        }),
        onRequestEnd: vi.fn(async () => {
          pluginCalls.push('onRequestEnd')
        })
      }

      const executorWithPlugin = RuntimeExecutor.create('openai', mockProvider, mockProviderConfigs.openai, [
        testPlugin
      ])

      const mockStream = {
        textStream: (async function* () {
          yield 'Response'
        })(),
        fullStream: (async function* () {
          yield { type: 'text-delta', textDelta: 'Response' }
        })()
      }

      vi.mocked(streamText).mockResolvedValue(mockStream as any)

      const result = await executorWithPlugin.streamText({
        model: 'gpt-4',
        messages: testMessages.simple
      })

      // Consume stream
      // oxlint-disable-next-line no-unused-vars
      for await (const _chunk of result.textStream) {
        // Stream chunks
      }

      expect(pluginCalls).toContain('onRequestStart')
      expect(pluginCalls).toContain('transformParams')

      // Verify transformed parameters were used
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.5
        })
      )
    })
  })

  describe('Full Stream with Finish Reason', () => {
    it('should provide finish reason in full stream', async () => {
      const mockStream = {
        textStream: (async function* () {
          yield 'Response'
        })(),
        fullStream: (async function* () {
          yield { type: 'text-delta', textDelta: 'Response' }
          yield {
            type: 'finish',
            finishReason: 'stop',
            usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 }
          }
        })()
      }

      vi.mocked(streamText).mockResolvedValue(mockStream as any)

      const result = await executor.streamText({
        model: 'gpt-4',
        messages: testMessages.simple
      })

      const fullChunks = await collectStreamChunks(result.fullStream)

      expect(fullChunks).toHaveLength(2)
      expect(fullChunks[0]).toEqual({ type: 'text-delta', textDelta: 'Response' })
      expect(fullChunks[1]).toEqual({
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 }
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle streaming errors', async () => {
      const error = new Error('Streaming failed')
      vi.mocked(streamText).mockRejectedValue(error)

      await expect(
        executor.streamText({
          model: 'gpt-4',
          messages: testMessages.simple
        })
      ).rejects.toThrow('Streaming failed')
    })

    it('should execute onError plugin hook on failure', async () => {
      const error = new Error('Stream error')
      vi.mocked(streamText).mockRejectedValue(error)

      const errorPlugin: AiPlugin = {
        name: 'error-handler',
        onError: vi.fn()
      }

      const executorWithPlugin = RuntimeExecutor.create('openai', mockProvider, mockProviderConfigs.openai, [
        errorPlugin
      ])

      await expect(
        executorWithPlugin.streamText({
          model: 'gpt-4',
          messages: testMessages.simple
        })
      ).rejects.toThrow('Stream error')

      // onError receives the original error and context with core fields
      // context.model is the resolved LanguageModel (updated after resolveModel hook)
      expect(errorPlugin.onError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          providerId: 'openai',
          model: expect.objectContaining({ modelId: 'gpt-4' })
        })
      )
    })
  })
})
