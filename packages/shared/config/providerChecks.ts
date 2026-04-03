/**
 * Provider identification and capability check functions.
 *
 * TODO: These are mock implementations. The real logic lives in
 * `src/renderer/src/utils/provider.ts`.
 * They should be migrated here from renderer to become the single source of truth.
 */

/** Provider type used by check functions */
export interface ProviderLike {
  id: string
  type?: string
}

/** Check if provider is Ollama */
export function isOllamaProvider(provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return provider.id === 'ollama' || provider.type === 'ollama'
}

/** Check if provider is Gemini/Google */
export function isGeminiProvider(provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return provider.id === 'google' || provider.type === 'gemini'
}

/** Check if provider is Azure OpenAI */
export function isAzureOpenAIProvider(provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return provider.id === 'azure-openai' || provider.type === 'azure-openai'
}

/** Check if provider uses Azure responses endpoint */
export function isAzureResponsesEndpoint(_provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return false
}

/** Check if provider is AWS Bedrock */
export function isAwsBedrockProvider(provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return provider.id === 'bedrock' || provider.type === 'bedrock'
}

/** Check if provider is Google Vertex */
export function isVertexProvider(provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return provider.id === 'google-vertex' || provider.type === 'vertexai'
}

/** Check if provider is AI Gateway */
export function isAIGatewayProvider(provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return provider.id === 'gateway'
}

/** Check if provider supports URL context */
export function isSupportUrlContextProvider(_provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return false
}

/** Check if provider supports service tier */
export function isSupportServiceTierProvider(_provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return false
}

/** Check if provider supports verbosity */
export function isSupportVerbosityProvider(_provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return false
}

/** Check if provider supports enabling thinking mode */
export function isSupportEnableThinkingProvider(_provider: ProviderLike): boolean {
  // TODO: migrate from src/renderer/src/utils/provider.ts
  return false
}
