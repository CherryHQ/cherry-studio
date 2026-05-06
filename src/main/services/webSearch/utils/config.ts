import type {
  PreferenceDefaultScopeType,
  PreferenceKeyType,
  WebSearchCapability,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import type { WebSearchProviderFeatureCapability } from '@shared/data/presets/web-search-providers'
import { PRESETS_WEB_SEARCH_PROVIDERS, WEB_SEARCH_PROVIDER_PRESET_MAP } from '@shared/data/presets/web-search-providers'
import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResolvedConfig
} from '@shared/data/types/webSearch'
import { normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'

export interface WebSearchPreferenceReader {
  get<K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] | Promise<PreferenceDefaultScopeType[K]>
}

const DEFAULT_PROVIDER_KEY_BY_CAPABILITY = {
  searchKeywords: 'chat.web_search.default_search_keywords_provider',
  fetchUrls: 'chat.web_search.default_fetch_urls_provider'
} as const satisfies Record<WebSearchCapability, PreferenceKeyType>

export async function getProviderOverrides(
  preferences: WebSearchPreferenceReader
): Promise<WebSearchProviderOverrides> {
  const providerOverrides = await preferences.get('chat.web_search.provider_overrides')
  return providerOverrides || {}
}

function mergeProviderCapabilities(
  presetCapabilities: readonly WebSearchProviderFeatureCapability[],
  override: WebSearchProviderOverrides[ResolvedWebSearchProvider['id']]
): WebSearchProviderFeatureCapability[] {
  return presetCapabilities.map((capability) => ({
    ...capability,
    ...(override?.capabilities?.[capability.feature]?.apiHost !== undefined
      ? { apiHost: override.capabilities[capability.feature]?.apiHost?.trim() }
      : {})
  }))
}

export function resolveProviders(providerOverrides: WebSearchProviderOverrides): ResolvedWebSearchProvider[] {
  return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => {
    const override = providerOverrides[preset.id]
    const apiKeys = override?.apiKeys?.map((apiKey) => apiKey.trim()).filter(Boolean) || []

    return {
      id: preset.id,
      name: preset.name,
      type: preset.type,
      apiKeys,
      capabilities: mergeProviderCapabilities(preset.capabilities, override),
      engines: override?.engines || [],
      basicAuthUsername: override?.basicAuthUsername?.trim() || '',
      basicAuthPassword: override?.basicAuthPassword?.trim() || ''
    }
  })
}

export async function getRuntimeConfig(preferences: WebSearchPreferenceReader): Promise<WebSearchExecutionConfig> {
  const [maxResults, excludeDomains, method, cutoffLimit, cutoffUnit] = await Promise.all([
    preferences.get('chat.web_search.max_results'),
    preferences.get('chat.web_search.exclude_domains'),
    preferences.get('chat.web_search.compression.method'),
    preferences.get('chat.web_search.compression.cutoff_limit'),
    preferences.get('chat.web_search.compression.cutoff_unit')
  ])

  return {
    maxResults: Math.max(1, maxResults),
    excludeDomains,
    compression: {
      method,
      cutoffLimit: normalizeWebSearchCutoffLimit(cutoffLimit),
      cutoffUnit
    }
  }
}

export async function getResolvedConfig(preferences: WebSearchPreferenceReader): Promise<WebSearchResolvedConfig> {
  const [providerOverrides, runtime] = await Promise.all([
    getProviderOverrides(preferences),
    getRuntimeConfig(preferences)
  ])

  return {
    providers: resolveProviders(providerOverrides),
    runtime,
    providerOverrides
  }
}

export async function getProviderById<TProviderId extends ResolvedWebSearchProvider['id']>(
  providerId: TProviderId,
  preferences: WebSearchPreferenceReader
): Promise<ResolvedWebSearchProvider & { id: TProviderId }> {
  const providerOverrides = await getProviderOverrides(preferences)
  const override = providerOverrides[providerId]
  const preset = WEB_SEARCH_PROVIDER_PRESET_MAP[providerId]
  const apiKeys = override?.apiKeys?.map((apiKey) => apiKey.trim()).filter(Boolean) || []

  if (!preset) {
    throw new Error(`Unknown web search provider: ${providerId}`)
  }

  return {
    id: providerId,
    name: preset.name,
    type: preset.type,
    apiKeys,
    capabilities: mergeProviderCapabilities(preset.capabilities, override),
    engines: override?.engines || [],
    basicAuthUsername: override?.basicAuthUsername?.trim() || '',
    basicAuthPassword: override?.basicAuthPassword?.trim() || ''
  } as ResolvedWebSearchProvider & { id: TProviderId }
}

export async function getProviderForCapability(
  requestedProviderId: ResolvedWebSearchProvider['id'] | undefined,
  capability: WebSearchCapability,
  preferences: WebSearchPreferenceReader
): Promise<ResolvedWebSearchProvider> {
  const providerId = requestedProviderId ?? (await preferences.get(DEFAULT_PROVIDER_KEY_BY_CAPABILITY[capability]))

  if (!providerId) {
    throw new Error(`Default web search provider is not configured for capability ${capability}`)
  }

  return getProviderById(providerId, preferences)
}
