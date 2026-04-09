import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentsAgentsTable } from './agentsAgents'

export const agentsSessionsTable = sqliteTable(
  'agents_sessions',
  {
    id: text().primaryKey(),
    agent_type: text().notNull(),
    agent_id: text().notNull(),
    name: text().notNull(),
    description: text(),
    accessible_paths: text(),
    instructions: text(),
    model: text().notNull(),
    plan_model: text(),
    small_model: text(),
    mcps: text(),
    allowed_tools: text(),
    slash_commands: text(),
    configuration: text(),
    sort_order: integer().notNull().default(0),
    created_at: text().notNull(),
    updated_at: text().notNull()
  },
  (t) => [
    foreignKey({
      columns: [t.agent_id],
      foreignColumns: [agentsAgentsTable.id],
      name: 'agents_sessions_agent_id_fk'
    }).onDelete('cascade'),
    index('agents_sessions_created_at_idx').on(t.created_at),
    index('agents_sessions_agent_id_idx').on(t.agent_id),
    index('agents_sessions_model_idx').on(t.model),
    index('agents_sessions_sort_order_idx').on(t.sort_order)
  ]
)

export type AgentsSessionRow = typeof agentsSessionsTable.$inferSelect
export type InsertAgentsSessionRow = typeof agentsSessionsTable.$inferInsert
