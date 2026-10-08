import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { GoogleGenerativeAILanguageModel } from '@ai-sdk/google/internal'
import { createOpenAI } from '@ai-sdk/openai'
import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleEmbeddingModel,
  OpenAICompatibleImageModel
} from '@ai-sdk/openai-compatible'
import { OpenAIImageModel } from '@ai-sdk/openai/internal'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import type { VendorBag } from '@main/ai/utils/imageOptions'
import { resolveDmxapiChatFamily } from '@shared/data/presets/gatewayChatRouting'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'

import { createImageGenerationModel, type ImageGenerationTransport } from '../imageGenerationModel'
import { combineImageTransportHeaders } from '../imageTransportHttp'
import { type DmxapiCustomImageBinding, type DmxapiImageBinding, resolveDmxapiImageBinding } from './dmxapiImageRouting'
import { createDmxapiTransport } from './dmxapiTransport'

export { dmxapiUsesCustomTransport } from './dmxapiImageRouting'

export const DMXAPI_PROVIDER_NAME = 'dmxapi' as const

export interface DmxapiProviderSettings {
  /** Chat-only configurations need no image binding. */
  imageBinding?: DmxapiImageBinding
  apiKey?: string
  /** Base URL selected for this request. When `endpointBaseURLs` is absent, the
   *  factory retains the legacy behavior of deriving every protocol from it. */
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

type DmxapiEmbeddingFamily = 'openai-compat' | 'gemini'

const EMBEDDING_FAMILY_TABLE: Array<{
  family: Exclude<DmxapiEmbeddingFamily, 'openai-compat'>
  match: (modelId: string) => boolean
}> = [
  {
    family: 'gemini',
    match: (id) => /^(gemini-embedding-|embedding-001|text-embedding-\d{3}(?!-))/i.test(id)
  }
]

function resolveEmbeddingFamily(modelId: string): DmxapiEmbeddingFamily {
  return EMBEDDING_FAMILY_TABLE.find((entry) => entry.match(modelId))?.family ?? 'openai-compat'
}

/**
 * Build the DMXAPI submit/poll image transport from provider settings. Shared
 * by the provider factory and the image-generation job's transport registry so
 * both paths use the same re-resolved provider settings.
 */
export function buildDmxapiTransport(
  settings: DmxapiProviderSettings,
  binding: DmxapiCustomImageBinding
): ImageGenerationTransport<VendorBag> {
  const baseURL = settings.baseURL
  if (!baseURL) {
    throw new Error('DMXAPI provider requires a non-empty `baseURL` to build the image transport.')
  }
  return createDmxapiTransport({
    binding,
    apiKey: settings.apiKey ?? '',
    // Custom image endpoints are host-root paths, while settings.baseURL is the selected image connection.
    baseURL: withoutTrailingApiVersion(baseURL),
    headers: settings.headers,
    fetch: settings.fetch
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

  const chatBaseURL = settings.endpointBaseURLs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] ?? baseURL
  const compatUrl = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(chatBaseURL)}${path}`
  const imageUrl = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`
  const imageHeaders = () =>
    combineImageTransportHeaders({ Authorization: `Bearer ${resolveApiKey()}` }, settings.headers)
  const nativeBaseURL = withoutTrailingApiVersion(baseURL)
  const anthropicBaseURL =
    settings.endpointBaseURLs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES] ?? formatApiHost(nativeBaseURL, true)
  const geminiBaseURL =
    settings.endpointBaseURLs?.[ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT] ?? formatApiHost(nativeBaseURL, true, 'v1beta')
  const openaiBaseURL =
    settings.endpointBaseURLs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] ?? formatApiHost(nativeBaseURL, true)

  const googleProvider = () =>
    createGoogleGenerativeAI({
      baseURL: geminiBaseURL,
      apiKey: resolveApiKey(),
      headers: settings.headers,
      fetch: customFetch
    })

  const googleImageModel = (modelId: string) => googleProvider().image(modelId)
  const googleEmbeddingModel = (modelId: string) => googleProvider().embeddingModel(modelId)

  const openaiChatModel = (modelId: string) =>
    createOpenAI({
      baseURL: openaiBaseURL,
      apiKey: resolveApiKey(),
      headers: settings.headers,
      fetch: customFetch
    }).chat(modelId)

  const createChatModel = (modelId: string): LanguageModelV3 => {
    switch (resolveDmxapiChatFamily(modelId)) {
      case 'anthropic':
        return new AnthropicMessagesLanguageModel(modelId, {
          provider: `${DMXAPI_PROVIDER_NAME}.anthropic`,
          baseURL: anthropicBaseURL,
          headers: () => ({ 'x-api-key': resolveApiKey(), ...settings.headers }),
          fetch: customFetch,
          supportedUrls: () => ({ 'image/*': [/^https?:\/\/.*$/] }),
          supportsNativeStructuredOutput: false
        })
      case 'gemini':
        return new GoogleGenerativeAILanguageModel(modelId, {
          provider: `${DMXAPI_PROVIDER_NAME}.google`,
          baseURL: geminiBaseURL,
          headers: () => ({ 'x-goog-api-key': resolveApiKey(), ...settings.headers }),
          fetch: customFetch,
          generateId: () => `${DMXAPI_PROVIDER_NAME}-${Date.now()}`,
          supportedUrls: () => ({})
        })
      case 'openai':
        return openaiChatModel(modelId)
      default:
        return new OpenAICompatibleChatLanguageModel(modelId, {
          provider: `${DMXAPI_PROVIDER_NAME}.chat`,
          url: compatUrl,
          headers: compatHeaders,
          fetch: customFetch
        })
    }
  }

  const createImageModelV3 = (modelId: string): ImageModelV3 => {
    const binding = settings.imageBinding ?? resolveDmxapiImageBinding(modelId)
    if (binding.kind === 'custom') {
      if (binding.binding.modelId !== modelId) throw new Error('DMXAPI image binding does not match model')
      return createImageGenerationModel(modelId, {
        provider: DMXAPI_PROVIDER_NAME,
        modelDescriptor: undefined,
        transport: buildDmxapiTransport({ ...settings, apiKey: resolveApiKey() }, binding.binding)
      })
    }
    if (binding.modelId !== modelId) throw new Error('DMXAPI image binding does not match model')
    switch (binding.family) {
      case 'openai-native':
        return new OpenAIImageModel(modelId, {
          provider: `${DMXAPI_PROVIDER_NAME}.openai-image`,
          url: imageUrl,
          headers: imageHeaders,
          fetch: customFetch
        })
      case 'gemini-native':
        return googleImageModel(modelId)
    }
    return new OpenAICompatibleImageModel(modelId, {
      provider: `${DMXAPI_PROVIDER_NAME}.image`,
      url: imageUrl,
      headers: imageHeaders,
      fetch: customFetch
    })
  }

  const provider = (modelId: string) => createChatModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.embeddingModel = (modelId: string): EmbeddingModelV3 => {
    if (resolveEmbeddingFamily(modelId) === 'gemini') {
      return googleEmbeddingModel(modelId)
    }
    return new OpenAICompatibleEmbeddingModel(modelId, {
      provider: `${DMXAPI_PROVIDER_NAME}.embedding`,
      url: compatUrl,
      headers: compatHeaders,
      fetch: customFetch
    })
  }
  provider.imageModel = createImageModelV3

  return provider
}
