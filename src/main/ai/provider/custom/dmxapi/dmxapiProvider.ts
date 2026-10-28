import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { OpenAICompatibleEmbeddingModel, OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import { OpenAIImageModel } from '@ai-sdk/openai/internal'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { withoutTrailingApiVersion } from '@shared/utils/api'

import type { LanguageModelAdapter } from '../../languageModelAdapter'
import { createImageGenerationModel, type ImageGenerationTransport } from '../imageGenerationModel'
import { resolveDmxapiLanguageModelAdapter } from './dmxapiLanguageModel'
import { createDmxapiTransport } from './dmxapiTransport'

export { dmxapiUsesCustomTransport } from './dmxapiImageRouting'

export const DMXAPI_PROVIDER_NAME = 'dmxapi' as const

export interface DmxapiProviderSettings {
  imageAdapter?: 'openai-native' | 'google' | 'compatible' | 'custom'
  languageModelAdapter?: LanguageModelAdapter
  endpointType?: EndpointType
  apiKey?: string
  /** Fully resolved base URL of the selected endpoint. */
  baseURL?: string
  /** Explicit per-protocol URLs for providers whose endpoints use different hosts. */
  endpointBaseURLs?: Partial<Record<EndpointType, string>>
  headers?: Record<string, string>
  fetch?: FetchFunction
}

export interface DmxapiProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
  embeddingModel(modelId: string): EmbeddingModelV3
  imageModel(modelId: string): ImageModelV3
}

/**
 * Build the DMXAPI submit/poll image transport from provider settings. Shared
 * by the provider factory and the image-generation job's transport registry so
 * the job handler can rebuild the same transport after a restart from the
 * re-resolved provider settings.
 */
export function buildDmxapiTransport(settings: DmxapiProviderSettings): ImageGenerationTransport {
  const chatBaseURL = settings.endpointBaseURLs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] ?? settings.baseURL
  if (!chatBaseURL) {
    throw new Error('DMXAPI provider requires a non-empty `baseURL` to build the image transport.')
  }
  return createDmxapiTransport({
    apiKey: settings.apiKey ?? '',
    // The transport POSTs to host-root paths (`/v1/images/...`), so strip the
    // OpenAI-compat version suffix from the chat baseURL to avoid a double `/v1`.
    baseURL: withoutTrailingApiVersion(chatBaseURL)
  })
}

export function createDmxapiProvider(settings: DmxapiProviderSettings = {}): DmxapiProvider {
  const { baseURL, fetch: customFetch } = settings
  if (!baseURL) {
    throw new Error(
      'DMXAPI provider requires a non-empty `baseURL`. An empty value would resolve fetch paths against the renderer process origin (app://, file://) and surface as opaque "Failed to fetch" errors.'
    )
  }

  const resolveApiKey = () =>
    loadApiKey({ apiKey: settings.apiKey, environmentVariableName: 'DMXAPI_API_KEY', description: 'DMXAPI' })

  const compatHeaders = () => ({
    Authorization: `Bearer ${resolveApiKey()}`,
    ...settings.headers
  })

  const googleProvider = () =>
    createGoogleGenerativeAI({
      baseURL,
      apiKey: resolveApiKey(),
      headers: settings.headers,
      fetch: customFetch
    })

  const googleImageModel = (modelId: string) => googleProvider().image(modelId)
  const googleEmbeddingModel = (modelId: string) => googleProvider().embeddingModel(modelId)

  const createChatModel = (modelId: string): LanguageModelV3 => {
    const adapter = settings.languageModelAdapter ?? resolveDmxapiLanguageModelAdapter(settings.endpointType, modelId)
    if (!adapter) throw new Error('DMXAPI chat requires an explicit supported endpoint')
    return adapter.createModel(modelId, { baseURL, apiKey: resolveApiKey, headers: compatHeaders, fetch: customFetch })
  }

  const createImageModelV3 = (modelId: string): ImageModelV3 => {
    const imageUrl = ({ path }: { path: string }) => `${withoutTrailingSlash(baseURL)}${path}`
    switch (settings.imageAdapter) {
      case 'google':
        return googleImageModel(modelId)
      case 'openai-native':
        return new OpenAIImageModel(modelId, {
          provider: `${DMXAPI_PROVIDER_NAME}.openai-image`,
          url: imageUrl,
          headers: compatHeaders,
          fetch: customFetch
        })
      case 'custom':
        return createImageGenerationModel(modelId, {
          provider: DMXAPI_PROVIDER_NAME,
          transport: buildDmxapiTransport(settings)
        })
      case 'compatible':
        break
      default:
        throw new Error('DMXAPI image requires a resolved adapter')
    }
    return new OpenAICompatibleImageModel(modelId, {
      provider: `${DMXAPI_PROVIDER_NAME}.image`,
      url: imageUrl,
      headers: compatHeaders,
      fetch: customFetch
    })
  }

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.embeddingModel = (modelId: string): EmbeddingModelV3 => {
    if (settings.endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) {
      return googleEmbeddingModel(modelId)
    }
    return new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${DMXAPI_PROVIDER_NAME}.embedding`,
      url: ({ path }) => `${withoutTrailingSlash(baseURL)}${path}`,
      headers: compatHeaders,
      fetch: customFetch
    })
  }
  provider.imageModel = createImageModelV3

  return provider
}
