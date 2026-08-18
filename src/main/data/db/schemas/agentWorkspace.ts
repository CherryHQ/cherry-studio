import { AGENT_WORKSPACE_TYPE, AgentWorkspaceTypeSchema } from '@shared/data/api/schemas/agentWorkspaces'
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
    /**
     * The path this workspace pointed at before a restore refused to honour it
     * (docs/references/backup/README.md §3.1). INERT METADATA ONLY: it is never
     * stat'd, opened, or followed — it exists so a reconnect flow can offer the
     * user the location their workspace used to live at. `null` for every
     * workspace whose `path` is live.
     */
    disconnectedPath: text(),
    type: text().notNull().default(AGENT_WORKSPACE_TYPE.USER),
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
