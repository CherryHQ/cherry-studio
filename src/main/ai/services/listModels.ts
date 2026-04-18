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
import type { Model } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { defaultAppHeaders } from '@shared/utils'
import { formatApiHost } from '@shared/utils/api'
import { withoutTrailingSlash } from '@shared/utils/api/utils'
import { isAIGatewayProvider, isGeminiProvider, isOllamaProvider } from '@shared/utils/provider'
import { SystemProviderIds } from '@types'
import * as z from 'zod'

import { defaultHeaders, getBaseUrl } from '../utils/provider'
import {
  AIHubMixModelsResponseSchema,
  GeminiModelsResponseSchema,
  GitHubModelsResponseSchema,
  NewApiModelsResponseSchema,
  OllamaTagsResponseSchema,
  OpenAIModelsResponseSchema,
  OVMSConfigResponseSchema,
  TogetherModelsResponseSchema
} from './schemas'

const logger = loggerService.withContext('ModelListService')

// ── Types ──

type ModelFetcher = {
  match: (provider: Provider) => boolean
  fetch: (provider: Provider, signal?: AbortSignal) => Promise<Partial<Model>[]>
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
  fetch: async (provider, signal) => {
    const baseUrl = withoutTrailingSlash(getBaseUrl(provider))
      .replace(/\/v1$/, '')
      .replace(/\/api$/, '')
    const response = await getFromApi({
      url: `${baseUrl}/api/tags`,
      headers: await defaultHeaders(provider),
      responseSchema: OllamaTagsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.models, (m) => m.name).map((m) => toModel(m.name, provider, { ownedBy: 'ollama' }))
  }
}

const geminiFetcher: ModelFetcher = {
  match: (p) => isGeminiProvider(p),
  fetch: async (provider, signal) => {
    let baseUrl = withoutTrailingSlash(getBaseUrl(provider))
    baseUrl = baseUrl.replace(/\/v1(beta)?$/, '')
    const apiKey = await providerService.getRotatedApiKey(provider.id)
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

const githubFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.github,
  fetch: async (provider, signal) => {
    const headers = await defaultHeaders(provider)
    const catalogResponse = await getFromApi({
      url: 'https://models.github.ai/catalog/models',
      headers,
      responseSchema: GitHubModelsResponseSchema,
      abortSignal: signal
    })
    const catalogModels = catalogResponse.map((m) =>
      toModel(m.id, provider, {
        name: m.name || m.id,
        description: pickPreferredString([m.summary, m.description]),
        ownedBy: m.publisher
      })
    )
    return dedup(catalogModels, (m) => m.apiModelId)
  }
}

const ovmsFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.ovms,
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(withoutTrailingSlash(getBaseUrl(provider)).replace(/\/v1$/, ''), true, 'v1')
    const response = await getFromApi({
      url: `${baseUrl}/config`,
      headers: await defaultHeaders(provider),
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
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: await defaultHeaders(provider),
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
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: await defaultHeaders(provider),
      responseSchema: NewApiModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.id).map((m) => toModel(m.id, provider, { ownedBy: m.owned_by }))
  }
}

const openRouterFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.openrouter,
  fetch: async (provider, signal) => {
    const headers = await defaultHeaders(provider)
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
      }).catch(() => ({ data: [] }))
    ])
    const all = [...modelsResponse.data, ...embedModelsResponse.data]
    return dedup(all, (m) => m.id).map((m) => toModel(m.id, provider, { ownedBy: m.owned_by }))
  }
}

const ppioFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.ppio,
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const headers = await defaultHeaders(provider)
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
      }).catch(() => ({ data: [] })),
      getFromApi({
        url: `${baseUrl}/models?model_type=reranker`,
        headers,
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }).catch(() => ({ data: [] }))
    ])
    const all = [...chat.data, ...embed.data, ...reranker.data]
    return dedup(all, (m) => m.id).map((m) => toModel(m.id, provider, { ownedBy: m.owned_by }))
  }
}

const aiHubMixFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.aihubmix,
  fetch: async (provider, signal) => {
    const response = await getFromApi({
      url: `https://aihubmix.com/api/v1/models`,
      headers: await defaultHeaders(provider),
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

const openAICompatibleFetcher: ModelFetcher = {
  match: () => true,
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(getBaseUrl(provider))
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: await defaultHeaders(provider),
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
  githubFetcher,
  ovmsFetcher,
  togetherFetcher,
  newApiFetcher,
  openRouterFetcher,
  ppioFetcher,
  openAICompatibleFetcher // always-match fallback, must be last
]

const UNSUPPORTED_PROVIDERS = new Set<string>([SystemProviderIds['aws-bedrock'], SystemProviderIds.anthropic])

function isUnsupported(provider: Provider): boolean {
  return (
    isAIGatewayProvider(provider) ||
    UNSUPPORTED_PROVIDERS.has(provider.id) ||
    provider.presetProviderId === 'vertex-anthropic'
  )
}

// ── Public API ──

export async function listModels(provider: Provider, abortSignal?: AbortSignal): Promise<Partial<Model>[]> {
  try {
    if (isUnsupported(provider)) {
      logger.warn('Provider does not support model listing', { providerId: provider.id })
      return []
    }

    const fetcher = fetchers.find((f) => f.match(provider))!
    return await fetcher.fetch(provider, abortSignal)
  } catch (error) {
    logger.error('Error listing models', error as Error, { providerId: provider.id })
    return []
  }
}
