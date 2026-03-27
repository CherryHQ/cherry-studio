import type { AssistantSettings } from '@shared/data/types/assistant'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'

/**
 * Assistant table - stores user-configured assistant definitions
 *
 * An assistant is a model + manually assembled context configuration.
 * Topics reference assistants via FK (ON DELETE SET NULL).
 */
export const assistantTable = sqliteTable('assistant', {
  id: uuidPrimaryKey(),
  name: text().notNull(),
  prompt: text().default(''),
  emoji: text(),
  description: text(),
  settings: text({ mode: 'json' }).$type<AssistantSettings>(),
  mcpMode: text(),
  enableWebSearch: integer({ mode: 'boolean' }).default(false),
  enableMemory: integer({ mode: 'boolean' }).default(false),

  ...createUpdateDeleteTimestamps
})

export type AssistantInsert = typeof assistantTable.$inferInsert
export type AssistantSelect = typeof assistantTable.$inferSelect
