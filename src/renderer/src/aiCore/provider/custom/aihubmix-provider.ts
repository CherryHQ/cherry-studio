/**
 * AiHubMix Provider
 *
 * Multi-backend API gateway that routes models to the appropriate SDK:
 * - claude -> Anthropic SDK
 * - gemini/imagen (excluding nothink, search, embedding) -> Google SDK
 * - gpt/o1/o3 (OpenAI LLM models) -> OpenAI Responses SDK
 * - fallback -> OpenAI Compatible SDK
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

export const AIHUBMIX_PROVIDER_NAME = 'aihubmix' as const
const AIHUBMIX_APP_CODE_HEADER = { 'APP-Code': 'MLTG2087' }

export interface AiHubMixProviderSettings {
  apiKey?: string
  baseURL?: string
  geminiBaseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface AiHubMixProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
}

const isClaudeModel = (id: string) => id.toLowerCase().startsWith('claude')
const isGeminiImageModel = (id: string) => {
  const lower = id.toLowerCase()
  return (
    (lower.startsWith('gemini') || lower.startsWith('imagen')) &&
    !lower.endsWith('-nothink') &&
    !lower.endsWith('-search') &&
    !lower.includes('embedding')
  )
}
const isOpenAILLM = (id: string) => {
  const lower = id.toLowerCase()
  if (lower.includes('gpt-4o-image')) return false
  return lower.includes('gpt') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')
}

export function createAiHubMix(options: AiHubMixProviderSettings = {}): AiHubMixProvider {
  const {
    baseURL = 'https://aihubmix.com/v1',
    geminiBaseURL = 'https://aihubmix.com/gemini',
    fetch: customFetch
  } = options

  const resolveApiKey = () =>
    loadApiKey({ apiKey: options.apiKey, environmentVariableName: 'AIHUBMIX_API_KEY', description: 'AiHubMix' })

  const commonHeaders = (): Record<string, string> => ({
    ...AIHUBMIX_APP_CODE_HEADER,
    ...options.headers
  })

  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    'Content-Type': 'application/json',
    ...commonHeaders()
  })

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createAnthropicModel = (modelId: string) => {
    const headers = authHeaders()
    return new AnthropicMessagesLanguageModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.anthropic`,
      baseURL,
      headers: () => ({ ...headers, 'x-api-key': resolveApiKey() }),
      fetch: customFetch,
      supportedUrls: () => ({ 'image/*': [/^https?:\/\/.*$/] })
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

  const createResponsesModel = (modelId: string) =>
    new OpenAIResponsesLanguageModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.openai`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const createCompatibleModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.chat`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  const createChatModel = (modelId: string): LanguageModelV3 => {
    if (isClaudeModel(modelId)) return createAnthropicModel(modelId)
    if (isGeminiImageModel(modelId)) return createGeminiModel(modelId)
    if (isOpenAILLM(modelId)) return createResponsesModel(modelId)
    return createCompatibleModel(modelId)
  }

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const

  provider.languageModel = createChatModel

  provider.embeddingModel = (modelId: string) =>
    new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.embedding`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  provider.imageModel = (modelId: string) =>
    new OpenAICompatibleImageModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.image`,
      url,
      headers: authHeaders,
      fetch: customFetch
    })

  return provider as AiHubMixProvider
}
