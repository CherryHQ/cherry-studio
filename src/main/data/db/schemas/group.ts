import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Group table - general-purpose grouping for entities
 *
 * Supports grouping of topics, sessions, and assistants.
 * Each group belongs to a specific entity type.
 */
export const groupTable = sqliteTable(
  'group',
  {
    id: uuidPrimaryKey(),
    // Entity type this group belongs to: topic, session, assistant
    entityType: text().notNull(),
    // Display name of the group
    name: text().notNull(),
    // Sort order for display
    sortOrder: integer().default(0),
    ...createUpdateTimestamps
  },
  (t) => [index('group_entity_sort_idx').on(t.entityType, t.sortOrder)]
)
