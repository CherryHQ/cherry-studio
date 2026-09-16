import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// No cascading FK: recovery must retain ownership records after a session is deleted.
export const agentSessionEditTable = sqliteTable(
  'agent_session_edit',
  {
    operationId: text().primaryKey(),
    sessionId: text().notNull(),
    committedAt: integer(),
    document: text({ mode: 'json' }).$type<unknown>().notNull()
  },
  (table) => [index('idx_agent_session_edit_session').on(table.sessionId, table.committedAt)]
)
