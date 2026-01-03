import type { ApiModel, ApiModelsFilter, ApiModelsResponse } from '../../../renderer/src/types/apiModels'
import { loggerService } from '../../services/LoggerService'
import { getAvailableProviders, listAllAvailableModels, transformModelToOpenAI } from '../utils'

const logger = loggerService.withContext('ModelsService')

// Re-export for backward compatibility

export type ModelsFilter = ApiModelsFilter

export class ModelsService {
  async getModels(filter: ModelsFilter): Promise<ApiModelsResponse> {
    try {
      logger.debug('Getting available models from providers', { filter })

      const providers = await getAvailableProviders()

      // Note: When providerType === 'anthropic', we now return ALL available models
      // because the API Server's unified adapter (AiSdkToAnthropicSSE) can convert
      // any provider's response to Anthropic SSE format. This enables Claude Code Agent
      // to work with OpenAI, Gemini, and other providers transparently.

      const models = await listAllAvailableModels(providers)
      // Use Map to deduplicate models by their full ID (provider:model_id)
      const uniqueModels = new Map<string, ApiModel>()

      for (const model of models) {
        const provider = providers.find((p) => p.id === model.provider)
        if (!provider) {
          logger.debug(`Skipping model ${model.id} . Reason: Provider not found.`)
          continue
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
