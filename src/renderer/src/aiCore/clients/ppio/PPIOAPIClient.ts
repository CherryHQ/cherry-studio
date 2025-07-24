import { loggerService } from '@logger'
import { isSupportedModel } from '@renderer/config/models'
import { Provider } from '@renderer/types'
import OpenAI from 'openai'

import { OpenAIAPIClient } from '../openai/OpenAIApiClient'

const logger = loggerService.withContext('PPIOAPIClient')
export class PPIOAPIClient extends OpenAIAPIClient {
  constructor(provider: Provider) {
    super(provider)
  }

  override async listModels(): Promise<OpenAI.Models.Model[]> {
    try {
      const sdk = await this.getSdkInstance()

      // PPIO requires three separate requests to get all model types
      const [chatModelsResponse, embeddingModelsResponse, rerankerModelsResponse] = await Promise.all([
        // Chat/completion models
        sdk.request({
          method: 'get',
          path: '/models'
        }),
        // Embedding models
        sdk.request({
          method: 'get',
          path: '/models?model_type=embedding'
        }),
        // Reranker models
        sdk.request({
          method: 'get',
          path: '/models?model_type=reranker'
        })
      ])

      // Extract models from all responses
      // @ts-ignore - PPIO response structure may not be typed
      const allModels = [
        ...((chatModelsResponse as any)?.data || []),
        ...((embeddingModelsResponse as any)?.data || []),
        ...((rerankerModelsResponse as any)?.data || [])
      ]

      // Process and standardize model data
      const processedModels = allModels.map((model: any) => ({
        id: model.id || model.name,
        description: model.description || model.display_name || model.summary,
        object: 'model' as const,
        owned_by: model.owned_by || model.publisher || model.organization || 'ppio',
        created: model.created || Date.now()
      }))

      // Clean up model IDs and filter supported models
      processedModels.forEach((model) => {
        if (model.id) {
          model.id = model.id.trim()
        }
      })

      return processedModels.filter(isSupportedModel)
    } catch (error) {
      logger.error('Error listing PPIO models:', error as Error)
      return []
    }
  }
}
