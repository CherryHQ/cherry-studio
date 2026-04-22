import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { userModelTable } from './userModel'

export const agentTable = sqliteTable(
  'agent',
  {
    id: uuidPrimaryKey(),
    type: text().notNull(),
    name: text().notNull(),
    description: text(),
    accessiblePaths: text(),
    instructions: text(),
    model: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    planModel: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    smallModel: text().references(() => userModelTable.id, { onDelete: 'set null' }),
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
