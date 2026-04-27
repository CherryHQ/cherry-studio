// Migration 0015 inserts topic / pin rows with `order_key = ''` as a sentinel
// because pure SQL can't generate fractional-indexing keys; this seeder
// upgrades the sentinel to canonical keys.
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

async function backfillPinOrderKey(db: DbType): Promise<void> {
  // JOIN to topic so pin order matches the source topic's recency; non-topic
  // entityTypes (none today) fall back to pin.created_at via COALESCE.
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
