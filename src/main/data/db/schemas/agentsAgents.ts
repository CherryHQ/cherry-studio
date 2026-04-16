import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'

export const agentsAgentsTable = sqliteTable(
  'agents_agents',
  {
    id: text().primaryKey(),
    type: text().notNull(),
    name: text().notNull(),
    description: text(),
    accessiblePaths: text(),
    instructions: text(),
    model: text().notNull(),
    planModel: text(),
    smallModel: text(),
    mcps: text(),
    allowedTools: text(),
    configuration: text(),
    sortOrder: integer().notNull().default(0),
    deletedAt: text(),
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
