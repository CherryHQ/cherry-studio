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

export const PromptVariableInputSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  type: z.literal('input'),
  defaultValue: z.string().optional(),
  placeholder: z.string().optional()
})

export const PromptVariableSelectSchema = z
  .object({
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
  .refine((vars) => new Set(vars.map((v) => v.id)).size === vars.length, {
    message: 'Variable ids must be unique'
  })
  .refine((vars) => new Set(vars.map((v) => v.key)).size === vars.length, {
    message: 'Variable keys must be unique'
  })

// ============================================================================
// Prompt Schemas
// ============================================================================

export const PromptSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  currentVersion: z.number().int().min(1),
  sortOrder: z.number().int().min(0),
  variables: PromptVariablesSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export const PromptVersionSchema = z.object({
  id: z.string().uuid(),
  promptId: z.string().uuid(),
  version: z.number().int().min(1),
  content: z.string(),
  rollbackFrom: z.number().int().min(1).nullable(),
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
