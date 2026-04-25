import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { topicTable } from '@data/db/schemas/topic'
import { TopicService, topicService } from '@data/services/TopicService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../MessageService', () => ({
  messageService: {
    getById: vi.fn(),
    getPathToNode: vi.fn()
  }
}))

describe('TopicService', () => {
  const dbh = setupTestDatabase()

  describe('listByCursor', () => {
    it('returns all non-deleted topics across assistants ordered by orderKey', async () => {
      const service = new TopicService()
      // FK: topic.assistantId → assistant.id — seed both assistants first.
      await dbh.db.insert(assistantTable).values([
        { id: 'asst-1', name: 'A', createdAt: 1, updatedAt: 1 },
        { id: 'asst-2', name: 'B', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(topicTable).values({
        id: 't1',
        name: 'A',
        assistantId: 'asst-1',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 100
      })
      // Soft-deleted row — must be excluded.
      await dbh.db.insert(topicTable).values({
        id: 't2',
        name: 'B',
        assistantId: 'asst-1',
        orderKey: 'a1',
        deletedAt: 999,
        createdAt: 2,
        updatedAt: 200
      })
      // Different assistant — must still be returned (client filters by assistantId).
      await dbh.db.insert(topicTable).values({
        id: 't3',
        name: 'Other',
        assistantId: 'asst-2',
        orderKey: 'a2',
        createdAt: 3,
        updatedAt: 300
      })

      const result = await service.listByCursor()
      expect(result.items.map((t) => t.id).sort()).toEqual(['t1', 't3'])
      expect(result.nextCursor).toBeUndefined()
    })
  })

  describe('delete', () => {
    it('should remove topic messages and entity tags in one delete flow', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-1', name: 'Topic', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values({
        topicId: 'topic-1',
        role: 'user',
        data: { blocks: [] } as never,
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db.insert(tagTable).values({ id: 'tag-1', name: 'work', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(entityTagTable).values({
        entityType: 'topic',
        entityId: 'topic-1',
        tagId: 'tag-1',
        createdAt: 1,
        updatedAt: 1
      })

      await topicService.delete('topic-1')

      expect(await dbh.db.select().from(topicTable)).toHaveLength(0)
      expect(await dbh.db.select().from(messageTable)).toHaveLength(0)
      expect(await dbh.db.select().from(entityTagTable)).toHaveLength(0)
    })
  })
})
