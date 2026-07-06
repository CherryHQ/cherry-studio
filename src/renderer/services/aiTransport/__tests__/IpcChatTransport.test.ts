import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcChatTransport } from '../IpcChatTransport'

// Production calls ipcApi.request('ai.stream_*') / ipcApi.on('ai.stream_*'). `ipcMock` is
// re-pointed at a fresh createMockAiApi()'s dispatchers in beforeEach (hoisted so the
// vi.mock factory can capture it).
const { ipcMock } = vi.hoisted(() => ({
  ipcMock: {
    request: (() => undefined) as (route: string, input: unknown) => unknown,
    on: (() => () => {}) as (event: string, cb: (p: unknown) => void) => () => void
  }
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (route: string, input: unknown) => ipcMock.request(route, input),
    on: (event: string, cb: (p: unknown) => void) => ipcMock.on(event, cb)
  }
}))

// ── Mock the AI stream IPC ──────────────────────────────────────────

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

  // ipcApi-shaped dispatchers wired to the spies above (so per-method assertions still work).
  const request = (route: string, input: unknown): unknown => {
    switch (route) {
      case 'ai.stream_open':
        return mockApi.streamOpen(input)
      case 'ai.stream_attach':
        return mockApi.streamAttach(input)
      case 'ai.stream_abort':
        return mockApi.streamAbort(input)
      default:
        return Promise.resolve(undefined) // ai.stream_detach — not asserted here
    }
  }
  const on = (event: string, cb: (p: unknown) => void): (() => void) => {
    switch (event) {
      case 'ai.stream_chunk':
        return mockApi.onStreamChunk(cb)
      case 'ai.stream_done':
        return mockApi.onStreamDone(cb)
      case 'ai.stream_error':
        return mockApi.onStreamError(cb)
      default:
        return () => {}
    }
  }

  return {
    mockApi,
    listeners,
    request,
    on,
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
  let originalToast: unknown

  beforeEach(() => {
    mock = createMockAiApi()
    ipcMock.request = mock.request
    ipcMock.on = mock.on
    originalToast = (window as unknown as { toast: unknown }).toast
    ;(window as unknown as { toast: unknown }).toast = { error: vi.fn() }
    transport = new IpcChatTransport()
  })

  afterEach(() => {
    ;(window as unknown as { toast: unknown }).toast = originalToast
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

  it('shows workspace dispatch failures as toast and closes the stream', async () => {
    mock.mockApi.streamOpen.mockResolvedValue({
      mode: 'blocked',
      reason: 'agent-session-workspace',
      message: 'Workspace path for session session-1 is not accessible: /missing'
    })

    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ done: true })
    expect(window.toast.error).toHaveBeenCalledWith('Workspace path for session session-1 is not accessible: /missing')
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

  it('reconnectToStream returns closed stream when done', async () => {
    mock.mockApi.streamAttach.mockResolvedValue({ status: 'done', finalMessage: {} })

    const stream = await transport.reconnectToStream({ chatId: topicId })
    expect(stream).toBeInstanceOf(ReadableStream)

    const reader = stream!.getReader()
    const { done } = await reader.read()
    expect(done).toBe(true)
  })
})
