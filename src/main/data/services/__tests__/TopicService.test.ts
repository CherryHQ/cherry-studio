import { messageTable } from '@data/db/schemas/message'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { topicTable } from '@data/db/schemas/topic'
import { topicService } from '@data/services/TopicService'
import { ErrorCode } from '@shared/data/api'
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

  describe('getById', () => {
    it('should surface timestamp anomalies instead of masking them', async () => {
      await dbh.client.execute({
        sql: `INSERT INTO topic (id, name, created_at, updated_at) VALUES (?, ?, NULL, NULL)`,
        args: ['topic-1', 'Broken']
      })

      await expect(topicService.getById('topic-1')).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_SERVER_ERROR
      })
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
