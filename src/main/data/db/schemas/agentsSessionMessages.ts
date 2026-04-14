import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentsSessionsTable } from './agentsSessions'

export const agentsSessionMessagesTable = sqliteTable(
  'agents_session_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    agentSessionId: text('agent_session_id').default(''),
    metadata: text('metadata'),
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
