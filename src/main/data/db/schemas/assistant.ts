import type { AssistantSettings } from '@shared/data/types/assistant'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { userModelTable } from './userModel'

/**
 * Assistant table - stores user-configured assistant definitions
 *
 * An assistant is a model + manually assembled context configuration.
 * Topics reference assistants via FK (ON DELETE SET NULL).
 */
export const assistantTable = sqliteTable(
  'assistant',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    // Type-level empty: DB DEFAULT is the single source of truth
    prompt: text().notNull().default(''),
    // Product-chosen value: AssistantService.create() supplies '🌟' (see spec § DB defaults are near-permanent)
    emoji: text().notNull(),
    // Type-level empty: DB DEFAULT is the single source of truth
    description: text().notNull().default(''),
    // Default/primary model: FK to user_model(id) — UniqueModelId "providerId::modelId"
    // Legitimately nullable (R1): NULL = "no model selected yet"
    modelId: text().references(() => userModelTable.id, { onDelete: 'set null' }),
    // JSON blob: inference params + context source toggles
    // Tunable product value: AssistantService.create() supplies DEFAULT_ASSISTANT_SETTINGS
    settings: text({ mode: 'json' }).$type<AssistantSettings>().notNull(),
    ...createUpdateDeleteTimestamps
  },
  (t) => [index('assistant_created_at_idx').on(t.createdAt)]
)

export type AssistantInsert = typeof assistantTable.$inferInsert
export type AssistantSelect = typeof assistantTable.$inferSelect
