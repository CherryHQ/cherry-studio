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

/**
 * Per-model reasoning control declaration — the SOURCE from which the legacy
 * pair (`supportedEfforts` / `thinkingTokenLimits`) is DERIVED at generation
 * time (`deriveLegacyReasoningFields`). Kinds align 1:1 with models.dev
 * `reasoning_options` so upstream ingestion is lossless.
 */
export const ReasoningControlSchema = z.discriminatedUnion('kind', [
  z.object({
    /** Discrete effort knob. `values` is the model's intrinsic vocabulary, in
     *  UI display order. The active endpoint profile may map those values to a
     *  narrower wire vocabulary (`'none'` present ⇔ reasoning can be disabled). */
    kind: z.literal('effort'),
    values: z.array(ReasoningEffortSchema).min(1),
    default: ReasoningEffortSchema.optional()
  }),
  z.object({
    /** Numeric thinking-token budget knob. */
    kind: z.literal('budget'),
    min: z.number().nonnegative(),
    max: z.number().positive(),
    default: z.number().nonnegative().optional()
  }),
  z.object({
    /** On/off only — no effort levels, no budget. */
    kind: z.literal('toggle'),
    default: z.boolean().optional()
  })
])
export type ReasoningControl = z.infer<typeof ReasoningControlSchema>

/**
 * A creator-declared reasoning FAMILY rule — ID-pattern knowledge as DATA
 * (#16598). Creators declare these next to their models (`Creator.
 * reasoningFamilies`); generation compiles them into per-model `controls`
 * and the shipped `patterns/reasoning-families.gen.ts` artifact consumed by
 * the zero-knowledge matchers.
 *
 * Every rule is one of two semantic kinds:
 *  - PROFILE (default): "this pattern IS a reasoning SKU (with knobs K)".
 *    Membership is implied — the ingest gate (`inferReasoningMembership`)
 *    accepts any id a profile rule matches. A profile may carry no knobs at
 *    all (a fixed reasoner: reasons, nothing to tune).
 *  - TEMPLATE (`template: true`): "models of this family that DO reason use
 *    knob shape K". Deliberately broader than membership (e.g. the `^qwen`
 *    toggle) — contributes knobs only, never membership; SKUs are admitted
 *    by profile rules, the generic id shapes, or a declared capability.
 *
 * A rule carries MODEL KNOBS ONLY — never a reasoning format/wire field:
 * open-weight models are served by many providers and the serialization
 * dialect follows the serving endpoint, not a runtime model-id match.
 *
 * Matching: `pattern` is a case-insensitive regex SOURCE tested against the
 * lowercased, namespace-stripped id (vocabulary part) and the raw id string
 * (budget part — token-limit callers pass `provider::model` unique ids, so
 * budget-only rules should stay unanchored). Patterns must be
 * vendor-specific (same discipline as `idPrefixes`). Within a creator,
 * declaration order is match priority — first rule wins per part.
 */
const compilableRegexSource = z.string().refine(
  (source) => {
    try {
      new RegExp(source, 'i')
      return true
    } catch {
      return false
    }
  },
  { message: 'pattern must be a valid regular expression' }
)

export const ReasoningFamilyRuleSchema = z
  .object({
    /** Case-insensitive regex source. Must compile. */
    pattern: compilableRegexSource,
    /** Intrinsic effort vocabulary, in UI display order. */
    effort: z.array(ReasoningEffortSchema).min(1).optional(),
    /**
     * Thinking on/off switch. `false` is an EXPLICIT "always-on, no switch"
     * declaration that stops broader family rules below from applying
     * (e.g. qwen3 `*-thinking` SKUs vs the generic qwen toggle).
     */
    toggle: z.boolean().optional(),
    /** Thinking-token budget range. */
    budget: z
      .object({
        min: z.number().nonnegative(),
        max: z.number().positive()
      })
      .refine((b) => b.min <= b.max, { message: 'budget min must be <= max' })
      .optional(),
    /** Knob-shape template for a broad family — contributes NO membership. */
    template: z.literal(true).optional()
  })
  .refine(
    (rule) =>
      rule.template !== true || rule.effort !== undefined || rule.toggle !== undefined || rule.budget !== undefined,
    { message: 'a template rule with no knobs declares nothing — drop it or make it a profile' }
  )
export type ReasoningFamilyRule = z.infer<typeof ReasoningFamilyRuleSchema>

// Common reasoning fields shared across all reasoning type variants
// Exported for shared/runtime types to reuse
export const CommonReasoningFieldsSchema = {
  /** Source of truth for the model's reasoning knobs (at most one per kind).
   *  The legacy fields below are DERIVED from it when present. */
  controls: z.array(ReasoningControlSchema).optional(),
  thinkingTokenLimits: ThinkingTokenLimitsSchema.optional(),
  supportedEfforts: z.array(ReasoningEffortSchema).optional(),
  /** What the API does when no reasoning param is sent. */
  defaultEffort: ReasoningEffortSchema.optional()
}

/**
 * Reasoning support schema — describes model-level reasoning capabilities.
 *
 * This only captures WHAT the model supports (effort levels, token limits).
 * HOW to invoke reasoning is defined by the provider's reasoning format
 * (see provider.ts ProviderReasoningFormatSchema).
 */
export const ReasoningSupportSchema = z
  .object({
    ...CommonReasoningFieldsSchema
  })
  .superRefine((r, ctx) => {
    const kinds = (r.controls ?? []).map((c) => c.kind)
    if (new Set(kinds).size !== kinds.length) {
      ctx.addIssue({ code: 'custom', message: 'at most one reasoning control per kind' })
    }
    for (const c of r.controls ?? []) {
      if (c.kind === 'effort' && c.default != null && !c.values.includes(c.default)) {
        ctx.addIssue({ code: 'custom', message: 'effort default must be a member of values' })
      }
      if (c.kind === 'budget' && (c.min > c.max || (c.default != null && (c.default < c.min || c.default > c.max)))) {
        ctx.addIssue({ code: 'custom', message: 'budget range must satisfy min <= default <= max' })
      }
    }
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
