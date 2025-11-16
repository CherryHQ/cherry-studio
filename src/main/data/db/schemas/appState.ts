import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './columnHelpers'

export const appStateTable = sqliteTable('app_state', {
  key: text().primaryKey(),
  value: text({ mode: 'json' }).notNull(), // JSON field, drizzle handles serialization automatically
  description: text(), // Optional description field
  ...createUpdateTimestamps
})
