import type { AssistantSettings } from '@shared/data/types/assistant'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
  description: text().default(''),
  /** JSON blob: inference params + context source toggles */
  settings: text({ mode: 'json' }).$type<AssistantSettings>(),
  ...createUpdateDeleteTimestamps
})

export type AssistantInsert = typeof assistantTable.$inferInsert
export type AssistantSelect = typeof assistantTable.$inferSelect
