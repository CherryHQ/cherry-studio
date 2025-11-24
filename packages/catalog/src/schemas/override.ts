/**
 * Provider model override schema definitions
 * Defines how providers can override specific model configurations
 */

import * as z from 'zod'

import { MetadataSchema, ModelIdSchema, ProviderIdSchema, VersionSchema } from './common'
import { ModelCapabilityTypeSchema, ModelPricingSchema, ParameterSupportSchema, ReasoningSchema } from './model'
import { EndpointTypeSchema } from './provider'

// Capability override operations
export const CapabilityOverrideSchema = z.object({
  add: z.array(ModelCapabilityTypeSchema).optional(), // Add capabilities
  remove: z.array(ModelCapabilityTypeSchema).optional(), // Remove capabilities
  force: z.array(ModelCapabilityTypeSchema).optional() // Force set capabilities (ignore base config)
})

// Limits override configuration
export const LimitsOverrideSchema = z.object({
  context_window: z.number().optional(),
  max_output_tokens: z.number().optional(),
  max_input_tokens: z.number().optional()
})

// Pricing override configuration
export const PricingOverrideSchema = ModelPricingSchema.partial().optional()

// Endpoint types override
export const EndpointTypesOverrideSchema = z.array(EndpointTypeSchema).optional()

// Reasoning configuration override - allows partial override of reasoning configs
export const ReasoningOverrideSchema = ReasoningSchema.optional()

// Parameter support override
export const ParameterSupportOverrideSchema = ParameterSupportSchema.partial().optional()

// Model metadata override
export const MetadataOverrideSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    deprecation_date: z.iso.datetime().optional(),
    replaced_by: ModelIdSchema.optional(),
    metadata: MetadataSchema
  })
  .optional()

// Main provider model override schema
export const ProviderModelOverrideSchema = z.object({
  // Identification
  provider_id: ProviderIdSchema,
  model_id: ModelIdSchema,

  // Capability overrides
  capabilities: CapabilityOverrideSchema.optional(),

  // Limits overrides
  limits: LimitsOverrideSchema.optional(),

  // Pricing overrides
  pricing: PricingOverrideSchema,

  // Reasoning configuration overrides
  reasoning: ReasoningOverrideSchema.optional(),

  // Parameter support overrides
  parameters: ParameterSupportOverrideSchema.optional(),

  // Endpoint type overrides
  endpoint_types: EndpointTypesOverrideSchema.optional(),

  // Model metadata overrides
  metadata: MetadataOverrideSchema.optional(),

  // Status overrides
  disabled: z.boolean().optional(), // Disable this model for this provider
  replace_with: ModelIdSchema.optional(), // Replace with alternative model

  // Override tracking
  reason: z.string().optional(), // Reason for override
  last_updated: z.iso.datetime().optional(),
  updated_by: z.string().optional(), // Who made the override

  // Override priority (higher number = higher priority)
  priority: z.number().default(0),

  // Override conditions
  conditions: z
    .object({
      // Apply override only for specific regions
      regions: z.array(z.string()).optional(),

      // Apply override only for specific user tiers
      user_tiers: z.array(z.string()).optional(),

      // Apply override only in specific environments
      environments: z.array(z.enum(['development', 'staging', 'production'])).optional(),

      // Time-based conditions
      valid_from: z.iso.datetime().optional(),
      valid_until: z.iso.datetime().optional()
    })
    .optional(),

  // Additional override metadata
  override_metadata: MetadataSchema.optional()
})

// Override container schema for JSON files
export const OverrideListSchema = z.object({
  version: VersionSchema,
  overrides: z.array(ProviderModelOverrideSchema)
})

// Override application result schema
export const OverrideResultSchema = z.object({
  model_id: ModelIdSchema,
  provider_id: ProviderIdSchema,
  applied: z.boolean(),
  applied_overrides: z.array(z.string()), // List of applied override fields
  original_values: z.record(z.string(), z.unknown()), // Original values before override
  new_values: z.record(z.string(), z.unknown()), // New values after override
  override_reason: z.string().optional(),
  applied_at: z.iso.datetime().optional()
})

// Override validation result
export const OverrideValidationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  recommendations: z.array(z.string())
})

// Type exports
export type CapabilityOverride = z.infer<typeof CapabilityOverrideSchema>
export type LimitsOverride = z.infer<typeof LimitsOverrideSchema>
export type PricingOverride = z.infer<typeof PricingOverrideSchema>
export type EndpointTypesOverride = z.infer<typeof EndpointTypesOverrideSchema>
export type ReasoningOverride = z.infer<typeof ReasoningOverrideSchema>
export type ParameterSupportOverride = z.infer<typeof ParameterSupportOverrideSchema>
export type MetadataOverride = z.infer<typeof MetadataOverrideSchema>
export type ProviderModelOverride = z.infer<typeof ProviderModelOverrideSchema>
export type OverrideList = z.infer<typeof OverrideListSchema>
export type OverrideResult = z.infer<typeof OverrideResultSchema>
export type OverrideValidation = z.infer<typeof OverrideValidationSchema>
