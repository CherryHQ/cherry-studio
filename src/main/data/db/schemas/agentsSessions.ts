import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentsAgentsTable } from './agentsAgents'

export const agentsSessionsTable = sqliteTable(
  'agents_sessions',
  {
    id: text().primaryKey(),
    agentType: text().notNull(),
    agentId: text().notNull(),
    name: text().notNull(),
    description: text(),
    accessiblePaths: text(),
    instructions: text(),
    model: text().notNull(),
    planModel: text(),
    smallModel: text(),
    mcps: text(),
    allowedTools: text(),
    slashCommands: text(),
    configuration: text(),
    sortOrder: integer().notNull().default(0),
    ...createUpdateTimestamps
  },
  (t) => [
    foreignKey({
      columns: [t.agentId],
      foreignColumns: [agentsAgentsTable.id],
      name: 'agents_sessions_agent_id_fk'
    }).onDelete('cascade'),
    index('agents_sessions_agent_id_idx').on(t.agentId),
    index('agents_sessions_model_idx').on(t.model),
    index('agents_sessions_sort_order_idx').on(t.sortOrder)
  ]
)

export type AgentsSessionRow = typeof agentsSessionsTable.$inferSelect
export type InsertAgentsSessionRow = typeof agentsSessionsTable.$inferInsert
