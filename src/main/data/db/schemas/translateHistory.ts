import type { TranslateHistoryKind } from '@shared/data/types/translate'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { translateLanguageTable } from './translateLanguage'

/**
 * Translate history table - stores translation records
 *
 * Design notes:
 * - Data grows unbounded, renderer should use cursor paginated queries
 *   with infinite scroll instead of loading all records at once.
 * - Text search (sourceText/targetText) uses SQL LIKE at DB layer,
 *   not client-side filtering.
 * - Star + createdAt compound index supports "starred only, sorted by time" queries.
 * - sourceLanguage/targetLanguage are FK to translateLanguage.langCode (SET NULL on delete).
 * - `kind='file'` rows store the two files' names in sourceText/targetText and
 *   carry their `file_entry` links in `translate_history_file_ref`. They are minted
 *   only from main (today just `PdfTranslationService`), together with those refs
 *   in one transaction.
 *   Deliberately no SQL CHECK on `kind` (unlike the `role` columns in
 *   `fileRelations.ts`): SQLite cannot add a constraint in place, so a CHECK would
 *   force drizzle to rebuild this already-shipped table via `INSERT…SELECT` — and
 *   that generated statement wrongly selects the not-yet-existing `kind` column.
 *   Without it the migration is a plain `ADD COLUMN`, and the value stays fenced by
 *   `TranslateHistoryKindSchema` at every boundary.
 */
export const translateHistoryTable = sqliteTable(
  'translate_history',
  {
    id: uuidPrimaryKeyOrdered(),
    kind: text().$type<TranslateHistoryKind>().notNull().default('text'),
    sourceText: text().notNull(),
    targetText: text().notNull(),
    sourceLanguage: text().references(() => translateLanguageTable.langCode, { onDelete: 'set null' }),
    targetLanguage: text().references(() => translateLanguageTable.langCode, { onDelete: 'set null' }),
    star: integer({ mode: 'boolean' }).notNull().default(false),
    ...createUpdateTimestamps
  },
  (t) => [
    index('translate_history_created_at_idx').on(t.createdAt),
    index('translate_history_star_created_at_idx').on(t.star, t.createdAt)
  ]
)
