import type { ImageModelV2 } from '@ai-sdk/provider'
import type { LanguageModel, TextStreamPart, ToolSet } from 'ai'

import { type ProviderId } from '../providers/types'

/**
 * 递归调用函数类型
 * 使用 any 是因为递归调用时参数和返回类型可能完全不同
 */
export type RecursiveCallFn = (newParams: any) => Promise<any>

/**
 * AI 请求上下文
 */
export interface AiRequestContext {
  providerId: ProviderId
  model: LanguageModel | ImageModelV2
  originalParams: any
  metadata: Record<string, any>
  startTime: number
  requestId: string
  recursiveCall: RecursiveCallFn
  isRecursiveCall?: boolean
  mcpTools?: ToolSet
  [key: string]: any
}

/**
 * 钩子分类
 */
export interface AiPlugin {
  name: string
  enforce?: 'pre' | 'post'

  // 【First】首个钩子 - 只执行第一个返回值的插件
  resolveModel?: (
    modelId: string,
    context: AiRequestContext
  ) => Promise<LanguageModel | ImageModelV2 | null> | LanguageModel | ImageModelV2 | null
  loadTemplate?: (templateName: string, context: AiRequestContext) => any | null | Promise<any | null>

  // 【Sequential】串行钩子 - 链式执行，支持数据转换
  configureContext?: (context: AiRequestContext) => void | Promise<void>
  transformParams?: <T>(params: T, context: AiRequestContext) => T | Promise<T>
  transformResult?: <T>(result: T, context: AiRequestContext) => T | Promise<T>

  // 【Parallel】并行钩子 - 不依赖顺序，用于副作用
  onRequestStart?: (context: AiRequestContext) => void | Promise<void>
  onRequestEnd?: (context: AiRequestContext, result: any) => void | Promise<void>
  onError?: (error: Error, context: AiRequestContext) => void | Promise<void>

  // 【Stream】流处理 - 直接使用 AI SDK
  transformStream?: (
    params: any,
    context: AiRequestContext
  ) => <TOOLS extends ToolSet>(options?: {
    tools: TOOLS
    stopStream: () => void
  }) => TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>

  // AI SDK 原生中间件
  // aiSdkMiddlewares?: LanguageModelV1Middleware[]
}

/**
 * 插件管理器配置
 */
export interface PluginManagerConfig {
  plugins: AiPlugin[]
  context: Partial<AiRequestContext>
}

/**
 * 钩子执行结果
 */
export interface HookResult<T = any> {
  value: T
  stop?: boolean
}
