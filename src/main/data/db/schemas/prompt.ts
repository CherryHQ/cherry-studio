import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * Prompt table - user prompt snippets (replaces legacy QuickPhrase).
 */
export const promptTable = sqliteTable(
  'prompt',
  {
    id: uuidPrimaryKeyOrdered(),
    title: text().notNull(),
    content: text().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [orderKeyIndex('prompt')(t)]
)
