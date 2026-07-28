import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Tag table - general-purpose tags for entities
 *
 * Tags can be applied to assistants, topics, models, and knowledge resources
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
 * taggable entity types (assistant, topic, model, knowledge).
 */
export const entityTagTable = sqliteTable(
  'entity_tag',
  {
    // Entity type: assistant, topic, model, knowledge
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

export type InsertTagRow = typeof tagTable.$inferInsert
export type TagRow = typeof tagTable.$inferSelect
export type InsertEntityTagRow = typeof entityTagTable.$inferInsert
export type EntityTagRow = typeof entityTagTable.$inferSelect
