import type { ImageModelV3, ProviderV3 } from '@ai-sdk/provider'

import { createPollingImageModel } from './pollingImageModel'
import { createOvmsTransport, DEFAULT_OVMS_BASE_URL } from './pollingTransports/ovms'

export const OVMS_IMAGE_PROVIDER_NAME = 'ovms' as const

export interface OvmsImageProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
}

export interface OvmsImageProvider extends ProviderV3 {
  imageModel(modelId: string): ImageModelV3
}

/**
 * Image-only OVMS provider. Exposes `.imageModel(modelId)` backed by the
 * relocated OVMS single-shot transport via the generic `PollingImageModel`
 * (its non-poll path: `submit()` returns finished image URLs/data strings, so
 * `poll()` is never invoked). OVMS has no auth (local OpenVINO Model Server).
 * `languageModel`/`embeddingModel` are intentionally unsupported (this
 * provider only serves the paintings page).
 */
export function createOvmsImageProvider(settings: OvmsImageProviderSettings = {}): OvmsImageProvider {
  const transport = createOvmsTransport({
    baseURL: settings.baseURL || DEFAULT_OVMS_BASE_URL
  })

  const unsupported = (kind: string) => () => {
    throw new Error(`OVMS image provider does not support ${kind}`)
  }

  const provider = {
    specificationVersion: 'v3' as const,
    languageModel: unsupported('languageModel'),
    embeddingModel: unsupported('embeddingModel'),
    imageModel: (modelId: string) => createPollingImageModel(modelId, { provider: OVMS_IMAGE_PROVIDER_NAME, transport })
  }

  return provider as unknown as OvmsImageProvider
}

export const ovmsImageProvider = createOvmsImageProvider()
