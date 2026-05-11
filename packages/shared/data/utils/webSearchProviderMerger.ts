import type {
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchProviderOverride,
  WebSearchProviderOverrides
} from '../preference/preferenceTypes'
import {
  PRESETS_WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_PROVIDER_PRESET_MAP,
  type WebSearchProviderFeatureCapability,
  type WebSearchProviderPreset
} from '../presets/web-search-providers'
import type { ResolvedWebSearchProvider } from '../types/webSearch'

type WebSearchProviderOverrideValue = NonNullable<WebSearchProviderOverrides[WebSearchProviderId]>

export type WebSearchProviderUpdates = Partial<
  Pick<ResolvedWebSearchProvider, 'apiKeys' | 'capabilities' | 'engines' | 'basicAuthUsername' | 'basicAuthPassword'>
>

export function findWebSearchCapability(
  provider: { capabilities: readonly WebSearchProviderFeatureCapability[] },
  capability: WebSearchCapability
): WebSearchProviderFeatureCapability | undefined {
  return provider.capabilities.find((item) => item.feature === capability)
}

function mergeWebSearchProviderCapabilities(
  presetCapabilities: readonly WebSearchProviderFeatureCapability[],
  override?: WebSearchProviderOverride
): WebSearchProviderFeatureCapability[] {
  return presetCapabilities.map((capability) => ({
    ...capability,
    ...(capability.apiHost !== undefined && override?.capabilities?.[capability.feature]?.apiHost !== undefined
      ? { apiHost: override.capabilities[capability.feature]?.apiHost?.trim() }
      : {})
  }))
}

export function mergeWebSearchProviderPreset(
  preset: WebSearchProviderPreset,
  override?: WebSearchProviderOverride
): ResolvedWebSearchProvider {
  return {
    id: preset.id,
    name: preset.name,
    type: preset.type,
    apiKeys: override?.apiKeys?.map((apiKey) => apiKey.trim()).filter(Boolean) || [],
    capabilities: mergeWebSearchProviderCapabilities(preset.capabilities, override),
    engines: override?.engines || [],
    basicAuthUsername: override?.basicAuthUsername?.trim() || '',
    basicAuthPassword: override?.basicAuthPassword || ''
  }
}

export function getWebSearchProviderPresetById(providerId: WebSearchProviderId): WebSearchProviderPreset {
  return {
    id: providerId,
    ...WEB_SEARCH_PROVIDER_PRESET_MAP[providerId]
  }
}

export function mergeWebSearchProviderPresets(overrides: WebSearchProviderOverrides): ResolvedWebSearchProvider[] {
  return PRESETS_WEB_SEARCH_PROVIDERS.map((preset) => mergeWebSearchProviderPreset(preset, overrides[preset.id]))
}

export function updateWebSearchProviderOverride(
  overrides: WebSearchProviderOverrides,
  providerId: WebSearchProviderId,
  updates: WebSearchProviderUpdates
): WebSearchProviderOverrides {
  const currentOverride: WebSearchProviderOverrideValue = overrides[providerId] ?? {}
  const nextOverride: WebSearchProviderOverrideValue = {
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
  currentCapabilities: WebSearchProviderOverrideValue['capabilities'],
  updates: WebSearchProviderFeatureCapability[]
): WebSearchProviderOverrideValue['capabilities'] {
  return updates.reduce<WebSearchProviderOverrideValue['capabilities']>(
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

function normalizeWebSearchProviderOverride(
  providerId: WebSearchProviderId,
  override: WebSearchProviderOverrideValue
): WebSearchProviderOverrideValue {
  const normalizedOverride: WebSearchProviderOverrideValue = {}
  const preset = getWebSearchProviderPresetById(providerId)

  if (override.apiKeys !== undefined) {
    const apiKeys = override.apiKeys.map((key) => key.trim()).filter(Boolean)
    if (apiKeys.length > 0) {
      normalizedOverride.apiKeys = apiKeys
    }
  }

  if (override.capabilities !== undefined) {
    const capabilities: WebSearchProviderOverrideValue['capabilities'] = {}

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
