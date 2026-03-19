/**
 * ModelListService - Unified model listing service
 * Uses Strategy Registry pattern for provider-specific model fetching
 */

import {
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  getFromApi as aiSdkGetFromApi,
  zodSchema
} from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import type { EndpointType, Model, Provider } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { formatApiHost, withoutTrailingSlash } from '@renderer/utils'
import { isAIGatewayProvider, isGeminiProvider, isOllamaProvider } from '@renderer/utils/provider'
import { defaultAppHeaders } from '@shared/utils'
import * as z from 'zod'

import {
  GeminiModelsResponseSchema,
  GitHubModelsResponseSchema,
  NewApiModelsResponseSchema,
  OllamaTagsResponseSchema,
  OpenAIModelsResponseSchema,
  OVMSConfigResponseSchema,
  TogetherModelsResponseSchema
} from './schemas'

const logger = loggerService.withContext('ModelListService')

// === Types ===

type ModelFetcher = {
  match: (provider: Provider) => boolean
  fetch: (provider: Provider, signal?: AbortSignal) => Promise<Model[]>
}

// === API Layer ===

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

// === Helpers ===

function getApiKey(provider: Provider): string {
  const keys = provider.apiKey.split(',').map((key) => key.trim())
  const keyName = `provider:${provider.id}:last_used_key`

  if (keys.length === 1) {
    return keys[0]
  }

  const lastUsedKey = window.keyv.get(keyName)
  if (!lastUsedKey) {
    window.keyv.set(keyName, keys[0])
    return keys[0]
  }

  const currentIndex = keys.indexOf(lastUsedKey)
  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]
  window.keyv.set(keyName, nextKey)

  return nextKey
}

function defaultHeaders(provider: Provider): Record<string, string> {
  return {
    ...defaultAppHeaders(),
    Authorization: `Bearer ${getApiKey(provider)}`,
    'X-Api-Key': getApiKey(provider),
    ...provider.extra_headers
  }
}

function defaultGroup(modelId: string, providerId: string): string {
  const parts = modelId.split('/')
  return parts.length > 1 ? parts[0] : providerId
}

function toModel(id: string, provider: Provider, extra?: Partial<Model>): Model {
  return {
    id,
    name: extra?.name || id,
    provider: provider.id,
    group: extra?.group || defaultGroup(id, provider.id),
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
      if (trimmed.length > 0) {
        return trimmed
      }
    }
  }
  return undefined
}

// === Fetchers ===

const ollamaFetcher: ModelFetcher = {
  match: (p) => isOllamaProvider(p),
  fetch: async (provider, signal) => {
    const baseUrl = withoutTrailingSlash(provider.apiHost)
      .replace(/\/v1$/, '')
      .replace(/\/api$/, '')
    const response = await getFromApi({
      url: `${baseUrl}/api/tags`,
      headers: defaultHeaders(provider),
      responseSchema: OllamaTagsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.models, (m) => m.name).map((m) => toModel(m.name, provider, { owned_by: 'ollama' }))
  }
}

const geminiFetcher: ModelFetcher = {
  match: (p) => isGeminiProvider(p),
  fetch: async (provider, signal) => {
    let baseUrl = withoutTrailingSlash(provider.apiHost)
    baseUrl = baseUrl.replace(/\/v1(beta)?$/, '')
    const apiVersion = provider.apiVersion || 'v1beta'
    const response = await getFromApi({
      url: `${baseUrl}/${apiVersion}/models?key=${getApiKey(provider)}`,
      headers: { ...defaultAppHeaders(), ...provider.extra_headers },
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
    const response = await getFromApi({
      url: 'https://models.github.ai/catalog/',
      headers: defaultHeaders(provider),
      responseSchema: GitHubModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response, (m) => m.id).map((m) =>
      toModel(m.id, provider, {
        name: m.name || m.id,
        description: pickPreferredString([m.summary, m.description]),
        owned_by: m.publisher
      })
    )
  }
}

const ovmsFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.ovms,
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(withoutTrailingSlash(provider.apiHost).replace(/\/v1$/, ''), true, 'v1')
    const response = await getFromApi({
      url: `${baseUrl}/config`,
      headers: defaultHeaders(provider),
      responseSchema: OVMSConfigResponseSchema,
      abortSignal: signal
    })
    const entries = Object.entries(response).filter(([, info]) =>
      info?.model_version_status?.some((v) => v?.state === 'AVAILABLE')
    )
    return dedup(entries, ([name]) => name).map(([name]) => toModel(name, provider, { owned_by: 'ovms' }))
  }
}

const togetherFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.together,
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(provider.apiHost)
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: defaultHeaders(provider),
      responseSchema: TogetherModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response, (m) => m.id).map((m) =>
      toModel(m.id, provider, {
        name: m.display_name || m.id,
        description: m.description,
        owned_by: m.organization
      })
    )
  }
}

const newApiFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds['new-api'] || p.type === 'new-api',
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(provider.apiHost)
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: defaultHeaders(provider),
      responseSchema: NewApiModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.id).map((m) =>
      toModel(m.id, provider, {
        owned_by: m.owned_by,
        supported_endpoint_types: m.supported_endpoint_types as EndpointType[] | undefined
      })
    )
  }
}

const openRouterFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.openrouter,
  fetch: async (provider, signal) => {
    const [modelsResponse, embedModelsResponse] = await Promise.all([
      getFromApi({
        url: 'https://openrouter.ai/api/v1/models',
        headers: defaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }),
      getFromApi({
        url: 'https://openrouter.ai/api/v1/embeddings/models',
        headers: defaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }).catch(() => ({ data: [] }))
    ])
    const all = [...modelsResponse.data, ...embedModelsResponse.data]
    return dedup(all, (m) => m.id).map((m) => toModel(m.id, provider, { owned_by: m.owned_by }))
  }
}

const ppioFetcher: ModelFetcher = {
  match: (p) => p.id === SystemProviderIds.ppio,
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(provider.apiHost)
    const [chat, embed, reranker] = await Promise.all([
      getFromApi({
        url: `${baseUrl}/models`,
        headers: defaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }),
      getFromApi({
        url: `${baseUrl}/models?model_type=embedding`,
        headers: defaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }).catch(() => ({ data: [] })),
      getFromApi({
        url: `${baseUrl}/models?model_type=reranker`,
        headers: defaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal: signal
      }).catch(() => ({ data: [] }))
    ])
    const all = [...chat.data, ...embed.data, ...reranker.data]
    return dedup(all, (m) => m.id).map((m) => toModel(m.id, provider, { owned_by: m.owned_by }))
  }
}

/** Default fallback: OpenAI-compatible /models endpoint */
const openAICompatibleFetcher: ModelFetcher = {
  match: () => true,
  fetch: async (provider, signal) => {
    const baseUrl = formatApiHost(provider.apiHost)
    const response = await getFromApi({
      url: `${baseUrl}/models`,
      headers: defaultHeaders(provider),
      responseSchema: OpenAIModelsResponseSchema,
      abortSignal: signal
    })
    return dedup(response.data, (m) => m.id).map((m) => toModel(m.id, provider, { owned_by: m.owned_by }))
  }
}

// === Registry (order matters: first match wins) ===

const fetchers: ModelFetcher[] = [
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

// === Unsupported providers (skip before registry lookup) ===

const UNSUPPORTED_PROVIDERS = new Set<string>([SystemProviderIds['aws-bedrock'], SystemProviderIds.anthropic])

function isUnsupported(provider: Provider): boolean {
  return isAIGatewayProvider(provider) || UNSUPPORTED_PROVIDERS.has(provider.id) || provider.type === 'vertex-anthropic'
}

// === Public API ===

export async function listModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
  try {
    if (isUnsupported(provider)) {
      logger.warn('Provider does not support model listing via listModels', { providerId: provider.id })
      return []
    }

    const fetcher = fetchers.find((f) => f.match(provider))!
    return await fetcher.fetch(provider, abortSignal)
  } catch (error) {
    logger.error('Error listing models:', error as Error, { providerId: provider.id })
    return []
  }
}
