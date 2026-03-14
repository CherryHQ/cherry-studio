import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Translate history table - stores translation records
 *
 * Design notes:
 * - Data grows unbounded, renderer should use paginated queries (offset/limit)
 *   with infinite scroll instead of loading all records at once.
 * - Text search (sourceText/targetText) uses SQL LIKE at DB layer,
 *   not client-side filtering.
 * - Star + createdAt compound index supports "starred only, sorted by time" queries.
 */
export const translateHistoryTable = sqliteTable(
  'translate_history',
  {
    id: uuidPrimaryKey(),
    sourceText: text().notNull(),
    targetText: text().notNull(),
    sourceLanguage: text().notNull(),
    targetLanguage: text().notNull(),
    star: integer({ mode: 'boolean' }).notNull().default(false),
    ...createUpdateTimestamps
  },
  (t) => [
    index('translate_history_created_at_idx').on(t.createdAt),
    index('translate_history_star_created_at_idx').on(t.star, t.createdAt)
  ]
)
