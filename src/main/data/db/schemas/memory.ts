import { sql } from 'drizzle-orm'
import { check, customType, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const f32Blob1536 = customType<{ data: string | null }>({
  dataType() {
    return 'F32_BLOB(1536)'
  }
})

/**
 * Memory table - persistent long-term memories.
 *
 * Notes:
 * - `embedding` uses libsql native vector type `F32_BLOB(1536)`.
 * - Timestamps are ISO string for backward compatibility with current memory IPC shape.
 */
export const memoryTable = sqliteTable(
  'memory',
  {
    id: text().primaryKey(),
    memory: text().notNull(),
    hash: text().notNull().unique(),
    embedding: f32Blob1536('embedding'),
    metadata: text({ mode: 'json' }).$type<Record<string, any>>(),
    userId: text(),
    agentId: text(),
    runId: text(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
    deletedAt: text()
  },
  (t) => [
    index('memory_hash_idx').on(t.hash),
    index('memory_user_id_idx').on(t.userId),
    index('memory_agent_id_idx').on(t.agentId),
    index('memory_created_at_idx').on(t.createdAt),
    check('memory_hash_not_empty_check', sql`${t.hash} <> ''`)
  ]
)

export const MEMORY_VECTOR_INDEX_STATEMENTS: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_memory_vector ON memory (libsql_vector_idx(embedding))'
]

export const memoryHistoryTable = sqliteTable(
  'memory_history',
  {
    id: integer().primaryKey(),
    memoryId: text()
      .notNull()
      .references(() => memoryTable.id, { onDelete: 'cascade' }),
    previousValue: text(),
    newValue: text(),
    action: text().notNull(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
    deletedAt: text()
  },
  (t) => [
    index('memory_history_memory_id_created_at_idx').on(t.memoryId, t.createdAt),
    check('memory_history_action_check', sql`${t.action} IN ('ADD', 'UPDATE', 'DELETE')`)
  ]
)
