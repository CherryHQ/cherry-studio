/**
 * Model configuration schema definitions
 * Defines the structure for model metadata, capabilities, and configurations
 */

import * as z from 'zod'

import {
  MetadataSchema,
  ModelIdSchema,
  NumericRangeSchema,
  PricePerTokenSchema,
  VersionSchema,
  ZodCurrencySchema
} from './common'
import { MODALITY, MODEL_CAPABILITY, objectValues, REASONING_EFFORT } from './enums'

export const ModalitySchema = z.enum(objectValues(MODALITY))
export type ModalityType = z.infer<typeof ModalitySchema>

export const ModelCapabilityTypeSchema = z.enum(objectValues(MODEL_CAPABILITY))
export type ModelCapabilityType = z.infer<typeof ModelCapabilityTypeSchema>

// Thinking token limits schema (shared across reasoning types)
// min and max must be both present or both absent; when present, min <= max
export const ThinkingTokenLimitsSchema = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().positive().optional(),
    default: z.number().nonnegative().optional()
  })
  .refine((d) => (d.min == null) === (d.max == null), {
    message: 'min and max must be both present or both absent'
  })
  .refine((d) => d.min == null || d.max == null || d.min <= d.max, {
    message: 'min must be less than or equal to max'
  })

/** Reasoning effort levels shared across providers */
export const ReasoningEffortSchema = z.enum(objectValues(REASONING_EFFORT))

// Common reasoning fields shared across all reasoning type variants
// Exported for shared/runtime types to reuse
export const CommonReasoningFieldsSchema = {
  thinkingTokenLimits: ThinkingTokenLimitsSchema.optional(),
  supportedEfforts: z.array(ReasoningEffortSchema).optional()
}

/**
 * Reasoning support schema — describes model-level reasoning capabilities.
 *
 * This only captures WHAT the model supports (effort levels, token limits).
 * HOW to invoke reasoning is defined by the provider's reasoning format
 * (see provider.ts ProviderReasoningFormatSchema).
 */
export const ReasoningSupportSchema = z.object({
  ...CommonReasoningFieldsSchema
})

// Parameter support configuration
// Defaults reflect the most common LLM provider capabilities
export const ParameterSupportSchema = z.object({
  temperature: z
    .object({
      supported: z.boolean(),
      range: NumericRangeSchema.optional()
    })
    .default({ supported: true }),

  topP: z
    .object({
      supported: z.boolean(),
      range: NumericRangeSchema.optional()
    })
    .default({ supported: true }),

  topK: z
    .object({
      supported: z.boolean(),
      range: NumericRangeSchema.optional()
    })
    .default({ supported: false }),

  frequencyPenalty: z.boolean().default(true),
  presencePenalty: z.boolean().default(true),
  maxTokens: z.boolean().default(true),
  stopSequences: z.boolean().default(true),
  systemMessage: z.boolean().default(true)
})

/**
 * Model pricing configuration.
 *
 * Pricing tiers based on actual provider billing models:
 * - input/output per-token: OpenAI, Anthropic, Google, all major LLM providers
 * - cacheRead/cacheWrite: Anthropic prompt caching, OpenAI cached tokens
 * - perImage: DALL-E (per-image), Midjourney (per-image)
 * - perMinute: Whisper, ElevenLabs (per-minute audio billing)
 */
export const ModelPricingSchema = z.object({
  input: PricePerTokenSchema,
  output: PricePerTokenSchema,

  cacheRead: PricePerTokenSchema.optional(),
  cacheWrite: PricePerTokenSchema.optional(),

  perImage: z
    .object({
      price: z.number(),
      currency: ZodCurrencySchema,
      unit: z.enum(['image', 'pixel']).optional()
    })
    .optional(),

  perMinute: z
    .object({
      price: z.number(),
      currency: ZodCurrencySchema
    })
    .optional()
})

// Model configuration schema
export const ModelConfigSchema = z.object({
  // Basic information
  id: ModelIdSchema,
  name: z.string(),
  description: z.string().optional(),

  // Capabilities
  capabilities: z
    .array(ModelCapabilityTypeSchema)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Capabilities must be unique'
    })
    .optional(),

  // Modalities
  inputModalities: z
    .array(ModalitySchema)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Input modalities must be unique'
    })
    .optional(),
  outputModalities: z
    .array(ModalitySchema)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Output modalities must be unique'
    })
    .optional(),

  // Limits
  contextWindow: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  maxInputTokens: z.number().optional(),

  // Pricing
  pricing: ModelPricingSchema.optional(),

  // Reasoning support (model capabilities only, no provider-specific params)
  reasoning: ReasoningSupportSchema.optional(),

  // Parameter support
  parameterSupport: ParameterSupportSchema.optional(),

  // Model family (e.g., "GPT-4", "Claude 3")
  family: z.string().optional(),

  // Original creator of the model (e.g., "anthropic", "google", "openai")
  // This is the original publisher/creator, not the aggregator that hosts the model
  ownedBy: z.string().optional(),

  // Whether the model has open weights (from models.dev)
  openWeights: z.boolean().optional(),

  // Additional metadata
  metadata: MetadataSchema
})

// Model list container schema for JSON files
export const ModelListSchema = z.object({
  version: VersionSchema,
  models: z.array(ModelConfigSchema)
})

export type ThinkingTokenLimits = z.infer<typeof ThinkingTokenLimitsSchema>
export type ReasoningSupport = z.infer<typeof ReasoningSupportSchema>
export type ParameterSupport = z.infer<typeof ParameterSupportSchema>
export type ModelPricing = z.infer<typeof ModelPricingSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ModelList = z.infer<typeof ModelListSchema>
