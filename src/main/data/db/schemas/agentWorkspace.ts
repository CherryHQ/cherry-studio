import { AgentWorkspaceTypeSchema } from '@shared/data/api/schemas/agentWorkspaces'
import { sql } from 'drizzle-orm'
import { check, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

const agentWorkspaceTypeCheckValues = AgentWorkspaceTypeSchema.options.map((type) => `'${type}'`).join(', ')

export const agentWorkspaceTable = sqliteTable(
  'agent_workspace',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    path: text().notNull(),
    type: text().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('agent_workspace_path_unique_idx').on(t.path),
    orderKeyIndex('agent_workspace')(t),
    check('agent_workspace_type_check', sql`${t.type} IN (${sql.raw(agentWorkspaceTypeCheckValues)})`)
  ]
)

export type AgentWorkspaceRow = typeof agentWorkspaceTable.$inferSelect
export type InsertAgentWorkspaceRow = typeof agentWorkspaceTable.$inferInsert
