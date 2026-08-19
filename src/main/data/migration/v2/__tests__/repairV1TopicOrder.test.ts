import { appStateTable } from '@data/db/schemas/appState'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { repairMigratedV1TopicOrder, V1_TOPIC_ORDER_REPAIR_KEY } = await import('../repairV1TopicOrder')

describe('repairMigratedV1TopicOrder', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
  })

  function seedTopic(id: string, orderKey: string, updatedAt: number): void {
    dbh.db
      .insert(topicTable)
      .values({
        id,
        name: id,
        isNameManuallyEdited: false,
        assistantId: null,
        activeNodeId: null,
        orderKey,
        lastActivityAt: updatedAt,
        createdAt: updatedAt,
        updatedAt
      })
      .run()
  }

  function seedPin(id: string, entityId: string, orderKey: string): void {
    dbh.db
      .insert(pinTable)
      .values({
        id,
        entityType: 'topic',
        entityId,
        orderKey,
        createdAt: 1,
        updatedAt: 1
      })
      .run()
  }

  function topicIdsByOrder(): string[] {
    return dbh.db
      .select({ id: topicTable.id })
      .from(topicTable)
      .orderBy(asc(topicTable.orderKey), asc(topicTable.id))
      .all()
      .map((row) => row.id)
  }

  function pinIdsByOrder(): string[] {
    return dbh.db
      .select({ entityId: pinTable.entityId })
      .from(pinTable)
      .where(eq(pinTable.entityType, 'topic'))
      .orderBy(asc(pinTable.orderKey), asc(pinTable.id))
      .all()
      .map((row) => row.entityId)
  }

  it('rewrites recency-stamped keys to Redux [C,A,B] including pin order and a Dexie leftover', () => {
    seedTopic('t-c', 'a2', 100)
    seedTopic('t-a', 'a1', 200)
    seedTopic('t-b', 'a0', 300)
    seedTopic('t-dexie', 'a3', 50)
    seedPin('pin-b', 't-b', 'a0')
    seedPin('pin-c', 't-c', 'a1')

    expect(
      repairMigratedV1TopicOrder({
        assistants: [{ topics: [{ id: 't-c' }, { id: 't-a' }, { id: 't-b' }] }]
      })
    ).toEqual({ applied: true, reason: 'repaired' })

    expect(topicIdsByOrder()).toEqual(['t-c', 't-a', 't-b', 't-dexie'])
    expect(pinIdsByOrder()).toEqual(['t-c', 't-b'])
    expect(new Set(topicIdsByOrder()).size).toBe(4)
    expect(
      dbh.db.select().from(appStateTable).where(eq(appStateTable.key, V1_TOPIC_ORDER_REPAIR_KEY)).get()?.value
    ).toEqual({
      version: 1,
      source: 'repair'
    })
  })

  it('is a no-op on the second run', () => {
    seedTopic('t-c', 'a2', 100)
    seedTopic('t-a', 'a1', 200)
    seedTopic('t-b', 'a0', 300)

    expect(
      repairMigratedV1TopicOrder({
        assistants: [{ topics: [{ id: 't-c' }, { id: 't-a' }, { id: 't-b' }] }]
      })
    ).toEqual({ applied: true, reason: 'repaired' })
    const firstKeys = dbh.db.select({ id: topicTable.id, orderKey: topicTable.orderKey }).from(topicTable).all()

    expect(
      repairMigratedV1TopicOrder({
        assistants: [{ topics: [{ id: 't-b' }, { id: 't-a' }, { id: 't-c' }] }]
      })
    ).toEqual({ applied: false, reason: 'already_applied' })
    expect(dbh.db.select({ id: topicTable.id, orderKey: topicTable.orderKey }).from(topicTable).all()).toEqual(
      firstKeys
    )
    expect(topicIdsByOrder()).toEqual(['t-c', 't-a', 't-b'])
  })

  it('does not invent an order when Redux has no topic ids', () => {
    seedTopic('t-b', 'a0', 300)
    seedTopic('t-a', 'a1', 200)

    expect(repairMigratedV1TopicOrder({})).toEqual({ applied: false, reason: 'no_source' })
    expect(topicIdsByOrder()).toEqual(['t-b', 't-a'])
    expect(
      dbh.db.select().from(appStateTable).where(eq(appStateTable.key, V1_TOPIC_ORDER_REPAIR_KEY)).get()?.value
    ).toEqual({
      version: 1,
      source: 'skipped'
    })
  })

  it('does not rewrite leftover-only SQLite rows when Redux ids do not overlap', () => {
    seedTopic('t-native', 'a0', 1)

    expect(
      repairMigratedV1TopicOrder({
        assistants: [{ topics: [{ id: 't-c' }, { id: 't-a' }] }]
      })
    ).toEqual({ applied: false, reason: 'no_overlap' })
    expect(topicIdsByOrder()).toEqual(['t-native'])
  })

  it('rolls back key rewrites when the marker write fails', () => {
    seedTopic('t-c', 'a2', 100)
    seedTopic('t-a', 'a1', 200)
    seedTopic('t-b', 'a0', 300)
    dbh.sqlite.exec(
      `CREATE TRIGGER v1_topic_order_sabotage BEFORE INSERT ON app_state
       BEGIN SELECT RAISE(ABORT, 'repair sabotage'); END`
    )

    try {
      expect(() =>
        repairMigratedV1TopicOrder({
          assistants: [{ topics: [{ id: 't-c' }, { id: 't-a' }, { id: 't-b' }] }]
        })
      ).toThrow('repair sabotage')
      expect(topicIdsByOrder()).toEqual(['t-b', 't-a', 't-c'])
      expect(
        dbh.db.select().from(appStateTable).where(eq(appStateTable.key, V1_TOPIC_ORDER_REPAIR_KEY)).get()
      ).toBeUndefined()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER v1_topic_order_sabotage')
    }
  })
})
