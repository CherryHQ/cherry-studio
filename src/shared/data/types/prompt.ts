/**
 * Prompt entity types
 *
 * Prompts are user-managed prompt snippets.
 * Replaces the legacy QuickPhrase system.
 */

import * as z from 'zod'

import { AssistantIdSchema } from './assistant'

// ============================================================================
// Prompt Schemas
// ============================================================================

/** Prompt IDs are UUIDs from `uuidPrimaryKey()`; migration preserves valid, non-conflicting legacy IDs. */
export const PromptIdSchema = z.uuid()
export const PROMPT_TITLE_MAX = 256
export const PROMPT_CONTENT_MAX = 100_000
export const PromptTitleSchema = z.string().trim().min(1).max(PROMPT_TITLE_MAX)
export const PromptContentSchema = z.string().min(1).max(PROMPT_CONTENT_MAX)
export const PromptVisibilitySchema = z.enum(['global', 'restricted'])

export const PromptBindingTargetTypeSchema = z.enum(['assistant', 'agent'])
export const PromptAssistantBindingTargetSchema = z.strictObject({
  type: z.literal('assistant'),
  id: AssistantIdSchema
})
export const PromptAgentBindingTargetSchema = z.strictObject({
  type: z.literal('agent'),
  id: z.string().min(1)
})
export const PromptBindingTargetSchema = z.discriminatedUnion('type', [
  PromptAssistantBindingTargetSchema,
  PromptAgentBindingTargetSchema
])

export const PromptBindingRelationSchema = z.discriminatedUnion('targetType', [
  z.strictObject({
    promptId: PromptIdSchema,
    targetType: z.literal('assistant'),
    targetId: AssistantIdSchema
  }),
  z.strictObject({
    promptId: PromptIdSchema,
    targetType: z.literal('agent'),
    targetId: z.string().min(1)
  })
])

/** Complete Prompt entity as returned by the API. */
export const PromptSchema = z.strictObject({
  id: PromptIdSchema,
  title: PromptTitleSchema,
  content: PromptContentSchema,
  visibility: PromptVisibilitySchema,
  orderKey: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

// ============================================================================
// Types (inferred from Zod schemas)
// ============================================================================

export type Prompt = z.infer<typeof PromptSchema>
export type PromptVisibility = z.infer<typeof PromptVisibilitySchema>
export type PromptBindingTargetType = z.infer<typeof PromptBindingTargetTypeSchema>
export type PromptBindingTarget = z.infer<typeof PromptBindingTargetSchema>
export type PromptBindingRelation = z.infer<typeof PromptBindingRelationSchema>
