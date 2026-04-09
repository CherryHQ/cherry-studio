import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const agentsAgentsTable = sqliteTable(
  'agents_agents',
  {
    id: text().primaryKey(),
    type: text().notNull(),
    name: text().notNull(),
    description: text(),
    accessible_paths: text(),
    instructions: text(),
    model: text().notNull(),
    plan_model: text(),
    small_model: text(),
    mcps: text(),
    allowed_tools: text(),
    configuration: text(),
    sort_order: integer().notNull().default(0),
    created_at: text().notNull(),
    updated_at: text().notNull()
  },
  (t) => [
    index('agents_agents_name_idx').on(t.name),
    index('agents_agents_type_idx').on(t.type),
    index('agents_agents_created_at_idx').on(t.created_at),
    index('agents_agents_sort_order_idx').on(t.sort_order)
  ]
)

export type AgentsAgentRow = typeof agentsAgentsTable.$inferSelect
export type InsertAgentsAgentRow = typeof agentsAgentsTable.$inferInsert
