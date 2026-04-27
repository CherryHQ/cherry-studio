/**
 * One-time backfill for topic/pin `order_key` values introduced by migration
 * 0015. The migration adds the column with `NOT NULL DEFAULT ''` (so SQLite
 * accepts ALTER on populated tables) and pre-emits pin rows from legacy
 * `is_pinned=1` topics with the same `''` sentinel — this seeder upgrades the
 * sentinel to canonical fractional-indexing keys.
 *
 * Why a seeder, not inline in DbService.migrateDb? Drizzle's `migrate()` only
 * executes SQL; pure SQL cannot generate fractional-indexing keys (a JS-side
 * algorithm). Seeders are the documented extension point for "stuff that runs
 * after migrate() and produces structured data" — see seeding/index.ts.
 *
 * Idempotency: the SeedRunner journal skips re-runs once applied; the body is
 * also self-idempotent (only touches rows where `order_key = ''`), so even
 * after a journal-bumping version change a re-run does nothing on already-
 * backfilled rows.
 *
 * Spec: docs/references/data/data-ordering-guide.md §7 step 6 +
 *       docs/references/data/v2-migration-guide.md §"Order-Key Stamping in Migrators"
 */
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { sql } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'

export class TopicOrderKeyBackfillSeeder implements ISeeder {
  readonly name = 'topic-order-key-backfill'
  readonly version = '1'
  readonly description = 'Upgrade order_key sentinel ("") on topic and pin rows to fractional-indexing keys'

  async run(db: DbType): Promise<void> {
    await backfillTopicOrderKey(db)
    await backfillPinOrderKey(db)
  }
}

/**
 * Upgrade `topic.order_key = ''` to canonical fractional-indexing keys,
 * partitioned by `group_id` and ordered by `updated_at DESC` within each
 * partition (matches the default unpinned-list sort, so the first reorder
 * feels natural).
 */
async function backfillTopicOrderKey(db: DbType): Promise<void> {
  const result = await db.run(sql`
    SELECT id, group_id AS groupId
    FROM topic
    WHERE order_key = ''
    ORDER BY (group_id IS NULL) DESC, group_id, updated_at DESC, id ASC
  `)
  const rows = result.rows as unknown as Array<{ id: string; groupId: string | null }>
  if (rows.length === 0) return

  const buckets = new Map<string | null, string[]>()
  for (const r of rows) {
    const list = buckets.get(r.groupId)
    if (list) list.push(r.id)
    else buckets.set(r.groupId, [r.id])
  }

  for (const ids of buckets.values()) {
    const keys = generateOrderKeySequence(ids.length)
    for (let i = 0; i < ids.length; i++) {
      await db.run(sql`UPDATE topic SET order_key = ${keys[i]} WHERE id = ${ids[i]}`)
    }
  }
}

/**
 * Upgrade `pin.order_key = ''` to canonical fractional-indexing keys,
 * partitioned by `entity_type`. For pin rows whose entity is a topic the
 * sort key is `topic.updated_at DESC` (recently-active pin lands at the
 * head); for non-topic entityTypes (none today, future-proof) fall back to
 * `pin.created_at`.
 */
async function backfillPinOrderKey(db: DbType): Promise<void> {
  const result = await db.run(sql`
    SELECT pin.id AS id, pin.entity_type AS entityType
    FROM pin
    LEFT JOIN topic ON pin.entity_type = 'topic' AND pin.entity_id = topic.id
    WHERE pin.order_key = ''
    ORDER BY pin.entity_type, COALESCE(topic.updated_at, pin.created_at) DESC, pin.id ASC
  `)
  const rows = result.rows as unknown as Array<{ id: string; entityType: string }>
  if (rows.length === 0) return

  const buckets = new Map<string, string[]>()
  for (const r of rows) {
    const list = buckets.get(r.entityType)
    if (list) list.push(r.id)
    else buckets.set(r.entityType, [r.id])
  }

  for (const ids of buckets.values()) {
    const keys = generateOrderKeySequence(ids.length)
    for (let i = 0; i < ids.length; i++) {
      await db.run(sql`UPDATE pin SET order_key = ${keys[i]} WHERE id = ${ids[i]}`)
    }
  }
}
