import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { EndpointDispatchConfig } from '@cherrystudio/provider-registry'
import type { EndpointType } from '@shared/data/types/model'
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
 * A gateway's shipped endpoint configs — each carries the ids it `serves`. Per-model dispatch is
 * registry data that `ProviderService` carries onto the provider row, so tests read the same
 * declaration production runs on instead of a hand-copied fixture.
 */
export function registryEndpointConfigs<T extends Record<string, unknown>>(
  providerId: string,
  /** Per-endpoint row overrides, merged FIELD-WISE as `ProviderService` does — a custom baseUrl must
   *  not drop the registry's `serves` claim for that endpoint. */
  overrides?: Partial<Record<EndpointType, T>>
): Partial<Record<EndpointType, EndpointDispatchConfig>> | undefined {
  const { providers } = JSON.parse(readFileSync(providersPath, 'utf8')) as {
    providers: Array<{ id: string; endpointConfigs?: Partial<Record<EndpointType, EndpointDispatchConfig>> }>
  }
  const shipped = providers.find((provider) => provider.id === providerId)?.endpointConfigs
  if (!overrides) return shipped
  const merged: Record<string, unknown> = { ...shipped }
  for (const [endpointType, override] of Object.entries(overrides)) {
    merged[endpointType] = { ...(shipped?.[endpointType as EndpointType] ?? {}), ...override }
  }
  return merged as Partial<Record<EndpointType, EndpointDispatchConfig>>
}
