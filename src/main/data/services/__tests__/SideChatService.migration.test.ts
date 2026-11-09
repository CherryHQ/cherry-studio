import { replayMigration, setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { snapshotTo } from '@data/db/restore/snapshot'
import { messageService } from '@data/services/MessageService'
import { sideChatService } from '@data/services/SideChatService'
import { topicService } from '@data/services/TopicService'
import { createUniqueModelId } from '@shared/data/types/model'

describe('side-chat additive migration and database snapshot', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0036_sloppy_smasher' })

  it('keeps existing messages and preserves saved source links in a reopened snapshot', () => {
    const topic = topicService.create({ name: 'Existing conversation' })
    const user = messageService.create(topic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Existing question' }] },
      status: 'success',
      setAsActive: true
    })
    const answer = messageService.create(topic.id, {
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'Existing answer' }] },
      status: 'success',
      setAsActive: true
    })
    replayMigration(dbh, '0036_sloppy_smasher')
    expect(messageService.getById(user.id).data.parts).toEqual([{ type: 'text', text: 'Existing question' }])
    const side = sideChatService.create(
      { topicId: topic.id, messageId: answer.id },
      {
        modelId: createUniqueModelId('provider', 'model'),
        prompt: 'Brief explanation'
      }
    )
    const target = `${dbh.sqlite.name}.snapshot`
    snapshotTo(dbh.sqlite, target)
    const restored = new Database(target, { readonly: true })
    try {
      const row = restored.prepare('SELECT topic_id, source_topic_id, metadata FROM side_chat').get() as {
        topic_id: string
        source_topic_id: string
        metadata: string
      }
      expect(row.topic_id).toBe(side.topicId)
      expect(row.source_topic_id).toBe(topic.id)
      expect(JSON.parse(row.metadata)).toEqual(side.metadata)
      expect(restored.pragma('foreign_key_check')).toEqual([])
    } finally {
      restored.close()
    }
  })
})
