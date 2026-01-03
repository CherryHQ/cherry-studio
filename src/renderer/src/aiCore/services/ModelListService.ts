/**
 * ModelListService - Unified model listing service
 * Fetches model lists from various providers using AI SDK's getFromApi
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
  type GeminiModelsResponse,
  GeminiModelsResponseSchema,
  type GitHubModelsResponse,
  GitHubModelsResponseSchema,
  type NewApiModelsResponse,
  NewApiModelsResponseSchema,
  type OllamaTagsResponse,
  OllamaTagsResponseSchema,
  type OpenAIModelsResponse,
  OpenAIModelsResponseSchema,
  type OVMSConfigResponse,
  OVMSConfigResponseSchema,
  type TogetherModelsResponse,
  TogetherModelsResponseSchema
} from './schemas'

const logger = loggerService.withContext('ModelListService')

// Error schema for API error responses
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

/**
 * Type-safe fetch wrapper using AI SDK's getFromApi with Zod schema validation
 */
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

// === Helper Functions ===

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

function getDefaultHeaders(provider: Provider): Record<string, string> {
  return {
    ...defaultAppHeaders(),
    Authorization: `Bearer ${getApiKey(provider)}`,
    'X-Api-Key': getApiKey(provider),
    ...provider.extra_headers
  }
}

function getDefaultGroupName(modelId: string, providerId: string): string {
  // Simple group name extraction logic
  const parts = modelId.split('/')
  if (parts.length > 1) {
    return parts[0]
  }
  return providerId
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

// === Model Conversion Functions ===

function convertOpenAIModelsToModels(provider: Provider, response: OpenAIModelsResponse): Model[] {
  const models: Model[] = []
  const seen = new Set<string>()

  for (const model of response.data) {
    const id = model.id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)

    models.push({
      id,
      name: id,
      provider: provider.id,
      group: getDefaultGroupName(id, provider.id),
      owned_by: model.owned_by
    })
  }

  return models
}

function convertOllamaModelsToModels(provider: Provider, response: OllamaTagsResponse): Model[] {
  const models: Model[] = []
  const seen = new Set<string>()

  for (const model of response.models) {
    const id = model.name?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)

    models.push({
      id,
      name: id,
      provider: provider.id,
      group: getDefaultGroupName(id, provider.id),
      owned_by: 'ollama'
    })
  }

  return models
}

function convertGeminiModelsToModels(provider: Provider, response: GeminiModelsResponse): Model[] {
  const models: Model[] = []
  const seen = new Set<string>()

  for (const model of response.models) {
    // Gemini model names are like "models/gemini-pro", extract just the model name
    const fullName = model.name
    const id = fullName.startsWith('models/') ? fullName.slice(7) : fullName
    if (!id || seen.has(id)) continue
    seen.add(id)

    models.push({
      id,
      name: model.displayName || id,
      provider: provider.id,
      group: getDefaultGroupName(id, provider.id),
      description: model.description
    })
  }

  return models
}

function convertGitHubModelsToModels(provider: Provider, response: GitHubModelsResponse): Model[] {
  const models: Model[] = []
  const seen = new Set<string>()

  for (const model of response) {
    const id = model.id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)

    models.push({
      id,
      name: model.name || id,
      provider: provider.id,
      group: getDefaultGroupName(id, provider.id),
      description: pickPreferredString([model.summary, model.description]),
      owned_by: model.publisher
    })
  }

  return models
}

function convertOVMSConfigToModels(provider: Provider, response: OVMSConfigResponse): Model[] {
  const models: Model[] = []
  const seen = new Set<string>()

  for (const [modelName, modelInfo] of Object.entries(response)) {
    // Check if model has at least one version with "AVAILABLE" state
    const hasAvailableVersion = modelInfo?.model_version_status?.some(
      (versionStatus) => versionStatus?.state === 'AVAILABLE'
    )

    if (!hasAvailableVersion) continue

    const id = modelName?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)

    models.push({
      id,
      name: id,
      provider: provider.id,
      group: getDefaultGroupName(id, provider.id),
      owned_by: 'ovms'
    })
  }

  return models
}

function convertTogetherModelsToModels(provider: Provider, response: TogetherModelsResponse): Model[] {
  const models: Model[] = []
  const seen = new Set<string>()

  for (const model of response) {
    const id = model.id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)

    models.push({
      id,
      name: model.display_name || id,
      provider: provider.id,
      group: getDefaultGroupName(id, provider.id),
      description: model.description,
      owned_by: model.organization
    })
  }

  return models
}

function convertNewApiModelsToModels(provider: Provider, response: NewApiModelsResponse): Model[] {
  const models: Model[] = []
  const seen = new Set<string>()

  for (const model of response.data) {
    const id = model.id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)

    models.push({
      id,
      name: id,
      provider: provider.id,
      group: getDefaultGroupName(id, provider.id),
      owned_by: model.owned_by,
      // The Zod schema type is a subset of EndpointType, safe to cast
      supported_endpoint_types: model.supported_endpoint_types as EndpointType[] | undefined
    })
  }

  return models
}

// === Main Service ===

export class ModelListService {
  /**
   * List models from a provider
   * @param provider - The provider to list models from
   * @param abortSignal - Optional abort signal
   * @returns Array of models
   */
  static async listModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
    try {
      // Skip unsupported providers
      if (isAIGatewayProvider(provider)) {
        logger.warn('Gateway provider does not support listModels through this service')
        return []
      }

      // AWS Bedrock requires special SDK handling
      if (provider.id === SystemProviderIds['aws-bedrock']) {
        logger.warn('AWS Bedrock requires SDK-based model listing, not supported by ModelListService')
        return []
      }

      // Anthropic and Vertex Anthropic don't have a public models endpoint
      if (provider.id === SystemProviderIds.anthropic || provider.type === 'vertex-anthropic') {
        logger.warn('Anthropic does not have a public models listing endpoint')
        return []
      }

      // Route to appropriate fetcher based on provider
      if (isOllamaProvider(provider)) {
        return await this.fetchOllamaModels(provider, abortSignal)
      }

      if (isGeminiProvider(provider)) {
        return await this.fetchGeminiModels(provider, abortSignal)
      }

      if (provider.id === SystemProviderIds.github) {
        return await this.fetchGitHubModels(provider, abortSignal)
      }

      if (provider.id === SystemProviderIds.ovms) {
        return await this.fetchOVMSModels(provider, abortSignal)
      }

      if (provider.id === SystemProviderIds.together) {
        return await this.fetchTogetherModels(provider, abortSignal)
      }

      if (provider.id === SystemProviderIds['new-api'] || provider.type === 'new-api') {
        return await this.fetchNewApiModels(provider, abortSignal)
      }

      if (provider.id === SystemProviderIds.openrouter) {
        return await this.fetchOpenRouterModels(provider, abortSignal)
      }

      if (provider.id === SystemProviderIds.ppio) {
        return await this.fetchPPIOModels(provider, abortSignal)
      }

      // Default: OpenAI-compatible endpoint
      return await this.fetchOpenAICompatibleModels(provider, abortSignal)
    } catch (error) {
      logger.error('Error listing models:', error as Error, { providerId: provider.id })
      return []
    }
  }

  // === Provider-specific fetchers ===

  private static async fetchOpenAICompatibleModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
    const baseUrl = formatApiHost(provider.apiHost)
    const url = `${baseUrl}/models`

    const response = await getFromApi({
      url,
      headers: getDefaultHeaders(provider),
      responseSchema: OpenAIModelsResponseSchema,
      abortSignal
    })

    return convertOpenAIModelsToModels(provider, response)
  }

  private static async fetchOllamaModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
    const baseUrl = withoutTrailingSlash(provider.apiHost)
      .replace(/\/v1$/, '')
      .replace(/\/api$/, '')
    const url = `${baseUrl}/api/tags`

    const response = await getFromApi({
      url,
      headers: getDefaultHeaders(provider),
      responseSchema: OllamaTagsResponseSchema,
      abortSignal
    })

    return convertOllamaModelsToModels(provider, response)
  }

  private static async fetchGeminiModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
    // Remove trailing API version from base URL
    let baseUrl = withoutTrailingSlash(provider.apiHost)
    baseUrl = baseUrl.replace(/\/v1(beta)?$/, '')

    const apiVersion = provider.apiVersion || 'v1beta'
    const url = `${baseUrl}/${apiVersion}/models?key=${getApiKey(provider)}`

    const response = await getFromApi({
      url,
      headers: {
        ...defaultAppHeaders(),
        ...provider.extra_headers
      },
      responseSchema: GeminiModelsResponseSchema,
      abortSignal
    })

    return convertGeminiModelsToModels(provider, response)
  }

  private static async fetchGitHubModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
    const url = 'https://models.github.ai/catalog/'

    const response = await getFromApi({
      url,
      headers: getDefaultHeaders(provider),
      responseSchema: GitHubModelsResponseSchema,
      abortSignal
    })

    return convertGitHubModelsToModels(provider, response)
  }

  private static async fetchOVMSModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
    const baseUrl = formatApiHost(withoutTrailingSlash(provider.apiHost).replace(/\/v1$/, ''), true, 'v1')
    const url = `${baseUrl}/config`

    const response = await getFromApi({
      url,
      headers: getDefaultHeaders(provider),
      responseSchema: OVMSConfigResponseSchema,
      abortSignal
    })

    return convertOVMSConfigToModels(provider, response)
  }

  private static async fetchTogetherModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
    const baseUrl = formatApiHost(provider.apiHost)
    const url = `${baseUrl}/models`

    const response = await getFromApi({
      url,
      headers: getDefaultHeaders(provider),
      responseSchema: TogetherModelsResponseSchema,
      abortSignal
    })

    return convertTogetherModelsToModels(provider, response)
  }

  private static async fetchNewApiModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
    const baseUrl = formatApiHost(provider.apiHost)
    const url = `${baseUrl}/models`

    const response = await getFromApi({
      url,
      headers: getDefaultHeaders(provider),
      responseSchema: NewApiModelsResponseSchema,
      abortSignal
    })

    return convertNewApiModelsToModels(provider, response)
  }

  private static async fetchOpenRouterModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
    // OpenRouter has both chat models and embedding models at different endpoints
    const baseUrl = 'https://openrouter.ai/api/v1'
    const embedBaseUrl = 'https://openrouter.ai/api/v1/embeddings'

    const [modelsResponse, embedModelsResponse] = await Promise.all([
      getFromApi({
        url: `${baseUrl}/models`,
        headers: getDefaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal
      }),
      getFromApi({
        url: `${embedBaseUrl}/models`,
        headers: getDefaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal
      }).catch(() => ({ data: [] })) // Embedding endpoint might not exist
    ])

    // Combine and deduplicate models
    const allModels = [...modelsResponse.data, ...embedModelsResponse.data]
    const uniqueModels = Array.from(new Map(allModels.map((model) => [model.id, model])).values())

    return convertOpenAIModelsToModels(provider, { data: uniqueModels })
  }

  private static async fetchPPIOModels(provider: Provider, abortSignal?: AbortSignal): Promise<Model[]> {
    const baseUrl = formatApiHost(provider.apiHost)

    // PPIO requires three separate requests to get all model types
    const [chatModelsResponse, embeddingModelsResponse, rerankerModelsResponse] = await Promise.all([
      getFromApi({
        url: `${baseUrl}/models`,
        headers: getDefaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal
      }),
      getFromApi({
        url: `${baseUrl}/models?model_type=embedding`,
        headers: getDefaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal
      }).catch(() => ({ data: [] })),
      getFromApi({
        url: `${baseUrl}/models?model_type=reranker`,
        headers: getDefaultHeaders(provider),
        responseSchema: OpenAIModelsResponseSchema,
        abortSignal
      }).catch(() => ({ data: [] }))
    ])

    // Combine and process all models
    const allModels = [...chatModelsResponse.data, ...embeddingModelsResponse.data, ...rerankerModelsResponse.data]

    return convertOpenAIModelsToModels(provider, { data: allModels })
  }
}
