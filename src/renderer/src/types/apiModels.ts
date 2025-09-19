import { z } from 'zod'

// Request schema for /v1/models
export const ApiModelsRequestSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).optional(),
  offset: z.coerce.number().min(0).default(0).optional(),
  limit: z.coerce.number().min(1).optional()
})

// OpenAI compatible model schema
export const OpenAICompatibleModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number(),
  name: z.string(),
  owned_by: z.string(),
  provider: z.string().optional(),
  provider_model_id: z.string().optional()
})

// Response schema for /v1/models
export const ApiModelsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(OpenAICompatibleModelSchema),
  total: z.number().optional(),
  offset: z.number().optional(),
  limit: z.number().optional()
})

// Inferred TypeScript types
export type ApiModelsRequest = z.infer<typeof ApiModelsRequestSchema>
export type OpenAICompatibleModel = z.infer<typeof OpenAICompatibleModelSchema>
export type ApiModelsResponse = z.infer<typeof ApiModelsResponseSchema>
