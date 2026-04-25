import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { pinTable } from '@data/db/schemas/pin'
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

    it('returns pinned topics first, ordered by pin.orderKey, then unpinned by topic.orderKey', async () => {
      // Two pinned topics + two unpinned. Pin order is independent of
      // topic.orderKey: 't-pinned-2' is pinned later (higher pin.orderKey)
      // but its topic.orderKey is 'a0'. Result must show pin section first
      // ordered strictly by pin.orderKey, then unpinned by topic.orderKey.
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 't-pinned-1', name: 'P1', orderKey: 'a3', createdAt: 1, updatedAt: 1 },
        { id: 't-pinned-2', name: 'P2', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 't-unpinned-1', name: 'U1', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
        { id: 't-unpinned-2', name: 'U2', orderKey: 'a2', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(pinTable).values([
        { id: 'pin-1', entityType: 'topic', entityId: 't-pinned-1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'pin-2', entityType: 'topic', entityId: 't-pinned-2', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])

      const result = await service.listByCursor()
      expect(result.items.map((t) => t.id)).toEqual(['t-pinned-1', 't-pinned-2', 't-unpinned-1', 't-unpinned-2'])
      expect(result.nextCursor).toBeUndefined()
    })

    it('paginates pin section then unpinned section via cursor', async () => {
      // limit=2, 3 pinned + 2 unpinned. Page 1 returns 2 pinned with a
      // pin-section cursor. Page 2 returns 1 pinned + 1 unpinned (spillover)
      // with a topic-section cursor. Page 3 returns the last unpinned.
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'p1', name: 'P1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'p2', name: 'P2', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
        { id: 'p3', name: 'P3', orderKey: 'a2', createdAt: 1, updatedAt: 1 },
        { id: 'u1', name: 'U1', orderKey: 'a3', createdAt: 1, updatedAt: 1 },
        { id: 'u2', name: 'U2', orderKey: 'a4', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(pinTable).values([
        { id: 'pin-1', entityType: 'topic', entityId: 'p1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'pin-2', entityType: 'topic', entityId: 'p2', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
        { id: 'pin-3', entityType: 'topic', entityId: 'p3', orderKey: 'a2', createdAt: 1, updatedAt: 1 }
      ])

      const page1 = await service.listByCursor({ limit: 2 })
      expect(page1.items.map((t) => t.id)).toEqual(['p1', 'p2'])
      expect(page1.nextCursor).toBeDefined()

      const page2 = await service.listByCursor({ limit: 2, cursor: page1.nextCursor })
      expect(page2.items.map((t) => t.id)).toEqual(['p3', 'u1'])
      expect(page2.nextCursor).toBeDefined()

      const page3 = await service.listByCursor({ limit: 2, cursor: page2.nextCursor })
      expect(page3.items.map((t) => t.id)).toEqual(['u2'])
      expect(page3.nextCursor).toBeUndefined()
    })

    it('spills partially-filled pin section into unpinned in the same page', async () => {
      // Single pinned topic, limit=3 — pin section fills 1, unpinned fills
      // remaining 2 in the same response (no extra round-trip).
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'p1', name: 'P1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'u1', name: 'U1', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
        { id: 'u2', name: 'U2', orderKey: 'a2', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db
        .insert(pinTable)
        .values({ id: 'pin-1', entityType: 'topic', entityId: 'p1', orderKey: 'a0', createdAt: 1, updatedAt: 1 })

      const result = await service.listByCursor({ limit: 3 })
      expect(result.items.map((t) => t.id)).toEqual(['p1', 'u1', 'u2'])
      expect(result.nextCursor).toBeUndefined()
    })

    it('applies search filter q to both pin and unpinned sections', async () => {
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'p1', name: 'apple pie', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'p2', name: 'banana split', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
        { id: 'u1', name: 'apple juice', orderKey: 'a2', createdAt: 1, updatedAt: 1 },
        { id: 'u2', name: 'cherry tart', orderKey: 'a3', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(pinTable).values([
        { id: 'pin-1', entityType: 'topic', entityId: 'p1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'pin-2', entityType: 'topic', entityId: 'p2', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])

      const result = await service.listByCursor({ q: 'apple' })
      expect(result.items.map((t) => t.id)).toEqual(['p1', 'u1'])
    })

    it('ignores pin rows with entityType other than topic', async () => {
      // Polymorphic pin table — only entityType='topic' should join into the
      // topic listing. A stray pin for a different entityType must not affect
      // the result (or worse, dedupe a topic out of the unpinned section).
      const service = new TopicService()
      await dbh.db.insert(topicTable).values({ id: 't1', name: 'T1', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(pinTable).values({
        id: 'pin-other',
        entityType: 'session',
        entityId: 't1', // accidentally same id, different namespace
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })

      const result = await service.listByCursor()
      expect(result.items.map((t) => t.id)).toEqual(['t1'])
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

    it('purges the pin row when an underlying topic is deleted', async () => {
      // Without purgeForEntity in the delete tx, the pin row would survive
      // and a future POST /pins for the same id would hit the UNIQUE index.
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-1', name: 'Topic', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db
        .insert(pinTable)
        .values({ id: 'pin-1', entityType: 'topic', entityId: 'topic-1', orderKey: 'a0', createdAt: 1, updatedAt: 1 })

      await topicService.delete('topic-1')

      expect(await dbh.db.select().from(pinTable)).toHaveLength(0)
    })
  })
})
