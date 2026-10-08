/**
 * Model configuration schema definitions
 * Defines the structure for model metadata, capabilities, and configurations
 */

import * as z from 'zod'

import {
  EndpointTypeSchema,
  MetadataSchema,
  ModelIdSchema,
  NumericRangeSchema,
  PricePerTokenSchema,
  VersionSchema,
  ZodCurrencySchema
} from './common'
import { CANONICAL_PARAM_KEY, CURRENCY, MODALITY, MODEL_CAPABILITY, objectValues, REASONING_EFFORT } from './enums'
import { looseArray } from './forwardCompat'
import { IMAGE_PARAM_CATALOG } from './imageParamCatalog'

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
    values: looseArray(ReasoningEffortSchema, { min: 1 }),
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
 * Which dialect variant of its endpoint's native protocol a model generation
 * speaks. NOT a wire format — the format still follows the serving endpoint.
 * This only disambiguates when one protocol carries two mutually exclusive
 * parameter shapes across model generations, and the older generation
 * hard-rejects the newer field:
 *  - `google-generate-content`: Gemini 3 `thinkingLevel` vs 2.x `thinkingBudget`
 *  - `anthropic-messages`: Claude 4.6+ `thinking.type=adaptive` vs <=4.5
 *    `thinking.type=enabled` + `budget_tokens`
 *
 * Opus 5.5 always uses adaptive thinking; Sonnet 5.5 also supports `between_tools`.
 * It has effect only where the format profile declares the matching alternative, so open-weight models on openai-compatible endpoints are
 * unaffected (their dialect really does follow the provider — see the rule
 * on {@link ReasoningFamilyRuleSchema}).
 */
export const ReasoningWireDialectSchema = z.enum(['effort', 'budget', 'adaptive-always', 'adaptive-between-tools'])
export type ReasoningWireDialect = z.infer<typeof ReasoningWireDialectSchema>

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
 * dialect follows the serving endpoint, not a runtime model-id match. The one
 * narrow exception is `wireDialect`, which does NOT name a format: it picks
 * between the generation-dialects a single first-party protocol defines
 * for itself (see {@link ReasoningWireDialectSchema}). That fact is the
 * vendor's own API contract and holds across every provider proxying it, so
 * it belongs to the model, not the endpoint.
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
    effort: looseArray(ReasoningEffortSchema, { min: 1 }).optional(),
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
    template: z.literal(true).optional(),
    /** Native-protocol dialect for this model generation. */
    wireDialect: ReasoningWireDialectSchema.optional()
  })
  .refine(
    (rule) =>
      rule.template !== true ||
      rule.effort !== undefined ||
      rule.toggle !== undefined ||
      rule.budget !== undefined ||
      rule.wireDialect !== undefined,
    { message: 'a template rule with no knobs declares nothing — drop it or make it a profile' }
  )
export type ReasoningFamilyRule = z.infer<typeof ReasoningFamilyRuleSchema>

// Common reasoning fields shared across all reasoning type variants
// Exported for shared/runtime types to reuse
export const CommonReasoningFieldsSchema = {
  /** Source of truth for the model's reasoning knobs (at most one per kind).
   *  The legacy fields below are DERIVED from it when present. */
  controls: looseArray(ReasoningControlSchema).optional(),
  thinkingTokenLimits: ThinkingTokenLimitsSchema.optional(),
  supportedEfforts: looseArray(ReasoningEffortSchema).optional(),
  /** What the API does when no reasoning param is sent. */
  defaultEffort: ReasoningEffortSchema.optional(),
  /** Native-protocol dialect this model generation speaks, when its protocol
   *  defines more than one. Selects the endpoint profile's wire variant. */
  wireDialect: ReasoningWireDialectSchema.optional()
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

/** Business operations stay independent of image inputs and protocol selection. */
export const ImageOperationSchema = z.enum(['generate', 'remix', 'upscale'])

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
    /** UI interaction increment, not a multiple-of constraint on submitted values.
     *  The catalog value type and min/max define numeric validity. */
    step: z.number().optional()
  })
  .refine((r) => r.min <= r.max, { message: 'min must be ≤ max' })

export const RangeIntSpecSchema = z
  .object({
    type: z.literal('range'),
    min: z.number().int(),
    max: z.number().int(),
    default: z.number().int().optional(),
    step: z.number().int().positive().default(1)
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

const AspectRatioSpecSchema = EnumSpecSchema.extend({
  options: z.array(IMAGE_PARAM_CATALOG.aspectRatio.schema.unwrap()).min(1),
  default: IMAGE_PARAM_CATALOG.aspectRatio.schema
}).refine((spec) => spec.default === undefined || spec.options.includes(spec.default), {
  path: ['default'],
  message: 'Aspect ratio default must be a declared option'
})

function validateAspectRatioSupport(spec: SupportSpec | null | undefined, ctx: z.RefinementCtx): void {
  if (spec === undefined || spec === null) return
  const result = AspectRatioSpecSchema.safeParse(spec)
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue({ ...issue, path: ['aspectRatio', ...issue.path] })
  }
}

const INTEGER_RANGE_PARAM_KEYS = [
  CANONICAL_PARAM_KEY.NUM_IMAGES,
  CANONICAL_PARAM_KEY.MAX_IMAGES,
  CANONICAL_PARAM_KEY.NUM_INFERENCE_STEPS,
  CANONICAL_PARAM_KEY.SAFETY_TOLERANCE,
  CANONICAL_PARAM_KEY.OUTPUT_COMPRESSION
] as const

export const ImageSupportsSchema = z
  .partialRecord(CanonicalParamKeySchema, SupportSpecSchema)
  .superRefine((supports, ctx) => validateAspectRatioSupport(supports.aspectRatio, ctx))
  .transform((supports, ctx) => {
    const normalized = { ...supports }
    for (const key of INTEGER_RANGE_PARAM_KEYS) {
      const spec = supports[key]
      if (spec === undefined) continue
      const result = RangeIntSpecSchema.safeParse(spec)
      if (result.success) {
        normalized[key] = result.data
      } else {
        for (const issue of result.error.issues) ctx.addIssue({ ...issue, path: [key, ...issue.path] })
      }
    }
    return normalized
  })

/** Unknown limits remain explicit rather than claiming an invented maximum. */
const ImageCountSchema = z.strictObject({
  min: z.number().int().nonnegative(),
  max: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('known'), value: z.number().int().nonnegative() }),
    z.strictObject({ kind: z.literal('unknown') })
  ])
})

const ImageInputsSchema = z.strictObject({
  images: ImageCountSchema,
  prompt: z.enum(['required', 'optional']),
  mask: z.enum(['supported', 'unsupported', 'unknown']),
  mediaTypes: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('known'), values: z.array(z.string().regex(/^image\//)).min(1) }),
    z.strictObject({ kind: z.literal('unknown') })
  ])
})

export const ImageProtocolSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sdk') }),
  z.strictObject({
    kind: z.literal('custom'),
    endpoint: z.string().regex(/^\/(?!\/)/, 'image endpoint must be a root-relative path'),
    isSync: z.boolean()
  })
])

export const ImageCapabilitySchema = z
  .strictObject({
    supports: ImageSupportsSchema,
    inputs: ImageInputsSchema,
    protocol: ImageProtocolSchema.optional()
  })
  .superRefine(({ inputs }, ctx) => {
    if (inputs.images.max.kind === 'known' && inputs.images.min > inputs.images.max.value) {
      ctx.addIssue({ code: 'custom', path: ['inputs', 'images'], message: 'minimum image count exceeds maximum' })
    }
  })

export const ImageCapabilityDeltaSchema = z.strictObject({
  supports: z
    .partialRecord(CanonicalParamKeySchema, SupportSpecSchema.nullable())
    .superRefine((supports, ctx) => validateAspectRatioSupport(supports.aspectRatio, ctx))
    .optional(),
  inputs: ImageInputsSchema.partial().extend({ images: ImageCountSchema.partial().optional() }).optional(),
  protocol: ImageProtocolSchema.nullable().optional()
})

export type ImageCapability = z.infer<typeof ImageCapabilitySchema>
export type ImageCapabilityDelta = z.infer<typeof ImageCapabilityDeltaSchema>

/** Canonical keys merge; each supplied spec and protocol is a complete replacement. */
export function applyImageCapabilityDelta(base: ImageCapability, delta: ImageCapabilityDelta): ImageCapability {
  const supports = { ...base.supports }
  for (const key of CanonicalParamKeySchema.options) {
    const spec = delta.supports?.[key]
    if (spec === null) delete supports[key]
    else if (spec !== undefined) supports[key] = spec
  }
  const protocol = delta.protocol === undefined ? base.protocol : delta.protocol
  return ImageCapabilitySchema.parse({
    supports,
    inputs: { ...base.inputs, ...delta.inputs, images: { ...base.inputs.images, ...delta.inputs?.images } },
    ...(protocol === null || protocol === undefined ? {} : { protocol })
  })
}

export const ImageGenerationOverrideSchema = ImageCapabilityDeltaSchema.extend({
  withImages: ImageCapabilityDeltaSchema.nullable().optional(),
  operations: z.partialRecord(ImageOperationSchema, ImageCapabilityDeltaSchema.nullable()).optional()
})

export const ImageGenerationSupportSchema = z
  .strictObject({
    ...ImageCapabilitySchema.shape,
    withImages: ImageCapabilityDeltaSchema.nullable().optional(),
    operations: z.partialRecord(ImageOperationSchema, ImageCapabilityDeltaSchema.nullable()).optional()
  })
  .superRefine((value, ctx) => {
    const base = ImageCapabilitySchema.safeParse({
      supports: value.supports,
      inputs: value.inputs,
      protocol: value.protocol
    })
    if (!base.success) {
      for (const issue of base.error.issues) ctx.addIssue({ ...issue })
      return
    }
    let withImages: ImageCapability | undefined
    if (value.withImages) {
      try {
        withImages = applyImageCapabilityDelta(base.data, value.withImages)
      } catch (error) {
        if (!(error instanceof z.ZodError)) throw error
        for (const issue of error.issues) ctx.addIssue({ ...issue, path: ['withImages', ...issue.path] })
      }
    }
    for (const operation of ImageOperationSchema.options) {
      const delta = value.operations?.[operation]
      if (delta === null || delta === undefined) continue
      const bases = operation === 'generate' && withImages ? [base.data, withImages] : [base.data]
      for (const capability of bases) {
        try {
          applyImageCapabilityDelta(capability, delta)
        } catch (error) {
          if (!(error instanceof z.ZodError)) throw error
          for (const issue of error.issues) {
            ctx.addIssue({ ...issue, path: ['operations', operation, ...issue.path] })
          }
        }
      }
    }
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
const ModelPricingObjectSchema = z.object({
  input: PricePerTokenSchema,
  output: PricePerTokenSchema,

  cacheRead: PricePerTokenSchema.optional(),
  cacheWrite: PricePerTokenSchema.optional(),
  inputTokenTiers: z
    .array(
      z.object({
        minInputTokens: z.number().int().positive().refine(Number.isSafeInteger),
        input: PricePerTokenSchema,
        output: PricePerTokenSchema,
        cacheRead: PricePerTokenSchema.optional(),
        cacheWrite: PricePerTokenSchema.optional()
      })
    )
    .optional(),

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

function validateInputTokenPricingTiers(
  pricing: Partial<z.infer<typeof ModelPricingObjectSchema>>,
  ctx: z.RefinementCtx
): void {
  for (let index = 1; index < (pricing.inputTokenTiers?.length ?? 0); index++) {
    if (pricing.inputTokenTiers![index].minInputTokens <= pricing.inputTokenTiers![index - 1].minInputTokens) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputTokenTiers', index, 'minInputTokens'],
        message: 'minInputTokens must be strictly increasing'
      })
    }
  }

  if (!pricing.inputTokenTiers?.length) return

  const rates = [
    ...(pricing.input ? [{ rate: pricing.input, path: ['input'] }] : []),
    ...(pricing.output ? [{ rate: pricing.output, path: ['output'] }] : []),
    ...(pricing.cacheRead ? [{ rate: pricing.cacheRead, path: ['cacheRead'] }] : []),
    ...(pricing.cacheWrite ? [{ rate: pricing.cacheWrite, path: ['cacheWrite'] }] : []),
    ...pricing.inputTokenTiers.flatMap((tier, index) => [
      { rate: tier.input, path: ['inputTokenTiers', index, 'input'] },
      { rate: tier.output, path: ['inputTokenTiers', index, 'output'] },
      ...(tier.cacheRead ? [{ rate: tier.cacheRead, path: ['inputTokenTiers', index, 'cacheRead'] }] : []),
      ...(tier.cacheWrite ? [{ rate: tier.cacheWrite, path: ['inputTokenTiers', index, 'cacheWrite'] }] : [])
    ])
  ]
  const currency = rates[0]?.rate.currency ?? CURRENCY.USD
  for (const { rate, path } of rates) {
    if ((rate.currency ?? CURRENCY.USD) !== currency) {
      ctx.addIssue({ code: 'custom', path: [...path, 'currency'], message: 'pricing currencies must match' })
    }
  }
}

export const ModelPricingSchema = ModelPricingObjectSchema.superRefine(validateInputTokenPricingTiers)
export const PartialModelPricingSchema = ModelPricingObjectSchema.partial().superRefine(validateInputTokenPricingTiers)

// Model configuration schema
export const ModelConfigSchema = z.object({
  // Basic information
  id: ModelIdSchema,
  name: z.string(),
  description: z.string().optional(),

  // Capabilities
  capabilities: looseArray(ModelCapabilityTypeSchema)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Capabilities must be unique'
    })
    .optional(),

  // Modalities
  inputModalities: looseArray(ModalitySchema)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Input modalities must be unique'
    })
    .optional(),
  outputModalities: looseArray(ModalitySchema)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'Output modalities must be unique'
    })
    .optional(),
  endpointTypes: looseArray(EndpointTypeSchema).optional(),

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
  models: looseArray(ModelConfigSchema)
})

export type ThinkingTokenLimits = z.infer<typeof ThinkingTokenLimitsSchema>
export type ReasoningSupport = z.infer<typeof ReasoningSupportSchema>
export type ParameterSupport = z.infer<typeof ParameterSupportSchema>
export type ImageOperation = z.infer<typeof ImageOperationSchema>
export type SupportSpec = z.infer<typeof SupportSpecSchema>
export type ImageGenerationOverride = z.infer<typeof ImageGenerationOverrideSchema>
export type ImageGenerationSupport = z.infer<typeof ImageGenerationSupportSchema>
export type ModelPricing = z.infer<typeof ModelPricingSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ModelList = z.infer<typeof ModelListSchema>
