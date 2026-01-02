/**
 * Shared Provider Utilities
 *
 * This module exports utilities for working with AI providers
 * that can be shared between main process and renderer process.
 */

// API host formatting
export type { ApiKeyRotator, ProviderFormatContext } from './format'
export {
  defaultFormatAzureOpenAIApiHost,
  formatProviderApiHost,
  getBaseUrlForAiSdk,
  simpleKeyRotator
} from './format'

// AI SDK configuration
export type { AiSdkConfig, AiSdkConfigContext } from './providerConfig'
export { providerToAiSdkConfig } from './providerConfig'

// Provider initialization
export { initializeSharedProviders, SHARED_PROVIDER_CONFIGS } from './initialization'
export * from './utils'
