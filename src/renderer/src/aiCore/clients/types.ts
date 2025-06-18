import Anthropic from '@anthropic-ai/sdk'
import { Assistant, MCPTool, MCPToolResponse, Model, ToolCallResponse } from '@renderer/types'
import { Provider } from '@renderer/types'
import {
  AnthropicSdkRawChunk,
  OpenAIResponseSdkRawChunk,
  OpenAIResponseSdkRawOutput,
  OpenAISdkRawChunk,
  SdkMessageParam,
  SdkParams,
  SdkRawChunk,
  SdkRawOutput,
  SdkTool,
  SdkToolCall
} from '@renderer/types/sdk'
import OpenAI from 'openai'

import { CompletionsParams, GenericChunk } from '../middleware/schemas'
import { CompletionsContext } from '../middleware/types'

/**
 * 原始流监听器接口
 */
export interface RawStreamListener<TRawChunk = SdkRawChunk> {
  onChunk?: (chunk: TRawChunk) => void
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: Error) => void
}

/**
 * OpenAI 专用的流监听器
 */
export interface OpenAIStreamListener extends RawStreamListener<OpenAISdkRawChunk> {
  onChoice?: (choice: OpenAI.Chat.Completions.ChatCompletionChunk.Choice) => void
  onFinishReason?: (reason: string) => void
}

/**
 * OpenAI Response 专用的流监听器
 */
export interface OpenAIResponseStreamListener<TChunk extends OpenAIResponseSdkRawChunk = OpenAIResponseSdkRawChunk>
  extends RawStreamListener<TChunk> {
  onMessage?: (response: OpenAIResponseSdkRawOutput) => void
}

/**
 * Anthropic 专用的流监听器
 */
export interface AnthropicStreamListener<TChunk extends AnthropicSdkRawChunk = AnthropicSdkRawChunk>
  extends RawStreamListener<TChunk> {
  onContentBlock?: (contentBlock: Anthropic.Messages.ContentBlock) => void
  onMessage?: (message: Anthropic.Messages.Message) => void
}

/**
 * 请求转换器接口
 */
export interface RequestTransformer<
  TSdkParams extends SdkParams = SdkParams,
  TMessageParam extends SdkMessageParam = SdkMessageParam
> {
  transform(
    completionsParams: CompletionsParams,
    assistant: Assistant,
    model: Model,
    isRecursiveCall?: boolean,
    recursiveSdkMessages?: TMessageParam[]
  ): Promise<{
    payload: TSdkParams
    messages: TMessageParam[]
    metadata?: Record<string, any>
  }>
}

/**
 * 响应块转换器接口
 */
export type ResponseChunkTransformer<TRawChunk extends SdkRawChunk = SdkRawChunk, TContext = any> = (
  context?: TContext
) => Transformer<TRawChunk, GenericChunk>

export interface ResponseChunkTransformerContext {
  isStreaming: boolean
  isEnabledToolCalling: boolean
  isEnabledWebSearch: boolean
  isEnabledReasoning: boolean
  mcpTools: MCPTool[]
  provider: Provider
}

/**
 * API客户端接口
 */
export interface ApiClient<
  TSdkInstance = any,
  TSdkParams extends SdkParams = SdkParams,
  TRawOutput extends SdkRawOutput = SdkRawOutput,
  TRawChunk extends SdkRawChunk = SdkRawChunk,
  TMessageParam extends SdkMessageParam = SdkMessageParam,
  TToolCall extends SdkToolCall = SdkToolCall,
  TSdkSpecificTool extends SdkTool = SdkTool
> {
  provider: Provider

  // 核心方法 - 在中间件架构中，这个方法可能只是一个占位符
  // 实际的SDK调用由SdkCallMiddleware处理
  // completions(params: CompletionsParams): Promise<CompletionsResult>

  createCompletions(payload: TSdkParams): Promise<TRawOutput>

  // SDK相关方法
  getSdkInstance(): Promise<TSdkInstance> | TSdkInstance
  getRequestTransformer(): RequestTransformer<TSdkParams, TMessageParam>
  getResponseChunkTransformer(ctx: CompletionsContext): ResponseChunkTransformer<TRawChunk>

  // 原始流监听方法
  attachRawStreamListener?(rawOutput: TRawOutput, listener: RawStreamListener<TRawChunk>): TRawOutput

  // 工具转换相关方法 (保持可选，因为不是所有Provider都支持工具)
  convertMcpToolsToSdkTools(mcpTools: MCPTool[]): TSdkSpecificTool[]
  convertMcpToolResponseToSdkMessageParam?(
    mcpToolResponse: MCPToolResponse,
    resp: any,
    model: Model
  ): TMessageParam | undefined
  convertSdkToolCallToMcp?(toolCall: TToolCall, mcpTools: MCPTool[]): MCPTool | undefined
  convertSdkToolCallToMcpToolResponse(toolCall: TToolCall, mcpTool: MCPTool): ToolCallResponse

  // 构建SDK特定的消息列表，用于工具调用后的递归调用
  buildSdkMessages(
    currentReqMessages: TMessageParam[],
    output: TRawOutput | string,
    toolResults: TMessageParam[],
    toolCalls?: TToolCall[]
  ): TMessageParam[]

  // 从SDK载荷中提取消息数组（用于中间件中的类型安全访问）
  extractMessagesFromSdkPayload(sdkPayload: TSdkParams): TMessageParam[]
}
