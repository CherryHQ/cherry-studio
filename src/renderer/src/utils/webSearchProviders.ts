import { webSearchProviderRequiresApiKey } from '@renderer/config/webSearchProviders'
import type {
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import type { WebSearchProviderFeatureCapability } from '@shared/data/presets/web-search-providers'
import {
  findWebSearchCapability,
  PRESETS_WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_PRESET_MAP
} from '@shared/data/presets/web-search-providers'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'

type WebSearchProviderOverride = NonNullable<WebSearchProviderOverrides[WebSearchProviderId]>

export type WebSearchProviderUpdates = Partial<
  Pick<ResolvedWebSearchProvider, 'apiKeys' | 'capabilities' | 'engines' | 'basicAuthUsername' | 'basicAuthPassword'>
>

export type WebSearchConfigAvailability = { available: true } | { available: false; reason: 'apiKey' | 'apiHost' }

function mergeProviderCapabilities(
  presetCapabilities: readonly WebSearchProviderFeatureCapability[],
  override: WebSearchProviderOverrides[WebSearchProviderId]
): WebSearchProviderFeatureCapability[] {
  return presetCapabilities.map((capability) => ({
    ...capability,
    ...(capability.apiHost !== undefined && override?.capabilities?.[capability.feature]?.apiHost !== undefined
      ? { apiHost: override.capabilities[capability.feature]?.apiHost?.trim() }
      : {})
  }))
}

export function resolveWebSearchProviders(overrides: WebSearchProviderOverrides): ResolvedWebSearchProvider[] {
  return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => {
    const override = overrides[preset.id]
    const capabilities = mergeProviderCapabilities(preset.capabilities, override)

    return {
      id: preset.id,
      name: preset.name,
      type: preset.type,
      apiKeys: override?.apiKeys?.map((apiKey) => apiKey.trim()).filter(Boolean) || [],
      capabilities,
      engines: override?.engines || [],
      basicAuthUsername: override?.basicAuthUsername?.trim() || '',
      basicAuthPassword: override?.basicAuthPassword ?? ''
    }
  })
}

export function updateWebSearchProviderOverride(
  overrides: WebSearchProviderOverrides,
  providerId: WebSearchProviderId,
  updates: WebSearchProviderUpdates
): WebSearchProviderOverrides {
  const currentOverride: WebSearchProviderOverride = overrides[providerId] ?? {}
  const nextOverride: WebSearchProviderOverride = {
    ...currentOverride,
    apiKeys: updates.apiKeys !== undefined ? updates.apiKeys : currentOverride.apiKeys,
    capabilities:
      updates.capabilities !== undefined
        ? mergeCapabilityUpdates(currentOverride.capabilities, updates.capabilities)
        : currentOverride.capabilities,
    engines: updates.engines !== undefined ? updates.engines : currentOverride.engines,
    basicAuthUsername:
      updates.basicAuthUsername !== undefined ? updates.basicAuthUsername : currentOverride.basicAuthUsername,
    basicAuthPassword:
      updates.basicAuthPassword !== undefined ? updates.basicAuthPassword : currentOverride.basicAuthPassword
  }

  const normalizedOverride = normalizeWebSearchProviderOverride(providerId, nextOverride)

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

export function getWebSearchProviderAvailability(
  provider: ResolvedWebSearchProvider,
  capability: WebSearchCapability = 'searchKeywords'
): WebSearchConfigAvailability {
  if (webSearchProviderRequiresApiKey(provider.id) && provider.apiKeys.length === 0) {
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

function normalizeWebSearchProviderOverride(
  providerId: WebSearchProviderId,
  override: WebSearchProviderOverride
): WebSearchProviderOverride {
  const normalizedOverride: WebSearchProviderOverride = {}
  const preset = WEB_SEARCH_PROVIDER_PRESET_MAP[providerId]

  if (override.apiKeys !== undefined) {
    const apiKeys = override.apiKeys.map((key) => key.trim()).filter(Boolean)
    if (apiKeys.length > 0) {
      normalizedOverride.apiKeys = apiKeys
    }
  }

  if (override.capabilities !== undefined) {
    const capabilities: WebSearchProviderOverride['capabilities'] = {}

    for (const [feature, capabilityOverride] of Object.entries(override.capabilities)) {
      if (!capabilityOverride) {
        continue
      }

      const typedFeature = feature as WebSearchCapability
      const presetCapability = findWebSearchCapability(preset, typedFeature)
      if (!presetCapability || presetCapability.apiHost === undefined) {
        continue
      }

      const presetApiHost = presetCapability?.apiHost?.trim()
      const apiHost = capabilityOverride.apiHost?.trim()

      if (apiHost !== undefined && apiHost !== presetApiHost) {
        capabilities[typedFeature] = { apiHost }
      }
    }

    if (Object.keys(capabilities).length > 0) {
      normalizedOverride.capabilities = capabilities
    }
  }

  if (override.engines !== undefined) {
    if (override.engines.length > 0) {
      normalizedOverride.engines = override.engines
    }
  }

  if (override.basicAuthUsername !== undefined) {
    const basicAuthUsername = override.basicAuthUsername.trim()
    if (basicAuthUsername) {
      normalizedOverride.basicAuthUsername = basicAuthUsername
    }
  }

  if (normalizedOverride.basicAuthUsername && override.basicAuthPassword !== undefined) {
    if (override.basicAuthPassword) {
      normalizedOverride.basicAuthPassword = override.basicAuthPassword
    }
  }

  return normalizedOverride
}
