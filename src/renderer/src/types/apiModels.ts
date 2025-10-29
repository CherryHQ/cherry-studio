import { Model } from '@types'
import * as z from 'zod'

import { ProviderTypeSchema } from './provider'

// Request schema for /v1/models
export const ApiModelsFilterSchema = z.object({
  providerType: ProviderTypeSchema.optional(),
  offset: z.coerce.number().min(0).default(0).optional(),
  limit: z.coerce.number().min(1).default(20).optional()
})

// OpenAI compatible model schema
export const ApiModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number(),
  name: z.string(),
  owned_by: z.string(),
  provider: z.string().optional(),
  provider_name: z.string().optional(),
  provider_type: ProviderTypeSchema.optional(),
  provider_model_id: z.string().optional()
})

// Response schema for /v1/models
export const ApiModelsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(ApiModelSchema),
  total: z.number().optional(),
  offset: z.number().optional(),
  limit: z.number().optional()
})

// Inferred TypeScript types
export type ApiModel = z.infer<typeof ApiModelSchema>
export type ApiModelsFilter = z.infer<typeof ApiModelsFilterSchema>
export type ApiModelsResponse = z.infer<typeof ApiModelsResponseSchema>

// Adapted
export type AdaptedApiModel = Model & {
  origin: ApiModel
}
