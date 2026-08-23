import {
  ConversationAttachStatus,
  ConversationExecutionAttachState,
  type ConversationExecutionId,
  ConversationKind,
  ConversationStreamTerminalStatus,
  type ConversationTurnId,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type {
  AiStreamAttachResponse,
  ConversationExecutionProjection,
  StreamChunkPayload,
  StreamDonePayload,
  StreamErrorPayload
} from '@shared/ai/transport'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ listeners: new Map<string, Set<(payload: unknown) => void>>(), attach: vi.fn() }))
const attachment = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (_route: string, input: unknown) => ipc.attach(input),
    on: (event: string, listener: (payload: unknown) => void) => {
      const listeners = ipc.listeners.get(event) ?? new Set()
      listeners.add(listener)
      ipc.listeners.set(event, listeners)
      return () => listeners.delete(listener)
    }
  }
}))
vi.mock('../StreamAttachmentService', () => ({
  streamAttachmentService: { acquire: (...args: unknown[]) => attachment.acquire(...args) }
}))

import { ConversationStreamSubscription } from '../ConversationStreamSubscription'

const conversation = { kind: ConversationKind.Chat, id: 'topic-1' } as const
const turn1 = toConversationTurnId('turn-1')
const turn2 = toConversationTurnId('turn-2')
const executionA = toConversationExecutionId('execution-a')
const executionB = toConversationExecutionId('execution-b')
const executionA2 = toConversationExecutionId('execution-a2')
const streamError: SerializedError = { name: 'Error', message: 'boom', stack: null }

function projection(
  executionId = executionA,
  turnId = turn1,
  outputNodeId = `assistant-${executionId}`
): ConversationExecutionProjection {
  return {
    turnId,
    executionId,
    modelId: executionId === executionB ? 'anthropic::claude' : 'openai::gpt-4o',
    outputNodeId
  }
}

function payload(
  executionId: ConversationExecutionId,
  delta: string,
  chunkSeq: number,
  turnId = turn1,
  outputNodeId = `assistant-${executionId}`
): StreamChunkPayload {
  return {
    conversation,
    turnId,
    executionId,
    modelId: executionId === executionB ? 'anthropic::claude' : 'openai::gpt-4o',
    outputNodeId,
    chunkSeq,
    throughChunkSeq: chunkSeq,
    chunk: { type: 'text-delta', id: 'text-1', delta }
  }
}

function replay(chunks: StreamChunkPayload[] = []) {
  return {
    chunks,
    throughChunkSeq: chunks.at(-1)?.throughChunkSeq ?? 0,
    firstAvailableChunkSeq: chunks[0]?.chunkSeq ?? 1,
    truncated: (chunks[0]?.chunkSeq ?? 1) > 1
  }
}

function emit(event: string, eventPayload: unknown): void {
  for (const listener of ipc.listeners.get(event) ?? []) listener(eventPayload)
}

function done(
  executionId = executionA,
  turnTerminal = false,
  status:
    | ConversationStreamTerminalStatus.Done
    | ConversationStreamTerminalStatus.Paused = ConversationStreamTerminalStatus.Done,
  turnId: ConversationTurnId = turn1
): void {
  emit('ai.stream.done', {
    conversation,
    turnId,
    executionId,
    modelId: executionId === executionB ? 'anthropic::claude' : 'openai::gpt-4o',
    outputNodeId: `assistant-${executionId}`,
    status,
    turnTerminal
  } satisfies StreamDonePayload)
}

function fail(executionId = executionA, turnTerminal = false): void {
  emit('ai.stream.error', {
    conversation,
    turnId: turn1,
    executionId,
    modelId: 'openai::gpt-4o',
    outputNodeId: `assistant-${executionId}`,
    turnTerminal,
    error: streamError
  } satisfies StreamErrorPayload)
}

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const reader = stream.getReader()
  const result: UIMessageChunk[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) return result
    result.push(next.value)
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ConversationStreamSubscription legacy behavior contracts', () => {
  beforeEach(() => {
    ipc.listeners.clear()
    ipc.attach.mockReset().mockResolvedValue({
      status: ConversationAttachStatus.Live,
      turnId: turn1,
      executions: []
    } satisfies AiStreamAttachResponse)
    attachment.release.mockReset()
    attachment.acquire.mockReset().mockReturnValue(attachment.release)
  })

  it('attaches once for the conversation regardless of how many executions register', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    sub.register(projection(executionA))
    sub.register(projection(executionB))
    await tick()
    expect(ipc.attach).toHaveBeenCalledOnce()
    expect(ipc.attach).toHaveBeenCalledWith({
      conversation,
      cursors: [{ turnId: turn1, executionId: executionA, throughChunkSeq: 0 }]
    })
    sub.dispose()
  })

  it('demuxes chunks to the correct branch by exact execution identity', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    const a = sub.register(projection(executionA))
    const b = sub.register(projection(executionB))
    await tick()
    emit('ai.stream.chunk', payload(executionA, 'A', 1))
    emit('ai.stream.chunk', payload(executionB, 'B', 1))
    done(executionA)
    done(executionB, true)
    expect(await readAll(a)).toEqual([expect.objectContaining({ delta: 'A' })])
    expect(await readAll(b)).toEqual([expect.objectContaining({ delta: 'B' })])
    sub.dispose()
  })

  it('buffers chunks that arrive before a reader drains', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    const stream = sub.register(projection())
    await tick()
    emit('ai.stream.chunk', payload(executionA, 'one', 1))
    emit('ai.stream.chunk', payload(executionA, 'two', 2))
    done(executionA, true)
    expect(await readAll(stream)).toEqual([
      expect.objectContaining({ delta: 'one' }),
      expect.objectContaining({ delta: 'two' })
    ])
    sub.dispose()
  })

  it('can listen for chunks before an execution branch registers', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    sub.listen()
    emit('ai.stream.chunk', payload(executionA, 'early', 1))
    const stream = sub.register(projection())
    done(executionA, true)
    expect(await readAll(stream)).toEqual([expect.objectContaining({ delta: 'early' })])
    sub.dispose()
  })

  it('keeps same-model continuation branches distinct by execution id and output node', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    const first = sub.register(projection(executionA, turn1, 'assistant-1'))
    await tick()
    emit('ai.stream.chunk', payload(executionA, 'before', 1, turn1, 'assistant-1'))
    done(executionA)
    emit('ai.stream.chunk', payload(executionA2, 'after', 1, turn1, 'assistant-2'))
    const second = sub.register(projection(executionA2, turn1, 'assistant-2'))
    done(executionA2, true)
    expect(await readAll(first)).toEqual([expect.objectContaining({ delta: 'before' })])
    expect(await readAll(second)).toEqual([expect.objectContaining({ delta: 'after' })])
    sub.dispose()
  })

  it('keeps repeated attempts isolated by their new execution identities', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    const retry = sub.register(projection(executionA2, turn2, 'assistant-1'))
    await tick()
    done(executionA, true)
    emit('ai.stream.chunk', payload(executionA2, 'retry', 1, turn2, 'assistant-1'))
    done(executionA2, true, ConversationStreamTerminalStatus.Done, turn2)
    expect(await readAll(retry)).toEqual([expect.objectContaining({ delta: 'retry' })])
    sub.dispose()
  })

  it('keeps the attachment across a non-terminal execution gap before continuation chunks arrive', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    const first = sub.register(projection(executionA))
    await tick()
    done(executionA)
    expect(await readAll(first)).toEqual([])
    sub.unregister(executionA)
    await tick()
    expect(attachment.release).not.toHaveBeenCalled()
    const second = sub.register(projection(executionA2))
    emit('ai.stream.chunk', payload(executionA2, 'continued', 1))
    done(executionA2, true)
    expect(await readAll(second)).toEqual([expect.objectContaining({ delta: 'continued' })])
    sub.unregister(executionA2)
    await tick()
    expect(attachment.release).toHaveBeenCalledOnce()
    sub.dispose()
  })

  it('replays an error received before the branch registers', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    sub.listen()
    fail(executionA, true)
    const terminal = vi.fn()
    sub.onExecutionTerminal(terminal)
    const stream = sub.register(projection())
    expect(await readAll(stream)).toEqual([{ type: 'data-error', data: streamError }])
    expect(terminal).toHaveBeenCalledWith(expect.objectContaining({ executionId: executionA, isError: true }))
    sub.dispose()
  })

  it('one execution ending does not detach or affect another branch', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    const a = sub.register(projection(executionA))
    const b = sub.register(projection(executionB))
    await tick()
    done(executionA)
    sub.unregister(executionA)
    await tick()
    expect(attachment.release).not.toHaveBeenCalled()
    emit('ai.stream.chunk', payload(executionB, 'still-live', 1))
    done(executionB, true)
    expect(await readAll(a)).toEqual([])
    expect(await readAll(b)).toEqual([expect.objectContaining({ delta: 'still-live' })])
    sub.dispose()
  })

  it('releases the attachment exactly once when the last execution unregisters', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    sub.register(projection(executionA))
    sub.register(projection(executionB))
    await tick()
    done(executionA)
    done(executionB, true)
    sub.unregister(executionA)
    await tick()
    expect(attachment.release).not.toHaveBeenCalled()
    sub.unregister(executionB)
    await tick()
    expect(attachment.release).toHaveBeenCalledOnce()
    sub.dispose()
  })

  it('releases after attach resolves when the only execution unregisters in flight', async () => {
    let resolveAttach!: (value: AiStreamAttachResponse) => void
    ipc.attach.mockReturnValue(new Promise((resolve) => (resolveAttach = resolve)))
    const sub = new ConversationStreamSubscription(conversation)
    sub.register(projection())
    sub.unregister(executionA)
    await tick()
    resolveAttach({ status: ConversationAttachStatus.Live, turnId: turn1, executions: [] })
    await tick()
    expect(attachment.release).toHaveBeenCalledOnce()
    sub.dispose()
  })

  it('does not release when the last execution is replaced in the same microtask', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    sub.register(projection(executionA))
    await tick()
    sub.unregister(executionA)
    sub.register(projection(executionB))
    await tick()
    expect(attachment.release).not.toHaveBeenCalled()
    expect(ipc.attach).toHaveBeenCalledOnce()
    sub.dispose()
  })

  it('demuxes attach replay by execution identity', async () => {
    ipc.attach.mockResolvedValue({
      status: ConversationAttachStatus.Live,
      turnId: turn1,
      executions: [
        {
          state: ConversationExecutionAttachState.Live,
          projection: projection(executionA),
          replay: replay([payload(executionA, 'A', 1)])
        },
        {
          state: ConversationExecutionAttachState.Live,
          projection: projection(executionB),
          replay: replay([payload(executionB, 'B', 1)])
        }
      ]
    } satisfies AiStreamAttachResponse)
    const sub = new ConversationStreamSubscription(conversation)
    const a = sub.register(projection(executionA))
    const b = sub.register(projection(executionB))
    await tick()
    done(executionA)
    done(executionB, true)
    expect(await readAll(a)).toEqual([expect.objectContaining({ delta: 'A' })])
    expect(await readAll(b)).toEqual([expect.objectContaining({ delta: 'B' })])
    sub.dispose()
  })

  it('supports settled and live siblings in one attach snapshot', async () => {
    ipc.attach.mockResolvedValue({
      status: ConversationAttachStatus.Live,
      turnId: turn1,
      executions: [
        {
          state: ConversationExecutionAttachState.Settled,
          projection: projection(executionA),
          replay: replay([payload(executionA, 'done', 1)]),
          terminal: { status: ConversationStreamTerminalStatus.Done }
        },
        {
          state: ConversationExecutionAttachState.Live,
          projection: projection(executionB),
          replay: replay([payload(executionB, 'live', 1)])
        }
      ]
    } satisfies AiStreamAttachResponse)
    const sub = new ConversationStreamSubscription(conversation)
    const a = sub.register(projection(executionA))
    const b = sub.register(projection(executionB))
    await tick()
    expect(await readAll(a)).toEqual([expect.objectContaining({ delta: 'done' })])
    done(executionB, true)
    expect(await readAll(b)).toEqual([expect.objectContaining({ delta: 'live' })])
    expect(sub.isSettled(executionA)).toBe(true)
    sub.dispose()
  })

  it('does not lose a terminal received before attach replay resolves', async () => {
    let resolveAttach!: (value: AiStreamAttachResponse) => void
    ipc.attach.mockReturnValue(new Promise((resolve) => (resolveAttach = resolve)))
    const sub = new ConversationStreamSubscription(conversation)
    const stream = sub.register(projection())
    await tick()
    done(executionA, true)
    resolveAttach({
      status: ConversationAttachStatus.Live,
      turnId: turn1,
      executions: [
        {
          state: ConversationExecutionAttachState.Live,
          projection: projection(),
          replay: replay([payload(executionA, 'replay', 1)])
        }
      ]
    })
    expect(await readAll(stream)).toEqual([expect.objectContaining({ delta: 'replay' })])
    expect(sub.isSettled(executionA)).toBe(true)
    sub.dispose()
  })

  it('replays a settled error sibling without closing a live sibling', async () => {
    ipc.attach.mockResolvedValue({
      status: ConversationAttachStatus.Live,
      turnId: turn1,
      executions: [
        {
          state: ConversationExecutionAttachState.Settled,
          projection: projection(executionA),
          replay: replay(),
          terminal: { status: ConversationStreamTerminalStatus.Error, error: streamError }
        },
        { state: ConversationExecutionAttachState.Live, projection: projection(executionB), replay: replay() }
      ]
    } satisfies AiStreamAttachResponse)
    const sub = new ConversationStreamSubscription(conversation)
    const failed = sub.register(projection(executionA))
    const live = sub.register(projection(executionB))
    await tick()
    expect(await readAll(failed)).toEqual([{ type: 'data-error', data: streamError }])
    expect(sub.hasOpenBranch(executionB)).toBe(true)
    done(executionB, true)
    expect(await readAll(live)).toEqual([])
    sub.dispose()
  })

  it('closes one branch with paused terminal classification', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    const terminal = vi.fn()
    sub.onExecutionTerminal(terminal)
    const stream = sub.register(projection())
    await tick()
    done(executionA, true, ConversationStreamTerminalStatus.Paused)
    expect(await readAll(stream)).toEqual([])
    expect(terminal).toHaveBeenCalledWith(expect.objectContaining({ isAbort: true, isError: false }))
    sub.dispose()
  })

  it('dispose releases attachment, drops IPC listeners, and closes branches', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    const stream = sub.register(projection())
    await tick()
    sub.dispose()
    expect(attachment.release).toHaveBeenCalledOnce()
    expect(await readAll(stream)).toEqual([])
    emit('ai.stream.chunk', payload(executionA, 'late', 1))
  })

  it('NotFound requests durable refresh without inventing EOF or Success', async () => {
    ipc.attach.mockResolvedValue({ status: ConversationAttachStatus.NotFound } satisfies AiStreamAttachResponse)
    const sub = new ConversationStreamSubscription(conversation)
    const refresh = vi.fn()
    sub.onRefreshRequired(refresh)
    sub.register(projection())
    await tick()
    expect(refresh).toHaveBeenCalledWith([turn1])
    expect(sub.hasOpenBranch(executionA)).toBe(true)
    expect(sub.isSettled(executionA)).toBe(false)
    sub.dispose()
  })

  it('attach failure keeps readers retryable without inventing an error terminal', async () => {
    ipc.attach.mockRejectedValueOnce(new Error('ipc down'))
    const sub = new ConversationStreamSubscription(conversation)
    sub.register(projection())
    await tick()
    expect(sub.hasOpenBranch(executionA)).toBe(true)
    expect(sub.isSettled(executionA)).toBe(false)
    sub.dispose()
  })

  it('keeps terminal authority after reader cleanup until durable retirement', async () => {
    const sub = new ConversationStreamSubscription(conversation)
    sub.register(projection())
    await tick()
    done(executionA, true)
    sub.unregister(executionA)
    expect(sub.isSettled(executionA)).toBe(true)
    sub.retireExecution(executionA)
    expect(sub.isSettled(executionA)).toBe(false)
    sub.dispose()
  })
})
