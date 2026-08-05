/**
 * AiHubMix Provider
 *
 * Multi-backend API gateway that routes models by model ID prefix:
 * - claude* -> Anthropic SDK
 * - gemini* -> Google SDK
 * - others -> OpenAI Responses SDK (default)
 *
 * All requests include the APP-Code header.
 */
import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import { GoogleGenerativeAILanguageModel } from '@ai-sdk/google/internal'
import { OpenAICompatibleChatLanguageModel, OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import { OpenAIChatLanguageModel, OpenAIResponsesLanguageModel, OpenAISpeechModel } from '@ai-sdk/openai/internal'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3, RerankingModelV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { OpenAICompatibleRerankingModel } from '@cherrystudio/ai-sdk-provider'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import { createAihubmixImageModel } from './aihubmixImageModel'
import { resolveAihubmixChatFamily } from './aihubmixRouting'

export const AIHUBMIX_PROVIDER_NAME = 'aihubmix' as const
const APP_CODE_HEADER = { 'APP-Code': 'MLTG2087' }

export interface AihubmixProviderSettings {
  apiKey?: string
  baseURL?: string
  endpointBaseURLs?: Partial<Record<EndpointType, string>>
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface AihubmixProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
  rerankingModel(modelId: string): RerankingModelV3
}

export function createAihubmix(options: AihubmixProviderSettings = {}): AihubmixProvider {
  const { baseURL = 'https://aihubmix.com/v1', fetch: customFetch } = options
  const chatBaseURL = options.endpointBaseURLs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] ?? baseURL
  const responsesBaseURL = options.endpointBaseURLs?.[ENDPOINT_TYPE.OPENAI_RESPONSES] ?? chatBaseURL
  const anthropicBaseURL = options.endpointBaseURLs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES] ?? baseURL

  const resolveApiKey = () =>
    loadApiKey({ apiKey: options.apiKey, environmentVariableName: 'AIHUBMIX_API_KEY', description: 'AiHubMix' })

  // Note: Do not hard-code `Content-Type: application/json` here. `postJsonToApi`
  // already defaults it for JSON endpoints, while `postFormDataToApi` (used by
  // `OpenAICompatibleImageModel` for `/images/edits`) relies on fetch to set
  // `multipart/form-data; boundary=...` automatically — forcing JSON here breaks
  // image edits with "invalid character '-' in numeric literal" on the server.
  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    ...APP_CODE_HEADER,
    ...options.headers
  })

  const chatUrl = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(chatBaseURL)}${path}`
  const responsesUrl = ({ path }: { path: string; modelId: string }) =>
    `${withoutTrailingSlash(responsesBaseURL)}${path}`

  const rootURL = (withoutTrailingSlash(baseURL) ?? baseURL).replace(/\/v1$/, '')
  const geminiBaseURL = options.endpointBaseURLs?.[ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT] ?? `${rootURL}/gemini/v1beta`

  const createAnthropicModel = (modelId: string) => {
    const headers = authHeaders()
    return new AnthropicMessagesLanguageModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.anthropic`,
      baseURL: anthropicBaseURL,
      headers: () => ({ ...headers, 'x-api-key': resolveApiKey() }),
      fetch: customFetch,
      supportedUrls: () => ({ 'image/*': [/^https?:\/\/.*$/] }),
      // AiHubMix may route Claude models to Vertex/Bedrock backends, which reject the
      // `structured-outputs-2025-11-13` beta header added by @ai-sdk/anthropic for
      // claude-opus-4-6 / claude-sonnet-4-6 / claude-*-4-5 / claude-opus-4-1. Falling
      // back to function-tool-based structured outputs keeps tool use (incl. MCP) working
      // across all downstream backends. See issue #14375.
      supportsNativeStructuredOutput: false
    })
  }

  const createGeminiModel = (modelId: string) => {
    const headers = authHeaders()
    return new GoogleGenerativeAILanguageModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.google`,
      baseURL: geminiBaseURL,
      headers: () => ({ ...headers, 'x-goog-api-key': resolveApiKey() }),
      fetch: customFetch,
      generateId: () => `${AIHUBMIX_PROVIDER_NAME}-${Date.now()}`,
      supportedUrls: () => ({})
    })
  }

  const createOpenAICompatibleChatModel = (modelId: string): LanguageModelV3 =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.chat`,
      url: chatUrl,
      headers: authHeaders,
      fetch: customFetch
    })

  const createOpenAIChatModel = (modelId: string): LanguageModelV3 =>
    new OpenAIChatLanguageModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.chat`,
      url: chatUrl,
      headers: authHeaders,
      fetch: customFetch
    })

  const createResponsesModel = (modelId: string): LanguageModelV3 =>
    new OpenAIResponsesLanguageModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.openai-response`,
      url: responsesUrl,
      headers: authHeaders,
      fetch: customFetch,
      fileIdPrefixes: ['file-']
    })

  const createChatModel = (modelId: string): LanguageModelV3 => {
    switch (resolveAihubmixChatFamily(modelId)) {
      case 'anthropic':
        return createAnthropicModel(modelId)
      case 'gemini':
        return createGeminiModel(modelId)
      case 'openai-chat':
        return createOpenAIChatModel(modelId)
      case 'openai-responses':
        return createResponsesModel(modelId)
      case 'compat':
        return createOpenAICompatibleChatModel(modelId)
    }
  }

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const

  provider.languageModel = createChatModel

  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.embedding`,
      url: chatUrl,
      headers: authHeaders,
      fetch: customFetch
    })

  provider.imageModel = (modelId: string) =>
    createAihubmixImageModel(modelId, { baseURL: chatBaseURL, resolveApiKey, headers: authHeaders, fetch: customFetch })

  provider.speechModel = (modelId: string) =>
    new OpenAISpeechModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.speech`,
      url: chatUrl,
      headers: authHeaders,
      fetch: customFetch
    })

  provider.rerankingModel = (modelId: string) =>
    new OpenAICompatibleRerankingModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.rerank`,
      url: chatUrl,
      headers: authHeaders,
      fetch: customFetch
    })

  return provider
}
