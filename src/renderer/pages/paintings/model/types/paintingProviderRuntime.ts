import { withoutTrailingSlash } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { ApiKeyEntry, EndpointConfig, Provider } from '@shared/data/types/provider'

export interface PaintingProviderRuntime {
  id: string
  name: string
  presetProviderId?: string
  defaultChatEndpoint?: Provider['defaultChatEndpoint']
  isEnabled: boolean
  apiHost: string
  getApiKey: () => Promise<string>
}

/**
 * Providers whose painting pipeline speaks the OpenAI images HTTP shape (`/v1/images/generations` et al.)
 * but may arrive without a populated `endpointConfigs` row.
 */
const OPENAI_COMPAT_IMAGE_PROVIDER_IDS = new Set(['new-api', 'cherryin', 'aionly'])

export function isPaintingNewApiProvider(provider: Pick<Provider, 'id' | 'presetProviderId'>) {
  return (
    OPENAI_COMPAT_IMAGE_PROVIDER_IDS.has(provider.id) ||
    (provider.presetProviderId != null && OPENAI_COMPAT_IMAGE_PROVIDER_IDS.has(provider.presetProviderId))
  )
}

function baseUrlFromEndpointConfigs(
  endpointConfigs: Partial<Record<EndpointType, EndpointConfig>> | undefined,
  preferred: Provider['defaultChatEndpoint']
): string {
  if (!endpointConfigs) {
    return ''
  }

  const raw =
    endpointConfigs[ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]?.baseUrl ||
    (preferred ? endpointConfigs[preferred]?.baseUrl : undefined) ||
    endpointConfigs[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl ||
    ''

  return raw ? withoutTrailingSlash(raw) : ''
}

export function resolvePaintingApiHost(
  provider?: Provider,
  presetEndpointConfigs?: Provider['endpointConfigs'] | null
): string {
  if (!provider) {
    return ''
  }

  const configured = baseUrlFromEndpointConfigs(provider.endpointConfigs, provider.defaultChatEndpoint)
  if (configured) {
    return configured
  }

  if (!isPaintingNewApiProvider(provider)) {
    return ''
  }

  return baseUrlFromEndpointConfigs(presetEndpointConfigs ?? undefined, provider.defaultChatEndpoint)
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
  apiKey: string,
  presetEndpointConfigs?: Provider['endpointConfigs'] | null
): PaintingProviderRuntime {
  return {
    id: provider?.id || providerId,
    name: provider?.name || providerId,
    presetProviderId: provider?.presetProviderId,
    defaultChatEndpoint: provider?.defaultChatEndpoint,
    isEnabled: provider?.isEnabled ?? false,
    apiHost: resolvePaintingApiHost(provider, presetEndpointConfigs),
    getApiKey: async () => apiKey
  }
}
