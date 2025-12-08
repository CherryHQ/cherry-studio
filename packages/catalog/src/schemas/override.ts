/**
 * Provider model override schema definitions
 * Defines how providers can override specific model configurations
 */

import * as z from 'zod'

import { ModelIdSchema, ProviderIdSchema, VersionSchema } from './common'
import { ModelCapabilityTypeSchema, ModelPricingSchema, ParameterSupportSchema, ReasoningSchema } from './model'

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

// Pricing override (partial of ModelPricingSchema)
export const PricingOverrideSchema = ModelPricingSchema.partial().optional()

// Reasoning configuration override
export const ReasoningOverrideSchema = ReasoningSchema.optional()

// Parameter support override
export const ParameterSupportOverrideSchema = ParameterSupportSchema.partial().optional()

// SIMPLIFIED: Main provider model override schema
export const ProviderModelOverrideSchema = z.object({
  // Identification
  provider_id: ProviderIdSchema,
  model_id: ModelIdSchema,

  // Core overrides
  capabilities: CapabilityOverrideSchema.optional(),
  limits: LimitsOverrideSchema.optional(),
  pricing: PricingOverrideSchema,
  reasoning: ReasoningOverrideSchema.optional(),
  parameters: ParameterSupportOverrideSchema.optional(),

  // Status control
  disabled: z.boolean().optional(),
  replace_with: ModelIdSchema.optional(),

  // Metadata
  reason: z.string().optional(),
  priority: z.number().default(0)

  // REMOVED: conditions (not evaluated in code)
  // REMOVED: endpoint_types (not used)
  // REMOVED: metadata overrides (not used)
  // REMOVED: last_updated, updated_by (use git)
  // REMOVED: override_metadata (not used)
})

// Override list container
export const OverrideListSchema = z.object({
  version: VersionSchema,
  overrides: z.array(ProviderModelOverrideSchema)
})


// Type exports
export type CapabilityOverride = z.infer<typeof CapabilityOverrideSchema>
export type LimitsOverride = z.infer<typeof LimitsOverrideSchema>
export type PricingOverride = z.infer<typeof PricingOverrideSchema>
export type ReasoningOverride = z.infer<typeof ReasoningOverrideSchema>
export type ParameterSupportOverride = z.infer<typeof ParameterSupportOverrideSchema>
export type ProviderModelOverride = z.infer<typeof ProviderModelOverrideSchema>
export type OverrideList = z.infer<typeof OverrideListSchema>
