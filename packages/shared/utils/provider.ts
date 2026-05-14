/**
 * Provider identification and capability check functions.
 *
 * Supports both old types (provider.type) and v2 types (provider.presetProviderId).
 *
 * Will be replaced by `@cherrystudio/provider-registry` capability inference
 * once PR #14011 is merged.
 * @see https://github.com/CherryHQ/cherry-studio/pull/14011
 */

import type { Provider } from '@shared/data/types/provider'

/** Resolve the effective provider type from either old or v2 Provider */
function getProviderType(provider: Provider): string | undefined {
  return provider.presetProviderId
}

/** Check if provider is Ollama */
export function isOllamaProvider(provider: Provider): boolean {
  return provider.id === 'ollama' || getProviderType(provider) === 'ollama'
}

/** Check if provider is Gemini/Google */
export function isGeminiProvider(provider: Provider): boolean {
  return provider.id === 'google' || getProviderType(provider) === 'gemini'
}

/** Check if provider is Azure OpenAI */
export function isAzureOpenAIProvider(provider: Provider): boolean {
  const t = getProviderType(provider)
  return provider.id === 'azure-openai' || t === 'azure-openai'
}

/** Check if provider is AWS Bedrock */
export function isAwsBedrockProvider(provider: Provider): boolean {
  return provider.id === 'aws-bedrock' || getProviderType(provider) === 'aws-bedrock'
}

/** Check if provider is Google Vertex */
export function isVertexProvider(provider: Provider): boolean {
  const t = getProviderType(provider)
  return provider.id === 'google-vertex' || t === 'vertexai' || t === 'google-vertex'
}

/** Check if provider is AI Gateway */
export function isAIGatewayProvider(provider: Provider): boolean {
  return provider.presetProviderId === 'gateway' || provider.id === 'gateway'
}

/** Check if provider supports URL context */
// oxlint-disable-next-line no-unused-vars
export function isSupportUrlContextProvider(_provider: Provider): boolean {
  // TODO: derive from provider-registry capabilities
  return false
}

/** Check if provider supports service tier */
// oxlint-disable-next-line no-unused-vars
export function isSupportServiceTierProvider(_provider: Provider): boolean {
  // TODO: derive from provider-registry capabilities
  return false
}

/** Check if provider supports verbosity */
// oxlint-disable-next-line no-unused-vars
export function isSupportVerbosityProvider(_provider: Provider): boolean {
  // TODO: derive from provider-registry capabilities
  return false
}

/** Check if provider supports enabling thinking mode */
// oxlint-disable-next-line no-unused-vars
export function isSupportEnableThinkingProvider(_provider: Provider): boolean {
  // TODO: derive from provider-registry capabilities
  return false
}
