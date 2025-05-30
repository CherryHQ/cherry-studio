import { MCPTool, MCPToolResponse, Metrics, Usage, WebSearchResponse } from '@renderer/types'
import { Chunk, ErrorChunk } from '@renderer/types/chunk'

import { BaseApiClient, SdkParams, SdkRawChunk, SdkRawOutput, SdkToolCall } from '../AiProvider/clients'
import { CompletionsParams, GenericChunk, OnFilterMessagesFunction } from './schemas'

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
  apiClientInstance: BaseApiClient
  originalParams: Readonly<CompletionsParams>

  readonly onChunkCallback: (chunk: Chunk) => void
  readonly onFilterMessagesCallback?: OnFilterMessagesFunction // 可选
}

/**
 * Processing state shared between middlewares.
 */
export interface ProcessingState {
  sdkPayload?: Readonly<SdkParams>
  capabilities?: {
    isStreaming: boolean
    isEnabledToolCalling: boolean
    isEnabledWebSearch: boolean
    isEnabledReasoning: boolean
    mcpTools: MCPTool[]
  }
  observer?: {
    usage?: Usage
    metrics?: Metrics
  }
  apiCall?: {
    requestTimestamp?: number
    rawSdkOutput?: SdkRawOutput
    rawSdkStream?: ReadableStream<SdkRawChunk> // Output from StreamAdapterMiddleware, consumed by SdkChunkToGenericChunkMiddleware
    genericChunkStream?: ReadableStream<GenericChunk> // Output from SdkChunkToGenericChunkMiddleware, consumed by Generic processors (Text, Think, Image, etc.)
  }
  toolProcessingState?: {
    pendingToolCalls: Array<SdkToolCall>
    executingToolCalls: Array<{
      sdkToolCall: SdkToolCall
      mcpToolResponse: MCPToolResponse
    }>
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

/**
 * Next function type in Koa style.
 */
export type Next = () => Promise<void>

/**
 * Base middleware type.
 */
export type Middleware<TContext extends BaseContext> = (ctx: TContext, next: Next) => Promise<void>

/**
 * Completions middleware type.
 */
export type CompletionsMiddleware = Middleware<CompletionsContext>

/**
 * Generic method middleware type.
 */
export type MethodMiddleware = Middleware<BaseContext>

/**
 * Base configuration for any middleware.
 */
export interface BaseMiddlewareConfig {
  id?: string
  name?: string
}

/**
 * Middleware configuration structure.
 */
export interface MiddlewareConfig extends BaseMiddlewareConfig {
  completions?: CompletionsMiddleware[]
  methods?: Record<string, MethodMiddleware[]>
}

// Re-export for convenience
export type { Chunk as OnChunkArg } from '@renderer/types/chunk'
