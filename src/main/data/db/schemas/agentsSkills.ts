import { randomUUID } from 'node:crypto'

import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const agentsSkillsTable = sqliteTable(
  'agents_skills',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text('name').notNull(),
    description: text('description'),
    folderName: text('folder_name').notNull(),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    namespace: text('namespace'),
    author: text('author'),
    tags: text('tags'),
    contentHash: text('content_hash').notNull(),
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now())
  },
  (t) => [
    uniqueIndex('agents_skills_folder_name_unique').on(t.folderName),
    index('agents_skills_source_idx').on(t.source),
    index('agents_skills_is_enabled_idx').on(t.isEnabled)
  ]
)

export type AgentsSkillRow = typeof agentsSkillsTable.$inferSelect
export type InsertAgentsSkillRow = typeof agentsSkillsTable.$inferInsert
