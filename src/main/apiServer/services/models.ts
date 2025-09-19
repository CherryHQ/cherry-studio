import {
  ApiModelsRequest,
  ApiModelsRequestSchema,
  ApiModelsResponse,
  OpenAICompatibleModel
} from '../../../renderer/src/types/apiModels'
import { loggerService } from '../../services/LoggerService'
import { getAvailableProviders, listAllAvailableModels, transformModelToOpenAI } from '../utils'

const logger = loggerService.withContext('ModelsService')

// Re-export for backward compatibility
export const ModelsFilterSchema = ApiModelsRequestSchema
export type ModelsFilter = ApiModelsRequest

export class ModelsService {
  async getModels(filter?: ModelsFilter): Promise<ApiModelsResponse> {
    try {
      logger.info('Getting available models from providers', { filter })

      const models = await listAllAvailableModels()
      const providers = await getAvailableProviders()

      // Use Map to deduplicate models by their full ID (provider:model_id)
      const uniqueModels = new Map<string, OpenAICompatibleModel>()

      for (const model of models) {
        const openAIModel = transformModelToOpenAI(model)
        const fullModelId = openAIModel.id // This is already in format "provider:model_id"

        // Only add if not already present (first occurrence wins)
        if (!uniqueModels.has(fullModelId)) {
          uniqueModels.set(fullModelId, {
            ...openAIModel,
            name: model.name
          })
        } else {
          logger.debug(`Skipping duplicate model: ${fullModelId}`)
        }
      }

      let modelData = Array.from(uniqueModels.values())

      // Apply filters
      if (filter?.provider) {
        const providerType = filter.provider
        modelData = modelData.filter((model) => {
          // Find the provider for this model and check its type
          const provider = providers.find((p) => p.id === model.provider)
          return provider && provider.type === providerType
        })
        logger.debug(`Filtered by provider type '${providerType}': ${modelData.length} models`)
      }

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

      logger.info(`Successfully retrieved ${modelData.length} models from ${models.length} total models`)

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
      logger.error('Error getting models:', error)
      return {
        object: 'list',
        data: []
      }
    }
  }
}

// Export singleton instance
export const modelsService = new ModelsService()
