/**
 * Poe API schemas
 * Based on actual API response from https://api.poe.com/v1/models
 * Verified: 2025-02-03
 *
 * Poe has:
 * - Architecture (input/output modalities)
 * - Pricing (prompt, completion - string format)
 * - Context window (context_length, max_output_tokens)
 * - Metadata (display_name)
 * - Reasoning support info
 */

import * as z from 'zod'

/**
 * Architecture schema
 */
export const PoeArchitectureSchema = z.object({
  input_modalities: z.array(z.string()),
  output_modalities: z.array(z.string()),
  modality: z.string()
})

/**
 * Pricing schema (string format, can be null)
 */
export const PoePricingSchema = z
  .object({
    prompt: z.string(),
    completion: z.string(),
    image: z.string().nullable().optional(),
    request: z.string().nullable().optional(),
    input_cache_read: z.string().nullable().optional(),
    input_cache_write: z.string().nullable().optional()
  })
  .nullable()

/**
 * Context window schema (can be null for some models, fields inside can also be null)
 */
export const PoeContextWindowSchema = z
  .object({
    context_length: z.number().nullable(),
    max_output_tokens: z.number().nullable()
  })
  .nullable()

/**
 * Metadata schema (image field is complex, we only care about display_name)
 */
export const PoeMetadataSchema = z.object({
  display_name: z.string(),
  image: z.any().optional(),
  url: z.string().optional()
})

/**
 * Reasoning schema (can be null)
 */
export const PoeReasoningSchema = z
  .object({
    budget: z
      .object({
        max_tokens: z.number(),
        min_tokens: z.number()
      })
      .optional(),
    required: z.boolean().optional(),
    supports_reasoning_effort: z.boolean().optional()
  })
  .nullable()

/**
 * Single model entry from Poe API
 */
export const PoeModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number(),
  description: z.string(),
  owned_by: z.string(),
  root: z.string(),
  architecture: PoeArchitectureSchema,
  pricing: PoePricingSchema,
  context_window: PoeContextWindowSchema,
  context_length: z.number().nullable(),
  metadata: PoeMetadataSchema,
  reasoning: PoeReasoningSchema,
  parameters: z.array(z.any())
})

/**
 * Poe API response wrapper
 */
export const PoeResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(PoeModelSchema)
})

// Type exports
export type PoeArchitecture = z.infer<typeof PoeArchitectureSchema>
export type PoePricing = z.infer<typeof PoePricingSchema>
export type PoeContextWindow = z.infer<typeof PoeContextWindowSchema>
export type PoeMetadata = z.infer<typeof PoeMetadataSchema>
export type PoeReasoning = z.infer<typeof PoeReasoningSchema>
export type PoeModel = z.infer<typeof PoeModelSchema>
export type PoeResponse = z.infer<typeof PoeResponseSchema>
