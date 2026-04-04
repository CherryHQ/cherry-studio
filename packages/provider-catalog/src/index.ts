/**
 * Cherry Studio Catalog
 * Main entry point for the model and provider catalog system
 */

// Proto enums (re-exported from schemas/enums.ts which re-exports from gen/)
export {
  AnthropicReasoningEffort,
  Currency,
  ENDPOINT_TYPE,
  EndpointType,
  MODALITY,
  Modality,
  MODEL_CAPABILITY,
  ModelCapability,
  OpenAIReasoningEffort,
  ReasoningEffort
} from './schemas/enums'

// Proto types (source of truth)
export type { ModelCatalog, ModelConfig, ModelConfig as ProtoModelConfig } from './gen/v1/model_pb'
export type {
  ModelPricing,
  ModelPricing as ProtoModelPricing,
  ReasoningSupport as ProtoReasoningSupport,
  ReasoningSupport
} from './gen/v1/model_pb'
export type {
  ProviderModelOverride as ProtoProviderModelOverride,
  ProviderModelCatalog,
  ProviderModelOverride
} from './gen/v1/provider_models_pb'
export type {
  ProviderConfig as ProtoProviderConfig,
  ProviderReasoningFormat as ProtoProviderReasoningFormat,
  ProviderCatalog,
  ProviderConfig,
  ProviderReasoningFormat
} from './gen/v1/provider_pb'

// Catalog reader (read .pb files and return proto Message types)
export { readModelCatalog, readProviderCatalog, readProviderModelCatalog } from './catalog-reader'

// Model ID normalization utilities
export { normalizeModelId } from './utils/importers/base/base-transformer'
