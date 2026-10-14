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
    remoteHistoryRevision: integer().notNull().default(0),

    traceId: text(),

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

export const TOPIC_REMOTE_REVISION_STATEMENTS = [
  `DROP TRIGGER IF EXISTS topic_remote_revision`,
  `CREATE TRIGGER topic_remote_revision AFTER UPDATE OF name, assistant_id, active_node_id, deleted_at ON topic
   WHEN NEW.name IS NOT OLD.name OR NEW.assistant_id IS NOT OLD.assistant_id
     OR NEW.active_node_id IS NOT OLD.active_node_id OR NEW.deleted_at IS NOT OLD.deleted_at
   BEGIN UPDATE topic SET remote_history_revision = remote_history_revision + 1 WHERE id = NEW.id; END`,
  ...(['INSERT', 'UPDATE', 'DELETE'] as const).flatMap((operation) => {
    const name = `message_remote_revision_${operation.toLowerCase()}`
    const row = operation === 'DELETE' ? 'OLD' : 'NEW'
    return [
      `DROP TRIGGER IF EXISTS ${name}`,
      `CREATE TRIGGER ${name} AFTER ${operation} ON message
       BEGIN UPDATE topic SET remote_history_revision = remote_history_revision + 1 WHERE id = ${row}.topic_id; END`
    ]
  })
]
