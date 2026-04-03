import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { AiCompletionService, type AiStreamRequest } from '../AiCompletionService'

describe('AiCompletionService', () => {
  const createRequest = (overrides?: Partial<AiStreamRequest>): AiStreamRequest => ({
    requestId: 'test-req-1',
    chatId: 'test-chat-1',
    trigger: 'submit-message',
    messages: [],
    ...overrides
  })

  const collectStream = async (stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> => {
    const reader = stream.getReader()
    const chunks: UIMessageChunk[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    return chunks
  }

  it('should return a ReadableStream of UIMessageChunks', async () => {
    const service = new AiCompletionService()
    const request = createRequest()
    const abortController = new AbortController()

    const stream = service.streamText(request, abortController.signal)
    expect(stream).toBeInstanceOf(ReadableStream)

    const chunks = await collectStream(stream)

    // text-start + 8 text-delta + text-end = 10 chunks
    expect(chunks.length).toBe(10)
    expect(chunks[0]).toEqual({ type: 'text-start', id: 'mock-part-0' })
    expect(chunks[1]).toEqual({ type: 'text-delta', delta: 'Hello', id: 'mock-part-0' })
    expect(chunks[chunks.length - 1]).toEqual({ type: 'text-end', id: 'mock-part-0' })
  })

  it('should close stream on abort', async () => {
    const service = new AiCompletionService()
    const request = createRequest()
    const abortController = new AbortController()

    const stream = service.streamText(request, abortController.signal)
    const reader = stream.getReader()
    const chunks: UIMessageChunk[] = []

    // Read first two chunks (text-start + first text-delta), then abort
    const first = await reader.read()
    if (!first.done) chunks.push(first.value)
    const second = await reader.read()
    if (!second.done) chunks.push(second.value)
    abortController.abort()

    // Drain remaining — stream should close shortly after abort
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    // Should have fewer chunks than a full stream (10)
    expect(chunks.length).toBeLessThan(10)
  })

  it('should manage active requests', () => {
    const service = new AiCompletionService()
    const controller = new AbortController()

    service.registerRequest('req-1', controller)
    service.abort('req-1')

    expect(controller.signal.aborted).toBe(true)
  })

  it('should handle abort for non-existent request gracefully', () => {
    const service = new AiCompletionService()
    service.abort('non-existent')
  })

  it('should remove request after completion', () => {
    const service = new AiCompletionService()
    const controller = new AbortController()

    service.registerRequest('req-1', controller)
    service.removeRequest('req-1')
    service.abort('req-1')
    expect(controller.signal.aborted).toBe(false)
  })
})
