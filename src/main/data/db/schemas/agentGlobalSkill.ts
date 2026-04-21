import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

export const agentGlobalSkillTable = sqliteTable(
  'agent_global_skill',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    description: text(),
    folderName: text().notNull(),
    source: text().notNull(),
    sourceUrl: text(),
    installSource: text(),
    originKey: text(),
    namespace: text(),
    author: text(),
    tags: text({ mode: 'json' }).$type<string[]>(),
    contentHash: text().notNull(),
    isEnabled: integer({ mode: 'boolean' }).notNull().default(true),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('agent_global_skill_folder_name_unique').on(t.folderName),
    index('agent_global_skill_source_idx').on(t.source),
    index('agent_global_skill_is_enabled_idx').on(t.isEnabled)
  ]
)

export type AgentGlobalSkillRow = typeof agentGlobalSkillTable.$inferSelect
export type InsertAgentGlobalSkillRow = typeof agentGlobalSkillTable.$inferInsert
