/**
 * Model - Merged runtime model type
 *
 * This is the "final state" after merging from all data sources.
 * Consumers don't need to know the source - they just use the merged config.
 *
 * Data source priority:
 * 1. user_model (user customization)
 * 2. provider-models.json (catalog provider-level override)
 * 3. models.json (catalog base definition)
 */

import {
  Currency,
  ENDPOINT_TYPE,
  EndpointType,
  MODALITY,
  Modality,
  MODEL_CAPABILITY,
  ModelCapability,
  ReasoningEffort
} from '@cherrystudio/provider-catalog'
import * as z from 'zod'

// Re-export const objects and types for consumers
export { Currency, ENDPOINT_TYPE, EndpointType, MODALITY, Modality, MODEL_CAPABILITY, ModelCapability, ReasoningEffort }

// ═══════════════════════════════════════════════════════════════════════════════
// Zod schemas (formerly in provider-catalog/schemas, now owned by shared)
// ═══════════════════════════════════════════════════════════════════════════════

/** Price per token schema */
export const PricePerTokenSchema = z.object({
  perMillionTokens: z.number().nonnegative().nullable(),
  currency: z.nativeEnum(Currency).default(Currency.USD).optional()
})

/** Thinking token limits */
export const ThinkingTokenLimitsSchema = z.object({
  min: z.number().nonnegative().optional(),
  max: z.number().positive().optional(),
  default: z.number().nonnegative().optional()
})

/** Reasoning effort levels */
const ReasoningEffortSchema = z.enum(ReasoningEffort)

/** Common reasoning fields shared across all reasoning type variants */
const CommonReasoningFieldsSchema = {
  thinkingTokenLimits: ThinkingTokenLimitsSchema.optional(),
  supportedEfforts: z.array(ReasoningEffortSchema).optional(),
  interleaved: z.boolean().optional()
}

/** Parameter support (DB form) */
const NumericRangeSchema = z.object({
  min: z.number(),
  max: z.number()
})

export const ParameterSupportDbSchema = z.object({
  temperature: z.object({ supported: z.boolean(), range: NumericRangeSchema.optional() }).optional(),
  topP: z.object({ supported: z.boolean(), range: NumericRangeSchema.optional() }).optional(),
  topK: z.object({ supported: z.boolean(), range: NumericRangeSchema.optional() }).optional(),
  frequencyPenalty: z.boolean().optional(),
  presencePenalty: z.boolean().optional(),
  maxTokens: z.boolean().optional(),
  stopSequences: z.boolean().optional(),
  systemMessage: z.boolean().optional()
})

/** Separator used in UniqueModelId */
export const UNIQUE_MODEL_ID_SEPARATOR = '::'

/** UniqueModelId type: "providerId::modelId" */
export type UniqueModelId = `${string}${typeof UNIQUE_MODEL_ID_SEPARATOR}${string}`

/**
 * Create a UniqueModelId from provider and model IDs
 * @throws Error if providerId contains the separator
 */
export function createUniqueModelId(providerId: string, modelId: string): UniqueModelId {
  if (providerId.includes(UNIQUE_MODEL_ID_SEPARATOR)) {
    throw new Error(`providerId cannot contain "${UNIQUE_MODEL_ID_SEPARATOR}": ${providerId}`)
  }
  return `${providerId}${UNIQUE_MODEL_ID_SEPARATOR}${modelId}` as UniqueModelId
}

/**
 * Parse a UniqueModelId into its components
 * @throws Error if the format is invalid
 */
export function parseUniqueModelId(uniqueId: UniqueModelId): {
  providerId: string
  modelId: string
} {
  const idx = uniqueId.indexOf(UNIQUE_MODEL_ID_SEPARATOR)
  if (idx === -1) {
    throw new Error(`Invalid UniqueModelId format: ${uniqueId}`)
  }
  return {
    providerId: uniqueId.slice(0, idx),
    modelId: uniqueId.slice(idx + UNIQUE_MODEL_ID_SEPARATOR.length)
  }
}

/**
 * Check if a string is a valid UniqueModelId
 */
export function isUniqueModelId(value: string): value is UniqueModelId {
  return value.includes(UNIQUE_MODEL_ID_SEPARATOR)
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI Tag Constants
// ═══════════════════════════════════════════════════════════════════════════════

/** Capabilities surfaced as filter tags in the UI */
export const UI_CAPABILITY_TAGS = [
  MODEL_CAPABILITY.IMAGE_RECOGNITION,
  MODEL_CAPABILITY.IMAGE_GENERATION,
  MODEL_CAPABILITY.AUDIO_RECOGNITION,
  MODEL_CAPABILITY.AUDIO_GENERATION,
  MODEL_CAPABILITY.VIDEO_GENERATION,
  MODEL_CAPABILITY.EMBEDDING,
  MODEL_CAPABILITY.REASONING,
  MODEL_CAPABILITY.FUNCTION_CALL,
  MODEL_CAPABILITY.WEB_SEARCH,
  MODEL_CAPABILITY.RERANK
] as const

/** A capability that is shown as a UI tag */
export type ModelCapabilityTag = (typeof UI_CAPABILITY_TAGS)[number]

/** All UI-visible model tags: capability-derived + business tags */
export type ModelTag = ModelCapabilityTag | 'free'

/** All possible ModelTag values (for iteration) */
export const ALL_MODEL_TAGS: readonly ModelTag[] = [...UI_CAPABILITY_TAGS, 'free'] as const

export type ThinkingTokenLimits = z.infer<typeof ThinkingTokenLimitsSchema>

/** DB form: supportedEfforts is optional */
export const ReasoningConfigSchema = z.object({
  /** Reasoning type: must match a known reasoning variant */
  type: z.string().regex(/^[a-z][a-z0-9-]*$/, {
    message: 'Reasoning type must be lowercase alphanumeric with hyphens'
  }),
  ...CommonReasoningFieldsSchema
})
export type ReasoningConfig = z.infer<typeof ReasoningConfigSchema>

/** Runtime form: extends DB form — supportedEfforts required, adds defaultEffort */
export const RuntimeReasoningSchema = ReasoningConfigSchema.required({ supportedEfforts: true }).extend({
  /** Default effort level */
  defaultEffort: z.enum(ReasoningEffort).optional()
})

export type RuntimeReasoning = z.infer<typeof RuntimeReasoningSchema>

export type ParameterSupport = z.infer<typeof ParameterSupportDbSchema>

/** Runtime form: strict parameter support with more fields (not derivable from DB form — different shape) */
export const RuntimeParameterSupportSchema = z.object({
  temperature: z
    .object({
      supported: z.boolean(),
      min: z.number(),
      max: z.number(),
      default: z.number().optional()
    })
    .optional(),
  topP: z
    .object({
      supported: z.boolean(),
      min: z.number(),
      max: z.number(),
      default: z.number().optional()
    })
    .optional(),
  topK: z
    .object({
      supported: z.boolean(),
      min: z.number(),
      max: z.number()
    })
    .optional(),
  frequencyPenalty: z.boolean().optional(),
  presencePenalty: z.boolean().optional(),
  maxTokens: z.boolean(),
  stopSequences: z.boolean(),
  systemMessage: z.boolean()
})
export type RuntimeParameterSupport = z.infer<typeof RuntimeParameterSupportSchema>

/** Pricing tier imported from catalog (source of truth) */
export const PricingTierSchema = PricePerTokenSchema
export type PricingTier = z.infer<typeof PricingTierSchema>

export const RuntimeModelPricingSchema = z.object({
  input: PricePerTokenSchema,
  output: PricePerTokenSchema,
  cacheRead: PricePerTokenSchema.optional(),
  cacheWrite: PricePerTokenSchema.optional(),
  perImage: z
    .object({
      price: z.number(),
      unit: z.enum(['image', 'pixel']).optional()
    })
    .optional(),
  perMinute: z
    .object({
      price: z.number()
    })
    .optional()
})
export type RuntimeModelPricing = z.infer<typeof RuntimeModelPricingSchema>

export const ModelSchema = z.object({
  /** Unique identifier: "providerId::modelId" */
  id: z.string() as z.ZodType<UniqueModelId>,
  /** Provider ID */
  providerId: z.string(),
  /** API Model ID - The actual ID used when calling the provider's API */
  apiModelId: z.string().optional(),

  // Display Information
  /** Display name */
  name: z.string(),
  /** Description */
  description: z.string().optional(),
  /** UI grouping */
  group: z.string().optional(),
  /** Model family */
  family: z.string().optional(),
  /** Organization that owns the model */
  ownedBy: z.string().optional(),

  // Capabilities
  /** Final capability list after all merges */
  capabilities: z.array(z.enum(ModelCapability)),
  /** Supported input modalities */
  inputModalities: z.array(z.enum(Modality)).optional(),
  /** Supported output modalities */
  outputModalities: z.array(z.enum(Modality)).optional(),

  // Configuration
  /** Context window size */
  contextWindow: z.number().optional(),
  /** Maximum output tokens */
  maxOutputTokens: z.number().optional(),
  /** Maximum input tokens */
  maxInputTokens: z.number().optional(),
  /** Supported endpoint types */
  endpointTypes: z.array(z.enum(EndpointType)).optional(),
  /** Whether streaming is supported */
  supportsStreaming: z.boolean(),
  /** Reasoning configuration */
  reasoning: RuntimeReasoningSchema.optional(),
  /** Parameter support */
  parameterSupport: RuntimeParameterSupportSchema.optional(),

  pricing: RuntimeModelPricingSchema.optional(),

  // Status
  /** Whether this model is available for use */
  isEnabled: z.boolean(),
  /** Whether this model is hidden from lists */
  isHidden: z.boolean(),
  /** Replacement model if this one is deprecated */
  replaceWith: (z.string() as z.ZodType<UniqueModelId>).optional()
})

export type Model = z.infer<typeof ModelSchema>
