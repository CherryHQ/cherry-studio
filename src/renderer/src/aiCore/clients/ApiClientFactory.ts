import { loggerService } from '@logger'
import { Provider } from '@renderer/types'

import { AihubmixAPIClient } from './AihubmixAPIClient'
import { AnthropicAPIClient } from './anthropic/AnthropicAPIClient'
import { AwsBedrockAPIClient } from './aws/AwsBedrockAPIClient'
import { BaseApiClient } from './BaseApiClient'
import { GeminiAPIClient } from './gemini/GeminiAPIClient'
import { VertexAPIClient } from './gemini/VertexAPIClient'
import { NewAPIClient } from './NewAPIClient'
import { OpenAIAPIClient } from './openai/OpenAIApiClient'
import { OpenAIResponseAPIClient } from './openai/OpenAIResponseAPIClient'
import { PPIOAPIClient } from './ppio/PPIOAPIClient'

const logger = loggerService.withContext('ApiClientFactory')

/**
 * Factory for creating ApiClient instances based on provider configuration
 * 根据提供者配置创建ApiClient实例的工厂
 */
export class ApiClientFactory {
  /**
   * Create an ApiClient instance for the given provider
   * 为给定的提供者创建ApiClient实例
   */
  static create(provider: Provider): BaseApiClient {
    logger.debug(`Creating ApiClient for provider:`, {
      id: provider.id,
      type: provider.type
    })

    let instance: BaseApiClient

    // 首先检查特殊的provider id
    if (provider.id === 'aihubmix') {
      logger.debug(`Creating AihubmixAPIClient for provider: ${provider.id}`)
      instance = new AihubmixAPIClient(provider) as BaseApiClient
      return instance
    }
    if (provider.id === 'new-api') {
      logger.debug(`Creating NewAPIClient for provider: ${provider.id}`)
      instance = new NewAPIClient(provider) as BaseApiClient
      return instance
    }
    if (provider.id === 'ppio') {
      logger.debug(`Creating PPIOAPIClient for provider: ${provider.id}`)
      instance = new PPIOAPIClient(provider) as BaseApiClient
      return instance
    }

    // 然后检查标准的provider type
    switch (provider.type) {
      case 'openai':
        instance = new OpenAIAPIClient(provider) as BaseApiClient
        break
      case 'azure-openai':
      case 'openai-response':
        instance = new OpenAIResponseAPIClient(provider) as BaseApiClient
        break
      case 'gemini':
        instance = new GeminiAPIClient(provider) as BaseApiClient
        break
      case 'vertexai':
        instance = new VertexAPIClient(provider) as BaseApiClient
        break
      case 'anthropic':
        instance = new AnthropicAPIClient(provider) as BaseApiClient
        break
      case 'aws-bedrock':
        instance = new AwsBedrockAPIClient(provider) as BaseApiClient
        break
      default:
        logger.debug(`Using default OpenAIApiClient for provider: ${provider.id}`)
        instance = new OpenAIAPIClient(provider) as BaseApiClient
        break
    }

    return instance
  }
}

// 移除这个函数，它已经移动到 utils/index.ts
// export function isOpenAIProvider(provider: Provider) {
//   return !['anthropic', 'gemini'].includes(provider.type)
// }
