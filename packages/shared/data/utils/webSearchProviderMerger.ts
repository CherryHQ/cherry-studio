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
