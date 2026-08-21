import {
  ConversationAttachStatus,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger,
  type ConversationRef,
  ConversationStreamTerminalStatus,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { StreamDonePayload, StreamErrorPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  streamDetach: ReturnType<typeof vi.fn>
  onStreamDone: ReturnType<typeof vi.fn>
  onStreamError: ReturnType<typeof vi.fn>
}

function createMockAiApi() {
  const listeners = {
    done: [] as Array<(data: StreamDonePayload) => void>,
    error: [] as Array<(data: StreamErrorPayload) => void>
  }

  const mockApi: MockAiApi = {
    streamOpen: vi.fn().mockResolvedValue({ mode: ConversationOpenMode.Started }),
    streamAttach: vi.fn().mockResolvedValue({ status: ConversationAttachStatus.NotFound }),
    streamAbort: vi.fn().mockResolvedValue(undefined),
    streamDetach: vi.fn().mockResolvedValue(undefined),
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
      case 'ai.stream.open':
        return mockApi.streamOpen(input)
      case 'ai.stream.attach':
        return mockApi.streamAttach(input)
      case 'ai.stream.abort':
        return mockApi.streamAbort(input)
      case 'ai.stream.detach':
        return mockApi.streamDetach(input)
      default:
        return Promise.resolve(undefined)
    }
  }
  const on = (event: string, cb: (p: unknown) => void): (() => void) => {
    switch (event) {
      case 'ai.stream.done':
        return mockApi.onStreamDone(cb)
      case 'ai.stream.error':
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
    emitDone: (conversation: ConversationRef, turnTerminal = true) => {
      for (const cb of [...listeners.done])
        cb({
          conversation,
          turnId: toConversationTurnId('turn-1'),
          executionId: toConversationExecutionId('execution-1'),
          modelId: 'provider::model' as UniqueModelId,
          outputNodeId: 'assistant-1',
          status: ConversationStreamTerminalStatus.Done,
          turnTerminal
        })
    },
    emitError: (conversation: ConversationRef, message: string, turnTerminal = true) => {
      for (const cb of [...listeners.error]) {
        cb({
          conversation,
          turnId: toConversationTurnId('turn-1'),
          executionId: toConversationExecutionId('execution-1'),
          modelId: 'provider::model' as UniqueModelId,
          outputNodeId: 'assistant-1',
          turnTerminal,
          error: { name: 'Error', message, stack: null }
        })
      }
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('IpcChatTransport', () => {
  let transport: IpcChatTransport
  let mock: ReturnType<typeof createMockAiApi>

  beforeEach(() => {
    mock = createMockAiApi()
    ipcMock.request = mock.request
    ipcMock.on = mock.on
    transport = new IpcChatTransport()
  })

  const topicId = 'topic-1'
  const conversation = { kind: ConversationKind.Chat, id: topicId } as const
  const baseOptions = {
    trigger: ConversationOpenTrigger.SubmitMessage,
    chatId: topicId,
    messageId: undefined,
    messages: [] as CherryUIMessage[],
    abortSignal: undefined
  }

  it('opens a ReadableStream and detaches it on consumer cancellation', async () => {
    const stream = await transport.sendMessages(baseOptions)
    expect(stream).toBeInstanceOf(ReadableStream)
    expect(mock.mockApi.streamOpen).toHaveBeenCalledOnce()
    expect(mock.mockApi.streamOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation,
        trigger: ConversationOpenTrigger.SubmitMessage
      })
    )

    await stream.cancel()

    expect(mock.mockApi.streamDetach).toHaveBeenCalledWith({ conversation })
    expect(mock.listeners.done).toHaveLength(0)
    expect(mock.listeners.error).toHaveLength(0)
  })

  it('filters terminal events by exact Conversation identity', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    mock.emitError({ kind: ConversationKind.Chat, id: 'other-topic' }, 'wrong conversation')
    mock.emitDone(conversation)

    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('closes stream on done', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    mock.emitDone(conversation)

    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('errors stream on error event', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    mock.emitError(conversation, 'Something went wrong')

    await expect(reader.read()).rejects.toThrow('Something went wrong')
  })

  it('closes the stream when dispatch is blocked', async () => {
    mock.mockApi.streamOpen.mockResolvedValue({
      mode: ConversationOpenMode.Blocked,
      reason: 'agent-session-workspace',
      message: 'Workspace path for session session-1 is not accessible: /missing'
    })

    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('calls streamAbort on abort signal', async () => {
    const abortController = new AbortController()
    const stream = await transport.sendMessages({
      ...baseOptions,
      abortSignal: abortController.signal
    })
    const reader = stream.getReader()

    abortController.abort()

    const chunks: UIMessageChunk[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    expect(mock.mockApi.streamAbort).toHaveBeenCalledWith({ conversation })
    expect(chunks).toHaveLength(0)
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
    expect(mock.mockApi.streamAbort).toHaveBeenCalledWith({ conversation })
  })

  it('cleans up IPC listeners after done', async () => {
    const stream = await transport.sendMessages(baseOptions)
    const reader = stream.getReader()

    expect(mock.listeners.done).toHaveLength(1)
    expect(mock.listeners.error).toHaveLength(1)

    mock.emitDone(conversation)
    await reader.read()

    expect(mock.listeners.done).toHaveLength(0)
    expect(mock.listeners.error).toHaveLength(0)
  })

  it('reconnectToStream returns null when not found', async () => {
    const result = await transport.reconnectToStream({ chatId: topicId })
    expect(result).toBeNull()
    expect(mock.mockApi.streamAttach).toHaveBeenCalledWith({ conversation })
  })

  it('reconnectToStream returns stream when attached', async () => {
    mock.mockApi.streamAttach.mockResolvedValue({
      status: ConversationAttachStatus.Live,
      turnId: 'turn-1',
      executions: []
    })

    const stream = await transport.reconnectToStream({ chatId: topicId })
    expect(stream).toBeInstanceOf(ReadableStream)
    await stream?.cancel()
  })

  it('reconnectToStream returns closed stream when done', async () => {
    mock.mockApi.streamAttach.mockResolvedValue({
      status: ConversationAttachStatus.Settled,
      turnId: 'turn-1',
      executions: [],
      terminal: { status: ConversationStreamTerminalStatus.Done }
    })

    const stream = await transport.reconnectToStream({ chatId: topicId })
    expect(stream).toBeInstanceOf(ReadableStream)

    const reader = stream!.getReader()
    const { done } = await reader.read()
    expect(done).toBe(true)
  })
})
