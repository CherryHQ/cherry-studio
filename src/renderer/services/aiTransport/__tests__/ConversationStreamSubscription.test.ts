import {
  ConversationAttachStatus,
  ConversationExecutionAttachState,
  ConversationKind,
  ConversationStreamTerminalStatus,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { StreamChunkPayload } from '@shared/ai/transport'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  listeners: new Map<string, Set<(payload: unknown) => void>>(),
  attach: vi.fn()
}))
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
  streamAttachmentService: { acquire: () => () => {} }
}))

import { ConversationStreamSubscription } from '../ConversationStreamSubscription'

const conversation = { kind: ConversationKind.Chat, id: 'topic-1' } as const
const turnId = toConversationTurnId('turn-1')
const executionId = toConversationExecutionId('execution-1')
const projection = {
  turnId,
  executionId,
  modelId: 'provider::model' as UniqueModelId,
  outputNodeId: 'assistant-1'
}
const emit = (event: string, payload: unknown) => {
  for (const listener of ipc.listeners.get(event) ?? []) listener(payload)
}

describe('ConversationStreamSubscription', () => {
  beforeEach(() => {
    ipc.listeners.clear()
    ipc.attach.mockReset().mockResolvedValue({
      status: ConversationAttachStatus.Live,
      turnId,
      executions: []
    })
  })

  it('routes an exact execution branch and closes it on its terminal', async () => {
    const subscription = new ConversationStreamSubscription(conversation)
    subscription.listen()
    const stream = subscription.register(projection)
    const chunks: UIMessageChunk[] = []
    const reading = (async () => {
      const reader = stream.getReader()
      while (true) {
        const result = await reader.read()
        if (result.done) return
        chunks.push(result.value)
      }
    })()
    await Promise.resolve()

    emit('ai.stream.chunk', {
      conversation,
      turnId,
      executionId,
      modelId: projection.modelId,
      outputNodeId: projection.outputNodeId,
      chunkSeq: 1,
      chunk: { type: 'text-delta', id: 'text-1', delta: 'hello' }
    } satisfies StreamChunkPayload)
    emit('ai.stream.done', {
      conversation,
      turnId,
      executionId,
      outputNodeId: projection.outputNodeId,
      status: ConversationStreamTerminalStatus.Done,
      turnTerminal: true
    })
    await reading

    expect(chunks).toEqual([{ type: 'text-delta', id: 'text-1', delta: 'hello' }])
    expect(subscription.isConversationOpen()).toBe(false)
    expect(subscription.isSettled(executionId)).toBe(true)
  })

  it('replays buffered chunks using monotonic execution chunk sequence', async () => {
    ipc.attach.mockResolvedValue({
      status: ConversationAttachStatus.Live,
      turnId,
      executions: [
        {
          state: ConversationExecutionAttachState.Live,
          projection,
          replay: {
            chunks: [
              {
                conversation,
                turnId,
                executionId,
                modelId: projection.modelId,
                outputNodeId: projection.outputNodeId,
                chunkSeq: 2,
                chunk: { type: 'text-delta', id: 'text-2', delta: 'replay' }
              } satisfies StreamChunkPayload
            ],
            throughChunkSeq: 2,
            firstAvailableChunkSeq: 2,
            truncated: true
          }
        }
      ]
    })
    const subscription = new ConversationStreamSubscription(conversation)
    const reader = subscription.register(projection).getReader()

    await expect(reader.read()).resolves.toMatchObject({
      value: { type: 'text-delta', delta: 'replay' }
    })
    await reader.cancel()
  })

  it('applies replay before live chunks received while attach is in flight', async () => {
    let resolveAttach!: (value: unknown) => void
    ipc.attach.mockReturnValue(
      new Promise((resolve) => {
        resolveAttach = resolve
      })
    )
    const subscription = new ConversationStreamSubscription(conversation)
    const reader = subscription.register(projection).getReader()
    await Promise.resolve()

    emit('ai.stream.chunk', {
      conversation,
      turnId,
      executionId,
      modelId: projection.modelId,
      outputNodeId: projection.outputNodeId,
      chunkSeq: 2,
      chunk: { type: 'text-delta', id: 'text-1', delta: 'live' }
    } satisfies StreamChunkPayload)
    resolveAttach({
      status: ConversationAttachStatus.Live,
      turnId,
      executions: [
        {
          state: ConversationExecutionAttachState.Live,
          projection,
          replay: {
            chunks: [
              {
                conversation,
                turnId,
                executionId,
                modelId: projection.modelId,
                outputNodeId: projection.outputNodeId,
                chunkSeq: 1,
                chunk: { type: 'text-start', id: 'text-1' }
              }
            ],
            throughChunkSeq: 1,
            firstAvailableChunkSeq: 1,
            truncated: false
          }
        }
      ]
    })

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'text-start' } })
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'text-delta', delta: 'live' } })
    await reader.cancel()
  })

  it('does not lose a terminal received while attach replay is in flight', async () => {
    let resolveAttach!: (value: unknown) => void
    ipc.attach.mockReturnValue(
      new Promise((resolve) => {
        resolveAttach = resolve
      })
    )
    const subscription = new ConversationStreamSubscription(conversation)
    const reader = subscription.register(projection).getReader()
    await Promise.resolve()

    emit('ai.stream.done', {
      conversation,
      turnId,
      executionId,
      modelId: projection.modelId,
      outputNodeId: projection.outputNodeId,
      status: ConversationStreamTerminalStatus.Done,
      turnTerminal: true
    })
    resolveAttach({
      status: ConversationAttachStatus.Live,
      turnId,
      executions: [
        {
          state: ConversationExecutionAttachState.Live,
          projection,
          replay: {
            chunks: [],
            throughChunkSeq: 0,
            firstAvailableChunkSeq: 1,
            truncated: false
          }
        }
      ]
    })

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(subscription.isSettled(executionId)).toBe(true)
  })

  it('keeps live events received before a failed attach retry', async () => {
    let rejectAttach!: (error: Error) => void
    ipc.attach.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectAttach = reject
      })
    )
    const subscription = new ConversationStreamSubscription(conversation)
    const reader = subscription.register(projection).getReader()
    await Promise.resolve()

    emit('ai.stream.chunk', {
      conversation,
      turnId,
      executionId,
      modelId: projection.modelId,
      outputNodeId: projection.outputNodeId,
      chunkSeq: 1,
      chunk: { type: 'text-delta', id: 'text-1', delta: 'survives' }
    } satisfies StreamChunkPayload)
    rejectAttach(new Error('attach failed'))

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'text-delta', delta: 'survives' } })
    await reader.cancel()
    subscription.dispose()
  })

  it('sends the live high-water cursor and applies only the replay suffix', async () => {
    vi.useFakeTimers()
    ipc.attach.mockRejectedValueOnce(new Error('first attach failed')).mockResolvedValueOnce({
      status: ConversationAttachStatus.Live,
      turnId,
      executions: [
        {
          state: ConversationExecutionAttachState.Live,
          projection,
          replay: {
            chunks: [
              {
                conversation,
                turnId,
                executionId,
                modelId: projection.modelId,
                outputNodeId: projection.outputNodeId,
                chunkSeq: 3,
                throughChunkSeq: 3,
                chunk: { type: 'text-delta', id: 'text-1', delta: 'snapshot-suffix' }
              } satisfies StreamChunkPayload
            ],
            throughChunkSeq: 3,
            firstAvailableChunkSeq: 1,
            truncated: false
          }
        }
      ]
    })
    const subscription = new ConversationStreamSubscription(conversation)
    const refreshRequired = vi.fn()
    subscription.onRefreshRequired(refreshRequired)
    const reader = subscription.register(projection).getReader()
    await Promise.resolve()

    emit('ai.stream.chunk', {
      conversation,
      turnId,
      executionId,
      modelId: projection.modelId,
      outputNodeId: projection.outputNodeId,
      chunkSeq: 2,
      chunk: { type: 'text-delta', id: 'text-1', delta: 'live' }
    } satisfies StreamChunkPayload)
    await expect(reader.read()).resolves.toMatchObject({ value: { delta: 'live' } })

    await vi.advanceTimersByTimeAsync(250)
    await vi.waitFor(() => expect(ipc.attach).toHaveBeenCalledTimes(2))
    expect(ipc.attach).toHaveBeenLastCalledWith({
      conversation,
      cursors: [{ turnId, executionId, throughChunkSeq: 2 }]
    })
    expect(refreshRequired).not.toHaveBeenCalled()
    await expect(reader.read()).resolves.toMatchObject({ value: { delta: 'snapshot-suffix' } })

    emit('ai.stream.chunk', {
      conversation,
      turnId,
      executionId,
      modelId: projection.modelId,
      outputNodeId: projection.outputNodeId,
      chunkSeq: 4,
      chunk: { type: 'text-delta', id: 'text-1', delta: 'after-replay' }
    } satisfies StreamChunkPayload)
    await expect(reader.read()).resolves.toMatchObject({ value: { delta: 'after-replay' } })
    await reader.cancel()
    subscription.dispose()
    vi.useRealTimers()
  })

  it('bounds automatic attach retries and requests durable refresh without settling the branch', async () => {
    vi.useFakeTimers()
    ipc.attach.mockRejectedValue(new Error('ipc down'))
    const subscription = new ConversationStreamSubscription(conversation)
    const refreshRequired = vi.fn()
    subscription.onRefreshRequired(refreshRequired)
    subscription.register(projection)

    await vi.advanceTimersByTimeAsync(2_000)

    expect(ipc.attach).toHaveBeenCalledTimes(4)
    expect(refreshRequired).toHaveBeenCalledExactlyOnceWith([turnId])
    expect(subscription.hasOpenBranch(executionId)).toBe(true)
    expect(subscription.isSettled(executionId)).toBe(false)
    subscription.dispose()
    vi.useRealTimers()
  })

  it('requests durable refresh for NotFound without inventing a successful terminal', async () => {
    ipc.attach.mockResolvedValue({ status: ConversationAttachStatus.NotFound })
    const subscription = new ConversationStreamSubscription(conversation)
    const refreshRequired = vi.fn()
    subscription.onRefreshRequired(refreshRequired)
    subscription.register(projection)

    await vi.waitFor(() => expect(refreshRequired).toHaveBeenCalledWith([turnId]))
    expect(subscription.isSettled(executionId)).toBe(false)
    expect(subscription.hasOpenBranch(executionId)).toBe(true)
    subscription.dispose()
  })

  it('ignores an attach snapshot after its last observer unregisters', async () => {
    let resolveAttach!: (value: unknown) => void
    ipc.attach.mockReturnValue(
      new Promise((resolve) => {
        resolveAttach = resolve
      })
    )
    const subscription = new ConversationStreamSubscription(conversation)
    subscription.register(projection)
    await Promise.resolve()

    subscription.unregister(executionId)
    await Promise.resolve()
    resolveAttach({
      status: ConversationAttachStatus.Settled,
      turnId,
      executions: [
        {
          state: ConversationExecutionAttachState.Settled,
          projection,
          replay: { chunks: [], throughChunkSeq: 0, firstAvailableChunkSeq: 1, truncated: false },
          terminal: { status: ConversationStreamTerminalStatus.Done }
        }
      ],
      terminal: { status: ConversationStreamTerminalStatus.Done }
    })
    await Promise.resolve()

    expect(subscription.isSettled(executionId)).toBe(false)
    expect(subscription.isConversationOpen()).toBe(false)
    subscription.dispose()
  })

  it('retains terminal authority after the reader unregisters until explicit retirement', async () => {
    const subscription = new ConversationStreamSubscription(conversation)
    subscription.listen()
    const reader = subscription.register(projection).getReader()

    emit('ai.stream.done', {
      conversation,
      turnId,
      executionId,
      outputNodeId: projection.outputNodeId,
      status: ConversationStreamTerminalStatus.Done,
      turnTerminal: true
    })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })

    subscription.unregister(executionId)
    expect(subscription.isSettled(executionId)).toBe(true)
    await expect(subscription.register(projection).getReader().read()).resolves.toEqual({
      done: true,
      value: undefined
    })

    subscription.retireExecution(executionId)
    expect(subscription.isSettled(executionId)).toBe(false)
    subscription.dispose()
  })
})
