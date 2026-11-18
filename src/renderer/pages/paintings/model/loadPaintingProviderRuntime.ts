import { prefetch } from '@data/hooks/useDataApi'

import {
  createPaintingProviderRuntime,
  type PaintingProviderRuntime,
  pickFirstEnabledApiKey
} from './types/paintingProviderRuntime'

const ENDPOINT_CONFIG_PRESET_FIELDS = ['endpointConfigs'] as const

/** Imperative twin of `usePaintingProviderRuntime`, for requests that span several providers. */
export async function loadPaintingProviderRuntime(providerId: string): Promise<PaintingProviderRuntime> {
  const [provider, apiKeys, preset] = await Promise.all([
    prefetch('/providers/:providerId', { params: { providerId } }),
    prefetch('/providers/:providerId/api-keys', { params: { providerId } }),
    prefetch('/providers/:providerId/preset', {
      params: { providerId },
      query: { fields: [...ENDPOINT_CONFIG_PRESET_FIELDS] }
    })
  ])
  return createPaintingProviderRuntime(
    provider,
    providerId,
    pickFirstEnabledApiKey(apiKeys?.keys),
    preset?.endpointConfigs
  )
}
