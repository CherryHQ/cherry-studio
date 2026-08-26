import { appStateTable } from '@data/db/schemas/appState'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { and, asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('@data/dataApiDataChange', () => ({
  notifyDataApiDataChange: notifyDataApiDataChangeMock
}))

const { permuteOverlappingOrderKeys, repairMigratedV1TopicOrder, V1_TOPIC_ORDER_REPAIR_KEY } = await import(
  '../repairV1TopicOrder'
)

describe('permuteOverlappingOrderKeys', () => {
  it('reassigns only overlapping slots in Redux order', () => {
    expect(
      permuteOverlappingOrderKeys(
        [
          { id: 't-e', orderKey: 'a0' },
          { id: 't-b', orderKey: 'a1' },
          { id: 't-d', orderKey: 'a2' },
          { id: 't-a', orderKey: 'a3' },
          { id: 't-f', orderKey: 'a4' },
          { id: 't-c', orderKey: 'a5' },
          { id: 't-g', orderKey: 'a6' }
        ],
        (row) => row.id,
        ['t-c', 't-a', 't-b']
      )
    ).toEqual([
      { id: 't-c', orderKey: 'a1' },
      { id: 't-b', orderKey: 'a5' }
    ])
  })
})

describe('repairMigratedV1TopicOrder', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
    notifyDataApiDataChangeMock.mockClear()
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

  function topicKey(id: string): string {
    const row = dbh.db.select({ orderKey: topicTable.orderKey }).from(topicTable).where(eq(topicTable.id, id)).get()
    if (!row) throw new Error(`missing topic ${id}`)
    return row.orderKey
  }

  function pinKey(entityId: string): string {
    const row = dbh.db
      .select({ orderKey: pinTable.orderKey })
      .from(pinTable)
      .where(and(eq(pinTable.entityType, 'topic'), eq(pinTable.entityId, entityId)))
      .get()
    if (!row) throw new Error(`missing pin ${entityId}`)
    return row.orderKey
  }

  it('permutes only Redux-overlapping ids and keeps interleaved V2 rows in place', () => {
    seedTopic('t-e', 'a0', 500)
    seedTopic('t-b', 'a1', 300)
    seedTopic('t-d', 'a2', 400)
    seedTopic('t-a', 'a3', 200)
    seedTopic('t-f', 'a4', 450)
    seedTopic('t-c', 'a5', 100)
    seedTopic('t-g', 'a6', 50)
    seedPin('pin-e', 't-e', 'p0')
    seedPin('pin-b', 't-b', 'p1')
    seedPin('pin-a', 't-a', 'p2')
    seedPin('pin-c', 't-c', 'p3')

    expect(
      repairMigratedV1TopicOrder({
        assistants: [
          {
            topics: [
              { id: 't-c', pinned: true },
              { id: 't-a', pinned: true },
              { id: 't-b', pinned: true }
            ]
          }
        ]
      })
    ).toEqual({ applied: true, reason: 'repaired' })

    expect(topicIdsByOrder()).toEqual(['t-e', 't-c', 't-d', 't-a', 't-f', 't-b', 't-g'])
    expect(topicKey('t-e')).toBe('a0')
    expect(topicKey('t-d')).toBe('a2')
    expect(topicKey('t-f')).toBe('a4')
    expect(topicKey('t-g')).toBe('a6')
    expect(pinIdsByOrder()).toEqual(['t-e', 't-c', 't-a', 't-b'])
    expect(new Set(topicIdsByOrder()).size).toBe(7)
    expect(
      dbh.db.select().from(appStateTable).where(eq(appStateTable.key, V1_TOPIC_ORDER_REPAIR_KEY)).get()?.value
    ).toEqual({
      version: 1,
      source: 'repair'
    })
  })

  it('restores V1 pin order without moving a V1 topic the user pinned after migration', () => {
    seedTopic('t-b', 'a0', 300)
    seedTopic('t-a', 'a1', 200)
    seedTopic('t-c', 'a2', 100)
    seedTopic('t-v2', 'a3', 400)
    seedPin('pin-b', 't-b', 'p0')
    seedPin('pin-a', 't-a', 'p1')
    seedPin('pin-c', 't-c', 'p2')
    seedPin('pin-v2', 't-v2', 'p3')

    expect(
      repairMigratedV1TopicOrder({
        assistants: [
          {
            topics: [{ id: 't-c', pinned: true }, { id: 't-a', pinned: true }, { id: 't-b' }]
          }
        ]
      })
    ).toEqual({ applied: true, reason: 'repaired' })

    expect(topicIdsByOrder()).toEqual(['t-c', 't-a', 't-b', 't-v2'])
    expect(pinIdsByOrder()).toEqual(['t-b', 't-c', 't-a', 't-v2'])
    expect(pinKey('t-b')).toBe('p0')
    expect(pinKey('t-v2')).toBe('p3')
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
      { endpoint: '/topics', kind: 'projection', entityIds: ['t-c', 't-a', 't-b'] },
      { endpoint: '/topics', kind: 'order', dimension: 'orderKey', entityIds: ['t-c', 't-a', 't-b'] },
      { endpoint: '/pins', kind: 'order', dimension: 'orderKey', entityIds: ['pin-c', 'pin-a'] },
      { endpoint: '/topics', kind: 'order', dimension: 'pinned', entityIds: ['t-c', 't-a'] }
    ])
  })

  it('notifies /topics and /pins after a successful repair commit', () => {
    seedTopic('t-c', 'a2', 100)
    seedTopic('t-a', 'a1', 200)
    seedTopic('t-b', 'a0', 300)
    seedPin('pin-b', 't-b', 'p0')
    seedPin('pin-c', 't-c', 'p1')

    expect(
      repairMigratedV1TopicOrder({
        assistants: [
          {
            topics: [{ id: 't-c', pinned: true }, { id: 't-a' }, { id: 't-b', pinned: true }]
          }
        ]
      })
    ).toEqual({ applied: true, reason: 'repaired' })

    expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
      { endpoint: '/topics', kind: 'projection', entityIds: ['t-c', 't-a', 't-b'] },
      { endpoint: '/topics', kind: 'order', dimension: 'orderKey', entityIds: ['t-c', 't-a', 't-b'] },
      { endpoint: '/pins', kind: 'order', dimension: 'orderKey', entityIds: ['pin-c', 'pin-b'] },
      { endpoint: '/topics', kind: 'order', dimension: 'pinned', entityIds: ['t-c', 't-b'] }
    ])
  })

  it('is a no-op on the second run and does not notify again', () => {
    seedTopic('t-c', 'a2', 100)
    seedTopic('t-a', 'a1', 200)
    seedTopic('t-b', 'a0', 300)

    expect(
      repairMigratedV1TopicOrder({
        assistants: [{ topics: [{ id: 't-c' }, { id: 't-a' }, { id: 't-b' }] }]
      })
    ).toEqual({ applied: true, reason: 'repaired' })
    const firstKeys = dbh.db.select({ id: topicTable.id, orderKey: topicTable.orderKey }).from(topicTable).all()
    notifyDataApiDataChangeMock.mockClear()

    expect(
      repairMigratedV1TopicOrder({
        assistants: [{ topics: [{ id: 't-b' }, { id: 't-a' }, { id: 't-c' }] }]
      })
    ).toEqual({ applied: false, reason: 'already_applied' })
    expect(dbh.db.select({ id: topicTable.id, orderKey: topicTable.orderKey }).from(topicTable).all()).toEqual(
      firstKeys
    )
    expect(topicIdsByOrder()).toEqual(['t-c', 't-a', 't-b'])
    expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
  })

  it('does not invent an order or notify when Redux has no topic ids', () => {
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
    expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
  })

  it('does not rewrite leftover-only SQLite rows when Redux ids do not overlap', () => {
    seedTopic('t-native', 'a0', 1)

    expect(
      repairMigratedV1TopicOrder({
        assistants: [{ topics: [{ id: 't-c' }, { id: 't-a' }] }]
      })
    ).toEqual({ applied: false, reason: 'no_overlap' })
    expect(topicIdsByOrder()).toEqual(['t-native'])
    expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
  })

  it('rolls back key rewrites and does not notify when the marker write fails', () => {
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
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER v1_topic_order_sabotage')
    }
  })
})
