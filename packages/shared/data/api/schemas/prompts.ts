/**
 * Prompt API Schema definitions
 *
 * Contains all prompt-related endpoints for CRUD, version management, and reordering.
 */

import type { Prompt, PromptVersion } from '@shared/data/types/prompt'
import * as z from 'zod'

// ============================================================================
// Zod Schemas for DTOs
// ============================================================================

export const CreatePromptDtoSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1)
})

export const UpdatePromptDtoSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional()
})

export const ReorderPromptsDtoSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      sortOrder: z.number().int().min(0)
    })
  )
})

export const RollbackPromptDtoSchema = z.object({
  version: z.number().int().min(1)
})

// ============================================================================
// DTO Types (inferred from Zod schemas)
// ============================================================================

export type CreatePromptDto = z.infer<typeof CreatePromptDtoSchema>
export type UpdatePromptDto = z.infer<typeof UpdatePromptDtoSchema>
export type ReorderPromptsDto = z.infer<typeof ReorderPromptsDtoSchema>
export type RollbackPromptDto = z.infer<typeof RollbackPromptDtoSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export interface PromptSchemas {
  '/prompts': {
    /** Get all prompts */
    GET: {
      response: Prompt[]
    }
    /** Create a new prompt */
    POST: {
      body: CreatePromptDto
      response: Prompt
    }
  }

  '/prompts/reorder': {
    /** Batch update sort order */
    PATCH: {
      body: ReorderPromptsDto
      response: void
    }
  }

  '/prompts/:id': {
    /** Get a prompt by ID */
    GET: {
      params: { id: string }
      response: Prompt
    }
    /** Update a prompt (auto-creates version if content changed) */
    PATCH: {
      params: { id: string }
      body: UpdatePromptDto
      response: Prompt
    }
    /** Delete a prompt and all its versions */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  '/prompts/:id/versions': {
    /** Get version history for a prompt */
    GET: {
      params: { id: string }
      response: PromptVersion[]
    }
  }

  '/prompts/:id/rollback': {
    /** Rollback to a previous version */
    POST: {
      params: { id: string }
      body: RollbackPromptDto
      response: Prompt
    }
  }
}
