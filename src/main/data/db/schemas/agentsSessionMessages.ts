import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.sessionId],
      foreignColumns: [agentsSessionsTable.id],
      name: 'agents_session_messages_session_id_fk'
    }).onDelete('cascade'),
    index('agents_session_messages_session_id_idx').on(t.sessionId),
    index('agents_session_messages_created_at_idx').on(t.createdAt),
    index('agents_session_messages_updated_at_idx').on(t.updatedAt)
  ]
)

export type AgentsSessionMessageRow = typeof agentsSessionMessagesTable.$inferSelect
export type InsertAgentsSessionMessageRow = typeof agentsSessionMessagesTable.$inferInsert
