import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateModelDto } from '@shared/data/api/schemas/models'
import { type EndpointType as RuntimeEndpointType, type Model, parseUniqueModelId } from '@shared/data/types/model'
import { isEmpty } from 'lodash'

const logger = loggerService.withContext('ProviderModelSync')

export type ModelSyncErrorCode = 'NO_ENABLED_API_KEY'

export class ModelSyncError extends Error {
  constructor(
    message: string,
    public readonly code: ModelSyncErrorCode,
    public readonly meta?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ModelSyncError'
  }
}

type ProviderResolveModelsPath = Extract<ConcreteApiPaths, `/providers/${string}/models:resolve`>

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

/**
 * Enrich raw v2 models from `window.api.ai.listModels` with registry
 * metadata fetched via `/providers/:id/models:resolve`. The IPC already
 * returns v2 `Partial<Model>` (with `apiModelId`, `endpointTypes`, etc.)
 * — this layer overlays preset capabilities/limits/pricing that aren't
 * available from the upstream provider SDK.
 */
async function enrichFetchedModels(providerId: string, fetchedModels: Partial<Model>[]): Promise<Model[]> {
  const filteredModels = fetchedModels.filter((model) => !isEmpty(model.name))
  if (filteredModels.length === 0) {
    return []
  }

  const resolveModelsPath: ProviderResolveModelsPath = `/providers/${providerId}/models:resolve`
  const resolved = (await dataApiService.get(resolveModelsPath, {
    query: {
      ids: filteredModels.map((model) => model.apiModelId ?? '').filter(Boolean)
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
    const base = fetched as Model
    const apiId = fetched.apiModelId ?? ''
    const registry =
      resolvedMap.get(apiId) ??
      resolvedMap.get(apiId.includes('/') ? apiId.substring(apiId.lastIndexOf('/') + 1) : apiId) ??
      resolvedMap.get((apiId.includes('/') ? apiId.substring(apiId.lastIndexOf('/') + 1) : apiId).replaceAll('.', '-'))

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

/**
 * Sync provider models: ask main to list upstream models (main reads keys
 * from DB), then enrich via the registry-resolve endpoint. `throwOnError`
 * surfaces upstream failures so the UI can show a real reason rather than
 * a silent empty list.
 */
export async function fetchResolvedProviderModels(providerId: string): Promise<Model[]> {
  try {
    logger.info('Fetching provider models via IPC', { providerId })
    const fetched = await window.api.ai.listModels({ providerId, throwOnError: true })
    logger.info('Fetched provider models', { providerId, fetchedModelCount: fetched.length })
    return await enrichFetchedModels(providerId, fetched)
  } catch (error) {
    logger.error('Failed to fetch and resolve provider models', { providerId, error })
    throw error
  }
}
