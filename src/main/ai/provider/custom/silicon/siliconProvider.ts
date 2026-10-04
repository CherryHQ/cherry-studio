import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV4, ImageModelV4, LanguageModelV4, ProviderV4 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { SiliconImageModel } from './SiliconImageModel'

export const SILICON_PROVIDER_NAME = 'silicon' as const

export interface SiliconProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
  includeUsage?: boolean
}

export interface SiliconProvider extends ProviderV4 {
  (modelId: string): LanguageModelV4
  languageModel(modelId: string): LanguageModelV4
  chatModel(modelId: string): LanguageModelV4
  embeddingModel(modelId: string): EmbeddingModelV4
  textEmbeddingModel(modelId: string): EmbeddingModelV4
  imageModel(modelId: string): ImageModelV4
}

export function createSiliconProvider(settings: SiliconProviderSettings = {}): SiliconProvider {
  const { baseURL = 'https://api.siliconflow.cn/v1', fetch: customFetch } = settings
  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`
  const headers = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: settings.apiKey,
      environmentVariableName: 'SILICONFLOW_API_KEY',
      description: 'SiliconFlow'
    })}`,
    ...settings.headers
  })

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${SILICON_PROVIDER_NAME}.chat`,
      url,
      headers,
      fetch: customFetch,
      includeUsage: settings.includeUsage
    })

  const createEmbeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${SILICON_PROVIDER_NAME}.embedding`,
      url,
      headers,
      fetch: customFetch
    })

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v4' as const
  provider.languageModel = createChatModel
  provider.chatModel = createChatModel
  provider.embeddingModel = createEmbeddingModel
  provider.textEmbeddingModel = createEmbeddingModel
  provider.imageModel = (modelId: string) =>
    new SiliconImageModel(modelId, {
      provider: `${SILICON_PROVIDER_NAME}.image`,
      url,
      headers,
      fetch: customFetch
    })

  return provider
}
