import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from './columnHelpers'
import { tagTable } from './tag'

/**
 * Entity-Tag join table - associates tags with entities
 *
 * Supports many-to-many relationship between tags and
 * various entity types (topic, session, assistant).
 */
export const entityTagTable = sqliteTable(
  'entity_tag',
  {
    // Entity type: topic, session, assistant
    entityType: text().notNull(),
    // FK to the entity
    entityId: text().notNull(),
    // FK to tag table - CASCADE: delete association when tag is deleted
    tagId: text()
      .notNull()
      .references(() => tagTable.id, { onDelete: 'cascade' }),
    ...createUpdateTimestamps
  },
  (t) => [primaryKey({ columns: [t.entityType, t.entityId, t.tagId] }), index('entity_tag_tag_id_idx').on(t.tagId)]
)
