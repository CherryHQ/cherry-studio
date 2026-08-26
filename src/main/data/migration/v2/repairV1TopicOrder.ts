import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { appStateTable } from '@data/db/schemas/appState'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { eq, isNull, sql } from 'drizzle-orm'
import * as z from 'zod'

import { collectV1PinnedTopicOrderIds, collectV1TopicOrderIds, type V1TopicOrderSource } from './utils/v1TopicOrder'

const logger = loggerService.withContext('ChatMigrator')

export const V1_TOPIC_ORDER_REPAIR_KEY = 'chatMigrator:v1TopicOrderRepair'

const V1TopicOrderRepairMarkerSchema = z.strictObject({
  version: z.literal(1),
  source: z.enum(['migration', 'repair', 'skipped'])
})

export type V1TopicOrderRepairSource = z.infer<typeof V1TopicOrderRepairMarkerSchema>['source']

export interface V1TopicOrderRepairResult {
  applied: boolean
  reason: 'already_applied' | 'no_source' | 'no_overlap' | 'repaired'
}

/**
 * Reassign existing orderKeys among Redux-overlapping rows so those ids
 * follow `reduxOrderIds`. Non-overlapping rows keep their keys and slots.
 */
export function permuteOverlappingOrderKeys<T extends { id: string; orderKey: string }>(
  rows: readonly T[],
  getEntityId: (row: T) => string,
  reduxOrderIds: readonly string[]
): Array<{ id: string; orderKey: string }> {
  const byEntityId = new Map<string, T>()
  for (const row of rows) {
    byEntityId.set(getEntityId(row), row)
  }

  const overlapping: T[] = []
  for (const id of reduxOrderIds) {
    const row = byEntityId.get(id)
    if (row) overlapping.push(row)
  }
  if (overlapping.length === 0) return []

  const slots = [...overlapping].sort((left, right) => {
    if (left.orderKey < right.orderKey) return -1
    if (left.orderKey > right.orderKey) return 1
    return left.id.localeCompare(right.id)
  })

  const updates: Array<{ id: string; orderKey: string }> = []
  for (let i = 0; i < overlapping.length; i++) {
    const row = overlapping[i]
    const orderKey = slots[i].orderKey
    if (row.orderKey !== orderKey) {
      updates.push({ id: row.id, orderKey })
    }
  }
  return updates
}

export function writeV1TopicOrderRepairMarker(db: DbOrTx, source: V1TopicOrderRepairSource): void {
  const now = Date.now()
  const value = { version: 1 as const, source }
  db.insert(appStateTable)
    .values({
      key: V1_TOPIC_ORDER_REPAIR_KEY,
      value,
      description: 'One-shot rewrite of overlapping topic/pin orderKey from V1 Redux assistants[].topics[]',
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: appStateTable.key,
      set: {
        value,
        description: 'One-shot rewrite of overlapping topic/pin orderKey from V1 Redux assistants[].topics[]',
        updatedAt: now
      }
    })
    .run()
}

function readRepairMarker(db: DbOrTx): z.infer<typeof V1TopicOrderRepairMarkerSchema> | null {
  const row = db
    .select({ value: appStateTable.value })
    .from(appStateTable)
    .where(eq(appStateTable.key, V1_TOPIC_ORDER_REPAIR_KEY))
    .get()
  const parsed = V1TopicOrderRepairMarkerSchema.safeParse(row?.value)
  return parsed.success ? parsed.data : null
}

function stampOverlappingTopicAndPinOrder(
  db: DbOrTx,
  reduxOrderIds: readonly string[],
  reduxPinnedOrderIds: readonly string[]
): { topicIds: string[]; pinIds: string[]; pinnedEntityIds: string[] } {
  const topics = db
    .select({ id: topicTable.id, orderKey: topicTable.orderKey })
    .from(topicTable)
    .where(isNull(topicTable.deletedAt))
    .all()
  const topicUpdates = permuteOverlappingOrderKeys(topics, (topic) => topic.id, reduxOrderIds)
  for (const update of topicUpdates) {
    db.update(topicTable)
      .set({
        orderKey: update.orderKey,
        updatedAt: sql`${topicTable.updatedAt}`
      })
      .where(eq(topicTable.id, update.id))
      .run()
  }

  const pins = db
    .select({ id: pinTable.id, entityId: pinTable.entityId, orderKey: pinTable.orderKey })
    .from(pinTable)
    .where(eq(pinTable.entityType, 'topic'))
    .all()
  // Only V1 `pinned === true` ids. A V1 topic pinned after migration stays put.
  const pinUpdates = permuteOverlappingOrderKeys(pins, (pin) => pin.entityId, reduxPinnedOrderIds)
  for (const update of pinUpdates) {
    db.update(pinTable)
      .set({
        orderKey: update.orderKey,
        updatedAt: sql`${pinTable.updatedAt}`
      })
      .where(eq(pinTable.id, update.id))
      .run()
  }

  const liveIds = new Set(topics.map((topic) => topic.id))
  const topicIds = reduxOrderIds.filter((id) => liveIds.has(id))
  const pinByEntityId = new Map(pins.map((pin) => [pin.entityId, pin.id]))
  const pinIds: string[] = []
  const pinnedEntityIds: string[] = []
  for (const id of reduxPinnedOrderIds) {
    const pinId = pinByEntityId.get(id)
    if (!pinId) continue
    pinIds.push(pinId)
    pinnedEntityIds.push(id)
  }

  return { topicIds, pinIds, pinnedEntityIds }
}

function notifyRepairedOrder(topicIds: string[], pinIds: string[], pinnedEntityIds: string[]): void {
  const effects: DataApiDataChangeEffect[] = [
    { endpoint: '/topics', kind: 'projection', entityIds: topicIds },
    { endpoint: '/topics', kind: 'order', dimension: 'orderKey', entityIds: topicIds }
  ]
  if (pinIds.length > 0) {
    effects.push(
      { endpoint: '/pins', kind: 'order', dimension: 'orderKey', entityIds: pinIds },
      { endpoint: '/topics', kind: 'order', dimension: 'pinned', entityIds: pinnedEntityIds }
    )
  }
  notifyDataApiDataChange(effects)
}

/**
 * Rewrite already-migrated overlapping topic orderKeys from preserved V1
 * Redux order, and pin orderKeys only for first-write `pinned === true`.
 * V2-only rows and V2-created pins keep their keys. No-ops when the marker
 * exists, when Redux has no topic ids, or when none of those ids exist in SQLite.
 */
export function repairMigratedV1TopicOrder(source: V1TopicOrderSource): V1TopicOrderRepairResult {
  const result = application.get('DbService').withWriteTx((tx) => {
    if (readRepairMarker(tx)) {
      return { applied: false as const, reason: 'already_applied' as const }
    }

    const reduxOrderIds = collectV1TopicOrderIds(source)
    if (reduxOrderIds.length === 0) {
      writeV1TopicOrderRepairMarker(tx, 'skipped')
      logger.info('V1 topic-order repair skipped: no Redux topic sequence')
      return { applied: false as const, reason: 'no_source' as const }
    }

    const liveIds = new Set(
      tx
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(isNull(topicTable.deletedAt))
        .all()
        .map((row) => row.id)
    )
    const overlap = reduxOrderIds.some((id) => liveIds.has(id))
    if (!overlap) {
      writeV1TopicOrderRepairMarker(tx, 'skipped')
      logger.info('V1 topic-order repair skipped: Redux sequence has no SQLite overlap')
      return { applied: false as const, reason: 'no_overlap' as const }
    }

    const stamped = stampOverlappingTopicAndPinOrder(tx, reduxOrderIds, collectV1PinnedTopicOrderIds(source))
    writeV1TopicOrderRepairMarker(tx, 'repair')
    logger.info('Permuted overlapping topic/pin order from V1 Redux assistants[].topics[]', {
      reduxTopicCount: reduxOrderIds.length,
      overlappingTopicCount: stamped.topicIds.length
    })
    return { applied: true as const, reason: 'repaired' as const, ...stamped }
  })

  if (result.applied) {
    notifyRepairedOrder(result.topicIds, result.pinIds, result.pinnedEntityIds)
  }
  return { applied: result.applied, reason: result.reason }
}
