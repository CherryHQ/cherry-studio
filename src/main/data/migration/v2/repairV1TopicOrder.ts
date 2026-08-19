import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { eq, sql } from 'drizzle-orm'
import * as z from 'zod'

import { assignOrderKeysInSequence } from './utils/orderKey'
import {
  collectV1TopicOrderIds,
  compareTopicLeftoversByUpdatedAtThenId,
  orderItemsByV1TopicSequence,
  type V1TopicOrderSource
} from './utils/v1TopicOrder'

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

function comparePinLeftoversByEntityId(a: { entityId: string }, b: { entityId: string }): number {
  return a.entityId.localeCompare(b.entityId)
}

export function writeV1TopicOrderRepairMarker(db: DbOrTx, source: V1TopicOrderRepairSource): void {
  const now = Date.now()
  const value = { version: 1 as const, source }
  db.insert(appStateTable)
    .values({
      key: V1_TOPIC_ORDER_REPAIR_KEY,
      value,
      description: 'One-shot rewrite of topic/pin orderKey from V1 Redux assistants[].topics[]',
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: appStateTable.key,
      set: {
        value,
        description: 'One-shot rewrite of topic/pin orderKey from V1 Redux assistants[].topics[]',
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

function stampTopicAndPinOrder(db: DbOrTx, reduxOrderIds: readonly string[]): void {
  const topics = db.select({ id: topicTable.id, updatedAt: topicTable.updatedAt }).from(topicTable).all()
  const stampedTopics = assignOrderKeysInSequence(
    orderItemsByV1TopicSequence(topics, (topic) => topic.id, reduxOrderIds, compareTopicLeftoversByUpdatedAtThenId)
  )
  for (const topic of stampedTopics) {
    db.update(topicTable)
      .set({
        orderKey: topic.orderKey,
        updatedAt: sql`${topicTable.updatedAt}`
      })
      .where(eq(topicTable.id, topic.id))
      .run()
  }

  const pins = db
    .select({ id: pinTable.id, entityId: pinTable.entityId })
    .from(pinTable)
    .where(eq(pinTable.entityType, 'topic'))
    .all()
  const stampedPins = assignOrderKeysInSequence(
    orderItemsByV1TopicSequence(pins, (pin) => pin.entityId, reduxOrderIds, comparePinLeftoversByEntityId)
  )
  for (const pin of stampedPins) {
    db.update(pinTable)
      .set({
        orderKey: pin.orderKey,
        updatedAt: sql`${pinTable.updatedAt}`
      })
      .where(eq(pinTable.id, pin.id))
      .run()
  }
}

/**
 * Rewrite already-migrated topic/pin orderKeys from preserved V1 Redux order.
 * No-ops when the marker exists, when Redux has no topic ids, or when none
 * of those ids exist in SQLite (skip-migration / native v2 profiles).
 */
export function repairMigratedV1TopicOrder(source: V1TopicOrderSource): V1TopicOrderRepairResult {
  return application.get('DbService').withWriteTx((tx) => {
    if (readRepairMarker(tx)) {
      return { applied: false, reason: 'already_applied' }
    }

    const reduxOrderIds = collectV1TopicOrderIds(source)
    if (reduxOrderIds.length === 0) {
      writeV1TopicOrderRepairMarker(tx, 'skipped')
      logger.info('V1 topic-order repair skipped: no Redux topic sequence')
      return { applied: false, reason: 'no_source' }
    }

    const existingIds = new Set(
      tx
        .select({ id: topicTable.id })
        .from(topicTable)
        .all()
        .map((row) => row.id)
    )
    const overlap = reduxOrderIds.some((id) => existingIds.has(id))
    if (!overlap) {
      writeV1TopicOrderRepairMarker(tx, 'skipped')
      logger.info('V1 topic-order repair skipped: Redux sequence has no SQLite overlap')
      return { applied: false, reason: 'no_overlap' }
    }

    stampTopicAndPinOrder(tx, reduxOrderIds)
    writeV1TopicOrderRepairMarker(tx, 'repair')
    logger.info('Rewrote migrated topic/pin order from V1 Redux assistants[].topics[]', {
      reduxTopicCount: reduxOrderIds.length,
      topicCount: existingIds.size
    })
    return { applied: true, reason: 'repaired' }
  })
}
