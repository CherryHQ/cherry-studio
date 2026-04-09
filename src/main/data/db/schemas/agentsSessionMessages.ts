import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentsSessionsTable } from './agentsSessions'

export const agentsSessionMessagesTable = sqliteTable(
  'agents_session_messages',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    session_id: text().notNull(),
    role: text().notNull(),
    content: text().notNull(),
    agent_session_id: text().default(''),
    metadata: text(),
    created_at: text().notNull(),
    updated_at: text().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.session_id],
      foreignColumns: [agentsSessionsTable.id],
      name: 'agents_session_messages_session_id_fk'
    }).onDelete('cascade'),
    index('agents_session_messages_session_id_idx').on(t.session_id),
    index('agents_session_messages_created_at_idx').on(t.created_at),
    index('agents_session_messages_updated_at_idx').on(t.updated_at)
  ]
)

export type AgentsSessionMessageRow = typeof agentsSessionMessagesTable.$inferSelect
export type InsertAgentsSessionMessageRow = typeof agentsSessionMessagesTable.$inferInsert
