import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, scopedOrderKeyIndex, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'

export const agentSessionTable = sqliteTable(
  'agent_session',
  {
    id: uuidPrimaryKey(),
    agentId: text()
      .notNull()
      .references(() => agentTable.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text().notNull().default(''),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [scopedOrderKeyIndex('agent_session', 'agentId')(t)]
)

export type AgentSessionRow = typeof agentSessionTable.$inferSelect
export type InsertAgentSessionRow = typeof agentSessionTable.$inferInsert
