import {
  ConversationInteractionResumeMode,
  ConversationKind,
  ConversationOutcomeKind,
  toConversationEffectId,
  toConversationExecutionId,
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
