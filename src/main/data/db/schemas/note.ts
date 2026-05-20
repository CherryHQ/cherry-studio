import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

export const noteTable = sqliteTable(
  'note',
  {
    id: uuidPrimaryKey(),
    rootPath: text('root_path').notNull(),
    path: text().notNull(),
    isStarred: integer('is_starred', { mode: 'boolean' }).notNull().default(false),
    isExpanded: integer('is_expanded', { mode: 'boolean' }).notNull().default(false),
    ...createUpdateTimestamps
  },
  (t) => [uniqueIndex('note_root_path_path_unique_idx').on(t.rootPath, t.path)]
)

export type NoteInsert = typeof noteTable.$inferInsert
export type NoteSelect = typeof noteTable.$inferSelect
