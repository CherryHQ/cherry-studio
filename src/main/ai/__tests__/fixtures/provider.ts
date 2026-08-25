import type { EndpointConfig, Provider } from '@shared/data/types/provider'
import { DEFAULT_PROVIDER_SETTINGS } from '@shared/data/types/provider'
import { isNewApiProvider } from '@shared/utils/provider'

/**
 * Minimal valid Provider fixture for main/ai tests.
 *
 * Defaults satisfy ProviderSchema's required fields (apiKeys, authType,
 * reportsActualCost, settings, isEnabled). Pass overrides for whatever the SUT
 * actually reads.
 */
export function makeProvider(overrides: Partial<Provider> = {}): Provider {
  const provider = {
    id: 'fake',
    name: 'Fake',
    apiKeys: [],
    authType: 'api-key',
    reportsActualCost: false,
    settings: { ...DEFAULT_PROVIDER_SETTINGS },
    isEnabled: true,
    ...overrides
  } as Provider

  // The registry hands every aggregator preset `sharedEndpointHost`, and endpoint routing reads it.
  // Deriving it here keeps hand-built fixtures faithful instead of each test remembering to set it.
  if (provider.sharedEndpointHost === undefined && isNewApiProvider(provider)) {
    provider.sharedEndpointHost = true
  }
  return provider
}

export function makeEndpointConfig(overrides: Partial<EndpointConfig> = {}): EndpointConfig {
  return { ...overrides }
}
