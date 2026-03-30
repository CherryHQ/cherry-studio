import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Agent table — autonomous agent definitions (templates)
 *
 * An agent is a code agent configuration (model + tools + instructions).
 * Sessions are created from agents but run independently.
 * Soft delete: preserve agent metadata for historical sessions.
 */
export const agentTable = sqliteTable(
  'agent',
  {
    id: uuidPrimaryKey(),
    type: text().notNull(),
    name: text().notNull(),
    description: text(),

    model: text().notNull(),
    planModel: text(),
    smallModel: text(),

    accessiblePaths: text({ mode: 'json' }).$type<string[]>(),
    instructions: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    mcps: text({ mode: 'json' }).$type<string[]>(),
    allowedTools: text({ mode: 'json' }).$type<string[]>(),
    configuration: text({ mode: 'json' }).$type<Record<string, unknown>>(),

    sortOrder: integer().notNull().default(0),

    ...createUpdateDeleteTimestamps
  },
  (t) => [index('agent_type_idx').on(t.type), index('agent_sort_order_idx').on(t.sortOrder)]
)

export type AgentInsert = typeof agentTable.$inferInsert
export type AgentSelect = typeof agentTable.$inferSelect
