import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleEmbeddingModel,
  OpenAICompatibleImageModel
} from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { createImageGenerationModel } from './imageGenerationModel'
import { createDmxapiTransport, DEFAULT_DMXAPI_BASE_URL } from './imageTransports/dmxapi'

export const DMXAPI_PROVIDER_NAME = 'dmxapi' as const

/**
 * Models whose body / endpoint / response shape diverge from OpenAI's standard
 * `/v1/images/{generations,edits}` contract — they need the bespoke
 * `DmxapiTransport` (Responses API, Gemini generateContent, async-wrapped
 * qwen-image). Every other DMXAPI image model is OpenAI-flat and goes through
 * AI SDK's `OpenAICompatibleImageModel` which already covers JSON generate +
 * multipart edit natively, so we don't reimplement multipart / edit dispatch.
 */
const DMXAPI_CUSTOM_BACKEND_MODELS = new Set([
  'doubao-seedream-5.0-lite',
  'wan2.6-t2i',
  'gemini-3.1-flash-image-preview',
  'qwen-image'
])

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
 * bespoke single-shot V1/V2 routing via `createImageGenerationModel +
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
  provider.imageModel = (modelId: string): ImageModelV3 => {
    if (DMXAPI_CUSTOM_BACKEND_MODELS.has(modelId)) {
      return createImageGenerationModel(modelId, { provider: DMXAPI_PROVIDER_NAME, transport })
    }
    return new OpenAICompatibleImageModel(modelId, {
      provider: `${DMXAPI_PROVIDER_NAME}.image`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })
  }

  return provider as DmxapiProvider
}
