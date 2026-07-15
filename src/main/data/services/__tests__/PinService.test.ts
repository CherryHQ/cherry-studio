import { pinTable } from '@data/db/schemas/pin'
import { PinService, pinService } from '@data/services/PinService'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const PIN_ID_MISSING = '11111111-1111-4111-8111-111111111111'
const ENTITY_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const ENTITY_ID_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const ENTITY_ID_3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const PREEXISTING_PIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MODEL_ID = 'openai::gpt-4o'
const AGENT_ID = 'agent_1700000000000_abc123xyz'

describe('PinService', () => {
  const dbh = setupTestDatabase()

  it('should export a module-level singleton of PinService', () => {
    expect(pinService).toBeInstanceOf(PinService)
  })

  describe('pin', () => {
    it('should insert a new row for a fresh (entityType, entityId) pair', async () => {
      const result = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      expect(result).toMatchObject({ entityType: 'topic', entityId: ENTITY_ID_1 })
      expect(typeof result.orderKey).toBe('string')
      expect(result.orderKey.length).toBeGreaterThan(0)

      const [row] = await dbh.db.select().from(pinTable).where(eq(pinTable.id, result.id))
      expect(row).toMatchObject({ entityType: 'topic', entityId: ENTITY_ID_1, orderKey: result.orderKey })
    })

    it('should return the same row on a repeat call (serial idempotency)', async () => {
      const first = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const second = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

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

      const result = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      expect(result.id).toBe(PREEXISTING_PIN_ID)
      expect(result.orderKey).toBe('a0')

      const rows = await dbh.db.select().from(pinTable)
      expect(rows).toHaveLength(1)
    })

    it('should return distinct rows for different (entityType, entityId) pairs', async () => {
      const a = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = pinService.pin({ entityType: 'assistant', entityId: ENTITY_ID_1 })

      const ids = new Set([a.id, b.id, c.id])
      expect(ids.size).toBe(3)
    })

    it('should prepend topic/session pins while other entity types append', async () => {
      const topicFirst = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const assistantFirst = pinService.pin({ entityType: 'assistant', entityId: ENTITY_ID_1 })

      // Each scope starts from the same fractional-indexing starter key because
      // neither bucket has a predecessor.
      expect(topicFirst.orderKey).toBe(assistantFirst.orderKey)

      const topicSecond = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      expect(topicSecond.orderKey < topicFirst.orderKey).toBe(true)

      const assistantSecond = pinService.pin({ entityType: 'assistant', entityId: ENTITY_ID_2 })
      expect(assistantSecond.orderKey > assistantFirst.orderKey).toBe(true)
    })

    it('should accept UniqueModelId values for model pins', async () => {
      const result = pinService.pin({ entityType: 'model', entityId: MODEL_ID })

      expect(result).toMatchObject({ entityType: 'model', entityId: MODEL_ID })

      const rows = await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, MODEL_ID))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ entityType: 'model', entityId: MODEL_ID })
    })

    it('should accept persisted non-UUID agent ids for agent pins', async () => {
      const result = pinService.pin({ entityType: 'agent', entityId: AGENT_ID })

      expect(result).toMatchObject({ entityType: 'agent', entityId: AGENT_ID })
    })
  })

  describe('unpin', () => {
    it('should hard delete the pin row and return void', async () => {
      const pin = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      expect(pinService.unpin(pin.id)).toBeUndefined()

      const rows = await dbh.db.select().from(pinTable).where(eq(pinTable.id, pin.id))
      expect(rows).toHaveLength(0)
    })

    it('should throw NOT_FOUND when the pin id is unknown', async () => {
      expect(() => pinService.unpin(PIN_ID_MISSING)).toThrow(DataApiError)
      let err: unknown
      try {
        pinService.unpin(PIN_ID_MISSING)
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('getById', () => {
    it('should return a fully mapped pin when found', async () => {
      const pin = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      const result = pinService.getById(pin.id)
      expect(result).toMatchObject({ id: pin.id, entityType: 'topic', entityId: ENTITY_ID_1 })
    })

    it('should throw NOT_FOUND when the pin does not exist', async () => {
      let err: unknown
      try {
        pinService.getById(PIN_ID_MISSING)
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('listByEntityType', () => {
    it('should return newest pins first by orderKey within the requested entityType', async () => {
      const topicA = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const topicB = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      pinService.pin({ entityType: 'assistant', entityId: ENTITY_ID_1 })

      const topics = pinService.listByEntityType('topic')
      expect(topics.map((p) => p.id)).toEqual([topicB.id, topicA.id])
    })

    it('should return an empty array when no pins exist for the entityType', async () => {
      expect(pinService.listByEntityType('assistant')).toEqual([])
    })
  })

  describe('reorder', () => {
    it("should move a pin to the first position via { position: 'first' }", async () => {
      const a = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_3 })

      pinService.reorder(a.id, { position: 'first' })

      const ids = pinService.listByEntityType('topic').map((p) => p.id)
      expect(ids).toEqual([a.id, c.id, b.id])
    })

    it('should move a pin to before an anchor', async () => {
      const a = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_3 })

      pinService.reorder(a.id, { before: b.id })

      const ids = pinService.listByEntityType('topic').map((p) => p.id)
      expect(ids).toEqual([c.id, a.id, b.id])
    })

    it('should throw NOT_FOUND when the target id does not exist', async () => {
      let err: unknown
      try {
        pinService.reorder(PIN_ID_MISSING, { position: 'first' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('reorderBatch', () => {
    it('should apply multi-move atomically within one entityType', async () => {
      const a = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_3 })
      const d = pinService.pin({ entityType: 'topic', entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4' })

      pinService.reorderBatch([
        { id: d.id, anchor: { position: 'last' } },
        { id: a.id, anchor: { position: 'first' } }
      ])

      const ids = pinService.listByEntityType('topic').map((p) => p.id)
      expect(ids).toEqual([a.id, c.id, b.id, d.id])
    })

    it('should reject a batch spanning multiple entityTypes with VALIDATION_ERROR', async () => {
      const topic = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const assistant = pinService.pin({ entityType: 'assistant', entityId: ENTITY_ID_1 })

      let err: unknown
      try {
        pinService.reorderBatch([
          { id: topic.id, anchor: { position: 'first' } },
          { id: assistant.id, anchor: { position: 'first' } }
        ])
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
    })

    it('should throw NOT_FOUND when any move id is unknown', async () => {
      const a = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      let err: unknown
      try {
        pinService.reorderBatch([
          { id: a.id, anchor: { position: 'last' } },
          { id: PIN_ID_MISSING, anchor: { position: 'first' } }
        ])
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('purgeForEntityTx', () => {
    it('should delete only pins targeting the specified (entityType, entityId)', async () => {
      const target = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const siblingSameType = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const sameIdOtherType = pinService.pin({ entityType: 'assistant', entityId: ENTITY_ID_1 })

      pinService.purgeForEntityTx(dbh.db, 'topic', ENTITY_ID_1)

      const rows = await dbh.db.select().from(pinTable)
      const remainingIds = rows.map((r) => r.id).sort()
      expect(remainingIds).toEqual([siblingSameType.id, sameIdOtherType.id].sort())
      expect(rows.find((r) => r.id === target.id)).toBeUndefined()
    })

    it('should not mutate neighbor orderKeys within the same entityType', async () => {
      const a = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_3 })

      pinService.purgeForEntityTx(dbh.db, 'topic', b.entityId)

      const remaining = pinService.listByEntityType('topic')
      expect(remaining.map((p) => p.id)).toEqual([c.id, a.id])
      expect(remaining[0].orderKey).toBe(c.orderKey)
      expect(remaining[1].orderKey).toBe(a.orderKey)
    })

    it('should be a no-op when no matching pin exists', async () => {
      const existing = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      expect(pinService.purgeForEntityTx(dbh.db, 'assistant', ENTITY_ID_1)).toBeUndefined()

      const rows = await dbh.db.select().from(pinTable)
      expect(rows.map((r) => r.id)).toEqual([existing.id])
    })
  })

  describe('purgeForEntitiesTx', () => {
    it('should be a no-op when entityIds is empty', async () => {
      const seeded = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })

      expect(pinService.purgeForEntitiesTx(dbh.db, 'topic', [])).toBeUndefined()

      const rows = await dbh.db.select().from(pinTable)
      expect(rows.map((r) => r.id)).toEqual([seeded.id])
    })

    it('should be equivalent to purgeForEntityTx for a single id', async () => {
      const target = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const sibling = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })

      pinService.purgeForEntitiesTx(dbh.db, 'topic', [target.entityId])

      const rows = await dbh.db.select().from(pinTable)
      expect(rows.map((r) => r.id)).toEqual([sibling.id])
    })

    it('should bulk-delete only the listed ids and leave other entityTypes alone', async () => {
      const a = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_3 })
      const sameIdOtherType = pinService.pin({ entityType: 'assistant', entityId: ENTITY_ID_1 })

      pinService.purgeForEntitiesTx(dbh.db, 'topic', [a.entityId, b.entityId])

      const rows = await dbh.db.select().from(pinTable)
      const remainingIds = rows.map((r) => r.id).sort()
      expect(remainingIds).toEqual([c.id, sameIdOtherType.id].sort())
    })

    it('should not mutate neighbor orderKeys for survivors within the same entityType', async () => {
      const a = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_1 })
      const b = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_2 })
      const c = pinService.pin({ entityType: 'topic', entityId: ENTITY_ID_3 })

      pinService.purgeForEntitiesTx(dbh.db, 'topic', [b.entityId])

      const remaining = pinService.listByEntityType('topic')
      expect(remaining.map((p) => p.id)).toEqual([c.id, a.id])
      expect(remaining[0].orderKey).toBe(c.orderKey)
      expect(remaining[1].orderKey).toBe(a.orderKey)
    })
  })
})
