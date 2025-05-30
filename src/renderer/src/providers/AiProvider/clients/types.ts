import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import { Assistant, MCPTool, Model } from '@renderer/types'
import { Provider } from '@renderer/types'
import OpenAI, { AzureOpenAI } from 'openai'

import { CompletionsParams, CompletionsResult, GenericChunk } from '../../middleware/schemas'
import { OpenAISdkParams, OpenAISdkRawChunk, OpenAISdkRawOutput } from './openai/types'

/**
 * 请求转换器接口
 */
export interface RequestTransformer<TSdkParams = any> {
  transform(
    completionsParams: CompletionsParams,
    assistant: Assistant,
    model: Model,
    provider?: Provider
  ): Promise<{
    payload: TSdkParams
    metadata?: Record<string, any>
  }>
}

/**
 * 响应块转换器接口
 */
export type ResponseChunkTransformer<TRawChunk = any, TContext = any> = (
  rawChunk: TRawChunk,
  context?: TContext
) => AsyncGenerator<GenericChunk>

export interface ResponseChunkTransformerContext {
  isStreaming: boolean
  isEnabledToolCalling: boolean
  isEnabledWebSearch: boolean
  isEnabledReasoning: boolean
  mcpTools: MCPTool[]
}

export type SdkInstance = OpenAI | AzureOpenAI | Anthropic | GoogleGenAI
export type SdkParams = OpenAISdkParams
export type SdkRawChunk = OpenAISdkRawChunk
export type SdkRawOutput = OpenAISdkRawOutput
export type SdkMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
export type SdkToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall

/**
 * API客户端接口
 */
export interface ApiClient<TSdkInstance = any, TSdkParams = any, TRawChunk = any, TResponseContext = any> {
  provider: Provider

  // 核心方法 - 在中间件架构中，这个方法可能只是一个占位符
  // 实际的SDK调用由SdkCallMiddleware处理
  completions(params: CompletionsParams): Promise<CompletionsResult>

  // SDK相关方法
  getSdkInstance(): Promise<TSdkInstance> | TSdkInstance
  getRequestTransformer(): RequestTransformer<TSdkParams>
  getResponseChunkTransformer(): ResponseChunkTransformer<TRawChunk, TResponseContext>

  // 工具转换相关方法 (保持可选，因为不是所有Provider都支持工具)
  convertMcpToolsToSdkTools?(mcpTools: any[]): any[]
  convertMcpToolResponseToSdkMessage?(mcpToolResponse: any, resp: any, model: Model): any
}
