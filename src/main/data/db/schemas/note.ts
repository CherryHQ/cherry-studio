import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Note metadata table - stores metadata for note files
 *
 * Uses UUID as primary key for cloud sync / cross-device backup-restore.
 * - path: absolute local path (device-specific)
 * - relativePath: path relative to notesRoot (cross-device stable)
 */
export const noteTable = sqliteTable('note', {
  id: uuidPrimaryKey(),
  path: text().notNull().unique(),
  relativePath: text('relative_path').notNull(),
  isStarred: integer({ mode: 'boolean' }).notNull().default(false),
  ...createUpdateTimestamps
})
