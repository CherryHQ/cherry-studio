import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'

import { PersistenceListener } from '../../../listeners/PersistenceListener'
import type { StreamDoneResult, StreamPausedResult } from '../../../types'
import { MessageServiceBackend } from '../MessageServiceBackend'

describe('ordinary Assistant durable persistence', () => {
  setupTestDatabase()
  function pending() {
    const topic = topicService.create({ name: 'Topic' })
    const user = messageService.create(topic.id, {
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Question' }] }
    })
    const anchor = messageService.create(topic.id, {
      role: 'assistant',
      parentId: user.id,
      status: 'pending',
      data: { parts: [], turnOptions: { reasoningEffort: 'high', serviceTier: 'flex', fastMode: true } }
    })
    const listener = new PersistenceListener({
      topicId: topic.id,
      backend: new MessageServiceBackend({ assistantMessageId: anchor.id, turnOptions: anchor.data.turnOptions }),
      onPersistFailed: () => {
        throw new Error('Unexpected persistence failure')
      }
    })
    return { topic, anchor, listener }
  }

  it('saves terminal content and frozen controls before declaring its history durable', async () => {
    const { topic, anchor, listener } = pending()
    const before = topicService.getRemoteHistoryRevision(topic.id)
    const result: StreamDoneResult = {
      status: 'success',
      anchorMessageId: anchor.id,
      finalMessage: {
        id: anchor.id,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Saved answer' }],
        metadata: { stats: { inputTokens: 999, outputTokens: 1998, totalTokens: 2997, contextTokens: 13 } }
      },
      runtimeTiming: { startedAt: 1000, completedAt: 1160, spans: [] }
    }
    await listener.onDone(result)
    const saved = messageService.getById(anchor.id)
    expect(saved).toMatchObject({
      status: 'success',
      data: {
        parts: [{ type: 'text', text: 'Saved answer' }],
        turnOptions: { reasoningEffort: 'high', serviceTier: 'flex', fastMode: true }
      },
      stats: { contextTokens: 13, runtimeTiming: { startedAt: 1000, completedAt: 1160 } }
    })
    expect(saved.stats?.totalTokens).not.toBe(2997)
    expect(result.persistence).toMatchObject({ status: 'saved', message: { messageId: anchor.id } })
    if (result.persistence?.status !== 'saved') throw new Error('Missing durable terminal result')
    expect(BigInt(result.persistence.message.historyRevision)).toBeGreaterThan(BigInt(before))
  })

  it('terminalizes an empty cancelled reservation and exposes its saved identity', async () => {
    const { anchor, listener } = pending()
    const result: StreamPausedResult = { status: 'paused', anchorMessageId: anchor.id }
    await listener.onPaused(result)
    expect(messageService.getById(anchor.id)).toMatchObject({ status: 'paused', data: { parts: [] } })
    expect(result.persistence).toMatchObject({ status: 'saved', message: { messageId: anchor.id } })
  })
})
