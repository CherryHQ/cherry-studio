import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { createPollingImageModel } from './pollingImageModel'
import { createTokenFluxTransport, DEFAULT_TOKENFLUX_BASE_URL } from './pollingTransports/tokenflux'

export const TOKENFLUX_PROVIDER_NAME = 'tokenflux' as const

export interface TokenFluxProviderSettings {
  apiKey?: string
  /** Chat / embedding endpoint (e.g. `https://api.tokenflux.ai/openai/v1`). */
  baseURL?: string
  /** Paintings-side endpoint for the submit/poll transport (legacy default
   * `https://api.tokenflux.ai`, different path from chat). */
  imageBaseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface TokenFluxProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
}

/**
 * Unified TokenFlux provider — chat, embedding, and image off one `ProviderV3`,
 * mirroring `newapi-provider.ts`. Chat/embedding go through the OpenAI-
 * compatible SDK aimed at `settings.baseURL`; the image model keeps its
 * bespoke submit/poll behavior via `createPollingImageModel + createTokenFluxTransport`
 * aimed at `settings.imageBaseURL` (defaults to `DEFAULT_TOKENFLUX_BASE_URL`).
 */
export function createTokenFluxProvider(settings: TokenFluxProviderSettings = {}): TokenFluxProvider {
  const { baseURL = '', fetch: customFetch } = settings

  const resolveApiKey = () =>
    loadApiKey({ apiKey: settings.apiKey, environmentVariableName: 'TOKENFLUX_API_KEY', description: 'TokenFlux' })

  const authHeaders = () => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    ...settings.headers
  })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${TOKENFLUX_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const transport = createTokenFluxTransport({
    apiKey: settings.apiKey ?? '',
    baseURL: settings.imageBaseURL || DEFAULT_TOKENFLUX_BASE_URL
  })

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${TOKENFLUX_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })
  provider.imageModel = (modelId: string) =>
    createPollingImageModel(modelId, { provider: TOKENFLUX_PROVIDER_NAME, transport })

  return provider as TokenFluxProvider
}
