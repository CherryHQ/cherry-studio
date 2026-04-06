/**
 * Provider-Model mapping schema definitions
 * Defines how providers can override specific model configurations
 *
 * This file was renamed from override.ts for clearer semantics
 */

import * as z from 'zod'

import { ModelIdSchema, ProviderIdSchema, VersionSchema } from './common'
import {
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

  // Variant identification (for same model with different variants)
  // Used to distinguish variants like :free, :thinking, -search
  // providerId + modelId + modelVariant forms the unique identifier
  modelVariant: z.string().optional(), // 'free', 'thinking', 'nitro', 'search', etc.

  // Override configuration
  capabilities: CapabilityOverrideSchema.optional(),
  limits: z
    .object({
      contextWindow: z.number().optional(),
      maxOutputTokens: z.number().optional(),
      maxInputTokens: z.number().optional(),
      rateLimit: z.number().optional() // requests per minute
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

  // Status control
  disabled: z.boolean().optional(),
  replaceWith: ModelIdSchema.optional(),

  // Metadata
  reason: z.string().optional(),
  priority: z.number().default(0)
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
