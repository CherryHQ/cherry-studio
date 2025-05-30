import { WebSearchSource } from '@renderer/types'
import { ChunkType, ChunkType as CoreChunkType } from '@renderer/types/chunk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseApiClient } from '../../../AiProvider/clients'
import { GenericChunk } from '../../schemas'
import { CompletionsContext, MIDDLEWARE_CONTEXT_SYMBOL } from '../../type'
import { TextChunkMiddleware } from '../TextChunkMiddleware'

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

describe('TextChunkMiddleware', () => {
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
          },
          enableWebSearch: false
        }
      } as any,
      onChunkCallback: mockOnChunk,
      _internal: {}
    }

    mockNext = vi.fn().mockResolvedValue(undefined)
  })

  it('should accumulate TEXT_DELTA chunks', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: 'Hello '
        })
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: 'world!'
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

    await TextChunkMiddleware(mockContext, mockNext)

    // Now we need to consume the transformed stream
    await consumeStream(mockContext, mockOnChunk)

    // Should have TEXT_DELTA chunks and a TEXT_COMPLETE chunk
    const textDeltas = chunksEmitted.filter((chunk) => chunk.type === CoreChunkType.TEXT_DELTA)
    const textComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.TEXT_COMPLETE)

    expect(textDeltas).toHaveLength(2)
    expect(textDeltas[0].text).toBe('Hello ')
    expect(textDeltas[1].text).toBe('world!')
    expect(textComplete).toBeDefined()
    expect(textComplete.text).toBe('Hello world!')
  })

  it('should handle LLM_RESPONSE_COMPLETE signal', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: 'Test content'
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

    await TextChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const textComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.TEXT_COMPLETE)
    expect(textComplete).toBeDefined()
    expect(textComplete.text).toBe('Test content')
  })

  it('should convert links when web search results are available', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        // First send the web search results
        controller.enqueue({
          type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
          llm_web_search: {
            results: [
              {
                url: 'https://example.com',
                title: 'Example Site',
                id: 1
              }
            ],
            source: WebSearchSource.WEBSEARCH
          }
        })
        // Then send the text with links
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: 'Check this link: [example](1)'
        })
        controller.enqueue({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: { usage: { total_tokens: 5, completion_tokens: 5, prompt_tokens: 0 } }
        })
        controller.close()
      }
    })

    // Enable web search for this test
    mockContext.originalParams.assistant.enableWebSearch = true

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await TextChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const textComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.TEXT_COMPLETE)
    expect(textComplete).toBeDefined()
    expect(textComplete.text).toBe('Check this link: [example](https://example.com)')
  })

  it('should skip processing if no generic chunk stream', async () => {
    mockContext._internal.apiCall = {}

    await TextChunkMiddleware(mockContext, mockNext)

    expect(mockNext).toHaveBeenCalledOnce()
    expect(chunksEmitted).toHaveLength(0)
  })

  it('should handle empty text accumulation', async () => {
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

    await TextChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const textComplete = chunksEmitted.find((chunk) => chunk.type === CoreChunkType.TEXT_COMPLETE)
    expect(textComplete).toBeDefined()
    expect(textComplete.text).toBe('')
  })

  it('should preserve other chunk types', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.THINKING_DELTA,
          text: 'thinking...'
        })
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: 'response'
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

    await TextChunkMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const thinkingDeltas = chunksEmitted.filter((chunk) => chunk.type === CoreChunkType.THINKING_DELTA)
    const textDeltas = chunksEmitted.filter((chunk) => chunk.type === CoreChunkType.TEXT_DELTA)

    expect(thinkingDeltas).toHaveLength(1)
    expect(textDeltas).toHaveLength(1)
  })

  it('should handle stream errors gracefully', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: 'Hello'
        })
        controller.error(new Error('Stream error'))
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await TextChunkMiddleware(mockContext, mockNext)

    // The stream error should be thrown when we try to consume it
    await expect(consumeStream(mockContext, mockOnChunk)).rejects.toThrow('Stream error')
  })

  it('should log middleware activity', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: 'Test'
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

    await TextChunkMiddleware(mockContext, mockNext)

    expect(mockConsole.log).toHaveBeenCalledWith(expect.stringContaining('[TextChunkMiddleware]'))
  })
})
