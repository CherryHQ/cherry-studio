import type { LanguageModelV1Middleware, TextStreamPart, ToolSet } from 'ai'

/**
 * 生命周期阶段定义
 */
export enum LifecycleStage {
  PRE_REQUEST = 'pre-request', // 请求预处理
  REQUEST_EXECUTION = 'execution', // 请求执行
  STREAM_PROCESSING = 'stream', // 流式处理（仅流模式）
  POST_RESPONSE = 'post-response', // 响应后处理
  ERROR_HANDLING = 'error' // 错误处理
}

/**
 * 生命周期上下文
 */
export interface LifecycleContext {
  currentStage: LifecycleStage
  startTime: number
  stageStartTime: number
  completedStages: Set<LifecycleStage>
  stageDurations: Map<LifecycleStage, number>
  metadata: Record<string, any>
}

/**
 * AI 请求上下文
 */
export interface AiRequestContext {
  providerId: string
  modelId: string
  originalParams: any
  metadata: Record<string, any>
  startTime: number
  requestId: string
}

/**
 * 借鉴 Rollup 的钩子分类设计
 */
export interface AiPlugin {
  name: string
  enforce?: 'pre' | 'post'

  // 【First】首个钩子 - 只执行第一个返回值的插件
  resolveModel?: (modelId: string, context: AiRequestContext) => string | null | Promise<string | null>
  loadTemplate?: (templateName: string, context: AiRequestContext) => any | null | Promise<any | null>

  // 【Sequential】串行钩子 - 链式执行，支持数据转换
  transformParams?: (params: any, context: AiRequestContext) => any | Promise<any>
  transformResult?: (result: any, context: AiRequestContext) => any | Promise<any>

  // 【Parallel】并行钩子 - 不依赖顺序，用于副作用
  onRequestStart?: (context: AiRequestContext) => void | Promise<void>
  onRequestEnd?: (context: AiRequestContext, result: any) => void | Promise<void>
  onError?: (error: Error, context: AiRequestContext) => void | Promise<void>

  // 【Stream】流处理 - 直接使用 AI SDK
  transformStream?: <TOOLS extends ToolSet>() => (options: {
    tools?: TOOLS
    stopStream: () => void
  }) => TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>

  // AI SDK 原生中间件
  aiSdkMiddlewares?: LanguageModelV1Middleware[]
}

/**
 * 插件管理器配置
 */
export interface PluginManagerConfig {
  plugins: AiPlugin[]
  context: Partial<AiRequestContext>
}

/**
 * 钩子执行器类型
 */
export type HookType = 'first' | 'sequential' | 'parallel' | 'stream'

/**
 * 钩子执行结果
 */
export interface HookResult<T = any> {
  value: T
  stop?: boolean
}
