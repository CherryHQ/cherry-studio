import {
  ConversationKind,
  ConversationOutcomeKind,
  type ConversationRef,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import { IpcChannel } from '@shared/IpcChannel'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConversationStreamIdentity, StreamDoneResult, StreamErrorResult } from '../../types'
import { WebContentsListener } from '../WebContentsListener'

interface FakeWebContents {
  id: number
  send: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
}

const CHAT: ConversationRef = { kind: ConversationKind.Chat, id: 'topic-1' }
const AGENT: ConversationRef = { kind: ConversationKind.Agent, id: 'session-1' }

function fakeWebContents(): FakeWebContents {
  return {
    id: 1,
    send: vi.fn(),
    isDestroyed: vi.fn(() => false)
  }
}

function chunk(type: UIMessageChunk['type'], value: Record<string, unknown> = {}): UIMessageChunk {
  return { type, ...value } as UIMessageChunk
}

function identity(
  executionId = 'execution-1',
  outputNodeId = 'assistant-1',
  chunkSeq = 1,
  conversation = CHAT
): ConversationStreamIdentity {
  return {
    conversation,
    turnId: toConversationTurnId('turn-1'),
    executionId: toConversationExecutionId(executionId),
    modelId: 'provider::model',
    outputNodeId,
    chunkSeq,
    throughChunkSeq: chunkSeq
  }
}

function listener(conversation = CHAT): { wc: FakeWebContents; listener: WebContentsListener } {
  const wc = fakeWebContents()
  return {
    wc,
    listener: new WebContentsListener(wc as unknown as Electron.WebContents, conversation)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WebContentsListener', () => {
  it('coalesces deltas while retaining the exact Conversation execution identity', () => {
    const { wc, listener: stream } = listener()
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: 'Hello' }), identity('execution-1', 'assistant-1', 1))
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: ' world' }), identity('execution-1', 'assistant-1', 2))

    vi.advanceTimersByTime(16)

    expect(wc.send).toHaveBeenCalledWith(IpcChannel.IpcApi_Event, 'ai.stream.chunk', {
      conversation: CHAT,
      turnId: toConversationTurnId('turn-1'),
      executionId: toConversationExecutionId('execution-1'),
      modelId: 'provider::model',
      outputNodeId: 'assistant-1',
      chunkSeq: 1,
      throughChunkSeq: 2,
      chunk: { type: 'text-delta', id: 'text-1', delta: 'Hello world' }
    })
  })

  it('never coalesces data from different executions or output nodes', () => {
    const { wc, listener: stream } = listener()
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: 'A' }), identity('execution-1', 'assistant-1'))
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: 'B' }), identity('execution-2', 'assistant-2'))

    expect(wc.send).toHaveBeenCalledTimes(1)
    expect(wc.send.mock.calls[0][2]).toMatchObject({
      executionId: toConversationExecutionId('execution-1'),
      outputNodeId: 'assistant-1',
      chunk: { delta: 'A' }
    })

    vi.advanceTimersByTime(16)
    expect(wc.send.mock.calls[1][2]).toMatchObject({
      executionId: toConversationExecutionId('execution-2'),
      outputNodeId: 'assistant-2',
      chunk: { delta: 'B' }
    })
  })

  it('flushes buffered data before non-coalescable chunks', () => {
    const { wc, listener: stream } = listener()
    const streamIdentity = identity()
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: 'Hi' }), streamIdentity)
    stream.onChunk(chunk('text-end', { id: 'text-1' }), { ...streamIdentity, chunkSeq: 2, throughChunkSeq: 2 })

    expect(wc.send.mock.calls.map((call) => call[2].chunk)).toEqual([
      { type: 'text-delta', id: 'text-1', delta: 'Hi' },
      { type: 'text-end', id: 'text-1' }
    ])
  })

  it('does not buffer a delta carrying provider metadata', () => {
    const { wc, listener: stream } = listener()
    const streamIdentity = identity()
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: 'A' }), streamIdentity)
    stream.onChunk(
      chunk('text-delta', {
        id: 'text-1',
        delta: 'B',
        providerMetadata: { cherry: { references: [] } }
      }),
      { ...streamIdentity, chunkSeq: 2, throughChunkSeq: 2 }
    )

    expect(wc.send.mock.calls.map((call) => call[2].chunk.delta)).toEqual(['A', 'B'])
  })

  it('coalesces tool input only within the same tool call', () => {
    const { wc, listener: stream } = listener()
    const streamIdentity = identity()
    stream.onChunk(chunk('tool-input-delta', { toolCallId: 'call-1', inputTextDelta: '{"q":' }), streamIdentity)
    stream.onChunk(chunk('tool-input-delta', { toolCallId: 'call-1', inputTextDelta: '"hi"}' }), {
      ...streamIdentity,
      chunkSeq: 2,
      throughChunkSeq: 2
    })

    vi.advanceTimersByTime(16)

    expect(wc.send.mock.calls[0][2].chunk).toEqual({
      type: 'tool-input-delta',
      toolCallId: 'call-1',
      inputTextDelta: '{"q":"hi"}'
    })
  })

  it('projects large Agent tool outputs without synthetic topic identities or input mutation', () => {
    const { wc, listener: stream } = listener(AGENT)
    const output = { content: 'x'.repeat(64 * 1024) }
    const toolChunk = chunk('tool-output-available', { toolCallId: 'call-1', output })

    stream.onChunk(toolChunk, identity('execution-1', 'assistant-1', 1, AGENT))

    expect(wc.send.mock.calls[0][2]).toMatchObject({
      conversation: AGENT,
      outputNodeId: 'assistant-1',
      chunk: {
        output: {
          $deferredToolResult: {
            conversation: AGENT,
            messageId: 'assistant-1',
            toolCallId: 'call-1'
          }
        }
      }
    })
    expect(toolChunk).toMatchObject({ output })
  })

  it('emits exact terminal identity and logical-turn terminal state', () => {
    const { wc, listener: stream } = listener()
    const terminal: StreamDoneResult = {
      status: ConversationOutcomeKind.Success,
      turnId: toConversationTurnId('turn-1'),
      executionId: toConversationExecutionId('execution-1'),
      modelId: 'provider::model',
      anchorMessageId: 'assistant-1',
      turnTerminal: true
    }

    stream.onDone(terminal)

    expect(wc.send).toHaveBeenCalledWith(IpcChannel.IpcApi_Event, 'ai.stream.done', {
      conversation: CHAT,
      turnId: terminal.turnId,
      executionId: terminal.executionId,
      modelId: terminal.modelId,
      outputNodeId: 'assistant-1',
      status: 'done',
      turnTerminal: true
    })
  })

  it('flushes pending chunks before emitting an error terminal', () => {
    const { wc, listener: stream } = listener()
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: 'Partial' }), identity())
    const terminal: StreamErrorResult = {
      status: ConversationOutcomeKind.Error,
      turnId: toConversationTurnId('turn-1'),
      executionId: toConversationExecutionId('execution-1'),
      modelId: 'provider::model',
      anchorMessageId: 'assistant-1',
      turnTerminal: true,
      error: { name: 'Error', message: 'boom', stack: null }
    }

    stream.onError(terminal)

    expect(wc.send.mock.calls.map((call) => call[1])).toEqual(['ai.stream.chunk', 'ai.stream.error'])
  })

  it('flushes synchronously when a starved coalescing timer exceeds the age fence', () => {
    const { wc, listener: stream } = listener()
    let clock = 1_000
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const streamIdentity = identity()
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: 'a' }), streamIdentity)
    clock += 5
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: 'b' }), {
      ...streamIdentity,
      chunkSeq: 2,
      throughChunkSeq: 2
    })
    clock += 20
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: 'c' }), {
      ...streamIdentity,
      chunkSeq: 3,
      throughChunkSeq: 3
    })

    expect(wc.send.mock.calls[0][2].chunk.delta).toBe('abc')
    now.mockRestore()
  })

  it('discards buffered data when its WebContents is destroyed', () => {
    const { wc, listener: stream } = listener()
    stream.onChunk(chunk('text-delta', { id: 'text-1', delta: 'A' }), identity())
    wc.isDestroyed.mockReturnValue(true)

    expect(stream.isAlive()).toBe(false)
    vi.advanceTimersByTime(16)
    expect(wc.send).not.toHaveBeenCalled()
  })
})
