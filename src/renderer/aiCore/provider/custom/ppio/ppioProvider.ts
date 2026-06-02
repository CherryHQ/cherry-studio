import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { createImageGenerationModel } from '../imageGenerationModel'
import { createPpioTransport, DEFAULT_PPIO_BASE_URL } from './ppioTransport'

export const PPIO_PROVIDER_NAME = 'ppio' as const

export interface PpioProviderSettings {
  apiKey?: string
  /** Chat / embedding endpoint (e.g. `https://api.ppinfra.com/v3/openai`). */
  baseURL?: string
  /** Paintings-side endpoint for the submit/poll transport (legacy default
   * `https://api.ppio.com` — a different host from chat, preserved verbatim
   * from the bespoke painting service). */
  imageBaseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface PpioProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
}

/**
 * Unified PPIO provider — chat, embedding, and image off one `ProviderV3`,
 * mirroring `newapi-provider.ts`. Chat/embedding go through the OpenAI-
 * compatible SDK aimed at `settings.baseURL`; the image model keeps its
 * bespoke submit/poll behavior via `createImageGenerationModel + createPpioTransport`
 * aimed at `settings.imageBaseURL` (defaults to `DEFAULT_PPIO_BASE_URL`).
 */
export function createPpioProvider(settings: PpioProviderSettings = {}): PpioProvider {
  const { baseURL, fetch: customFetch } = settings
  if (!baseURL) {
    throw new Error(
      'PPIO provider requires a non-empty `baseURL`. An empty value would resolve fetch paths against the renderer process origin (app://, file://) and surface as opaque "Failed to fetch" errors.'
    )
  }

  const resolveApiKey = () =>
    loadApiKey({ apiKey: settings.apiKey, environmentVariableName: 'PPIO_API_KEY', description: 'PPIO' })

  const authHeaders = () => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    ...settings.headers
  })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${PPIO_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const transport = createPpioTransport({
    apiKey: settings.apiKey ?? '',
    baseURL: settings.imageBaseURL || DEFAULT_PPIO_BASE_URL
  })

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${PPIO_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })
  provider.imageModel = (modelId: string) =>
    createImageGenerationModel(modelId, { provider: PPIO_PROVIDER_NAME, transport })

  return provider as PpioProvider
}
