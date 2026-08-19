import {
  ConversationAttachStatus,
  ConversationKind,
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
    ipc.attach.mockReset().mockResolvedValue({ status: ConversationAttachStatus.Attached, bufferedChunks: [] })
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
      status: ConversationAttachStatus.Done,
      turnTerminal: true
    })
    await reading

    expect(chunks).toEqual([{ type: 'text-delta', id: 'text-1', delta: 'hello' }])
    expect(subscription.isConversationOpen()).toBe(false)
    expect(subscription.isSettled(executionId)).toBe(true)
  })

  it('replays buffered chunks using monotonic execution chunk sequence', async () => {
    ipc.attach.mockResolvedValue({
      status: ConversationAttachStatus.Attached,
      bufferedChunks: [
        {
          conversation,
          turnId,
          executionId,
          modelId: projection.modelId,
          outputNodeId: projection.outputNodeId,
          chunkSeq: 2,
          chunk: { type: 'text-delta', id: 'text-2', delta: 'replay' }
        } satisfies StreamChunkPayload
      ]
    })
    const subscription = new ConversationStreamSubscription(conversation)
    const reader = subscription.register(projection).getReader()

    await expect(reader.read()).resolves.toMatchObject({
      value: { type: 'text-delta', delta: 'replay' }
    })
    await reader.cancel()
  })
})
