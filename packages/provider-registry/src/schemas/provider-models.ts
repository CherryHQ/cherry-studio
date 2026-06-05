/**
 * Provider-Model mapping schema definitions
 * Defines how providers can override specific model configurations
 *
 * This file was renamed from override.ts for clearer semantics
 */

import * as z from 'zod'

import { ModelIdSchema, ProviderIdSchema, VersionSchema } from './common'
import {
  ImageGenerationSupportSchema,
  ModalitySchema,
  ModelCapabilityTypeSchema,
  ModelPricingSchema,
  ParameterSupportSchema,
  ReasoningSupportSchema
} from './model'
import { EndpointTypeSchema } from './provider'

export const CapabilityOverrideSchema = z.object({
  add: z.array(ModelCapabilityTypeSchema).optional(), // Add capabilities
  remove: z.array(ModelCapabilityTypeSchema).optional(), // Remove capabilities
  force: z.array(ModelCapabilityTypeSchema).optional() // Force set capabilities (ignore base config)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Provider-Model Override Schema
// ═══════════════════════════════════════════════════════════════════════════════

export const ProviderModelOverrideSchema = z.object({
  // Identification
  providerId: ProviderIdSchema,
  modelId: ModelIdSchema, // Canonical/normalized ID (references models.json)

  // API Model ID - The actual ID used when calling the provider's API
  // This preserves the original provider-specific ID format
  // Examples:
  //   - OpenRouter: "anthropic/claude-3-5-sonnet"
  //   - AIHubMix: "claude-3-5-sonnet"
  //   - Vertex AI: "global.anthropic.claude-3-5-sonnet-v1:0"
  // If not set, modelId is used for API calls
  apiModelId: z.string().optional(),

  // Variant tags (for models with modifier suffixes like :free, :thinking, -search)
  // A model like "xxx-thinking-free" has modelVariants: ['thinking', 'free']
  // providerId + modelId + sorted modelVariants forms the unique identifier
  modelVariants: z.array(z.string().min(1)).optional(),

  // Override configuration
  capabilities: CapabilityOverrideSchema.optional(),
  limits: z
    .object({
      contextWindow: z.number().optional(),
      maxOutputTokens: z.number().optional(),
      maxInputTokens: z.number().optional()
    })
    .optional(),
  pricing: ModelPricingSchema.partial().optional(),
  reasoning: ReasoningSupportSchema.optional(),
  parameterSupport: ParameterSupportSchema.partial().optional(),

  // Endpoint type overrides (when model uses different endpoints than provider default)
  endpointTypes: z.array(EndpointTypeSchema).optional(),

  // Modality overrides (when provider supports different modalities than base model)
  inputModalities: z.array(ModalitySchema).optional(),
  outputModalities: z.array(ModalitySchema).optional(),

  // Standalone model fields — used when the modelId has NO entry in models.json
  // (vendor-exclusive models like ModelScope's `Tongyi-MAI/Z-Image-Turbo`, PPIO's
  // bespoke endpoints, etc.). The resolver synthesizes a `ModelConfig` from
  // these when no preset is found, so the model can live entirely in
  // `provider-models.json` without polluting the global `models.json`.
  name: z.string().optional(),
  description: z.string().optional(),
  family: z.string().optional(),
  ownedBy: z.string().optional(),

  // Painting-page metadata. When set on the override, takes precedence over
  // `ModelConfig.imageGeneration` (so the same model id can declare different
  // params per provider — useful for vendor-flavored variants).
  imageGeneration: ImageGenerationSupportSchema.optional(),

  // Status control
  disabled: z.boolean().optional(),
  replaceWith: ModelIdSchema.optional(),

  // Metadata
  reason: z.string().optional()
})

// Container schema for JSON files
export const ProviderModelListSchema = z.object({
  version: VersionSchema,
  overrides: z.array(ProviderModelOverrideSchema)
})

// Type exports
export type CapabilityOverride = z.infer<typeof CapabilityOverrideSchema>
export type ProviderModelOverride = z.infer<typeof ProviderModelOverrideSchema>
export type ProviderModelList = z.infer<typeof ProviderModelListSchema>
