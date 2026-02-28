import type { JSONObject, JSONValue } from '@ai-sdk/provider'
import type { generateText, LanguageModelMiddleware, streamText, TextStreamPart, ToolSet } from 'ai'

import type { AiSdkModel, ProviderId } from '../providers/types'

/**
 * 常用的 AI SDK 参数类型（完整版，用于插件泛型）
 */
export type StreamTextParams = Parameters<typeof streamText>[0]
export type StreamTextResult = ReturnType<typeof streamText>
export type GenerateTextParams = Parameters<typeof generateText>[0]
export type GenerateTextResult = ReturnType<typeof generateText>

/**
 * AI 请求元数据
 * 定义结构化的元数据字段，避免使用 Record<string, any>
 */
export interface AiRequestMetadata {
  topicId?: string
  callType?: string
  enableReasoning?: boolean
  enableWebSearch?: boolean
  enableGenerateImage?: boolean
  isPromptToolUse?: boolean
  isSupportedToolUse?: boolean
  isImageGenerationEndpoint?: boolean
  // 自定义元数据，使用 JSONValue 确保类型安全
  custom?: JSONObject
}

/**
 * 递归调用函数类型
 * 泛型化以保持类型推导
 */
export type RecursiveCallFn<TParams = unknown, TResult = unknown> = (newParams: Partial<TParams>) => Promise<TResult>

/**
 * AI 请求上下文
 * 使用泛型参数以支持不同类型的请求
 */
export interface AiRequestContext<TParams = unknown, TResult = unknown> {
  providerId: ProviderId
  model: AiSdkModel
  originalParams: TParams
  metadata: AiRequestMetadata
  startTime: number
  requestId: string
  recursiveCall: RecursiveCallFn<TParams, TResult>
  isRecursiveCall: boolean

  // 递归深度控制（防止栈溢出）
  recursiveDepth: number // 当前递归深度
  maxRecursiveDepth: number // 最大递归深度限制，默认 10

  mcpTools?: ToolSet

  extensions: Map<string, JSONValue>

  middlewares?: LanguageModelMiddleware[]

  // 向后兼容：允许插件动态添加属性（临时保留）
  [key: string]: any
}

/**
 * 钩子分类
 * 使用泛型参数以支持不同类型的请求和响应
 */
export interface AiPlugin<TParams = unknown, TResult = unknown> {
  name: string
  enforce?: 'pre' | 'post'

  // 【First】首个钩子 - 只执行第一个返回值的插件
  resolveModel?: (
    modelId: string,
    context: AiRequestContext<TParams, TResult>
  ) => Promise<AiSdkModel | null> | AiSdkModel | null

  loadTemplate?: (
    templateName: string,
    context: AiRequestContext<TParams, TResult>
  ) => JSONValue | null | Promise<JSONValue | null>

  // 【Sequential】串行钩子 - 链式执行，支持数据转换
  configureContext?: (context: AiRequestContext<TParams, TResult>) => void | Promise<void>

  transformParams?: (
    params: TParams,
    context: AiRequestContext<TParams, TResult>
  ) => Partial<TParams> | Promise<Partial<TParams>>

  transformResult?: (result: TResult, context: AiRequestContext<TParams, TResult>) => TResult | Promise<TResult>

  // 【Parallel】并行钩子 - 不依赖顺序，用于副作用
  onRequestStart?: (context: AiRequestContext<TParams, TResult>) => void | Promise<void>

  onRequestEnd?: (context: AiRequestContext<TParams, TResult>, result: TResult) => void | Promise<void>

  onError?: (error: Error, context: AiRequestContext<TParams, TResult>) => void | Promise<void>

  // 【Stream】流处理 - 直接使用 AI SDK
  transformStream?: (
    params: TParams,
    context: AiRequestContext<TParams, TResult>
  ) => <TOOLS extends ToolSet>(options?: {
    tools: TOOLS
    stopStream: () => void
  }) => TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>
}

/**
 * 插件管理器配置
 */
export interface PluginManagerConfig<TParams = unknown, TResult = unknown> {
  plugins: AiPlugin<TParams, TResult>[]
  context: Partial<AiRequestContext<TParams, TResult>>
}

/**
 * 钩子执行结果
 * 泛型参数指定返回值类型
 */
export interface HookResult<T = unknown> {
  value: T
  stop?: boolean
}
