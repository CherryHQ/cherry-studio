/**
 * Pure helpers for transforming WebSearch preference values into
 * runtime-shaped `ResolvedWebSearchProvider`s and back. Shared between
 * main and renderer; no IO, no preferenceService dependency.
 */

import type {
  PreferenceDefaultScopeType,
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchProviderOverride,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import { PRESETS_WEB_SEARCH_PROVIDERS } from '@shared/data/presets/web-search-providers'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'

export type WebSearchAvailability = boolean | 'unknown'

export const WEB_SEARCH_PREFERENCE_KEYS = {
  defaultProvider: 'chat.web_search.default_search_keywords_provider',
  excludeDomains: 'chat.web_search.exclude_domains',
  maxResults: 'chat.web_search.max_results',
  providerOverrides: 'chat.web_search.provider_overrides',
  compressionMethod: 'chat.web_search.compression.method',
  cutoffLimit: 'chat.web_search.compression.cutoff_limit'
} as const

export type WebSearchPreferenceKeyAlias = keyof typeof WEB_SEARCH_PREFERENCE_KEYS

export type WebSearchPreferenceValues = {
  [K in WebSearchPreferenceKeyAlias]: PreferenceDefaultScopeType[(typeof WEB_SEARCH_PREFERENCE_KEYS)[K]]
}

/** Form-shape update used by settings UI (string apiKey, single apiHost). */
export type WebSearchProviderFormUpdate = {
  apiKey?: string
  apiHost?: string
  engines?: string[]
  basicAuthUsername?: string
  basicAuthPassword?: string
}

export function parseApiKeys(apiKey?: string): string[] | undefined {
  if (!apiKey) return undefined
  const apiKeys = apiKey
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
  return apiKeys.length > 0 ? apiKeys : undefined
}

export function stringifyApiKeys(apiKeys?: readonly string[]): string {
  return (
    apiKeys
      ?.map((key) => key.trim())
      .filter(Boolean)
      .join(',') ?? ''
  )
}

/** Read the resolved apiHost for a capability, falling back to the preset value. */
export function getProviderApiHost(
  provider: Pick<ResolvedWebSearchProvider, 'capabilities'>,
  capability: WebSearchCapability = 'searchKeywords'
): string | undefined {
  return provider.capabilities.find((item) => item.feature === capability)?.apiHost
}

/**
 * Whether the provider is fully configured. Mirrors the legacy
 * `webSearchService.isWebSearchEnabled` boolean check (without the cache
 * `'unknown'` fallback — callers handle cache readiness separately).
 */
export function checkWebSearchAvailability(
  provider: ResolvedWebSearchProvider,
  webSearchProviderRequiresApiKey: (id: WebSearchProviderId) => boolean,
  capability: WebSearchCapability = 'searchKeywords'
): boolean {
  if (webSearchProviderRequiresApiKey(provider.id)) {
    return provider.apiKeys.some((k) => k.trim().length > 0)
  }
  return Boolean(getProviderApiHost(provider, capability)?.trim())
}

/**
 * Hydrate every preset provider with its user override, returning the
 * runtime/service shape that `createWebSearchProvider` consumes.
 */
export function resolveWebSearchProviders(overrides: WebSearchProviderOverrides): ResolvedWebSearchProvider[] {
  return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => {
    const override = overrides[preset.id]
    const capabilities = preset.capabilities.map((cap) => {
      const presetHost = cap.apiHost?.trim()
      const overrideHost = override?.capabilities?.[cap.feature]?.apiHost?.trim()
      const apiHost = overrideHost ?? presetHost ?? ''
      return cap.feature === 'searchKeywords'
        ? { feature: 'searchKeywords' as const, apiHost }
        : { feature: 'fetchUrls' as const, apiHost }
    })

    return {
      id: preset.id,
      name: preset.name,
      type: preset.type,
      apiKeys: override?.apiKeys ?? [],
      capabilities,
      engines: override?.engines ?? [],
      basicAuthUsername: override?.basicAuthUsername?.trim() ?? '',
      basicAuthPassword: override?.basicAuthPassword ?? ''
    }
  })
}

/** Reverse of `resolveWebSearchProviders` — diff resolved providers against
 *  presets to produce the minimal override map. */
export function buildWebSearchProviderOverrides(providers: ResolvedWebSearchProvider[]): WebSearchProviderOverrides {
  return providers.reduce<WebSearchProviderOverrides>((acc, provider) => {
    const preset = PRESETS_WEB_SEARCH_PROVIDERS.find((p) => p.id === provider.id)
    const capabilityOverrides: WebSearchProviderOverride['capabilities'] = {}
    for (const cap of provider.capabilities) {
      const presetHost = preset?.capabilities.find((item) => item.feature === cap.feature)?.apiHost?.trim() ?? ''
      const currentHost = cap.apiHost?.trim() ?? ''
      if (currentHost !== presetHost) {
        capabilityOverrides[cap.feature] = { apiHost: currentHost }
      }
    }

    // Drop empty array/object so a no-op resolution doesn't materialize an override.
    const apiKeys = provider.apiKeys.length > 0 ? provider.apiKeys : undefined
    const capabilities = Object.keys(capabilityOverrides).length > 0 ? capabilityOverrides : undefined
    const engines = provider.engines.length > 0 ? provider.engines : undefined

    const normalizedOverride = normalizeWebSearchProviderOverride({
      apiKeys,
      capabilities,
      engines,
      basicAuthUsername: provider.basicAuthUsername,
      basicAuthPassword: provider.basicAuthPassword
    })

    if (Object.keys(normalizedOverride).length > 0) {
      acc[provider.id] = normalizedOverride
    }

    return acc
  }, {})
}

/** Apply a settings-form update (string apiKey, single apiHost) onto the
 *  preference override map for a single provider. Returns the new override map. */
export function updateWebSearchProviderOverride(
  overrides: WebSearchProviderOverrides,
  providerId: WebSearchProviderId,
  updates: WebSearchProviderFormUpdate,
  capability: WebSearchCapability = 'searchKeywords'
): WebSearchProviderOverrides {
  const currentOverride = overrides[providerId] ?? {}
  const nextOverride: WebSearchProviderOverride = {
    ...currentOverride,
    apiKeys: updates.apiKey !== undefined ? parseApiKeys(updates.apiKey) : currentOverride.apiKeys,
    capabilities:
      updates.apiHost !== undefined
        ? {
            ...currentOverride.capabilities,
            [capability]: {
              ...currentOverride.capabilities?.[capability],
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

  return { ...overrides, [providerId]: normalizedOverride }
}

/** Trim each field; pass through explicit empty strings/arrays so the user
 *  can clear a field without forgetting it on the next merge. */
function normalizeWebSearchProviderOverride(override: WebSearchProviderOverride): WebSearchProviderOverride {
  const normalizedOverride: WebSearchProviderOverride = {}

  if (override.apiKeys !== undefined) {
    normalizedOverride.apiKeys = override.apiKeys.map((key) => key.trim()).filter(Boolean)
  }

  if (override.capabilities !== undefined) {
    const capabilities: WebSearchProviderOverride['capabilities'] = {}
    for (const [feature, capabilityOverride] of Object.entries(override.capabilities)) {
      if (!capabilityOverride) continue
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
