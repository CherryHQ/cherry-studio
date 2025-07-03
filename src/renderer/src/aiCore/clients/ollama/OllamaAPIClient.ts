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
  OllamaSdkMessageParam,
  OllamaSdkParams,
  OllamaSdkRawChunk,
  OllamaSdkRawOutput,
  RequestOptions
} from '@renderer/types/sdk'
import { Ollama, Tool as OllamaTool, ToolCall as OllamaToolCall } from 'ollama'

import { BaseApiClient } from '../BaseApiClient'
import { RequestTransformer, ResponseChunkTransformer } from '../types'

export class OllamaAPIClient extends BaseApiClient<
  Ollama,
  OllamaSdkParams,
  OllamaSdkRawOutput,
  OllamaSdkRawChunk,
  OllamaSdkMessageParam,
  OllamaToolCall,
  OllamaTool
> {
  constructor(provider: Provider) {
    super(provider)
  }

  /**
   * 核心API Endpoint
   **/

  override createCompletions(payload: OllamaSdkParams, options?: RequestOptions): Promise<OllamaSdkRawOutput> {
    throw new Error('Not implemented')
  }

  override generateImage(generateImageParams: GenerateImageParams): Promise<string[]> {
    throw new Error('Not implemented')
  }

  override getEmbeddingDimensions(model?: Model): Promise<number> {
    throw new Error('Not implemented')
  }

  override listModels(): Promise<SdkModel[]> {
    throw new Error('Not implemented')
  }

  override getSdkInstance(): Promise<Ollama> | Ollama {
    throw new Error('Not implemented')
  }

  /**
   * 中间件
   **/

  // 在 CoreRequestToSdkParamsMiddleware中使用
  override getRequestTransformer(): RequestTransformer<OllamaSdkParams, OllamaSdkMessageParam> {
    throw new Error('Not implemented')
  }
  // 在RawSdkChunkToGenericChunkMiddleware中使用
  override getResponseChunkTransformer(): ResponseChunkTransformer<TRawChunk> {
    throw new Error('Not implemented')
  }

  /**
   * 工具转换
   **/

  // Optional tool conversion methods - implement if needed by the specific provider
  override convertMcpToolsToSdkTools(mcpTools: MCPTool[]): TSdkSpecificTool[] {
    throw new Error('Not implemented')
  }

  override convertSdkToolCallToMcp(toolCall: OllamaToolCall, mcpTools: MCPTool[]): MCPTool | undefined {
    throw new Error('Not implemented')
  }

  override convertSdkToolCallToMcpToolResponse(toolCall: OllamaToolCall, mcpTool: MCPTool): ToolCallResponse {
    throw new Error('Not implemented')
  }

  override buildSdkMessages(
    currentReqMessages: OllamaSdkMessageParam[],
    output: OllamaSdkRawOutput | string | undefined,
    toolResults: OllamaSdkMessageParam[],
    toolCalls?: OllamaToolCall[]
  ): OllamaSdkMessageParam[] {
    throw new Error('Not implemented')
  }

  override estimateMessageTokens(message: OllamaSdkMessageParam): number {
    throw new Error('Not implemented')
  }

  override convertMcpToolResponseToSdkMessageParam(
    mcpToolResponse: MCPToolResponse,
    resp: MCPCallToolResponse,
    model: Model
  ): OllamaSdkMessageParam | undefined {
    throw new Error('Not implemented')
  }

  /**
   * 从SDK载荷中提取消息数组（用于中间件中的类型安全访问）
   * 不同的提供商可能使用不同的字段名（如messages、history等）
   */
  override extractMessagesFromSdkPayload(sdkPayload: OllamaSdkParams): OllamaSdkMessageParam[] {
    throw new Error('Not implemented')
  }
}
