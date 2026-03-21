import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { promptTable } from './prompt'

/**
 * Assistant Prompt relation table
 *
 * Maps prompts to specific assistants.
 * Global prompts have no entry in this table.
 */
export const assistantPromptTable = sqliteTable(
  'assistant_prompt',
  {
    // FK to assistant (handled in Redux/Main for now, no hard constraint)
    assistantId: text('assistant_id').notNull(),
    // FK to prompt - CASCADE: remove mapping if prompt is deleted
    promptId: text('prompt_id')
      .notNull()
      .references(() => promptTable.id, { onDelete: 'cascade' }),
    // Sort order within this assistant
    sortOrder: integer('sort_order').notNull().default(0)
  },
  (t) => [
    primaryKey({ columns: [t.assistantId, t.promptId] }),
    index('assistant_prompt_assistant_id_idx').on(t.assistantId)
  ]
)
