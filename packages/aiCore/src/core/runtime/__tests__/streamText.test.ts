/**
 * RuntimeExecutor.streamText Comprehensive Tests
 * Tests streaming text generation across all providers with various parameters
 */

import { streamText } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { collectStreamChunks, createMockLanguageModel, mockProviderConfigs, testMessages } from '../../../__tests__'
import type { AiPlugin } from '../../plugins'
import { globalRegistryManagement } from '../../providers/RegistryManagement'
import { RuntimeExecutor } from '../executor'

// Mock AI SDK
vi.mock('ai', () => ({
  streamText: vi.fn()
}))

vi.mock('../../providers/RegistryManagement', () => ({
  globalRegistryManagement: {
    languageModel: vi.fn()
  },
  DEFAULT_SEPARATOR: '|'
}))

describe('RuntimeExecutor.streamText', () => {
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

  describe('Temperature Parameter', () => {
    const temperatures = [0, 0.3, 0.5, 0.7, 0.9, 1.0, 1.5, 2.0]

    it.each(temperatures)('should support temperature=%s', async (temperature) => {
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
        temperature
      })

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature
        })
      )
    })
  })

  describe('Max Tokens Parameter', () => {
    const maxTokensValues = [10, 50, 100, 500, 1000, 2000, 4000]

    it.each(maxTokensValues)('should support maxTokens=%s', async (maxTokens) => {
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
        maxOutputTokens: maxTokens
      })

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens
        })
      )
    })
  })

  describe('Top P Parameter', () => {
    const topPValues = [0.1, 0.3, 0.5, 0.7, 0.9, 0.95, 1.0]

    it.each(topPValues)('should support topP=%s', async (topP) => {
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
        topP
      })

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          topP
        })
      )
    })
  })

  describe('Frequency and Presence Penalty', () => {
    it('should support frequency penalty', async () => {
      const penalties = [-2.0, -1.0, 0, 0.5, 1.0, 1.5, 2.0]

      for (const frequencyPenalty of penalties) {
        vi.clearAllMocks()

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
          frequencyPenalty
        })

        expect(streamText).toHaveBeenCalledWith(
          expect.objectContaining({
            frequencyPenalty
          })
        )
      }
    })

    it('should support presence penalty', async () => {
      const penalties = [-2.0, -1.0, 0, 0.5, 1.0, 1.5, 2.0]

      for (const presencePenalty of penalties) {
        vi.clearAllMocks()

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
          presencePenalty
        })

        expect(streamText).toHaveBeenCalledWith(
          expect.objectContaining({
            presencePenalty
          })
        )
      }
    })

    it('should support both penalties together', async () => {
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
        frequencyPenalty: 0.5,
        presencePenalty: 0.5
      })

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          frequencyPenalty: 0.5,
          presencePenalty: 0.5
        })
      )
    })
  })

  describe('Seed Parameter', () => {
    it('should support seed for deterministic output', async () => {
      const seeds = [0, 12345, 67890, 999999]

      for (const seed of seeds) {
        vi.clearAllMocks()

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
          seed
        })

        expect(streamText).toHaveBeenCalledWith(
          expect.objectContaining({
            seed
          })
        )
      }
    })
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
        for await (const chunk of result.textStream) {
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

      const executorWithPlugin = RuntimeExecutor.create('openai', mockProviderConfigs.openai, [testPlugin])

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
      for await (const chunk of result.textStream) {
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

      const executorWithPlugin = RuntimeExecutor.create('openai', mockProviderConfigs.openai, [errorPlugin])

      await expect(
        executorWithPlugin.streamText({
          model: 'gpt-4',
          messages: testMessages.simple
        })
      ).rejects.toThrow('Stream error')

      expect(errorPlugin.onError).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          providerId: 'openai',
          modelId: 'gpt-4'
        })
      )
    })
  })
})
