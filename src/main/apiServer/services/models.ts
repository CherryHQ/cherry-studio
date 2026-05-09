import { isEmpty } from 'lodash'

import type { ApiModel, ApiModelsFilter, ApiModelsResponse } from '../../../renderer/src/types/apiModels'
import { listLocalOmlxModels } from '../../services/agents/services/localomlx/config'
import { loggerService } from '../../services/LoggerService'
import {
  getAvailableProviders,
  getProviderAnthropicModelChecker,
  listAllAvailableModels,
  transformModelToOpenAI
} from '../utils'

const logger = loggerService.withContext('ModelsService')

// Re-export for backward compatibility

export type ModelsFilter = ApiModelsFilter

const LOCAL_OMLX_PROVIDER_ID = 'omlx'
const LOCAL_OMLX_PROVIDER_NAME = 'Local oMLX'

function toLocalOmlxApiModel(modelId: string): ApiModel {
  return {
    id: `${LOCAL_OMLX_PROVIDER_ID}:${modelId}`,
    object: 'model',
    created: 0,
    name: modelId,
    owned_by: LOCAL_OMLX_PROVIDER_ID,
    provider: LOCAL_OMLX_PROVIDER_ID,
    provider_name: LOCAL_OMLX_PROVIDER_NAME,
    provider_type: 'openai',
    provider_model_id: modelId
  }
}

export class ModelsService {
  async getModels(filter: ModelsFilter): Promise<ApiModelsResponse> {
    try {
      logger.debug('Getting available models from providers', { filter })

      let providers = await getAvailableProviders()

      if (filter.providerType === 'anthropic') {
        providers = providers.filter((p) => p.type === 'anthropic' || !isEmpty(p.anthropicApiHost?.trim()))
      }

      const models = await listAllAvailableModels(providers)
      // Use Map to deduplicate models by their full ID (provider:model_id)
      const uniqueModels = new Map<string, ApiModel>()

      for (const model of models) {
        const provider = providers.find((p) => p.id === model.provider)
        // logger.debug(`Processing model ${model.id}`)
        if (!provider) {
          logger.debug(`Skipping model ${model.id} . Reason: Provider not found.`)
          continue
        }

        if (filter.providerType === 'anthropic') {
          const checker = getProviderAnthropicModelChecker(provider.id)
          if (!checker(model)) {
            logger.debug(`Skipping model ${model.id} from ${model.provider}. Reason: Not an Anthropic model.`)
            continue
          }
        }

        const openAIModel = transformModelToOpenAI(model, provider)
        const fullModelId = openAIModel.id // This is already in format "provider:model_id"

        // Only add if not already present (first occurrence wins)
        if (!uniqueModels.has(fullModelId)) {
          uniqueModels.set(fullModelId, openAIModel)
        } else {
          logger.debug(`Skipping duplicate model: ${fullModelId}`)
        }
      }

      if (!filter.providerType || filter.providerType === 'openai') {
        try {
          const localOmlxModels = await listLocalOmlxModels()

          for (const modelId of localOmlxModels) {
            const apiModel = toLocalOmlxApiModel(modelId)
            if (!uniqueModels.has(apiModel.id)) {
              uniqueModels.set(apiModel.id, apiModel)
            }
          }
        } catch (error) {
          logger.warn('Failed to list Local oMLX models', { error })
        }
      }

      let modelData = Array.from(uniqueModels.values())
      const total = modelData.length

      // Apply pagination
      const offset = filter?.offset || 0
      const limit = filter?.limit

      if (limit !== undefined) {
        modelData = modelData.slice(offset, offset + limit)
        logger.debug(
          `Applied pagination: offset=${offset}, limit=${limit}, showing ${modelData.length} of ${total} models`
        )
      } else if (offset > 0) {
        modelData = modelData.slice(offset)
        logger.debug(`Applied offset: offset=${offset}, showing ${modelData.length} of ${total} models`)
      }

      logger.info('Models retrieved', {
        returned: modelData.length,
        discovered: models.length,
        filter
      })

      if (models.length > total) {
        logger.debug(`Filtered out ${models.length - total} models after deduplication and filtering`)
      }

      const response: ApiModelsResponse = {
        object: 'list',
        data: modelData
      }

      // Add pagination metadata if applicable
      if (filter?.limit !== undefined || filter?.offset !== undefined) {
        response.total = total
        response.offset = offset
        if (filter?.limit !== undefined) {
          response.limit = filter.limit
        }
      }

      return response
    } catch (error: any) {
      logger.error('Error getting models', { error, filter })
      return {
        object: 'list',
        data: []
      }
    }
  }
}

// Export singleton instance
export const modelsService = new ModelsService()
