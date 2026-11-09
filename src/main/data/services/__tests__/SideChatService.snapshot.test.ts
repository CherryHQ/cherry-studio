import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { snapshotTo } from '@data/db/restore/snapshot'
import { messageService } from '@data/services/MessageService'
import { sideChatService } from '@data/services/SideChatService'
import { topicService } from '@data/services/TopicService'
import { createUniqueModelId } from '@shared/data/types/model'

describe('side-chat root metadata and database snapshot', () => {
  const dbh = setupTestDatabase()

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
      const row = restored
        .prepare("SELECT topic_id, data FROM message WHERE topic_id = ? AND role = 'root'")
        .get(side.topicId) as {
        topic_id: string
        data: string
      }
      expect(row.topic_id).toBe(side.topicId)
      expect(JSON.parse(row.data)).toEqual({
        parts: [],
        sideChat: { ...side.metadata, sourceTopicId: topic.id, version: 1 }
      })
      expect(
        restored.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'side_chat'").get()
      ).toBeUndefined()
      expect(restored.pragma('foreign_key_check')).toEqual([])
    } finally {
      restored.close()
    }
  })
})
