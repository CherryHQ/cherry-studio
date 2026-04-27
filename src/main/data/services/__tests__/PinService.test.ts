import { pinTable } from '@data/db/schemas/pin'
import { PinService, pinService } from '@data/services/PinService'
import { DataApiError, ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const PIN_ID_MISSING = '11111111-1111-4111-8111-111111111111'
const ENTITY_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const ENTITY_ID_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const ENTITY_ID_3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const PREEXISTING_PIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MODEL_ID = 'openai::gpt-4o'

describe('PinService', () => {
  const dbh = setupTestDatabase()

  it('should export a module-level singleton of PinService', () => {
    expect(pinService).toBeInstanceOf(PinService)
  })

  describe('pin', () => {
    it('should insert a new row for a fresh (entityType, entityId) pair', async () => {
      const result = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      expect(result).toMatchObject({ entityType: 'topic', entityId: ENTITY_ID_1 })
      expect(typeof result.orderKey).toBe('string')
      expect(result.orderKey.length).toBeGreaterThan(0)

      const [row] = await dbh.db.select().from(pinTable).where(eq(pinTable.id, result.id))
      expect(row).toMatchObject({ entityType: 'topic', entityId: ENTITY_ID_1, orderKey: result.orderKey })
    })

    it('should return the same row on a repeat call (serial idempotency)', async () => {
      const first = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const second = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      expect(second.id).toBe(first.id)
      expect(second.orderKey).toBe(first.orderKey)

      const rows = await dbh.db.select().from(pinTable)
      expect(rows).toHaveLength(1)
    })

    it('should return the pre-existing row when (entityType, entityId) already present', async () => {
      // Seed a row directly to simulate "already pinned before this call runs".
      // Exercises the fast-path SELECT branch of the idempotent pin().
      await dbh.db.insert(pinTable).values({
        id: PREEXISTING_PIN_ID,
        entityType: 'topic',
        entityId: ENTITY_ID_1,
        orderKey: 'a0',
        createdAt: 1_000,
        updatedAt: 1_000
      })

      const result = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      expect(result.id).toBe(PREEXISTING_PIN_ID)
      expect(result.orderKey).toBe('a0')

      const rows = await dbh.db.select().from(pinTable)
      expect(rows).toHaveLength(1)
    })

    it('should return distinct rows for different (entityType, entityId) pairs', async () => {
      const a = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = await pinService.pin({ entityType: 'session', entityId: ENTITY_ID_1 })

      const ids = new Set([a.id, b.id, c.id])
      expect(ids.size).toBe(3)
    })

    it('should maintain independent orderKey sequences per entityType', async () => {
      const topicFirst = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const sessionFirst = await pinService.pin({ entityType: 'session', entityId: ENTITY_ID_1 })

      // Each scope starts from the same fractional-indexing starter key because
      // neither bucket has a predecessor.
      expect(topicFirst.orderKey).toBe(sessionFirst.orderKey)

      const topicSecond = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      expect(topicSecond.orderKey > topicFirst.orderKey).toBe(true)
    })

    it('should accept UniqueModelId values for model pins', async () => {
      const result = await pinService.pin({ entityType: 'model', entityId: MODEL_ID })

      expect(result).toMatchObject({ entityType: 'model', entityId: MODEL_ID })

      const rows = await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, MODEL_ID))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ entityType: 'model', entityId: MODEL_ID })
    })
  })

  describe('unpin', () => {
    it('should hard delete the pin row and return void', async () => {
      const pin = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      await expect(pinService.unpin(pin.id)).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(pinTable).where(eq(pinTable.id, pin.id))
      expect(rows).toHaveLength(0)
    })

    it('should throw NOT_FOUND when the pin id is unknown', async () => {
      await expect(pinService.unpin(PIN_ID_MISSING)).rejects.toThrow(DataApiError)
      await expect(pinService.unpin(PIN_ID_MISSING)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('getById', () => {
    it('should return a fully mapped pin when found', async () => {
      const pin = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      const result = await pinService.getById(pin.id)
      expect(result).toMatchObject({ id: pin.id, entityType: 'topic', entityId: ENTITY_ID_1 })
    })

    it('should throw NOT_FOUND when the pin does not exist', async () => {
      await expect(pinService.getById(PIN_ID_MISSING)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('listByEntityType', () => {
    it('should return pins ordered by orderKey, scoped to the requested entityType', async () => {
      const topicA = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const topicB = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      await pinService.pin({ entityType: 'session', entityId: ENTITY_ID_1 })

      const topics = await pinService.listByEntityType('topic')
      expect(topics.map((p) => p.id)).toEqual([topicA.id, topicB.id])
    })

    it('should return an empty array when no pins exist for the entityType', async () => {
      await expect(pinService.listByEntityType('assistant')).resolves.toEqual([])
    })
  })

  describe('reorder', () => {
    it("should move a pin to the first position via { position: 'first' }", async () => {
      const a = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_3 })

      await pinService.reorder(c.id, { position: 'first' })

      const ids = (await pinService.listByEntityType('topic')).map((p) => p.id)
      expect(ids).toEqual([c.id, a.id, b.id])
    })

    it('should move a pin to before an anchor', async () => {
      const a = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_3 })

      await pinService.reorder(c.id, { before: b.id })

      const ids = (await pinService.listByEntityType('topic')).map((p) => p.id)
      expect(ids).toEqual([a.id, c.id, b.id])
    })

    it('should throw NOT_FOUND when the target id does not exist', async () => {
      await expect(pinService.reorder(PIN_ID_MISSING, { position: 'first' })).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('reorderBatch', () => {
    it('should apply multi-move atomically within one entityType', async () => {
      const a = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_3 })
      const d = await pinService.pin({ entityType: 'topic', entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4' })

      await pinService.reorderBatch([
        { id: d.id, anchor: { position: 'first' } },
        { id: a.id, anchor: { position: 'last' } }
      ])

      const ids = (await pinService.listByEntityType('topic')).map((p) => p.id)
      expect(ids).toEqual([d.id, b.id, c.id, a.id])
    })

    it('should reject a batch spanning multiple entityTypes with VALIDATION_ERROR', async () => {
      const topic = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const session = await pinService.pin({ entityType: 'session', entityId: ENTITY_ID_1 })

      await expect(
        pinService.reorderBatch([
          { id: topic.id, anchor: { position: 'first' } },
          { id: session.id, anchor: { position: 'first' } }
        ])
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
    })

    it('should throw NOT_FOUND when any move id is unknown', async () => {
      const a = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      await expect(
        pinService.reorderBatch([
          { id: a.id, anchor: { position: 'last' } },
          { id: PIN_ID_MISSING, anchor: { position: 'first' } }
        ])
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('purgeForEntity', () => {
    it('should delete only pins targeting the specified (entityType, entityId)', async () => {
      const target = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const siblingSameType = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const sameIdOtherType = await pinService.pin({ entityType: 'session', entityId: ENTITY_ID_1 })

      await pinService.purgeForEntity(dbh.db, 'topic', ENTITY_ID_1)

      const rows = await dbh.db.select().from(pinTable)
      const remainingIds = rows.map((r) => r.id).sort()
      expect(remainingIds).toEqual([siblingSameType.id, sameIdOtherType.id].sort())
      expect(rows.find((r) => r.id === target.id)).toBeUndefined()
    })

    it('should not mutate neighbor orderKeys within the same entityType', async () => {
      const a = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_3 })

      await pinService.purgeForEntity(dbh.db, 'topic', b.entityId)

      const remaining = await pinService.listByEntityType('topic')
      expect(remaining.map((p) => p.id)).toEqual([a.id, c.id])
      expect(remaining[0].orderKey).toBe(a.orderKey)
      expect(remaining[1].orderKey).toBe(c.orderKey)
    })

    it('should be a no-op when no matching pin exists', async () => {
      const existing = await pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      await expect(pinService.purgeForEntity(dbh.db, 'assistant', ENTITY_ID_1)).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(pinTable)
      expect(rows.map((r) => r.id)).toEqual([existing.id])
    })
  })
})
