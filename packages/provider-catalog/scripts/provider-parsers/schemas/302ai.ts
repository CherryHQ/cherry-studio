/**
 * 302ai API response schema
 */

import * as z from 'zod'

// Price schema - prices are strings like "$1.500 / M tokens"
export const AI302PriceSchema = z.object({
  input_token: z.string().optional(),
  output_token: z.string().optional(),
  per_request: z.string().optional()
})

// Model schema
export const AI302ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  canonical_slug: z.string().optional(),
  object: z.string().optional(),
  category: z.string().optional(),
  category_en: z.string().optional(),
  description: z.string().optional(),
  description_en: z.string().optional(),
  context_length: z.number().optional(),
  max_completion_tokens: z.number().optional(),
  price: AI302PriceSchema.optional(),
  reasoning: z.boolean().optional(),
  supported_tools: z.boolean().optional(),
  capabilities: z.array(z.string()).optional(),
  openai_compatible: z.boolean().optional(),
  is_custom_model: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  is_moderated: z.boolean().optional(),
  type: z.string().optional()
})

// Response schema
export const AI302ResponseSchema = z.object({
  data: z.array(AI302ModelSchema),
  object: z.string().optional()
})

// Type exports
export type AI302Price = z.infer<typeof AI302PriceSchema>
export type AI302Model = z.infer<typeof AI302ModelSchema>
export type AI302Response = z.infer<typeof AI302ResponseSchema>
