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

import type {
  Currency,
  EndpointType,
  Modality,
  ModelCapability,
  ReasoningEffort
} from '@cherrystudio/provider-registry'
import {
  CURRENCY,
  ENDPOINT_TYPE,
  MODALITY,
  MODEL_CAPABILITY,
  objectValues,
  REASONING_EFFORT
} from '@cherrystudio/provider-registry'
import * as z from 'zod'

// Re-export const objects for consumers
export { CURRENCY, ENDPOINT_TYPE, MODALITY, MODEL_CAPABILITY, objectValues, REASONING_EFFORT }

// Re-export types for consumers
export type { Currency, EndpointType, Modality, ModelCapability, ReasoningEffort }

/** Price per token schema */
export const PricePerTokenSchema = z.object({
  perMillionTokens: z.number().nonnegative().nullable(),
  currency: z.enum(objectValues(CURRENCY)).default(CURRENCY.USD).optional()
})

/** Thinking token limits */
export const ThinkingTokenLimitsSchema = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().positive().optional(),
    default: z.number().nonnegative().optional()
  })
  .refine((limits) => limits.min === undefined || limits.max === undefined || limits.min <= limits.max, {
    message: 'min must be less than or equal to max',
    path: ['min']
  })

/** Reasoning effort levels */
const ReasoningEffortSchema = z.enum(objectValues(REASONING_EFFORT))

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
const RESERVED_UNIQUE_MODEL_ID_ROUTE_CHARS = ['?', '#'] as const

/** UniqueModelId type: "providerId::modelId" */
export type UniqueModelId = `${string}${typeof UNIQUE_MODEL_ID_SEPARATOR}${string}`

/**
 * Single source of truth for whether a value is a valid encoded UniqueModelId.
 * `createUniqueModelId`, `parseUniqueModelId`, and `UniqueModelIdSchema` all
 * delegate here so their accept/reject sets stay aligned.
 */
export function isUniqueModelId(value: unknown): value is UniqueModelId {
  if (typeof value !== 'string') return false
  const idx = value.indexOf(UNIQUE_MODEL_ID_SEPARATOR)
  if (idx <= 0) return false
  const modelId = value.slice(idx + UNIQUE_MODEL_ID_SEPARATOR.length)
  if (modelId.length === 0) return false
  return !RESERVED_UNIQUE_MODEL_ID_ROUTE_CHARS.some((char) => modelId.includes(char))
}

/** Zod schema for UniqueModelId with runtime validation */
export const UniqueModelIdSchema = z.custom<UniqueModelId>(isUniqueModelId, {
  message: `Must be a valid UniqueModelId (providerId${UNIQUE_MODEL_ID_SEPARATOR}modelId)`
})

/**
 * Create a UniqueModelId from provider and model IDs.
 * @throws Error with a per-field reason when either id is empty, providerId
 * contains the separator, or modelId contains a reserved route character.
 */
export function createUniqueModelId(providerId: string, modelId: string): UniqueModelId {
  if (providerId.length === 0) {
    throw new Error('providerId cannot be empty')
  }
  if (providerId.includes(UNIQUE_MODEL_ID_SEPARATOR)) {
    throw new Error(`providerId cannot contain "${UNIQUE_MODEL_ID_SEPARATOR}": ${providerId}`)
  }
  if (modelId.length === 0) {
    throw new Error('modelId cannot be empty')
  }
  const reservedChar = RESERVED_UNIQUE_MODEL_ID_ROUTE_CHARS.find((char) => modelId.includes(char))
  if (reservedChar) {
    throw new Error(`modelId cannot contain reserved route character "${reservedChar}": ${modelId}`)
  }
  return `${providerId}${UNIQUE_MODEL_ID_SEPARATOR}${modelId}`
}

/**
 * Parse a UniqueModelId into its components.
 * @throws Error if the value does not satisfy `isUniqueModelId`.
 */
export function parseUniqueModelId(uniqueId: UniqueModelId): {
  providerId: string
  modelId: string
} {
  if (!isUniqueModelId(uniqueId)) {
    throw new Error(`Invalid UniqueModelId format: ${uniqueId}`)
  }
  const idx = uniqueId.indexOf(UNIQUE_MODEL_ID_SEPARATOR)
  return {
    providerId: uniqueId.slice(0, idx),
    modelId: uniqueId.slice(idx + UNIQUE_MODEL_ID_SEPARATOR.length)
  }
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
  defaultEffort: z.enum(objectValues(REASONING_EFFORT)).optional()
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
  id: UniqueModelIdSchema,
  /** Provider ID */
  providerId: z.string(),
  /** API Model ID - The actual ID used when calling the provider's API */
  apiModelId: z.string().optional(),
  /** Preset catalog model ID this row was created from, if any */
  presetModelId: z.string().nullable().optional(),

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
  capabilities: z.array(z.enum(objectValues(MODEL_CAPABILITY))),
  /** Supported input modalities */
  inputModalities: z.array(z.enum(objectValues(MODALITY))).optional(),
  /** Supported output modalities */
  outputModalities: z.array(z.enum(objectValues(MODALITY))).optional(),

  // Configuration
  /** Context window size */
  contextWindow: z.number().optional(),
  /** Maximum output tokens */
  maxOutputTokens: z.number().optional(),
  /** Maximum input tokens */
  maxInputTokens: z.number().optional(),
  /** Supported endpoint types */
  endpointTypes: z.array(z.enum(objectValues(ENDPOINT_TYPE))).optional(),
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
  /** Whether this model has been deprecated by provider sync */
  isDeprecated: z.boolean().optional(),
  /** Replacement model if this one is deprecated */
  replaceWith: UniqueModelIdSchema.optional(),

  // UI metadata
  /** Sort order in provider's model list */
  sortOrder: z.number().optional(),
  /** User notes about this model */
  notes: z.string().optional()
})

export type Model = z.infer<typeof ModelSchema>
