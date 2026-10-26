import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import { GoogleGenerativeAILanguageModel } from '@ai-sdk/google/internal'
import { OpenAICompatibleChatLanguageModel } from '@ai-sdk/openai-compatible'
import { OpenAIChatLanguageModel, OpenAIResponsesLanguageModel } from '@ai-sdk/openai/internal'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { withoutTrailingSlash } from '@ai-sdk/provider-utils'

import type { EndpointType } from '@shared/data/types/model'

export interface LanguageModelConnection {
  baseURL: string
  apiKey: () => string
  headers: () => Record<string, string>
  fetch?: FetchFunction
}

/** The constructor and the option namespace it consumes are one execution contract. */
export interface LanguageModelAdapter {
  readonly providerOptionsKey: string
  readonly createModel: (modelId: string, connection: LanguageModelConnection) => LanguageModelV3
}

export interface LanguageModelAdapterExtension {
  resolveLanguageModelAdapter: (
    endpointType: EndpointType | undefined,
    modelId: string
  ) => LanguageModelAdapter | undefined
}

/** Shared wire implementations; deployment adapters supply identity and connection headers. */
export function createLanguageModelAdapters(providerName: string) {
  const anthropic: LanguageModelAdapter = {
    providerOptionsKey: 'anthropic',
    createModel: (modelId, connection) =>
      new AnthropicMessagesLanguageModel(modelId, {
        provider: `${providerName}.anthropic`,
        baseURL: connection.baseURL,
        headers: () => ({ ...connection.headers(), 'x-api-key': connection.apiKey() }),
        fetch: connection.fetch,
        supportedUrls: () => ({ 'image/*': [/^https?:\/\/.*$/] }),
        // Gateway backends include Vertex/Bedrock, which reject Anthropic's structured-output beta header.
        supportsNativeStructuredOutput: false
      })
  }

  const google: LanguageModelAdapter = {
    providerOptionsKey: 'google',
    createModel: (modelId, connection) =>
      new GoogleGenerativeAILanguageModel(modelId, {
        provider: `${providerName}.google`,
        baseURL: connection.baseURL,
        headers: () => ({ ...connection.headers(), 'x-goog-api-key': connection.apiKey() }),
        fetch: connection.fetch,
        generateId: () => `${providerName}-${Date.now()}`,
        supportedUrls: () => ({})
      })
  }

  const openaiChat: LanguageModelAdapter = {
    providerOptionsKey: 'openai',
    createModel: (modelId, connection) =>
      new OpenAIChatLanguageModel(modelId, {
        provider: `${providerName}.chat`,
        url: ({ path }) => `${withoutTrailingSlash(connection.baseURL)}${path}`,
        headers: connection.headers,
        fetch: connection.fetch
      })
  }

  const responses: LanguageModelAdapter = {
    providerOptionsKey: 'openai',
    createModel: (modelId, connection) =>
      new OpenAIResponsesLanguageModel(modelId, {
        provider: `${providerName}.openai-response`,
        url: ({ path }) => `${withoutTrailingSlash(connection.baseURL)}${path}`,
        headers: connection.headers,
        fetch: connection.fetch,
        fileIdPrefixes: ['file-']
      })
  }

  const compatible: LanguageModelAdapter = {
    providerOptionsKey: providerName,
    createModel: (modelId, connection) =>
      new OpenAICompatibleChatLanguageModel(modelId, {
        provider: `${providerName}.chat`,
        url: ({ path }) => `${withoutTrailingSlash(connection.baseURL)}${path}`,
        headers: connection.headers,
        fetch: connection.fetch
      })
  }

  return { anthropic, google, openaiChat, responses, compatible }
}
