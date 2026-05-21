import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { createPollingImageModel } from './pollingImageModel'
import { createDmxapiTransport, DEFAULT_DMXAPI_BASE_URL } from './pollingTransports/dmxapi'

export const DMXAPI_PROVIDER_NAME = 'dmxapi' as const

export interface DmxapiProviderSettings {
  apiKey?: string
  /** Chat / embedding endpoint (the user-configured `apiHost`, defaults to
   * `https://www.dmxapi.cn` in system providers). */
  baseURL?: string
  /** Paintings-side endpoint for the single-shot transport. Mirrors the
   * legacy bespoke service's host (defaults to `DEFAULT_DMXAPI_BASE_URL`,
   * which is the `.com` TLD — kept distinct from the `.cn` chat default for
   * bespoke parity). */
  imageBaseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface DmxapiProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
}

/**
 * Unified DMXAPI provider — chat, embedding, and image off one `ProviderV3`,
 * mirroring `newapi-provider.ts`. Chat/embedding go through the OpenAI-
 * compatible SDK aimed at `settings.baseURL`; the image model keeps the
 * bespoke single-shot V1/V2 routing via `createPollingImageModel +
 * createDmxapiTransport` aimed at `settings.imageBaseURL`.
 */
export function createDmxapiProvider(settings: DmxapiProviderSettings = {}): DmxapiProvider {
  const { baseURL, fetch: customFetch } = settings
  if (!baseURL) {
    throw new Error(
      'DMXAPI provider requires a non-empty `baseURL`. An empty value would resolve fetch paths against the renderer process origin (app://, file://) and surface as opaque "Failed to fetch" errors.'
    )
  }

  const resolveApiKey = () =>
    loadApiKey({ apiKey: settings.apiKey, environmentVariableName: 'DMXAPI_API_KEY', description: 'DMXAPI' })

  const authHeaders = () => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    ...settings.headers
  })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${DMXAPI_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const transport = createDmxapiTransport({
    apiKey: settings.apiKey ?? '',
    baseURL: settings.imageBaseURL || DEFAULT_DMXAPI_BASE_URL
  })

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${DMXAPI_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })
  provider.imageModel = (modelId: string) =>
    createPollingImageModel(modelId, { provider: DMXAPI_PROVIDER_NAME, transport })

  return provider as DmxapiProvider
}
