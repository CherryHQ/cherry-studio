import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './columnHelpers'

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
