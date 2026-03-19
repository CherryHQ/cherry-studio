/**
 * Prompt entity types
 *
 * Prompts are user-managed prompt templates with version history.
 * Replaces the legacy QuickPhrase system.
 * Template variables use ${var} syntax in content and are filled inline by the user.
 */

import * as z from 'zod'

// ============================================================================
// Zod Schemas
// ============================================================================

export const PromptSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  currentVersion: z.number().int().min(1),
  sortOrder: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export const PromptVersionSchema = z.object({
  id: z.string().uuid(),
  promptId: z.string().uuid(),
  version: z.number().int().min(1),
  content: z.string(),
  createdAt: z.iso.datetime()
})

// ============================================================================
// Types (inferred from Zod schemas)
// ============================================================================

export type Prompt = z.infer<typeof PromptSchema>
export type PromptVersion = z.infer<typeof PromptVersionSchema>
