import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'
import { assistantTable } from './assistant'

/**
 * Topic table - stores conversation topics/threads
 *
 * Topics are containers for messages and reference assistants via FK.
 */
export const topicTable = sqliteTable(
  'topic',
  {
    id: uuidPrimaryKey(),
    name: text().notNull().default(''),
    // Whether the name was manually edited by user
    isNameManuallyEdited: integer({ mode: 'boolean' }).notNull().default(false),
    // FK to assistant table - "last used assistant"
    // SET NULL: preserve topic when assistant is deleted
    assistantId: text().references(() => assistantTable.id, { onDelete: 'set null' }),
    // Active node ID in the message tree
    activeNodeId: text(),

    traceId: text(),

    // Internal identity for the assistant cascade that moved this topic to trash.
    deletionBatchId: text(),

    // Global fractional-indexing order key.
    ...orderKeyColumns,

    // User-visible conversation activity. Metadata writes still advance
    // updatedAt, but only activity-bearing message phases update this column.
    lastActivityAt: integer().notNull().$defaultFn(Date.now),

    ...createUpdateDeleteTimestamps
  },
  (t) => [
    index('topic_last_activity_at_idx').on(t.lastActivityAt),
    index('topic_updated_at_idx').on(t.updatedAt),
    orderKeyIndex('topic')(t),
    index('topic_assistant_id_idx').on(t.assistantId)
  ]
)
