import { foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentsAgentsTable } from './agentsAgents'

export const agentsSessionsTable = sqliteTable(
  'agents_sessions',
  {
    id: text('id').primaryKey(),
    agentType: text('agent_type').notNull(),
    agentId: text('agent_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    accessiblePaths: text('accessible_paths'),
    instructions: text('instructions'),
    model: text('model').notNull(),
    planModel: text('plan_model'),
    smallModel: text('small_model'),
    mcps: text('mcps'),
    allowedTools: text('allowed_tools'),
    slashCommands: text('slash_commands'),
    configuration: text('configuration'),
    sortOrder: integer('sort_order').notNull().default(0),
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
