/**
 * AIHubMix API response schemas
 * Based on https://aihubmix.com/api/v1/models
 */

import * as z from 'zod'

/**
 * Single model entry from AIHubMix API
 */
export const AiHubMixModelSchema = z.object({
  /** Model identifier (e.g., "gpt-4", "claude-3-opus") */
  model_id: z.string(),

  /** Model description */
  desc: z.string(),

  /** Pricing information */
  pricing: z.object({
    /** Cache read pricing (optional, e.g., Anthropic cache hits) */
    cache_read: z.number().optional(),
    /** Cache write pricing (optional, e.g., Anthropic cache writes) */
    cache_write: z.number().optional(),
    /** Input pricing per million tokens */
    input: z.number(),
    /** Output pricing per million tokens */
    output: z.number()
  }),

  /** Model type: "llm" | "image_generation" | "video" */
  types: z.string(),

  /** Comma-separated features: "thinking,tools,function_calling,web,structured_outputs" */
  features: z.string(),

  /** Comma-separated input modalities: "text,image,audio,video" */
  input_modalities: z.string(),

  /** Maximum output tokens */
  max_output: z.number(),

  /** Context window length */
  context_length: z.number()
})

/**
 * AIHubMix API response wrapper
 */
export const AiHubMixResponseSchema = z.object({
  data: z.array(AiHubMixModelSchema)
})

// Type exports
export type AiHubMixModel = z.infer<typeof AiHubMixModelSchema>
export type AiHubMixResponse = z.infer<typeof AiHubMixResponseSchema>
