import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

export const inputHistoryTable = sqliteTable(
  'input_history',
  {
    id: uuidPrimaryKeyOrdered(),
    content: text().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('input_history_content_unique_idx').on(t.content),
    index('input_history_updated_at_idx').on(t.updatedAt)
  ]
)

export type InputHistoryRow = typeof inputHistoryTable.$inferSelect
