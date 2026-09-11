import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { uuidPrimaryKey } from './_columnHelpers'

export const browserVisitTable = sqliteTable(
  'browser_visit',
  {
    id: uuidPrimaryKey(),
    url: text().notNull(),
    title: text().notNull(),
    visitedAt: integer().notNull(),
    source: text().notNull().default('local'),
    sourceKey: text()
  },
  (t) => [
    index('browser_visit_time_idx').on(t.visitedAt, t.id),
    uniqueIndex('browser_visit_source_key_idx').on(t.sourceKey)
  ]
)

export type BrowserVisitRow = typeof browserVisitTable.$inferSelect
