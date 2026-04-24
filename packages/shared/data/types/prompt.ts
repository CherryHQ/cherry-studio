/**
 * Prompt entity types
 *
 * Prompts are user-managed prompt templates with version history.
 * Replaces the legacy QuickPhrase system.
 * Template variables use ${var} syntax in content and are filled inline by the user.
 */

import * as z from 'zod'

// ============================================================================
// PromptVariable Schemas
// ============================================================================

/** Upper bound on variables-per-prompt to keep the JSON column bounded. */
export const PROMPT_VARIABLES_MAX_ITEMS = 50

export const PromptVariableInputSchema = z.strictObject({
  id: z.string().min(1),
  key: z.string().min(1),
  type: z.literal('input'),
  defaultValue: z.string().optional(),
  placeholder: z.string().optional()
})

export const PromptVariableSelectSchema = z
  .strictObject({
    id: z.string().min(1),
    key: z.string().min(1),
    type: z.literal('select'),
    defaultValue: z.string().optional(),
    options: z.array(z.string().min(1)).min(1)
  })
  .refine((v) => v.defaultValue === undefined || v.options.includes(v.defaultValue), {
    message: 'defaultValue must be one of the options'
  })

export const PromptVariableSchema = z.discriminatedUnion('type', [
  PromptVariableInputSchema,
  PromptVariableSelectSchema
])

export const PromptVariablesSchema = z
  .array(PromptVariableSchema)
  .max(PROMPT_VARIABLES_MAX_ITEMS)
  .refine((vars) => new Set(vars.map((v) => v.id)).size === vars.length, {
    message: 'Variable ids must be unique'
  })
  .refine((vars) => new Set(vars.map((v) => v.key)).size === vars.length, {
    message: 'Variable keys must be unique'
  })

// ============================================================================
// Prompt Schemas
// ============================================================================

/** Prompt IDs are UUIDv7 from `uuidPrimaryKeyOrdered()`. */
export const PromptIdSchema = z.uuidv7()
export const PromptTitleSchema = z.string().trim().min(1).max(256)
export const PromptContentSchema = z.string().min(1)
export const PromptVersionNumberSchema = z.number().int().min(1)

/** Complete Prompt entity as returned by the API. */
export const PromptSchema = z.strictObject({
  id: PromptIdSchema,
  title: PromptTitleSchema,
  content: PromptContentSchema,
  currentVersion: PromptVersionNumberSchema,
  variables: PromptVariablesSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export const PromptVersionSchema = z.strictObject({
  id: z.uuidv7(),
  promptId: PromptIdSchema,
  version: PromptVersionNumberSchema,
  content: PromptContentSchema,
  rollbackFrom: PromptVersionNumberSchema.nullable(),
  variables: PromptVariablesSchema.nullable(),
  createdAt: z.iso.datetime()
})

// ============================================================================
// Types (inferred from Zod schemas)
// ============================================================================

export type PromptVariableInput = z.infer<typeof PromptVariableInputSchema>
export type PromptVariableSelect = z.infer<typeof PromptVariableSelectSchema>
export type PromptVariable = z.infer<typeof PromptVariableSchema>
export type Prompt = z.infer<typeof PromptSchema>
export type PromptVersion = z.infer<typeof PromptVersionSchema>
