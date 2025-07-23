import { isOpenAILLMModel } from '@renderer/config/models'
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
 * AihubmixAPIClient - 根据模型类型自动选择合适的ApiClient
 * 使用装饰器模式实现，在ApiClient层面进行模型路由
 */
export class AihubmixAPIClient extends BaseApiClient {
  // 使用联合类型而不是any，保持类型安全
  private clients: Map<string, AnthropicAPIClient | GeminiAPIClient | OpenAIResponseAPIClient | OpenAIAPIClient> =
    new Map()
  private defaultClient: OpenAIAPIClient
  private currentClient: BaseApiClient

  constructor(provider: Provider) {
    super(provider)

    const providerExtraHeaders = {
      ...provider,
      extra_headers: {
        ...provider.extra_headers,
        'APP-Code': 'MLTG2087'
      }
    }

    // 初始化各个client - 现在有类型安全
    const claudeClient = new AnthropicAPIClient(providerExtraHeaders)
    const geminiClient = new GeminiAPIClient({ ...providerExtraHeaders, apiHost: 'https://aihubmix.com/gemini' })
    const openaiClient = new OpenAIResponseAPIClient(providerExtraHeaders)
    const defaultClient = new OpenAIAPIClient(providerExtraHeaders)

    this.clients.set('claude', claudeClient)
    this.clients.set('gemini', geminiClient)
    this.clients.set('openai', openaiClient)
    this.clients.set('default', defaultClient)

    // 设置默认client
    this.defaultClient = defaultClient
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
    const id = model.id.toLowerCase()

    // claude开头
    if (id.startsWith('claude')) {
      const client = this.clients.get('claude')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Claude client not properly initialized')
      }
      return client
    }

    // gemini开头 且不以-nothink、-search结尾
    if (
      (id.startsWith('gemini') || id.startsWith('imagen')) &&
      !id.endsWith('-nothink') &&
      !id.endsWith('-search') &&
      !id.includes('embedding')
    ) {
      const client = this.clients.get('gemini')
      if (!client || !this.isValidClient(client)) {
        throw new Error('Gemini client not properly initialized')
      }
      return client
    }

    // OpenAI系列模型
    if (isOpenAILLMModel(model)) {
      const client = this.clients.get('openai')
      if (!client || !this.isValidClient(client)) {
        throw new Error('OpenAI client not properly initialized')
      }
      return client
    }

    return this.defaultClient as BaseApiClient
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
