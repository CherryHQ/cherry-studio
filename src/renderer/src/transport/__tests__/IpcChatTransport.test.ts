import type { StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExecutionTransport, IpcChatTransport } from '../IpcChatTransport'

// ── Mock window.api.ai ──────────────────────────────────────────────

interface MockAiApi {
  streamOpen: ReturnType<typeof vi.fn>
  streamAttach: ReturnType<typeof vi.fn>
  streamAbort: ReturnType<typeof vi.fn>
  onStreamChunk: ReturnType<typeof vi.fn>
  onStreamDone: ReturnType<typeof vi.fn>
  onStreamError: ReturnType<typeof vi.fn>
}

function createMockAiApi() {
  const listeners = {
    chunk: [] as Array<(data: { topicId: string; executionId?: UniqueModelId; chunk: UIMessageChunk }) => void>,
    done: [] as Array<
      (data: { topicId: string; executionId?: UniqueModelId; isTopicDone?: boolean; status?: string }) => void
    >,
    error: [] as Array<
      (data: { topicId: string; executionId?: UniqueModelId; isTopicDone?: boolean; error: SerializedError }) => void
    >
  }

  const mockApi: MockAiApi = {
    streamOpen: vi.fn().mockResolvedValue({ mode: 'started' }),
    streamAttach: vi.fn().mockResolvedValue({ status: 'not-found' }),
    streamAbort: vi.fn().mockResolvedValue(undefined),
    onStreamChunk: vi.fn((cb) => {
      listeners.chunk.push(cb)
      return () => {
        const i = listeners.chunk.indexOf(cb)
        if (i >= 0) listeners.chunk.splice(i, 1)
      }
    }),
    onStreamDone: vi.fn((cb) => {
      listeners.done.push(cb)
      return () => {
        const i = listeners.done.indexOf(cb)
        if (i >= 0) listeners.done.splice(i, 1)
      }
    }),
    onStreamError: vi.fn((cb) => {
      listeners.error.push(cb)
      return () => {
        const i = listeners.error.indexOf(cb)
        if (i >= 0) listeners.error.splice(i, 1)
      }
    })
  }

  return {
    mockApi,
    listeners,
    emitChunk: (topicId: string, chunk: UIMessageChunk, executionId?: UniqueModelId) => {
      for (const cb of [...listeners.chunk]) cb({ topicId, executionId, chunk })
    },
    emitDone: (topicId: string, executionId?: UniqueModelId, isTopicDone?: boolean) => {
      for (const cb of [...listeners.done]) cb({ topicId, executionId, isTopicDone, status: 'success' })
    },
    emitError: (topicId: string, message: string, executionId?: UniqueModelId, isTopicDone?: boolean) => {
      for (const cb of [...listeners.error]) {
        cb({ topicId, executionId, isTopicDone, error: { name: 'Error', message, stack: null } })
      }
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────

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

  const topicId = 'topic-1'
  const baseOptions = {
    trigger: 'submit-message' as const,
    chatId: topicId,
    messageId: undefined,
    messages: [] as CherryUIMessage[],
    abortSignal: undefined
  }

  it('returns a ReadableStream and calls streamOpen', async () => {
    const stream = await transport.sendMessages(baseOptions)
    expect(stream).toBeInstanceOf(ReadableStream)
    expect(mock.mockApi.streamOpen).toHaveBeenCalledOnce()
    expect(mock.mockApi.streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId,
        trigger: 'submit-message'
      })
    )
  })

  it('filters chunks by topicId', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    // Chunk for different topic — ignored
    mock.emitChunk('other-topic', { type: 'text-start', id: 'x' } as UIMessageChunk)

    // Chunks for our topic
    mock.emitChunk(topicId, { type: 'text-start', id: 't1' } as UIMessageChunk)
    mock.emitChunk(topicId, { type: 'text-delta', id: 't1', delta: 'Hello' } as UIMessageChunk)
    mock.emitDone(topicId)

    const chunks: UIMessageChunk[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    expect(chunks).toHaveLength(2)
  })

  it('closes stream on done', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    mock.emitChunk(topicId, { type: 'text-start', id: 't1' } as UIMessageChunk)
    mock.emitDone(topicId)

    const { done: firstDone } = await reader.read()
    expect(firstDone).toBe(false)

    const { done: secondDone } = await reader.read()
    expect(secondDone).toBe(true)
  })

  it('primary stream ignores execution-scoped chunks', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    mock.emitChunk(topicId, { type: 'text-start', id: 'exec' } as UIMessageChunk, 'provider-a::model-a')
    mock.emitDone(topicId, undefined, true)

    const { done } = await reader.read()
    expect(done).toBe(true)
  })

  it('errors stream on error event', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    mock.emitError(topicId, 'Something went wrong')

    await expect(reader.read()).rejects.toThrow('Something went wrong')
  })

  it('calls streamAbort on abort signal', async () => {
    const abortController = new AbortController()
    const stream = await transport.sendMessages({
      ...baseOptions,
      abortSignal: abortController.signal
    })
    const reader = stream.getReader()

    mock.emitChunk(topicId, { type: 'text-start', id: 't1' } as UIMessageChunk)
    abortController.abort()

    const chunks: UIMessageChunk[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    expect(mock.mockApi.streamAbort).toHaveBeenCalledWith({ topicId })
    expect(chunks).toHaveLength(1)
  })

  it('handles already-aborted signal', async () => {
    const abortController = new AbortController()
    abortController.abort()

    const stream = await transport.sendMessages({
      ...baseOptions,
      abortSignal: abortController.signal
    })
    const reader = stream.getReader()

    const { done } = await reader.read()
    expect(done).toBe(true)
    expect(mock.mockApi.streamAbort).toHaveBeenCalledWith({ topicId })
  })

  it('cleans up IPC listeners after done', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    expect(mock.listeners.chunk).toHaveLength(1)
    expect(mock.listeners.done).toHaveLength(1)
    expect(mock.listeners.error).toHaveLength(1)

    mock.emitDone(topicId)
    await reader.read()

    expect(mock.listeners.chunk).toHaveLength(0)
    expect(mock.listeners.done).toHaveLength(0)
    expect(mock.listeners.error).toHaveLength(0)
  })

  it('reconnectToStream returns null when not found', async () => {
    const result = await transport.reconnectToStream({ chatId: topicId })
    expect(result).toBeNull()
    expect(mock.mockApi.streamAttach).toHaveBeenCalledWith({ topicId })
  })

  it('reconnectToStream returns stream when attached', async () => {
    mock.mockApi.streamAttach.mockResolvedValue({ status: 'attached', bufferedChunks: [] })

    const stream = await transport.reconnectToStream({ chatId: topicId })
    expect(stream).toBeInstanceOf(ReadableStream)
  })

  it('execution reconnect replays only matching buffered chunks', async () => {
    mock.mockApi.streamAttach.mockResolvedValue({
      status: 'attached',
      bufferedChunks: [
        {
          topicId,
          executionId: 'provider-b::model-b',
          chunk: { type: 'text-start', id: 'ignored' } as UIMessageChunk
        },
        {
          topicId,
          executionId: 'provider-a::model-a',
          chunk: { type: 'text-start', id: 'accepted' } as UIMessageChunk
        }
      ] satisfies StreamChunkPayload[]
    })

    const executionTransport = new ExecutionTransport(topicId, 'provider-a::model-a')
    const stream = await executionTransport.reconnectToStream()
    const reader = stream!.getReader()

    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(first.value).toEqual({ type: 'text-start', id: 'accepted' })
  })

  it('reconnectToStream returns closed stream when done', async () => {
    mock.mockApi.streamAttach.mockResolvedValue({ status: 'done', finalMessage: {} })

    const stream = await transport.reconnectToStream({ chatId: topicId })
    expect(stream).toBeInstanceOf(ReadableStream)

    const reader = stream!.getReader()
    const { done } = await reader.read()
    expect(done).toBe(true)
  })

  it('execution transport only receives matching execution chunks', async () => {
    const executionTransport = new ExecutionTransport(topicId, 'provider-a::model-a')
    const stream = await executionTransport.sendMessages()
    const reader = stream.getReader()

    mock.emitChunk(topicId, { type: 'text-start', id: 'ignored' } as UIMessageChunk, 'provider-b::model-b')
    mock.emitChunk(topicId, { type: 'text-start', id: 'accepted' } as UIMessageChunk, 'provider-a::model-a')
    mock.emitDone(topicId, 'provider-b::model-b')
    mock.emitDone(topicId, 'provider-a::model-a')

    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(first.value).toEqual({ type: 'text-start', id: 'accepted' })

    const second = await reader.read()
    expect(second.done).toBe(true)
  })
})
