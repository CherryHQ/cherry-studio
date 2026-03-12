/**
 * Vercel AI Gateway API response schema
 */

import * as z from 'zod'

// Specification schema
export const VercelSpecificationSchema = z.object({
  specificationVersion: z.string().optional(),
  provider: z.string().optional(),
  modelId: z.string().optional(),
  type: z.string().optional()
})

// Pricing schema - prices are per-token as strings
export const VercelPricingSchema = z.object({
  input: z.string().optional(),
  output: z.string().optional()
})

// Model schema
export const VercelModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  modelType: z.string().optional(),
  tags: z.array(z.string()).optional(),
  specification: VercelSpecificationSchema.optional(),
  pricing: VercelPricingSchema.optional()
})

// Response schema - Vercel uses "models" instead of "data"
export const VercelResponseSchema = z.object({
  models: z.array(VercelModelSchema)
})

// Type exports
export type VercelSpecification = z.infer<typeof VercelSpecificationSchema>
export type VercelPricing = z.infer<typeof VercelPricingSchema>
export type VercelModel = z.infer<typeof VercelModelSchema>
export type VercelResponse = z.infer<typeof VercelResponseSchema>
