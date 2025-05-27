import { Assistant, MCPTool, Model } from '@renderer/types'
import { Chunk, ErrorChunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'

import { CompletionsOpenAIResult, CompletionsParams, OnFilterMessagesFunction } from '../AiProvider'
import type BaseProvider from '../AiProvider/BaseProvider'

/**
 * Symbol to uniquely identify middleware context objects. /
 * 用于唯一标识中间件上下文对象的 Symbol。
 */
export const MIDDLEWARE_CONTEXT_SYMBOL = Symbol.for('AiProviderMiddlewareContext')

/**
 * Defines the structure for the onChunk callback function. /
 * 定义 onChunk 回调函数的结构。
 * This function is called with data chunks during a streaming operation. /
 * 在流式操作期间，此函数会带着数据块被调用。
 */
export type OnChunkFunction = (chunk: Chunk | ErrorChunk) => void

/**
 * Defines the base structure for context objects created at the beginning of a wrapped method call. /
 * 定义在包装方法调用开始时创建的上下文对象的基本结构。
 */
export interface AiProviderMiddlewareBaseContext {
  [MIDDLEWARE_CONTEXT_SYMBOL]: true // Symbol marker / Symbol 标记
  methodName: string // The name of the provider method being called / 被调用的提供者方法的名称
  originalArgs: any[] // The original arguments array passed to the method / 传递给方法的原始参数数组
  providerId?: string // ID of the provider being wrapped / 被包装的提供者的ID
  _providerInstance?: BaseProvider // Reference to the original provider instance. / 对原始提供者实例的引用。
}

/**
 * Defines the structure for the completion context object. /
 * 定义 completions 方法的上下文对象结构。
 */
export interface AiProviderMiddlewareCompletionsContext extends AiProviderMiddlewareBaseContext {
  methodName: 'completions' // Override for specificity / 覆盖以提高特异性
  // Fields derived from originalParams for convenience within completions middlewares. /
  // 从 originalParams派生的字段，方便在 completions 中间件中使用。
  // These will be populated by a context creation function. /
  // 这些字段将由上下文创建函数填充。
  assistant?: Assistant
  model?: Model
  messages?: Message[]
  mcpTools?: MCPTool[]
  onChunk?: OnChunkFunction
  onFilterMessages?: OnFilterMessagesFunction

  // Additional fields added by middleware during processing
  // 在处理过程中由中间件添加的额外字段
  abortController?: AbortController // Added by AbortHandlerMiddleware
  abortSignal?: AbortSignal // Added by AbortHandlerMiddleware
  cleanup?: () => void // Added by AbortHandlerMiddleware

  // Bypass mechanism - signals that transformedData should be used instead of re-processing
  // 绕过机制 - 标示应该使用 transformedData 而不是重新处理参数
  _useTransformedData?: boolean // Added by StreamAdapterMiddleware

  // Internal fields for middleware communication
  // 中间件通信的内部字段
  _internal: {
    // Enhanced dispatch function for recursive calls
    // 用于递归调用的增强分发函数
    enhancedDispatch?: (
      context: AiProviderMiddlewareCompletionsContext,
      params: CompletionsParams
    ) => Promise<CompletionsOpenAIResult>
    // Flag to indicate if this is a recursive call
    // 标记是否为递归调用
    isRecursiveCall?: boolean
    // Current recursion depth
    // 当前递归深度
    recursionDepth?: number
    // Add other internal fields as needed
    // 根据需要添加其他内部字段
    [key: string]: any
  }
}

/**
 * API provided to each middleware, allowing access to call-specific data. /
 * 提供给每个中间件的API，允许访问特定于调用的数据。
 */
export interface MiddlewareAPI<
  Ctx extends AiProviderMiddlewareBaseContext = AiProviderMiddlewareBaseContext,
  Args extends any[] = any[]
> {
  getContext: () => Ctx // Function to get the current context / 获取当前上下文的函数
  getOriginalArgs: () => Args // Function to get the original arguments of the method call / 获取方法调用原始参数的函数
  getProviderId: () => string | undefined // Function to get the provider ID / 获取提供者ID的函数
  getProviderInstance: () => BaseProvider // Function to get the original provider instance / 获取原始提供者实例的函数
}

/**
 * Generic signature for a middleware applicable to any provider method. /
 * 适用于任何提供者方法的通用中间件签名。
 * Follows the Redux middleware pattern: (api) => (next) => (context, args) => result /
 * 遵循Redux中间件模式： (api) => (next) => (context, args) => result
 */
export type ProviderMethodMiddleware = (
  api: MiddlewareAPI
) => (
  next: (context: AiProviderMiddlewareBaseContext, args: any[]) => Promise<any>
) => (context: AiProviderMiddlewareBaseContext, args: any[]) => Promise<any>

/**
 * Represents the result of a completions call, especially when streaming.
 * It includes the stream of chunks and potentially final usage/metrics.
 */

/**
 * Specific middleware type for the 'completions' method. /
 * 针对 'completions' 方法的特定中间件类型。
 * The third layer and its 'next' function now accept 'CompletionsParams' and return 'CompletionsResult'. /
 * 第三层及其 'next' 函数现在接受 'CompletionsParams' 并返回 'CompletionsResult'。
 */
export type CompletionsMiddleware = (
  api: MiddlewareAPI<AiProviderMiddlewareCompletionsContext, [CompletionsParams]>
) => (
  next: (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => Promise<CompletionsOpenAIResult>
) => (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => Promise<CompletionsOpenAIResult>

/**
 * Base configuration for any middleware, can include common properties like id or name. /
 *任何中间件的基础配置，可以包含诸如id或name之类的通用属性。
 */
export interface BaseMiddlewareConfig {
  id?: string
  name?: string
}

/**
 * Represents the structure for configuring middlewares for a provider. /
 * 表示为提供者配置中间件的结构。
 * It maps method names to an array of middlewares for that method. /
 * 它将方法名映射到该方法的中间件数组。
 */
export interface AiProviderMiddlewareConfig extends BaseMiddlewareConfig {
  completions?: CompletionsMiddleware[] // Middlewares specifically for the 'completions' method / 专用于 'completions' 方法的中间件
  /**
   * Optional mapping for generic method middlewares. /
   * 通用方法中间件的可选映射。
   * Key: methodName (string) /
   * 键: methodName (字符串)
   * Value: Array of ProviderMethodMiddleware for that method. /
   * 值: 该方法的 ProviderMethodMiddleware 数组。
   */
  methods?: Record<string, ProviderMethodMiddleware[]>
}

// Types related to finalize hooks (currently out of scope for this refactoring step) / 与 finalize 钩子相关的类型（当前不在此重构步骤的范围内）
// export type FinalizeSdkParamsNextFunction = (sdkParams: any, ctx: AiProviderMiddlewareBaseContext) => Promise<any>

// Types for other hooks if we were to map them (currently out of scope) / 其他钩子的类型（如果我们要映射它们的话，当前超出范围）
// export type NextExecutionFunction = (ctx?: AiProviderMiddlewareBaseContext) => Promise<any>
// export type NextToolExecutionFunction = (toolCallData: any) => Promise<any>

export type { Chunk as OnChunkArg } from '@renderer/types/chunk' // Re-export for convenience / 为方便起见重新导出
export type { OnFilterMessagesFunction } // Keep re-export if used elsewhere directly / 如果在其他地方直接使用，则保留重新导出
