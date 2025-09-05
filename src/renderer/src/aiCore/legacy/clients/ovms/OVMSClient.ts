import { loggerService } from '@logger'
import { isSupportedModel } from '@renderer/config/models'
import { Provider } from '@renderer/types'
import OpenAI from 'openai'

import { OpenAIAPIClient } from '../openai/OpenAIApiClient'

const logger = loggerService.withContext('OVMSClient')

export class OVMSClient extends OpenAIAPIClient {
  constructor(provider: Provider) {
    super(provider)
  }

  override async listModels(): Promise<OpenAI.Models.Model[]> {
    try {
      const sdk = await this.getSdkInstance()

      const [chatModelsResponse] = await Promise.all([
        // Chat/completion models
        sdk.request({
          method: 'get',
          path: '../v1/config'
        })
      ])
      logger.debug(`[OVMSClient] Chat models response: ${JSON.stringify(chatModelsResponse)}`)

      // Parse the config response to extract model information
      const config = chatModelsResponse as any
      const models = Object.keys(config)
        .map((modelName) => {
          const modelInfo = config[modelName]

          // Check if model has at least one version with "AVAILABLE" state
          const hasAvailableVersion = modelInfo?.model_version_status?.some(
            (versionStatus: any) => versionStatus?.state === 'AVAILABLE'
          )

          if (hasAvailableVersion) {
            return {
              id: modelName,
              object: 'model' as const,
              owned_by: 'ovms',
              created: Date.now()
            }
          }
          return null // Skip models without available versions
        })
        .filter(Boolean) // Remove null entries
      logger.debug(`[OVMSClient] Processed models: ${JSON.stringify(models)}`)

      // Filter out unsupported models
      return models.filter((model): model is OpenAI.Models.Model => model !== null && isSupportedModel(model))
    } catch (error) {
      logger.error(`Error listing OVMS models: ${error}`)
      return []
    }
  }
}
