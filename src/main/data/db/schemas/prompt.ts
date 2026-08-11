import { type PromptBindingTargetType, PromptBindingTargetTypeSchema } from '@shared/data/types/prompt'
import { sql } from 'drizzle-orm'
import { check, index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

const promptBindingTargetTypeCheckValues = PromptBindingTargetTypeSchema.options.map((type) => `'${type}'`).join(', ')

/**
 * Prompt table - user prompt snippets (replaces legacy QuickPhrase).
 */
export const promptTable = sqliteTable(
  'prompt',
  {
    id: uuidPrimaryKey(),
    title: text().notNull(),
    content: text().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [orderKeyIndex('prompt')(t)]
)

/**
 * Prompt binding table - associates global prompts with an Assistant or Agent.
 *
 * The polymorphic target has no FK. Target-owning services must call
 * `PromptService.purgeForTargetTx()` when deleting an Assistant or Agent.
 */
export const promptBindingTable = sqliteTable(
  'prompt_binding',
  {
    promptId: text()
      .notNull()
      .references(() => promptTable.id, { onDelete: 'cascade' }),
    targetType: text().$type<PromptBindingTargetType>().notNull(),
    targetId: text().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    primaryKey({ columns: [t.promptId, t.targetType, t.targetId] }),
    index('prompt_binding_target_idx').on(t.targetType, t.targetId, t.promptId),
    check('prompt_binding_target_type_check', sql`${t.targetType} IN (${sql.raw(promptBindingTargetTypeCheckValues)})`)
  ]
)
