import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyAssistantEvents,
  installAssistantCheckpoint,
  type AssistantProjection
} from '@cherrystudio/remote-protocol/assistant'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import type { AiStreamManager, StreamListener } from '@main/ai/streamManager'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import { createUniqueModelId } from '@shared/data/types/model'

import { sha256 } from '../agentQueries'
import { TopicJournal } from '../assistantJournal'

const fake = vi.hoisted(() => {
  const state = { snapshot: undefined as ReturnType<AiStreamManager['inspect']>, listeners: new Set<StreamListener>() }
  return {
    state,
    manager: {
      inspect: () => state.snapshot,
      hasLiveStream: () => state.snapshot?.executions.some((execution) => execution.status === 'streaming') ?? false,
      hasUnsettledTopicWork: () =>
        state.snapshot?.executions.some((execution) => execution.status === 'streaming') ?? false,
      addListener: (_topicId: string, listener: StreamListener) => {
        state.listeners.add(listener)
        if (state.snapshot)
          state.snapshot = { ...state.snapshot, listenerIds: [...state.listeners].map((item) => item.id) }
        return true
      },
      removeListener: (_topicId: string, id: string) => {
        for (const listener of state.listeners) if (listener.id === id) state.listeners.delete(listener)
      }
    }
  }
})
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'AiStreamManager') return fake.manager
    return originalGet(name)
  })
  return result
})

describe('Assistant live recovery', () => {
  setupTestDatabase()
  let journal: TopicJournal | undefined
  beforeEach(() => {
    fake.state.snapshot = undefined
    fake.state.listeners.clear()
  })
  afterEach(() => {
    journal?.dispose()
    journal = undefined
  })

  function seed() {
    const topic = topicService.create({ name: 'Live topic' })
    const user = messageService.create(topic.id, {
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Question' }] }
    })
    const one = messageService.create(topic.id, {
      role: 'assistant',
      parentId: user.id,
      status: 'pending',
      data: { parts: [] }
    })
    const two = messageService.create(topic.id, {
      role: 'assistant',
      parentId: user.id,
      status: 'pending',
      data: { parts: [] }
    })
    const firstModel = createUniqueModelId('provider', 'first')
    const secondModel = createUniqueModelId('provider', 'second')
    fake.state.snapshot = {
      topicId: topic.id,
      status: 'streaming',
      isMultiModel: true,
      listenerIds: [],
      executions: [
        {
          modelId: firstModel,
          attemptId: 1,
          anchorMessageId: one.id,
          status: 'streaming',
          abortSignal: new AbortController().signal,
          bufferedChunkCount: 0,
          droppedChunks: 0,
          timings: { startedAt: 0 },
          finalMessage: { id: one.id, role: 'assistant', parts: [{ type: 'text', text: '你', state: 'streaming' }] }
        },
        {
          modelId: secondModel,
          attemptId: 2,
          anchorMessageId: two.id,
          status: 'streaming',
          abortSignal: new AbortController().signal,
          bufferedChunkCount: 0,
          droppedChunks: 0,
          timings: { startedAt: 0 },
          finalMessage: {
            id: two.id,
            role: 'assistant',
            parts: [{ type: 'text', text: 'Second model', state: 'streaming' }]
          }
        }
      ]
    }
    journal = new TopicJournal(topic.id, () => {})
    journal.poll()
    return { topic, one, two, firstModel }
  }
  function baseline(): AssistantProjection {
    const checkpoint = journal!.capture()
    const installed = installAssistantCheckpoint(
      checkpoint.descriptor,
      checkpoint.pages,
      Object.fromEntries(checkpoint.content),
      { sha256 }
    )
    if (!installed.ok) throw new Error(installed.reason)
    return installed.projection
  }

  it('recovers complete current snapshots and keeps model identity even without message metadata', () => {
    const { one, two } = seed()
    const projection = baseline()
    expect(projection.messages[one.id].model).toMatchObject({ modelId: 'first', providerId: 'provider' })
    expect(projection.messages[two.id].model).toMatchObject({ modelId: 'second', providerId: 'provider' })
    expect(projection.parts[`${one.id}:live:0`]).toMatchObject({ content: { text: '你' } })
    expect(projection.parts[`${two.id}:live:0`]).toMatchObject({ content: { text: 'Second model' } })
    expect(projection.topic.activeExecutionIds).toHaveLength(2)
  })

  it('replays multiple bounded deltas with increasing revisions and preserves the original projection', () => {
    const { one } = seed()
    const projection = baseline()
    fake.state.snapshot!.executions[0].finalMessage!.parts = [
      { type: 'text', text: '你' + '好🍒'.repeat(1600), state: 'streaming' }
    ]
    journal!.poll()
    const events = journal!.eventsAfter(Number(projection.cursor.seq), Infinity)
    const applied = applyAssistantEvents(
      projection,
      { subscriptionId: 'sub', topicId: journal!.topicId, streamEpoch: journal!.epoch, events },
      {},
      { sha256 }
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) throw new Error(applied.reason)
    expect(applied.projection.parts[`${one.id}:live:0`]).toMatchObject({
      content: { text: '你' + '好🍒'.repeat(1600) }
    })
    expect(projection.parts[`${one.id}:live:0`]).toMatchObject({ content: { text: '你' } })
    expect(
      events
        .filter((event) => event.kind === 'part.append')
        .every((event) => Buffer.byteLength(JSON.stringify(event)) < 16_384)
    ).toBe(true)
  })

  it('publishes durable terminal identity only after persistence and keeps sibling executions alive', () => {
    const { topic, one, two, firstModel } = seed()
    messageService.finalizeAssistantMessage(one.id, {
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Saved reply' }] }
    })
    fake.state.snapshot = {
      ...fake.state.snapshot!,
      executions: fake.state.snapshot!.executions.map((execution, index) =>
        index === 0 ? { ...execution, status: 'done' } : execution
      )
    }
    const revision = topicService.getRemoteHistoryRevision(topic.id)
    journal!.onDone({
      status: 'success',
      modelId: firstModel,
      attemptId: 1,
      anchorMessageId: one.id,
      isTopicDone: false,
      finalMessage: { id: one.id, role: 'assistant', parts: [{ type: 'text', text: 'Saved reply' }] },
      persistence: {
        status: 'saved',
        message: { messageId: one.id, messageRevision: revision, historyRevision: revision }
      }
    })
    const projection = baseline()
    expect(Object.values(projection.executions)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageId: one.id,
          status: 'completed',
          durable: true,
          history: { historyRevision: revision, messageRevision: revision }
        }),
        expect.objectContaining({ messageId: two.id, durable: false })
      ])
    )
    expect(projection.messages[one.id]).toBeUndefined()
    expect(projection.messages[two.id]).toBeDefined()
  })

  it('keeps late tool outputs beside their inputs in live replay and reconnect checkpoints', () => {
    const { one } = seed()
    const inputs = ['A', 'B'].map((toolCallId) => ({
      type: 'dynamic-tool' as const,
      toolName: 'lookup',
      toolCallId,
      state: 'input-available' as const,
      input: { query: toolCallId }
    }))
    fake.state.snapshot!.executions[0].finalMessage!.parts = inputs
    journal!.poll()
    const projection = baseline()
    expect(projection.messages[one.id].partIds).toEqual([`${one.id}:live:0:in`, `${one.id}:live:1:in`])

    fake.state.snapshot!.executions[0].finalMessage!.parts = [
      { ...inputs[0], state: 'output-available', output: 'Result A' },
      inputs[1]
    ]
    journal!.poll()
    const events = journal!.eventsAfter(Number(projection.cursor.seq), Infinity)
    const applied = applyAssistantEvents(
      projection,
      { subscriptionId: 'sub', topicId: journal!.topicId, streamEpoch: journal!.epoch, events },
      {},
      { sha256 }
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) throw new Error(applied.reason)
    const expectedOrder = [`${one.id}:live:0:in`, `${one.id}:live:0:out`, `${one.id}:live:1:in`]
    expect(applied.projection.messages[one.id].partIds).toEqual(expectedOrder)
    expect(applied.projection.parts[`${one.id}:live:0:out`]).toMatchObject({
      kind: 'tool-output',
      toolCallId: 'A',
      content: { text: '"Result A"' }
    })
    expect(projection.messages[one.id].partIds).toEqual([`${one.id}:live:0:in`, `${one.id}:live:1:in`])
    expect(baseline().messages[one.id].partIds).toEqual(expectedOrder)

    const replayed = applyAssistantEvents(
      applied.projection,
      { subscriptionId: 'sub', topicId: journal!.topicId, streamEpoch: journal!.epoch, events },
      {},
      { sha256 }
    )
    expect(replayed.ok).toBe(true)
    if (!replayed.ok) throw new Error(replayed.reason)
    expect(replayed.projection.messages[one.id].partIds).toEqual(expectedOrder)
  })

  it('materializes streamed checkpoint text before its lease can end and replays later appends without rereading it', () => {
    const { one } = seed()
    const text = '你' + 'Large answer '.repeat(500)
    fake.state.snapshot!.executions[0].finalMessage!.parts = [{ type: 'text', text, state: 'streaming' }]
    journal!.poll()
    const checkpoint = journal!.capture()
    const item = checkpoint.pages
      .flatMap((page) => page.items)
      .find((item) => item.kind === 'part' && item.value.partId === `${one.id}:live:0`)
    if (item?.kind !== 'part') throw new Error('Expected checkpoint text')
    const part = item.value
    if (part.kind !== 'text' || !('ref' in part.content)) throw new Error('Expected a bounded content reference')
    const ref = part.content.ref
    expect(installAssistantCheckpoint(checkpoint.descriptor, checkpoint.pages, {}, { sha256 })).toEqual({
      ok: false,
      reason: 'content'
    })
    const projection = baseline()
    expect(projection.parts[ref.contentId]).toMatchObject({ content: { text } })
    checkpoint.content.clear()
    fake.state.snapshot!.executions[0].finalMessage!.parts = [{ type: 'text', text: text + 'More', state: 'streaming' }]
    journal!.poll()
    expect(journal!.readContent(ref.contentId, ref.revision)).toBeUndefined()
    const applied = applyAssistantEvents(
      projection,
      {
        subscriptionId: 'sub',
        topicId: journal!.topicId,
        streamEpoch: journal!.epoch,
        events: journal!.eventsAfter(Number(projection.cursor.seq), Infinity)
      },
      {},
      { sha256 }
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) throw new Error(applied.reason)
    expect(applied.projection.parts[ref.contentId]).toMatchObject({ content: { text: text + 'More' } })
  })

  it('reattaches to a queued desktop turn even when no poll observes the idle gap', async () => {
    const { topic, one, firstModel } = seed()
    const user = messageService.create(topic.id, {
      role: 'user',
      parentId: one.id,
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Queued question' }] }
    })
    const reply = messageService.create(topic.id, {
      role: 'assistant',
      parentId: user.id,
      status: 'pending',
      data: { parts: [] }
    })
    fake.state.listeners.clear()
    fake.state.snapshot = {
      ...fake.state.snapshot!,
      listenerIds: [],
      executions: [
        {
          ...fake.state.snapshot!.executions[0],
          attemptId: 3,
          anchorMessageId: reply.id,
          finalMessage: {
            id: reply.id,
            role: 'assistant',
            parts: [{ type: 'text', text: 'Next answer', state: 'streaming' }]
          }
        }
      ]
    }
    journal!.poll()
    messageService.finalizeAssistantMessage(reply.id, {
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Next answer' }] }
    })
    fake.state.snapshot = {
      ...fake.state.snapshot,
      executions: [{ ...fake.state.snapshot.executions[0], status: 'done' }]
    }
    const revision = topicService.getRemoteHistoryRevision(topic.id)
    for (const listener of fake.state.listeners)
      await listener.onDone({
        status: 'success',
        attemptId: 3,
        anchorMessageId: reply.id,
        modelId: firstModel,
        finalMessage: { id: reply.id, role: 'assistant', parts: [{ type: 'text', text: 'Next answer' }] },
        persistence: {
          status: 'saved',
          message: { messageId: reply.id, messageRevision: revision, historyRevision: revision }
        }
      })
    const projection = baseline()
    expect(Object.values(projection.executions)).toEqual(
      expect.arrayContaining([expect.objectContaining({ messageId: reply.id, status: 'completed', durable: true })])
    )
    expect(projection.messages[reply.id]).toBeUndefined()
  })

  it('recovers a large part catalog through checkpoint pages without oversized message headers', () => {
    const { one } = seed()
    fake.state.snapshot!.executions[0].finalMessage!.parts = Array.from({ length: 350 }, (_, index) => ({
      type: 'text' as const,
      text: `Part ${index}`,
      state: 'done' as const
    }))
    journal!.poll()
    const checkpoint = journal!.capture()
    expect(checkpoint.pages.every((page) => Buffer.byteLength(JSON.stringify(page)) < 65_536)).toBe(true)
    const installed = installAssistantCheckpoint(
      checkpoint.descriptor,
      checkpoint.pages,
      Object.fromEntries(checkpoint.content),
      { sha256 }
    )
    expect(installed.ok).toBe(true)
    if (!installed.ok) throw new Error(installed.reason)
    const message = installed.projection.messages[one.id]
    expect(message.partIds).toHaveLength(350)
    expect(installed.projection.parts[message.partIds[349]]).toMatchObject({
      kind: 'text',
      content: { text: 'Part 349' }
    })
    expect(journal!.eventsAfter(0, Infinity).every((event) => Buffer.byteLength(JSON.stringify(event)) < 16_384)).toBe(
      true
    )
  })

  it('attaches before a leftover chunk timer publishes the next short turn', async () => {
    vi.useFakeTimers()
    try {
      const { topic, one, firstModel } = seed()
      journal!.onChunk()
      const user = messageService.create(topic.id, {
        role: 'user',
        parentId: one.id,
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Short queued question' }] }
      })
      const reply = messageService.create(topic.id, {
        role: 'assistant',
        parentId: user.id,
        status: 'pending',
        data: { parts: [] }
      })
      fake.state.listeners.clear()
      fake.state.snapshot = {
        ...fake.state.snapshot!,
        listenerIds: [],
        executions: [
          {
            ...fake.state.snapshot!.executions[0],
            attemptId: 3,
            anchorMessageId: reply.id,
            finalMessage: {
              id: reply.id,
              role: 'assistant',
              parts: [{ type: 'text', text: 'Short answer', state: 'streaming' }]
            }
          }
        ]
      }
      await vi.advanceTimersByTimeAsync(50)
      messageService.finalizeAssistantMessage(reply.id, {
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Short answer' }] }
      })
      fake.state.snapshot = {
        ...fake.state.snapshot,
        executions: [{ ...fake.state.snapshot.executions[0], status: 'done' }]
      }
      const revision = topicService.getRemoteHistoryRevision(topic.id)
      for (const listener of fake.state.listeners)
        await listener.onDone({
          status: 'success',
          attemptId: 3,
          anchorMessageId: reply.id,
          modelId: firstModel,
          finalMessage: { id: reply.id, role: 'assistant', parts: [{ type: 'text', text: 'Short answer' }] },
          persistence: {
            status: 'saved',
            message: { messageId: reply.id, messageRevision: revision, historyRevision: revision }
          }
        })
      const projection = baseline()
      expect(Object.values(projection.executions)).toEqual(
        expect.arrayContaining([expect.objectContaining({ messageId: reply.id, status: 'completed', durable: true })])
      )
      expect(projection.messages[reply.id]).toBeUndefined()
    } finally {
      journal?.dispose()
      journal = undefined
      vi.useRealTimers()
    }
  })

  it('replaces parts when retry reuses a non-durable message without merging execution identities', () => {
    const { one, firstModel } = seed()
    const before = baseline().parts[`${one.id}:live:0`].executionId
    fake.state.snapshot = {
      ...fake.state.snapshot!,
      executions: fake.state.snapshot!.executions.map((execution, index) =>
        index === 0 ? { ...execution, status: 'aborted' } : execution
      )
    }
    journal!.onPaused({
      status: 'paused',
      attemptId: 1,
      modelId: firstModel,
      anchorMessageId: one.id,
      finalMessage: { id: one.id, role: 'assistant', parts: [{ type: 'text', text: '你', state: 'streaming' }] },
      persistence: {
        status: 'failed',
        failure: toExecutionFailure({ name: 'Error', message: 'Storage failed', stack: null }, firstModel, 'host')
      }
    })
    expect(baseline().parts[`${one.id}:live:0`]).toMatchObject({ state: 'completed' })
    fake.state.snapshot = {
      ...fake.state.snapshot,
      executions: fake.state.snapshot.executions.map((execution, index) =>
        index === 0
          ? {
              ...execution,
              status: 'streaming',
              attemptId: 3,
              finalMessage: {
                id: one.id,
                role: 'assistant',
                parts: [{ type: 'text', text: '你好', state: 'streaming' }]
              }
            }
          : execution
      )
    }
    journal!.poll()
    const after = baseline()
    const part = after.parts[`${one.id}:live:0`]
    expect(part.executionId).not.toBe(before)
    expect(part).toMatchObject({ content: { text: '你好' }, state: 'streaming' })
    expect(after.executions[part.executionId!]).toMatchObject({ messageId: one.id, status: 'running' })
  })
})
