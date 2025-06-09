import { ApiClientFactory } from '@renderer/providers/AiProvider/clients/ApiClientFactory'
import { BaseApiClient } from '@renderer/providers/AiProvider/clients/BaseApiClient'
import type { GenerateImageParams, Model, Provider } from '@renderer/types'
import { RequestOptions, SdkModel } from '@renderer/types/sdk'

import { CompletionsMiddlewareBuilder } from '../middleware/builder'
import { applyCompletionsMiddlewares } from '../middleware/composer'
import { MIDDLEWARE_NAME as McpToolChunkMiddlewareName } from '../middleware/core/McpToolChunkMiddleware'
import { MIDDLEWARE_NAME as ThinkChunkMiddlewareName } from '../middleware/core/ThinkChunkMiddleware'
import { MIDDLEWARE_NAME as WebSearchMiddlewareName } from '../middleware/core/WebSearchMiddleware'
import { MIDDLEWARE_NAME as ThinkingTagExtractionMiddlewareName } from '../middleware/feat/ThinkingTagExtractionMiddleware'
import { MIDDLEWARE_NAME as ToolUseExtractionMiddlewareName } from '../middleware/feat/ToolUseExtractionMiddleware'
import { CompletionsParams, CompletionsResult } from '../middleware/schemas'
import { AihubmixAPIClient } from './clients/AihubmixAPIClient'
import { OpenAIResponseAPIClient } from './clients/openai/OpenAIResponseAPIClient'

export default class AiProvider {
  private apiClient: BaseApiClient

  constructor(provider: Provider) {
    // Use the new ApiClientFactory to get a BaseApiClient instance
    this.apiClient = ApiClientFactory.create(provider)
  }

  public async completions(params: CompletionsParams, options?: RequestOptions): Promise<CompletionsResult> {
    // 1. Build the middleware chain
    const builder = CompletionsMiddlewareBuilder.withDefaults()
    if (!params.enableReasoning) {
      builder.remove(ThinkingTagExtractionMiddlewareName)
      builder.remove(ThinkChunkMiddlewareName)
    }
    if (!params.enableWebSearch) {
      builder.remove(WebSearchMiddlewareName)
    }
    if (!params.mcpTools?.length) {
      builder.remove(ToolUseExtractionMiddlewareName)
      builder.remove(McpToolChunkMiddlewareName)
    }

    const middlewares = builder.build()

    const model = params.assistant.model
    if (!model) {
      return Promise.reject(new Error('Model is required'))
    }

    // 根据client类型选择合适的处理方式
    let client: BaseApiClient

    if (this.apiClient instanceof AihubmixAPIClient) {
      // AihubmixAPIClient: 根据模型选择合适的子client
      client = this.apiClient.getClientForModel(model)
      if (client instanceof OpenAIResponseAPIClient) {
        client = client.getClient(model) as BaseApiClient
      }
    } else if (this.apiClient instanceof OpenAIResponseAPIClient) {
      // OpenAIResponseAPIClient: 根据模型特征选择API类型
      client = this.apiClient.getClient(model) as BaseApiClient
    } else {
      // 其他client直接使用
      client = this.apiClient
    }

    // 2. Create the wrapped SDK method with middlewares
    const wrappedCompletionMethod = applyCompletionsMiddlewares(client, client.createCompletions, middlewares)

    // 3. Execute the wrapped method with the original params
    return wrappedCompletionMethod(params, options)
  }

  public async models(): Promise<SdkModel[]> {
    return this.apiClient.listModels()
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    try {
      // Use the SDK instance to test embedding capabilities
      const dimensions = await this.apiClient.getEmbeddingDimensions(model)
      return dimensions
    } catch (error) {
      console.error('Error getting embedding dimensions:', error)
      return 0
    }
  }

  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    return this.apiClient.generateImage(params)
  }
}
