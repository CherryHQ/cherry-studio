import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import { GoogleGenerativeAILanguageModel } from '@ai-sdk/google/internal'
import type { OpenAIProviderSettings } from '@ai-sdk/openai'
import {
  OpenAIChatLanguageModel,
  OpenAICompletionLanguageModel,
  OpenAIEmbeddingModel,
  OpenAIImageModel,
  OpenAIResponsesLanguageModel,
  OpenAISpeechModel,
  OpenAITranscriptionModel
} from '@ai-sdk/openai/internal'
import {
  type EmbeddingModelV2,
  type ImageModelV2,
  type LanguageModelV2,
  type ProviderV2,
  type SpeechModelV2,
  type TranscriptionModelV2
} from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

export const CHERRYIN_PROVIDER_NAME = 'cherryin' as const
export const DEFAULT_CHERRYIN_BASE_URL = 'https://open.cherryin.net/v1'
export const DEFAULT_CHERRYIN_ANTHROPIC_BASE_URL = 'https://open.cherryin.net/v1'
export const DEFAULT_CHERRYIN_GEMINI_BASE_URL = 'https://open.cherryin.net/v1beta/models'

const ANTHROPIC_PREFIX = /^anthropic\//i
const GEMINI_PREFIX = /^google\//i
// const GEMINI_EXCLUDED_SUFFIXES = ['-nothink', '-search']

type HeaderValue = string | undefined

type HeadersInput = Record<string, HeaderValue> | (() => Record<string, HeaderValue>)

export interface CherryInProviderSettings {
  /**
   * CherryIN API key.
   *
   * If omitted, the provider will read the `CHERRYIN_API_KEY` environment variable.
   */
  apiKey?: string
  /**
   * Optional custom fetch implementation.
   */
  fetch?: FetchFunction
  /**
   * Base URL for OpenAI-compatible CherryIN endpoints.
   *
   * Defaults to `https://open.cherryin.net/v1`.
   */
  baseURL?: string
  /**
   * Base URL for Anthropic-compatible endpoints.
   *
   * Defaults to `https://open.cherryin.net/anthropic`.
   */
  anthropicBaseURL?: string
  /**
   * Base URL for Gemini-compatible endpoints.
   *
   * Defaults to `https://open.cherryin.net/gemini/v1beta`.
   */
  geminiBaseURL?: string
  /**
   * Optional static headers applied to every request.
   */
  headers?: HeadersInput
}

export interface CherryInProvider extends ProviderV2 {
  (modelId: string, settings?: OpenAIProviderSettings): LanguageModelV2
  languageModel(modelId: string, settings?: OpenAIProviderSettings): LanguageModelV2
  chat(modelId: string, settings?: OpenAIProviderSettings): LanguageModelV2
  responses(modelId: string): LanguageModelV2
  completion(modelId: string, settings?: OpenAIProviderSettings): LanguageModelV2
  embedding(modelId: string, settings?: OpenAIProviderSettings): EmbeddingModelV2<string>
  textEmbedding(modelId: string, settings?: OpenAIProviderSettings): EmbeddingModelV2<string>
  textEmbeddingModel(modelId: string, settings?: OpenAIProviderSettings): EmbeddingModelV2<string>
  image(modelId: string, settings?: OpenAIProviderSettings): ImageModelV2
  imageModel(modelId: string, settings?: OpenAIProviderSettings): ImageModelV2
  transcription(modelId: string): TranscriptionModelV2
  transcriptionModel(modelId: string): TranscriptionModelV2
  speech(modelId: string): SpeechModelV2
  speechModel(modelId: string): SpeechModelV2
}

const resolveApiKey = (options: CherryInProviderSettings): string =>
  loadApiKey({
    apiKey: options.apiKey,
    environmentVariableName: 'CHERRYIN_API_KEY',
    description: 'CherryIN'
  })

const isAnthropicModel = (modelId: string) => ANTHROPIC_PREFIX.test(modelId)
const isGeminiModel = (modelId: string) => GEMINI_PREFIX.test(modelId)

const createCustomFetch = (originalFetch?: any) => {
  return async (url: string, options: any) => {
    if (options?.body) {
      try {
        const body = JSON.parse(options.body)
        if (body.tools && Array.isArray(body.tools) && body.tools.length === 0 && body.tool_choice) {
          delete body.tool_choice
          options.body = JSON.stringify(body)
        }
      } catch (error) {
        // ignore error
      }
    }

    return originalFetch ? originalFetch(url, options) : fetch(url, options)
  }
}
class CherryInOpenAIChatLanguageModel extends OpenAIChatLanguageModel {
  constructor(modelId: string, settings: any) {
    super(modelId, {
      ...settings,
      fetch: createCustomFetch(settings.fetch)
    })
  }
}

const resolveConfiguredHeaders = (headers?: HeadersInput): Record<string, HeaderValue> => {
  if (typeof headers === 'function') {
    return { ...headers() }
  }
  return headers ? { ...headers } : {}
}

const toBearerToken = (authorization?: string) => (authorization ? authorization.replace(/^Bearer\s+/i, '') : undefined)

const createJsonHeadersGetter = (options: CherryInProviderSettings): (() => Record<string, HeaderValue>) => {
  return () => ({
    Authorization: `Bearer ${resolveApiKey(options)}`,
    'Content-Type': 'application/json',
    ...resolveConfiguredHeaders(options.headers)
  })
}

const createAuthHeadersGetter = (options: CherryInProviderSettings): (() => Record<string, HeaderValue>) => {
  return () => ({
    Authorization: `Bearer ${resolveApiKey(options)}`,
    ...resolveConfiguredHeaders(options.headers)
  })
}

export const createCherryIn = (options: CherryInProviderSettings = {}): CherryInProvider => {
  const {
    baseURL = DEFAULT_CHERRYIN_BASE_URL,
    anthropicBaseURL = DEFAULT_CHERRYIN_ANTHROPIC_BASE_URL,
    geminiBaseURL = DEFAULT_CHERRYIN_GEMINI_BASE_URL,
    fetch
  } = options

  const getJsonHeaders = createJsonHeadersGetter(options)
  const getAuthHeaders = createAuthHeadersGetter(options)

  const url = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createAnthropicModel = (modelId: string) =>
    new AnthropicMessagesLanguageModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.anthropic`,
      baseURL: anthropicBaseURL,
      headers: () => {
        const headers = getJsonHeaders()
        const apiKey = toBearerToken(headers.Authorization)
        return {
          ...headers,
          'x-api-key': apiKey
        }
      },
      fetch,
      supportedUrls: () => ({
        'image/*': [/^https?:\/\/.*$/]
      })
    })

  const createGeminiModel = (modelId: string) =>
    new GoogleGenerativeAILanguageModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.google`,
      baseURL: geminiBaseURL,
      headers: () => {
        const headers = getJsonHeaders()
        const apiKey = toBearerToken(headers.Authorization)
        return {
          ...headers,
          'x-goog-api-key': apiKey
        }
      },
      fetch,
      generateId: () => `${CHERRYIN_PROVIDER_NAME}-${Date.now()}`,
      supportedUrls: () => ({})
    })

  const createOpenAIChatModel = (modelId: string, settings: OpenAIProviderSettings = {}) =>
    new CherryInOpenAIChatLanguageModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.openai-chat`,
      url,
      headers: () => ({
        ...getJsonHeaders(),
        ...settings.headers
      }),
      fetch
    })

  const createChatModel = (modelId: string, settings: OpenAIProviderSettings = {}) => {
    if (isAnthropicModel(modelId)) {
      return createAnthropicModel(modelId)
    }
    if (isGeminiModel(modelId)) {
      return createGeminiModel(modelId)
    }
    return new OpenAIResponsesLanguageModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.openai`,
      url,
      headers: () => ({
        ...getJsonHeaders(),
        ...settings.headers
      }),
      fetch
    })
  }

  const createCompletionModel = (modelId: string, settings: OpenAIProviderSettings = {}) =>
    new OpenAICompletionLanguageModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.completion`,
      url,
      headers: () => ({
        ...getJsonHeaders(),
        ...settings.headers
      }),
      fetch
    })

  const createEmbeddingModel = (modelId: string, settings: OpenAIProviderSettings = {}) =>
    new OpenAIEmbeddingModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.embeddings`,
      url,
      headers: () => ({
        ...getJsonHeaders(),
        ...settings.headers
      }),
      fetch
    })

  const createResponsesModel = (modelId: string) =>
    new OpenAIResponsesLanguageModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.responses`,
      url,
      headers: () => ({
        ...getJsonHeaders()
      }),
      fetch
    })

  const createImageModel = (modelId: string, settings: OpenAIProviderSettings = {}) =>
    new OpenAIImageModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.image`,
      url,
      headers: () => ({
        ...getJsonHeaders(),
        ...settings.headers
      }),
      fetch
    })

  const createTranscriptionModel = (modelId: string) =>
    new OpenAITranscriptionModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.transcription`,
      url,
      headers: () => ({
        ...getAuthHeaders()
      }),
      fetch
    })

  const createSpeechModel = (modelId: string) =>
    new OpenAISpeechModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.speech`,
      url,
      headers: () => ({
        ...getJsonHeaders()
      }),
      fetch
    })

  const provider: CherryInProvider = function (modelId: string, settings?: OpenAIProviderSettings) {
    if (new.target) {
      throw new Error('CherryIN provider function cannot be called with the new keyword.')
    }

    return createChatModel(modelId, settings)
  }

  provider.languageModel = createChatModel
  provider.chat = createOpenAIChatModel

  provider.responses = createResponsesModel
  provider.completion = createCompletionModel

  provider.embedding = createEmbeddingModel
  provider.textEmbedding = createEmbeddingModel
  provider.textEmbeddingModel = createEmbeddingModel

  provider.image = createImageModel
  provider.imageModel = createImageModel

  provider.transcription = createTranscriptionModel
  provider.transcriptionModel = createTranscriptionModel

  provider.speech = createSpeechModel
  provider.speechModel = createSpeechModel

  return provider
}

export const cherryIn = createCherryIn()
