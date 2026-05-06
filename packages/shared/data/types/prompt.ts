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

/** Prompt IDs are UUIDv7 from `uuidPrimaryKeyOrdered()`. */
export const PromptIdSchema = z.uuidv7()
export const PromptTitleSchema = z.string().trim().min(1).max(256)
export const PromptContentSchema = z.string().min(1)

/** Complete Prompt entity as returned by the API. */
export const PromptSchema = z.strictObject({
  id: PromptIdSchema,
  title: PromptTitleSchema,
  content: PromptContentSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

// ============================================================================
// Types (inferred from Zod schemas)
// ============================================================================

export type Prompt = z.infer<typeof PromptSchema>
