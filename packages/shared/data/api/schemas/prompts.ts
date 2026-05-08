/**
 * Prompt API Schema definitions
 *
 * Contains endpoints for Prompt CRUD and ordering.
 * Entity schemas and types live in `@shared/data/types/prompt`.
 */

import * as z from 'zod'

import { type Prompt, PromptIdSchema as SharedPromptIdSchema, PromptSchema } from '../../types/prompt'
import type { OrderEndpoints } from './_endpointHelpers'

export const PromptIdSchema = SharedPromptIdSchema

// ============================================================================
// DTOs
// ============================================================================

export const CreatePromptSchema = PromptSchema.pick({
  title: true,
  content: true
})
export type CreatePromptDto = z.infer<typeof CreatePromptSchema>

export const UpdatePromptSchema = CreatePromptSchema.partial().refine(
  (dto) => dto.title !== undefined || dto.content !== undefined,
  { message: 'At least one field is required' }
)
export type UpdatePromptDto = z.infer<typeof UpdatePromptSchema>

export const ListPromptsQuerySchema = z.strictObject({
  /** Free-text match against title OR content. */
  search: z.string().trim().min(1).optional()
})
export type ListPromptsQueryParams = z.input<typeof ListPromptsQuerySchema>
export type ListPromptsQuery = z.output<typeof ListPromptsQuerySchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export type PromptSchemas = {
  '/prompts': {
    /** List all prompts, ordered by `orderKey` */
    GET: {
      query?: ListPromptsQueryParams
      response: Prompt[]
    }
    /** Create a new prompt */
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
    /** Patch a prompt */
    PATCH: {
      params: { id: string }
      body: UpdatePromptDto
      response: Prompt
    }
    /** Delete a prompt */
    DELETE: {
      params: { id: string }
      response: void
    }
  }
} & OrderEndpoints<'/prompts'>
