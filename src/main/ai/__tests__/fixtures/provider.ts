import type { EndpointConfig, Provider } from '@shared/data/types/provider'
import { DEFAULT_API_FEATURES, DEFAULT_PROVIDER_SETTINGS } from '@shared/data/types/provider'

/**
 * Minimal valid Provider fixture for main/ai tests.
 *
 * Defaults satisfy ProviderSchema's required fields (apiKeys, authType,
 * apiFeatures, settings, isEnabled). Pass overrides for whatever the SUT
 * actually reads.
 */
export function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'fake',
    name: 'Fake',
    apiKeys: [],
    authType: 'api-key',
    apiFeatures: { ...DEFAULT_API_FEATURES },
    settings: { ...DEFAULT_PROVIDER_SETTINGS },
    isEnabled: true,
    ...overrides
  } as Provider
}

export function makeEndpointConfig(overrides: Partial<EndpointConfig> = {}): EndpointConfig {
  return { ...overrides }
}
