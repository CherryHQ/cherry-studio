import type { Assistant, MCPTool, MCPToolResponse, Message, Metrics, Usage, WebSearchResponse } from '@renderer/types'
import type { Chunk, ErrorChunk } from '@renderer/types/chunk'
import type {
  SdkInstance,
  SdkMessageParam,
  SdkParams,
  SdkRawChunk,
  SdkRawOutput,
  SdkTool,
  SdkToolCall
} from '@renderer/types/sdk'

import { type BaseApiClient } from '../clients'

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

// ============================================================================
// Core Request Types - 核心请求结构
// ============================================================================
/**
 * 标准化的内部核心请求结构，用于所有AI Provider的统一处理
 * 这是应用层参数转换后的标准格式，不包含回调函数和控制逻辑
 */

export interface CompletionsParams {
  /**
   * 调用的业务场景类型，用于中间件判断是否执行
   * 'chat': 主要对话流程
   * 'translate': 翻译
   * 'summary': 摘要
   * 'search': 搜索摘要
   * 'generate': 生成
   * 'check': API检查
   * 'test': 测试调用
   * 'translate-lang-detect': 翻译语言检测
   */
  callType?: 'chat' | 'translate' | 'summary' | 'search' | 'generate' | 'check' | 'test' | 'translate-lang-detect'

  // 基础对话数据
  messages: Message[] | string // 联合类型方便判断是否为空

  assistant: Assistant // 助手为基本单位

  // model: Model
  onChunk?: (chunk: Chunk) => void
  onResponse?: (text: string, isComplete: boolean) => void

  // 错误相关
  onError?: (error: Error) => void
  shouldThrow?: boolean

  // 工具相关
  mcpTools?: MCPTool[]

  // 生成参数
  temperature?: number
  topP?: number
  maxTokens?: number

  // 功能开关
  streamOutput: boolean
  enableWebSearch?: boolean
  enableUrlContext?: boolean
  enableReasoning?: boolean
  enableGenerateImage?: boolean

  // 上下文控制
  contextCount?: number
  topicId?: string // 主题ID，用于关联上下文

  // abort 控制
  abortKey?: string

  _internal?: ProcessingState
}

export interface CompletionsResult {
  rawOutput?: SdkRawOutput
  stream?: ReadableStream<SdkRawChunk> | ReadableStream<Chunk> | AsyncIterable<Chunk>
  controller?: AbortController

  getText: () => string
}

// ============================================================================
// Generic Chunk Types - 通用数据块结构
// ============================================================================
/**
 * 通用数据块类型
 * 复用现有的 Chunk 类型，这是所有AI Provider都应该输出的标准化数据块格式
 */

export type GenericChunk = Chunk

// Re-export for convenience
export type { Chunk as OnChunkArg } from '@renderer/types/chunk'
