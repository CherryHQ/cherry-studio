import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { userModelTable } from './userModel'

export const agentTable = sqliteTable(
  'agent',
  {
    id: uuidPrimaryKey(),
    type: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(''),
    accessiblePaths: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    instructions: text().notNull(),
    // FK to user_model with ON DELETE SET NULL: when a referenced user_model
    // row is deleted, the column becomes NULL rather than dangling. `model`
    // is therefore nullable so the SET NULL cascade is representable.
    model: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    planModel: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    smallModel: text().references(() => userModelTable.id, { onDelete: 'set null' }),
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
