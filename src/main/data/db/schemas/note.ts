import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'

/**
 * Note metadata table - stores metadata for note files
 *
 * Uses the file path as primary key since paths are unique identifiers
 * for notes in the filesystem. Extensible for future fields (AI tags, etc.).
 */
export const noteTable = sqliteTable('note', {
  path: text().primaryKey(),
  isStarred: integer({ mode: 'boolean' }).notNull().default(false),
  ...createUpdateTimestamps
})
