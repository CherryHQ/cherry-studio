/**
 * NewAPI Provider
 *
 * Multi-backend API gateway (One API / New API) that routes models by endpoint_type:
 * - anthropic -> Anthropic SDK
 * - gemini -> Google SDK
 * - openai-response -> OpenAI Responses SDK
 * - openai / image-generation -> OpenAI Chat SDK
 * - fallback -> OpenAI Compatible SDK
 *
 * The endpointType is set per-request via provider settings, based on the model's endpoint_type field.
 */
import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import { GoogleGenerativeAILanguageModel } from '@ai-sdk/google/internal'
import { OpenAIResponsesLanguageModel } from '@ai-sdk/openai/internal'
import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleEmbeddingModel,
  OpenAICompatibleImageModel
} from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

export const NEWAPI_PROVIDER_NAME = 'newapi' as const

export type NewApiEndpointType =
  | 'openai'
  | 'openai-response'
  | 'anthropic'
  | 'gemini'
  | 'image-generation'
  | 'jina-rerank'

export interface NewApiProviderSettings {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
  endpointType?: NewApiEndpointType
}

export interface NewApiProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
}

export function createNewApi(options: NewApiProviderSettings = {}): NewApiProvider {
  const { baseURL = '', fetch: customFetch, endpointType } = options

  const resolveApiKey = () =>
    loadApiKey({ apiKey: options.apiKey, environmentVariableName: 'NEWAPI_API_KEY', description: 'NewAPI' })

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    'Content-Type': 'application/json',
    ...options.headers
  })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createAnthropicModel = (modelId: string) => {
    const headers = authHeaders()
    return new AnthropicMessagesLanguageModel(modelId, {
      provider: `${NEWAPI_PROVIDER_NAME}.anthropic`,
      baseURL,
      headers: () => ({ ...headers, 'x-api-key': resolveApiKey() }),
      fetch: customFetch,
      supportedUrls: () => ({ 'image/*': [/^https?:\/\/.*$/] })
    })
  }

  const createGeminiModel = (modelId: string) => {
    const headers = authHeaders()
    return new GoogleGenerativeAILanguageModel(modelId, {
      provider: `${NEWAPI_PROVIDER_NAME}.google`,
      baseURL,
      headers: () => ({ ...headers, 'x-goog-api-key': resolveApiKey() }),
      fetch: customFetch,
      generateId: () => `${NEWAPI_PROVIDER_NAME}-${Date.now()}`,
      supportedUrls: () => ({})
    })
  }

  const createResponsesModel = (modelId: string) =>
    new OpenAIResponsesLanguageModel(modelId, {
      provider: `${NEWAPI_PROVIDER_NAME}.openai-response`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const createCompatibleModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${NEWAPI_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const createChatModel = (modelId: string): LanguageModelV3 => {
    switch (endpointType) {
      case 'anthropic':
        return createAnthropicModel(modelId)
      case 'gemini':
        return createGeminiModel(modelId)
      case 'openai-response':
        return createResponsesModel(modelId)
      case 'openai':
      case 'image-generation':
        return createCompatibleModel(modelId)
      default:
        return createCompatibleModel(modelId)
    }
  }

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const

  provider.languageModel = createChatModel

  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${NEWAPI_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  provider.imageModel = (modelId: string) =>
    new OpenAICompatibleImageModel(modelId, {
      provider: `${NEWAPI_PROVIDER_NAME}.image`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  return provider as NewApiProvider
}
