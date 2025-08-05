import { loggerService } from '@logger'
import { ApiClientFactory } from '@renderer/aiCore/clients/ApiClientFactory'
import { BaseApiClient } from '@renderer/aiCore/clients/BaseApiClient'
import { isDedicatedImageGenerationModel, isFunctionCallingModel } from '@renderer/config/models'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { withSpanResult } from '@renderer/services/SpanManagerService'
import { StartSpanParams } from '@renderer/trace/types/ModelSpanEntity'
import type { GenerateImageParams, Model, Provider } from '@renderer/types'
import type { RequestOptions, SdkModel } from '@renderer/types/sdk'
import { isEnabledToolUse } from '@renderer/utils/mcp-tools'

import { AihubmixAPIClient } from './clients/AihubmixAPIClient'
import { VertexAPIClient } from './clients/gemini/VertexAPIClient'
import { NewAPIClient } from './clients/NewAPIClient'
import { OpenAIResponseAPIClient } from './clients/openai/OpenAIResponseAPIClient'
import { CompletionsMiddlewareBuilder } from './middleware/builder'
import { MIDDLEWARE_NAME as AbortHandlerMiddlewareName } from './middleware/common/AbortHandlerMiddleware'
import { MIDDLEWARE_NAME as ErrorHandlerMiddlewareName } from './middleware/common/ErrorHandlerMiddleware'
import { MIDDLEWARE_NAME as FinalChunkConsumerMiddlewareName } from './middleware/common/FinalChunkConsumerMiddleware'
import { applyCompletionsMiddlewares } from './middleware/composer'
import { MIDDLEWARE_NAME as McpToolChunkMiddlewareName } from './middleware/core/McpToolChunkMiddleware'
import { MIDDLEWARE_NAME as RawStreamListenerMiddlewareName } from './middleware/core/RawStreamListenerMiddleware'
import { MIDDLEWARE_NAME as WebSearchMiddlewareName } from './middleware/core/WebSearchMiddleware'
import { MIDDLEWARE_NAME as ImageGenerationMiddlewareName } from './middleware/feat/ImageGenerationMiddleware'
import { MIDDLEWARE_NAME as ThinkingTagExtractionMiddlewareName } from './middleware/feat/ThinkingTagExtractionMiddleware'
import { MIDDLEWARE_NAME as ToolUseExtractionMiddlewareName } from './middleware/feat/ToolUseExtractionMiddleware'
import { MiddlewareRegistry } from './middleware/register'
import type { CompletionsParams, CompletionsResult } from './middleware/schemas'

const logger = loggerService.withContext('AiProvider')

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
    } else if (this.apiClient instanceof VertexAPIClient) {
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
      logger.silly('Builder Params', params)
      // 使用兼容性类型检查，避免typescript类型收窄和装饰器模式的问题
      const clientTypes = client.getClientCompatibilityType(model)
      const isOpenAICompatible =
        clientTypes.includes('OpenAIAPIClient') || clientTypes.includes('OpenAIResponseAPIClient')
      if (!isOpenAICompatible) {
        logger.silly('ThinkingTagExtractionMiddleware is removed')
        builder.remove(ThinkingTagExtractionMiddlewareName)
      }

      const isAnthropicOrOpenAIResponseCompatible =
        clientTypes.includes('AnthropicAPIClient') || clientTypes.includes('OpenAIResponseAPIClient')
      if (!isAnthropicOrOpenAIResponseCompatible) {
        logger.silly('RawStreamListenerMiddleware is removed')
        builder.remove(RawStreamListenerMiddlewareName)
      }
      if (!params.enableWebSearch) {
        logger.silly('WebSearchMiddleware is removed')
        builder.remove(WebSearchMiddlewareName)
      }
      if (!params.mcpTools?.length) {
        builder.remove(ToolUseExtractionMiddlewareName)
        logger.silly('ToolUseExtractionMiddleware is removed')
        builder.remove(McpToolChunkMiddlewareName)
        logger.silly('McpToolChunkMiddleware is removed')
      }
      if (isEnabledToolUse(params.assistant) && isFunctionCallingModel(model)) {
        builder.remove(ToolUseExtractionMiddlewareName)
        logger.silly('ToolUseExtractionMiddleware is removed')
      }
      if (params.callType !== 'chat') {
        logger.silly('AbortHandlerMiddleware is removed')
        builder.remove(AbortHandlerMiddlewareName)
      }
      if (params.callType === 'test') {
        builder.remove(ErrorHandlerMiddlewareName)
        logger.silly('ErrorHandlerMiddleware is removed')
        builder.remove(FinalChunkConsumerMiddlewareName)
        logger.silly('FinalChunkConsumerMiddleware is removed')
      }
    }

    const middlewares = builder.build()
    logger.silly('middlewares', middlewares)

    // 3. Create the wrapped SDK method with middlewares
    const wrappedCompletionMethod = applyCompletionsMiddlewares(client, client.createCompletions, middlewares)

    // 4. Execute the wrapped method with the original params
    const result = wrappedCompletionMethod(params, options)
    return result
  }

  public async completionsForTrace(params: CompletionsParams, options?: RequestOptions): Promise<CompletionsResult> {
    const traceName = params.assistant.model?.name
      ? `${params.assistant.model?.name}.${params.callType}`
      : `LLM.${params.callType}`

    const traceParams: StartSpanParams = {
      name: traceName,
      tag: 'LLM',
      topicId: params.topicId || '',
      modelName: params.assistant.model?.name
    }

    return await withSpanResult(this.completions.bind(this), traceParams, params, options)
  }

  public async models(): Promise<SdkModel[]> {
    return this.apiClient.listModels()
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    try {
      // Use the SDK instance to test embedding capabilities
      if (this.apiClient instanceof OpenAIResponseAPIClient && getProviderByModel(model).type === 'azure-openai') {
        this.apiClient = this.apiClient.getClient(model) as BaseApiClient
      }
      const dimensions = await this.apiClient.getEmbeddingDimensions(model)
      return dimensions
    } catch (error) {
      logger.error('Error getting embedding dimensions:', error as Error)
      throw error
    }
  }

  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    if (this.apiClient instanceof AihubmixAPIClient) {
      const client = this.apiClient.getClientForModel({ id: params.model } as Model)
      return client.generateImage(params)
    }
    return this.apiClient.generateImage(params)
  }

  public getBaseURL(): string {
    return this.apiClient.getBaseURL()
  }

  public getApiKey(): string {
    return this.apiClient.getApiKey()
  }
}
