import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { MinimaxImageModel } from './minimaxImageModel'
import { type MinimaxVoiceCloneOptions, type MinimaxVoiceCloneResult, MinimaxVoiceCloning } from './minimaxVoiceCloning'

export const MINIMAX_PROVIDER_NAME = 'minimax' as const

export interface MinimaxProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
  includeUsage?: boolean
}

export interface MinimaxProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  chatModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  textEmbeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
  cloneVoice(options: MinimaxVoiceCloneOptions): Promise<MinimaxVoiceCloneResult>
}

export function createMinimaxProvider(settings: MinimaxProviderSettings = {}): MinimaxProvider {
  const { baseURL = 'https://api.minimax.io/v1', fetch: customFetch } = settings
  const url = ({ path }: { path: string; modelId?: string }) => `${withoutTrailingSlash(baseURL)}${path}`
  const headers = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: settings.apiKey,
      environmentVariableName: 'MINIMAX_API_KEY',
      description: 'MiniMax'
    })}`,
    ...settings.headers
  })

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${MINIMAX_PROVIDER_NAME}.chat`,
      url,
      headers,
      fetch: customFetch,
      includeUsage: settings.includeUsage
    })

  const createEmbeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${MINIMAX_PROVIDER_NAME}.embedding`,
      url,
      headers,
      fetch: customFetch
    })

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.chatModel = createChatModel
  provider.embeddingModel = createEmbeddingModel
  provider.textEmbeddingModel = createEmbeddingModel
  provider.imageModel = (modelId: string) =>
    new MinimaxImageModel(modelId, {
      provider: `${MINIMAX_PROVIDER_NAME}.image`,
      url,
      headers,
      fetch: customFetch
    })
  const voiceCloning = new MinimaxVoiceCloning({ url, headers, fetch: customFetch })
  provider.cloneVoice = (options: MinimaxVoiceCloneOptions) => voiceCloning.clone(options)

  return provider as MinimaxProvider
}
