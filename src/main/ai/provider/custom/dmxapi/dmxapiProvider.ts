import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { GoogleGenerativeAILanguageModel } from '@ai-sdk/google/internal'
import { createOpenAI } from '@ai-sdk/openai'
import { OpenAIImageModel } from '@ai-sdk/openai/internal'
import {
  OpenAICompatibleChatLanguageModel,
  OpenAICompatibleEmbeddingModel,
  OpenAICompatibleImageModel
} from '@ai-sdk/openai-compatible'
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { type EndpointDispatchConfig, resolveProviderModelRoute } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { formatApiHost, withoutTrailingApiVersion } from '@shared/utils/api'

import { createImageGenerationModel, type ImageGenerationTransport } from '../imageGenerationModel'
import { resolveDmxapiChatFamily } from './dmxapiRouting'
import { createDmxapiTransport, resolveDmxapiFamily } from './dmxapiTransport'

export const DMXAPI_PROVIDER_NAME = 'dmxapi' as const

export interface DmxapiProviderSettings {
  apiKey?: string
  /** Base URL selected for this request. When `endpointBaseURLs` is absent, the
   *  factory retains the legacy behavior of deriving every protocol from it. */
  baseURL?: string
  /** Explicit per-protocol URLs for providers whose endpoints use different hosts. */
  endpointBaseURLs?: Partial<Record<EndpointType, string>>
  headers?: Record<string, string>
  fetch?: FetchFunction
  /**
   * Registry endpoint configs, injected by `config.ts`. Each declares the ids it `serves`, which is
   * what picks the backend below.
   */
  endpointConfigs?: Partial<Record<EndpointType, EndpointDispatchConfig>>
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

type DmxapiNativeImageFamily = 'openai-compat-image' | 'openai-native' | 'gemini-native'

const NATIVE_IMAGE_FAMILY_TABLE: Array<{
  family: Exclude<DmxapiNativeImageFamily, 'openai-compat-image'>
  match: (modelId: string) => boolean
}> = [
  { family: 'openai-native', match: (id) => /^(gpt-image|dall-e)/i.test(id) },
  // Native Google image — covers both `imagen-*` (Imagen API) and
  // `gemini-*-image*` previews (Gemini generateContent with image output).
  // The Google SDK dispatches internally; pointing it at DMXAPI's baseURL
  // routes the request through the gateway's Gemini-compatible path.
  { family: 'gemini-native', match: (id) => /^imagen-/i.test(id) || /^gemini-.*image/i.test(id) }
]

function resolveNativeImageFamily(modelId: string): DmxapiNativeImageFamily {
  return NATIVE_IMAGE_FAMILY_TABLE.find((entry) => entry.match(modelId))?.family ?? 'openai-compat-image'
}

/**
 * Whether a DMXAPI image model is routed to the bespoke submit/poll transport
 * (Doubao Seedream / Wan / async Qwen-image) rather than a native AI SDK
 * adapter or the OpenAI-compatible image model. MUST mirror the routing in
 * `createImageModelV3` below — the image-generation job's transport registry
 * (`resolveImageTransport`) uses this to decide whether DMXAPI generation goes
 * through the job. Native families (gpt-image / dall-e / imagen / gemini-image)
 * and the `openai-flat` compat fallback keep the in-SDK path.
 */
export function dmxapiUsesCustomTransport(modelId: string): boolean {
  return resolveNativeImageFamily(modelId) === 'openai-compat-image' && resolveDmxapiFamily(modelId) !== 'openai-flat'
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

  const chatBaseURL = settings.endpointBaseURLs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] ?? baseURL
  const compatUrl = ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(chatBaseURL)}${path}`
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

  const transport = buildDmxapiTransport(settings)

  const createChatModel = (modelId: string): LanguageModelV3 => {
    switch (resolveDmxapiChatFamily(resolveProviderModelRoute(settings.endpointConfigs, modelId))) {
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
    // Native SDK families win first — `gpt-image-*` / `dall-e-*` via
    // `@ai-sdk/openai`'s `OpenAIImageModel` (multipart edits, etc.),
    // `imagen-*` / `gemini-*-image*` via `@ai-sdk/google`'s `provider.image`.
    // Putting these ahead of `resolveDmxapiFamily` ensures a model that has
    // a first-party adapter is never accidentally routed to the bespoke
    // transport just because a family-table matcher overlaps.
    switch (resolveNativeImageFamily(modelId)) {
      case 'openai-native':
        return new OpenAIImageModel(modelId, {
          provider: `${DMXAPI_PROVIDER_NAME}.openai-image`,
          url: compatUrl,
          headers: compatHeaders,
          fetch: customFetch
        })
      case 'gemini-native':
        return googleImageModel(modelId)
    }
    // Bespoke families (Doubao Seedream / Wan / async Qwen-image) — no native
    // AI SDK adapter covers these wire shapes (Responses-API string/messages
    // body, `extra.output.results[].url` async wrapper), so they go through
    // the custom transport.
    if (resolveDmxapiFamily(modelId) !== 'openai-flat') {
      return createImageGenerationModel(modelId, { provider: DMXAPI_PROVIDER_NAME, transport })
    }
    // Fallback for unknown models — OpenAI-compat image model is the safest
    // assumption since DMXAPI's gateway translates the rest of its catalog
    // through that wire shape.
    return new OpenAICompatibleImageModel(modelId, {
      provider: `${DMXAPI_PROVIDER_NAME}.image`,
      url: compatUrl,
      headers: compatHeaders,
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

  return provider as DmxapiProvider
}
