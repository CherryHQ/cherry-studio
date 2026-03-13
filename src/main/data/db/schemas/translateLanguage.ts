import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Custom translate language table - stores user-defined translation languages
 *
 * Design notes:
 * - Very small dataset (tens of records at most)
 * - langCode must be unique per language (UNIQUE constraint creates implicit index)
 */
export const translateLanguageTable = sqliteTable('translate_language', {
  id: uuidPrimaryKey(),
  langCode: text().notNull().unique(),
  value: text().notNull(),
  emoji: text().notNull(),
  ...createUpdateTimestamps
})
