/**
 * Unified export of all catalog schemas and types
 * This file provides a single entry point for all schema definitions
 */

// Export all schemas from common types
export * from './common.types'

// Export model schemas
export * from './model.schema'

// Export provider schemas
export * from './provider.schema'

// Export override schemas
export * from './override.schema'

// Re-export commonly used combined types for convenience
export type {
  Modality,
  ModelCapabilityType,
  ModelConfig,
  ModelPricing,
  ParameterSupport,
  Reasoning
} from './model.schema'
export type {
  OverrideResult,
  OverrideValidation,
  ProviderModelOverride
} from './override.schema'
export type {
  Authentication,
  EndpointType,
  McpSupport,
  PricingModel,
  ProviderBehaviors,
  ProviderConfig
} from './provider.schema'

// Export common types
export type {
  Currency,
  Metadata,
  ModelId,
  ProviderId,
  Timestamp,
  Version
} from './common.types'
