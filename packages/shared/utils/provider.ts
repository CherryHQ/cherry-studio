/**
 * Provider identification and capability check functions.
 *
 * Supports both old types (provider.type) and v2 types (provider.presetProviderId).
 *
 * Capability predicates: serviceTier/verbosity read the v2 Provider's
 * registry-sourced `apiFeatures`; urlContext/enableThinking derive from
 * v2 provider identity (no registry apiFeatures flag exists for those),
 * faithfully porting the former v1 `@renderer/utils/provider` semantics.
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

/**
 * Check if provider supports URL context (Gemini/Vertex/Anthropic/
 * Azure-OpenAI/new-api family, plus cherryin). The provider-registry has
 * no urlContext apiFeature flag, so this is derived from provider identity
 * — a faithful v2 port of the former v1 SUPPORT_URL_CONTEXT_PROVIDER_TYPES.
 */
export function isSupportUrlContextProvider(provider: Provider): boolean {
  return (
    isGeminiProvider(provider) ||
    isVertexProvider(provider) ||
    isAnthropicProvider(provider) ||
    isAzureOpenAIProvider(provider) ||
    isNewApiProvider(provider) ||
    provider.id === 'cherryin'
  )
}

/** Check if provider supports service tier (registry-sourced apiFeatures). */
export function isSupportServiceTierProvider(provider: Provider): boolean {
  return provider.apiFeatures?.serviceTier ?? false
}

/** Check if provider supports verbosity (registry-sourced apiFeatures). */
export function isSupportVerbosityProvider(provider: Provider): boolean {
  return provider.apiFeatures?.verbosity ?? false
}

/**
 * Providers that do NOT support the Qwen3 `enable_thinking` parameter
 * (OpenAI Chat Completions API only). No registry apiFeature flag exists
 * for this; faithful v2 port of the former v1 exclusion list.
 */
const NOT_SUPPORT_QWEN3_ENABLE_THINKING_PROVIDERS = ['ollama', 'lmstudio', 'nvidia', 'gpustack'] as const

/** Check if provider supports enabling thinking mode. */
export function isSupportEnableThinkingProvider(provider: Provider): boolean {
  return !NOT_SUPPORT_QWEN3_ENABLE_THINKING_PROVIDERS.some((id) => id === provider.id)
}

// ── Additional v2 predicates (T1.2: single source of truth) ───────────────
// Keyed on presetProviderId / id / defaultChatEndpoint — never v1 `provider.type`.

/** Check if provider is Anthropic/Claude. */
export function isAnthropicProvider(provider: Provider): boolean {
  return (
    provider.presetProviderId === 'anthropic' ||
    provider.id === 'anthropic' ||
    provider.defaultChatEndpoint === 'anthropic-messages'
  )
}

/** Check if provider is OpenAI (responses endpoint). */
export function isOpenAIProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === 'openai-responses'
}

/** Check if provider is Perplexity. */
export function isPerplexityProvider(provider: Provider): boolean {
  return provider.id === 'perplexity' || provider.presetProviderId === 'perplexity'
}

/** Check if provider is the Cherry-hosted aggregator. */
export function isCherryAIProvider(provider: Provider): boolean {
  return provider.id === 'cherryai' || provider.presetProviderId === 'cherryai'
}

/** Check if provider routes through a new-api compatible gateway. */
export function isNewApiProvider(provider: Provider): boolean {
  return ['new-api', 'cherryin', 'aionly'].includes(provider.id) || provider.presetProviderId === 'new-api'
}

/** Check if provider speaks the OpenAI Chat Completions wire format. */
export function isOpenAICompatibleProvider(provider: Provider): boolean {
  return (
    provider.defaultChatEndpoint === 'openai-chat-completions' ||
    provider.presetProviderId === 'new-api' ||
    provider.presetProviderId === 'mistral'
  )
}

/** Gemini providers that use the native Google web-search tool. */
export function isGeminiWebSearchProvider(provider: Provider): boolean {
  return isGeminiProvider(provider) || isVertexProvider(provider)
}

/** Filter to providers that can serve Claude models (native or compatible host). */
export function getClaudeSupportedProviders<T extends Provider>(providers: T[]): T[] {
  return providers.filter(
    (p) =>
      isAnthropicProvider(p) ||
      isNewApiProvider(p) ||
      p.id === 'aihubmix' ||
      p.id === 'openrouter' ||
      isAzureOpenAIProvider(p)
  )
}

/** Anthropic prompt-cache (1h) support. */
export function isSupportAnthropicPromptCacheProvider(provider: Provider): boolean {
  return (
    isAnthropicProvider(provider) ||
    isNewApiProvider(provider) ||
    provider.id === 'aihubmix' ||
    provider.id === 'openrouter' ||
    isAzureOpenAIProvider(provider)
  )
}
