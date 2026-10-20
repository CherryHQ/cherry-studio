import { sql } from 'drizzle-orm'
import { check, index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import {
  type PromptBindingTargetType,
  PromptBindingTargetTypeSchema,
  type PromptVisibility,
  PromptVisibilitySchema
} from '@shared/data/types/prompt'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

const promptBindingTargetTypeCheckValues = PromptBindingTargetTypeSchema.options.map((type) => `'${type}'`).join(', ')
const promptVisibilityCheckValues = PromptVisibilitySchema.options.map((visibility) => `'${visibility}'`).join(', ')

/**
 * Prompt table - user prompt snippets (replaces legacy QuickPhrase).
 */
export const promptTable = sqliteTable(
  'prompt',
  {
    id: uuidPrimaryKey(),
    title: text().notNull(),
    content: text().notNull(),
    visibility: text().$type<PromptVisibility>().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [
    orderKeyIndex('prompt')(t),
    check('prompt_visibility_check', sql`${t.visibility} IN (${sql.raw(promptVisibilityCheckValues)})`)
  ]
)

/**
 * Prompt binding table - associates restricted prompts with an Assistant or Agent.
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
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [
    primaryKey({ columns: [t.promptId, t.targetType, t.targetId] }),
    index('prompt_binding_target_idx').on(t.targetType, t.targetId, t.promptId),
    index('prompt_binding_target_order_key_idx').on(t.targetType, t.targetId, t.orderKey),
    check('prompt_binding_target_type_check', sql`${t.targetType} IN (${sql.raw(promptBindingTargetTypeCheckValues)})`)
  ]
)
