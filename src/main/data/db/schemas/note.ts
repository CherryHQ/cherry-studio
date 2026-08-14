import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

export const noteTable = sqliteTable(
  'note',
  {
    id: uuidPrimaryKey(),
    // Paths are forward-slash-normalized at the API boundary. The unique index does byte comparison.
    rootPath: text('root_path').notNull(),
    path: text().notNull(),
    isStarred: integer('is_starred', { mode: 'boolean' }).notNull().default(false),
    isExpanded: integer('is_expanded', { mode: 'boolean' }).notNull().default(false),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('note_root_path_path_unique_idx').on(t.rootPath, t.path),
    check('note_has_state_check', sql`${t.isStarred} = 1 OR ${t.isExpanded} = 1`)
  ]
)

export type InsertNoteRow = typeof noteTable.$inferInsert
export type NoteRow = typeof noteTable.$inferSelect
