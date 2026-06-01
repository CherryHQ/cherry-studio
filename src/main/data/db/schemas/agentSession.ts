import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { workspaceTable } from './workspace'

export const agentSessionTable = sqliteTable(
  'agent_session',
  {
    id: uuidPrimaryKey(),
    agentId: text().references(() => agentTable.id, { onDelete: 'set null' }),
    name: text().notNull(),
    // Whether the name was manually edited by the user (gates auto-rename).
    isNameManuallyEdited: integer({ mode: 'boolean' }).notNull().default(false),
    description: text().notNull().default(''),
    workspaceId: text().references(() => workspaceTable.id, { onDelete: 'set null' }),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [orderKeyIndex('agent_session')(t)]
)

export type AgentSessionRow = typeof agentSessionTable.$inferSelect
export type InsertAgentSessionRow = typeof agentSessionTable.$inferInsert
