import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Note metadata table - stores note-specific business metadata (starred, future AI fields)
 *
 * Uses UUID as primary key for cloud sync / cross-device backup-restore.
 * relativePath is relative to notesRoot (preference: feature.notes.path),
 * normalized to forward slashes for cross-platform compatibility.
 * Absolute path is computed at runtime: notesRoot + relativePath.
 *
 * ## Integration with file manager (PR #13451)
 *
 * When the file manager (`node` table) lands, each note file will have both:
 *   - A `node` row under `mount_notes` (file tree structure, size, ext, etc.)
 *   - A `note` row (note-specific business metadata: isStarred, future AI fields)
 *
 * Migration plan:
 *   1. Add `nodeId` FK column referencing `node.id`
 *   2. Backfill `nodeId` by matching `relativePath` to node tree paths
 *   3. `relativePath` becomes derivable from node tree and can be dropped
 */
export const noteTable = sqliteTable('note', {
  id: uuidPrimaryKey(),
  relativePath: text('relative_path').notNull().unique(),
  isStarred: integer({ mode: 'boolean' }).notNull().default(false),
  ...createUpdateTimestamps
})
