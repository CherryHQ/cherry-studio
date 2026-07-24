import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { agentWorkspaceTable } from './agentWorkspace'

export const agentSessionTable = sqliteTable(
  'agent_session',
  {
    id: uuidPrimaryKey(),
    agentId: text().references(() => agentTable.id, { onDelete: 'set null' }),
    name: text().notNull(),
    // Whether the name was manually edited by user.
    isNameManuallyEdited: integer({ mode: 'boolean' }).notNull().default(false),
    description: text().notNull().default(''),
    workspaceId: text()
      .notNull()
      .references(() => agentWorkspaceTable.id, { onDelete: 'cascade' }),
    traceId: text(),
    ...orderKeyColumns,
    // Dedicated activity time; owner/workspace/name/order writes must not move it.
    lastActivityAt: integer().notNull().$defaultFn(Date.now),
    ...createUpdateTimestamps
  },
  (t) => [
    index('agent_session_created_at_id_idx').on(sql`${t.createdAt} desc`, t.id),
    index('agent_session_last_activity_at_id_idx').on(sql`${t.lastActivityAt} desc`, t.id),
    orderKeyIndex('agent_session')(t),
    index('agent_session_updated_at_id_idx').on(sql`${t.updatedAt} desc`, t.id)
  ]
)

export type AgentSessionRow = typeof agentSessionTable.$inferSelect
export type InsertAgentSessionRow = typeof agentSessionTable.$inferInsert
