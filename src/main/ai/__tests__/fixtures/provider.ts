import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ProviderModelRoute } from '@cherrystudio/provider-registry'
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

// this file → fixtures → __tests__ → ai → main → src → repo root
const providersPath = join(
  fileURLToPath(import.meta.url),
  '../../../../../..',
  'packages/provider-registry/data/providers.json'
)

/**
 * A gateway's shipped `modelRouting` table. Per-model endpoint dispatch is registry data that
 * `ProviderService` carries onto the provider row, so tests read the same declaration production
 * runs on instead of a hand-copied fixture.
 */
export function registryModelRouting(providerId: string): ProviderModelRoute[] | undefined {
  const { providers } = JSON.parse(readFileSync(providersPath, 'utf8')) as {
    providers: Array<{ id: string; modelRouting?: ProviderModelRoute[] }>
  }
  return providers.find((provider) => provider.id === providerId)?.modelRouting
}
