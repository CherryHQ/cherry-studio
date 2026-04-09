import type { AssistantSettings } from '@shared/data/types/assistant'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, uuidPrimaryKey } from './_columnHelpers'

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
    prompt: text().default(''),
    emoji: text(),
    description: text().default(''),
    // Default/primary model for this assistant (composite format: "provider::modelId")
    // TODO(model-table-merge): Add FK to model table — .references(() => modelTable.id, { onDelete: 'set null' })
    modelId: text(),
    /** JSON blob: inference params + context source toggles */
    settings: text({ mode: 'json' }).$type<AssistantSettings>(),
    ...createUpdateDeleteTimestamps
  },
  (t) => [index('assistant_created_at_idx').on(t.createdAt)]
)

export type AssistantInsert = typeof assistantTable.$inferInsert
export type AssistantSelect = typeof assistantTable.$inferSelect
