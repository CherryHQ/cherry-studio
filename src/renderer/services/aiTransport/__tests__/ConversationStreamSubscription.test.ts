import {
  ConversationAttachStatus,
  ConversationExecutionAttachState,
  ConversationKind,
  ConversationStreamTerminalStatus,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import {
  type AiStreamAttachResponse,
  ConversationReplayWindowKind,
  type StreamChunkPayload
} from '@shared/ai/transport'
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

import {
  ConversationStreamRecoveryCompletion,
  ConversationStreamRecoveryDisposition,
  ConversationStreamRecoveryReason,
  type ConversationStreamRecoveryRequest,
  ConversationStreamSubscription
} from '../ConversationStreamSubscription'

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

  it('hands a rebase snapshot to the presentation owner and continues from its high-water', async () => {
    ipc.attach.mockResolvedValue({
      status: ConversationAttachStatus.Live,
      turnId,
      executions: [
        {
          state: ConversationExecutionAttachState.Live,
          projection,
          replay: {
            kind: ConversationReplayWindowKind.Rebase,
            chunks: [
              {
                conversation,
                turnId,
                executionId,
                modelId: projection.modelId,
                outputNodeId: projection.outputNodeId,
                chunkSeq: 10_001,
                chunk: { type: 'text-start', id: 'text-2' }
              } satisfies StreamChunkPayload,
              {
                conversation,
                turnId,
                executionId,
                modelId: projection.modelId,
                outputNodeId: projection.outputNodeId,
                chunkSeq: 10_002,
                chunk: { type: 'text-delta', id: 'text-2', delta: 'retained' }
              } satisfies StreamChunkPayload
            ],
            throughChunkSeq: 10_002,
            firstAvailableChunkSeq: 3
          }
        }
      ]
    })
    const subscription = new ConversationStreamSubscription(conversation)
    let recoveredStream: ReadableStream<UIMessageChunk> | null = null
    const recoveryRequired = vi.fn((request) => {
      const completion = subscription.completeRecovery({
        recoveryId: request.recoveryId,
        attachmentGeneration: request.attachmentGeneration,
        turnId: request.turnId,
        executionId: request.executionId,
        disposition: ConversationStreamRecoveryDisposition.Rebased
      })
      if (completion.status === ConversationStreamRecoveryCompletion.Applied) recoveredStream = completion.branch
    })
    subscription.onRecoveryRequired(recoveryRequired)
    subscription.register(projection)

    await vi.waitFor(() => expect(recoveryRequired).toHaveBeenCalledOnce())
    expect(recoveryRequired.mock.calls[0]?.[0]).toMatchObject({
      reason: ConversationStreamRecoveryReason.Rebase,
      turnId,
      executionId
    })
    const reader = recoveredStream!.getReader()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'text-start', id: 'text-2' } })
    await expect(reader.read()).resolves.toMatchObject({ value: { delta: 'retained' } })
    emit('ai.stream.chunk', {
      conversation,
      turnId,
      executionId,
      modelId: projection.modelId,
      outputNodeId: projection.outputNodeId,
      chunkSeq: 10_003,
      chunk: { type: 'text-delta', id: 'text-2', delta: '-live' }
    } satisfies StreamChunkPayload)
    await expect(reader.read()).resolves.toMatchObject({ value: { delta: '-live' } })
    expect(subscription.hasOpenBranch(executionId)).toBe(true)
    await reader.cancel()
    subscription.dispose()
  })

  it('bounds live recovery buffering and requests one updated rebase after overflow', async () => {
    const rebase = (throughChunkSeq: number): AiStreamAttachResponse => ({
      status: ConversationAttachStatus.Live,
      turnId,
      executions: [
        {
          state: ConversationExecutionAttachState.Live,
          projection,
          replay: {
            kind: ConversationReplayWindowKind.Rebase,
            chunks: [
              {
                conversation,
                turnId,
                executionId,
                modelId: projection.modelId,
                outputNodeId: projection.outputNodeId,
                chunkSeq: throughChunkSeq,
                chunk: { type: 'text-start', id: `text-${throughChunkSeq}` }
              }
            ],
            throughChunkSeq,
            firstAvailableChunkSeq: throughChunkSeq
          }
        }
      ]
    })
    ipc.attach.mockResolvedValueOnce(rebase(100)).mockResolvedValueOnce(rebase(10_101))
    const subscription = new ConversationStreamSubscription(conversation)
    const recoveries: ConversationStreamRecoveryRequest[] = []
    subscription.onRecoveryRequired((request) => recoveries.push(request))
    subscription.register(projection)
    await vi.waitFor(() => expect(recoveries).toHaveLength(1))

    for (let chunkSeq = 101; chunkSeq <= 10_101; chunkSeq += 1) {
      emit('ai.stream.chunk', {
        conversation,
        turnId,
        executionId,
        modelId: projection.modelId,
        outputNodeId: projection.outputNodeId,
        chunkSeq,
        chunk: { type: 'text-delta', id: 'text-live', delta: 'x' }
      } satisfies StreamChunkPayload)
    }
    const first = recoveries[0]
    subscription.completeRecovery({
      recoveryId: first.recoveryId,
      attachmentGeneration: first.attachmentGeneration,
      turnId: first.turnId,
      executionId,
      disposition: ConversationStreamRecoveryDisposition.Rebased
    })

    await vi.waitFor(() => expect(recoveries).toHaveLength(2))
    expect(ipc.attach).toHaveBeenCalledTimes(2)
    const second = recoveries[1]
    const current = subscription.completeRecovery({
      recoveryId: second.recoveryId,
      attachmentGeneration: second.attachmentGeneration,
      turnId: second.turnId,
      executionId,
      disposition: ConversationStreamRecoveryDisposition.Rebased
    })
    expect(current.status).toBe(ConversationStreamRecoveryCompletion.Applied)
    if (current.status !== ConversationStreamRecoveryCompletion.Applied || !current.branch)
      throw new Error('rebase failed')
    const reader = current.branch.getReader()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'text-start', id: 'text-10101' } })
    emit('ai.stream.chunk', {
      conversation,
      turnId,
      executionId,
      modelId: projection.modelId,
      outputNodeId: projection.outputNodeId,
      chunkSeq: 10_102,
      chunk: { type: 'text-delta', id: 'text-10101', delta: 'live' }
    } satisfies StreamChunkPayload)
    await expect(reader.read()).resolves.toMatchObject({ value: { delta: 'live' } })
    await reader.cancel()
    subscription.dispose()
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
            kind: ConversationReplayWindowKind.Continuous,
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
            throughChunkSeq: 1
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
            kind: ConversationReplayWindowKind.Continuous,
            chunks: [],
            throughChunkSeq: 0
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

  it('reports only the contiguous cursor and replays a missing prefix before buffered live chunks', async () => {
    vi.useFakeTimers()
    ipc.attach.mockRejectedValueOnce(new Error('first attach failed')).mockResolvedValueOnce({
      status: ConversationAttachStatus.Live,
      turnId,
      executions: [
        {
          state: ConversationExecutionAttachState.Live,
          projection,
          replay: {
            kind: ConversationReplayWindowKind.Continuous,
            chunks: [
              {
                conversation,
                turnId,
                executionId,
                modelId: projection.modelId,
                outputNodeId: projection.outputNodeId,
                chunkSeq: 1,
                throughChunkSeq: 1,
                chunk: { type: 'text-start', id: 'text-1' }
              } satisfies StreamChunkPayload,
              {
                conversation,
                turnId,
                executionId,
                modelId: projection.modelId,
                outputNodeId: projection.outputNodeId,
                chunkSeq: 2,
                throughChunkSeq: 2,
                chunk: { type: 'text-delta', id: 'text-1', delta: 'live' }
              } satisfies StreamChunkPayload,
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
            throughChunkSeq: 3
          }
        }
      ]
    })
    const subscription = new ConversationStreamSubscription(conversation)
    const recoveryRequired = vi.fn()
    subscription.onRecoveryRequired(recoveryRequired)
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

    await vi.advanceTimersByTimeAsync(250)
    await vi.waitFor(() => expect(ipc.attach).toHaveBeenCalledTimes(2))
    expect(ipc.attach).toHaveBeenLastCalledWith({
      conversation,
      cursors: [{ turnId, executionId, throughChunkSeq: 0 }]
    })
    expect(recoveryRequired).not.toHaveBeenCalled()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'text-start' } })
    await expect(reader.read()).resolves.toMatchObject({ value: { delta: 'live' } })
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

  it('settles a terminal immediately when attach fails with an incomplete replay', async () => {
    let rejectAttach!: (error: Error) => void
    ipc.attach
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectAttach = reject
          })
      )
      .mockResolvedValueOnce({
        status: ConversationAttachStatus.Settled,
        turnId,
        executions: [
          {
            state: ConversationExecutionAttachState.Settled,
            projection,
            replay: {
              kind: ConversationReplayWindowKind.Continuous,
              chunks: [
                {
                  conversation,
                  turnId,
                  executionId,
                  modelId: projection.modelId,
                  outputNodeId: projection.outputNodeId,
                  chunkSeq: 1,
                  throughChunkSeq: 1,
                  chunk: { type: 'text-start', id: 'text-1' }
                },
                {
                  conversation,
                  turnId,
                  executionId,
                  modelId: projection.modelId,
                  outputNodeId: projection.outputNodeId,
                  chunkSeq: 2,
                  throughChunkSeq: 2,
                  chunk: { type: 'text-delta', id: 'text-1', delta: 'complete' }
                }
              ],
              throughChunkSeq: 2
            },
            terminal: { status: ConversationStreamTerminalStatus.Done }
          }
        ],
        terminal: { status: ConversationStreamTerminalStatus.Done }
      } satisfies AiStreamAttachResponse)
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
      chunk: { type: 'text-delta', id: 'text-1', delta: 'complete' }
    } satisfies StreamChunkPayload)
    emit('ai.stream.done', {
      conversation,
      turnId,
      executionId,
      modelId: projection.modelId,
      outputNodeId: projection.outputNodeId,
      status: ConversationStreamTerminalStatus.Done,
      turnTerminal: true
    })
    rejectAttach(new Error('attach failed'))
    await vi.waitFor(() => expect(subscription.isSettled(executionId)).toBe(true))
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    subscription.dispose()
  })

  it('bounds automatic attach retries and requests durable refresh without settling the branch', async () => {
    vi.useFakeTimers()
    ipc.attach.mockRejectedValue(new Error('ipc down'))
    const subscription = new ConversationStreamSubscription(conversation)
    const recoveryRequired = vi.fn()
    subscription.onRecoveryRequired(recoveryRequired)
    subscription.register(projection)

    await vi.advanceTimersByTimeAsync(2_000)

    expect(ipc.attach).toHaveBeenCalledTimes(4)
    expect(recoveryRequired).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        reason: ConversationStreamRecoveryReason.AttachUnavailable,
        turnId,
        executionId
      })
    )
    expect(subscription.hasOpenBranch(executionId)).toBe(true)
    expect(subscription.isSettled(executionId)).toBe(false)
    subscription.dispose()
    vi.useRealTimers()
  })

  it('requests durable refresh for NotFound without inventing a successful terminal', async () => {
    ipc.attach.mockResolvedValue({ status: ConversationAttachStatus.NotFound })
    const subscription = new ConversationStreamSubscription(conversation)
    const recoveryRequired = vi.fn()
    subscription.onRecoveryRequired(recoveryRequired)
    subscription.register(projection)

    await vi.waitFor(() =>
      expect(recoveryRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: ConversationStreamRecoveryReason.NotFound,
          turnId,
          executionId
        })
      )
    )
    expect(subscription.isSettled(executionId)).toBe(false)
    expect(subscription.hasOpenBranch(executionId)).toBe(true)
    subscription.dispose()
  })

  it('reattaches a branch registered while a lease-free recovery is completing', async () => {
    const nextExecutionId = toConversationExecutionId('execution-2')
    const nextProjection = {
      ...projection,
      executionId: nextExecutionId,
      outputNodeId: 'assistant-2'
    }
    ipc.attach
      .mockResolvedValueOnce({ status: ConversationAttachStatus.NotFound })
      .mockResolvedValueOnce({ status: ConversationAttachStatus.Live, turnId, executions: [] })
    const subscription = new ConversationStreamSubscription(conversation)
    let recovery!: ConversationStreamRecoveryRequest
    subscription.onRecoveryRequired((request) => {
      recovery = request
    })
    subscription.register(projection)
    await vi.waitFor(() => expect(recovery).toBeDefined())

    const reader = subscription.register(nextProjection).getReader()
    expect(ipc.attach).toHaveBeenCalledOnce()
    subscription.completeRecovery({
      recoveryId: recovery.recoveryId,
      attachmentGeneration: recovery.attachmentGeneration,
      turnId: recovery.turnId,
      executionId,
      disposition: ConversationStreamRecoveryDisposition.Retired
    })

    await vi.waitFor(() => expect(ipc.attach).toHaveBeenCalledTimes(2))
    expect(ipc.attach).toHaveBeenLastCalledWith({
      conversation,
      cursors: [{ turnId, executionId: nextExecutionId, throughChunkSeq: 0 }]
    })
    emit('ai.stream.chunk', {
      conversation,
      turnId,
      executionId: nextExecutionId,
      modelId: nextProjection.modelId,
      outputNodeId: nextProjection.outputNodeId,
      chunkSeq: 1,
      chunk: { type: 'text-delta', id: 'text-2', delta: 'live' }
    } satisfies StreamChunkPayload)
    await expect(reader.read()).resolves.toMatchObject({ value: { delta: 'live' } })
    await reader.cancel()
    subscription.dispose()
  })

  it('settles a terminal received during NotFound recovery and rejects its late result', async () => {
    ipc.attach.mockResolvedValue({ status: ConversationAttachStatus.NotFound })
    const subscription = new ConversationStreamSubscription(conversation)
    let recovery!: ConversationStreamRecoveryRequest
    subscription.onRecoveryRequired((request) => {
      recovery = request
    })
    const reader = subscription.register(projection).getReader()
    await vi.waitFor(() => expect(recovery).toBeDefined())

    emit('ai.stream.done', {
      conversation,
      turnId,
      executionId,
      modelId: projection.modelId,
      outputNodeId: projection.outputNodeId,
      status: ConversationStreamTerminalStatus.Done,
      turnTerminal: true
    })

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(subscription.isSettled(executionId)).toBe(true)
    expect(
      subscription.completeRecovery({
        recoveryId: recovery.recoveryId,
        attachmentGeneration: recovery.attachmentGeneration,
        turnId: recovery.turnId,
        executionId,
        disposition: ConversationStreamRecoveryDisposition.Retired
      })
    ).toEqual({ status: ConversationStreamRecoveryCompletion.Stale })
    subscription.dispose()
  })

  it('rejects a recovery result from another turn without retiring the current branch', async () => {
    ipc.attach.mockResolvedValue({ status: ConversationAttachStatus.NotFound })
    const subscription = new ConversationStreamSubscription(conversation)
    let recovery!: ConversationStreamRecoveryRequest
    subscription.onRecoveryRequired((request) => {
      recovery = request
    })
    subscription.register(projection)
    await vi.waitFor(() => expect(recovery).toBeDefined())

    expect(
      subscription.completeRecovery({
        recoveryId: recovery.recoveryId,
        attachmentGeneration: recovery.attachmentGeneration,
        turnId: toConversationTurnId('new-turn'),
        executionId,
        disposition: ConversationStreamRecoveryDisposition.Retired
      })
    ).toEqual({ status: ConversationStreamRecoveryCompletion.Stale })
    expect(subscription.hasOpenBranch(executionId)).toBe(true)

    expect(
      subscription.completeRecovery({
        recoveryId: recovery.recoveryId,
        attachmentGeneration: recovery.attachmentGeneration,
        turnId: recovery.turnId,
        executionId,
        disposition: ConversationStreamRecoveryDisposition.Retired
      })
    ).toEqual({ status: ConversationStreamRecoveryCompletion.Applied, branch: null })
    expect(subscription.hasOpenBranch(executionId)).toBe(false)
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
          replay: { kind: ConversationReplayWindowKind.Continuous, chunks: [], throughChunkSeq: 0 },
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
