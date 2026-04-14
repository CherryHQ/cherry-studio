import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'

export const agentsAgentsTable = sqliteTable(
  'agents_agents',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    accessiblePaths: text('accessible_paths'),
    instructions: text('instructions'),
    model: text('model').notNull(),
    planModel: text('plan_model'),
    smallModel: text('small_model'),
    mcps: text('mcps'),
    allowedTools: text('allowed_tools'),
    configuration: text('configuration'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agents_agents_name_idx').on(t.name),
    index('agents_agents_type_idx').on(t.type),
    index('agents_agents_sort_order_idx').on(t.sortOrder)
  ]
)

export type AgentsAgentRow = typeof agentsAgentsTable.$inferSelect
export type InsertAgentsAgentRow = typeof agentsAgentsTable.$inferInsert
