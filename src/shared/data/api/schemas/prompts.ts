/**
 * Prompt API Schema definitions
 *
 * Contains endpoints for Prompt CRUD and ordering.
 * Entity schemas and types live in `@shared/data/types/prompt`.
 */

import * as z from 'zod'

import {
  type Prompt,
  PromptAgentBindingTargetSchema,
  PromptAssistantBindingTargetSchema,
  PromptBindingTargetSchema,
  PromptIdSchema as SharedPromptIdSchema,
  PromptSchema
} from '../../types/prompt'
import type { OrderEndpoints } from './_endpointHelpers'

export const PromptIdSchema = SharedPromptIdSchema

// ============================================================================
// DTOs
// ============================================================================

export const CreatePromptSchema = PromptSchema.pick({
  title: true,
  content: true
}).extend({
  bindingTarget: PromptBindingTargetSchema.optional()
})
export type CreatePromptDto = z.infer<typeof CreatePromptSchema>

export const UpdatePromptSchema = PromptSchema.pick({ title: true, content: true })
  .partial()
  .refine((dto) => dto.title !== undefined || dto.content !== undefined, { message: 'At least one field is required' })
export type UpdatePromptDto = z.infer<typeof UpdatePromptSchema>

const PromptSearchQuerySchema = z.strictObject({
  /** Free-text match against title OR content. */
  search: z.string().trim().min(1).optional()
})

const PromptTargetListQuerySchema = z.discriminatedUnion('targetType', [
  PromptSearchQuerySchema.extend({
    targetType: z.literal('assistant'),
    targetId: PromptAssistantBindingTargetSchema.shape.id
  }),
  PromptSearchQuerySchema.extend({
    targetType: z.literal('agent'),
    targetId: PromptAgentBindingTargetSchema.shape.id
  })
])

export const ListPromptsQuerySchema = z.union([PromptSearchQuerySchema, PromptTargetListQuerySchema])
export type ListPromptsQueryParams = z.input<typeof ListPromptsQuerySchema>
export type ListPromptsQuery = z.output<typeof ListPromptsQuerySchema>

export const PromptBindingParamsSchema = z.discriminatedUnion('targetType', [
  z.strictObject({
    id: PromptIdSchema,
    targetType: z.literal('assistant'),
    targetId: PromptAssistantBindingTargetSchema.shape.id
  }),
  z.strictObject({
    id: PromptIdSchema,
    targetType: z.literal('agent'),
    targetId: PromptAgentBindingTargetSchema.shape.id
  })
])
export type PromptBindingParams = z.infer<typeof PromptBindingParamsSchema>

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

  '/prompts/:id/bindings/:targetType/:targetId': {
    /** Idempotently bind a prompt to an Assistant or Agent. */
    PUT: {
      params: PromptBindingParams
      response: void
    }
    /** Idempotently remove a prompt binding without deleting the prompt. */
    DELETE: {
      params: PromptBindingParams
      response: void
    }
  }
} & OrderEndpoints<'/prompts'>
