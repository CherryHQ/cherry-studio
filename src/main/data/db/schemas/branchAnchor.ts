import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { topicTable } from './topic'

/**
 * branch_anchor table - persists P2 "asset realization" anchors.
 *
 * One row per kept branch's source-passage anchor. Indexed on `parentTopicId`
 * so a single read returns every anchor (and thus every kept branch) for a
 * conversation - the property `topic.metadata` could not satisfy (no writable
 * JSON column; see P2 doc §2 Q1).
 *
 * The fork (branch) topic carries no back-reference to its parent, so
 * `branchTopicId` is stored explicitly to re-link the branch on revisit.
 *
 * This table only STORES the offsets; it owns no highlight logic. Anchors are
 * rebuilt by replaying `selectionStart`/`selectionEnd` through the existing
 * exported `sourceHighlight` paint path (read-only reuse; see P2 doc §2 Q2).
 *
 * Anchor offsets are block-internal CHARACTER offsets over the source block's
 * RENDERED `textContent` - NOT the markdown source.
 */
export const branchAnchorTable = sqliteTable(
  'branch_anchor',
  {
    id: uuidPrimaryKey(),

    // FK to the PARENT (main) topic. CASCADE: drop anchors when the conversation is deleted.
    parentTopicId: text()
      .notNull()
      .references(() => topicTable.id, { onDelete: 'cascade' }),

    // FK to the kept branch's own topic. CASCADE: drop the anchor if the branch topic is deleted.
    branchTopicId: text()
      .notNull()
      .references(() => topicTable.id, { onDelete: 'cascade' }),

    // Source message id - a snapshot reference into the parent topic's message tree.
    // No FK: message rows already cascade-delete from their topic, and the paired
    // `blockId` lives inside message.data JSON (not a table), so a half-FK adds no integrity.
    messageId: text().notNull(),

    // Source block id within the message's rendered blocks.
    blockId: text().notNull(),

    // Snapshot of the selected passage text - fallback when offset re-anchoring fails.
    selectedText: text().notNull(),

    // Block-internal character offsets over the block's RENDERED textContent (NOT markdown source).
    selectionStart: integer().notNull(),
    selectionEnd: integer().notNull(),

    // Disposition is STORED but NON-LOAD-BEARING: under write-on-keep it is ~always 'kept'.
    // No read path branches on it (P2 doc §1.2 / Sam's ruling). Kept for forward-extension.
    disposition: text().notNull().default('kept'),

    // Manual-trigger branch summary (P2). Null until generated.
    summary: text(),
    // When the summary was last written (epoch ms). Null until first summary.
    summaryUpdatedAt: integer(),

    ...createUpdateTimestamps
  },
  (t) => [
    index('branch_anchor_parent_topic_id_idx').on(t.parentTopicId),
    uniqueIndex('branch_anchor_branch_topic_id_unique_idx').on(t.branchTopicId),
    check('branch_anchor_disposition_check', sql`${t.disposition} IN ('pending', 'kept')`)
  ]
)
