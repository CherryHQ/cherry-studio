/**
 * Prompt API Schema definitions
 *
 * Contains all prompt-related endpoints for CRUD and version management.
 */

import type { Prompt, PromptVersion } from '@shared/data/types/prompt'
import { PromptVariablesSchema } from '@shared/data/types/prompt'
import * as z from 'zod'

// ============================================================================
// Zod Schemas for DTOs
// ============================================================================

export const CreatePromptDtoSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  variables: PromptVariablesSchema.nullable().optional()
})

export const UpdatePromptDtoSchema = z
  .object({
    title: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    sortOrder: z.number().int().min(0).optional(),
    variables: PromptVariablesSchema.nullable().optional()
  })
  .refine(
    (dto) =>
      dto.title !== undefined ||
      dto.content !== undefined ||
      dto.sortOrder !== undefined ||
      dto.variables !== undefined,
    {
      message: 'At least one field is required'
    }
  )

export const RollbackPromptDtoSchema = z.object({
  version: z.number().int().min(1)
})

/** Uses z.string().uuid() because prompt IDs are always UUIDv7 from uuidPrimaryKeyOrdered() */
export const ReorderPromptsDtoSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1)
})

// ============================================================================
// DTO Types (inferred from Zod schemas)
// ============================================================================

export type CreatePromptDto = z.infer<typeof CreatePromptDtoSchema>
export type UpdatePromptDto = z.infer<typeof UpdatePromptDtoSchema>
export type RollbackPromptDto = z.infer<typeof RollbackPromptDtoSchema>
export type ReorderPromptsDto = z.infer<typeof ReorderPromptsDtoSchema>

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
    /** Reorder prompts by providing ordered IDs */
    POST: {
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
