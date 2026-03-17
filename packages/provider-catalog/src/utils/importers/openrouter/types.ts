/**
 * OpenRouter API schemas
 * Based on https://openrouter.ai/api/v1/models
 *
 * Note: Many fields are optional because OpenRouter's API response
 * may omit fields for certain model types (e.g., image/audio models).
 */

import * as z from 'zod'

export const OpenRouterModelSchema = z.object({
  /** Model identifier (e.g., "anthropic/claude-3-opus") */
  id: z.string(),

  /** Canonical slug with version (e.g., "anthropic/claude-3-opus-20240229") */
  canonical_slug: z.string().optional(),

  /** Hugging Face model ID if available */
  hugging_face_id: z.string().nullable().optional(),

  /** Display name */
  name: z.string(),

  /** Unix timestamp of model creation */
  created: z.number().optional(),

  /** Model description/documentation */
  description: z.string().optional(),

  /** Maximum context length in tokens */
  context_length: z.number().optional(),

  /** Architecture and modality information */
  architecture: z
    .object({
      /** Modality string (e.g., "text->text", "text+image->text") */
      modality: z.string().optional(),

      /** Input modality types */
      input_modalities: z.array(z.string()).optional(),

      /** Output modality types */
      output_modalities: z.array(z.string()).optional(),

      /** Tokenizer type */
      tokenizer: z.string().optional(),

      /** Instruction type if applicable */
      instruct_type: z.string().nullable().optional()
    })
    .nullable()
    .optional(),

  /** Pricing information (per token as strings) */
  pricing: z
    .object({
      /** Cost per prompt token */
      prompt: z.string().nullable().optional(),

      /** Cost per completion token */
      completion: z.string().nullable().optional(),

      /** Cost per request (base fee) */
      request: z.string().nullable().optional(),

      /** Cost per image in request */
      image: z.string().nullable().optional(),

      /** Cost for web search feature */
      web_search: z.string().nullable().optional(),

      /** Cost for internal reasoning tokens */
      internal_reasoning: z.string().nullable().optional(),

      /** Cost for reading cached inputs */
      input_cache_read: z.string().nullable().optional()
    })
    .nullable()
    .optional(),

  /** Top provider configuration */
  top_provider: z
    .object({
      /** Context length from top provider */
      context_length: z.number().nullable().optional(),

      /** Maximum completion tokens */
      max_completion_tokens: z.number().nullable().optional(),

      /** Whether content is moderated */
      is_moderated: z.boolean().optional()
    })
    .nullable()
    .optional(),

  /** Per-request limits if any */
  per_request_limits: z.record(z.string(), z.any()).nullable().optional(),

  /** Supported API parameters */
  supported_parameters: z.array(z.string()).optional(),

  /** Default parameter values */
  default_parameters: z
    .object({
      temperature: z.number().nullable().optional(),
      top_p: z.number().nullable().optional(),
      frequency_penalty: z.number().nullable().optional()
    })
    .nullable()
    .optional()
})

export const OpenRouterResponseSchema = z.object({
  /** Array of model data */
  data: z.array(OpenRouterModelSchema)
})

// Type exports
export type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>
export type OpenRouterResponse = z.infer<typeof OpenRouterResponseSchema>
