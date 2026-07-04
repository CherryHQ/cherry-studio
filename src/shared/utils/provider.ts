import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
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
  return provider.id === CHERRYAI_PROVIDER_ID || provider.presetProviderId === CHERRYAI_PROVIDER_ID
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

/**
 * Providers whose API key is obtained via a hosted OAuth "get key" flow (the
 * `OauthButton`), keyed by runtime id. Single source of truth: `OauthButton`
 * supplies one handler per id (a missing handler is a compile error there), and
 * `isProviderSupportAuth` gates whether the button renders.
 */
export const API_KEY_OAUTH_PROVIDER_IDS = ['302ai', 'silicon', 'aihubmix', 'ppio', 'aionly'] as const

export function isProviderSupportAuth(provider: Pick<Provider, 'id'>): boolean {
  return (API_KEY_OAUTH_PROVIDER_IDS as readonly string[]).includes(provider.id)
}

/**
 * Login-based providers authenticate via a sign-in flow (CLI login / hosted
 * OAuth) and accept no user API key, so the generic API-key/host UI is
 * suppressed and their sign-in panel renders through the provider registry
 * instead. Derived from the provider's `authMethods` (registry capability):
 * login-based ⇔ it declares methods and none is `'api-key'`. Absent ⇒ default
 * `['api-key']` ⇒ not login-based. CherryIN declares `['api-key', 'oauth']`, so
 * it is *not* login-based — its key inputs stay alongside the OAuth panel.
 */
export function isLoginBasedProvider(provider: Pick<Provider, 'authMethods'>): boolean {
  const methods = provider.authMethods
  return methods !== undefined && methods.length > 0 && !methods.includes('api-key')
}

/**
 * External-CLI providers (e.g. Claude Code) reuse a CLI's own stored login and
 * hold no app-side credential, so they cannot serve a normal chat/generation
 * request: they are surfaced only to agent pickers (hidden from chat selectors,
 * rejected as a topic-naming model). Capability-derived from `authMethods`, not
 * keyed to a specific provider id, so a second such provider is covered for free.
 */
export function isExternalCliProvider(provider: Pick<Provider, 'authMethods'>): boolean {
  return provider.authMethods?.includes('external-cli') ?? false
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
