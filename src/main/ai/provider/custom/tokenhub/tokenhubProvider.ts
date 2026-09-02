import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { withoutTrailingApiVersion } from '@shared/utils/api'

import { createImageGenerationModel, type ImageGenerationTransport } from '../imageGenerationModel'
import { createTokenhubTransport } from './tokenhubTransport'

export const TOKENHUB_PROVIDER_NAME = 'tokenhub' as const

export interface TokenhubProviderSettings {
  apiKey?: string
  /** OpenAI-compatible chat / embedding endpoint (`https://tokenhub.tencentmaas.com/v1`). */
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface TokenhubProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
}

/**
 * Build the TokenHub image transport from provider settings. Shared by the
 * provider factory and the image-generation job's transport registry so the
 * job handler can rebuild the same transport from re-resolved settings.
 */
export function buildTokenhubTransport(settings: TokenhubProviderSettings): ImageGenerationTransport {
  if (!settings.baseURL) {
    throw new Error('TokenHub provider requires a non-empty `baseURL` to build the image transport.')
  }
  return createTokenhubTransport({
    apiKey: settings.apiKey ?? '',
    // The `/v1/wand/*` image endpoints are host-root paths; the chat baseURL carries `/v1`.
    baseURL: withoutTrailingApiVersion(settings.baseURL),
    headers: settings.headers,
    fetch: settings.fetch
  })
}

export function createTokenhubProvider(settings: TokenhubProviderSettings = {}): TokenhubProvider {
  const { baseURL, fetch: customFetch } = settings
  if (!baseURL) {
    throw new Error('TokenHub provider requires a non-empty `baseURL`.')
  }

  const resolveApiKey = () =>
    loadApiKey({ apiKey: settings.apiKey, environmentVariableName: 'TOKENHUB_API_KEY', description: 'TokenHub' })

  const authHeaders = () => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    ...settings.headers
  })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${TOKENHUB_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const transport = buildTokenhubTransport(settings)

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${TOKENHUB_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })
  provider.imageModel = (modelId: string) =>
    createImageGenerationModel(modelId, { provider: TOKENHUB_PROVIDER_NAME, transport })

  return provider as TokenhubProvider
}
