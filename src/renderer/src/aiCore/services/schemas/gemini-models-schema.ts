/**
 * Gemini Models API Response Schema
 * Endpoint: GET /v1beta/models
 */
import * as z from 'zod'

// Single Gemini model
export const GeminiModelSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  baseModelId: z.string().optional(),
  inputTokenLimit: z.number().optional(),
  outputTokenLimit: z.number().optional(),
  supportedGenerationMethods: z.array(z.string()).optional()
})

// Gemini models list response
export const GeminiModelsResponseSchema = z.object({
  models: z.array(GeminiModelSchema),
  nextPageToken: z.string().optional()
})

// Types derived from schemas
export type GeminiModelResponse = z.infer<typeof GeminiModelSchema>
export type GeminiModelsResponse = z.infer<typeof GeminiModelsResponseSchema>
