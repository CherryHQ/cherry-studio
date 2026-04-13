import { randomUUID } from 'node:crypto'

import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const agentsSkillsTable = sqliteTable(
  'agents_skills',
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text().notNull(),
    description: text(),
    folder_name: text().notNull(),
    source: text().notNull(),
    source_url: text(),
    namespace: text(),
    author: text(),
    tags: text(),
    content_hash: text().notNull(),
    is_enabled: integer({ mode: 'boolean' }).notNull().default(true),
    created_at: integer().notNull(),
    updated_at: integer().notNull()
  },
  (t) => [
    uniqueIndex('agents_skills_folder_name_unique').on(t.folder_name),
    index('agents_skills_source_idx').on(t.source),
    index('agents_skills_is_enabled_idx').on(t.is_enabled)
  ]
)

export type AgentsSkillRow = typeof agentsSkillsTable.$inferSelect
export type InsertAgentsSkillRow = typeof agentsSkillsTable.$inferInsert
