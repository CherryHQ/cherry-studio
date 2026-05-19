import type { ImageModelV3, ProviderV3 } from '@ai-sdk/provider'

import { createPollingImageModel } from './pollingImageModel'
import { createDmxapiTransport, DEFAULT_DMXAPI_BASE_URL } from './pollingTransports/dmxapi'

export const DMXAPI_IMAGE_PROVIDER_NAME = 'dmxapi' as const

export interface DmxapiImageProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
}

export interface DmxapiImageProvider extends ProviderV3 {
  imageModel(modelId: string): ImageModelV3
}

/**
 * Image-only DMXAPI provider. Exposes `.imageModel(modelId)` backed by the
 * relocated DMXAPI single-shot transport via the generic `PollingImageModel`
 * (its non-poll path: `submit()` returns finished image URLs/data strings, so
 * `poll()` is never invoked). `languageModel`/`embeddingModel` are
 * intentionally unsupported (this provider only serves the paintings page).
 */
export function createDmxapiImageProvider(settings: DmxapiImageProviderSettings = {}): DmxapiImageProvider {
  const transport = createDmxapiTransport({
    apiKey: settings.apiKey ?? '',
    baseURL: settings.baseURL || DEFAULT_DMXAPI_BASE_URL
  })

  const unsupported = (kind: string) => () => {
    throw new Error(`DMXAPI image provider does not support ${kind}`)
  }

  const provider = {
    specificationVersion: 'v3' as const,
    languageModel: unsupported('languageModel'),
    embeddingModel: unsupported('embeddingModel'),
    imageModel: (modelId: string) =>
      createPollingImageModel(modelId, { provider: DMXAPI_IMAGE_PROVIDER_NAME, transport })
  }

  return provider as unknown as DmxapiImageProvider
}

export const dmxapiImageProvider = createDmxapiImageProvider()
