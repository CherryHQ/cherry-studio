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
  zodSchema
} from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { providerService } from '@main/data/services/ProviderService'
import { copilotService } from '@main/services/CopilotService'
import type { Model } from '@shared/data/types/model'
import { createUniqueModelId, ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { defaultAppHeaders } from '@shared/utils'
import { formatApiHost } from '@shared/utils/api'
import { withoutTrailingSlash } from '@shared/utils/api/utils'
import { isAIGatewayProvider, isGeminiProvider, isOllamaProvider, isVertexProvider } from '@shared/utils/provider'
import { SystemProviderIds } from '@types'
import * as z from 'zod'

import { defaultHeaders, getBaseUrl } from '../utils/provider'
import { COPILOT_DEFAULT_HEADERS } from './constants'
import {
  createVertexModelListRequest,
  DEFAULT_VERTEX_MODEL_PUBLISHERS,
  getVertexModelId,
  getVertexModelPublisher,
  isSupportedVertexPublisherModel
} from './listModels/vertex'
import {
  AIHubMixModelsResponseSchema,
  CopilotModelsResponseSchema,
  GeminiModelsResponseSchema,
  GitHubModelsResponseSchema,
  NewApiModelsResponseSchema,
  OllamaTagsResponseSchema,
  OpenAIModelsResponseSchema,
  OVMSConfigResponseSchema,
  TogetherModelsResponseSchema,
  VercelGatewayModelsResponseSchema,
  VertexPublisherModelsResponseSchema
} from './listModelsSchemas'

const logger = loggerService.withContext('ModelListService')

// ── Types ──

type ModelFetcher = {
  match: (provider: Provider) => boolean
  fetch: (provider: Provider, signal?: AbortSignal, options?: ModelListOptions) => Promise<Partial<Model>[]>
}

interface ModelListOptions {
  throwOnError?: boolean
  apiKeyOverride?: string
}

function handleOptionalModelListFailure<T>(
  error: unknown,
  options: ModelListOptions | undefined,
  context: Record<string, string>
): { data: T[] } {
  if (options?.throwOnError) {
    throw error
  }

  logger.warn('Optional model list endpoint failed; continuing with primary models', {
    ...context,
    error
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
  const parts = modelId.split('/')
  return parts.length > 1 ? parts[0] : providerId
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

const ollamaFetcher: ModelFetcher = {
  match: (p) => isOllamaProvider(p),
  fetch: async (provider, signal, options) => {
    const baseUrl = withoutTrailingSlash(getBaseUrl(provider))
      .replace(/\/v1$/, '')
      .replace(/\/api$/, '')
    const response = await getFromApi({
      url: `${baseUrl}/api/tags`,
      headers: await defaultHeaders(provider, options?.apiKeyOverride),
      responseSchema: OllamaTagsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.models, (m) => m.name).map((m) => toModel(m.name, provider, { ownedBy: 'ollama' }))
  }
}

const geminiFetcher: ModelFetcher = {
  match: (p) => isGeminiProvider(p),
  fetch: async (provider, signal, options) => {
    let baseUrl = withoutTrailingSlash(getBaseUrl(provider))
    baseUrl = baseUrl.replace(/\/v1(beta)?$/, '')
    const apiKey = options?.apiKeyOverride ?? (await providerService.getRotatedApiKey(provider.id))
    const response = await getFromApi({
      url: `${baseUrl}/v1beta/models?key=${apiKey}`,
      headers: { ...defaultAppHeaders(), ...provider.settings?.extraHeaders },
      responseSchema: GeminiModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.models, (m) => m.name).map((m) => {
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

    if (!request) {
      return []
    }

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
      const id = getVertexModelId(model.name)
      const ownedBy = getVertexModelPublisher(model.name)
      return toModel(id, provider, {
        name: pickPreferredString([model.displayName, id]) || id,
        description: model.description,
        ownedBy
      })
    })

    const filteredModels = listedModels.filter((model) => isSupportedVertexPublisherModel(model.id ?? ''))

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

const githubFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.github,
  fetch: async (provider, signal, options) => {
    const headers = await defaultHeaders(provider, options?.apiKeyOverride)
    const [catalogResponse, v1Response] = await Promise.all([
      getFromApi({
        url: 'https://models.github.ai/catalog/models',
        headers,
        responseSchema: GitHubModelsResponseSchema,
        abortSignal: signal
      }),
      getFromApi({
        url: 'https://models.github.ai/v1/models',
        headers,
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }).catch((error) =>
        handleOptionalModelListFailure<OpenAIModelResponseItem>(error, options, {
          providerId: provider.id,
          endpoint: 'github-v1-models'
        })
      )
    ])
    const catalogModels = catalogResponse.map((m) =>
      toModel(m.id, provider, {
        name: m.name || m.id,
        description: pickPreferredString([m.summary, m.description]),
        ownedBy: m.publisher
      })
    )
    const v1Models = v1Response.data.map((m) => toModel(m.id, provider, { ownedBy: m.owned_by }))
    return dedup([...catalogModels, ...v1Models], (m) => m.apiModelId)
  }
}

const copilotFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.copilot,
  fetch: async (provider, signal, options) => {
    const headers = {
      ...COPILOT_DEFAULT_HEADERS,
      ...(await defaultHeaders(provider, options?.apiKeyOverride)),
      ...provider.settings.extraHeaders
    }
    const { token } = await copilotService.getToken(null as any, headers)
    const response = await getFromApi({
      url: `${withoutTrailingSlash(getBaseUrl(provider, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS))}/models`,
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`
      },
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
  fetch: async (provider, signal, options) => {
    const baseUrl = formatApiHost(withoutTrailingSlash(getBaseUrl(provider)).replace(/\/v1$/, ''), true, 'v1')
    const response = await getFromApi({
      url: `${baseUrl}/config`,
      headers: await defaultHeaders(provider, options?.apiKeyOverride),
      responseSchema: OVMSConfigResponseSchema,
      abortSignal: signal
    })
    const entries = Object.entries(response).filter(([, info]) =>
      info?.model_version_status?.some((v) => v?.state === 'AVAILABLE')
    )
    return dedup(entries, ([name]) => name).map(([name]) => toModel(name, provider, { ownedBy: 'ovms' }))
  }
}

const togetherFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.together,
  fetch: async (provider, signal, options) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: await defaultHeaders(provider, options?.apiKeyOverride),
      responseSchema: TogetherModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response, (m) => m.id).map((m) =>
      toModel(m.id, provider, {
        name: m.display_name || m.id,
        description: m.description,
        ownedBy: m.organization
      })
    )
  }
}

const newApiFetcher: ModelFetcher = {
  match: (p) =>
    p.id === SystemProviderIds['new-api'] || p.presetProviderId === 'new-api' || p.id === SystemProviderIds.cherryin,
  fetch: async (provider, signal, options) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: await defaultHeaders(provider, options?.apiKeyOverride),
      responseSchema: NewApiModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.id).map((m) => toModel(m.id, provider, { ownedBy: m.owned_by }))
  }
}

const openRouterFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.openrouter,
  fetch: async (provider, signal, options) => {
    const headers = await defaultHeaders(provider, options?.apiKeyOverride)
    const [modelsResponse, embedModelsResponse] = await Promise.all([
      getFromApi({
        url: 'https://openrouter.ai/api/v1/models',
        headers,
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }),
      getFromApi({
        url: 'https://openrouter.ai/api/v1/embeddings/models',
        headers,
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }).catch((error) =>
        handleOptionalModelListFailure<OpenAIModelResponseItem>(error, options, {
          providerId: provider.id,
          endpoint: 'openrouter-embedding-models'
        })
      )
    ])
    const all = [...modelsResponse.data, ...embedModelsResponse.data]
    return dedup(all, (m) => m.id).map((m) => toModel(m.id, provider, { ownedBy: m.owned_by }))
  }
}

const ppioFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.ppio,
  fetch: async (provider, signal, options) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const headers = await defaultHeaders(provider, options?.apiKeyOverride)
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
    const all = [...chat.data, ...embed.data, ...reranker.data]
    return dedup(all, (m) => m.id).map((m) => toModel(m.id, provider, { ownedBy: m.owned_by }))
  }
}

const aiHubMixFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.aihubmix,
  fetch: async (provider, signal, options) => {
    const response = await getFromApi({
      url: `https://aihubmix.com/api/v1/models`,
      headers: await defaultHeaders(provider, options?.apiKeyOverride),
      responseSchema: AIHubMixModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.model_id).map((m) =>
      toModel(m.model_id, provider, {
        name: m.model_name || m.model_id,
        description: m.desc
      })
    )
  }
}

/** Vercel AI Gateway: hits /v3/ai/config directly with `ai-gateway-protocol-version` header
 *  instead of going through `@ai-sdk/gateway`'s `getAvailableModels()`. The SDK validates the
 *  response against a strict schema that breaks whenever Vercel evolves the registry, so we
 *  parse with `z.looseObject` here to keep listing resilient. Inference still uses the SDK. */
const gatewayFetcher: ModelFetcher = {
  match: (p) => isAIGatewayProvider(p),
  fetch: async (provider, signal, options) => {
    const response = await getFromApi({
      url: `https://ai-gateway.vercel.sh/v3/ai/config`,
      headers: {
        ...(await defaultHeaders(provider, options?.apiKeyOverride)),
        'ai-gateway-protocol-version': '0.0.1'
      },
      responseSchema: VercelGatewayModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.models, (m) => m.id).map((m) =>
      toModel(m.id, provider, {
        name: m.name || m.id,
        description: m.description,
        ownedBy: m.specification?.provider
      })
    )
  }
}

const openAICompatibleFetcher: ModelFetcher = {
  match: () => true,
  fetch: async (provider, signal, options) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: await defaultHeaders(provider, options?.apiKeyOverride),
      responseSchema: OpenAIModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.id).map((m) => toModel(m.id, provider, { ownedBy: m.owned_by }))
  }
}

// ── Registry (order matters: first match wins) ──

const fetchers: ModelFetcher[] = [
  aiHubMixFetcher,
  ollamaFetcher,
  geminiFetcher,
  vertexFetcher,
  githubFetcher,
  copilotFetcher,
  ovmsFetcher,
  togetherFetcher,
  newApiFetcher,
  openRouterFetcher,
  ppioFetcher,
  gatewayFetcher,
  openAICompatibleFetcher // always-match fallback, must be last
]

const UNSUPPORTED_PROVIDERS = new Set<string>([SystemProviderIds['aws-bedrock'], SystemProviderIds.anthropic])

function isUnsupported(provider: Provider): boolean {
  return UNSUPPORTED_PROVIDERS.has(provider.id) || provider.presetProviderId === 'vertex-anthropic'
}

// ── Public API ──

export async function listModels(
  provider: Provider,
  abortSignal?: AbortSignal,
  options?: ModelListOptions
): Promise<Partial<Model>[]> {
  try {
    if (isUnsupported(provider)) {
      logger.warn('Provider does not support model listing via listModels', { providerId: provider.id })
      if (options?.throwOnError) {
        throw new Error(`Provider does not support model listing: ${provider.id}`)
      }
      return []
    }

    const fetcher = fetchers.find((f) => f.match(provider))!
    return await fetcher.fetch(provider, abortSignal, options)
  } catch (error) {
    logger.error('Error listing models:', error as Error, { providerId: provider.id })
    if (options?.throwOnError) {
      throw error
    }
    return []
  }
}
