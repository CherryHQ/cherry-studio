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

/**
 * Image-generation parameter support — describes which painting-page inputs
 * a model accepts so a generic painting UI can render the right controls
 * without per-vendor branching. Mirrors the `ParameterSupportSchema` idiom
 * (boolean for simple toggles; `{ range, default }` for numerics; bare
 * string array for enums). All fields are optional — a missing field means
 * "the model doesn't support this control; the UI hides it".
 */
export const ImageGenerationModeSchema = z.enum(['generate', 'edit', 'remix', 'upscale', 'merge'])

/** Pixel sizes (`'1024x1024'`), aspect ratios (`'1:1'`), or both. */
export const ImageSizeModeSchema = z.enum(['pixel', 'aspect', 'either'])

const NumericRangeWithDefaultSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    default: z.number().optional()
  })
  .refine((r) => r.min == null || r.max == null || r.min <= r.max, {
    message: 'min must be less than or equal to max'
  })

/**
 * Image-generation params a model accepts, in registry shape. Used by the
 * top-level `ImageGenerationSupportSchema` AND as the value of the per-mode
 * `modeSchemas` map below — kept as a separate const because the latter
 * references it (partial) and zod doesn't recurse cleanly.
 */
const ImageGenerationParamsShape = z.object({
  sizes: z.array(z.string()).optional(),
  sizeMode: ImageSizeModeSchema.optional(),
  defaultSize: z.string().optional(),
  allowAutoSize: z.boolean().optional(),
  batch: NumericRangeWithDefaultSchema.optional(),
  supports: z
    .object({
      negativePrompt: z.boolean().optional(),
      seed: z.boolean().optional(),
      promptEnhancement: z.boolean().optional(),
      magicPromptOption: z.boolean().optional(),
      numInferenceSteps: NumericRangeWithDefaultSchema.optional(),
      guidanceScale: NumericRangeWithDefaultSchema.optional(),
      safetyTolerance: NumericRangeWithDefaultSchema.optional(),
      quality: z.array(z.string()).optional(),
      moderation: z.array(z.string()).optional(),
      background: z.array(z.string()).optional(),
      aspectRatio: z.array(z.string()).optional(),
      /**
       * Image-resolution tier as a sibling control to size/aspectRatio
       * (gemini-3-pro-image-preview accepts `1K`/`2K`/`4K` independently
       * from its aspect ratio). Rendered as `sizeChips` under the
       * canonical key `imageResolution`; vendors persisting it under a
       * different field name use per-model `keyMap` to alias.
       */
      imageResolution: z.array(z.string()).optional(),
      styleType: z.array(z.string()).optional(),
      renderingSpeed: z.array(z.string()).optional(),
      personGeneration: z.array(z.string()).optional(),
      imageWeight: NumericRangeWithDefaultSchema.optional(),
      resemblance: NumericRangeWithDefaultSchema.optional(),
      detail: NumericRangeWithDefaultSchema.optional()
    })
    .optional(),
  customSize: z
    .object({
      min: z.number(),
      max: z.number()
    })
    .optional(),
  vendorParams: z.record(z.string(), z.unknown()).optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  /**
   * Per-model alias map from canonical field key (used by the painting form
   * renderer and by `imageGenerationToFields`) to the persisted `PaintingData`
   * field name. Layers on top of `PaintingProvider.registryKeyMap` —
   * per-model entries win on collision. Use this when models within the
   * same provider persist the same logical control under different field
   * names (aihubmix stores batch as `n` for gpt-image, `numberOfImages` for
   * imagen, and `numImages` for ideogram).
   */
  keyMap: z.record(z.string(), z.string()).optional()
})

export const ImageGenerationSupportSchema = ImageGenerationParamsShape.extend({
  /** Modes available; `['generate']` assumed when absent. */
  modes: z.array(ImageGenerationModeSchema).optional(),
  /**
   * Per-mode overrides. When a model accepts different params in
   * `edit` / `remix` / `upscale` than in `generate` (Ideogram V_3 remix
   * accepts `imageWeight`, upscale accepts `resemblance`/`detail`),
   * declare those mode-specific shapes here. The painting page derives
   * fields by merging top-level params with `modeSchemas[currentMode]`.
   *
   * Optional — simple single-mode models leave this absent and just use
   * the top-level shape.
   */
  modeSchemas: z.partialRecord(ImageGenerationModeSchema, ImageGenerationParamsShape.partial()).optional()
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

  // Image-generation parameter support — drives the generic painting UI
  // (sizes, batch limits, supports.negativePrompt/seed/quality/…). Only
  // populate for models whose `capabilities` includes `'image-generation'`.
  imageGeneration: ImageGenerationSupportSchema.optional(),

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
export type ImageGenerationMode = z.infer<typeof ImageGenerationModeSchema>
export type ImageSizeMode = z.infer<typeof ImageSizeModeSchema>
export type ImageGenerationSupport = z.infer<typeof ImageGenerationSupportSchema>
export type ModelPricing = z.infer<typeof ModelPricingSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ModelList = z.infer<typeof ModelListSchema>
