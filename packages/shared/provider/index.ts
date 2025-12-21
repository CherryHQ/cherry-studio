/**
 * Shared Provider Utilities
 *
 * This module exports utilities for working with AI providers
 * that can be shared between main process and renderer process.
 */

// Type definitions
export type { MinimalProvider, ProviderType, SystemProviderId } from './types'
export { SystemProviderIds } from './types'

// Provider type detection
export {
  isAIGatewayProvider,
  isAnthropicProvider,
  isAwsBedrockProvider,
  isAzureOpenAIProvider,
  isAzureResponsesEndpoint,
  isCherryAIProvider,
  isGeminiProvider,
  isNewApiProvider,
  isOllamaProvider,
  isOpenAICompatibleProvider,
  isOpenAIProvider,
  isPerplexityProvider,
  isVertexProvider
} from './detection'

// API host formatting
export type { ApiKeyRotator, ProviderFormatContext } from './format'
export {
  defaultFormatAzureOpenAIApiHost,
  formatProviderApiHost,
  getBaseUrlForAiSdk,
  simpleKeyRotator
} from './format'

// Provider ID mapping
export { getAiSdkProviderId, STATIC_PROVIDER_MAPPING, tryResolveProviderId } from './mapping'

// AI SDK configuration
export type { AiSdkConfig, AiSdkConfigContext } from './sdk-config'
export { providerToAiSdkConfig } from './sdk-config'

// Provider resolution
export { resolveActualProvider } from './resolve'

// Provider initialization
export { initializeSharedProviders, SHARED_PROVIDER_CONFIGS } from './initialization'
