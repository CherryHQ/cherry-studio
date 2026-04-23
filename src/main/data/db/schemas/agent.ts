import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'

export const agentTable = sqliteTable(
  'agent',
  {
    id: uuidPrimaryKey(),
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
    ...createUpdateDeleteTimestamps
  },
  (t) => [
    index('agent_name_idx').on(t.name),
    index('agent_type_idx').on(t.type),
    index('agent_sort_order_idx').on(t.sortOrder)
  ]
)

export type AgentRow = typeof agentTable.$inferSelect
export type InsertAgentRow = typeof agentTable.$inferInsert
