/**
 * Hyperbolic API schemas
 * Based on actual API response from https://api.hyperbolic.xyz/v1/models
 * Verified: 2025-02-03
 *
 * Hyperbolic has:
 * - Pricing (input_price, output_price)
 * - Context length
 * - Capabilities (supports_chat, supports_image_input, supports_tools)
 */

import * as z from 'zod'

/**
 * Single model entry from Hyperbolic API
 */
export const HyperbolicModelSchema = z.object({
  id: z.string(),
  created: z.number(),
  object: z.literal('model'),
  owned_by: z.string(),
  number_of_inference_nodes: z.number().nullable(),
  supports_chat: z.boolean(),
  supports_image_input: z.boolean(),
  supports_tools: z.boolean(),
  // These fields can be null for non-LLM models (image gen, TTS, etc.)
  context_length: z.number().nullable(),
  // Pricing per million tokens (inferred from values like 0.4)
  input_price: z.number().nullable(),
  output_price: z.number().nullable()
})

/**
 * Hyperbolic API response wrapper
 */
export const HyperbolicResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(HyperbolicModelSchema)
})

// Type exports
export type HyperbolicModel = z.infer<typeof HyperbolicModelSchema>
export type HyperbolicResponse = z.infer<typeof HyperbolicResponseSchema>
