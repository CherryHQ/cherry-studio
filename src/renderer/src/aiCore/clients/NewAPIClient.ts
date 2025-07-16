import { isSupportedModel } from '@renderer/config/models'
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
  NewApiModel,
  RequestOptions,
  SdkInstance,
  SdkMessageParam,
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

export class NewAPIClient extends BaseApiClient {
  // 使用联合类型而不是any，保持类型安全
  private clients: Map<string, AnthropicAPIClient | GeminiAPIClient | OpenAIResponseAPIClient | OpenAIAPIClient> =
    new Map()
  private defaultClient: OpenAIAPIClient
  private currentClient: BaseApiClient

  constructor(provider: Provider) {
    super(provider)

    const claudeClient = new AnthropicAPIClient(provider)
    const geminiClient = new GeminiAPIClient(provider)
    const openaiClient = new OpenAIAPIClient(provider)
    const openaiResponseClient = new OpenAIResponseAPIClient(provider)

    this.clients.set('claude', claudeClient)
    this.clients.set('gemini', geminiClient)
    this.clients.set('openai', openaiClient)
    this.clients.set('openai-response', openaiResponseClient)

    // 设置默认client
    this.defaultClient = openaiClient
    this.currentClient = this.defaultClient as BaseApiClient
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
  private isValidClient(client: unknown): client is BaseApiClient {
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
  private getClient(model: Model): BaseApiClient {
    if (!model.endpoint_type) {
      throw new Error('Model endpoint type is not defined')
    }

    if (model.endpoint_type === 'anthropic') {
      const client = this.clients.get('claude')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Failed to get claude client')
      }
      return client
    }

    if (model.endpoint_type === 'openai-response') {
      const client = this.clients.get('openai-response')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Failed to get openai-response client')
      }
      return client
    }

    if (model.endpoint_type === 'gemini') {
      const client = this.clients.get('gemini')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Failed to get gemini client')
      }
      return client
    }

    if (model.endpoint_type === 'openai' || model.endpoint_type === 'image-generation') {
      const client = this.clients.get('openai')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Failed to get openai client')
      }
      return client
    }

    throw new Error('Invalid model endpoint type: ' + model.endpoint_type)
  }

  /**
   * 根据模型选择合适的client并委托调用
   */
  public getClientForModel(model: Model): BaseApiClient {
    this.currentClient = this.getClient(model)
    return this.currentClient
  }

  // ============ BaseApiClient 抽象方法实现 ============

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

  /**
   * 从SDK payload中提取模型ID
   */
  private extractModelFromPayload(payload: SdkParams): string | null {
    // 不同的SDK可能有不同的字段名
    if ('model' in payload && typeof payload.model === 'string') {
      return payload.model
    }
    return null
  }

  async generateImage(params: GenerateImageParams): Promise<string[]> {
    return this.currentClient.generateImage(params)
  }

  async getEmbeddingDimensions(model?: Model): Promise<number> {
    const client = model ? this.getClient(model) : this.currentClient
    return client.getEmbeddingDimensions(model)
  }

  override async listModels(): Promise<NewApiModel[]> {
    try {
      const sdk = await this.defaultClient.getSdkInstance()
      // Explicitly type the expected response shape so that `data` is recognised.
      const response = await sdk.request<{ data: NewApiModel[] }>({
        method: 'get',
        path: '/models'
      })
      const models: NewApiModel[] = response.data ?? []

      models.forEach((model) => {
        model.id = model.id.trim()
      })

      return models.filter(isSupportedModel)
    } catch (error) {
      console.error('Error listing models:', error)
      return []
    }
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

  estimateMessageTokens(message: SdkMessageParam): number {
    return this.currentClient.estimateMessageTokens(message)
  }
}
