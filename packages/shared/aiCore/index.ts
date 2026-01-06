/**
 * Shared Provider Utilities
 *
 * This module exports utilities for working with AI providers
 * that can be shared between main process and renderer process.
 */
export type { AiSdkConfig, AiSdkConfigContext, ApiKeyRotator, ProviderFormatContext } from './providerConfig'
export {
  createDeveloperToSystemFetch,
  defaultFormatAzureOpenAIApiHost,
  formatProviderApiHost,
  getBaseUrlForAiSdk,
  providerToAiSdkConfig,
  simpleKeyRotator
} from './providerConfig'

// Provider initialization
export { initializeSharedProviders, SHARED_PROVIDER_CONFIGS } from './initialization'
export * from './utils'
