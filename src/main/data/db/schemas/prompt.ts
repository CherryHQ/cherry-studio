import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * Prompt table - stores user prompt templates (replaces legacy QuickPhrase)
 *
 * Template variables use ${var} syntax in content and are filled inline by the user.
 */
export const promptTable = sqliteTable(
  'prompt',
  {
    id: uuidPrimaryKeyOrdered(),
    title: text().notNull(),
    // Denormalized cache of the active prompt content for fast current-state reads.
    // The source of truth for version history remains prompt_version.
    content: text().notNull(),
    // Current active version number
    currentVersion: integer().notNull().default(1),
    // Sort order
    sortOrder: integer().notNull().default(0),

    ...createUpdateTimestamps
  },
  (t) => [index('prompt_sort_order_idx').on(t.sortOrder), index('prompt_updated_at_idx').on(t.updatedAt)]
)

/**
 * Prompt version table - stores version snapshots
 *
 * A new version is created automatically when content changes.
 * Rollback creates a new version with the target version's content.
 */
export const promptVersionTable = sqliteTable(
  'prompt_version',
  {
    id: uuidPrimaryKeyOrdered(),
    // FK to prompt - CASCADE: delete versions when prompt is deleted
    promptId: text()
      .notNull()
      .references(() => promptTable.id, { onDelete: 'cascade' }),
    // Version number (1, 2, 3...)
    version: integer().notNull(),
    // Snapshot of content at this version
    content: text().notNull(),

    createdAt: integer().$defaultFn(() => Date.now())
  },
  (t) => [uniqueIndex('prompt_version_prompt_id_version_idx').on(t.promptId, t.version)]
)
