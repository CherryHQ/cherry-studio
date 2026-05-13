import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import { toV1ProviderShim } from '@renderer/pages/settings/ProviderSettings/utils/v1ProviderShim'
import type { Model as LegacyModel, Provider as LegacyProvider } from '@renderer/types'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import {
  createUniqueModelId,
  ENDPOINT_TYPE,
  type EndpointType as RuntimeEndpointType,
  type Model,
  parseUniqueModelId
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isEmpty } from 'lodash'

const logger = loggerService.withContext('ProviderModelSync')

type ProviderResolveModelsPath = Extract<ConcreteApiPaths, `/providers/${string}/models:resolve`>
type ProviderRotatedKeyPath = Extract<ConcreteApiPaths, `/providers/${string}/rotated-key`>
type ProviderRotatedKeyResponse = { apiKey: string }

const LEGACY_ENDPOINT_TO_RUNTIME: Record<string, RuntimeEndpointType> = {
  openai: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  'openai-response': ENDPOINT_TYPE.OPENAI_RESPONSES,
  anthropic: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  gemini: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  'image-generation': ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
  'jina-rerank': ENDPOINT_TYPE.JINA_RERANK
}

async function fetchModelsStrict(provider: LegacyProvider): Promise<LegacyModel[]> {
  // Transitional path: model sync still goes through the existing AiProvider
  // list-models flow, which currently expects the legacy renderer Provider
  // shape. When aiCore accepts the runtime/Data API provider contract end to
  // end, this LegacyProvider boundary and the v1 shim at the call site below
  // should be removed together.
  const ai = new AiProvider(provider)

  return await ai.models({ throwOnError: true })
}

export function toCreateModelDto(
  providerId: string,
  model: Model,
  endpointTypes?: RuntimeEndpointType[]
): CreateModelDto {
  const modelId = model.apiModelId ?? parseUniqueModelId(model.id).modelId

  return {
    providerId,
    modelId,
    name: model.name,
    group: model.group,
    ...(endpointTypes ? { endpointTypes } : model.endpointTypes ? { endpointTypes: model.endpointTypes } : {})
  }
}

function normalizeFetchedModel(providerId: string, model: LegacyModel): Model {
  const endpointTypes = [
    ...(model.supported_endpoint_types
      ?.map((endpointType) => LEGACY_ENDPOINT_TO_RUNTIME[endpointType])
      .filter((endpointType): endpointType is RuntimeEndpointType => endpointType !== undefined) ?? []),
    ...(model.endpoint_type && LEGACY_ENDPOINT_TO_RUNTIME[model.endpoint_type]
      ? [LEGACY_ENDPOINT_TO_RUNTIME[model.endpoint_type]]
      : [])
  ]

  return {
    id: createUniqueModelId(providerId, model.id),
    providerId,
    apiModelId: model.id,
    name: model.name,
    description: model.description,
    group: model.group,
    // Capabilities are owned by runtime registry/DB enrichment. Do not consume
    // legacy AiProvider.models() capability hints in renderer sync preview.
    capabilities: [],
    endpointTypes: endpointTypes.length > 0 ? endpointTypes : undefined,
    supportsStreaming: model.supported_text_delta ?? true,
    isEnabled: true,
    isHidden: false
  }
}

async function enrichFetchedModels(providerId: string, fetchedModels: LegacyModel[]): Promise<Model[]> {
  const filteredModels = fetchedModels.filter((model) => !isEmpty(model.name))
  if (filteredModels.length === 0) {
    return []
  }

  const resolveModelsPath: ProviderResolveModelsPath = `/providers/${providerId}/models:resolve`
  const resolved = (await dataApiService.get(resolveModelsPath, {
    query: {
      ids: filteredModels.map((model) => model.id)
    }
  })) as Model[]

  const resolvedMap = new Map<string, Model>()
  for (const model of resolved) {
    const key = model.apiModelId ?? parseUniqueModelId(model.id).modelId
    if (!resolvedMap.has(key)) {
      resolvedMap.set(key, model)
    }
  }

  const REGISTRY_FIELDS = [
    'name',
    'description',
    'group',
    'capabilities',
    'inputModalities',
    'outputModalities',
    'endpointTypes',
    'contextWindow',
    'maxOutputTokens',
    'maxInputTokens',
    'reasoning',
    'pricing',
    'family',
    'ownedBy'
  ] as const

  return filteredModels.map((fetched) => {
    const base = normalizeFetchedModel(providerId, fetched)
    const registry =
      resolvedMap.get(fetched.id) ??
      resolvedMap.get(fetched.id.includes('/') ? fetched.id.substring(fetched.id.lastIndexOf('/') + 1) : fetched.id) ??
      resolvedMap.get(
        (fetched.id.includes('/') ? fetched.id.substring(fetched.id.lastIndexOf('/') + 1) : fetched.id).replaceAll(
          '.',
          '-'
        )
      )

    if (!registry) {
      return base
    }

    const merged = { ...base }
    for (const field of REGISTRY_FIELDS) {
      const value = registry[field]
      if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) {
        ;(merged as Record<string, unknown>)[field] = value
      }
    }

    return merged
  })
}

export async function fetchResolvedProviderModels(providerId: string, provider: Provider): Promise<Model[]> {
  try {
    let apiKey = ''
    try {
      const rotatedKeyPath: ProviderRotatedKeyPath = `/providers/${providerId}/rotated-key`
      const keyData = (await dataApiService.get(rotatedKeyPath)) as ProviderRotatedKeyResponse
      apiKey = keyData.apiKey
      logger.info('Fetched rotated provider API key for model sync', {
        providerId,
        hasApiKey: apiKey.length > 0
      })
    } catch (error) {
      logger.error('Failed to fetch rotated provider API key for model sync', {
        providerId,
        error
      })
      throw error
    }

    logger.info('Fetching raw provider models from upstream provider SDK', {
      providerId
    })
    // Transitional bridge: ProviderSettings owns a runtime/Data API `Provider`,
    // but upstream model discovery still enters aiCore through the old
    // `AiProvider.models()` contract. Convert once at the boundary, then remove
    // this shim after aiCore migrates to the runtime provider shape.
    const fetched = await fetchModelsStrict(toV1ProviderShim(provider, { apiKey }))
    logger.info('Fetched raw provider models from upstream provider SDK', {
      providerId,
      fetchedModelCount: fetched.length
    })
    return await enrichFetchedModels(providerId, fetched)
  } catch (error) {
    logger.error('Failed to fetch and resolve provider models', {
      providerId,
      error
    })
    throw error
  }
}
