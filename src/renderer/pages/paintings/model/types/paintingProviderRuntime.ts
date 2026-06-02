import { withoutTrailingSlash } from '@renderer/utils/api'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { ApiKeyEntry, Provider } from '@shared/data/types/provider'

export interface PaintingProviderRuntime {
  id: string
  name: string
  presetProviderId?: string
  isEnabled: boolean
  apiHost: string
  getApiKey: () => Promise<string>
}

/**
 * Providers whose painting pipeline speaks the OpenAI images HTTP shape (`/v1/images/generations` et al.)
 * but may arrive without a populated `endpointConfigs` row.
 */
const OPENAI_COMPAT_IMAGE_PROVIDER_IDS = new Set(['new-api', 'cherryin', 'aionly'])

/**
 * Defaults only when `endpointConfigs` cannot supply a base — painting-local, not shared with global provider presets.
 */
const OPENAI_COMPAT_DEFAULT_BASE_URLS: Readonly<Record<string, string>> = {
  cherryin: 'https://open.cherryin.cc',
  'new-api': 'http://localhost:3000',
  aionly: 'https://api.aiionly.com'
}

export function isPaintingNewApiProvider(provider: Pick<Provider, 'id' | 'presetProviderId'>) {
  return OPENAI_COMPAT_IMAGE_PROVIDER_IDS.has(provider.id) || provider.presetProviderId === 'new-api'
}

function baseUrlFromEndpointConfigs(provider: Provider): string {
  const endpointConfigs = provider.endpointConfigs
  if (!endpointConfigs) {
    return ''
  }

  const preferred = provider.defaultChatEndpoint
  const raw =
    endpointConfigs[ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]?.baseUrl ||
    (preferred ? endpointConfigs[preferred]?.baseUrl : undefined) ||
    endpointConfigs[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl ||
    ''

  return raw ? withoutTrailingSlash(raw) : ''
}

function openAiCompatDefaultBaseUrl(provider: Pick<Provider, 'id' | 'presetProviderId'>): string {
  const fromId = OPENAI_COMPAT_DEFAULT_BASE_URLS[provider.id]
  if (fromId) {
    return fromId
  }

  const preset = provider.presetProviderId
  return preset ? (OPENAI_COMPAT_DEFAULT_BASE_URLS[preset] ?? '') : ''
}

export function resolvePaintingApiHost(provider?: Provider): string {
  if (!provider) {
    return ''
  }

  const configured = baseUrlFromEndpointConfigs(provider)
  if (configured) {
    return configured
  }

  if (!isPaintingNewApiProvider(provider)) {
    return ''
  }

  const fallback = openAiCompatDefaultBaseUrl(provider)
  return fallback ? withoutTrailingSlash(fallback) : ''
}

/** First enabled, trimmed, non-empty key — rotation is intentionally out of scope here. */
export function pickFirstEnabledApiKey(apiKeys: ApiKeyEntry[] | undefined): string {
  if (!apiKeys) {
    return ''
  }
  for (const entry of apiKeys) {
    if (!entry.isEnabled) continue
    const trimmed = entry.key.trim()
    if (trimmed) return trimmed
  }
  return ''
}

export function createPaintingProviderRuntime(
  provider: Provider | undefined,
  providerId: string,
  apiKey: string
): PaintingProviderRuntime {
  return {
    id: provider?.id || providerId,
    name: provider?.name || providerId,
    presetProviderId: provider?.presetProviderId,
    isEnabled: provider?.isEnabled ?? false,
    apiHost: resolvePaintingApiHost(provider),
    getApiKey: async () => apiKey
  }
}
