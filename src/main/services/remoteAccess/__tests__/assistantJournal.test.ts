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
  return mockApplicationFactory({ AiStreamManager: fake.manager })
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
    const installed = installAssistantCheckpoint(checkpoint.descriptor, checkpoint.pages, { sha256 })
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

  it('keeps an immutable content reference readable while later deltas advance the live part', () => {
    const { one } = seed()
    const text = 'Large answer '.repeat(500)
    fake.state.snapshot!.executions[0].finalMessage!.parts = [{ type: 'text', text, state: 'streaming' }]
    journal!.poll()
    const projection = baseline()
    const part = projection.parts[`${one.id}:live:0`]
    if (part.kind !== 'text' || !('ref' in part.content)) throw new Error('Expected a bounded content reference')
    const ref = part.content.ref
    fake.state.snapshot!.executions[0].finalMessage!.parts = [{ type: 'text', text: text + 'More', state: 'streaming' }]
    journal!.poll()
    const bytes = journal!.readContent(ref.contentId, ref.revision)
    expect(new TextDecoder().decode(bytes)).toBe(text)
    const applied = applyAssistantEvents(
      projection,
      {
        subscriptionId: 'sub',
        topicId: journal!.topicId,
        streamEpoch: journal!.epoch,
        events: journal!.eventsAfter(Number(projection.cursor.seq), Infinity)
      },
      { [`${ref.contentId}:${ref.revision}`]: bytes! },
      { sha256 }
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) throw new Error(applied.reason)
    expect(applied.projection.parts[ref.contentId]).toMatchObject({ content: { text: text + 'More' } })
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
    const installed = installAssistantCheckpoint(checkpoint.descriptor, checkpoint.pages, { sha256 })
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
