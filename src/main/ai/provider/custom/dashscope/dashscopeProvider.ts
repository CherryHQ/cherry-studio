import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3, RerankingModelV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { OpenAICompatibleRerankingModel } from '@cherrystudio/ai-sdk-provider'

import { createImageGenerationModel } from '../imageGenerationModel'
import { createDashScopeTransport, DEFAULT_DASHSCOPE_IMAGE_BASE_URL } from './dashscopeTransport'

export const DASHSCOPE_PROVIDER_NAME = 'dashscope' as const

const DASHSCOPE_CHAT_BASE_PATH = '/compatible-mode/v1'
const DASHSCOPE_RERANK_BASE_PATH = '/compatible-api/v1'

export interface DashScopeProviderSettings {
  apiKey?: string
  /** Chat / embedding endpoint, e.g. `https://dashscope.aliyuncs.com/compatible-mode/v1/`. */
  baseURL?: string
  /**
   * Image endpoint origin (no `/compatible-mode/v1/` suffix), e.g.
   * `https://dashscope.aliyuncs.com`. Derived by `buildDashScopeConfig` from
   * the user's chat baseURL so cn / intl / proxy hosts work without
   * hardcoded region URLs.
   */
  imageBaseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
  includeUsage?: boolean
}

export interface DashScopeProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
  rerankingModel(modelId: string): RerankingModelV3
}

const getDashScopeRerankBaseURL = (baseURL: string) => {
  const normalized = withoutTrailingSlash(baseURL) ?? baseURL
  return normalized.endsWith(DASHSCOPE_CHAT_BASE_PATH)
    ? `${normalized.slice(0, -DASHSCOPE_CHAT_BASE_PATH.length)}${DASHSCOPE_RERANK_BASE_PATH}`
    : normalized
}

/**
 * Unified DashScope (Bailian) provider — chat, embedding, and image off one
 * `ProviderV3`. Chat / embedding go through the OpenAI-compatible SDK aimed at
 * `baseURL` (DashScope exposes `/compatible-mode/v1/`); image goes through the
 * native DashScope `/api/v1/services/aigc/*` endpoints via
 * `createImageGenerationModel + createDashScopeTransport` aimed at
 * `imageBaseURL`.
 */
export function createDashScopeProvider(settings: DashScopeProviderSettings = {}): DashScopeProvider {
  const { baseURL, fetch: customFetch } = settings
  if (!baseURL) {
    throw new Error(
      'DashScope provider requires a non-empty `baseURL`. An empty value would resolve fetch paths against the renderer process origin (app://, file://) and surface as opaque "Failed to fetch" errors.'
    )
  }

  const resolveApiKey = () =>
    loadApiKey({ apiKey: settings.apiKey, environmentVariableName: 'DASHSCOPE_API_KEY', description: 'DashScope' })

  const authHeaders = () => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    ...settings.headers
  })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  // DashScope chat uses /compatible-mode/v1; rerank uses /compatible-api/v1 on the same user-configured host.
  const rerankBaseURL = getDashScopeRerankBaseURL(baseURL)
  const rerankUrl = ({ path }: { path: string; modelId: string }) =>
    `${rerankBaseURL}${path === '/rerank' ? '/reranks' : path}`

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${DASHSCOPE_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch,
      includeUsage: settings.includeUsage
    })

  const transport = createDashScopeTransport({
    apiKey: settings.apiKey ?? '',
    imageBaseURL: settings.imageBaseURL || DEFAULT_DASHSCOPE_IMAGE_BASE_URL
  })

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${DASHSCOPE_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })
  provider.imageModel = (modelId: string) =>
    createImageGenerationModel(modelId, { provider: DASHSCOPE_PROVIDER_NAME, transport })
  provider.rerankingModel = (modelId: string) =>
    new OpenAICompatibleRerankingModel(modelId, {
      provider: `${DASHSCOPE_PROVIDER_NAME}.rerank`,
      url: rerankUrl,
      headers: authHeaders,
      fetch: customFetch
    })

  return provider as DashScopeProvider
}
