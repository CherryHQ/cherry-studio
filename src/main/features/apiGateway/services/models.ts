import { loggerService } from '@logger'

import {
  type ApiModel,
  type ApiModelsResponse,
  getAvailableProviders,
  listAllAvailableModels,
  transformModelToOpenAI
} from '../utils'

const logger = loggerService.withContext('ModelsService')

/** Optional pagination filter for the gateway `/v1/models` listing. */
export interface ModelsFilter {
  offset?: number
  limit?: number
}

export class ModelsService {
  async getModels(filter: ModelsFilter = {}): Promise<ApiModelsResponse> {
    try {
      logger.debug('Getting available models from providers', { filter })

      const providers = await getAvailableProviders()
      const models = await listAllAvailableModels(providers)

      // Deduplicate by the gateway-addressable id ("providerId:modelId").
      const uniqueModels = new Map<string, ApiModel>()
      for (const model of models) {
        const provider = providers.find((p) => p.id === model.providerId)
        const openAIModel = transformModelToOpenAI(model, provider)
        if (!uniqueModels.has(openAIModel.id)) {
          uniqueModels.set(openAIModel.id, openAIModel)
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
}

export const modelsService = new ModelsService()
