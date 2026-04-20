import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentSessionTable } from './agentSession'

export const agentSessionMessageTable = sqliteTable(
  'agent_session_message',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    sessionId: text().notNull(),
    role: text().notNull(),
    content: text().notNull(),
    agentSessionId: text(),
    metadata: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    foreignKey({
      columns: [t.sessionId],
      foreignColumns: [agentSessionTable.id],
      name: 'agent_session_message_session_id_fk'
    }).onDelete('cascade'),
    index('agent_session_message_session_id_idx').on(t.sessionId)
  ]
)

export type AgentSessionMessageRow = typeof agentSessionMessageTable.$inferSelect
export type InsertAgentSessionMessageRow = typeof agentSessionMessageTable.$inferInsert
