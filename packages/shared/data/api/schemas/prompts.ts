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
  content: z.string().min(1),
  assistantId: z.string().optional()
})

export const UpdatePromptDtoSchema = z
  .object({
    title: z.string().min(1).optional(),
    content: z.string().min(1).optional()
  })
  .refine((dto) => dto.title !== undefined || dto.content !== undefined, {
    message: 'At least one field is required'
  })

export const ReorderPromptsDtoSchema = z.object({
  assistantId: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        sortOrder: z.number().int().min(0)
      })
    )
    .min(1)
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

export interface PromptQueryParams {
  /**
   * Filter by prompt scope when assistantId is not provided.
   * - 'all': returns all prompts regardless of association
   * - 'global': returns only prompts not linked to any assistant
   * - undefined (default): behaves the same as 'all'
   *
   * When both assistantId and scope are provided, assistantId takes precedence.
   */
  scope?: 'all' | 'global'
  /** Filter by assistant ID: returns only prompts linked to this assistant */
  assistantId?: string
}

export interface PromptSchemas {
  '/prompts': {
    /** Get prompts. Use query params to filter by scope or assistantId. */
    GET: {
      query?: PromptQueryParams
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
