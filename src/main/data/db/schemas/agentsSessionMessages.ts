import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentsSessionsTable } from './agentsSessions'

export const agentsSessionMessagesTable = sqliteTable(
  'agents_session_messages',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    sessionId: text().notNull(),
    role: text().notNull(),
    content: text().notNull(),
    agentSessionId: text().default(''),
    metadata: text(),
    ...createUpdateTimestamps
  },
  (t) => [
    foreignKey({
      columns: [t.sessionId],
      foreignColumns: [agentsSessionsTable.id],
      name: 'agents_session_messages_session_id_fk'
    }).onDelete('cascade'),
    index('agents_session_messages_session_id_idx').on(t.sessionId)
  ]
)

export type AgentsSessionMessageRow = typeof agentsSessionMessagesTable.$inferSelect
export type InsertAgentsSessionMessageRow = typeof agentsSessionMessagesTable.$inferInsert
