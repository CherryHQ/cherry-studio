import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { createImageGenerationModel } from '../imageGenerationModel'
import { createOvmsTransport, DEFAULT_OVMS_BASE_URL } from './ovmsTransport'

export const OVMS_PROVIDER_NAME = 'ovms' as const

export interface OvmsProviderSettings {
  /** OVMS is a local OpenVINO Model Server with no auth — `apiKey` is
   * accepted for type symmetry with other providers but never read. */
  apiKey?: string
  /** Chat / embedding endpoint (e.g. `http://localhost:8000/v3/`). */
  baseURL?: string
  /** Paintings-side endpoint for the single-shot transport (defaults to
   * `DEFAULT_OVMS_BASE_URL`). */
  imageBaseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface OvmsProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
}

/**
 * Unified OVMS provider — chat, embedding, and image off one `ProviderV3`,
 * mirroring `newapi-provider.ts`. OVMS is a local OpenVINO Model Server with
 * NO auth, so headers carry only what the caller passes (no `Authorization`).
 * Chat/embedding hit `settings.baseURL`; the image model keeps its bespoke
 * single-shot behavior via `createImageGenerationModel + createOvmsTransport`
 * aimed at `settings.imageBaseURL`.
 */
export function createOvmsProvider(settings: OvmsProviderSettings = {}): OvmsProvider {
  const { baseURL, fetch: customFetch } = settings
  if (!baseURL) {
    throw new Error(
      'OVMS provider requires a non-empty `baseURL`. An empty value would resolve fetch paths against the renderer process origin (app://, file://) and surface as opaque "Failed to fetch" errors.'
    )
  }

  const authHeaders = () => ({ ...settings.headers })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${OVMS_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const transport = createOvmsTransport({
    baseURL: settings.imageBaseURL || DEFAULT_OVMS_BASE_URL
  })

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${OVMS_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })
  provider.imageModel = (modelId: string) =>
    createImageGenerationModel(modelId, { provider: OVMS_PROVIDER_NAME, transport })

  return provider as OvmsProvider
}
