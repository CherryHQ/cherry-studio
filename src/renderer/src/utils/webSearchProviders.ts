import { webSearchProviderRequiresApiKey } from '@renderer/config/webSearchProviders'
import type { WebSearchProvider } from '@renderer/types'
import type {
  PreferenceDefaultScopeType,
  PreferenceKeyType,
  WebSearchCapability,
  WebSearchProviderCapabilityOverride,
  WebSearchProviderId,
  WebSearchProviderOverride,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import { getDefaultValue } from '@shared/data/preference/preferenceUtils'
import type { WebSearchProviderFeatureCapability } from '@shared/data/presets/web-search-providers'
import { findWebSearchCapability, PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'
import { normalizeWebSearchCutoffLimit } from '@shared/data/types/webSearch'

export type RendererWebSearchProvider = WebSearchProvider & {
  capabilities: WebSearchProviderFeatureCapability[]
}

type WebSearchPreferenceSnapshot = Pick<
  PreferenceDefaultScopeType,
  | 'chat.web_search.default_search_keywords_provider'
  | 'chat.web_search.default_fetch_urls_provider'
  | 'chat.web_search.exclude_domains'
  | 'chat.web_search.max_results'
  | 'chat.web_search.provider_overrides'
  | 'chat.web_search.subscribe_sources'
  | 'chat.web_search.compression.method'
  | 'chat.web_search.compression.cutoff_limit'
  | 'chat.web_search.compression.cutoff_unit'
>

export const WEB_SEARCH_PREFERENCE_KEYS = {
  defaultSearchKeywordsProvider: 'chat.web_search.default_search_keywords_provider',
  defaultFetchUrlsProvider: 'chat.web_search.default_fetch_urls_provider',
  excludeDomains: 'chat.web_search.exclude_domains',
  maxResults: 'chat.web_search.max_results',
  providerOverrides: 'chat.web_search.provider_overrides',
  subscribeSources: 'chat.web_search.subscribe_sources',
  compressionMethod: 'chat.web_search.compression.method',
  cutoffLimit: 'chat.web_search.compression.cutoff_limit',
  cutoffUnit: 'chat.web_search.compression.cutoff_unit'
} as const

export type WebSearchPreferenceValues = {
  -readonly [K in keyof typeof WEB_SEARCH_PREFERENCE_KEYS]: WebSearchPreferenceSnapshot[(typeof WEB_SEARCH_PREFERENCE_KEYS)[K]]
}

export type RendererCompressionConfig = {
  method: PreferenceDefaultScopeType['chat.web_search.compression.method']
  cutoffLimit: number
  cutoffUnit?: PreferenceDefaultScopeType['chat.web_search.compression.cutoff_unit']
}

export type WebSearchSettingsState = {
  defaultSearchKeywordsProvider: WebSearchProviderId | null
  defaultFetchUrlsProvider: WebSearchProviderId | null
  providers: RendererWebSearchProvider[]
  maxResults: number
  excludeDomains: string[]
  subscribeSources: PreferenceDefaultScopeType['chat.web_search.subscribe_sources']
  compressionConfig: RendererCompressionConfig
}

export type WebSearchMissingConfigReason = 'apiKey' | 'apiHost'
export type WebSearchConfigAvailability =
  | { available: true }
  | { available: false; reason: WebSearchMissingConfigReason }

function parseApiKeys(apiKey?: string): string[] | undefined {
  if (!apiKey) {
    return undefined
  }

  const apiKeys = apiKey
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)

  return apiKeys.length > 0 ? apiKeys : undefined
}

function stringifyApiKeys(apiKeys?: string[]): string {
  return (
    apiKeys
      ?.map((key) => key.trim())
      .filter(Boolean)
      .join(',') ?? ''
  )
}

function mergeProviderCapabilities(
  presetCapabilities: readonly WebSearchProviderFeatureCapability[],
  override: WebSearchProviderOverride | undefined
): WebSearchProviderFeatureCapability[] {
  return presetCapabilities.map((capability) => ({
    ...capability,
    ...(override?.capabilities?.[capability.feature]?.apiHost !== undefined
      ? { apiHost: override.capabilities[capability.feature]?.apiHost?.trim() }
      : {})
  }))
}

export function resolveWebSearchProviders(overrides: WebSearchProviderOverrides): RendererWebSearchProvider[] {
  return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => {
    const override = overrides[preset.id]
    const capabilities = mergeProviderCapabilities(preset.capabilities, override)
    const searchKeywordsCapability = findWebSearchCapability({ capabilities }, 'searchKeywords')

    return {
      id: preset.id,
      name: preset.name,
      apiKey: stringifyApiKeys(override?.apiKeys),
      apiHost: searchKeywordsCapability?.apiHost?.trim() ?? '',
      capabilities,
      engines: override?.engines || [],
      basicAuthUsername: override?.basicAuthUsername?.trim() || '',
      basicAuthPassword: override?.basicAuthPassword ?? ''
    }
  })
}

export function buildWebSearchProviderOverrides(providers: RendererWebSearchProvider[]): WebSearchProviderOverrides {
  return providers.reduce<WebSearchProviderOverrides>((acc, provider) => {
    const capabilities = provider.capabilities.reduce<
      Partial<Record<WebSearchCapability, WebSearchProviderCapabilityOverride>>
    >(
      (capabilityAcc, capability) => ({
        ...capabilityAcc,
        [capability.feature]: capability.apiHost !== undefined ? { apiHost: capability.apiHost } : {}
      }),
      {}
    )
    const normalizedOverride = normalizeWebSearchProviderOverride({
      apiKeys: parseApiKeys(provider.apiKey),
      capabilities: Object.keys(capabilities).length > 0 ? capabilities : undefined,
      engines: provider.engines,
      basicAuthUsername: provider.basicAuthUsername,
      basicAuthPassword: provider.basicAuthPassword
    })

    if (Object.keys(normalizedOverride).length > 0) {
      acc[provider.id] = normalizedOverride
    }

    return acc
  }, {})
}

export function updateWebSearchProviderOverride(
  overrides: WebSearchProviderOverrides,
  providerId: WebSearchProviderId,
  updates: Partial<RendererWebSearchProvider>
): WebSearchProviderOverrides {
  const currentOverride = overrides[providerId] ?? {}
  const nextOverride: WebSearchProviderOverride = {
    ...currentOverride,
    apiKeys: updates.apiKey !== undefined ? parseApiKeys(updates.apiKey) : currentOverride.apiKeys,
    capabilities:
      updates.capabilities !== undefined
        ? mergeCapabilityUpdates(currentOverride.capabilities, updates.capabilities)
        : updates.apiHost !== undefined
          ? {
              ...currentOverride.capabilities,
              searchKeywords: {
                ...currentOverride.capabilities?.searchKeywords,
                apiHost: updates.apiHost
              }
            }
          : currentOverride.capabilities,
    engines: updates.engines !== undefined ? updates.engines : currentOverride.engines,
    basicAuthUsername:
      updates.basicAuthUsername !== undefined ? updates.basicAuthUsername : currentOverride.basicAuthUsername,
    basicAuthPassword:
      updates.basicAuthPassword !== undefined ? updates.basicAuthPassword : currentOverride.basicAuthPassword
  }

  const normalizedOverride = normalizeWebSearchProviderOverride(nextOverride)

  if (Object.keys(normalizedOverride).length === 0) {
    const restOverrides = { ...overrides }
    delete restOverrides[providerId]
    return restOverrides
  }

  return {
    ...overrides,
    [providerId]: normalizedOverride
  }
}

function mergeCapabilityUpdates(
  currentCapabilities: WebSearchProviderOverride['capabilities'],
  updates: WebSearchProviderFeatureCapability[]
): WebSearchProviderOverride['capabilities'] {
  return updates.reduce<WebSearchProviderOverride['capabilities']>(
    (acc, capability) => ({
      ...acc,
      [capability.feature]: {
        ...acc?.[capability.feature],
        apiHost: capability.apiHost
      }
    }),
    currentCapabilities ? { ...currentCapabilities } : {}
  )
}

export function buildRendererWebSearchState(preferences: WebSearchPreferenceValues): WebSearchSettingsState {
  const defaultSearchKeywordsProvider = getPreferenceOrDefault(
    WEB_SEARCH_PREFERENCE_KEYS.defaultSearchKeywordsProvider,
    preferences.defaultSearchKeywordsProvider
  )
  const defaultFetchUrlsProvider = getPreferenceOrDefault(
    WEB_SEARCH_PREFERENCE_KEYS.defaultFetchUrlsProvider,
    preferences.defaultFetchUrlsProvider
  )
  const excludeDomains = getPreferenceOrDefault(WEB_SEARCH_PREFERENCE_KEYS.excludeDomains, preferences.excludeDomains)
  const maxResults = getPreferenceOrDefault(WEB_SEARCH_PREFERENCE_KEYS.maxResults, preferences.maxResults)
  const providerOverrides = getPreferenceOrDefault(
    WEB_SEARCH_PREFERENCE_KEYS.providerOverrides,
    preferences.providerOverrides
  )
  const subscribeSources = getPreferenceOrDefault(
    WEB_SEARCH_PREFERENCE_KEYS.subscribeSources,
    preferences.subscribeSources
  )
  const compressionMethod = getPreferenceOrDefault(
    WEB_SEARCH_PREFERENCE_KEYS.compressionMethod,
    preferences.compressionMethod
  )
  const cutoffLimit = getPreferenceOrDefault(WEB_SEARCH_PREFERENCE_KEYS.cutoffLimit, preferences.cutoffLimit)
  const cutoffUnit = getPreferenceOrDefault(WEB_SEARCH_PREFERENCE_KEYS.cutoffUnit, preferences.cutoffUnit)

  return {
    defaultSearchKeywordsProvider,
    defaultFetchUrlsProvider,
    providers: resolveWebSearchProviders(providerOverrides),
    maxResults: Math.max(1, maxResults),
    excludeDomains,
    subscribeSources,
    compressionConfig: {
      method: compressionMethod,
      cutoffLimit: normalizeWebSearchCutoffLimit(cutoffLimit),
      cutoffUnit
    }
  }
}

export function getWebSearchProviderAvailability(
  provider: RendererWebSearchProvider,
  capability: WebSearchCapability = 'searchKeywords'
): WebSearchConfigAvailability {
  if (webSearchProviderRequiresApiKey(provider.id) && !provider.apiKey?.trim()) {
    return { available: false, reason: 'apiKey' }
  }

  const capabilityConfig = findWebSearchCapability(provider, capability)
  if (!capabilityConfig) {
    return { available: false, reason: 'apiHost' }
  }

  if (provider.id === 'fetch' && capability === 'fetchUrls') {
    return { available: true }
  }

  if (capabilityConfig.apiHost !== undefined && !capabilityConfig.apiHost.trim()) {
    return { available: false, reason: 'apiHost' }
  }

  return { available: true }
}

function getPreferenceOrDefault<K extends PreferenceKeyType>(
  key: K,
  value: PreferenceDefaultScopeType[K] | null | undefined
): PreferenceDefaultScopeType[K] {
  const defaultValue = getDefaultValue(key)
  if (value === undefined || (value === null && defaultValue !== null)) {
    return defaultValue as PreferenceDefaultScopeType[K]
  }

  return value as PreferenceDefaultScopeType[K]
}

function normalizeWebSearchProviderOverride(override: WebSearchProviderOverride): WebSearchProviderOverride {
  const normalizedOverride: WebSearchProviderOverride = {}

  if (override.apiKeys !== undefined) {
    normalizedOverride.apiKeys = override.apiKeys.map((key) => key.trim()).filter(Boolean)
  }

  if (override.capabilities !== undefined) {
    const capabilities: WebSearchProviderOverride['capabilities'] = {}

    for (const [feature, capabilityOverride] of Object.entries(override.capabilities)) {
      if (!capabilityOverride) {
        continue
      }

      capabilities[feature as WebSearchCapability] = {
        ...(capabilityOverride.apiHost !== undefined ? { apiHost: capabilityOverride.apiHost.trim() } : {})
      }
    }

    normalizedOverride.capabilities = capabilities
  }

  if (override.engines !== undefined) {
    normalizedOverride.engines = override.engines
  }

  if (override.basicAuthUsername !== undefined) {
    normalizedOverride.basicAuthUsername = override.basicAuthUsername.trim()
  }

  if (override.basicAuthPassword !== undefined) {
    normalizedOverride.basicAuthPassword = override.basicAuthPassword
  }

  return normalizedOverride
}
