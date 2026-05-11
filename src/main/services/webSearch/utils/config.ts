import type {
  PreferenceDefaultScopeType,
  PreferenceKeyType,
  WebSearchCapability,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import {
  PRESETS_WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_PRESET_MAP,
  type WebSearchProviderPreset
} from '@shared/data/presets/web-search-providers'
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

function trimString(value: string): string {
  return value.trim()
}

function trimStringList(values: readonly string[]): string[] {
  return values.map(trimString).filter(Boolean)
}

export async function getProviderOverrides(
  preferences: WebSearchPreferenceReader
): Promise<WebSearchProviderOverrides> {
  const providerOverrides = await preferences.get('chat.web_search.provider_overrides')
  return providerOverrides || {}
}

function getWebSearchProviderPresetById(providerId: ResolvedWebSearchProvider['id']): WebSearchProviderPreset {
  return {
    id: providerId,
    ...WEB_SEARCH_PROVIDER_PRESET_MAP[providerId]
  }
}

function mergeWebSearchProviderPreset(
  preset: WebSearchProviderPreset,
  override?: WebSearchProviderOverrides[ResolvedWebSearchProvider['id']]
): ResolvedWebSearchProvider {
  return {
    id: preset.id,
    name: preset.name,
    type: preset.type,
    apiKeys: override?.apiKeys ? trimStringList(override.apiKeys) : [],
    capabilities: preset.capabilities.map((capability) => {
      const apiHostOverride = override?.capabilities?.[capability.feature]?.apiHost

      if (capability.apiHost === undefined || apiHostOverride === undefined) {
        return capability
      }

      return {
        ...capability,
        apiHost: trimString(apiHostOverride)
      }
    }),
    engines: override?.engines ? trimStringList(override.engines) : [],
    basicAuthUsername: trimString(override?.basicAuthUsername ?? ''),
    basicAuthPassword: trimString(override?.basicAuthPassword ?? '')
  }
}

export function resolveProviders(providerOverrides: WebSearchProviderOverrides): ResolvedWebSearchProvider[] {
  return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) =>
    mergeWebSearchProviderPreset(preset, providerOverrides[preset.id])
  )
}

export async function getRuntimeConfig(preferences: WebSearchPreferenceReader): Promise<WebSearchExecutionConfig> {
  const [maxResults, excludeDomains, method, cutoffLimit] = await Promise.all([
    preferences.get('chat.web_search.max_results'),
    preferences.get('chat.web_search.exclude_domains'),
    preferences.get('chat.web_search.compression.method'),
    preferences.get('chat.web_search.compression.cutoff_limit')
  ])

  return {
    maxResults: Math.max(1, maxResults),
    excludeDomains,
    compression: {
      method,
      cutoffLimit: normalizeWebSearchCutoffLimit(cutoffLimit)
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
  const preset = getWebSearchProviderPresetById(providerId)

  return mergeWebSearchProviderPreset(preset, override) as ResolvedWebSearchProvider & { id: TProviderId }
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
