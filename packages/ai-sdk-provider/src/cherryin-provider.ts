import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { GoogleGenerativeAILanguageModel } from '@ai-sdk/google/internal'
import type { OpenAIProviderSettings } from '@ai-sdk/openai'
import { OpenAICompatibleChatLanguageModel, OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import {
  OpenAICompletionLanguageModel,
  OpenAIEmbeddingModel,
  OpenAIImageModel,
  OpenAIResponsesLanguageModel,
  OpenAISpeechModel,
  OpenAITranscriptionModel
} from '@ai-sdk/openai/internal'
import {
  APICallError,
  type EmbeddingModelV3,
  type ImageModelV3,
  type JSONValue,
  type LanguageModelV3,
  type ProviderV3,
  type RerankingModelV3,
  type SpeechModelV3,
  type TranscriptionModelV3
} from '@ai-sdk/provider'
import { type FetchFunction, loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils'

import { OpenAICompatibleRerankingModel } from './openai-compatible-reranking-model'
import { applyReasoningModelMaxTokensConversion } from './reasoningModelTransform'

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
  /**
   * Optional endpoint type to distinguish different endpoint behaviors.
   * "image-generation" is also openai endpoint, but specifically for image generation.
   */
  endpointType?:
    | 'openai'
    | 'openai-response'
    | 'anthropic'
    | 'gemini'
    | 'image-generation'
    | 'jina-rerank'
    | 'embedding'
}

export interface CherryInProvider extends ProviderV3 {
  (modelId: string, settings?: OpenAIProviderSettings): LanguageModelV3
  languageModel(modelId: string, settings?: OpenAIProviderSettings): LanguageModelV3
  chat(modelId: string, settings?: OpenAIProviderSettings): LanguageModelV3
  responses(modelId: string): LanguageModelV3
  completion(modelId: string, settings?: OpenAIProviderSettings): LanguageModelV3
  embedding(modelId: string, settings?: OpenAIProviderSettings): EmbeddingModelV3
  embeddingModel(modelId: string, settings?: OpenAIProviderSettings): EmbeddingModelV3
  image(modelId: string, settings?: OpenAIProviderSettings): ImageModelV3
  imageModel(modelId: string, settings?: OpenAIProviderSettings): ImageModelV3
  transcription(modelId: string): TranscriptionModelV3
  transcriptionModel(modelId: string): TranscriptionModelV3
  speech(modelId: string): SpeechModelV3
  speechModel(modelId: string): SpeechModelV3
  rerankingModel(modelId: string): RerankingModelV3
}

const resolveApiKey = (options: CherryInProviderSettings): string =>
  loadApiKey({
    apiKey: options.apiKey,
    environmentVariableName: 'CHERRYIN_API_KEY',
    description: 'CherryIN'
  })

const isAnthropicModel = (modelId: string) => ANTHROPIC_PREFIX.test(modelId)
const isGeminiModel = (modelId: string) => GEMINI_PREFIX.test(modelId)
const isQwenImageModel = (modelId: string) => {
  const normalized = modelId.toLowerCase()
  return normalized.includes('qwen') && normalized.includes('image')
}
const stripGooglePrefix = (modelId: string) => modelId.replace(/^google\//i, '')
const isGoogleImageModel = (modelId: string) => {
  const normalized = stripGooglePrefix(modelId).toLowerCase()
  return normalized.startsWith('imagen-') || (normalized.startsWith('gemini-') && normalized.includes('image'))
}
const isGoogleGeminiImageModel = (modelId: string) => stripGooglePrefix(modelId).toLowerCase().startsWith('gemini-')

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

class CherryInOpenAIChatLanguageModel extends OpenAICompatibleChatLanguageModel {
  constructor(modelId: string, settings: any) {
    super(modelId, {
      ...settings,
      fetch: createCustomFetch(settings.fetch),
      transformRequestBody: applyReasoningModelMaxTokensConversion
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

const normalizePersonGeneration = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  switch (value.toUpperCase()) {
    case 'ALLOW_ALL':
      return 'allow_all'
    case 'ALLOW_ADULT':
      return 'allow_adult'
    case 'DONT_ALLOW':
      return 'dont_allow'
    default:
      return value
  }
}

const normalizeAspectRatio = (value: unknown): `${number}:${number}` | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/^ASPECT_/i, '').replace('_', ':')
  return /^\d+:\d+$/.test(normalized) ? (normalized as `${number}:${number}`) : undefined
}

const normalizeImageSize = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const normalized = value.toUpperCase()
  return ['512', '1K', '2K', '4K'].includes(normalized) ? normalized : undefined
}

const withGoogleImageOptions = (model: ImageModelV3, providerKey: string, isGeminiImage: boolean): ImageModelV3 => ({
  specificationVersion: model.specificationVersion,
  provider: model.provider,
  modelId: model.modelId,
  maxImagesPerCall: model.maxImagesPerCall,
  doGenerate(options) {
    const providerOptions = options.providerOptions ?? {}
    const source = {
      ...(providerOptions.openai as Record<string, unknown> | undefined),
      ...(providerOptions[providerKey] as Record<string, unknown> | undefined)
    } as Record<string, unknown>
    const existingGoogle = (providerOptions.google ?? {}) as Record<string, unknown>
    const existingImageConfig = (existingGoogle.imageConfig ?? {}) as Record<string, unknown>

    const aspectRatio =
      options.aspectRatio ??
      normalizeAspectRatio(options.size) ??
      normalizeAspectRatio(source.aspectRatio ?? source.aspect_ratio)
    const personGeneration = normalizePersonGeneration(source.personGeneration ?? source.person_generation)
    const imageSize = normalizeImageSize(
      source.imageResolution ?? source.imageSize ?? source.image_size ?? source.resolution
    )

    const googleOptions: Record<string, unknown> = {
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(personGeneration ? { personGeneration } : {}),
      ...existingGoogle
    }

    if (isGeminiImage && (aspectRatio || imageSize || Object.keys(existingImageConfig).length > 0)) {
      googleOptions.imageConfig = {
        ...existingImageConfig,
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(imageSize ? { imageSize } : {})
      }
    }

    return model.doGenerate({
      ...options,
      ...(aspectRatio ? { aspectRatio, size: undefined } : {}),
      providerOptions: {
        ...providerOptions,
        google: googleOptions as Record<string, JSONValue>
      }
    })
  }
})

const MAX_IMAGE_RESPONSE_CAPTURE_BYTES = 20 * 1024 * 1024

function isImageResponseError(error: unknown): boolean {
  if (!APICallError.isInstance(error)) return false
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === 'number' && status >= 200 && status < 300
}

function normalizeImageString(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('data:')) return trimmed.toLowerCase().startsWith('data:image/') ? trimmed : undefined
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const compact = trimmed.replace(/\s+/g, '')
  // Bare payloads must look like real image bytes; short alpha strings are
  // almost always a text field misread as an image (e.g. a status message).
  if (compact.length < 100 || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return undefined
  return compact
}

function extractSingleImage(item: unknown): string | undefined {
  if (typeof item === 'string') return normalizeImageString(item)
  if (!item || typeof item !== 'object') return undefined
  const record = item as Record<string, unknown>
  for (const key of [
    'b64_json',
    'b64Json',
    'base64_json',
    'base64Json',
    'base64',
    'b64',
    'result',
    'bytesBase64',
    'image'
  ]) {
    const value = record[key]
    if (typeof value === 'string') {
      const normalized = normalizeImageString(value)
      if (normalized) return normalized
    }
  }
  const nested = record.image_url ?? record.imageUrl
  if (typeof nested === 'string') {
    const normalized = normalizeImageString(nested)
    if (normalized) return normalized
  }
  if (nested && typeof nested === 'object') {
    const url = (nested as Record<string, unknown>).url
    if (typeof url === 'string') {
      const normalized = normalizeImageString(url)
      if (normalized) return normalized
    }
  }
  const url = record.url
  if (typeof url === 'string') {
    const normalized = normalizeImageString(url)
    if (normalized) return normalized
  }
  return undefined
}

function extractImageStrings(raw: unknown): string[] {
  const containers = Array.isArray(raw)
    ? [raw]
    : raw && typeof raw === 'object'
      ? ['data', 'images', 'output', 'results'].flatMap((key) => {
          const value = (raw as Record<string, unknown>)[key]
          if (Array.isArray(value)) return [value]
          if (value && typeof value === 'object') return [[value]]
          return []
        })
      : []
  const images: string[] = []
  for (const items of containers) {
    for (const item of items) {
      const single = extractSingleImage(item)
      if (single) images.push(single)
    }
  }
  return images
}

function summarizeImageBody(parsed: unknown): Record<string, unknown> {
  if (Array.isArray(parsed)) return { topLevel: 'array', length: parsed.length }
  if (!parsed || typeof parsed !== 'object') return { topLevel: typeof parsed }
  const record = parsed as Record<string, unknown>
  const summary: Record<string, unknown> = { topLevelKeys: Object.keys(record) }
  for (const key of ['data', 'images', 'output', 'results']) {
    const value = record[key]
    if (!Array.isArray(value)) continue
    summary[`${key}Length`] = value.length
    const first = value[0]
    if (typeof first === 'string') summary[`${key}Item0`] = `string(${first.length})`
    else if (first && typeof first === 'object') {
      summary[`${key}ItemKeys`] = Object.keys(first as Record<string, unknown>).map((itemKey) => {
        const itemValue = (first as Record<string, unknown>)[itemKey]
        return typeof itemValue === 'string'
          ? `${itemKey}:string(${itemValue.length})`
          : `${itemKey}:${typeof itemValue}`
      })
    }
  }
  return summary
}

function extractImageUsage(
  raw: unknown
): { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const usage = (raw as Record<string, unknown>).usage
  if (!usage || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  const pick = (value: unknown) => (typeof value === 'number' ? value : undefined)
  const parsed = {
    inputTokens: pick(record.input_tokens ?? record.prompt_tokens),
    outputTokens: pick(record.output_tokens ?? record.completion_tokens),
    totalTokens: pick(record.total_tokens)
  }
  return parsed.inputTokens === undefined && parsed.outputTokens === undefined && parsed.totalTokens === undefined
    ? undefined
    : parsed
}

type TolerantImageResult = Awaited<ReturnType<ImageModelV3['doGenerate']>>

// CherryIN fronts several image backends, so a 200 can carry pixels under a key
// the strict SDK schema rejects; retain the body and re-parse leniently.
function withTolerantOpenAIImageResponse(
  modelId: string,
  config: ConstructorParameters<typeof OpenAIImageModel>[1]
): ImageModelV3 {
  const inner = new OpenAIImageModel(modelId, config)
  const currentDate = () => config._internal?.currentDate?.() ?? new Date()
  return {
    specificationVersion: inner.specificationVersion,
    provider: inner.provider,
    modelId: inner.modelId,
    get maxImagesPerCall() {
      return inner.maxImagesPerCall
    },
    async doGenerate(options) {
      let capture: Promise<string> | undefined
      let captureHeaders: Record<string, string> = {}
      let captureUrl = ''
      let skippedBytes: number | undefined
      const capturingFetch: FetchFunction = async (input, init) => {
        const response = await (config.fetch ?? fetch)(input, init)
        const urlText = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
        if (!response.ok || (!urlText.includes('/images/edits') && !urlText.includes('/images/generations'))) {
          return response
        }
        captureUrl = urlText
        try {
          captureHeaders = Object.fromEntries(response.headers.entries())
        } catch {
          captureHeaders = {}
        }
        try {
          const declared = Number(response.headers.get('content-length'))
          if (Number.isFinite(declared) && declared > MAX_IMAGE_RESPONSE_CAPTURE_BYTES) {
            skippedBytes = declared
            return response
          }
          capture = response
            .clone()
            .text()
            .then(
              (text) => {
                if (text.length > MAX_IMAGE_RESPONSE_CAPTURE_BYTES) {
                  skippedBytes = text.length
                  return ''
                }
                return text
              },
              () => ''
            )
        } catch {
          // Capture is best-effort; the SDK response stays usable without it.
        }
        return response
      }
      const delegate = new OpenAIImageModel(modelId, { ...config, fetch: capturingFetch })
      const noImageError = (
        shape: Record<string, unknown>,
        rawText: string | undefined,
        cause: unknown
      ): APICallError =>
        new APICallError({
          message: `CherryIN image response (HTTP 200) contained no recognizable image data ${JSON.stringify(shape)}. The upstream generation may have been billed; retrying starts a new billable generation.`,
          statusCode: 200,
          url: captureUrl,
          responseHeaders: captureHeaders,
          ...(rawText && rawText.length <= 2000 ? { responseBody: rawText } : {}),
          requestBodyValues: {},
          isRetryable: false,
          ...(cause === undefined ? {} : { cause: cause instanceof Error ? cause : new Error(String(cause)) })
        })
      const recoveredResult = (
        images: string[],
        raw: unknown,
        warnings: TolerantImageResult['warnings']
      ): TolerantImageResult => {
        const usage = extractImageUsage(raw)
        return {
          images,
          warnings,
          ...(usage
            ? {
                usage: {
                  inputTokens: usage.inputTokens ?? undefined,
                  outputTokens: usage.outputTokens ?? undefined,
                  totalTokens: usage.totalTokens ?? undefined
                }
              }
            : {}),
          response: { timestamp: currentDate(), modelId, headers: captureHeaders },
          providerMetadata: { openai: { images: images.map(() => ({})) } }
        }
      }
      const parseCapturedBody = async (): Promise<{ rawText: string; parsed: unknown } | undefined> => {
        const rawText = capture ? await capture : ''
        if (!rawText) return undefined
        try {
          return { rawText, parsed: JSON.parse(rawText) }
        } catch {
          return undefined
        }
      }
      const recoverOrThrow = async (
        cause: unknown,
        warnings: TolerantImageResult['warnings']
      ): Promise<TolerantImageResult> => {
        const captured = await parseCapturedBody()
        if (captured) {
          const images = extractImageStrings(captured.parsed)
          if (images.length > 0) return recoveredResult(images, captured.parsed, warnings)
          throw noImageError(summarizeImageBody(captured.parsed), captured.rawText, cause)
        }
        if (skippedBytes !== undefined) {
          throw noImageError({ bytes: skippedBytes, capture: 'skipped-over-cap' }, undefined, cause)
        }
        if (cause !== undefined) throw cause
        throw noImageError({ capture: 'unavailable' }, undefined, cause)
      }
      try {
        const result = await delegate.doGenerate(options)
        // The strict schema accepts any string as `b64_json`, including a
        // non-image `data:` URI; empty results and those both carry no pixels.
        const images = (result.images as unknown[]).filter(
          (image) =>
            typeof image !== 'string' || !image.startsWith('data:') || image.toLowerCase().startsWith('data:image/')
        ) as typeof result.images
        if (images.length === 0) return await recoverOrThrow(undefined, result.warnings)
        if (images.length !== result.images.length) return { ...result, images }
        return result
      } catch (error) {
        if (!isImageResponseError(error)) throw error
        return await recoverOrThrow(error, [])
      }
    }
  }
}

const createJsonHeadersGetter = (options: CherryInProviderSettings): (() => Record<string, HeaderValue>) => {
  return () => ({
    Authorization: `Bearer ${resolveApiKey(options)}`,
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
    fetch,
    endpointType
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

  const createChatModelByModelId = (modelId: string, settings: OpenAIProviderSettings = {}) => {
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

  const createChatModel = (modelId: string, settings: OpenAIProviderSettings = {}) => {
    if (!endpointType) return createChatModelByModelId(modelId, settings)
    switch (endpointType) {
      case 'anthropic':
        return createAnthropicModel(modelId)
      case 'gemini':
        return createGeminiModel(modelId)
      case 'openai':
        return createOpenAIChatModel(modelId)
      case 'embedding':
        throw new Error('Use embeddingModel() for embedding endpoint type')
      case 'jina-rerank':
        throw new Error('Use rerankingModel() for jina-rerank endpoint type')
      case 'openai-response':
      default:
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

  const createImageModel = (modelId: string, settings: OpenAIProviderSettings = {}) => {
    if (isGoogleImageModel(modelId)) {
      const googleProvider = createGoogleGenerativeAI({
        apiKey: resolveApiKey(options),
        baseURL: geminiBaseURL,
        headers: {
          ...resolveConfiguredHeaders(options.headers),
          ...settings.headers
        },
        fetch,
        name: `${CHERRYIN_PROVIDER_NAME}.google`
      })
      const isGeminiImage = isGoogleGeminiImageModel(modelId)
      const googleImageModel = googleProvider.image(modelId)
      return withGoogleImageOptions(googleImageModel, CHERRYIN_PROVIDER_NAME, isGeminiImage)
    }

    const config = {
      provider: `${CHERRYIN_PROVIDER_NAME}.image`,
      url,
      headers: () => ({
        ...getJsonHeaders(),
        ...settings.headers
      }),
      fetch
    }
    if (isQwenImageModel(modelId)) {
      return new OpenAICompatibleImageModel(modelId, config)
    }
    return withTolerantOpenAIImageResponse(modelId, config)
  }

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

  const createRerankingModel = (modelId: string) =>
    new OpenAICompatibleRerankingModel(modelId, {
      provider: `${CHERRYIN_PROVIDER_NAME}.rerank`,
      url,
      headers: getJsonHeaders,
      fetch
    })

  const provider = (modelId: string, settings?: OpenAIProviderSettings) => createChatModel(modelId, settings)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createChatModel
  provider.chat = createOpenAIChatModel

  provider.responses = createResponsesModel
  provider.completion = createCompletionModel

  provider.embedding = createEmbeddingModel
  provider.embeddingModel = createEmbeddingModel

  provider.image = createImageModel
  provider.imageModel = createImageModel

  provider.transcription = createTranscriptionModel
  provider.transcriptionModel = createTranscriptionModel

  provider.speech = createSpeechModel
  provider.speechModel = createSpeechModel

  provider.rerankingModel = createRerankingModel

  return provider
}

export const cherryIn = createCherryIn()
