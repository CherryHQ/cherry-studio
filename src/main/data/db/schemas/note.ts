import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Note metadata table - stores metadata for note files
 *
 * Uses UUID as primary key for cloud sync / cross-device backup-restore.
 * relativePath is relative to notesRoot (preference: feature.notes.path),
 * normalized to forward slashes for cross-platform compatibility.
 * Absolute path is computed at runtime: notesRoot + relativePath.
 */
export const noteTable = sqliteTable('note', {
  id: uuidPrimaryKey(),
  relativePath: text('relative_path').notNull().unique(),
  isStarred: integer({ mode: 'boolean' }).notNull().default(false),
  ...createUpdateTimestamps
})
