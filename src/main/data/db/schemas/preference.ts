import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './columnHelpers'

export const preferenceTable = sqliteTable(
  'preference',
  {
    scope: text().notNull(), // scope is reserved for future use, now only 'default' is supported
    key: text().notNull(),
    value: text({ mode: 'json' }),
    ...createUpdateTimestamps
  },
  (t) => [index('scope_name_idx').on(t.scope, t.key)]
)
