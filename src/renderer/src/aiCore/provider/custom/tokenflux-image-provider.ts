import type { ImageModelV3, ProviderV3 } from '@ai-sdk/provider'

import { createPollingImageModel } from './pollingImageModel'
import { createTokenFluxTransport, DEFAULT_TOKENFLUX_BASE_URL } from './pollingTransports/tokenflux'

export const TOKENFLUX_IMAGE_PROVIDER_NAME = 'tokenflux' as const

export interface TokenFluxImageProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
}

export interface TokenFluxImageProvider extends ProviderV3 {
  imageModel(modelId: string): ImageModelV3
}

/**
 * Image-only TokenFlux provider. Exposes `.imageModel(modelId)` backed by the
 * relocated TokenFlux submit/poll transport via the generic
 * `PollingImageModel`. `languageModel`/`embeddingModel` are intentionally
 * unsupported (this provider only serves the paintings page).
 */
export function createTokenFluxImageProvider(
  settings: TokenFluxImageProviderSettings = {}
): TokenFluxImageProvider {
  const transport = createTokenFluxTransport({
    apiKey: settings.apiKey ?? '',
    baseURL: settings.baseURL || DEFAULT_TOKENFLUX_BASE_URL
  })

  const unsupported = (kind: string) => () => {
    throw new Error(`TokenFlux image provider does not support ${kind}`)
  }

  const provider = {
    specificationVersion: 'v3' as const,
    languageModel: unsupported('languageModel'),
    embeddingModel: unsupported('embeddingModel'),
    imageModel: (modelId: string) =>
      createPollingImageModel(modelId, { provider: TOKENFLUX_IMAGE_PROVIDER_NAME, transport })
  }

  return provider as unknown as TokenFluxImageProvider
}

export const tokenFluxImageProvider = createTokenFluxImageProvider()
