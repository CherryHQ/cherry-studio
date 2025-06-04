import { WebSearchSource } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseApiClient } from '../../../AiProvider/clients'
import { GenericChunk } from '../../schemas'
import { CompletionsContext, MIDDLEWARE_CONTEXT_SYMBOL } from '../../types'
import { WebSearchMiddleware } from '../WebSearchMiddleware'

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

describe('WebSearchMiddleware', () => {
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
        streamOutput: true
      } as any,
      onChunkCallback: mockOnChunk,
      _internal: {}
    }

    mockNext = vi.fn().mockResolvedValue(undefined)
  })

  it('should track web search events', async () => {
    const mockWebSearchResults = [
      { url: 'https://example.com', title: 'Example Site', text: 'Example text' },
      { url: 'https://test.com', title: 'Test Site', text: 'Test text' }
    ]

    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
          llm_web_search: {
            results: mockWebSearchResults,
            source: WebSearchSource.WEBSEARCH
          }
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

    await WebSearchMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    // WebSearchMiddleware doesn't modify context state anymore, just logs
    const webSearchChunks = chunksEmitted.filter((chunk) => chunk.type === ChunkType.LLM_WEB_SEARCH_COMPLETE)
    expect(webSearchChunks).toHaveLength(1)
    expect(webSearchChunks[0].llm_web_search.results).toEqual(mockWebSearchResults)
  })

  it('should initialize web search state when not present', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
          llm_web_search: {
            results: [],
            source: WebSearchSource.WEBSEARCH
          }
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

    await WebSearchMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    // WebSearchMiddleware doesn't modify context state
    const webSearchChunks = chunksEmitted.filter((chunk) => chunk.type === ChunkType.LLM_WEB_SEARCH_COMPLETE)
    expect(webSearchChunks).toHaveLength(1)
  })

  it('should preserve existing web search state', async () => {
    const newResults = [{ url: 'https://new.com', title: 'New', text: 'New text' }]

    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
          llm_web_search: {
            results: newResults,
            source: WebSearchSource.WEBSEARCH
          }
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

    await WebSearchMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    // WebSearchMiddleware just passes through chunks
    const webSearchChunks = chunksEmitted.filter((chunk) => chunk.type === ChunkType.LLM_WEB_SEARCH_COMPLETE)
    expect(webSearchChunks).toHaveLength(1)
    expect(webSearchChunks[0].llm_web_search.results).toEqual(newResults)
  })

  it('should preserve other chunk types', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.TEXT_DELTA,
          text: 'regular text'
        })
        controller.enqueue({
          type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
          llm_web_search: {
            results: [],
            source: WebSearchSource.WEBSEARCH
          }
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

    await WebSearchMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const textDeltas = chunksEmitted.filter((chunk) => chunk.type === ChunkType.TEXT_DELTA)
    const thinkingDeltas = chunksEmitted.filter((chunk) => chunk.type === ChunkType.THINKING_DELTA)
    const webSearchChunks = chunksEmitted.filter((chunk) => chunk.type === ChunkType.LLM_WEB_SEARCH_COMPLETE)

    expect(textDeltas).toHaveLength(1)
    expect(thinkingDeltas).toHaveLength(1)
    expect(webSearchChunks).toHaveLength(1)
  })

  it('should skip processing if no generic chunk stream', async () => {
    mockContext._internal.apiCall = {}

    await WebSearchMiddleware(mockContext, mockNext)

    expect(mockNext).toHaveBeenCalledOnce()
    expect(chunksEmitted).toHaveLength(0)
  })

  it('should handle multiple web search result chunks', async () => {
    const firstResults = [{ url: 'https://first.com', title: 'First', text: 'First text' }]
    const secondResults = [{ url: 'https://second.com', title: 'Second', text: 'Second text' }]

    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
          llm_web_search: {
            results: firstResults,
            source: WebSearchSource.WEBSEARCH
          }
        })
        controller.enqueue({
          type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
          llm_web_search: {
            results: secondResults,
            source: WebSearchSource.WEBSEARCH
          }
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

    await WebSearchMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const webSearchChunks = chunksEmitted.filter((chunk) => chunk.type === ChunkType.LLM_WEB_SEARCH_COMPLETE)
    expect(webSearchChunks).toHaveLength(2)
  })

  it('should handle empty search results', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
          llm_web_search: {
            results: [],
            source: WebSearchSource.WEBSEARCH
          }
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

    await WebSearchMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    const webSearchChunks = chunksEmitted.filter((chunk) => chunk.type === ChunkType.LLM_WEB_SEARCH_COMPLETE)
    expect(webSearchChunks).toHaveLength(1)
    expect(webSearchChunks[0].llm_web_search.results).toEqual([])
  })

  it('should handle stream errors gracefully', async () => {
    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
          llm_web_search: {
            results: [],
            source: WebSearchSource.WEBSEARCH
          }
        })
        controller.error(new Error('Stream error'))
      }
    })

    mockContext._internal.apiCall = {
      genericChunkStream: mockStream
    }

    await WebSearchMiddleware(mockContext, mockNext)

    await expect(consumeStream(mockContext, mockOnChunk)).rejects.toThrow('Stream error')
  })

  it('should log web search events', async () => {
    const mockResults = [{ url: 'https://example.com', title: 'Example', text: 'Content' }]

    const mockStream = new ReadableStream<GenericChunk>({
      start(controller) {
        controller.enqueue({
          type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
          llm_web_search: {
            results: mockResults,
            source: WebSearchSource.WEBSEARCH
          }
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

    await WebSearchMiddleware(mockContext, mockNext)
    await consumeStream(mockContext, mockOnChunk)

    expect(mockConsole.log).toHaveBeenCalledWith(
      expect.stringContaining('[WebSearchMiddleware] Web search results received (#1):'),
      expect.objectContaining({
        source: WebSearchSource.WEBSEARCH,
        resultsCount: 1
      })
    )
  })
})
