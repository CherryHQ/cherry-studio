/**
 * Ollama Models API Response Schema
 * Endpoint: GET /api/tags
 */
import * as z from 'zod'

// Single Ollama model
export const OllamaModelSchema = z.object({
  name: z.string(),
  model: z.string().optional(),
  modified_at: z.string().optional(),
  size: z.number().optional(),
  digest: z.string().optional(),
  details: z
    .object({
      parent_model: z.string().optional(),
      format: z.string().optional(),
      family: z.string().optional(),
      families: z.array(z.string()).optional(),
      parameter_size: z.string().optional(),
      quantization_level: z.string().optional()
    })
    .optional()
})

// Ollama tags response
export const OllamaTagsResponseSchema = z.object({
  models: z.array(OllamaModelSchema)
})

// Types derived from schemas
export type OllamaModelResponse = z.infer<typeof OllamaModelSchema>
export type OllamaTagsResponse = z.infer<typeof OllamaTagsResponseSchema>
