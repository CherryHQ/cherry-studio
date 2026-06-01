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
import { CANONICAL_PARAM_KEY, MODALITY, MODEL_CAPABILITY, objectValues, REASONING_EFFORT } from './enums'

export const ModalitySchema = z.enum(objectValues(MODALITY))
export type ModalityType = z.infer<typeof ModalitySchema>

export const ModelCapabilityTypeSchema = z.enum(objectValues(MODEL_CAPABILITY))
export type ModelCapabilityType = z.infer<typeof ModelCapabilityTypeSchema>

export const CanonicalParamKeySchema = z.enum(objectValues(CANONICAL_PARAM_KEY))
export type CanonicalParamKeyType = z.infer<typeof CanonicalParamKeySchema>

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
 * Image-generation support describes what controls a model accepts, in a
 * shape uniform across all models so the painting page can render the
 * right controls without per-vendor branching.
 *
 * `supports` is a flat map of canonical param keys to widget specs — the
 * renderer dispatches by `spec.type`. `size` / `numImages` / `customSize`
 * are no longer top-level fields; they're entries inside `supports` like
 * everything else. `modes` is `Record<Mode, ModeDef>` (always an object,
 * never an array) so single-mode models declare `{ generate: { ... } }`
 * uniformly; multi-mode models with different params per mode (Ideogram
 * V_*) declare each mode's complete `ModeDef` explicitly.
 *
 * Vendor wire transforms (snake_case keys, `'ASPECT_X_Y' → 'X:Y'` strings,
 * `Uint8Array → base64`) live in the AI SDK image-model adapters under
 * `aiCore/provider/custom/`; this schema carries canonical names only.
 * Per-mode transport routing (PPIO endpoint URL + sync/async flag) lives
 * on `ModeDef.vendorTransport` so it travels with the registry data.
 */
export const ImageGenerationModeSchema = z.enum(['generate', 'edit', 'remix', 'upscale', 'merge'])

const SwitchSpecSchema = z.object({
  type: z.literal('switch'),
  default: z.boolean().optional()
})

const EnumSpecSchema = z.object({
  type: z.literal('enum'),
  options: z.array(z.string()).min(1),
  default: z.string().optional(),
  /** `'chips'` for compact button rows (size / aspectRatio / imageResolution);
   *  defaults to `'select'` (dropdown) when omitted. */
  render: z.enum(['select', 'chips']).optional(),
  columns: z.number().int().positive().optional()
})

const RangeSpecSchema = z
  .object({
    type: z.literal('range'),
    min: z.number(),
    max: z.number(),
    default: z.number().optional(),
    step: z.number().optional()
  })
  .refine((r) => r.min <= r.max, { message: 'min must be ≤ max' })

const SizeSpecSchema = z.object({
  type: z.literal('size'),
  /** Both width and height share this bound. */
  minSide: z.number(),
  maxSide: z.number(),
  /** When set, the size widget only renders when the named enum is at
   *  `'custom'` (CogView pattern: pick the `'custom'` chip on the size
   *  enum to reveal width/height inputs). */
  pairedEnumKey: z.string().optional()
})

const TextSpecSchema = z.object({
  type: z.literal('text'),
  multiline: z.boolean().optional()
})

export const SupportSpecSchema = z.discriminatedUnion('type', [
  SwitchSpecSchema,
  EnumSpecSchema,
  RangeSpecSchema,
  SizeSpecSchema,
  TextSpecSchema
])

/**
 * Per-mode model capability declaration. The renderer iterates `supports`
 * and dispatches `specToField` by `spec.type`; no per-vendor logic. `supports`
 * keys are drawn from the closed `CanonicalParamKey` vocabulary (see
 * `CANONICAL_PARAM_KEY` in `enums.ts`) — an unknown key fails to parse, and
 * the same vocabulary types the form's `KEY_LABELS`/`OPTION_LABELS` and
 * `canonicalGenerate`'s `POSITIONAL_RENAME`, so a typo/rename is a compile or
 * parse error rather than a silent raw-key render. Adding a new canonical
 * param: (1) add the member to `CANONICAL_PARAM_KEY`, (2) add a label to
 * `KEY_LABELS` in `imageGenerationToFields`, (3) declare it on models'
 * `supports`.
 *
 * `vendorTransport` carries PPIO-style per-model endpoint routing — the
 * AI SDK adapter for that vendor reads endpoint + isSync off the registry
 * instead of a hand-maintained routing table.
 */
const ImageModeDefSchema = z.object({
  supports: z.partialRecord(CanonicalParamKeySchema, SupportSpecSchema),
  vendorTransport: z
    .object({
      endpoint: z.string(),
      isSync: z.boolean().optional()
    })
    .optional(),
  /**
   * When `false`, the generic painting pipeline does NOT enforce a non-empty
   * `painting.prompt` before submitting. Set on models like DashScope's
   * `qwen-mt-image` (image-text translation: no prompt, just source/target
   * languages) or PPIO's image-upscaler / image-eraser / image-remove-bg
   * variants. Default is `true` (prompt required).
   */
  requirePrompt: z.boolean().optional()
})

export const ImageGenerationSupportSchema = z.object({
  // `z.partialRecord` because not every mode is declared — single-mode
  // models only carry `generate`; Ideogram V_* carry generate/remix/upscale
  // but no edit/merge. Zod's plain `z.record(enum, …)` is exhaustive.
  modes: z.partialRecord(ImageGenerationModeSchema, ImageModeDefSchema)
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
export type SupportSpec = z.infer<typeof SupportSpecSchema>
export type ImageModeDef = z.infer<typeof ImageModeDefSchema>
export type ImageGenerationSupport = z.infer<typeof ImageGenerationSupportSchema>
export type ModelPricing = z.infer<typeof ModelPricingSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ModelList = z.infer<typeof ModelListSchema>
