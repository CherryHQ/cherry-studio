/**
 * PPIO API schemas
 * Based on actual API response from https://api.ppinfra.com/v3/openai/models
 * Verified: 2025-02-03
 *
 * PPIO has rich metadata including:
 * - Pricing (input_token_price_per_m, output_token_price_per_m) in CNY × 1000 per million tokens
 *   - Example: 2160 means ¥2.16 per million tokens
 *   - Divide by 1000 to get CNY per million tokens
 * - Context size and max output tokens
 * - Model type (chat, embedding, reranker)
 * - Features and endpoints
 * - Input/output modalities
 *
 * Currency: CNY (Chinese Yuan)
 */

import * as z from 'zod'

/**
 * Single model entry from PPIO API
 */
export const PPIOModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number(),
  owned_by: z.string(),
  permission: z.unknown().nullable(),
  root: z.string(),
  parent: z.string(),
  // Pricing per million tokens
  input_token_price_per_m: z.number(),
  output_token_price_per_m: z.number(),
  // Model info
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  // Limits
  context_size: z.number(),
  max_output_tokens: z.number(),
  // Status (1 = active)
  status: z.number(),
  display_name: z.string(),
  // Model type: "chat", "embedding", "reranker"
  model_type: z.string(),
  // Features and capabilities
  features: z.array(z.string()).optional(),
  endpoints: z.array(z.string()),
  input_modalities: z.array(z.string()),
  output_modalities: z.array(z.string())
})

/**
 * PPIO API response wrapper
 */
export const PPIOResponseSchema = z.object({
  data: z.array(PPIOModelSchema)
})

// Type exports
export type PPIOModel = z.infer<typeof PPIOModelSchema>
export type PPIOResponse = z.infer<typeof PPIOResponseSchema>
