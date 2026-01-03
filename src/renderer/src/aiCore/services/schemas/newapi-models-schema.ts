/**
 * NewAPI Models API Response Schema
 * Endpoint: GET /models
 * Extends OpenAI format with additional fields
 */
import type { EndpointType } from '@renderer/types'
import * as z from 'zod'

// NewAPI model extends OpenAI model with endpoint types
export const NewApiModelSchema = z.object({
  id: z.string(),
  object: z.literal('model').optional().default('model'),
  created: z.number().optional(),
  owned_by: z.string().optional(),
  // NewAPI specific field
  supported_endpoint_types: z
    .array(z.enum(['openai', 'anthropic', 'gemini', 'openai-response', 'image-generation']))
    .optional()
})

// NewAPI models list response
export const NewApiModelsResponseSchema = z.object({
  data: z.array(NewApiModelSchema),
  object: z.literal('list').optional()
})

// Types derived from schemas
export type NewApiModelResponse = z.infer<typeof NewApiModelSchema> & {
  supported_endpoint_types?: EndpointType[]
}
export type NewApiModelsResponse = z.infer<typeof NewApiModelsResponseSchema>
