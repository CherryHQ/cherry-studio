import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'

/**
 * Translate language table - stores builtin and user-defined translation languages
 *
 * Design notes:
 * - Very small dataset (tens of records at most)
 * - langCode is the primary key (natural key, e.g. "en-us", "zh-cn")
 * - Referenced by translateHistory.sourceLanguage / targetLanguage as FK
 */
export const translateLanguageTable = sqliteTable('translate_language', {
  langCode: text().primaryKey().notNull(),
  value: text().notNull(),
  emoji: text().notNull(),
  ...createUpdateTimestamps
})
