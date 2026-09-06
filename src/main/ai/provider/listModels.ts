/**
 * Model listing service for Main process (v2 types).
 *
 * Uses Strategy Registry pattern: first matching fetcher wins.
 * All HTTP calls use @ai-sdk/provider-utils for consistent error handling.
 */

import {
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  getFromApi as aiSdkGetFromApi,
  postJsonToApi,
  zodSchema
} from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { providerService } from '@main/data/services/ProviderService'
import { copilotService } from '@main/services/CopilotService'
import { defaultAppHeaders, mergeHeaders } from '@main/utils/http'
import type { EndpointType, Model } from '@shared/data/types/model'
import {
  createUniqueModelId,
  CURRENCY,
  ENDPOINT_TYPE,
  endpointImpliedCapability,
  MODEL_CAPABILITY
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { formatApiHost, formatOllamaApiHost, withoutTrailingApiVersion, withoutTrailingSlash } from '@shared/utils/api'
import { deriveModelGroupName } from '@shared/utils/model'
import {
  isAIGatewayProvider,
  isGeminiProvider,
  isOllamaProvider,
  isVertexProvider,
  matchesPreset
} from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'
import * as z from 'zod'

import { defaultHeaders, getBaseUrl, getExtraHeaders } from '../utils/provider'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import {
  baiduModelPricing,
  huggingFaceModelPricing,
  lanyunModelPricing,
  newApiGroupMultiplier,
  newApiPricing,
  type NewApiPricingItem,
  openAITokenPricing,
  perMillion,
  ppioModelPricing,
  unknownUsdPricing,
  usdPricing,
  vercelGatewayPricing
} from './listModels/pricing'
import {
  createVertexModelListRequest,
  DEFAULT_VERTEX_MODEL_PUBLISHERS,
  getVertexModelId,
  getVertexModelPublisher,
  isSupportedVertexPublisherModel
} from './listModels/vertex'
import {
  AIHubMixModelsResponseSchema,
  AnthropicModelsResponseSchema,
  CopilotModelsResponseSchema,
  GeminiModelsResponseSchema,
  NewApiModelsResponseSchema,
  NewApiPricingResponseSchema,
  OllamaShowResponseSchema,
  OllamaTagsResponseSchema,
  OpenAIModelsResponseSchema,
  OpenRouterModelsResponseSchema,
  OVMSConfigResponseSchema,
  TogetherModelsResponseSchema,
  VercelGatewayModelsResponseSchema,
  VertexPublisherModelsResponseSchema
} from './listModelsSchemas'
import { isVertexMaasModelId } from './vertex'

const logger = loggerService.withContext('ModelListService')

// ── Types ──

type ModelFetcher = {
  match: (provider: Provider) => boolean
  fetch: (provider: Provider, signal?: AbortSignal, options?: { throwOnError?: boolean }) => Promise<Partial<Model>[]>
}

function getErrorType(error: unknown) {
  return error instanceof Error ? error.name : typeof error
}

function handleOptionalModelListFailure<T>(
  error: unknown,
  options: { throwOnError?: boolean } | undefined,
  context: Record<string, string>
): { data: T[] } {
  if (options?.throwOnError) {
    throw error
  }

  return recoverOptionalModelListFailure(error, context)
}

function recoverOptionalModelListFailure<T>(error: unknown, context: Record<string, string>): { data: T[] } {
  logger.warn('Optional model list endpoint failed; continuing with primary models', {
    ...context,
    errorType: getErrorType(error)
  })
  return { data: [] }
}

// ── API Layer ──

const ApiErrorSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      code: z.string().optional()
    })
    .optional(),
  message: z.string().optional()
})

type ApiError = z.infer<typeof ApiErrorSchema>
type OpenAIModelResponseItem = z.infer<typeof OpenAIModelsResponseSchema>['data'][number]

async function getFromApi<T>({
  url,
  headers,
  responseSchema,
  abortSignal
}: {
  url: string
  headers?: Record<string, string>
  responseSchema: z.ZodType<T>
  abortSignal?: AbortSignal
}): Promise<T> {
  const { value } = await aiSdkGetFromApi({
    url,
    headers,
    successfulResponseHandler: createJsonResponseHandler(zodSchema(responseSchema)),
    failedResponseHandler: createJsonErrorResponseHandler({
      errorSchema: zodSchema(ApiErrorSchema),
      errorToMessage: (error: ApiError) => error.error?.message || error.message || 'Unknown error'
    }),
    abortSignal
  })

  return value
}

/** Build default headers with rotated API key */

function defaultGroup(modelId: string, providerId: string): string {
  return deriveModelGroupName(modelId) ?? providerId
}

/** Build a partial v2 Model from API response */
function toModel(apiModelId: string, provider: Provider, extra?: Partial<Model>): Partial<Model> {
  return {
    id: createUniqueModelId(provider.id, apiModelId),
    providerId: provider.id,
    apiModelId,
    name: extra?.name || apiModelId,
    group: extra?.group || defaultGroup(apiModelId, provider.id),
    ownedBy: extra?.ownedBy,
    description: extra?.description,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...extra
  }
}

function dedup<T>(items: T[], getId: (item: T) => string | undefined): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const id = getId(item)?.trim()
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function pickPreferredString(values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return undefined
}

/** The trained context length from `/api/show`, whose `model_info` keys carry an architecture prefix. */
function readOllamaContextLength(modelInfo: Record<string, unknown> | undefined): number | undefined {
  const architecture = modelInfo?.['general.architecture']
  if (typeof architecture !== 'string') return undefined
  const contextLength = modelInfo?.[`${architecture}.context_length`]
  return typeof contextLength === 'number' && contextLength > 0 ? contextLength : undefined
}

/**
 * `/api/tags` carries no context length, so without this the model has no `contextWindow` and
 * Ollama falls back to sizing by available VRAM — 4k below 24 GiB, where an agent's tool preamble
 * alone overruns the window and Ollama truncates the conversation away (#18643). Its own guidance
 * puts agent and coding workloads at 64k+, which only the model's real window can satisfy.
 */
async function fetchOllamaContextWindow(
  baseUrl: string,
  provider: Provider,
  model: string,
  signal?: AbortSignal
): Promise<number | undefined> {
  try {
    const { value } = await postJsonToApi({
      url: `${baseUrl}/api/show`,
      headers: defaultHeaders(provider),
      body: { model },
      successfulResponseHandler: createJsonResponseHandler(zodSchema(OllamaShowResponseSchema)),
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: zodSchema(ApiErrorSchema),
        errorToMessage: (error: ApiError) => error.error?.message || error.message || 'Unknown error'
      }),
      abortSignal: signal
    })
    return readOllamaContextLength(value.model_info)
  } catch (error) {
    // A model that cannot be inspected still belongs in the list; it falls back to the default window.
    logger.warn('failed to read Ollama context length', { model, error })
    return undefined
  }
}

const ollamaFetcher: ModelFetcher = {
  match: (p) => isOllamaProvider(p),
  fetch: async (provider, signal) => {
    const baseUrl = withoutTrailingSlash(getBaseUrl(provider))
      .replace(/\/v1$/, '')
      .replace(/\/api$/, '')
    const response = await getFromApi({
      url: `${baseUrl}/api/tags`,
      headers: defaultHeaders(provider),
      responseSchema: OllamaTagsResponseSchema,
      abortSignal: signal
    })
    const models = dedup(response.models, (m) => m.name)
    const contextWindows = await Promise.all(
      models.map((m) => fetchOllamaContextWindow(baseUrl, provider, m.name, signal))
    )
    return models.map((m, index) =>
      toModel(m.name, provider, {
        ownedBy: 'ollama',
        capabilities: m.capabilities?.includes('thinking') ? [MODEL_CAPABILITY.REASONING] : [],
        ...(contextWindows[index] ? { contextWindow: contextWindows[index] } : {})
      })
    )
  }
}

const EXCLUDED_GEMINI_GENERATION_METHODS = ['predictLongRunning', 'bidiGenerateContent'] as const

const EXCLUDED_GEMINI_MODEL_KEYWORDS = ['tts'] as const

function isSupportedGeminiModel(model: z.infer<typeof GeminiModelsResponseSchema>['models'][number]): boolean {
  const methods = model.supportedGenerationMethods ?? []
  if (EXCLUDED_GEMINI_GENERATION_METHODS.some((method) => methods.includes(method))) {
    return false
  }

  const id = (model.name.startsWith('models/') ? model.name.slice(7) : model.name).toLowerCase()
  return !EXCLUDED_GEMINI_MODEL_KEYWORDS.some((keyword) => id.includes(keyword))
}

const geminiFetcher: ModelFetcher = {
  match: (p) => isGeminiProvider(p),
  fetch: async (provider, signal) => {
    let baseUrl = withoutTrailingSlash(getBaseUrl(provider))
    baseUrl = baseUrl.replace(/\/v1(beta)?$/, '')
    const apiKey = providerService.getRotatedApiKey(provider.id)
    // Pass the key via the `x-goog-api-key` header (same as `@ai-sdk/google`'s chat path)
    // instead of the `?key=` query param: on failure `APICallError.url` is logged, which
    // would persist the key into local logs users attach to bug reports.
    const response = await getFromApi({
      url: `${baseUrl}/v1beta/models`,
      headers: mergeHeaders(defaultAppHeaders(), { 'x-goog-api-key': apiKey }, provider.settings?.extraHeaders),
      responseSchema: GeminiModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.models, (m) => m.name)
      .filter(isSupportedGeminiModel)
      .map((m) => {
        const id = m.name.startsWith('models/') ? m.name.slice(7) : m.name
        return toModel(id, provider, { name: m.displayName || id, description: m.description })
      })
  }
}

/** Vertex AI: paginate `publishers/{publisher}/models` for each default publisher
 *  (google, openai, meta, qwen, deepseek-ai, moonshotai, zai-org), then filter the
 *  union down to model families we actually run. Misconfigured providers and
 *  per-publisher request failures degrade to "no models from this publisher" with
 *  a warn log instead of failing the whole listing. */
const vertexFetcher: ModelFetcher = {
  match: (p) => isVertexProvider(p),
  fetch: async (provider, signal, options) => {
    const request = await createVertexModelListRequest(provider, { throwOnError: options?.throwOnError })
    if (!request) return []

    type PublisherGroup = z.infer<typeof VertexPublisherModelsResponseSchema>['publisherModels'] | null
    let firstPublisherError: unknown
    const publisherModelGroups = await Promise.all(
      DEFAULT_VERTEX_MODEL_PUBLISHERS.map(async (publisher): Promise<PublisherGroup> => {
        try {
          const publisherModels: z.infer<typeof VertexPublisherModelsResponseSchema>['publisherModels'] = []
          let pageToken: string | undefined
          do {
            const searchParams = new URLSearchParams({
              pageSize: '100',
              listAllVersions: 'true'
            })
            if (pageToken) searchParams.set('pageToken', pageToken)
            const response = await getFromApi({
              url: `${request.baseUrl}/v1beta1/publishers/${publisher}/models?${searchParams.toString()}`,
              headers: request.headers,
              responseSchema: VertexPublisherModelsResponseSchema,
              abortSignal: signal
            })
            publisherModels.push(...response.publisherModels)
            pageToken = response.nextPageToken
          } while (pageToken)
          return publisherModels
        } catch (error) {
          if (firstPublisherError === undefined) {
            firstPublisherError = error
          }
          logger.warn('Skipping Vertex publisher model listing after request failure', {
            providerId: provider.id,
            publisher,
            error: error instanceof Error ? error.message : String(error)
          })
          return null
        }
      })
    )

    if (options?.throwOnError && publisherModelGroups.some((g) => g === null)) {
      if (firstPublisherError instanceof Error) {
        throw firstPublisherError
      }
      if (firstPublisherError !== undefined) {
        throw new Error(String(firstPublisherError))
      }
      throw new Error('One or more Vertex AI publisher requests failed')
    }

    const publisherModels = publisherModelGroups.filter((g) => g !== null).flat()

    const listedModels = dedup(publisherModels, (model) => model.name).map((model) => {
      const bareId = getVertexModelId(model.name)
      const ownedBy = getVertexModelPublisher(model.name)
      // MaaS models are served over the OpenAI-compatible endpoint, which requires the
      // `{publisher}/{model}` id form even when Google is the publisher. Native Google
      // models (Gemini/Gemma/embeddings) keep their bare id.
      const publisherModelId = `${ownedBy}/${bareId}`
      const apiModelId = isVertexMaasModelId(publisherModelId) ? publisherModelId : bareId
      return toModel(apiModelId, provider, {
        name: pickPreferredString([model.displayName, bareId]) || bareId,
        description: model.description,
        ownedBy
      })
    })

    // Match against the bare model name (e.g. `gemini-2.0-flash`, `llama-4-scout-…-maas`), not
    // the `provider::model` unique id nor the publisher-prefixed apiModelId — the support
    // patterns are anchored to the model name and would reject either prefixed form.
    const filteredModels = listedModels.filter((model) => {
      const modelId = model.apiModelId ?? ''
      return isSupportedVertexPublisherModel(modelId) && (model.ownedBy === 'google' || isVertexMaasModelId(modelId))
    })

    if (filteredModels.length !== listedModels.length) {
      logger.info('Filtered unsupported Vertex publisher models from model list', {
        providerId: provider.id,
        filteredCount: listedModels.length - filteredModels.length,
        returnedCount: filteredModels.length
      })
    }

    return filteredModels
  }
}

const copilotFetcher: ModelFetcher = {
  match: (p) => matchesPreset(p, SystemProviderIds.copilot),
  fetch: async (provider, signal) => {
    const copilotHeaders = mergeHeaders(COPILOT_DEFAULT_HEADERS, provider.settings.extraHeaders)
    // getToken exchanges the stored GitHub OAuth token for a Copilot session token.
    // It must NOT carry the provider's `Authorization: Bearer <apiKey>` (added by
    // defaultHeaders) — GitHub's token endpoint rejects the conflicting header with 401.
    const { token } = await copilotService.getToken(null as any, copilotHeaders)
    const response = await getFromApi({
      url: `${withoutTrailingSlash(getBaseUrl(provider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS))}/models`,
      headers: mergeHeaders(copilotHeaders, { Authorization: `Bearer ${token}` }),
      responseSchema: CopilotModelsResponseSchema,
      abortSignal: signal
    })

    const filtered = response.data.filter((m) => {
      const modelId = m.id.toLowerCase()
      return (
        m.policy?.state !== 'disabled' &&
        !/^accounts\/[^/]+\/routers\//.test(modelId) &&
        !/^(tts|whisper|speech)/.test(modelId.split('/').pop() || '')
      )
    })

    return dedup(filtered, (m) => m.id).map((m) => toModel(m.id, provider, { ownedBy: m.owned_by }))
  }
}

const ovmsFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.ovms,
  fetch: async (provider, signal) => {
    // The servable-status document lives at /v1/config; the provider's chat base URL points at
    // the OpenAI-compatible /v3 namespace, which has no GET /config. Strip whatever version the
    // host carries so the version below is always the one OVMS actually serves this on.
    const baseUrl = formatApiHost(withoutTrailingApiVersion(getBaseUrl(provider)), true, 'v1')
    const response = await getFromApi({
      url: `${baseUrl}/config`,
      headers: defaultHeaders(provider),
      responseSchema: OVMSConfigResponseSchema,
      abortSignal: signal
    })
    // List every model registered in OVMS config regardless of its server-side
    // loading state (AVAILABLE, LOADING, FAILED_PRECONDITION, etc.).  Users
    // expect downloaded models to appear in the model manager even when OVMS
    // fails to load them server-side — the UI communicates readiness, not OVMS.
    return dedup(Object.entries(response), ([name]) => name).map(([name]) =>
      toModel(name, provider, { ownedBy: 'ovms' })
    )
  }
}

const togetherFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.together,
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: defaultHeaders(provider),
      responseSchema: TogetherModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response, (m) => m.id).map((m) => {
      const pricing = usdPricing({
        input: m.pricing?.input,
        output: m.pricing?.output,
        cacheRead: m.pricing?.cached_input
      })
      return toModel(m.id, provider, {
        name: m.display_name || m.id,
        description: m.description,
        ownedBy: m.organization,
        ...(pricing ? { pricing } : {})
      })
    })
  }
}

type NewApiModelResponseItem = z.infer<typeof NewApiModelsResponseSchema>['data'][number]

const ENDPOINT_TYPE_ALIASES: Record<string, EndpointType> = {
  anthropic: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  embeddings: ENDPOINT_TYPE.OPENAI_EMBEDDINGS,
  gemini: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  'image-edit': ENDPOINT_TYPE.OPENAI_IMAGE_EDIT,
  'image-generation': ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
  'jina-rerank': ENDPOINT_TYPE.JINA_RERANK,
  openai: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  'openai-response': ENDPOINT_TYPE.OPENAI_RESPONSES,
  'openai-response-compact': ENDPOINT_TYPE.OPENAI_RESPONSES,
  'openai-video': ENDPOINT_TYPE.OPENAI_VIDEO_GENERATION
}
const ENDPOINT_TYPE_VALUES = new Set<string>(Object.values(ENDPOINT_TYPE))

function normalizeEndpointTypes(values: string[] | undefined): EndpointType[] | undefined {
  if (!values?.length) {
    return undefined
  }

  const endpointTypes = dedup(
    values
      .map((value) => {
        const normalized = value.trim().toLowerCase()
        return (
          ENDPOINT_TYPE_ALIASES[normalized] ??
          (ENDPOINT_TYPE_VALUES.has(normalized) ? (normalized as EndpointType) : undefined)
        )
      })
      .filter((value): value is EndpointType => Boolean(value)),
    (value) => value
  )

  if (endpointTypes[0] === ENDPOINT_TYPE.OPENAI_EMBEDDINGS) {
    const chatEndpoint = endpointTypes.find((endpointType) => endpointImpliedCapability(endpointType) === undefined)
    if (chatEndpoint) {
      return [chatEndpoint, ...endpointTypes.filter((endpointType) => endpointType !== chatEndpoint)]
    }
  }

  return endpointTypes.length > 0 ? endpointTypes : undefined
}

function buildNewApiModels(
  provider: Provider,
  models: NewApiModelResponseItem[],
  pricingByModel: Map<string, Model['pricing']> = new Map(),
  missingPricing?: Model['pricing']
): Partial<Model>[] {
  return dedup(models, (model) => model.id).map((model) => {
    const endpointTypes = normalizeEndpointTypes(model.supported_endpoint_types)
    const impliedCapability = endpointImpliedCapability(endpointTypes?.[0])
    const pricing = pricingByModel.get(model.id) ?? missingPricing

    return toModel(model.id, provider, {
      ownedBy: model.owned_by,
      endpointTypes,
      ...(pricing ? { pricing } : {}),
      ...(impliedCapability ? { capabilities: [impliedCapability] } : {})
    })
  })
}

const newApiFetcher: ModelFetcher = {
  match: (provider) => provider.modelListApi?.type === 'new-api',
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const headers = defaultHeaders(provider)
    const pricingRequest = provider.modelListApi?.supportsPricing
      ? getFromApi({
          url: `${withoutTrailingSlash(getBaseUrl(provider)).replace(/\/v1$/, '')}/api/pricing`,
          headers,
          responseSchema: NewApiPricingResponseSchema,
          abortSignal: signal
        })
          .then((data) => ({ data, available: true }))
          .catch((error) => ({
            data: recoverOptionalModelListFailure<NewApiPricingItem>(error, {
              providerId: provider.id,
              endpoint: 'new-api-pricing'
            }),
            available: false
          }))
      : Promise.resolve({ data: { data: [] }, available: false })
    const [response, pricingResult] = await Promise.all([
      getFromApi({
        url: `${baseUrl}/models`,
        headers,
        responseSchema: NewApiModelsResponseSchema,
        abortSignal: signal
      }),
      pricingRequest
    ])
    const pricingResponse = pricingResult.data
    const groupMultiplier = newApiGroupMultiplier(pricingResponse)
    const hasAmbiguousCredential = provider.apiKeys.filter((key) => key.isEnabled).length > 1
    const pricingByModel = hasAmbiguousCredential
      ? new Map<string, Model['pricing']>()
      : new Map(pricingResponse.data.map((entry) => [entry.model_name, newApiPricing(entry, groupMultiplier)]))
    const missingPricing = pricingResult.available ? unknownUsdPricing() : undefined
    return buildNewApiModels(provider, response.data, pricingByModel, missingPricing)
  }
}

const openRouterFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.openrouter,
  fetch: async (provider, signal, options) => {
    const headers = defaultHeaders(provider)
    const modelsApiUrls = provider.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.modelsApiUrls
    const [modelsResponse, embedModelsResponse, imageModelsResponse] = await Promise.all([
      getFromApi({
        url: modelsApiUrls?.default ?? 'https://openrouter.ai/api/v1/models',
        headers,
        responseSchema: OpenRouterModelsResponseSchema,
        abortSignal: signal
      }),
      getFromApi({
        url: modelsApiUrls?.embedding ?? 'https://openrouter.ai/api/v1/embeddings/models',
        headers,
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }).catch((error) =>
        handleOptionalModelListFailure<OpenAIModelResponseItem>(error, options, {
          providerId: provider.id,
          endpoint: 'openrouter-embedding-models'
        })
      ),
      getFromApi({
        url: modelsApiUrls?.image ?? 'https://openrouter.ai/api/v1/images/models',
        headers,
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }).catch((error) =>
        recoverOptionalModelListFailure<OpenAIModelResponseItem>(error, {
          providerId: provider.id,
          endpoint: 'openrouter-image-models'
        })
      )
    ])
    const imageModelsById = new Map(imageModelsResponse.data.map((model) => [model.id, model]))
    // Only the chat listing quotes rates; the embedding/image listings share the plain OpenAI shape.
    const pricingById = new Map(
      modelsResponse.data.map((model) => [
        model.id,
        usdPricing({
          input: perMillion(model.pricing?.prompt),
          output: perMillion(model.pricing?.completion),
          cacheRead: perMillion(model.pricing?.input_cache_read),
          cacheWrite: perMillion(model.pricing?.input_cache_write)
        })
      ])
    )
    const all = [...modelsResponse.data, ...embedModelsResponse.data, ...imageModelsResponse.data]
    return dedup(all, (m) => m.id).map((m) => {
      const imageModel = imageModelsById.get(m.id)
      const pricing = pricingById.get(m.id)
      return toModel(m.id, provider, {
        name: imageModel?.name ?? m.name,
        ownedBy: m.owned_by,
        ...(pricing ? { pricing } : {}),
        ...(imageModel
          ? {
              capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
              endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
            }
          : {})
      })
    })
  }
}

const ppioFetcher: ModelFetcher = {
  match: (provider) => matchesPreset(provider, SystemProviderIds.ppio),
  fetch: async (provider, signal, options) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const headers = defaultHeaders(provider)
    const [chat, embed, reranker] = await Promise.all([
      getFromApi({
        url: `${baseUrl}/models`,
        headers,
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }),
      getFromApi({
        url: `${baseUrl}/models?model_type=embedding`,
        headers,
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }).catch((error) =>
        handleOptionalModelListFailure<OpenAIModelResponseItem>(error, options, {
          providerId: provider.id,
          endpoint: 'ppio-embedding-models'
        })
      ),
      getFromApi({
        url: `${baseUrl}/models?model_type=reranker`,
        headers,
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }).catch((error) =>
        handleOptionalModelListFailure<OpenAIModelResponseItem>(error, options, {
          providerId: provider.id,
          endpoint: 'ppio-reranker-models'
        })
      )
    ])
    const modelsById = new Map<string, Partial<Model>>()
    const mergeModel = (model: OpenAIModelResponseItem, capability?: (typeof MODEL_CAPABILITY.RERANK)[]) => {
      const id = model.id?.trim()
      if (!id) return
      const pricing = ppioModelPricing(model)

      const existing = modelsById.get(id)
      if (!existing) {
        modelsById.set(
          id,
          toModel(id, provider, {
            ownedBy: model.owned_by,
            capabilities: capability ?? [],
            ...(pricing ? { pricing } : {})
          })
        )
        return
      }

      if (capability) {
        existing.capabilities = Array.from(new Set([...(existing.capabilities ?? []), ...capability]))
      }
      if (pricing && !existing.pricing) existing.pricing = pricing
    }

    for (const model of chat.data) mergeModel(model)
    for (const model of embed.data) mergeModel(model)
    for (const model of reranker.data) mergeModel(model, [MODEL_CAPABILITY.RERANK])

    return Array.from(modelsById.values())
  }
}

const aiHubMixFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.aihubmix,
  fetch: async (provider, signal) => {
    const response = await getFromApi({
      url: `${withoutTrailingSlash(getBaseUrl(provider)).replace(/\/v1$/, '')}/api/v1/models`,
      headers: defaultHeaders(provider),
      responseSchema: AIHubMixModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.model_id).map((m) => {
      const pricing = usdPricing({
        input: m.pricing?.input,
        output: m.pricing?.output,
        cacheRead: m.pricing?.cache_read,
        cacheWrite: m.pricing?.cache_write
      })
      return toModel(m.model_id, provider, {
        name: m.model_name || m.model_id,
        description: m.desc,
        ...(pricing ? { pricing } : {})
      })
    })
  }
}

/** Vercel AI Gateway publishes its current catalog and rates at the unauthenticated /v1/models endpoint. */
const gatewayFetcher: ModelFetcher = {
  match: (p) => isAIGatewayProvider(p),
  fetch: async (provider, signal) => {
    const response = await getFromApi({
      url: `https://ai-gateway.vercel.sh/v1/models`,
      responseSchema: VercelGatewayModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.id).map((m) => {
      const pricing = vercelGatewayPricing(m.pricing, m.type)
      return toModel(m.id, provider, {
        name: m.name || m.id,
        description: m.description,
        ownedBy: m.owned_by,
        ...(pricing ? { pricing } : {})
      })
    })
  }
}

const EXCLUDED_OPENAI_MODEL_KEYWORDS = ['tts', 'whisper', 'transcribe', 'speech', 'audio', 'realtime', 'sora'] as const

function isSupportedOpenAIModel(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return !EXCLUDED_OPENAI_MODEL_KEYWORDS.some((keyword) => id.includes(keyword))
}

// Anthropic authenticates model listing with `x-api-key` + `anthropic-version`, not
// `Authorization: Bearer` — the generic OpenAI fetcher's Bearer header would 401. `/v1/models`
// only returns chat models (no audio/tts), and `limit` maxes at 1000, well above the catalog
// size, so a single page covers it.
const ANTHROPIC_VERSION = '2023-06-01'

const anthropicFetcher: ModelFetcher = {
  match: (p) => matchesPreset(p, SystemProviderIds.anthropic),
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const apiKey = providerService.getRotatedApiKey(provider.id)
    const response = await getFromApi({
      url: `${baseUrl}/models?limit=1000`,
      headers: mergeHeaders(
        defaultAppHeaders(),
        { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        provider.settings?.extraHeaders
      ),
      responseSchema: AnthropicModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.id).map((m) =>
      toModel(m.id, provider, { name: m.display_name || m.id, ownedBy: 'anthropic' })
    )
  }
}

const jinaFetcher: ModelFetcher = {
  match: (p) => matchesPreset(p, SystemProviderIds.jina),
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: defaultHeaders(provider),
      responseSchema: OpenAIModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.id).map((m) => {
      const apiModelId = m.id.replace(/^jina-ai\//, '')
      const pricing = openAITokenPricing(m.pricing, CURRENCY.USD)
      return toModel(apiModelId, provider, {
        name: m.name || apiModelId,
        ownedBy: m.owned_by,
        ...(pricing ? { pricing } : {})
      })
    })
  }
}

type OpenAICompatiblePricing = (model: OpenAIModelResponseItem) => Model['pricing'] | undefined

function createOpenAICompatibleFetcher(
  match: ModelFetcher['match'],
  resolvePricing?: OpenAICompatiblePricing
): ModelFetcher {
  return {
    match,
    fetch: async (provider, signal) => {
      const baseUrl = formatApiHost(getBaseUrl(provider))
      const response = await getFromApi({
        url: `${baseUrl}/models`,
        headers: defaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      })
      return dedup(response.data, (model) => model.id).map((model) => {
        const pricing = resolvePricing?.(model)
        return toModel(model.id, provider, {
          name: model.name || model.id,
          ownedBy: model.owned_by,
          ...(pricing ? { pricing } : {})
        })
      })
    }
  }
}

const baiduCloudFetcher = createOpenAICompatibleFetcher(
  (provider) => matchesPreset(provider, SystemProviderIds['baidu-cloud']),
  baiduModelPricing
)

const lanyunFetcher = createOpenAICompatibleFetcher(
  (provider) => matchesPreset(provider, SystemProviderIds.lanyun),
  lanyunModelPricing
)

const huggingFaceFetcher = createOpenAICompatibleFetcher(
  (provider) => matchesPreset(provider, SystemProviderIds.huggingface),
  huggingFaceModelPricing
)

const sophnetFetcher = createOpenAICompatibleFetcher(
  (provider) => matchesPreset(provider, SystemProviderIds.sophnet),
  (model) => openAITokenPricing(model.pricing, CURRENCY.CNY)
)

const poeFetcher = createOpenAICompatibleFetcher(
  (provider) => matchesPreset(provider, SystemProviderIds.poe),
  (model) =>
    model.pricing === undefined ? undefined : (openAITokenPricing(model.pricing, CURRENCY.USD) ?? unknownUsdPricing())
)

const openAIFetcher: ModelFetcher = {
  match: (p) => matchesPreset(p, SystemProviderIds.openai),
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: defaultHeaders(provider),
      responseSchema: OpenAIModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.id)
      .filter((m) => isSupportedOpenAIModel(m.id))
      .map((m) => toModel(m.id, provider, { ownedBy: m.owned_by }))
  }
}

const openAICompatibleFetcher = createOpenAICompatibleFetcher(() => true)

// ── Ollama probe ──

/** Lightweight model-existence check for Ollama — avoids loading the model into memory. */
export async function probeOllamaModel(
  provider: Provider,
  modelApiId: string | undefined,
  signal?: AbortSignal,
  apiKeyOverride?: string
): Promise<{ latency: number }> {
  const start = performance.now()
  const baseUrl = formatOllamaApiHost(getBaseUrl(provider))
  const resolved = providerService.resolveApiKey(provider.id, apiKeyOverride)
  const headers = mergeHeaders(defaultAppHeaders(), getExtraHeaders(provider), {
    'Content-Type': 'application/json',
    ...(resolved.value ? { Authorization: `Bearer ${resolved.value}`, 'X-Api-Key': resolved.value } : {})
  })
  const response = await fetch(`${baseUrl}/show`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: modelApiId ?? '' }),
    signal
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: string; message?: string } | undefined
    throw new Error(body?.error ?? body?.message ?? `Ollama /api/show returned ${response.status}`)
  }
  return { latency: performance.now() - start }
}

// ── Registry (order matters: first match wins) ──

const fetchers: ModelFetcher[] = [
  aiHubMixFetcher,
  ollamaFetcher,
  geminiFetcher,
  vertexFetcher,
  copilotFetcher,
  ovmsFetcher,
  togetherFetcher,
  newApiFetcher,
  openRouterFetcher,
  ppioFetcher,
  gatewayFetcher,
  anthropicFetcher,
  jinaFetcher,
  baiduCloudFetcher,
  lanyunFetcher,
  huggingFaceFetcher,
  sophnetFetcher,
  poeFetcher,
  openAIFetcher,
  openAICompatibleFetcher // always-match fallback, must be last
]

// ── Public API ──

export async function listModels(
  provider: Provider,
  abortSignal?: AbortSignal,
  options?: { throwOnError?: boolean }
): Promise<Partial<Model>[]> {
  try {
    const fetcher = fetchers.find((f) => f.match(provider))!
    return await fetcher.fetch(provider, abortSignal, options)
  } catch (error) {
    logger.error('Error listing models', { providerId: provider.id, errorType: getErrorType(error) })
    if (options?.throwOnError) {
      throw error
    }
    return []
  }
}
