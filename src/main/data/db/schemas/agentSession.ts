import type { AgentConfiguration, SlashCommand } from '@shared/data/api/schemas/agents'
import { sql } from 'drizzle-orm'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, scopedOrderKeyIndex, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { userModelTable } from './userModel'

export const agentSessionTable = sqliteTable(
  'agent_session',
  {
    id: uuidPrimaryKey(),
    agentType: text().notNull(),
    agentId: text()
      .notNull()
      .references(() => agentTable.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text().notNull().default(''),
    accessiblePaths: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    instructions: text().notNull(),
    model: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    planModel: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    smallModel: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    mcps: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    allowedTools: text({ mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    slashCommands: text({ mode: 'json' }).$type<SlashCommand[]>().notNull().default(sql`'[]'`),
    configuration: text({ mode: 'json' }).$type<AgentConfiguration>().notNull().default(sql`'{}'`),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [index('agent_session_model_idx').on(t.model), scopedOrderKeyIndex('agent_session', 'agentId')(t)]
)

export type AgentSessionRow = typeof agentSessionTable.$inferSelect
export type InsertAgentSessionRow = typeof agentSessionTable.$inferInsert
