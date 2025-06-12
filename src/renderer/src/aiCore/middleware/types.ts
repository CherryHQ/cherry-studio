import { MCPToolResponse, Metrics, Usage, WebSearchResponse } from '@renderer/types'
import { Chunk, ErrorChunk } from '@renderer/types/chunk'
import {
  SdkInstance,
  SdkMessageParam,
  SdkParams,
  SdkRawChunk,
  SdkRawOutput,
  SdkTool,
  SdkToolCall
} from '@renderer/types/sdk'

import { BaseApiClient } from '../clients'
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
}

/**
 * Processing state shared between middlewares.
 */
export interface ProcessingState<
  TParams extends SdkParams = SdkParams,
  TMessageParam extends SdkMessageParam = SdkMessageParam,
  TToolCall extends SdkToolCall = SdkToolCall
> {
  sdkPayload?: TParams
  newReqMessages?: TMessageParam[]
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
    output?: SdkRawOutput | string
    isRecursiveCall?: boolean
    recursionDepth?: number
  }
  webSearchState?: {
    results?: WebSearchResponse
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
export interface CompletionsContext<
  TSdkParams extends SdkParams = SdkParams,
  TSdkMessageParam extends SdkMessageParam = SdkMessageParam,
  TSdkToolCall extends SdkToolCall = SdkToolCall,
  TSdkInstance extends SdkInstance = SdkInstance,
  TRawOutput extends SdkRawOutput = SdkRawOutput,
  TRawChunk extends SdkRawChunk = SdkRawChunk,
  TSdkSpecificTool extends SdkTool = SdkTool
> extends BaseContext {
  readonly methodName: 'completions' // 强制方法名为 'completions'

  apiClientInstance: BaseApiClient<
    TSdkInstance,
    TSdkParams,
    TRawOutput,
    TRawChunk,
    TSdkMessageParam,
    TSdkToolCall,
    TSdkSpecificTool
  >

  // --- Mutable internal state for the duration of the middleware chain ---
  _internal: ProcessingState<TSdkParams, TSdkMessageParam, TSdkToolCall> // 包含所有可变的处理状态
}

export interface MiddlewareAPI<Ctx extends BaseContext = BaseContext, Args extends any[] = any[]> {
  getContext: () => Ctx // Function to get the current context / 获取当前上下文的函数
  getOriginalArgs: () => Args // Function to get the original arguments of the method call / 获取方法调用原始参数的函数
}

/**
 * Base middleware type.
 */
export type Middleware<TContext extends BaseContext> = (
  api: MiddlewareAPI<TContext>
) => (
  next: (context: TContext, args: any[]) => Promise<unknown>
) => (context: TContext, args: any[]) => Promise<unknown>

export type MethodMiddleware = Middleware<BaseContext>

/**
 * Completions middleware type.
 */
export type CompletionsMiddleware<
  TSdkParams extends SdkParams = SdkParams,
  TSdkMessageParam extends SdkMessageParam = SdkMessageParam,
  TSdkToolCall extends SdkToolCall = SdkToolCall,
  TSdkInstance extends SdkInstance = SdkInstance,
  TRawOutput extends SdkRawOutput = SdkRawOutput,
  TRawChunk extends SdkRawChunk = SdkRawChunk,
  TSdkSpecificTool extends SdkTool = SdkTool
> = (
  api: MiddlewareAPI<
    CompletionsContext<
      TSdkParams,
      TSdkMessageParam,
      TSdkToolCall,
      TSdkInstance,
      TRawOutput,
      TRawChunk,
      TSdkSpecificTool
    >,
    [CompletionsParams]
  >
) => (
  next: (
    context: CompletionsContext<
      TSdkParams,
      TSdkMessageParam,
      TSdkToolCall,
      TSdkInstance,
      TRawOutput,
      TRawChunk,
      TSdkSpecificTool
    >,
    params: CompletionsParams
  ) => Promise<CompletionsResult>
) => (
  context: CompletionsContext<
    TSdkParams,
    TSdkMessageParam,
    TSdkToolCall,
    TSdkInstance,
    TRawOutput,
    TRawChunk,
    TSdkSpecificTool
  >,
  params: CompletionsParams
) => Promise<CompletionsResult>

// Re-export for convenience
export type { Chunk as OnChunkArg } from '@renderer/types/chunk'
