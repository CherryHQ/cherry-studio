import type {
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'
import type { WebSearchProviderFeatureCapability } from '@shared/data/presets/web-search-providers'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'
import { findWebSearchCapability, getWebSearchProviderPresetById } from '@shared/data/utils/webSearchProviderMerger'

type WebSearchProviderOverride = NonNullable<WebSearchProviderOverrides[WebSearchProviderId]>

export type WebSearchProviderUpdates = Partial<
  Pick<ResolvedWebSearchProvider, 'apiKeys' | 'capabilities' | 'engines' | 'basicAuthUsername' | 'basicAuthPassword'>
>

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

function normalizeWebSearchProviderOverride(
  providerId: WebSearchProviderId,
  override: WebSearchProviderOverride
): WebSearchProviderOverride {
  const normalizedOverride: WebSearchProviderOverride = {}
  const preset = getWebSearchProviderPresetById(providerId)

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
