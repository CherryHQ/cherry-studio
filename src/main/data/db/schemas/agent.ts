import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'

export const agentTable = sqliteTable(
  'agent',
  {
    id: uuidPrimaryKey(),
    type: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(''),
    accessiblePaths: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    instructions: text().notNull(),
    model: text().notNull(),
    planModel: text(),
    smallModel: text(),
    mcps: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    allowedTools: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    configuration: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
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
