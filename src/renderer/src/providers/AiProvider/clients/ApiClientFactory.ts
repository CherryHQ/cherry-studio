import { wrapProviderWithMiddleware } from '@renderer/providers/middleware'
import middlewareConfig from '@renderer/providers/middleware/register'
import { Provider } from '@renderer/types'

import { BaseApiClient } from './BaseApiClient'
import { OpenAIApiClient } from './openai/OpenAIApiClient'
import { ResponseChunkTransformerContext, SdkInstance, SdkParams, SdkRawChunk } from './types'

/**
 * Factory for creating ApiClient instances based on provider configuration
 * 根据提供者配置创建ApiClient实例的工厂
 */
export class ApiClientFactory {
  /**
   * Create an ApiClient instance for the given provider
   * 为给定的提供者创建ApiClient实例
   */
  static create(
    provider: Provider
  ): BaseApiClient<SdkInstance, SdkParams, SdkRawChunk, ResponseChunkTransformerContext> {
    console.log(`[ApiClientFactory] Creating ApiClient for provider:`, {
      id: provider.id,
      type: provider.type
    })

    let instance: BaseApiClient<SdkInstance, SdkParams, SdkRawChunk, ResponseChunkTransformerContext>
    // 然后检查标准的provider type
    switch (provider.type) {
      case 'openai':
      case 'azure-openai':
        console.log(`[ApiClientFactory] Creating OpenAIApiClient for provider: ${provider.id}`)
        instance = new OpenAIApiClient(provider)
        break
      case 'gemini':
        throw new Error(`GeminiApiClient not implemented yet for provider: ${provider.id}`)
      case 'anthropic':
        throw new Error(`ClaudeApiClient not implemented yet for provider: ${provider.id}`)
      default:
        console.log(`[ApiClientFactory] Using default OpenAIApiClient for provider: ${provider.id}`)
        instance = new OpenAIApiClient(provider)
        break
    }

    console.log(`[ApiClientFactory] Wrapping ${provider.id} with middleware. Config:`, {
      completionsMiddlewares: middlewareConfig.completions?.length || 0,
      methodMiddlewares: Object.keys(middlewareConfig.methods || {}).length
    })

    const wrappedInstance = wrapProviderWithMiddleware(instance, middlewareConfig)
    console.log(`[ApiClientFactory] Successfully wrapped ${provider.id} with middleware`)

    return wrappedInstance
  }
}
