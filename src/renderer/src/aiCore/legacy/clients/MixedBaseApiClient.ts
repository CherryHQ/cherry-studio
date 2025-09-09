import {
  GenerateImageParams,
  MCPCallToolResponse,
  MCPTool,
  MCPToolResponse,
  Model,
  Provider,
  ToolCallResponse
} from '@renderer/types'
import {
  RequestOptions,
  SdkInstance,
  SdkMessageParam,
  SdkModel,
  SdkParams,
  SdkRawChunk,
  SdkRawOutput,
  SdkTool,
  SdkToolCall
} from '@renderer/types/sdk'

import { CompletionsContext } from '../middleware/types'
import { AnthropicAPIClient } from './anthropic/AnthropicAPIClient'
import { BaseApiClient } from './BaseApiClient'
import { GeminiAPIClient } from './gemini/GeminiAPIClient'
import { OpenAIAPIClient } from './openai/OpenAIApiClient'
import { OpenAIResponseAPIClient } from './openai/OpenAIResponseAPIClient'
import { RequestTransformer, ResponseChunkTransformer } from './types'

/**
 * MixedAPIClient - 适用于可能含有多种接口类型的Provider
 */
export abstract class MixedBaseAPIClient extends BaseApiClient {
  // 使用联合类型而不是any，保持类型安全
  protected abstract clients: Map<
    string,
    AnthropicAPIClient | GeminiAPIClient | OpenAIResponseAPIClient | OpenAIAPIClient
  >
  protected abstract defaultClient: OpenAIAPIClient
  protected abstract currentClient: BaseApiClient

  constructor(provider: Provider) {
    super(provider)
  }

  override getBaseURL(): string {
    if (!this.currentClient) {
      return this.provider.apiHost
    }
    return this.currentClient.getBaseURL()
  }

  /**
   * 类型守卫：确保client是BaseApiClient的实例
   */
  protected isValidClient(client: unknown): client is BaseApiClient {
    return (
      client !== null &&
      client !== undefined &&
      typeof client === 'object' &&
      'createCompletions' in client &&
      'getRequestTransformer' in client &&
      'getResponseChunkTransformer' in client
    )
  }

  /**
   * 根据模型获取合适的client
   */
  protected abstract getClient(model: Model): BaseApiClient

  /**
   * 根据模型选择合适的client并委托调用
   */
  public getClientForModel(model: Model): BaseApiClient {
    this.currentClient = this.getClient(model)
    return this.currentClient
  }

  /**
   * 重写基类方法，返回内部实际使用的客户端类型
   */
  public override getClientCompatibilityType(model?: Model): string[] {
    if (!model) {
      return [this.constructor.name]
    }

    const actualClient = this.getClient(model)
    return actualClient.getClientCompatibilityType(model)
  }

  /**
   * 从SDK payload中提取模型ID
   */
  protected extractModelFromPayload(payload: SdkParams): string | null {
    // 不同的SDK可能有不同的字段名
    if ('model' in payload && typeof payload.model === 'string') {
      return payload.model
    }
    return null
  }

  // ============ BaseApiClient 的抽象方法 ============

  async createCompletions(payload: SdkParams, options?: RequestOptions): Promise<SdkRawOutput> {
    // 尝试从payload中提取模型信息来选择client
    const modelId = this.extractModelFromPayload(payload)
    if (modelId) {
      const modelObj = { id: modelId } as Model
      const targetClient = this.getClient(modelObj)
      return targetClient.createCompletions(payload, options)
    }

    // 如果无法从payload中提取模型，使用当前设置的client
    return this.currentClient.createCompletions(payload, options)
  }

  async generateImage(params: GenerateImageParams): Promise<string[]> {
    return this.currentClient.generateImage(params)
  }

  async getEmbeddingDimensions(model?: Model): Promise<number> {
    const client = model ? this.getClient(model) : this.currentClient
    return client.getEmbeddingDimensions(model)
  }

  async listModels(): Promise<SdkModel[]> {
    // 可以聚合所有client的模型，或者使用默认client
    return this.defaultClient.listModels()
  }

  async getSdkInstance(): Promise<SdkInstance> {
    return this.currentClient.getSdkInstance()
  }

  getRequestTransformer(): RequestTransformer<SdkParams, SdkMessageParam> {
    return this.currentClient.getRequestTransformer()
  }

  getResponseChunkTransformer(ctx: CompletionsContext): ResponseChunkTransformer<SdkRawChunk> {
    return this.currentClient.getResponseChunkTransformer(ctx)
  }

  convertMcpToolsToSdkTools(mcpTools: MCPTool[]): SdkTool[] {
    return this.currentClient.convertMcpToolsToSdkTools(mcpTools)
  }

  convertSdkToolCallToMcp(toolCall: SdkToolCall, mcpTools: MCPTool[]): MCPTool | undefined {
    return this.currentClient.convertSdkToolCallToMcp(toolCall, mcpTools)
  }

  convertSdkToolCallToMcpToolResponse(toolCall: SdkToolCall, mcpTool: MCPTool): ToolCallResponse {
    return this.currentClient.convertSdkToolCallToMcpToolResponse(toolCall, mcpTool)
  }

  buildSdkMessages(
    currentReqMessages: SdkMessageParam[],
    output: SdkRawOutput | string,
    toolResults: SdkMessageParam[],
    toolCalls?: SdkToolCall[]
  ): SdkMessageParam[] {
    return this.currentClient.buildSdkMessages(currentReqMessages, output, toolResults, toolCalls)
  }

  estimateMessageTokens(message: SdkMessageParam): number {
    return this.currentClient.estimateMessageTokens(message)
  }

  convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): SdkMessageParam | undefined {
    const client = this.getClient(model)
    return client.convertMcpToolResponseToSdkMessageParam(mcpToolResponse, resp, model)
  }

  extractMessagesFromSdkPayload(sdkPayload: SdkParams): SdkMessageParam[] {
    return this.currentClient.extractMessagesFromSdkPayload(sdkPayload)
  }
}
