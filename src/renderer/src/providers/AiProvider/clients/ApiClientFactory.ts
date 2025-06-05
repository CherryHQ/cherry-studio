import { Provider } from '@renderer/types'

import { AnthropicAPIClient } from './anthropic/AnthropicAPIClient'
import { BaseApiClient } from './BaseApiClient'
import { OpenAIAPIClient } from './openai/OpenAIApiClient'

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
    // 然后检查标准的provider type
    switch (provider.type) {
      case 'openai':
      case 'azure-openai':
        console.log(`[ApiClientFactory] Creating OpenAIApiClient for provider: ${provider.id}`)
        instance = new OpenAIAPIClient(provider) as BaseApiClient
        break
      case 'gemini':
        throw new Error(`GeminiApiClient not implemented yet for provider: ${provider.id}`)
      case 'anthropic':
        instance = new AnthropicAPIClient(provider) as BaseApiClient
        break
      default:
        console.log(`[ApiClientFactory] Using default OpenAIApiClient for provider: ${provider.id}`)
        instance = new OpenAIAPIClient(provider) as BaseApiClient
        break
    }

    // console.log(`[ApiClientFactory] Wrapping ${provider.id} with middleware. Config:`, {
    //   completionsMiddlewares: middlewareConfig.completions?.length || 0,
    //   methodMiddlewares: Object.keys(middlewareConfig.methods || {}).length
    // })
    //
    // const wrappedInstance = wrapProviderWithMiddleware(instance, middlewareConfig)
    // console.log(`[ApiClientFactory] Successfully wrapped ${provider.id} with middleware`)
    //
    // return wrappedInstance
    return instance // Return the raw instance
  }
}
