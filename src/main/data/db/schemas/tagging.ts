import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Tag table - general-purpose tags for entities
 *
 * Tags can be applied to topics, sessions, and assistants
 * via the entity_tag join table.
 */
export const tagTable = sqliteTable('tag', {
  id: uuidPrimaryKey(),
  // Unique tag name
  name: text().notNull().unique(),
  // Display color (hex code)
  color: text(),
  ...createUpdateTimestamps
})

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
