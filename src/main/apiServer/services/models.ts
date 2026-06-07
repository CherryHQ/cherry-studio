import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { ApiModel, ApiModelsFilter, ApiModelsResponse } from '../../../renderer/types/apiModels'

const logger = loggerService.withContext('ApiServerModelsService')

export type ModelsFilter = ApiModelsFilter

/**
 * Whether a provider exposes the Anthropic Messages protocol. The v2 Provider
 * has no single `type` field, so anthropic capability is read off the
 * per-endpoint config — the same signal `messages.ts` uses to route requests.
 */
function supportsAnthropic(provider: Provider): boolean {
  return Boolean(provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl)
}

function deriveProviderType(provider: Provider): ApiModel['provider_type'] {
  if (supportsAnthropic(provider)) {
    return 'anthropic'
  }
  if (provider.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl) {
    return 'openai'
  }
  return undefined
}

function transformModelToOpenAI(model: Model, provider: Provider, created: number): ApiModel {
  return {
    // model.id is already a UniqueModelId ("providerId::modelId"), which is the
    // exact shape the /v1/chat/completions and /v1/messages routes parse back.
    id: model.id,
    object: 'model',
    name: model.name,
    created,
    owned_by: provider.name || provider.id,
    provider: provider.id,
    provider_name: provider.name,
    provider_type: deriveProviderType(provider),
    provider_model_id: model.apiModelId ?? model.id
  }
}

export class ModelsService {
  async getModels(filter: ModelsFilter): Promise<ApiModelsResponse> {
    try {
      logger.debug('Getting available models from providers', { filter })

      const providers = await providerService.list({ enabled: true })
      const providerById = new Map(providers.map((p) => [p.id, p]))

      const models = await modelService.list({ enabled: true })
      const created = Math.floor(Date.now() / 1000)

      let modelData: ApiModel[] = []
      for (const model of models) {
        const provider = providerById.get(model.providerId)
        if (!provider) {
          // Model rows can outlive a disabled/removed provider; skip them rather
          // than emit a model the chat route could never resolve.
          logger.debug(`Skipping model ${model.id}. Reason: provider not enabled or not found.`)
          continue
        }

        if (filter.providerType === 'anthropic' && !supportsAnthropic(provider)) {
          continue
        }

        modelData.push(transformModelToOpenAI(model, provider, created))
      }

      const total = modelData.length

      const offset = filter.offset ?? 0
      const limit = filter.limit

      if (limit !== undefined) {
        modelData = modelData.slice(offset, offset + limit)
      } else if (offset > 0) {
        modelData = modelData.slice(offset)
      }

      logger.info('Models retrieved', {
        returned: modelData.length,
        discovered: models.length,
        filter
      })

      const response: ApiModelsResponse = {
        object: 'list',
        data: modelData
      }

      if (filter.limit !== undefined || filter.offset !== undefined) {
        response.total = total
        response.offset = offset
        if (filter.limit !== undefined) {
          response.limit = filter.limit
        }
      }

      return response
    } catch (error) {
      logger.error('Error getting models', error as Error, { filter })
      return {
        object: 'list',
        data: []
      }
    }
  }
}

export const modelsService = new ModelsService()
