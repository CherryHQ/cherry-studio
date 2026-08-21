import type { CompactionSink } from '@shared/ai/compaction'
import {
  ConversationInteractionResumeMode,
  ConversationKind,
  ConversationOutcomeKind,
  toConversationEffectId,
  toConversationExecutionId,
  toConversationInteractionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import {
  AiExecutionManager,
  ConversationEffectType,
  type ConversationExecutionChunk,
  type ConversationExecutionSink
} from '..'

const ref = { kind: ConversationKind.Chat, id: 'topic-1' } as const
const turnId = toConversationTurnId('turn-1')
const executionId = toConversationExecutionId('execution-1')

function controlledStream() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  const stream = new ReadableStream<UIMessageChunk>({
    start(value) {
      controller = value
    }
  })
  return { stream, controller }
}

describe('AiExecutionManager', () => {
  it('fences a suspended Starting run without reporting terminal and resumes the exact resource', async () => {
    const first = controlledStream()
    const second = controlledStream()
    const openStream = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
    const suspend = vi.fn(() => {
      first.controller.close()
      return true
    })
    const resumeSuspended = vi.fn()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(openStream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      suspend,
      resumeSuspended,
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-1')
      },
      sink
    )
    await vi.waitFor(() => expect(openStream).toHaveBeenCalledOnce())

    expect(
      manager.suspend({
        type: ConversationEffectType.SuspendExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('suspend-1')
      })
    ).toBe(true)
    await Promise.resolve()
    expect(sink.terminal).not.toHaveBeenCalled()

    manager.resumeSuspended({
      type: ConversationEffectType.ResumeSuspendedExecution,
      conversation: ref,
      turnId,
      executionId,
      effectId: toConversationEffectId('resume-1'),
      suspendEffectId: toConversationEffectId('suspend-1')
    })
    await vi.waitFor(() => expect(openStream).toHaveBeenCalledTimes(2))
    second.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(suspend).toHaveBeenCalledOnce()
    expect(resumeSuspended).toHaveBeenCalledOnce()
    expect(sink.terminal).toHaveBeenCalledOnce()
    expect(sink.terminal).toHaveBeenCalledWith({ kind: ConversationOutcomeKind.Success })
  })

  it('owns chunks and resources while returning only control facts to Conversation', async () => {
    const controlled = controlledStream()
    const chunks: ConversationExecutionChunk[] = []
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: {
        chatId: 'topic-1',
        trigger: 'submit-message',
        uniqueModelId: 'provider::model',
        messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }]
      },
      observers: [{ id: 'observer-1', onChunk: (chunk) => chunks.push(chunk), isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-1')
      },
      sink
    )

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello' })
    controlled.controller.enqueue({ type: 'text-end', id: 'text-1' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(sink.firstChunk).toHaveBeenCalledOnce()
    expect(chunks.map(({ chunkSeq }) => chunkSeq)).toEqual([1, 2, 3])
    expect(sink.terminal).toHaveBeenCalledWith({ kind: ConversationOutcomeKind.Success })
    expect(manager.result(ref, turnId, executionId)).toMatchObject({
      outputNodeId: 'assistant-1',
      outcome: { kind: ConversationOutcomeKind.Success }
    })
  })

  it('uses a private resource fence and exact identity for abort', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-1')
      },
      sink
    )
    manager.abort({
      type: ConversationEffectType.AbortExecution,
      conversation: ref,
      turnId,
      executionId,
      effectId: toConversationEffectId('abort-1'),
      reason: 'user-stop'
    })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(sink.terminal).toHaveBeenCalledWith({ kind: ConversationOutcomeKind.Paused, reason: 'user-stop' })
  })

  it('reports approval as a typed interaction instead of changing business state itself', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-1')
      },
      sink
    )
    controlled.controller.enqueue({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1'
    } as UIMessageChunk)
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(sink.interactionOpened).toHaveBeenCalledWith(expect.objectContaining({ id: 'approval-1', executionId }))
  })

  it('routes turn-start compaction through the exact execution observer', async () => {
    const controlled = controlledStream()
    const chunks: ConversationExecutionChunk[] = []
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: async (_signal, compactionSink) => {
        compactionSink('anchor-1', {
          status: 'compacting',
          phase: 'turn-start',
          startedAt: new Date().toISOString()
        })
        return { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] }
      },
      observers: [{ id: 'observer-1', onChunk: (chunk) => chunks.push(chunk), isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-compaction')
      },
      sink
    )

    await vi.waitFor(() => expect(chunks).toHaveLength(1))
    expect(chunks[0]).toMatchObject({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      chunk: { type: 'data-compaction-anchor', id: 'anchor-1' }
    })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('drops preparation callbacks after the exact execution resource is released', async () => {
    let releasePreparation!: () => void
    let compactionSink!: CompactionSink
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    const observer = vi.fn()
    const openStream = vi.fn(async () => controlledStream().stream)
    const manager = new AiExecutionManager(openStream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: async (_signal, sink) => {
        compactionSink = sink
        await preparation
        return { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] }
      },
      observers: [{ id: 'observer-1', onChunk: observer, isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-stale')
      },
      { firstChunk: vi.fn(), interactionOpened: vi.fn(), terminal: vi.fn(), startFailed: vi.fn() }
    )
    await vi.waitFor(() => expect(compactionSink).toBeTypeOf('function'))

    manager.release(ref, turnId, executionId)
    compactionSink('late-anchor', {
      status: 'done',
      phase: 'turn-start',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    })
    releasePreparation()
    await Promise.all(manager.inFlightRuns())

    expect(observer).not.toHaveBeenCalled()
    expect(openStream).not.toHaveBeenCalled()
  })

  it('uses the approval idle window until exact resume restores the ordinary timeout', async () => {
    vi.useFakeTimers()
    try {
      const controlled = controlledStream()
      let requestSignal: AbortSignal | undefined
      const sink: ConversationExecutionSink = {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
      const manager = new AiExecutionManager(async (request) => {
        requestSignal = (request.requestOptions as { signal?: AbortSignal } | undefined)?.signal
        return controlled.stream
      })
      manager.register({
        conversation: ref,
        turnId,
        executionId,
        outputNodeId: 'assistant-1',
        modelId: 'provider::model',
        request: {
          chatId: 'topic-1',
          trigger: 'submit-message',
          uniqueModelId: 'provider::model',
          messages: [],
          requestOptions: { timeout: 10_000 }
        },
        observers: [],
        interactionResumeMode: ConversationInteractionResumeMode.InPlace
      })
      manager.start(
        {
          type: ConversationEffectType.StartExecution,
          conversation: ref,
          turnId,
          executionId,
          effectId: toConversationEffectId('start-approval-timeout')
        },
        sink
      )
      await vi.waitFor(() => expect(requestSignal).toBeDefined())
      controlled.controller.enqueue({
        type: 'tool-approval-request',
        approvalId: 'approval-1',
        toolCallId: 'tool-1'
      } as UIMessageChunk)
      await vi.waitFor(() => expect(sink.interactionOpened).toHaveBeenCalledOnce())

      await vi.advanceTimersByTimeAsync(15_000)
      expect(requestSignal?.aborted).toBe(false)

      manager.resume({
        type: ConversationEffectType.ResumeExecution,
        conversation: ref,
        turnId,
        executionId,
        interactionId: toConversationInteractionId('approval-1'),
        effectId: toConversationEffectId('resume-approval')
      })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(requestSignal?.aborted).toBe(true)
      await Promise.all(manager.inFlightRuns())
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers the observer with a semantic compact replay and exact high-water', async () => {
    const controlled = controlledStream()
    const initialChunks: ConversationExecutionChunk[] = []
    const attachedChunks: ConversationExecutionChunk[] = []
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [{ id: 'initial', onChunk: (chunk) => initialChunks.push(chunk), isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-replay')
      },
      sink
    )
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello ' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'world' })
    controlled.controller.enqueue({ type: 'text-end', id: 'text-1' })
    await vi.waitFor(() => expect(initialChunks).toHaveLength(4))

    const staleObserver = vi.fn()
    expect(
      manager.attachSnapshot(ref, toConversationTurnId('old-turn'), {
        id: 'stale',
        onChunk: staleObserver,
        isAlive: () => true
      })
    ).toEqual([])

    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'attached',
      onChunk: (chunk) => attachedChunks.push(chunk),
      isAlive: () => true
    })
    expect(snapshot.replay).toMatchObject({
      throughChunkSeq: 4,
      firstAvailableChunkSeq: 1,
      truncated: false
    })
    expect(snapshot.replay.chunks).toMatchObject([
      { chunkSeq: 1, throughChunkSeq: 1, chunk: { type: 'text-start' } },
      { chunkSeq: 2, throughChunkSeq: 3, chunk: { type: 'text-delta', delta: 'hello world' } },
      { chunkSeq: 4, throughChunkSeq: 4, chunk: { type: 'text-end' } }
    ])

    controlled.controller.enqueue({ type: 'text-start', id: 'text-2' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
    expect(staleObserver).not.toHaveBeenCalled()
    expect(attachedChunks).toHaveLength(1)
    expect(attachedChunks[0]?.chunkSeq).toBe(5)
  })

  it('marks replay truncation from the first retained execution sequence', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      maxBufferChunks: 2,
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-truncated')
      },
      sink
    )
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'answer' })
    controlled.controller.enqueue({ type: 'text-end', id: 'text-1' })
    await vi.waitFor(() =>
      expect(
        manager.attachSnapshot(ref, turnId, { id: 'probe', onChunk: vi.fn(), isAlive: () => true })[0]?.replay
          .throughChunkSeq
      ).toBe(3)
    )

    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'attached',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(snapshot.replay).toMatchObject({ firstAvailableChunkSeq: 2, throughChunkSeq: 3, truncated: true })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })
})
