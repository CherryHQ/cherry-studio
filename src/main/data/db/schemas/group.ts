import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, scopedOrderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

/**
 * Group table - general-purpose grouping for entities
 *
 * Supports grouping of topics, sessions, and assistants.
 * Each group belongs to a specific entity type; ordering is scoped per entityType
 * via a fractional-indexing `orderKey` (see services/utils/orderKey.ts).
 */
export const groupTable = sqliteTable(
  'group',
  {
    id: uuidPrimaryKey(),
    entityType: text().notNull(),
    name: text().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [scopedOrderKeyIndex('group', 'entityType')(t)]
)

export type GroupInsert = typeof groupTable.$inferInsert
export type GroupSelect = typeof groupTable.$inferSelect
