/**
 * Cherry Studio Registry
 * Main entry point for the model and provider registry system
 */

// Enums (canonical source of truth)
export {
  AnthropicReasoningEffort,
  Currency,
  ENDPOINT_TYPE,
  EndpointType,
  MODALITY,
  Modality,
  MODEL_CAPABILITY,
  ModelCapability,
  objectValues,
  OpenAIReasoningEffort,
  ReasoningEffort
} from './schemas/enums'

// Schema-inferred types (replaces proto types)
export type {
  ModelConfig,
  ModelPricing,
  ModelConfig as ProtoModelConfig,
  ModelPricing as ProtoModelPricing,
  ReasoningSupport as ProtoReasoningSupport,
  ReasoningSupport
} from './schemas/model'
export type {
  ProviderConfig as ProtoProviderConfig,
  ProviderReasoningFormat as ProtoProviderReasoningFormat,
  ProviderConfig,
  ProviderReasoningFormat,
  RegistryEndpointConfig
} from './schemas/provider'
export type {
  ProviderModelOverride as ProtoProviderModelOverride,
  ProviderModelOverride
} from './schemas/provider-models'

// Model ID normalization utilities
export { normalizeModelId } from './utils/importers/base/base-transformer'
