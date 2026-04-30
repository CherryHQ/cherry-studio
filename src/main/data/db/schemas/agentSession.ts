import type { AgentConfiguration, SlashCommand } from '@shared/data/api/schemas/agents'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'
import { agentTable } from './agent'
import { userModelTable } from './userModel'

export const agentSessionTable = sqliteTable(
  'agent_session',
  {
    // IDs use the app-generated "session_<timestamp>_<random>" format, not UUIDs,
    // so uuidPrimaryKey() is intentionally not used here. Callers must always supply an id.
    id: text().primaryKey(),
    agentType: text().notNull(),
    agentId: text()
      .notNull()
      .references(() => agentTable.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text().notNull().default(''),
    accessiblePaths: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    instructions: text().notNull(),
    // FK to user_model with ON DELETE SET NULL — see comment on agentTable.model.
    model: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    planModel: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    smallModel: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    mcps: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    allowedTools: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    slashCommands: text({ mode: 'json' }).$type<SlashCommand[]>().notNull().default(sql`'[]'`),
    configuration: text({ mode: 'json' }).$type<AgentConfiguration>().notNull().default(sql`'{}'`),
    sortOrder: integer().notNull().default(0),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_session_agent_id_idx').on(t.agentId),
    index('agent_session_model_idx').on(t.model),
    index('agent_session_sort_order_idx').on(t.sortOrder)
  ]
)

export type AgentSessionRow = typeof agentSessionTable.$inferSelect
export type InsertAgentSessionRow = typeof agentSessionTable.$inferInsert
