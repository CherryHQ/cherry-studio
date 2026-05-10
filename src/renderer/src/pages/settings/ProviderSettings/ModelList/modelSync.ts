import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import { toV1ProviderShim } from '@renderer/pages/settings/ProviderSettings/utils/v1ProviderShim'
import type {
  Model as LegacyModel,
  ModelCapability as LegacyModelCapability,
  Provider as LegacyProvider
} from '@renderer/types'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import {
  createUniqueModelId,
  ENDPOINT_TYPE,
  type EndpointType as RuntimeEndpointType,
  type Model,
  MODEL_CAPABILITY,
  type ModelCapability as RuntimeModelCapability,
  parseUniqueModelId
} from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isEmpty } from 'lodash'

const logger = loggerService.withContext('ProviderModelSync')

type ProviderRegistryModelsPath = Extract<ConcreteApiPaths, `/providers/${string}/registry-models`>
type ProviderRotatedKeyPath = Extract<ConcreteApiPaths, `/providers/${string}/rotated-key`>
type ProviderRotatedKeyResponse = { apiKey: string }

const LEGACY_CAPABILITY_TO_V2: Record<LegacyModelCapability['type'], RuntimeModelCapability | undefined> = {
  text: undefined,
  vision: MODEL_CAPABILITY.IMAGE_RECOGNITION,
  embedding: MODEL_CAPABILITY.EMBEDDING,
  reasoning: MODEL_CAPABILITY.REASONING,
  function_calling: MODEL_CAPABILITY.FUNCTION_CALL,
  web_search: MODEL_CAPABILITY.WEB_SEARCH,
  rerank: MODEL_CAPABILITY.RERANK
}

const LEGACY_ENDPOINT_TO_V2: Record<string, RuntimeEndpointType> = {
  openai: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  'openai-response': ENDPOINT_TYPE.OPENAI_RESPONSES,
  anthropic: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  gemini: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  'image-generation': ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
  'jina-rerank': ENDPOINT_TYPE.JINA_RERANK
}

async function fetchModelsStrict(provider: LegacyProvider): Promise<LegacyModel[]> {
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
  const capabilities =
    model.capabilities
      ?.map((capability) => LEGACY_CAPABILITY_TO_V2[capability.type])
      .filter((capability): capability is RuntimeModelCapability => capability !== undefined) ?? []

  const endpointTypes = [
    ...(model.supported_endpoint_types
      ?.map((endpointType) => LEGACY_ENDPOINT_TO_V2[endpointType])
      .filter((endpointType): endpointType is RuntimeEndpointType => endpointType !== undefined) ?? []),
    ...(model.endpoint_type && LEGACY_ENDPOINT_TO_V2[model.endpoint_type]
      ? [LEGACY_ENDPOINT_TO_V2[model.endpoint_type]]
      : [])
  ]

  return {
    id: createUniqueModelId(providerId, model.id),
    providerId,
    apiModelId: model.id,
    name: model.name,
    description: model.description,
    group: model.group,
    capabilities,
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

  try {
    const registryModelsPath: ProviderRegistryModelsPath = `/providers/${providerId}/registry-models`
    const resolved = await dataApiService.post(registryModelsPath, {
      body: {
        models: filteredModels.map((model) => ({
          modelId: model.id
        }))
      }
    })

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
        resolvedMap.get(
          fetched.id.includes('/') ? fetched.id.substring(fetched.id.lastIndexOf('/') + 1) : fetched.id
        ) ??
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
  } catch (error) {
    logger.warn('Failed to enrich fetched models against registry, falling back to raw fetch results', {
      providerId,
      error
    })
    return filteredModels.map((model) => normalizeFetchedModel(providerId, model))
  }
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
