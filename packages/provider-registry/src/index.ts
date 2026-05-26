/**
 * Cherry Studio Registry
 * Main entry point for the model and provider registry system
 */

// Enums — const objects (SCREAMING_CASE)
export {
  ANTHROPIC_REASONING_EFFORT,
  CURRENCY,
  ENDPOINT_TYPE,
  GEMINI_THINKING_LEVEL,
  MODALITY,
  MODEL_CAPABILITY,
  objectValues,
  OPENAI_REASONING_EFFORT,
  REASONING_EFFORT
} from './schemas/enums'

// Enum types (PascalCase, derived from const objects)
export type {
  AnthropicReasoningEffort,
  Currency,
  EndpointType,
  GeminiThinkingLevel,
  Modality,
  ModelCapability,
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
export { normalizeModelId } from './utils/normalize'

// Pure lookup and transformation utilities (no fs dependency)
export type { ModelLookupResult, RuntimeEndpointConfig } from './registry-utils'
export {
  buildRuntimeEndpointConfigs,
  inferAdapterFamily,
  lookupRegistryModel,
  lookupRegistryProvider
} from './registry-utils'

// Shared vendor identity regex — consumed by @shared capability inference
// and @cherrystudio/ui icon routing. Single source of truth for "which
// vendor does this raw model ID belong to".
export type { VendorKey } from './patterns/vendor-patterns'
export { isVendor, matchVendor, VENDOR_PATTERNS } from './patterns/vendor-patterns'
