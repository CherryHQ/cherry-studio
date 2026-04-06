import type { UIMessage, UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcChatTransport } from '../IpcChatTransport'

/** Type-safe mock for `window.api.ai` */
interface MockAiApi {
  streamText: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  onStreamChunk: ReturnType<typeof vi.fn>
  onStreamDone: ReturnType<typeof vi.fn>
  onStreamError: ReturnType<typeof vi.fn>
}

/**
 * Creates a mock `window.api.ai` that captures registered IPC callbacks.
 * Returns both the mock object and a way to emit events.
 */
function createMockAiApi() {
  const listeners = {
    chunk: [] as Array<(data: { requestId: string; chunk: UIMessageChunk }) => void>,
    done: [] as Array<(data: { requestId: string }) => void>,
    error: [] as Array<(data: { requestId: string; error: { message: string } }) => void>
  }

  const unsubFns = {
    chunk: [] as Array<() => void>,
    done: [] as Array<() => void>,
    error: [] as Array<() => void>
  }

  const mockApi: MockAiApi = {
    streamText: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    onStreamChunk: vi.fn((cb) => {
      listeners.chunk.push(cb)
      const unsub = () => {
        const idx = listeners.chunk.indexOf(cb)
        if (idx >= 0) listeners.chunk.splice(idx, 1)
      }
      unsubFns.chunk.push(unsub)
      return unsub
    }),
    onStreamDone: vi.fn((cb) => {
      listeners.done.push(cb)
      const unsub = () => {
        const idx = listeners.done.indexOf(cb)
        if (idx >= 0) listeners.done.splice(idx, 1)
      }
      unsubFns.done.push(unsub)
      return unsub
    }),
    onStreamError: vi.fn((cb) => {
      listeners.error.push(cb)
      const unsub = () => {
        const idx = listeners.error.indexOf(cb)
        if (idx >= 0) listeners.error.splice(idx, 1)
      }
      unsubFns.error.push(unsub)
      return unsub
    })
  }

  return {
    mockApi,
    listeners,
    /** Emit a chunk to all registered listeners */
    emitChunk: (requestId: string, chunk: UIMessageChunk) => {
      for (const cb of [...listeners.chunk]) cb({ requestId, chunk })
    },
    /** Emit done to all registered listeners */
    emitDone: (requestId: string) => {
      for (const cb of [...listeners.done]) cb({ requestId })
    },
    /** Emit error to all registered listeners */
    emitError: (requestId: string, message: string) => {
      for (const cb of [...listeners.error]) cb({ requestId, error: { message } })
    }
  }
}

// Capture requestId from streamText calls
function getRequestId(mockApi: MockAiApi): string {
  const call = mockApi.streamText.mock.calls[0]
  return (call[0] as { requestId: string }).requestId
}

describe('IpcChatTransport', () => {
  let transport: IpcChatTransport
  let mock: ReturnType<typeof createMockAiApi>
  let originalApi: unknown

  beforeEach(() => {
    mock = createMockAiApi()
    originalApi = (window as unknown as { api: unknown }).api
    ;(window as unknown as { api: { ai: MockAiApi } }).api = {
      ...(originalApi as object),
      ai: mock.mockApi
    } as { ai: MockAiApi }
    transport = new IpcChatTransport()
  })

  afterEach(() => {
    ;(window as unknown as { api: unknown }).api = originalApi
  })

  const baseOptions = {
    trigger: 'submit-message' as const,
    chatId: 'chat-1',
    messageId: undefined,
    messages: [] as UIMessage[],
    abortSignal: undefined
  }

  it('should return a ReadableStream and invoke streamText', async () => {
    const stream = await transport.sendMessages(baseOptions)
    expect(stream).toBeInstanceOf(ReadableStream)
    expect(mock.mockApi.streamText).toHaveBeenCalledOnce()
  })

  it('should stream chunks filtered by requestId', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()
    const requestId = getRequestId(mock.mockApi)

    // Emit chunk for a different requestId — should be ignored
    mock.emitChunk('other-request', { type: 'text-start', id: 'x' } as UIMessageChunk)

    // Emit chunks for our requestId
    mock.emitChunk(requestId, { type: 'text-start', id: 't1' } as UIMessageChunk)
    mock.emitChunk(requestId, { type: 'text-delta', id: 't1', delta: 'Hello' } as UIMessageChunk)
    mock.emitDone(requestId)

    const chunks: UIMessageChunk[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual({ type: 'text-start', id: 't1' })
    expect(chunks[1]).toEqual({ type: 'text-delta', id: 't1', delta: 'Hello' })
  })

  it('should close stream on done', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()
    const requestId = getRequestId(mock.mockApi)

    mock.emitChunk(requestId, { type: 'text-start', id: 't1' } as UIMessageChunk)
    mock.emitDone(requestId)

    const { done: firstDone } = await reader.read()
    expect(firstDone).toBe(false)

    const { done: secondDone } = await reader.read()
    expect(secondDone).toBe(true)
  })

  it('should error stream on error event', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()
    const requestId = getRequestId(mock.mockApi)

    mock.emitError(requestId, 'Something went wrong')

    await expect(reader.read()).rejects.toThrow('Something went wrong')
  })

  it('should abort stream and call window.api.ai.abort', async () => {
    const abortController = new AbortController()
    const stream = await transport.sendMessages({
      ...baseOptions,
      abortSignal: abortController.signal
    })
    const reader = stream.getReader()
    const requestId = getRequestId(mock.mockApi)

    // Emit one chunk, then abort
    mock.emitChunk(requestId, { type: 'text-start', id: 't1' } as UIMessageChunk)
    abortController.abort()

    const chunks: UIMessageChunk[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    expect(mock.mockApi.abort).toHaveBeenCalledWith(requestId)
    expect(chunks).toHaveLength(1) // Only the chunk before abort
  })

  it('should handle already-aborted signal', async () => {
    const abortController = new AbortController()
    abortController.abort()

    const stream = await transport.sendMessages({
      ...baseOptions,
      abortSignal: abortController.signal
    })
    const reader = stream.getReader()

    const { done } = await reader.read()
    expect(done).toBe(true)
    expect(mock.mockApi.abort).toHaveBeenCalled()
  })

  it('should clean up IPC listeners after done', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()
    const requestId = getRequestId(mock.mockApi)

    expect(mock.listeners.chunk).toHaveLength(1)
    expect(mock.listeners.done).toHaveLength(1)
    expect(mock.listeners.error).toHaveLength(1)

    mock.emitDone(requestId)
    await reader.read() // drain

    // Listeners should be removed after cleanup
    expect(mock.listeners.chunk).toHaveLength(0)
    expect(mock.listeners.done).toHaveLength(0)
    expect(mock.listeners.error).toHaveLength(0)
  })

  it('should pass body fields to streamText', async () => {
    await transport.sendMessages({
      ...baseOptions,
      body: { providerId: 'openai', modelId: 'gpt-4o' }
    })

    const call = mock.mockApi.streamText.mock.calls[0][0] as Record<string, unknown>
    expect(call.providerId).toBe('openai')
    expect(call.modelId).toBe('gpt-4o')
  })

  it('reconnectToStream should return null', async () => {
    const result = await transport.reconnectToStream({ chatId: 'chat-1' })
    expect(result).toBeNull()
  })
})
