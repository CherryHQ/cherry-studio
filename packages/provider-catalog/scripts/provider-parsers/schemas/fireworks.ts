/**
 * Fireworks API schemas
 * Based on actual API response from https://api.fireworks.ai/inference/v1/models
 * Verified: 2025-02-03
 */

import * as z from 'zod'

/**
 * Single model entry from Fireworks API
 */
export const FireworksModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  owned_by: z.string(),
  created: z.number(),
  kind: z.string(),
  supports_chat: z.boolean(),
  supports_image_input: z.boolean(),
  supports_tools: z.boolean(),
  context_length: z.number()
})

/**
 * Fireworks API response wrapper
 */
export const FireworksResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(FireworksModelSchema)
})

// Type exports
export type FireworksModel = z.infer<typeof FireworksModelSchema>
export type FireworksResponse = z.infer<typeof FireworksResponseSchema>
