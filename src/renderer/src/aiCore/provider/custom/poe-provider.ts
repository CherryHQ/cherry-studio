import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import { OpenAIResponsesLanguageModel } from '@ai-sdk/openai/internal'
import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { isOpenAIChatCompletionOnlyModel, isOpenAILLMModel } from '@renderer/config/models/openai'
import type { Model } from '@renderer/types'

export const POE_PROVIDER_NAME = 'poe' as const

export interface PoeProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface PoeProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
}

export function createPoeProvider(options: PoeProviderSettings = {}): PoeProvider {
  const { baseURL = 'https://api.poe.com/v1', fetch: customFetch } = options

  const resolveApiKey = () =>
    loadApiKey({ apiKey: options.apiKey, environmentVariableName: 'POE_API_KEY', description: 'Poe' })

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    'Content-Type': 'application/json',
    ...options.headers
  })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createAnthropicModel = (modelId: string) =>
    new AnthropicMessagesLanguageModel(modelId, {
      provider: `${POE_PROVIDER_NAME}.anthropic`,
      baseURL,
      headers: () => ({ ...authHeaders(), 'x-api-key': resolveApiKey(), 'anthropic-version': '2023-06-01' }),
      fetch: customFetch,
      supportedUrls: () => ({ 'image/*': [/^https?:\/\/.*$/] })
    })

  const createResponsesModel = (modelId: string) =>
    new OpenAIResponsesLanguageModel(modelId, {
      provider: `${POE_PROVIDER_NAME}.openai-response`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const createCompatibleModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${POE_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const createChatModel = (modelId: string): LanguageModelV3 => {
    if (modelId.toLowerCase().startsWith('claude')) {
      return createAnthropicModel(modelId)
    }
    const model = { id: modelId } as Model
    if (isOpenAILLMModel(model) && !isOpenAIChatCompletionOnlyModel(model)) {
      return createResponsesModel(modelId)
    }
    return createCompatibleModel(modelId)
  }

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const

  provider.languageModel = createChatModel

  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${POE_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  provider.imageModel = () => {
    throw new Error('Poe provider does not support image generation')
  }

  return provider as PoeProvider
}
