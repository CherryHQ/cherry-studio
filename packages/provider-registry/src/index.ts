/**
 * Cherry Studio Registry
 * Main entry point for the model and provider registry system
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
export type { ModelConfig, ModelRegistry, ModelConfig as ProtoModelConfig } from './gen/v1/model_pb'
export type {
  ModelPricing,
  ModelPricing as ProtoModelPricing,
  ReasoningSupport as ProtoReasoningSupport,
  ReasoningSupport
} from './gen/v1/model_pb'
export type {
  ProviderModelOverride as ProtoProviderModelOverride,
  ProviderModelOverride,
  ProviderModelRegistry
} from './gen/v1/provider_models_pb'
export type {
  ProviderConfig as ProtoProviderConfig,
  ProviderReasoningFormat as ProtoProviderReasoningFormat,
  ProviderConfig,
  ProviderReasoningFormat,
  ProviderRegistry
} from './gen/v1/provider_pb'

// Registry reader (read .pb files and return proto Message types)
export { readModelRegistry, readProviderModelRegistry, readProviderRegistry } from './registry-reader'

// Model ID normalization utilities
export { normalizeModelId } from './utils/importers/base/base-transformer'
