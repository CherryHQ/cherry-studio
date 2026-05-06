import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { orderKeyColumns, orderKeyIndex, uuidPrimaryKeyOrdered } from './_columnHelpers'

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
    createdAt: integer()
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer()
      .notNull()
      .$defaultFn(() => Date.now())
      .$onUpdateFn(() => Date.now())
  },
  (t) => [orderKeyIndex('prompt')(t)]
)
