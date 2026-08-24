import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './_columnHelpers'

export const preferenceTable = sqliteTable(
  'preference',
  {
    scope: text().notNull().default('default'), // scope is reserved for future use, now only 'default' is supported
    key: text().notNull(),
    value: text({ mode: 'json' }),
    ...createUpdateTimestamps
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })]
)
