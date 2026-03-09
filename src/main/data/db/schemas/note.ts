import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Note metadata table - stores metadata for note files
 *
 * Uses UUID as primary key for future cloud sync compatibility.
 * Path is unique per device; id is the stable cross-device identifier.
 */
export const noteTable = sqliteTable('note', {
  id: uuidPrimaryKey(),
  path: text().notNull().unique(),
  isStarred: integer({ mode: 'boolean' }).notNull().default(false),
  ...createUpdateTimestamps
})
