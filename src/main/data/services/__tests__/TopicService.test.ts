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

  describe('list', () => {
    it('returns topics for assistant excluding soft-deleted', async () => {
      const service = new TopicService()
      const assistantId = 'asst-1'
      await dbh.db.insert(topicTable).values({
        id: 't1',
        name: 'A',
        assistantId,
        sortOrder: 0,
        isPinned: false,
        pinnedOrder: 0,
        createdAt: 1,
        updatedAt: 100
      })
      await dbh.db.insert(topicTable).values({
        id: 't2',
        name: 'B',
        assistantId,
        sortOrder: 1,
        deletedAt: 999,
        isPinned: false,
        pinnedOrder: 0,
        createdAt: 2,
        updatedAt: 200
      })
      await dbh.db.insert(topicTable).values({
        id: 't3',
        name: 'Other',
        assistantId: 'asst-2',
        sortOrder: 0,
        isPinned: false,
        pinnedOrder: 0,
        createdAt: 3,
        updatedAt: 300
      })

      const list = await service.list(assistantId)
      expect(list.map((t) => t.id).sort()).toEqual(['t1'])
    })
  })

  describe('delete', () => {
    it('should remove topic messages and entity tags in one delete flow', async () => {
      await dbh.db.insert(topicTable).values({ id: 'topic-1', name: 'Topic', createdAt: 1, updatedAt: 1 })
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
