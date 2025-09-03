import { loggerService } from '@logger'
import { isNewApiProvider } from '@renderer/config/providers'
import { Provider } from '@renderer/types'

import { AihubmixAPIClient } from './aihubmix/AihubmixAPIClient'
import { AnthropicAPIClient } from './anthropic/AnthropicAPIClient'
import { AwsBedrockAPIClient } from './aws/AwsBedrockAPIClient'
import { BaseApiClient } from './BaseApiClient'
import { CherryAiAPIClient } from './cherryai/CherryAiAPIClient'
import { GeminiAPIClient } from './gemini/GeminiAPIClient'
import { VertexAPIClient } from './gemini/VertexAPIClient'
import { NewAPIClient } from './newapi/NewAPIClient'
import { OpenAIAPIClient } from './openai/OpenAIApiClient'
import { OpenAIResponseAPIClient } from './openai/OpenAIResponseAPIClient'
import { PPIOAPIClient } from './ppio/PPIOAPIClient'
import { ZhipuAPIClient } from './zhipu/ZhipuAPIClient'
import { OVMSClient } from './ovms/OVMSClient'

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

    // 首先检查特殊的 Provider ID
    if (provider.id === 'cherryai') {
      instance = new CherryAiAPIClient(provider) as BaseApiClient
      return instance
    }

    if (provider.id === 'aihubmix') {
      logger.debug(`Creating AihubmixAPIClient for provider: ${provider.id}`)
      instance = new AihubmixAPIClient(provider) as BaseApiClient
      return instance
    }

    if (isNewApiProvider(provider)) {
      logger.debug(`Creating NewAPIClient for provider: ${provider.id}`)
      instance = new NewAPIClient(provider) as BaseApiClient
      return instance
    }

    if (provider.id === 'ppio') {
      logger.debug(`Creating PPIOAPIClient for provider: ${provider.id}`)
      instance = new PPIOAPIClient(provider) as BaseApiClient
      return instance
    }

    if (provider.id === 'zhipu') {
      instance = new ZhipuAPIClient(provider) as BaseApiClient
      return instance
    }

    if (provider.id === 'ovms') {
      logger.debug(`Creating OVMSClient for provider: ${provider.id}`)
      instance = new OVMSClient(provider) as BaseApiClient
      return instance
    }

    // 然后检查标准的 Provider Type
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
        logger.debug(`Creating VertexAPIClient for provider: ${provider.id}`)
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
