import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('ApiGatewayModels')

/**
 * OpenAI `/v1/models`-shaped model entry surfaced by the gateway. Defined locally —
 * the renderer's old `ApiModel` type is gone in the new data model.
 */
export interface ApiModel {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

export interface ApiModelsResponse {
  object: 'list'
  data: ApiModel[]
}

/** Optional pagination filter for the gateway `/v1/models` listing. */
export interface ModelsFilter {
  offset?: number
  limit?: number
}

/** Enabled providers from the data layer (`ProviderService`, not Redux). */
async function getAvailableProviders(): Promise<Provider[]> {
  try {
    return await providerService.list({ enabled: true })
  } catch (error) {
    logger.error('Failed to list providers', error as Error)
    return []
  }
}

/** All enabled models across enabled providers, via `ModelService`. */
async function listAllAvailableModels(providers?: Provider[]): Promise<Model[]> {
  try {
    if (!providers) {
      return await modelService.list({ enabled: true })
    }
    const results = await Promise.allSettled(
      providers.map((p) => modelService.list({ providerId: p.id, enabled: true }))
    )
    return results.flatMap((result, i) => {
      if (result.status === 'fulfilled') return result.value
      logger.error(`Failed to list models for provider ${providers[i].id}`, result.reason as Error)
      return []
    })
  } catch (error) {
    logger.error('Failed to list available models', error as Error)
    return []
  }
}

/**
 * Project a data-layer `Model` into the OpenAI `/v1/models` entry shape. The `id` is
 * the gateway-addressable `"providerId:modelId"`.
 */
function transformModelToOpenAi(model: Model, provider?: Provider): ApiModel {
  const apiModelId = model.apiModelId ?? model.id
  return {
    id: `${model.providerId}:${apiModelId}`,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: model.ownedBy || provider?.name || model.providerId
  }
}

/**
 * Build the OpenAI `/v1/models` listing: enabled models across enabled providers,
 * deduplicated by gateway id and optionally paginated. Never throws — returns an empty
 * list on failure so the route stays resilient.
 */
export async function getModels(filter: ModelsFilter = {}): Promise<ApiModelsResponse> {
  try {
    const providers = await getAvailableProviders()
    const models = await listAllAvailableModels(providers)

    // Deduplicate by the gateway-addressable id ("providerId:modelId").
    const uniqueModels = new Map<string, ApiModel>()
    for (const model of models) {
      const provider = providers.find((p) => p.id === model.providerId)
      const apiModel = transformModelToOpenAi(model, provider)
      if (!uniqueModels.has(apiModel.id)) {
        uniqueModels.set(apiModel.id, apiModel)
      }
    }

    let modelData = Array.from(uniqueModels.values())
    const offset = filter.offset ?? 0
    const limit = filter.limit
    if (limit !== undefined) {
      modelData = modelData.slice(offset, offset + limit)
    } else if (offset > 0) {
      modelData = modelData.slice(offset)
    }

    logger.info('Models retrieved', { returned: modelData.length, discovered: models.length })
    return { object: 'list', data: modelData }
  } catch (error) {
    logger.error('Error getting models', error as Error)
    return { object: 'list', data: [] }
  }
}
