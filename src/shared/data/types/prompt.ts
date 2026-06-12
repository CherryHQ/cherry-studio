/**
 * Prompt entity types
 *
 * Prompts are user-managed prompt snippets.
 * Replaces the legacy QuickPhrase system.
 */

import * as z from 'zod'

// ============================================================================
// Prompt Schemas
// ============================================================================

/** Prompt IDs are UUIDs from `uuidPrimaryKey()`; migrated legacy quick_phrase IDs are preserved. */
export const PromptIdSchema = z.uuid()
export const PROMPT_TITLE_MAX = 256
export const PROMPT_CONTENT_MAX = 100_000
export const PromptTitleSchema = z.string().trim().min(1).max(PROMPT_TITLE_MAX)
export const PromptContentSchema = z.string().min(1).max(PROMPT_CONTENT_MAX)

/** Complete Prompt entity as returned by the API. */
export const PromptSchema = z.strictObject({
  id: PromptIdSchema,
  title: PromptTitleSchema,
  content: PromptContentSchema,
  orderKey: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

// ============================================================================
// Types (inferred from Zod schemas)
// ============================================================================

export type Prompt = z.infer<typeof PromptSchema>
