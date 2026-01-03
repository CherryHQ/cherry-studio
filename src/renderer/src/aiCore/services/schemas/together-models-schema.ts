/**
 * Together AI Models API Response Schema
 * Endpoint: GET /models
 */
import * as z from 'zod'

// Single Together AI model
export const TogetherModelSchema = z.object({
  id: z.string(),
  display_name: z.string().optional(),
  organization: z.string().optional(),
  description: z.string().optional(),
  context_length: z.number().optional(),
  pricing: z
    .object({
      input: z.number().optional(),
      output: z.number().optional()
    })
    .optional()
})

// Together models response (array at body level based on legacy code)
export const TogetherModelsResponseSchema = z.array(TogetherModelSchema)

// Types derived from schemas
export type TogetherModelResponse = z.infer<typeof TogetherModelSchema>
export type TogetherModelsResponse = z.infer<typeof TogetherModelsResponseSchema>
