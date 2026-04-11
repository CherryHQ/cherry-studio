/**
 * Provider identification and capability check functions.
 *
 * Supports both old types (provider.type) and v2 types (provider.presetProviderId).
 *
 * Will be replaced by `@cherrystudio/provider-registry` capability inference
 * once PR #14011 is merged.
 * @see https://github.com/CherryHQ/cherry-studio/pull/14011
 */

/** Provider type used by check functions — works with both old and v2 Provider types */
export interface ProviderLike {
  id: string
  type?: string // old (Redux-era)
  presetProviderId?: string // v2 (DataApi)
}

/** Resolve the effective provider type from either old or v2 Provider */
function getProviderType(provider: ProviderLike): string | undefined {
  return provider.presetProviderId ?? provider.type
}

/** Check if provider is Ollama */
export function isOllamaProvider(provider: ProviderLike): boolean {
  return provider.id === 'ollama' || getProviderType(provider) === 'ollama'
}

/** Check if provider is Gemini/Google */
export function isGeminiProvider(provider: ProviderLike): boolean {
  return provider.id === 'google' || getProviderType(provider) === 'gemini'
}

/** Check if provider is Azure OpenAI */
export function isAzureOpenAIProvider(provider: ProviderLike): boolean {
  const t = getProviderType(provider)
  return provider.id === 'azure-openai' || t === 'azure-openai'
}

/** Check if provider uses Azure responses endpoint */
export function isAzureResponsesEndpoint(provider: ProviderLike): boolean {
  // v2: check settings.apiVersion for 'preview' or 'v1'
  const settings = (provider as unknown as Record<string, unknown>).settings as
    | Record<string, unknown>
    | undefined
  const apiVersion = (settings?.apiVersion as string)?.trim()
  return isAzureOpenAIProvider(provider) && !!apiVersion && ['preview', 'v1'].includes(apiVersion)
}

/** Check if provider is AWS Bedrock */
export function isAwsBedrockProvider(provider: ProviderLike): boolean {
  return provider.id === 'aws-bedrock' || getProviderType(provider) === 'aws-bedrock'
}

/** Check if provider is Google Vertex */
export function isVertexProvider(provider: ProviderLike): boolean {
  const t = getProviderType(provider)
  return provider.id === 'google-vertex' || t === 'vertexai' || t === 'google-vertex'
}

/** Check if provider is AI Gateway */
export function isAIGatewayProvider(provider: ProviderLike): boolean {
  return provider.id === 'gateway'
}

/** Check if provider supports URL context */
export function isSupportUrlContextProvider(_provider: ProviderLike): boolean {
  // TODO: derive from provider-registry capabilities
  return false
}

/** Check if provider supports service tier */
export function isSupportServiceTierProvider(_provider: ProviderLike): boolean {
  // TODO: derive from provider-registry capabilities
  return false
}

/** Check if provider supports verbosity */
export function isSupportVerbosityProvider(_provider: ProviderLike): boolean {
  // TODO: derive from provider-registry capabilities
  return false
}

/** Check if provider supports enabling thinking mode */
export function isSupportEnableThinkingProvider(_provider: ProviderLike): boolean {
  // TODO: derive from provider-registry capabilities
  return false
}
