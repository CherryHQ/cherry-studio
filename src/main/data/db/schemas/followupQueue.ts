import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import type { FollowupQueueDraft, FollowupQueueStatus } from '@shared/data/types/followupQueue'

import { createUpdateTimestamps, orderKeyColumns, scopedOrderKeyIndex, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * Follow-up queue table - queued composer drafts captured mid-stream.
 *
 * Rows are keyed by an opaque conversation scope string (`scopeKey`); the
 * table never interprets it. No FK to topic/session tables by design (one
 * scope spans both domains) — consumers MUST call
 * `followupQueueService.purgeForScopePrefixTx` in their delete paths.
 *
 * Ordering within a scope uses a fractional-indexing `orderKey`
 * (cf. `pin`). Items are immutable and hard-deleted on dequeue.
 */
export const followupQueueTable = sqliteTable(
  'followup_queue',
  {
    id: uuidPrimaryKeyOrdered(),
    scopeKey: text().notNull(),
    // Serialized draft (text + tokens) — drives the dock preview and edit-restore
    draft: text({ mode: 'json' }).$type<FollowupQueueDraft>().notNull(),
    // Send-ready payload captured at enqueue time
    payload: text({ mode: 'json' }).$type<ComposerQueuedMessagePayload>().notNull(),
    // Drain status for cross-window send arbitration
    status: text().$type<FollowupQueueStatus>().notNull().default('pending'),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [
    index('followup_queue_scope_key_idx').on(t.scopeKey),
    index('followup_queue_status_idx').on(t.status),
    scopedOrderKeyIndex('followup_queue', 'scopeKey')(t),
    check('followup_queue_status_check', sql`${t.status} IN ('pending', 'sending', 'failed')`)
  ]
)

export type FollowupQueueRow = typeof followupQueueTable.$inferSelect
export type InsertFollowupQueueRow = typeof followupQueueTable.$inferInsert

/**
 * Follow-up queue state table - per-scope auto-drain paused flag.
 *
 * One row per conversation scope, created on first pause toggle.
 */
export const followupQueueStateTable = sqliteTable('followup_queue_state', {
  scopeKey: text().primaryKey(),
  paused: integer({ mode: 'boolean' }).notNull().default(false),
  ...createUpdateTimestamps
})

export type FollowupQueueStateRow = typeof followupQueueStateTable.$inferSelect
export type InsertFollowupQueueStateRow = typeof followupQueueStateTable.$inferInsert
