import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

export const agentWorkspaceTable = sqliteTable(
  'agent_workspace',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    path: text().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [uniqueIndex('agent_workspace_path_unique_idx').on(t.path), orderKeyIndex('agent_workspace')(t)]
)

export type AgentWorkspaceRow = typeof agentWorkspaceTable.$inferSelect
export type InsertAgentWorkspaceRow = typeof agentWorkspaceTable.$inferInsert
