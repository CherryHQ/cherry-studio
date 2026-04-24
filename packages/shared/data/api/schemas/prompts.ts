/**
 * Prompt API Schema definitions
 *
 * Contains endpoints for Prompt CRUD, version history, and rollback.
 * Entity schemas and types live in `@shared/data/types/prompt`.
 */

import * as z from 'zod'

import {
  type Prompt,
  PromptIdSchema as SharedPromptIdSchema,
  PromptSchema,
  PromptVariablesSchema,
  type PromptVersion,
  PromptVersionNumberSchema
} from '../../types/prompt'
import type { OrderEndpoints } from './_endpointHelpers'

export const PromptIdSchema = SharedPromptIdSchema

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a new prompt. `variables` may be omitted; the service
 * normalizes `undefined` to `null` before persisting. `null` is rejected
 * at the boundary — omit the field to persist as null.
 */
export const CreatePromptSchema = PromptSchema.pick({
  title: true,
  content: true
}).extend({
  variables: PromptVariablesSchema.optional()
})
export type CreatePromptDto = z.infer<typeof CreatePromptSchema>

/**
 * DTO for updating a prompt. All fields optional; the body must contain
 * at least one field. Omitting `variables` leaves the existing value
 * untouched; pass an empty array to clear.
 */
export const UpdatePromptSchema = CreatePromptSchema.partial().refine(
  (dto) => dto.title !== undefined || dto.content !== undefined || dto.variables !== undefined,
  { message: 'At least one field is required' }
)
export type UpdatePromptDto = z.infer<typeof UpdatePromptSchema>

/**
 * DTO for rolling back to an earlier version. Creates a new version whose
 * snapshot mirrors the target, preserving the append-only history invariant.
 */
export const RollbackPromptSchema = z.strictObject({
  version: PromptVersionNumberSchema
})
export type RollbackPromptDto = z.infer<typeof RollbackPromptSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export type PromptSchemas = {
  '/prompts': {
    /** List all prompts, ordered by `orderKey` */
    GET: {
      response: Prompt[]
    }
    /** Create a new prompt (seeds v1 in prompt_version) */
    POST: {
      body: CreatePromptDto
      response: Prompt
    }
  }

  '/prompts/:id': {
    /** Get a prompt by ID */
    GET: {
      params: { id: string }
      response: Prompt
    }
    /** Patch a prompt (creates a new version when content changes) */
    PATCH: {
      params: { id: string }
      body: UpdatePromptDto
      response: Prompt
    }
    /** Delete a prompt and cascade its versions */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  '/prompts/:id/versions': {
    /** Get version history for a prompt, newest first */
    GET: {
      params: { id: string }
      response: PromptVersion[]
    }
  }

  '/prompts/:id/rollback': {
    /** Rollback to a previous version (creates a new version snapshot) */
    POST: {
      params: { id: string }
      body: RollbackPromptDto
      response: Prompt
    }
  }
} & OrderEndpoints<'/prompts'>
