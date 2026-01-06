/**
 * OpenAI Models API Response Schema
 * Endpoint: GET /v1/models
 */
import * as z from 'zod'

// Single model in OpenAI format
export const OpenAIModelSchema = z.object({
  id: z.string(),
  object: z.literal('model').optional().default('model'),
  created: z.number().optional(),
  owned_by: z.string().optional()
})

// OpenAI models list response
export const OpenAIModelsResponseSchema = z.object({
  data: z.array(OpenAIModelSchema),
  object: z.literal('list').optional()
})

// Types derived from schemas
export type OpenAIModelResponse = z.infer<typeof OpenAIModelSchema>
export type OpenAIModelsResponse = z.infer<typeof OpenAIModelsResponseSchema>
