import { getProviderLabel } from '@renderer/i18n/label'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { EndpointConfig, Provider } from '@shared/data/types/provider'

import { getProviderHostTopology } from './providerTopology'

// ─── Protocol-level: check defaultChatEndpoint ───────────────────────────────

export function isAnthropicProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
}

export function isGeminiProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
}

export function isOllamaProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.OLLAMA_CHAT
}

export function isOpenAIResponsesProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
}

export function isOpenAIChatProvider(provider: Provider): boolean {
  return provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
}

// ─── Vendor-level: check authType ────────────────────────────────────────────
// Azure/Vertex/Bedrock reuse other vendors' endpoint protocols,
// so authType is the only reliable discriminator.

export function isAzureOpenAIProvider(provider: Provider): boolean {
  return provider.authType === 'iam-azure'
}

export function isVertexProvider(provider: Provider): boolean {
  return provider.authType === 'iam-gcp'
}

export function isAwsBedrockProvider(provider: Provider): boolean {
  return provider.authType === 'iam-aws' || provider.authType === 'api-key-aws'
}

// ─── ID-level: direct comparison ─────────────────────────────────────────────

export function isCherryAIProvider(provider: Provider): boolean {
  return provider.id === 'cherryai'
}

export function isPerplexityProvider(provider: Provider): boolean {
  return provider.id === 'perplexity'
}

export function isProviderSettingsListVisibleProvider(provider: Provider): boolean {
  return !isCherryAIProvider(provider)
}

export function isNewApiProvider(provider: Provider): boolean {
  return ['new-api', 'cherryin', 'aionly'].includes(provider.id) || provider.presetProviderId === 'new-api'
}

export function isSystemProvider(provider: Provider): boolean {
  return provider.presetProviderId != null
}

function isCanonicalPresetProvider(provider: Provider): boolean {
  return provider.presetProviderId != null && provider.id === provider.presetProviderId
}

/**
 * Canonical preset providers are seeded built-ins whose runtime ID equals the
 * linked preset ID. Preset-derived user providers remain user-manageable.
 */
export function canManageProvider(provider: Provider): boolean {
  return provider.presetProviderId == null || provider.presetProviderId !== provider.id
}

// ─── Composite ───────────────────────────────────────────────────────────────

export function isOpenAICompatibleProvider(provider: Provider): boolean {
  return (
    provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS ||
    provider.defaultChatEndpoint === ENDPOINT_TYPE.OPENAI_RESPONSES
  )
}

export function isAnthropicSupportedProvider(provider: Provider): boolean {
  return getProviderHostTopology(provider).hasAnthropicEndpoint
}

// ─── Capability checks (apiFeatures booleans) ────────────────────────────────

export function isSupportArrayContentProvider(provider: Provider): boolean {
  return provider.apiFeatures.arrayContent
}

export function isSupportDeveloperRoleProvider(provider: Provider): boolean {
  return provider.apiFeatures.developerRole
}

export function isSupportStreamOptionsProvider(provider: Provider): boolean {
  return provider.apiFeatures.streamOptions
}

export function isSupportServiceTierProvider(provider: Provider): boolean {
  return provider.apiFeatures.serviceTier
}

export function isSupportVerbosityProvider(provider: Provider): boolean {
  return provider.apiFeatures.verbosity
}

export function isSupportEnableThinkingProvider(provider: Provider): boolean {
  return provider.apiFeatures.enableThinking
}

export function isProviderSupportAuth(provider: Pick<Provider, 'id'>): boolean {
  const supportProviders = ['302ai', 'silicon', 'aihubmix', 'ppio', 'tokenflux', 'aionly']
  return supportProviders.includes(provider.id)
}

// ─── Display helpers ─────────────────────────────────────────────────────────

export function getFancyProviderName(provider: Provider): string {
  if (isCanonicalPresetProvider(provider)) {
    const presetProviderId = provider.presetProviderId
    if (presetProviderId) {
      return getProviderLabel(presetProviderId)
    }
  }

  return provider.name
}

export function getProviderSearchString(provider: Provider): string {
  if (isCanonicalPresetProvider(provider)) {
    const presetProviderId = provider.presetProviderId
    if (presetProviderId) {
      return `${getProviderLabel(presetProviderId)} ${provider.id}`
    }
  }

  return `${provider.id} ${provider.name}`
}

export function matchKeywordsInProvider(keywords: string[], provider: Provider, extraSearchString?: string): boolean {
  if (keywords.length === 0) return true
  const base = getProviderSearchString(provider)
  const searchStr = (extraSearchString ? `${base} ${extraSearchString}` : base).toLowerCase()
  return keywords.every((kw) => searchStr.includes(kw))
}

// ─── API Key helpers ────────────────────────────────────────────────────────

/**
 * Check if provider has at least one enabled API key.
 * Replaces v1 `!isEmpty(provider.apiKey)`.
 */
export function hasApiKeys(provider: Provider): boolean {
  return provider.apiKeys.length > 0 && provider.apiKeys.some((k) => k.isEnabled)
}

// ─── Base URL helpers ───────────────────────────────────────────────────────

/**
 * Replace the domain (host) in all endpointConfigs baseUrls while preserving URL paths
 * and other EndpointConfig fields (reasoningFormatType, modelsApiUrls).
 * Used by CherryIN/DMXAPI domain switching.
 */
export function replaceEndpointConfigDomain(
  endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> | undefined,
  newDomain: string
): Partial<Record<EndpointType, EndpointConfig>> {
  if (!endpointConfigs) return {}
  const result: Partial<Record<EndpointType, EndpointConfig>> = {}
  for (const [key, config] of Object.entries(endpointConfigs)) {
    if (!config) continue
    const ep = key as EndpointType
    const baseUrl = config.baseUrl
    if (!baseUrl) {
      result[ep] = config
      continue
    }
    try {
      const parsed = new URL(baseUrl)
      parsed.hostname = newDomain
      result[ep] = { ...config, baseUrl: parsed.toString().replace(/\/$/, '') }
    } catch {
      result[ep] = config
    }
  }
  return result
}
