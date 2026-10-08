import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV4, ImageModelV4, LanguageModelV4, ProviderV4 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { createImageGenerationModel, type ImageGenerationTransport } from '../imageGenerationModel'
import { createModelscopeTransport, DEFAULT_MODELSCOPE_BASE_URL } from './modelscopeTransport'

export const MODELSCOPE_PROVIDER_NAME = 'modelscope' as const

export interface ModelscopeProviderSettings {
  apiKey?: string
  /** OpenAI-compatible chat / embedding endpoint
   *  (e.g. `https://api-inference.modelscope.cn/v1/`). */
  baseURL?: string
  /** Host root for the async image submit/poll transport. Defaults to
   *  `DEFAULT_MODELSCOPE_BASE_URL` — same host as `baseURL` without `/v1/`. */
  imageBaseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface ModelscopeProvider extends ProviderV4 {
  (modelId: string): LanguageModelV4
  languageModel(modelId: string): LanguageModelV4
  embeddingModel(modelId: string): EmbeddingModelV4
  imageModel(modelId: string): ImageModelV4
}

/**
 * Build the ModelScope submit/poll image transport from provider settings.
 * Shared by the provider factory and the image-generation job's transport
 * registry (`resolveImageTransport`) so the job handler can rebuild the same
 * transport after a restart from the re-resolved provider settings.
 */
export function buildModelscopeTransport(settings: ModelscopeProviderSettings): ImageGenerationTransport {
  return createModelscopeTransport({
    apiKey: settings.apiKey ?? '',
    baseURL: settings.imageBaseURL || DEFAULT_MODELSCOPE_BASE_URL
  })
}

/**
 * Unified ModelScope (魔搭) provider: OpenAI-compatible chat/embedding off
 * `settings.baseURL`, plus an async submit/poll image transport off
 * `settings.imageBaseURL` (defaults to `https://api-inference.modelscope.cn`).
 */
export function createModelscopeProvider(settings: ModelscopeProviderSettings = {}): ModelscopeProvider {
  const { baseURL, fetch: customFetch } = settings
  if (!baseURL) {
    throw new Error('ModelScope provider requires a non-empty `baseURL`.')
  }

  const resolveApiKey = () =>
    loadApiKey({ apiKey: settings.apiKey, environmentVariableName: 'MODELSCOPE_API_KEY', description: 'ModelScope' })

  const authHeaders = () => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    ...settings.headers
  })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${MODELSCOPE_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const transport = buildModelscopeTransport(settings)

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v4' as const
  provider.languageModel = createChatModel
  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${MODELSCOPE_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })
  provider.imageModel = (modelId: string) =>
    createImageGenerationModel(modelId, { provider: MODELSCOPE_PROVIDER_NAME, transport })

  return provider
}
