import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { getProviderHostTopology } from './providerTopology'

// Azure/Vertex/Bedrock reuse other vendors' endpoint protocols, so authType
// is the only reliable discriminator (seeded skeletons may lack a distinct
// defaultChatEndpoint). See presetProviderSeeder.ts.
export function isVertexProvider(provider: Provider): boolean {
  return provider.authType === 'iam-gcp'
}

export function isAzureOpenAIProvider(provider: Provider): boolean {
  return provider.authType === 'iam-azure'
}

export function isAwsBedrockProvider(provider: Provider): boolean {
  return provider.authType === 'iam-aws'
}

export function isOllamaProvider(provider: Provider): boolean {
  return (
    provider.id === 'ollama' ||
    provider.presetProviderId === 'ollama' ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.OLLAMA_CHAT
  )
}

// `&& !iam-gcp` excludes Vertex, which the seeder gives the same
// google-generate-content endpoint as Gemini.
export function isGeminiProvider(provider: Provider): boolean {
  return (
    (provider.id === 'google' ||
      provider.id === 'gemini' ||
      provider.presetProviderId === 'gemini' ||
      provider.defaultChatEndpoint === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) &&
    provider.authType !== 'iam-gcp'
  )
}

export function isAnthropicProvider(provider: Provider): boolean {
  return (
    provider.presetProviderId === 'anthropic' ||
    provider.id === 'anthropic' ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
  )
}

export function isOpenAIProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
}

export function isOpenAIChatProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
}

export function isOpenAIResponsesProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
}

export function isOpenAICompatibleProvider(provider: Provider): boolean {
  return (
    provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_RESPONSES ||
    provider.presetProviderId === 'new-api' ||
    provider.presetProviderId === 'mistral'
  )
}

export function isPerplexityProvider(provider: Provider): boolean {
  return provider.id === 'perplexity' || provider.presetProviderId === 'perplexity'
}

export function isCherryAIProvider(provider: Provider): boolean {
  return provider.id === 'cherryai' || provider.presetProviderId === 'cherryai'
}

export function isNewApiProvider(provider: Provider): boolean {
  return ['new-api', 'cherryin', 'aionly'].includes(provider.id) || provider.presetProviderId === 'new-api'
}

export function isAIGatewayProvider(provider: Provider): boolean {
  return provider.presetProviderId === 'gateway' || provider.id === 'gateway'
}

export function isGeminiWebSearchProvider(provider: Provider): boolean {
  return isGeminiProvider(provider) || isVertexProvider(provider)
}

export function isSystemProvider(provider: Provider): boolean {
  return provider.presetProviderId != null
}

export function matchesPreset(provider: Provider, presetId: string): boolean {
  return provider.id === presetId || provider.presetProviderId === presetId
}

/**
 * Canonical preset providers are seeded built-ins whose runtime ID equals the
 * linked preset ID. Preset-derived user providers remain user-manageable.
 */
export function canManageProvider(provider: Provider): boolean {
  return provider.presetProviderId == null || provider.presetProviderId !== provider.id
}

export function isProviderSupportAuth(provider: Pick<Provider, 'id'>): boolean {
  const supportProviders = ['302ai', 'silicon', 'aihubmix', 'ppio', 'tokenflux', 'aionly']
  return supportProviders.includes(provider.id)
}

export function isAnthropicSupportedProvider(provider: Provider): boolean {
  return getProviderHostTopology(provider).hasAnthropicEndpoint
}

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

export function isSupportServiceTierProvider(provider: Provider): boolean {
  return provider.apiFeatures?.serviceTier ?? false
}

export function isSupportVerbosityProvider(provider: Provider): boolean {
  return provider.apiFeatures?.verbosity ?? false
}

export function isSupportArrayContentProvider(provider: Provider): boolean {
  return provider.apiFeatures?.arrayContent ?? false
}

export function isSupportDeveloperRoleProvider(provider: Provider): boolean {
  return provider.apiFeatures?.developerRole ?? false
}

export function isSupportStreamOptionsProvider(provider: Provider): boolean {
  return provider.apiFeatures?.streamOptions ?? false
}

const NOT_SUPPORT_QWEN3_ENABLE_THINKING_PROVIDERS = ['ollama', 'lmstudio', 'nvidia', 'gpustack'] as const

export function isSupportEnableThinkingProvider(provider: Provider): boolean {
  return !NOT_SUPPORT_QWEN3_ENABLE_THINKING_PROVIDERS.some((id) => id === provider.id)
}

export function hasApiKeys(provider: Provider): boolean {
  return provider.apiKeys.length > 0 && provider.apiKeys.some((k) => k.isEnabled)
}

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

export function isSupportAnthropicPromptCacheProvider(provider: Provider): boolean {
  return (
    isAnthropicProvider(provider) ||
    isNewApiProvider(provider) ||
    provider.id === 'aihubmix' ||
    provider.id === 'openrouter' ||
    isAzureOpenAIProvider(provider)
  )
}
