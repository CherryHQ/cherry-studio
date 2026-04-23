import { groupTable } from '@data/db/schemas/group'
import { GroupService, groupService } from '@data/services/GroupService'
import { DataApiError, ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const GROUP_ID_MISSING = '11111111-1111-4111-8111-111111111111'

describe('GroupService', () => {
  const dbh = setupTestDatabase()

  it('should export a module-level singleton of GroupService', () => {
    expect(groupService).toBeInstanceOf(GroupService)
  })

  describe('create', () => {
    it('should create a group with an auto-assigned orderKey', async () => {
      const result = await groupService.create({ entityType: 'topic', name: 'Research' })

      expect(result).toMatchObject({ entityType: 'topic', name: 'Research' })
      expect(typeof result.orderKey).toBe('string')
      expect(result.orderKey.length).toBeGreaterThan(0)

      const [row] = await dbh.db.select().from(groupTable).where(eq(groupTable.id, result.id))
      expect(row).toMatchObject({ name: 'Research', entityType: 'topic', orderKey: result.orderKey })
    })

    it('should assign strictly increasing orderKeys within the same entityType', async () => {
      const first = await groupService.create({ entityType: 'topic', name: 'alpha' })
      const second = await groupService.create({ entityType: 'topic', name: 'beta' })
      const third = await groupService.create({ entityType: 'topic', name: 'gamma' })

      expect(second.orderKey > first.orderKey).toBe(true)
      expect(third.orderKey > second.orderKey).toBe(true)
    })

    it('should keep orderKey sequences independent across entityTypes', async () => {
      const topicFirst = await groupService.create({ entityType: 'topic', name: 'first-topic' })
      const sessionFirst = await groupService.create({ entityType: 'session', name: 'first-session' })

      // Each entityType starts with the same fractional-indexing starter key
      // because neither bucket has a predecessor.
      expect(topicFirst.orderKey).toBe(sessionFirst.orderKey)
    })

    it('should create knowledge groups', async () => {
      const result = await groupService.create({ entityType: 'knowledge', name: 'Knowledge Group' })

      expect(result).toMatchObject({ entityType: 'knowledge', name: 'Knowledge Group' })
    })
  })

  describe('listByEntityType', () => {
    it('should return groups ordered by orderKey, scoped to the requested entityType', async () => {
      const topicA = await groupService.create({ entityType: 'topic', name: 'A' })
      const topicB = await groupService.create({ entityType: 'topic', name: 'B' })
      await groupService.create({ entityType: 'session', name: 'session-only' })

      const topics = await groupService.listByEntityType('topic')
      expect(topics.map((g) => g.id)).toEqual([topicA.id, topicB.id])
    })

    it('should return an empty array when no groups exist for the entityType', async () => {
      await expect(groupService.listByEntityType('assistant')).resolves.toEqual([])
    })

    it('should list groups for the knowledge entityType', async () => {
      const knowledgeGroup = await groupService.create({ entityType: 'knowledge', name: 'Knowledge Group' })
      await groupService.create({ entityType: 'topic', name: 'Topic Group' })

      await expect(groupService.listByEntityType('knowledge')).resolves.toEqual([knowledgeGroup])
    })
  })

  describe('getById', () => {
    it('should throw NOT_FOUND when the group does not exist', async () => {
      await expect(groupService.getById(GROUP_ID_MISSING)).rejects.toThrow(DataApiError)
      await expect(groupService.getById(GROUP_ID_MISSING)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('update', () => {
    it('should update the name of an existing group', async () => {
      const created = await groupService.create({ entityType: 'topic', name: 'Old' })

      const updated = await groupService.update(created.id, { name: 'New' })

      expect(updated).toMatchObject({ id: created.id, name: 'New', entityType: 'topic' })
    })

    it('should return the current row for an empty update payload', async () => {
      const created = await groupService.create({ entityType: 'topic', name: 'Unchanged' })

      const result = await groupService.update(created.id, {})

      expect(result).toMatchObject({ id: created.id, name: 'Unchanged' })
    })

    it('should throw NOT_FOUND when the group does not exist', async () => {
      await expect(groupService.update(GROUP_ID_MISSING, { name: 'x' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('reorder', () => {
    it("should move a group to the first position via { position: 'first' }", async () => {
      const a = await groupService.create({ entityType: 'topic', name: 'A' })
      const b = await groupService.create({ entityType: 'topic', name: 'B' })
      const c = await groupService.create({ entityType: 'topic', name: 'C' })

      await groupService.reorder(c.id, { position: 'first' })

      const ids = (await groupService.listByEntityType('topic')).map((g) => g.id)
      expect(ids).toEqual([c.id, a.id, b.id])
    })

    it('should move a group to before an anchor', async () => {
      const a = await groupService.create({ entityType: 'topic', name: 'A' })
      const b = await groupService.create({ entityType: 'topic', name: 'B' })
      const c = await groupService.create({ entityType: 'topic', name: 'C' })

      await groupService.reorder(c.id, { before: b.id })

      const ids = (await groupService.listByEntityType('topic')).map((g) => g.id)
      expect(ids).toEqual([a.id, c.id, b.id])
    })

    it('should move a group to after an anchor', async () => {
      const a = await groupService.create({ entityType: 'topic', name: 'A' })
      const b = await groupService.create({ entityType: 'topic', name: 'B' })
      const c = await groupService.create({ entityType: 'topic', name: 'C' })

      await groupService.reorder(a.id, { after: b.id })

      const ids = (await groupService.listByEntityType('topic')).map((g) => g.id)
      expect(ids).toEqual([b.id, a.id, c.id])
    })

    it("should move a group to the last position via { position: 'last' }", async () => {
      const a = await groupService.create({ entityType: 'topic', name: 'A' })
      const b = await groupService.create({ entityType: 'topic', name: 'B' })
      const c = await groupService.create({ entityType: 'topic', name: 'C' })

      await groupService.reorder(a.id, { position: 'last' })

      const ids = (await groupService.listByEntityType('topic')).map((g) => g.id)
      expect(ids).toEqual([b.id, c.id, a.id])
    })

    it('should throw NOT_FOUND when the target id does not exist', async () => {
      await expect(groupService.reorder(GROUP_ID_MISSING, { position: 'first' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('reorderBatch', () => {
    it('should apply multi-move atomically within one entityType', async () => {
      const a = await groupService.create({ entityType: 'topic', name: 'A' })
      const b = await groupService.create({ entityType: 'topic', name: 'B' })
      const c = await groupService.create({ entityType: 'topic', name: 'C' })
      const d = await groupService.create({ entityType: 'topic', name: 'D' })

      await groupService.reorderBatch([
        { id: d.id, anchor: { position: 'first' } },
        { id: a.id, anchor: { position: 'last' } }
      ])

      const ids = (await groupService.listByEntityType('topic')).map((g) => g.id)
      expect(ids).toEqual([d.id, b.id, c.id, a.id])
    })

    it('should reject a batch spanning multiple entityTypes with VALIDATION_ERROR', async () => {
      const topic = await groupService.create({ entityType: 'topic', name: 'topic-group' })
      const session = await groupService.create({ entityType: 'session', name: 'session-group' })

      await expect(
        groupService.reorderBatch([
          { id: topic.id, anchor: { position: 'first' } },
          { id: session.id, anchor: { position: 'first' } }
        ])
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
    })

    it('should throw NOT_FOUND when any move id is unknown', async () => {
      const a = await groupService.create({ entityType: 'topic', name: 'A' })

      await expect(
        groupService.reorderBatch([
          { id: a.id, anchor: { position: 'last' } },
          { id: GROUP_ID_MISSING, anchor: { position: 'first' } }
        ])
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('delete', () => {
    it('should not change orderKeys of sibling groups after a deletion', async () => {
      const a = await groupService.create({ entityType: 'topic', name: 'A' })
      const b = await groupService.create({ entityType: 'topic', name: 'B' })
      const c = await groupService.create({ entityType: 'topic', name: 'C' })

      await groupService.delete(b.id)

      const remaining = await groupService.listByEntityType('topic')
      expect(remaining.map((g) => g.id)).toEqual([a.id, c.id])
      expect(remaining[0].orderKey).toBe(a.orderKey)
      expect(remaining[1].orderKey).toBe(c.orderKey)
    })

    it('should throw NOT_FOUND when the group does not exist', async () => {
      await expect(groupService.delete(GROUP_ID_MISSING)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })
})
