import type { SharedV3ProviderMetadata } from '@ai-sdk/provider'
import type {
  EmbeddingModelUsage,
  ImageModelUsage,
  LanguageModelUsage as AiSdkUsage,
  LanguageModelUsage,
  TextStreamPart,
  ToolSet
} from 'ai'
import { simulateReadableStream } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockContext, createMockTool } from '../../../../../__tests__'
import { StreamEventManager } from '../StreamEventManager'
import type { StreamController } from '../ToolExecutor'

/**
 * Type alias for empty toolset (no tools)
 * Using Record<string, never> ensures type safety for tests without tools
 */
type EmptyToolSet = Record<string, never>

/**
 * Mock StreamController for testing
 * Provides type-safe enqueue function that accepts TextStreamPart chunks
 */
interface MockStreamController<TOOLS extends ToolSet = EmptyToolSet> extends StreamController {
  enqueue: ReturnType<typeof vi.fn<(chunk: TextStreamPart<TOOLS>) => void>>
}

/**
 * Create a type-safe mock stream controller
 */
function createMockStreamController<TOOLS extends ToolSet = EmptyToolSet>(): MockStreamController<TOOLS> {
  return {
    enqueue: vi.fn()
  }
}

/**
 * Type for chunk data in finish-step events
 */
interface FinishStepChunk {
  usage?: Partial<AiSdkUsage>
  response?: { id: string; [key: string]: unknown }
  providerMetadata?: SharedV3ProviderMetadata
}

describe('StreamEventManager', () => {
  let manager: StreamEventManager

  beforeEach(() => {
    manager = new StreamEventManager()
  })

  describe('accumulateUsage', () => {
    describe('LanguageModelUsage', () => {
      it('should accumulate language model usage correctly', () => {
        const target: Partial<LanguageModelUsage> = {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30
        }
        const source: Partial<LanguageModelUsage> = {
          inputTokens: 5,
          outputTokens: 10,
          totalTokens: 15
        }

        manager.accumulateUsage(target, source)

        expect(target.inputTokens).toBe(15)
        expect(target.outputTokens).toBe(30)
        expect(target.totalTokens).toBe(45)
      })

      it('should handle undefined values in target', () => {
        const target: Partial<LanguageModelUsage> = { inputTokens: 10 }
        const source: Partial<LanguageModelUsage> = {
          inputTokens: 5,
          outputTokens: 10,
          totalTokens: 15
        }

        manager.accumulateUsage(target, source)

        expect(target.inputTokens).toBe(15)
        expect(target.outputTokens).toBe(10)
        expect(target.totalTokens).toBe(15)
      })

      it('should handle undefined values in source', () => {
        const target: Partial<LanguageModelUsage> = {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30
        }
        const source: Partial<LanguageModelUsage> = { inputTokens: 5 }

        manager.accumulateUsage(target, source)

        expect(target.inputTokens).toBe(15)
        expect(target.outputTokens).toBe(20)
        expect(target.totalTokens).toBe(30)
      })

      it('should handle zero values correctly', () => {
        const target: Partial<LanguageModelUsage> = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0
        }
        const source: Partial<LanguageModelUsage> = {
          inputTokens: 5,
          outputTokens: 10,
          totalTokens: 15
        }

        manager.accumulateUsage(target, source)

        expect(target.inputTokens).toBe(5)
        expect(target.outputTokens).toBe(10)
        expect(target.totalTokens).toBe(15)
      })
    })

    describe('ImageModelUsage', () => {
      it('should accumulate image model usage correctly', () => {
        const target: Partial<ImageModelUsage> = {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150
        }
        const source: Partial<ImageModelUsage> = {
          inputTokens: 50,
          outputTokens: 25,
          totalTokens: 75
        }

        manager.accumulateUsage(target, source)

        expect(target.inputTokens).toBe(150)
        expect(target.outputTokens).toBe(75)
        expect(target.totalTokens).toBe(225)
      })

      it('should handle undefined values', () => {
        const target: Partial<ImageModelUsage> = { inputTokens: 100 }
        const source: Partial<ImageModelUsage> = {
          outputTokens: 50,
          totalTokens: 50
        }

        manager.accumulateUsage(target, source)

        expect(target.inputTokens).toBe(100)
        expect(target.outputTokens).toBe(50)
        expect(target.totalTokens).toBe(50)
      })
    })

    describe('EmbeddingModelUsage', () => {
      it('should accumulate embedding model usage correctly', () => {
        const target: Partial<EmbeddingModelUsage> = { tokens: 100 }
        const source: Partial<EmbeddingModelUsage> = { tokens: 50 }

        manager.accumulateUsage(target, source)

        expect(target.tokens).toBe(150)
      })

      it('should handle zero to non-zero accumulation', () => {
        const target: Partial<EmbeddingModelUsage> = { tokens: 0 }
        const source: Partial<EmbeddingModelUsage> = { tokens: 50 }

        manager.accumulateUsage(target, source)

        expect(target.tokens).toBe(50)
      })

      it('should handle zero values', () => {
        const target: Partial<EmbeddingModelUsage> = { tokens: 0 }
        const source: Partial<EmbeddingModelUsage> = { tokens: 100 }

        manager.accumulateUsage(target, source)

        expect(target.tokens).toBe(100)
      })
    })

    describe('Type Guard Validation', () => {
      it('should warn on type mismatch between LanguageModelUsage and EmbeddingModelUsage', () => {
        const warnSpy = vi.spyOn(console, 'warn')
        const target: Partial<LanguageModelUsage> = { inputTokens: 10 }
        const source: Partial<EmbeddingModelUsage> = { tokens: 5 }

        manager.accumulateUsage(target, source)

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Unable to accumulate usage'),
          expect.objectContaining({
            target,
            source
          })
        )

        warnSpy.mockRestore()
      })

      it('should warn on type mismatch between ImageModelUsage and EmbeddingModelUsage', () => {
        const warnSpy = vi.spyOn(console, 'warn')
        const target: Partial<ImageModelUsage> = { inputTokens: 100 }
        const source: Partial<EmbeddingModelUsage> = { tokens: 50 }

        manager.accumulateUsage(target, source)

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unable to accumulate usage'), expect.any(Object))

        warnSpy.mockRestore()
      })
    })
  })

  describe('buildRecursiveParams', () => {
    it('should include textBuffer in assistant message when not empty', () => {
      const context = createMockContext()
      const textBuffer = 'test response'
      const toolResultsText = '<tool_use_result>...</tool_use_result>'
      const tools = {
        test_tool: createMockTool('test_tool')
      }

      const params = manager.buildRecursiveParams(context, textBuffer, toolResultsText, tools)

      expect(params.messages).toHaveLength(3)
      expect(params.messages?.[0]).toEqual({ role: 'user', content: 'Test message' })
      expect(params.messages?.[1]).toEqual({ role: 'assistant', content: textBuffer })
      expect(params.messages?.[2]).toEqual({
        role: 'user',
        content: toolResultsText
      })
      expect(params.tools).toBe(tools)
    })

    it('should skip empty textBuffer in messages', () => {
      const context = createMockContext()
      const textBuffer = ''
      const toolResultsText = '<tool_use_result>...</tool_use_result>'
      const tools = {}

      const params = manager.buildRecursiveParams(context, textBuffer, toolResultsText, tools)

      // Should only have original user message and new user message with tool results
      expect(params.messages).toHaveLength(2)
      expect(params.messages?.[0]).toEqual({ role: 'user', content: 'Test message' })
      expect(params.messages?.[1]).toEqual({
        role: 'user',
        content: toolResultsText
      })

      const assistantMessages = params.messages?.filter((m) => m.role === 'assistant')
      expect(assistantMessages).toHaveLength(0)
    })

    it('should preserve all original messages', () => {
      const context = createMockContext({
        originalParams: {
          messages: [
            { role: 'user', content: 'First message' },
            { role: 'assistant', content: 'First response' },
            { role: 'user', content: 'Second message' }
          ]
        }
      })

      const params = manager.buildRecursiveParams(context, 'New response', 'Tool results', {})

      expect(params.messages).toHaveLength(5)
      expect(params.messages?.[0]).toEqual({ role: 'user', content: 'First message' })
      expect(params.messages?.[1]).toEqual({
        role: 'assistant',
        content: 'First response'
      })
      expect(params.messages?.[2]).toEqual({ role: 'user', content: 'Second message' })
      expect(params.messages?.[3]).toEqual({ role: 'assistant', content: 'New response' })
      expect(params.messages?.[4]).toEqual({ role: 'user', content: 'Tool results' })
    })

    it('should pass through tools parameter', () => {
      const context = createMockContext()
      const tools = {
        tool1: createMockTool('tool1'),
        tool2: createMockTool('tool2')
      }

      const params = manager.buildRecursiveParams(context, 'response', 'results', tools)

      expect(params.tools).toBe(tools)
      expect(Object.keys(params.tools!)).toHaveLength(2)
    })
  })

  describe('sendStepStartEvent', () => {
    it('should enqueue start-step event with correct structure', () => {
      const controller = createMockStreamController()

      manager.sendStepStartEvent(controller)

      expect(controller.enqueue).toHaveBeenCalledWith({
        type: 'start-step',
        request: {},
        warnings: []
      })
    })
  })

  describe('sendStepFinishEvent', () => {
    it('should enqueue finish-step event with provided finishReason', () => {
      const controller = createMockStreamController()

      const chunk: FinishStepChunk = {
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30
        },
        response: { id: 'test-response' },
        providerMetadata: { 'test-provider': {} }
      }

      const context = createMockContext({
        accumulatedUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0
        }
      })

      manager.sendStepFinishEvent(controller, chunk, context, 'tool-calls')

      expect(controller.enqueue).toHaveBeenCalledWith({
        type: 'finish-step',
        finishReason: 'tool-calls',
        response: chunk.response,
        usage: chunk.usage,
        providerMetadata: chunk.providerMetadata
      })
    })

    it('should accumulate usage when provided', () => {
      const controller = createMockStreamController()

      const chunk: FinishStepChunk = {
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30
        }
      }

      const context = createMockContext({
        accumulatedUsage: {
          inputTokens: 5,
          outputTokens: 10,
          totalTokens: 15
        }
      })

      manager.sendStepFinishEvent(controller, chunk, context)

      // Verify accumulation happened
      expect(context.accumulatedUsage.inputTokens).toBe(15)
      expect(context.accumulatedUsage.outputTokens).toBe(30)
      expect(context.accumulatedUsage.totalTokens).toBe(45)
    })

    it('should handle missing usage gracefully', () => {
      const controller = createMockStreamController()

      const chunk: FinishStepChunk = {}
      const context = createMockContext({
        accumulatedUsage: {
          inputTokens: 5,
          outputTokens: 10,
          totalTokens: 15
        }
      })

      expect(() => manager.sendStepFinishEvent(controller, chunk, context)).not.toThrow()

      // Verify accumulation did not change
      expect(context.accumulatedUsage.inputTokens).toBe(5)
      expect(context.accumulatedUsage.outputTokens).toBe(10)
      expect(context.accumulatedUsage.totalTokens).toBe(15)
    })

    it('should use default finishReason of "stop" when not provided', () => {
      const controller = createMockStreamController()

      const chunk: FinishStepChunk = {}
      const context = createMockContext()

      manager.sendStepFinishEvent(controller, chunk, context)

      expect(controller.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          finishReason: 'stop'
        })
      )
    })
  })

  describe('handleRecursiveCall', () => {
    it('should reset hasExecutedToolsInCurrentStep flag', async () => {
      const controller = createMockStreamController()

      const mockStream = simulateReadableStream<TextStreamPart<EmptyToolSet>>({
        chunks: [
          {
            type: 'text-delta',
            id: 'test-id',
            text: 'test'
          } as TextStreamPart<EmptyToolSet>
        ],
        initialDelayInMs: 0,
        chunkDelayInMs: 0
      })

      const context = createMockContext({
        hasExecutedToolsInCurrentStep: true,
        recursiveCall: vi.fn().mockResolvedValue({
          fullStream: mockStream
        })
      })

      const params = { messages: [] }

      await manager.handleRecursiveCall(controller, params, context)

      expect(context.hasExecutedToolsInCurrentStep).toBe(false)
      expect(context.recursiveCall).toHaveBeenCalledWith(params)
    })

    it('should pipe recursive stream to controller', async () => {
      const enqueuedChunks: TextStreamPart<EmptyToolSet>[] = []
      const controller = createMockStreamController()
      controller.enqueue.mockImplementation((chunk: TextStreamPart<EmptyToolSet>) => {
        enqueuedChunks.push(chunk)
      })

      const mockChunks: TextStreamPart<EmptyToolSet>[] = [
        { type: 'start' as const },
        { type: 'start-step' as const, request: {}, warnings: [] },
        { type: 'text-delta' as const, id: 'chunk-1', text: 'recursive' },
        { type: 'text-delta' as const, id: 'chunk-2', text: ' response' },
        {
          type: 'finish-step' as const,
          finishReason: 'stop',
          rawFinishReason: 'stop',
          response: {
            id: 'test-response-id',
            timestamp: new Date(),
            modelId: 'test-model'
          },
          usage: {
            totalTokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            inputTokenDetails: {
              noCacheTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0
            },
            outputTokenDetails: {
              textTokens: 0,
              reasoningTokens: 0
            }
          },
          providerMetadata: undefined
        },
        {
          type: 'finish' as const,
          finishReason: 'stop',
          rawFinishReason: 'stop',
          totalUsage: {
            totalTokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            inputTokenDetails: {
              noCacheTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0
            },
            outputTokenDetails: {
              textTokens: 0,
              reasoningTokens: 0
            }
          }
        }
      ]

      const mockStream = simulateReadableStream<TextStreamPart<EmptyToolSet>>({
        chunks: mockChunks,
        initialDelayInMs: 0,
        chunkDelayInMs: 0
      })

      const context = createMockContext({
        hasExecutedToolsInCurrentStep: true,
        recursiveCall: vi.fn().mockResolvedValue({
          fullStream: mockStream
        })
      })

      await manager.handleRecursiveCall(controller, {}, context)

      // Should skip 'start' type and stop at 'finish' type
      expect(enqueuedChunks).toHaveLength(4)
      expect(enqueuedChunks[0]).toEqual({ type: 'start-step', request: {}, warnings: [] })
      expect(enqueuedChunks[1]).toEqual({ type: 'text-delta', id: 'chunk-1', text: 'recursive' })
      expect(enqueuedChunks[2]).toEqual({ type: 'text-delta', id: 'chunk-2', text: ' response' })
      expect(enqueuedChunks[3]).toMatchObject({
        type: 'finish-step',
        finishReason: 'stop',
        rawFinishReason: 'stop',
        providerMetadata: undefined,
        usage: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          inputTokenDetails: {
            noCacheTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0
          },
          outputTokenDetails: {
            textTokens: 0,
            reasoningTokens: 0
          }
        }
      })
    })

    it('should warn when no fullStream is found', async () => {
      const warnSpy = vi.spyOn(console, 'warn')
      const controller = createMockStreamController()

      const context = createMockContext({
        hasExecutedToolsInCurrentStep: true,
        recursiveCall: vi.fn().mockResolvedValue({
          // No fullStream property
          someOtherProperty: 'value'
        })
      })

      await manager.handleRecursiveCall(controller, {}, context)

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MCP Prompt] No fullstream found'),
        expect.any(Object)
      )

      warnSpy.mockRestore()
    })
  })
})
