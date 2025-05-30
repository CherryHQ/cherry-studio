import { ChunkType, ChunkType as CoreChunkType } from '@renderer/types/chunk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseApiClient } from '../../../AiProvider/clients'
import { GenericChunk } from '../../schemas'
import { CompletionsContext, MIDDLEWARE_CONTEXT_SYMBOL } from '../../type'
import { ThinkChunkMiddleware } from '../ThinkChunkMiddleware'

// Mock console methods
const mockConsole = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}

vi.stubGlobal('console', mockConsole)

// Helper function to consume the transformed stream
async function consumeStream(context: CompletionsContext, onChunk: any) {
  const transformedStream = context._internal.apiCall?.genericChunkStream
  if (!transformedStream) return

  const reader = transformedStream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onChunk(value)
    }
  } finally {
    reader.releaseLock()
  }
}

describe('ThinkChunkMiddleware', () => {
  let mockContext: CompletionsContext
  let mockApiClient: BaseApiClient
  let mockNext: () => Promise<void>
  let mockOnChunk: ReturnType<typeof vi.fn>
  let chunksEmitted: any[]

  beforeEach(() => {
    vi.clearAllMocks()
    chunksEmitted = []

    mockApiClient = {
      provider: { id: 'test-provider' }
    } as BaseApiClient

    mockOnChunk = vi.fn((chunk) => {
      chunksEmitted.push(chunk)
    })

    mockContext = {
      [MIDDLEWARE_CONTEXT_SYMBOL]: true,
      methodName: 'completions',
      apiClientInstance: mockApiClient,
      originalParams: {
        messages: [],
        streamOutput: true,
        assistant: {
          id: 'test-assistant',
          model: {
            id: 'test-model',
            provider: 'openai'
          }
        },
        _internal: {
          enableReasoning: true
        }
      } as any,
      onChunkCallback: mockOnChunk,
      _internal: {}
    }

    mockNext = vi.fn().mockResolvedValue(undefined)
  })

  it('should accumulate THINKING_DELTA chunks', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.THINKING_DELTA,
          text: 'Let me think... '
        })
        controller.enqueue({
          type: ChunkType.THINKING_DELTA,
          text: 'about this problem.'
        })
        controller.enqueue({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: { usage: { total_tokens: 10, completion_tokens: 10, prompt_tokens: 0 } }
        })
        controller.close()
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await ThinkChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const thinkingDeltas = chunksEmitted.filter((chunk) => chunk.type === CoreChunkType.THINKING_DELTA)
    const thinkingComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.THINKING_COMPLETE)

    expect(thinkingDeltas).toHaveLength(2)
    expect(thinkingDeltas[0].text).toBe('Let me think... ')
    expect(thinkingDeltas[1].text).toBe('about this problem.')
    expect(thinkingComplete).toBeDefined()
    expect(thinkingComplete.text).toBe('Let me think... about this problem.')
  })

  it('should extract thinking text from TEXT_DELTA with think tags', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: '<think>This is thinking text</think>Regular text'
        })
        controller.enqueue({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: { usage: { total_tokens: 5, completion_tokens: 5, prompt_tokens: 0 } }
        })
        controller.close()
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await ThinkChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const thinkingDeltas = chunksEmitted.filter((chunk) => chunk.type === CoreChunkType.THINKING_DELTA)
    const thinkingComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.THINKING_COMPLETE)

    expect(thinkingDeltas).toHaveLength(1)
    expect(thinkingDeltas[0].text).toBe('This is thinking text')
    expect(thinkingComplete).toBeDefined()
    expect(thinkingComplete.text).toBe('This is thinking text')
  })

  it('should handle multiple think tags in single chunk', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: '<think>First thought</think>Text<think>Second thought</think>'
        })
        controller.enqueue({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: { usage: { total_tokens: 5, completion_tokens: 5, prompt_tokens: 0 } }
        })
        controller.close()
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await ThinkChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const thinkingComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.THINKING_COMPLETE)
    expect(thinkingComplete).toBeDefined()
    expect(thinkingComplete.text).toBe('First thought\nSecond thought')
  })

  it('should handle partial think tags across chunks', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: '<think>Partial think'
        })
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: ' text</think>Regular text'
        })
        controller.enqueue({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: { usage: { total_tokens: 5, completion_tokens: 5, prompt_tokens: 0 } }
        })
        controller.close()
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await ThinkChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const thinkingComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.THINKING_COMPLETE)
    expect(thinkingComplete).toBeDefined()
    expect(thinkingComplete.text).toBe('Partial think text')
  })

  it('should calculate thinking timing correctly', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.THINKING_DELTA,
          text: 'thinking...'
        })
        controller.enqueue({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: { usage: { total_tokens: 5, completion_tokens: 5, prompt_tokens: 0 } }
        })
        controller.close()
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await ThinkChunkMiddleware(mockContext, mockNext)
    // Add a small delay to ensure timing calculation
    await new Promise((resolve) => setTimeout(resolve, 50))
    await consumeStream(mockContext, mockOnChunk)

    const thinkingComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.THINKING_COMPLETE)
    expect(thinkingComplete).toBeDefined()
    expect(thinkingComplete.thinking_ms).toBeGreaterThan(0)
    expect(thinkingComplete.thinking_ms).toBeLessThan(200) // reasonable upper bound
  })

  it('should skip processing if no generic chunk stream', async () => {
    mockContext._internal.apiCall = {}

    await ThinkChunkMiddleware(mockContext, mockNext)

    expect(mockNext).toHaveBeenCalledOnce()
    expect(chunksEmitted).toHaveLength(0)
  })

  it('should handle empty thinking accumulation', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: { usage: { total_tokens: 0, completion_tokens: 0, prompt_tokens: 0 } }
        })
        controller.close()
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await ThinkChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const thinkingComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.THINKING_COMPLETE)
    expect(thinkingComplete).toBeDefined()
    expect(thinkingComplete.text).toBe('')
    expect(thinkingComplete.thinking_ms).toBe(0)
  })

  it('should preserve other chunk types', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: 'regular text'
        })
        controller.enqueue({
          type: ChunkType.THINKING_DELTA,
          text: 'thinking text'
        })
        controller.enqueue({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: { usage: { total_tokens: 5, completion_tokens: 5, prompt_tokens: 0 } }
        })
        controller.close()
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await ThinkChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const textDeltas = chunksEmitted.filter((chunk) => chunk.type === CoreChunkType.TEXT_DELTA)
    const thinkingDeltas = chunksEmitted.filter((chunk) => chunk.type === CoreChunkType.THINKING_DELTA)

    expect(textDeltas).toHaveLength(1)
    expect(thinkingDeltas).toHaveLength(1)
  })

  it('should handle different think tag formats', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: '<thinking>Alternative format</thinking>Text'
        })
        controller.enqueue({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: { usage: { total_tokens: 5, completion_tokens: 5, prompt_tokens: 0 } }
        })
        controller.close()
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await ThinkChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const thinkingComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.THINKING_COMPLETE)
    expect(thinkingComplete).toBeDefined()
    expect(thinkingComplete.text).toBe('Alternative format')
  })

  it('should handle stream errors gracefully', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.THINKING_DELTA,
          text: 'thinking...'
        })
        controller.error(new Error('Stream error'))
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await ThinkChunkMiddleware(mockContext, mockNext)

    await expect(consumeStream(mockContext, mockOnChunk)).rejects.toThrow('Stream error')
  })

  it('should log middleware activity', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.THINKING_DELTA,
          text: 'Test thinking'
        })
        controller.enqueue({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: { usage: { total_tokens: 1, completion_tokens: 1, prompt_tokens: 0 } }
        })
        controller.close()
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await ThinkChunkMiddleware(mockContext, mockNext)

    expect(mockConsole.log).toHaveBeenCalledWith(expect.stringContaining('[ThinkChunkMiddleware]'))
  })
})
