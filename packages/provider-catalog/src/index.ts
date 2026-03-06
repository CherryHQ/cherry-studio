/**
 * Cherry Studio Catalog
 * Main entry point for the model and provider catalog system
 */

// Proto enums (re-exported from schemas/enums.ts which re-exports from gen/)
export {
  Currency,
  ENDPOINT_TYPE,
  EndpointType,
  MODALITY,
  Modality,
  MODEL_CAPABILITY,
  ModelCapability,
  ReasoningEffort
} from './schemas/enums'

// Protobuf utilities (enum mapping helpers, file I/O)
export * from './proto-utils'

// Proto types (source of truth)
export type { ModelCatalog, ModelConfig, ModelConfig as ProtoModelConfig } from './gen/v1/model_pb'
export type {
  ModelPricing,
  ModelPricing as ProtoModelPricing,
  Reasoning as ProtoReasoning,
  Reasoning
} from './gen/v1/model_pb'
export type {
  ProviderModelOverride as ProtoProviderModelOverride,
  ProviderModelCatalog,
  ProviderModelOverride
} from './gen/v1/provider_models_pb'
export type { ProviderConfig as ProtoProviderConfig, ProviderCatalog, ProviderConfig } from './gen/v1/provider_pb'

// Catalog reader (read .pb files and return proto Message types)
export { readModelCatalog, readProviderCatalog, readProviderModelCatalog } from './catalog-reader'
