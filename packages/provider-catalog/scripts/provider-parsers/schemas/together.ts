/**
 * Together API schemas
 * Based on actual API response from https://api.together.xyz/v1/models
 * Verified: 2025-02-03
 *
 * Note: Together returns an array directly, not wrapped in { data: [] }
 */

import * as z from 'zod'

/**
 * Together model config
 */
export const TogetherConfigSchema = z.object({
  chat_template: z.string().nullable(),
  stop: z.array(z.string()),
  bos_token: z.string().nullable(),
  eos_token: z.string().nullable()
})

/**
 * Together model pricing
 */
export const TogetherPricingSchema = z.object({
  hourly: z.number(),
  input: z.number(),
  output: z.number(),
  base: z.number(),
  finetune: z.number()
})

/**
 * Single model entry from Together API
 */
export const TogetherModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number(),
  type: z.string(),
  running: z.boolean(),
  display_name: z.string(),
  organization: z.string(),
  link: z.string(),
  context_length: z.number(),
  config: TogetherConfigSchema,
  pricing: TogetherPricingSchema
})

/**
 * Together API response - returns array directly
 */
export const TogetherResponseSchema = z.array(TogetherModelSchema)

// Type exports
export type TogetherConfig = z.infer<typeof TogetherConfigSchema>
export type TogetherPricing = z.infer<typeof TogetherPricingSchema>
export type TogetherModel = z.infer<typeof TogetherModelSchema>
export type TogetherResponse = z.infer<typeof TogetherResponseSchema>
