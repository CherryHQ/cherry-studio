import { ApiClientFactory } from '@renderer/aiCore/clients/ApiClientFactory'
import { BaseApiClient } from '@renderer/aiCore/clients/BaseApiClient'
import { isDedicatedImageGenerationModel, isFunctionCallingModel } from '@renderer/config/models'
import type { GenerateImageParams, Model, Provider } from '@renderer/types'
import { RequestOptions, SdkModel } from '@renderer/types/sdk'
import { isEnabledToolUse } from '@renderer/utils/mcp-tools'

import { OpenAIAPIClient } from './clients'
import { AihubmixAPIClient } from './clients/AihubmixAPIClient'
import { AnthropicAPIClient } from './clients/anthropic/AnthropicAPIClient'
import { NewAPIClient } from './clients/NewAPIClient'
import { OpenAIResponseAPIClient } from './clients/openai/OpenAIResponseAPIClient'
import { CompletionsMiddlewareBuilder } from './middleware/builder'
import { MIDDLEWARE_NAME as AbortHandlerMiddlewareName } from './middleware/common/AbortHandlerMiddleware'
import { MIDDLEWARE_NAME as ErrorHandlerMiddlewareName } from './middleware/common/ErrorHandlerMiddleware'
import { MIDDLEWARE_NAME as FinalChunkConsumerMiddlewareName } from './middleware/common/FinalChunkConsumerMiddleware'
import { applyCompletionsMiddlewares } from './middleware/composer'
import { MIDDLEWARE_NAME as McpToolChunkMiddlewareName } from './middleware/core/McpToolChunkMiddleware'
import { MIDDLEWARE_NAME as RawStreamListenerMiddlewareName } from './middleware/core/RawStreamListenerMiddleware'
import { MIDDLEWARE_NAME as ThinkChunkMiddlewareName } from './middleware/core/ThinkChunkMiddleware'
import { MIDDLEWARE_NAME as WebSearchMiddlewareName } from './middleware/core/WebSearchMiddleware'
import { MIDDLEWARE_NAME as ImageGenerationMiddlewareName } from './middleware/feat/ImageGenerationMiddleware'
import { MIDDLEWARE_NAME as ThinkingTagExtractionMiddlewareName } from './middleware/feat/ThinkingTagExtractionMiddleware'
import { MIDDLEWARE_NAME as ToolUseExtractionMiddlewareName } from './middleware/feat/ToolUseExtractionMiddleware'
import { MiddlewareRegistry } from './middleware/register'
import { CompletionsParams, CompletionsResult } from './middleware/schemas'

export default class AiProvider {
  private apiClient: BaseApiClient

  constructor(provider: Provider) {
    // Use the new ApiClientFactory to get a BaseApiClient instance
    this.apiClient = ApiClientFactory.create(provider)
  }

  public async completions(params: CompletionsParams, options?: RequestOptions): Promise<CompletionsResult> {
    // 1. 根据模型识别正确的客户端
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
    } else if (this.apiClient instanceof NewAPIClient) {
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

    // 2. 构建中间件链
    const builder = CompletionsMiddlewareBuilder.withDefaults()
    // images api
    if (isDedicatedImageGenerationModel(model)) {
      builder.clear()
      builder
        .add(MiddlewareRegistry[FinalChunkConsumerMiddlewareName])
        .add(MiddlewareRegistry[ErrorHandlerMiddlewareName])
        .add(MiddlewareRegistry[AbortHandlerMiddlewareName])
        .add(MiddlewareRegistry[ImageGenerationMiddlewareName])
    } else {
      // Existing logic for other models
      if (!params.enableReasoning) {
        // 这里注释掉不会影响正常的关闭思考,可忽略不计的性能下降
        // builder.remove(ThinkingTagExtractionMiddlewareName)
        builder.remove(ThinkChunkMiddlewareName)
      }
      // 注意：用client判断会导致typescript类型收窄
      if (!(this.apiClient instanceof OpenAIAPIClient) && !(this.apiClient instanceof OpenAIResponseAPIClient)) {
        builder.remove(ThinkingTagExtractionMiddlewareName)
      }
      if (!(this.apiClient instanceof AnthropicAPIClient) && !(this.apiClient instanceof OpenAIResponseAPIClient)) {
        builder.remove(RawStreamListenerMiddlewareName)
      }
      if (!params.enableWebSearch) {
        builder.remove(WebSearchMiddlewareName)
      }
      if (!params.mcpTools?.length) {
        builder.remove(ToolUseExtractionMiddlewareName)
        builder.remove(McpToolChunkMiddlewareName)
      }
      if (isEnabledToolUse(params.assistant) && isFunctionCallingModel(model)) {
        builder.remove(ToolUseExtractionMiddlewareName)
      }
      if (params.callType !== 'chat') {
        builder.remove(AbortHandlerMiddlewareName)
      }
      if (params.callType === 'test') {
        builder.remove(ErrorHandlerMiddlewareName)
        builder.remove(FinalChunkConsumerMiddlewareName)
      }
    }

    const middlewares = builder.build()

    // 3. Create the wrapped SDK method with middlewares
    const wrappedCompletionMethod = applyCompletionsMiddlewares(client, client.createCompletions, middlewares)

    // 4. Execute the wrapped method with the original params
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
      throw error
    }
  }

  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    return this.apiClient.generateImage(params)
  }

  public getBaseURL(): string {
    return this.apiClient.getBaseURL()
  }

  public getApiKey(): string {
    return this.apiClient.getApiKey()
  }
}
