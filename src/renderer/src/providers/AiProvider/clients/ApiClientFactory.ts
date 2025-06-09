import { Provider } from '@renderer/types'

import { AihubmixAPIClient } from './AihubmixAPIClient'
import { AnthropicAPIClient } from './anthropic/AnthropicAPIClient'
import { BaseApiClient } from './BaseApiClient'
import { GeminiAPIClient } from './gemini/GeminiAPIClient'
import { OpenAIAPIClient } from './openai/OpenAIApiClient'
import { OpenAIResponseAPIClient } from './openai/OpenAIResponseAPIClient'

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
    console.log(`[ApiClientFactory] Creating ApiClient for provider:`, {
      id: provider.id,
      type: provider.type
    })

    let instance: BaseApiClient

    // 首先检查特殊的provider id
    if (provider.id === 'aihubmix') {
      console.log(`[ApiClientFactory] Creating AihubmixAPIClient for provider: ${provider.id}`)
      instance = new AihubmixAPIClient(provider) as BaseApiClient
      return instance
    }

    // 然后检查标准的provider type
    switch (provider.type) {
      case 'openai':
      case 'azure-openai':
        console.log(`[ApiClientFactory] Creating OpenAIApiClient for provider: ${provider.id}`)
        instance = new OpenAIAPIClient(provider) as BaseApiClient
        break
      case 'openai-response':
        instance = new OpenAIResponseAPIClient(provider) as BaseApiClient
        break
      case 'gemini':
        instance = new GeminiAPIClient(provider) as BaseApiClient
        break
      case 'anthropic':
        instance = new AnthropicAPIClient(provider) as BaseApiClient
        break
      default:
        console.log(`[ApiClientFactory] Using default OpenAIApiClient for provider: ${provider.id}`)
        instance = new OpenAIAPIClient(provider) as BaseApiClient
        break
    }

    return instance
  }
}

export function isOpenAIProvider(provider: Provider) {
  return !['anthropic', 'gemini'].includes(provider.type)
}
