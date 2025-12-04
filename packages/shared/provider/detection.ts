/**
 * Provider Type Detection Utilities
 *
 * Functions to detect provider types based on provider configuration.
 * These are pure functions that only depend on provider.type and provider.id.
 *
 * NOTE: These functions should match the logic in @renderer/utils/provider.ts
 */

import type { MinimalProvider } from './types'

/**
 * Check if provider is Anthropic type
 */
export function isAnthropicProvider<P extends MinimalProvider>(provider: P): boolean {
  return provider.type === 'anthropic'
}

/**
 * Check if provider is OpenAI Response type (openai-response)
 * NOTE: This matches isOpenAIProvider in renderer/utils/provider.ts
 */
export function isOpenAIProvider<P extends MinimalProvider>(provider: P): boolean {
  return provider.type === 'openai-response'
}

/**
 * Check if provider is Gemini type
 */
export function isGeminiProvider<P extends MinimalProvider>(provider: P): boolean {
  return provider.type === 'gemini'
}

/**
 * Check if provider is Azure OpenAI type
 */
export function isAzureOpenAIProvider<P extends MinimalProvider>(provider: P): boolean {
  return provider.type === 'azure-openai'
}

/**
 * Check if provider is Vertex AI type
 */
export function isVertexProvider<P extends MinimalProvider>(provider: P): boolean {
  return provider.type === 'vertexai'
}

/**
 * Check if provider is AWS Bedrock type
 */
export function isAwsBedrockProvider<P extends MinimalProvider>(provider: P): boolean {
  return provider.type === 'aws-bedrock'
}

export function isAIGatewayProvider<P extends MinimalProvider>(provider: P): boolean {
  return provider.type === 'gateway'
}

export function isOllamaProvider<P extends MinimalProvider>(provider: P): boolean {
  return provider.type === 'ollama'
}

/**
 * Check if Azure OpenAI provider uses responses endpoint
 * Matches isAzureResponsesEndpoint in renderer/utils/provider.ts
 */
export function isAzureResponsesEndpoint<P extends MinimalProvider>(provider: P): boolean {
  return provider.apiVersion === 'preview' || provider.apiVersion === 'v1'
}

/**
 * Check if provider is Cherry AI type
 * Matches isCherryAIProvider in renderer/utils/provider.ts
 */
export function isCherryAIProvider<P extends MinimalProvider>(provider: P): boolean {
  return provider.id === 'cherryai'
}

/**
 * Check if provider is Perplexity type
 * Matches isPerplexityProvider in renderer/utils/provider.ts
 */
export function isPerplexityProvider<P extends MinimalProvider>(provider: P): boolean {
  return provider.id === 'perplexity'
}

/**
 * Check if provider is new-api type (supports multiple backends)
 * Matches isNewApiProvider in renderer/utils/provider.ts
 */
export function isNewApiProvider<P extends MinimalProvider>(provider: P): boolean {
  return ['new-api', 'cherryin'].includes(provider.id) || provider.type === ('new-api' as string)
}

/**
 * Check if provider is OpenAI compatible
 * Matches isOpenAICompatibleProvider in renderer/utils/provider.ts
 */
export function isOpenAICompatibleProvider<P extends MinimalProvider>(provider: P): boolean {
  return ['openai', 'new-api', 'mistral'].includes(provider.type)
}
