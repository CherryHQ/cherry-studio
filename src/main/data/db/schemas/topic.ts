import { sql } from 'drizzle-orm'
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

    // Global fractional-indexing order key.
    ...orderKeyColumns,

    ...createUpdateDeleteTimestamps
  },
  (t) => [
    index('topic_created_at_id_idx').on(sql`${t.createdAt} desc`, t.id),
    index('topic_updated_at_id_idx').on(sql`${t.updatedAt} desc`, t.id),
    orderKeyIndex('topic')(t),
    index('topic_assistant_id_idx').on(t.assistantId),
    index('topic_assistant_id_created_at_id_idx').on(t.assistantId, sql`${t.createdAt} desc`, t.id)
  ]
)
