import { MCPToolResponse, Metrics, Usage, WebSearchResponse } from '@renderer/types'
import { Chunk, ErrorChunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import { SdkMessageParam, SdkParams, SdkToolCall } from '@renderer/types/sdk'

import { BaseApiClient } from '../AiProvider/clients'
import { CompletionsParams, CompletionsResult } from './schemas'

/**
 * Symbol to uniquely identify middleware context objects.
 */
export const MIDDLEWARE_CONTEXT_SYMBOL = Symbol.for('AiProviderMiddlewareContext')

/**
 * Defines the structure for the onChunk callback function.
 */
export type OnChunkFunction = (chunk: Chunk | ErrorChunk) => void

/**
 * Base context that carries information about the current method call.
 */
export interface BaseContext {
  [MIDDLEWARE_CONTEXT_SYMBOL]: true
  methodName: string
  originalArgs: Readonly<any[]>
  apiClientInstance: BaseApiClient
}

/**
 * Processing state shared between middlewares.
 */
export interface ProcessingState<
  TParams extends SdkParams = SdkParams,
  TMessageParam extends SdkMessageParam = SdkMessageParam,
  TToolCall extends SdkToolCall = SdkToolCall
> {
  sdkPayload?: Readonly<TParams>
  newReqMessages?: TMessageParam[]
  processedMessages?: Message[]
  observer?: {
    usage?: Usage
    metrics?: Metrics
  }
  toolProcessingState?: {
    pendingToolCalls?: Array<TToolCall>
    executingToolCalls?: Array<{
      sdkToolCall: TToolCall
      mcpToolResponse: MCPToolResponse
    }>
    assistantMessage?: TMessageParam
    isRecursiveCall?: boolean
    recursionDepth?: number
  }
  webSearchState?: {
    results?: WebSearchResponse[]
  }
  flowControl?: {
    abortController?: AbortController
    abortSignal?: AbortSignal
    cleanup?: () => void
  }
  enhancedDispatch?: (context: CompletionsContext, params: CompletionsParams) => Promise<CompletionsResult>
  customState?: Record<string, any>
}

/**
 * Extended context for completions method.
 */
export interface CompletionsContext extends BaseContext {
  readonly methodName: 'completions' // 强制方法名为 'completions'

  // --- Mutable internal state for the duration of the middleware chain ---
  _internal: ProcessingState // 包含所有可变的处理状态
}

export interface MiddlewareAPI<Ctx extends BaseContext = BaseContext, Args extends any[] = any[]> {
  getContext: () => Ctx // Function to get the current context / 获取当前上下文的函数
  getOriginalArgs: () => Args // Function to get the original arguments of the method call / 获取方法调用原始参数的函数
  getApiClientInstance: () => BaseApiClient // Function to get the ApiClient instance / 获取ApiClient实例的函数
}

/**
 * Base middleware type.
 */
export type Middleware<TContext extends BaseContext> = (
  api: MiddlewareAPI<TContext>
) => (next: (context: TContext, args: any[]) => Promise<any>) => (context: TContext, args: any[]) => Promise<any>

export type MethodMiddleware = Middleware<BaseContext>

/**
 * Completions middleware type.
 */
export type CompletionsMiddleware = (
  api: MiddlewareAPI<CompletionsContext, [CompletionsParams]>
) => (
  next: (context: CompletionsContext, params: CompletionsParams) => Promise<CompletionsResult>
) => (context: CompletionsContext, params: CompletionsParams) => Promise<CompletionsResult>

// Re-export for convenience
export type { Chunk as OnChunkArg } from '@renderer/types/chunk'
