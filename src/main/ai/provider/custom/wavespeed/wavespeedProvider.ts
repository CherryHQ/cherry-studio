import { OpenAICompatibleChatLanguageModel } from '@ai-sdk/openai-compatible'
import { type ImageModelV3, type LanguageModelV3, NoSuchModelError, type ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { createImageGenerationModel, type ImageGenerationTransport } from '../imageGenerationModel'
import { createWavespeedTransport, DEFAULT_WAVESPEED_IMAGE_BASE_URL } from './wavespeedTransport'

export const WAVESPEED_PROVIDER_NAME = 'wavespeed' as const

export interface WavespeedProviderSettings {
  apiKey?: string
  /** OpenAI-compatible chat endpoint (`https://llm.wavespeed.ai/v1`). */
  baseURL?: string
  /** Prediction API origin; a different host from chat, so it is not derived from `baseURL`. */
  imageBaseURL?: string
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface WavespeedProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  imageModel(modelId: string): ImageModelV3
}

/**
 * Build the WaveSpeed prediction transport from provider settings. Shared by the provider
 * factory and the image-generation job's transport registry.
 */
export function buildWavespeedTransport(settings: WavespeedProviderSettings): ImageGenerationTransport {
  return createWavespeedTransport({
    apiKey: settings.apiKey ?? '',
    baseURL: settings.imageBaseURL || DEFAULT_WAVESPEED_IMAGE_BASE_URL,
    headers: settings.headers,
    fetch: settings.fetch
  })
}

export function createWavespeedProvider(settings: WavespeedProviderSettings = {}): WavespeedProvider {
  const { baseURL, fetch: customFetch } = settings
  if (!baseURL) {
    throw new Error('WaveSpeed provider requires a non-empty `baseURL`.')
  }

  const resolveApiKey = () =>
    loadApiKey({ apiKey: settings.apiKey, environmentVariableName: 'WAVESPEED_API_KEY', description: 'WaveSpeed' })

  const createChatModel = (modelId: string) =>
    new OpenAICompatibleChatLanguageModel(modelId, {
      provider: `${WAVESPEED_PROVIDER_NAME}.chat`,
      url: ({ path }) => `${withoutTrailingSlash(baseURL)}${path}`,
      headers: () => ({ Authorization: `Bearer ${resolveApiKey()}`, ...settings.headers }),
      fetch: customFetch
    })

  const transport = buildWavespeedTransport(settings)

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.embeddingModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' })
  }
  provider.imageModel = (modelId: string) =>
    createImageGenerationModel(modelId, { provider: WAVESPEED_PROVIDER_NAME, transport })

  return provider
}
