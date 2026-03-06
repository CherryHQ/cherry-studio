/**
 * Cherry Studio Catalog
 * Main entry point for the model and provider catalog system
 */

// Legacy Zod schemas — still used by packages/shared for runtime type composition
// TODO: migrate packages/shared to define its own schemas, then remove this export
export * from './schemas'

// Protobuf utilities (enum mapping helpers)
export * from './proto-utils'

// Proto types (source of truth)
// Note: ModelConfig, ProviderConfig, ProviderModelOverride also exported from ./schemas (Zod-inferred).
// After Zod schemas are removed (Task 10), these will be the only source.
export type { ModelCatalog } from './gen/v1/model_pb'
export type { ProviderModelCatalog } from './gen/v1/provider_models_pb'
export type { ProviderCatalog } from './gen/v1/provider_pb'

// Proto message types — exported with 'Proto' prefix to avoid conflict with Zod-inferred types
// After Zod schemas are removed, these can be re-exported without prefix
export type { ModelConfig as ProtoModelConfig } from './gen/v1/model_pb'
export type { ModelPricing as ProtoModelPricing, Reasoning as ProtoReasoning } from './gen/v1/model_pb'
export type { ProviderModelOverride as ProtoProviderModelOverride } from './gen/v1/provider_models_pb'
export type { ProviderConfig as ProtoProviderConfig } from './gen/v1/provider_pb'

// Catalog reader (read .pb files and return proto Message types)
export { readModelCatalog, readProviderCatalog, readProviderModelCatalog } from './catalog-reader'
