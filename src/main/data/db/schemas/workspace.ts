import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

export const workspaceTable = sqliteTable(
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

export type WorkspaceRow = typeof workspaceTable.$inferSelect
export type InsertWorkspaceRow = typeof workspaceTable.$inferInsert
