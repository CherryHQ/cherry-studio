import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

export const agentsGlobalSkillsTable = sqliteTable(
  'agents_global_skills',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    description: text(),
    folderName: text().notNull(),
    source: text().notNull(),
    sourceUrl: text(),
    namespace: text(),
    author: text(),
    tags: text(),
    contentHash: text().notNull(),
    isEnabled: integer({ mode: 'boolean' }).notNull().default(true),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('agents_global_skills_folder_name_unique').on(t.folderName),
    index('agents_global_skills_source_idx').on(t.source),
    index('agents_global_skills_is_enabled_idx').on(t.isEnabled)
  ]
)

export type AgentsGlobalSkillRow = typeof agentsGlobalSkillsTable.$inferSelect
export type InsertAgentsGlobalSkillRow = typeof agentsGlobalSkillsTable.$inferInsert

// Backward-compat aliases for callers that still reference the old names
export { agentsGlobalSkillsTable as agentsSkillsTable }
export type { AgentsGlobalSkillRow as AgentsSkillRow, InsertAgentsGlobalSkillRow as InsertAgentsSkillRow }
