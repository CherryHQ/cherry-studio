/**
 * Jina API schemas
 * Based on actual API response from https://api.jina.ai/v1/models
 * Verified: 2025-02-03
 *
 * Jina has:
 * - Pricing (prompt, completion)
 * - Context length and max output length
 * - Input/output modalities
 * - Supported features
 */

import * as z from 'zod'

/**
 * Jina pricing schema
 */
export const JinaPricingSchema = z.object({
  prompt: z.string(), // String format like "0.00000005"
  completion: z.string(),
  image: z.string().optional(),
  request: z.string().optional(),
  input_cache_read: z.string().optional(),
  input_cache_write: z.string().optional()
})

/**
 * Single model entry from Jina API
 */
export const JinaModelSchema = z.object({
  id: z.string(),
  hugging_face_id: z.string().optional(),
  name: z.string(),
  created: z.number(),
  input_modalities: z.array(z.string()),
  output_modalities: z.array(z.string()),
  quantization: z.string(),
  context_length: z.number(),
  max_output_length: z.number(),
  pricing: JinaPricingSchema,
  supported_sampling_parameters: z.array(z.string()),
  supported_features: z.array(z.string()),
  description: z.string(),
  datacenters: z.array(z.object({ country_code: z.string() })).optional()
})

/**
 * Jina API response wrapper
 */
export const JinaResponseSchema = z.object({
  data: z.array(JinaModelSchema)
})

// Type exports
export type JinaPricing = z.infer<typeof JinaPricingSchema>
export type JinaModel = z.infer<typeof JinaModelSchema>
export type JinaResponse = z.infer<typeof JinaResponseSchema>
