import { assistantTable } from '@data/db/schemas/assistant'
import { groupTable } from '@data/db/schemas/group'
import { messageTable } from '@data/db/schemas/message'
import { pinTable } from '@data/db/schemas/pin'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { topicTable } from '@data/db/schemas/topic'
import { TopicService, topicService } from '@data/services/TopicService'
import { DataApiError, ErrorCode } from '@shared/data/api'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('TopicService', () => {
  const dbh = setupTestDatabase()

  describe('listByCursor', () => {
    it('returns all non-deleted topics across assistants ordered by orderKey', async () => {
      const service = new TopicService()
      // FK: topic.assistantId → assistant.id — seed both assistants first.
      await dbh.db.insert(assistantTable).values([
        { id: 'asst-1', name: 'A', emoji: '🌟', settings: DEFAULT_ASSISTANT_SETTINGS, createdAt: 1, updatedAt: 1 },
        { id: 'asst-2', name: 'B', emoji: '🌟', settings: DEFAULT_ASSISTANT_SETTINGS, createdAt: 1, updatedAt: 1 }
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

    it('orders unpinned topics by updatedAt DESC with id tiebreaker', async () => {
      // Default list-time sort is recency ("most recent activity first") —
      // topic.orderKey is maintained on the row but not consulted here.
      // Without the id tiebreaker, two topics tied on updatedAt would have
      // an undefined relative order and could swap on revalidate.
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'older', name: 'older', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 'tied-b', name: 'tied-b', orderKey: 'a1', createdAt: 1, updatedAt: 200 },
        { id: 'tied-a', name: 'tied-a', orderKey: 'a2', createdAt: 1, updatedAt: 200 },
        { id: 'newest', name: 'newest', orderKey: 'a3', createdAt: 1, updatedAt: 300 }
      ])

      const result = await service.listByCursor()
      expect(result.items.map((t) => t.id)).toEqual(['newest', 'tied-a', 'tied-b', 'older'])
    })

    it('returns pinned topics first, ordered by pin.orderKey, then unpinned by updatedAt DESC', async () => {
      // Two pinned topics + two unpinned. Pin order follows pin.orderKey
      // (user-controlled drag); unpinned section follows updatedAt DESC.
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

    it.each([
      ['100%', ['p100', 'p100x']], // % must match literal %, not anything
      ['a_b', ['a_b']] // _ must match literal _, not any single char
    ])('escapes LIKE wildcards in search filter q=%s', async (q, expected) => {
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'p100', name: '100%', orderKey: 'a0', createdAt: 1, updatedAt: 4 },
        { id: 'p100x', name: '100% off', orderKey: 'a1', createdAt: 1, updatedAt: 3 },
        { id: 'foo', name: 'unrelated', orderKey: 'a2', createdAt: 1, updatedAt: 2 },
        { id: 'a_b', name: 'a_b', orderKey: 'a3', createdAt: 1, updatedAt: 6 },
        { id: 'a-b', name: 'a-b', orderKey: 'a4', createdAt: 1, updatedAt: 5 } // would match 'a_b' if _ were a wildcard
      ])
      const result = await service.listByCursor({ q })
      expect(result.items.map((t) => t.id).sort()).toEqual([...expected].sort())
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

    it.each([
      'gibberish',
      'topic:not-a-number:id',
      'topic:NaN:id',
      'unknown-section:foo',
      'pin' // missing colon
    ])('falls back to first page when cursor is malformed (%s)', async (badCursor) => {
      // A renderer holding a stale cursor from a previous app version should
      // not be locked out — the warn+fallback in decodeCursor returns the
      // first page instead of throwing VALIDATION_ERROR.
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 't1', name: 'T1', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 't2', name: 'T2', orderKey: 'a1', createdAt: 1, updatedAt: 200 }
      ])
      const result = await service.listByCursor({ cursor: badCursor })
      expect(result.items.map((t) => t.id).sort()).toEqual(['t1', 't2'])
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

  describe('reorder', () => {
    /**
     * Seed three topics inside the same group with monotonically increasing
     * orderKeys ('a0' < 'a1' < 'a2'). Tests anchor against this baseline.
     */
    async function seedThree(groupId: string | null = null) {
      await dbh.db.insert(topicTable).values([
        { id: 't1', name: 'A', groupId, orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 't2', name: 'B', groupId, orderKey: 'a1', createdAt: 2, updatedAt: 200 },
        { id: 't3', name: 'C', groupId, orderKey: 'a2', createdAt: 3, updatedAt: 300 }
      ])
    }

    async function getOrderedIds(): Promise<string[]> {
      const rows = await dbh.db.select({ id: topicTable.id }).from(topicTable).orderBy(asc(topicTable.orderKey))
      return rows.map((r) => r.id)
    }

    it('moves a topic to before its predecessor with anchor.before', async () => {
      await seedThree()
      await topicService.reorder('t3', { before: 't1' })
      expect(await getOrderedIds()).toEqual(['t3', 't1', 't2'])
    })

    it('moves a topic to after a successor with anchor.after', async () => {
      await seedThree()
      await topicService.reorder('t1', { after: 't2' })
      expect(await getOrderedIds()).toEqual(['t2', 't1', 't3'])
    })

    it("moves a topic to the head with position: 'first'", async () => {
      await seedThree()
      await topicService.reorder('t3', { position: 'first' })
      expect(await getOrderedIds()).toEqual(['t3', 't1', 't2'])
    })

    it("moves a topic to the tail with position: 'last'", async () => {
      await seedThree()
      await topicService.reorder('t1', { position: 'last' })
      expect(await getOrderedIds()).toEqual(['t2', 't3', 't1'])
    })

    it('throws NOT_FOUND when target id does not exist', async () => {
      await seedThree()
      await expect(topicService.reorder('missing', { position: 'first' })).rejects.toMatchObject({
        name: 'DataApiError',
        code: ErrorCode.NOT_FOUND
      })
    })

    it('throws NOT_FOUND when anchor id does not exist in scope', async () => {
      await seedThree()
      await expect(topicService.reorder('t1', { after: 'missing' })).rejects.toBeInstanceOf(DataApiError)
      await expect(topicService.reorder('t1', { after: 'missing' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('throws VALIDATION_ERROR when anchor equals target', async () => {
      await seedThree()
      await expect(topicService.reorder('t2', { after: 't2' })).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('treats groupId=null and groupId=g1 as independent partitions', async () => {
      await dbh.db.insert(assistantTable).values({
        id: 'asst',
        name: 'A',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db
        .insert(groupTable)
        .values({ id: 'grp', entityType: 'topic', name: 'grp', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(topicTable).values([
        { id: 'n1', name: 'N1', groupId: null, orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'n2', name: 'N2', groupId: null, orderKey: 'a1', createdAt: 2, updatedAt: 2 },
        { id: 'g1', name: 'G1', groupId: 'grp', orderKey: 'a0', createdAt: 3, updatedAt: 3 },
        { id: 'g2', name: 'G2', groupId: 'grp', orderKey: 'a1', createdAt: 4, updatedAt: 4 }
      ])
      // Reorder within the null partition; anchoring against the grp partition must fail with NOT_FOUND.
      await expect(topicService.reorder('n1', { after: 'g1' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
      // Same-scope reorder works.
      await topicService.reorder('n1', { after: 'n2' })
      const nullRows = await dbh.db
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(eq(topicTable.groupId, '__never__'))
      expect(nullRows).toHaveLength(0)
      // Verify n1 now sorts after n2 within the null partition.
      const allRows = await dbh.db
        .select({ id: topicTable.id, groupId: topicTable.groupId, orderKey: topicTable.orderKey })
        .from(topicTable)
        .orderBy(asc(topicTable.orderKey))
      const nullPartition = allRows.filter((r) => r.groupId === null).map((r) => r.id)
      expect(nullPartition).toEqual(['n2', 'n1'])
    })

    it('excludes soft-deleted topics from reorder lookups', async () => {
      await dbh.db.insert(topicTable).values({
        id: 'gone',
        name: 'gone',
        orderKey: 'a0',
        deletedAt: 999,
        createdAt: 1,
        updatedAt: 1
      })
      await expect(topicService.reorder('gone', { position: 'first' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('create', () => {
    it('without sourceNodeId: inserts topic with activeNodeId=null and a fresh orderKey', async () => {
      const result = await topicService.create({ name: 'fresh' })
      expect(result.activeNodeId).toBeNull()
      expect(result.name).toBe('fresh')
      const [row] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, result.id))
      expect(row?.orderKey).toBeDefined()
      expect(row?.orderKey).not.toBe('')
    })

    it('with sourceNodeId: inserts topic pointing to source message', async () => {
      await dbh.db.insert(topicTable).values({ id: 'src-t', name: 'S', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values({
        id: 'src-msg',
        topicId: 'src-t',
        role: 'user',
        data: { blocks: [] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 1,
        updatedAt: 1
      })
      const result = await topicService.create({ name: 'fork', sourceNodeId: 'src-msg' })
      expect(result.activeNodeId).toBe('src-msg')
    })

    it('rejects sourceNodeId pointing to a missing message', async () => {
      await expect(topicService.create({ name: 'fork', sourceNodeId: 'no-such' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('rejects sourceNodeId pointing to a soft-deleted message', async () => {
      await dbh.db.insert(topicTable).values({ id: 'src-t', name: 'S', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values({
        id: 'gone-msg',
        topicId: 'src-t',
        role: 'user',
        data: { blocks: [] },
        status: 'success',
        siblingsGroupId: 0,
        deletedAt: 999,
        createdAt: 1,
        updatedAt: 1
      })
      await expect(topicService.create({ name: 'fork', sourceNodeId: 'gone-msg' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('reorderBatch', () => {
    async function seedFour(groupId: string | null = null) {
      await dbh.db.insert(topicTable).values([
        { id: 't1', name: 'A', groupId, orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 't2', name: 'B', groupId, orderKey: 'a1', createdAt: 2, updatedAt: 200 },
        { id: 't3', name: 'C', groupId, orderKey: 'a2', createdAt: 3, updatedAt: 300 },
        { id: 't4', name: 'D', groupId, orderKey: 'a3', createdAt: 4, updatedAt: 400 }
      ])
    }

    it('empty moves array is a no-op (no DB writes)', async () => {
      await seedFour()
      const before = await dbh.db
        .select({ id: topicTable.id, orderKey: topicTable.orderKey, updatedAt: topicTable.updatedAt })
        .from(topicTable)
      await topicService.reorderBatch([])
      const after = await dbh.db
        .select({ id: topicTable.id, orderKey: topicTable.orderKey, updatedAt: topicTable.updatedAt })
        .from(topicTable)
      expect(after).toEqual(before)
    })

    it('applies multiple moves sequentially in one transaction', async () => {
      await seedFour()
      await topicService.reorderBatch([
        { id: 't4', anchor: { position: 'first' } },
        { id: 't1', anchor: { position: 'last' } }
      ])
      const ids = await dbh.db.select({ id: topicTable.id }).from(topicTable).orderBy(asc(topicTable.orderKey))
      expect(ids.map((r) => r.id)).toEqual(['t4', 't2', 't3', 't1'])
    })

    it('rejects cross-scope batch (mixed groupId) with VALIDATION_ERROR', async () => {
      await dbh.db.insert(groupTable).values([
        { id: 'g1', entityType: 'topic', name: 'g1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'g2', entityType: 'topic', name: 'g2', orderKey: 'a1', createdAt: 2, updatedAt: 2 }
      ])
      await dbh.db.insert(topicTable).values([
        { id: 'a1', name: 'a1', groupId: 'g1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'b1', name: 'b1', groupId: 'g2', orderKey: 'a0', createdAt: 2, updatedAt: 2 }
      ])
      await expect(
        topicService.reorderBatch([
          { id: 'a1', anchor: { position: 'first' } },
          { id: 'b1', anchor: { position: 'first' } }
        ])
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('rejects null↔non-null groupId mix with VALIDATION_ERROR', async () => {
      await dbh.db
        .insert(groupTable)
        .values({ id: 'grp', entityType: 'topic', name: 'grp', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(topicTable).values([
        { id: 'n1', name: 'n1', groupId: null, orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'g1', name: 'g1', groupId: 'grp', orderKey: 'a0', createdAt: 2, updatedAt: 2 }
      ])
      await expect(
        topicService.reorderBatch([
          { id: 'n1', anchor: { position: 'first' } },
          { id: 'g1', anchor: { position: 'first' } }
        ])
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('throws NOT_FOUND when any target id is missing', async () => {
      await seedFour()
      await expect(
        topicService.reorderBatch([
          { id: 't1', anchor: { position: 'first' } },
          { id: 'missing', anchor: { position: 'first' } }
        ])
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('setActiveNode', () => {
    async function seedTopicWithMessages() {
      await dbh.db.insert(topicTable).values({ id: 't1', name: 'T', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values([
        {
          id: 'm1',
          topicId: 't1',
          role: 'user',
          data: { blocks: [] },
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'm2',
          topicId: 't1',
          role: 'assistant',
          data: { blocks: [] },
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 2,
          updatedAt: 2
        }
      ])
    }

    it('happy path: writes activeNodeId', async () => {
      await seedTopicWithMessages()
      const result = await topicService.setActiveNode('t1', 'm2')
      expect(result.activeNodeId).toBe('m2')
      const [row] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 't1'))
      expect(row?.activeNodeId).toBe('m2')
    })

    it('rejects message belonging to a different topic (cross-topic planting guard)', async () => {
      await seedTopicWithMessages()
      await dbh.db.insert(topicTable).values({ id: 't2', name: 'T2', orderKey: 'a1', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values({
        id: 'other',
        topicId: 't2',
        role: 'user',
        data: { blocks: [] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 1,
        updatedAt: 1
      })
      await expect(topicService.setActiveNode('t1', 'other')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('throws NOT_FOUND when nodeId does not exist', async () => {
      await seedTopicWithMessages()
      await expect(topicService.setActiveNode('t1', 'no-such')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('throws NOT_FOUND when topicId does not exist', async () => {
      await expect(topicService.setActiveNode('no-such', 'm1')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('rejects soft-deleted message', async () => {
      await dbh.db.insert(topicTable).values({ id: 't1', name: 'T', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values({
        id: 'm-gone',
        topicId: 't1',
        role: 'user',
        data: { blocks: [] },
        status: 'success',
        siblingsGroupId: 0,
        deletedAt: 999,
        createdAt: 1,
        updatedAt: 1
      })
      await expect(topicService.setActiveNode('t1', 'm-gone')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('rejects soft-deleted topic', async () => {
      await dbh.db.insert(topicTable).values({
        id: 't-gone',
        name: 'T',
        orderKey: 'a0',
        deletedAt: 999,
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db.insert(messageTable).values({
        id: 'm1',
        topicId: 't-gone',
        role: 'user',
        data: { blocks: [] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: 1,
        updatedAt: 1
      })
      await expect(topicService.setActiveNode('t-gone', 'm1')).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })
})
