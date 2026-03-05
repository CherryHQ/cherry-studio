/**
 * Tokenflux API response schema
 */

import * as z from 'zod'

// Architecture schema
export const TokenfluxArchitectureSchema = z.object({
  modality: z.string(),
  input_modalities: z.array(z.string()).nullable(),
  output_modalities: z.array(z.string()).nullable(),
  tokenizer: z.string(),
  instruct_type: z.string().nullable()
})

// Pricing schema - prices are per-token as strings
export const TokenfluxPricingSchema = z.object({
  prompt: z.string(),
  completion: z.string(),
  input_cache_read: z.string().optional(),
  input_cache_write: z.string().optional(),
  request: z.string().optional(),
  image: z.string().optional(),
  web_search: z.string().optional(),
  internal_reasoning: z.string().optional(),
  currency: z.string().optional()
})

// Model schema
export const TokenfluxModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  context_length: z.number(),
  architecture: TokenfluxArchitectureSchema,
  pricing: TokenfluxPricingSchema
})

// Response schema
export const TokenfluxResponseSchema = z.object({
  data: z.array(TokenfluxModelSchema),
  object: z.string().optional()
})

// Type exports
export type TokenfluxArchitecture = z.infer<typeof TokenfluxArchitectureSchema>
export type TokenfluxPricing = z.infer<typeof TokenfluxPricingSchema>
export type TokenfluxModel = z.infer<typeof TokenfluxModelSchema>
export type TokenfluxResponse = z.infer<typeof TokenfluxResponseSchema>
