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
  CommonReasoningFieldsSchema,
  EndpointType,
  Modality,
  ModelCapability,
  ParameterSupportSchema as CatalogParameterSupportSchema,
  PricePerTokenSchema,
  ThinkingTokenLimitsSchema
} from '@cherrystudio/provider-catalog/schemas'

// Re-export enums for consumers
export { EndpointType, Modality, ModelCapability }
import * as z from 'zod'

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
  ModelCapability.IMAGE_RECOGNITION,
  ModelCapability.IMAGE_GENERATION,
  ModelCapability.AUDIO_RECOGNITION,
  ModelCapability.AUDIO_GENERATION,
  ModelCapability.VIDEO_GENERATION,
  ModelCapability.EMBEDDING,
  ModelCapability.REASONING,
  ModelCapability.FUNCTION_CALL,
  ModelCapability.WEB_SEARCH,
  ModelCapability.RERANK
] as const

/** A capability that is shown as a UI tag */
export type ModelCapabilityTag = (typeof UI_CAPABILITY_TAGS)[number]

/** All UI-visible model tags: capability-derived + business tags */
export type ModelTag = ModelCapabilityTag | 'free'

/** All possible ModelTag values (for iteration) */
export const ALL_MODEL_TAGS: readonly ModelTag[] = [...UI_CAPABILITY_TAGS, 'free'] as const

// Re-export from catalog (source of truth)
export { ThinkingTokenLimitsSchema }
export type ThinkingTokenLimits = z.infer<typeof ThinkingTokenLimitsSchema>

/** DB form: supportedEfforts is optional */
export const ReasoningConfigSchema = z.object({
  /** Reasoning type: 'openai-chat', 'anthropic', 'gemini', etc. */
  type: z.string(),
  ...CommonReasoningFieldsSchema
})
export type ReasoningConfig = z.infer<typeof ReasoningConfigSchema>

/** Runtime form: extends DB form — supportedEfforts required, adds defaultEffort */
export const RuntimeReasoningSchema = ReasoningConfigSchema.required({ supportedEfforts: true }).extend({
  /** Default effort level */
  defaultEffort: z.string().optional()
})

export type RuntimeReasoning = z.infer<typeof RuntimeReasoningSchema>

/** DB form: imported from catalog (source of truth) */
export const ParameterSupportDbSchema = CatalogParameterSupportSchema
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
  parameters: RuntimeParameterSupportSchema.optional(),

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
