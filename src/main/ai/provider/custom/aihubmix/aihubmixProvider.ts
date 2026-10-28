/**
 * AiHubMix Provider
 *
 * Executes the selected endpoint with its bound language model adapter.
 *
 * All requests include the APP-Code header.
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { OpenAICompatibleEmbeddingModel } from '@ai-sdk/openai-compatible'
import { OpenAISpeechModel } from '@ai-sdk/openai/internal'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3, RerankingModelV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { OpenAICompatibleRerankingModel } from '@cherrystudio/ai-sdk-provider'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'

import type { LanguageModelAdapter } from '../../languageModelAdapter'
import { createAihubmixImageModel } from './aihubmixImageModel'
import { resolveAihubmixLanguageModelAdapter } from './aihubmixLanguageModel'

export const AIHUBMIX_PROVIDER_NAME = 'aihubmix' as const
const APP_CODE_HEADER = { 'APP-Code': 'MLTG2087' }

export interface AihubmixProviderSettings {
  languageModelAdapter?: LanguageModelAdapter
  endpointType?: EndpointType
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

  const resolveApiKey = () =>
    loadApiKey({ apiKey: options.apiKey, environmentVariableName: 'AIHUBMIX_API_KEY', description: 'AiHubMix' })

  // Let fetch set multipart boundaries for image edits.
  const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    ...APP_CODE_HEADER,
    ...options.headers
  })

  const chatUrl = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`

  const createChatModel = (modelId: string): LanguageModelV3 => {
    const adapter = options.languageModelAdapter ?? resolveAihubmixLanguageModelAdapter(options.endpointType, modelId)
    if (!adapter) throw new Error('AiHubMix chat requires an explicit supported endpoint')
    return adapter.createModel(modelId, { baseURL, apiKey: resolveApiKey, headers: authHeaders, fetch: customFetch })
  }

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const

  provider.languageModel = createChatModel

  provider.embeddingModel = (modelId: string) =>
    options.endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
      ? createGoogleGenerativeAI({
          baseURL,
          apiKey: resolveApiKey(),
          headers: authHeaders(),
          fetch: customFetch
        }).embeddingModel(modelId)
      : new OpenAICompatibleEmbeddingModel(modelId, {
          provider: `${AIHUBMIX_PROVIDER_NAME}.embedding`,
          url: ({ path }) => `${withoutTrailingSlash(baseURL)}${path}`,
          headers: authHeaders,
          fetch: customFetch
        })

  provider.imageModel = (modelId: string) =>
    createAihubmixImageModel(modelId, {
      endpointType: options.endpointType,
      baseURL,
      resolveApiKey,
      headers: authHeaders,
      fetch: customFetch
    })

  provider.speechModel = (modelId: string) =>
    new OpenAISpeechModel(modelId, {
      provider: `${AIHUBMIX_PROVIDER_NAME}.speech`,
      url: ({ path }) => `${withoutTrailingSlash(baseURL)}${path}`,
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
