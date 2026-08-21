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
})
