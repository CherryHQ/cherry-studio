import type { ImageModelV3, ProviderV3 } from '@ai-sdk/provider'

import { createPollingImageModel } from './pollingImageModel'
import { createPpioTransport, DEFAULT_PPIO_BASE_URL } from './pollingTransports/ppio'

export const PPIO_IMAGE_PROVIDER_NAME = 'ppio' as const

export interface PpioImageProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
}

export interface PpioImageProvider extends ProviderV3 {
  imageModel(modelId: string): ImageModelV3
}

/**
 * Image-only PPIO provider. Exposes `.imageModel(modelId)` backed by the
 * relocated PPIO submit/poll transport via the generic `PollingImageModel`.
 * `languageModel`/`textEmbeddingModel` are intentionally unsupported (this
 * provider only serves the paintings page).
 */
export function createPpioImageProvider(settings: PpioImageProviderSettings = {}): PpioImageProvider {
  const transport = createPpioTransport({
    apiKey: settings.apiKey ?? '',
    baseURL: settings.baseURL || DEFAULT_PPIO_BASE_URL
  })

  const unsupported = (kind: string) => () => {
    throw new Error(`PPIO image provider does not support ${kind}`)
  }

  const provider = {
    specificationVersion: 'v3' as const,
    languageModel: unsupported('languageModel'),
    embeddingModel: unsupported('embeddingModel'),
    imageModel: (modelId: string) =>
      createPollingImageModel(modelId, { provider: PPIO_IMAGE_PROVIDER_NAME, transport })
  }

  return provider as unknown as PpioImageProvider
}

export const ppioImageProvider = createPpioImageProvider()
