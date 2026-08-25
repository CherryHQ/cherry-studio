/**
 * Prompt API Schema definitions
 *
 * Contains endpoints for Prompt CRUD and ordering.
 * Entity schemas and types live in `@shared/data/types/prompt`.
 */

import * as z from 'zod'

import type { Prompt, PromptBindingRelation, PromptBindingTarget } from '../../types/prompt'
import {
  PromptAgentBindingTargetSchema,
  PromptAssistantBindingTargetSchema,
  PromptBindingTargetSchema,
  PromptIdSchema as SharedPromptIdSchema,
  PromptSchema,
  PromptVisibilitySchema
} from '../../types/prompt'
import type { OrderBatchRequest, OrderEndpoints, OrderRequest } from './_endpointHelpers'

export const PromptIdSchema = SharedPromptIdSchema

// ============================================================================
// DTOs
// ============================================================================

export const CreatePromptSchema = PromptSchema.pick({
  title: true,
  content: true,
  visibility: true
})
  .extend({
    bindingTarget: PromptBindingTargetSchema.optional()
  })
  .refine((dto) => dto.visibility === 'restricted' || dto.bindingTarget === undefined, {
    message: 'Global prompts cannot have an initial binding target',
    path: ['bindingTarget']
  })
export type CreatePromptDto = z.infer<typeof CreatePromptSchema>

export const UpdatePromptSchema = PromptSchema.pick({ title: true, content: true, visibility: true })
  .partial()
  .extend({ expectedBindings: z.array(PromptBindingTargetSchema).optional() })
  .refine((dto) => dto.title !== undefined || dto.content !== undefined || dto.visibility !== undefined, {
    message: 'At least one field is required'
  })
  .refine((dto) => dto.expectedBindings === undefined || dto.visibility === 'global', {
    message: 'Expected bindings are only valid when making a prompt global',
    path: ['expectedBindings']
  })
export type UpdatePromptDto = z.infer<typeof UpdatePromptSchema>

const PromptTextSearchQuerySchema = z.strictObject({
  /** Free-text match against title OR content. */
  search: z.string().trim().min(1).optional()
})

const PromptSearchQuerySchema = PromptTextSearchQuerySchema.extend({ visibility: PromptVisibilitySchema.optional() })

const PromptTargetListQuerySchema = z.discriminatedUnion('targetType', [
  PromptTextSearchQuerySchema.extend({
    targetType: z.literal('assistant'),
    targetId: PromptAssistantBindingTargetSchema.shape.id,
    includeGlobal: z.boolean()
  }),
  PromptTextSearchQuerySchema.extend({
    targetType: z.literal('agent'),
    targetId: PromptAgentBindingTargetSchema.shape.id,
    includeGlobal: z.boolean()
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

export const PromptBindingTargetParamsSchema = z.discriminatedUnion('targetType', [
  z.strictObject({
    targetType: z.literal('assistant'),
    targetId: PromptAssistantBindingTargetSchema.shape.id
  }),
  z.strictObject({
    targetType: z.literal('agent'),
    targetId: PromptAgentBindingTargetSchema.shape.id
  })
])
export type PromptBindingTargetParams = z.infer<typeof PromptBindingTargetParamsSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export type PromptSchemas = {
  '/prompt-bindings': {
    /** List membership edges for prompt usage summaries and binding controls. */
    GET: {
      response: PromptBindingRelation[]
    }
  }

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

  '/prompts/:id/bindings': {
    /** List the contexts currently sharing this prompt. */
    GET: {
      params: { id: string }
      response: PromptBindingTarget[]
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

  '/prompt-bindings/:targetType/:targetId': {
    /** List restricted prompts bound to one context, in context-specific order. */
    GET: {
      params: PromptBindingTargetParams
      response: Prompt[]
    }
  }

  '/prompt-bindings/:targetType/:targetId/:id/order': {
    PATCH: {
      params: PromptBindingParams
      body: OrderRequest
      response: void
    }
  }

  '/prompt-bindings/:targetType/:targetId/order:batch': {
    PATCH: {
      params: PromptBindingTargetParams
      body: OrderBatchRequest
      response: void
    }
  }
} & OrderEndpoints<'/prompts'>
