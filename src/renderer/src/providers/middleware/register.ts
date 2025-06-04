import * as AbortHandlerModule from './common/AbortHandlerMiddleware'
import * as FinalChunkConsumerModule from './common/FinalChunkConsumerMiddleware'
import * as LoggingModule from './common/LoggingMiddleware'
import * as McpToolChunkModule from './core/McpToolChunkMiddleware'
import * as RawStreamListenerModule from './core/RawStreamListenerMiddleware'
import * as ResponseTransformModule from './core/ResponseTransformMiddleware'
import * as SdkCallModule from './core/SdkCallMiddleware'
import * as StreamAdapterModule from './core/StreamAdapterMiddleware'
import * as TextChunkModule from './core/TextChunkMiddleware'
import * as ThinkChunkModule from './core/ThinkChunkMiddleware'
import * as TransformCoreToSdkParamsModule from './core/TransformCoreToSdkParamsMiddleware'
import * as WebSearchModule from './core/WebSearchMiddleware'
import * as ThinkingTagExtractionModule from './feat/ThinkingTagExtractionMiddleware'
import * as ToolUseExtractionMiddleware from './feat/ToolUseExtractionMiddleware'

/**
 * 中间件注册表 - 提供所有可用中间件的集中访问
 * 注意：目前中间件文件还未导出 MIDDLEWARE_NAME，会有 linter 错误，这是正常的
 */
export const MiddlewareRegistry = {
  // 通用中间件
  [AbortHandlerModule.MIDDLEWARE_NAME]: {
    name: AbortHandlerModule.MIDDLEWARE_NAME,
    middleware: AbortHandlerModule.AbortHandlerMiddleware
  },
  [FinalChunkConsumerModule.MIDDLEWARE_NAME]: {
    name: FinalChunkConsumerModule.MIDDLEWARE_NAME,
    middleware: FinalChunkConsumerModule.default
  },

  // 核心流程中间件
  [TransformCoreToSdkParamsModule.MIDDLEWARE_NAME]: {
    name: TransformCoreToSdkParamsModule.MIDDLEWARE_NAME,
    middleware: TransformCoreToSdkParamsModule.TransformCoreToSdkParamsMiddleware
  },
  [SdkCallModule.MIDDLEWARE_NAME]: {
    name: SdkCallModule.MIDDLEWARE_NAME,
    middleware: SdkCallModule.SdkCallMiddleware
  },
  [StreamAdapterModule.MIDDLEWARE_NAME]: {
    name: StreamAdapterModule.MIDDLEWARE_NAME,
    middleware: StreamAdapterModule.StreamAdapterMiddleware
  },
  [ResponseTransformModule.MIDDLEWARE_NAME]: {
    name: ResponseTransformModule.MIDDLEWARE_NAME,
    middleware: ResponseTransformModule.ResponseTransformMiddleware
  },

  // 特性处理中间件
  [ThinkingTagExtractionModule.MIDDLEWARE_NAME]: {
    name: ThinkingTagExtractionModule.MIDDLEWARE_NAME,
    middleware: ThinkingTagExtractionModule.ThinkingTagExtractionMiddleware
  },
  [ThinkChunkModule.MIDDLEWARE_NAME]: {
    name: ThinkChunkModule.MIDDLEWARE_NAME,
    middleware: ThinkChunkModule.ThinkChunkMiddleware
  },
  [McpToolChunkModule.MIDDLEWARE_NAME]: {
    name: McpToolChunkModule.MIDDLEWARE_NAME,
    middleware: McpToolChunkModule.McpToolChunkMiddleware
  },
  [WebSearchModule.MIDDLEWARE_NAME]: {
    name: WebSearchModule.MIDDLEWARE_NAME,
    middleware: WebSearchModule.WebSearchMiddleware
  },
  [TextChunkModule.MIDDLEWARE_NAME]: {
    name: TextChunkModule.MIDDLEWARE_NAME,
    middleware: TextChunkModule.TextChunkMiddleware
  }
} as const

/**
 * 根据名称获取中间件
 * @param name - 中间件名称
 * @returns 对应的中间件信息
 */
export function getMiddleware(name: string) {
  return MiddlewareRegistry[name]
}

/**
 * 获取所有注册的中间件名称
 * @returns 中间件名称列表
 */
export function getRegisteredMiddlewareNames(): string[] {
  return Object.keys(MiddlewareRegistry)
}

/**
 * 默认的 Completions 中间件配置 - 纯中间件函数数组
 */
export const DefaultCompletionsMiddlewares = [
  FinalChunkConsumerModule.default, // 最终消费者
  TransformCoreToSdkParamsModule.TransformCoreToSdkParamsMiddleware, // 参数转换
  AbortHandlerModule.AbortHandlerMiddleware, // 中止处理
  McpToolChunkModule.McpToolChunkMiddleware, // 工具处理
  WebSearchModule.WebSearchMiddleware, // Web搜索处理
  ToolUseExtractionMiddleware.ToolUseExtractionMiddleware, // 工具使用提取处理
  TextChunkModule.TextChunkMiddleware, // 文本处理
  ThinkingTagExtractionModule.ThinkingTagExtractionMiddleware, // 思考标签提取处理（特定provider）
  ThinkChunkModule.ThinkChunkMiddleware, // 思考处理（通用SDK）
  ResponseTransformModule.ResponseTransformMiddleware, // 响应转换
  StreamAdapterModule.StreamAdapterMiddleware, // 流适配器
  RawStreamListenerModule.RawStreamListenerMiddleware, // 原始流监听器
  ToolUseExtractionMiddleware.ToolUseExtractionMiddleware, // 工具使用提取处理
  SdkCallModule.SdkCallMiddleware // SDK调用
]

/**
 * 默认的 Completions 中间件配置 - NamedMiddleware 格式，用于 MiddlewareBuilder
 */
export const DefaultCompletionsNamedMiddlewares = [
  MiddlewareRegistry[FinalChunkConsumerModule.MIDDLEWARE_NAME], // 最终消费者
  MiddlewareRegistry[TransformCoreToSdkParamsModule.MIDDLEWARE_NAME], // 参数转换
  MiddlewareRegistry[AbortHandlerModule.MIDDLEWARE_NAME], // 中止处理
  MiddlewareRegistry[McpToolChunkModule.MIDDLEWARE_NAME], // 工具处理
  MiddlewareRegistry[WebSearchModule.MIDDLEWARE_NAME], // Web搜索处理
  MiddlewareRegistry[TextChunkModule.MIDDLEWARE_NAME], // 文本处理
  MiddlewareRegistry[ThinkingTagExtractionModule.MIDDLEWARE_NAME], // 思考标签提取处理（特定provider）
  MiddlewareRegistry[ThinkChunkModule.MIDDLEWARE_NAME], // 思考处理（通用SDK）
  MiddlewareRegistry[ResponseTransformModule.MIDDLEWARE_NAME], // 响应转换
  MiddlewareRegistry[StreamAdapterModule.MIDDLEWARE_NAME], // 流适配器
  MiddlewareRegistry[SdkCallModule.MIDDLEWARE_NAME] // SDK调用
]

/**
 * 默认的通用方法中间件 - 例如翻译、摘要等
 */
export const DefaultMethodMiddlewares = {
  translate: [LoggingModule.createGenericLoggingMiddleware()],
  summaries: [LoggingModule.createGenericLoggingMiddleware()]
}

/**
 * 导出所有中间件模块，方便外部使用
 */
export {
  AbortHandlerModule,
  FinalChunkConsumerModule,
  LoggingModule,
  McpToolChunkModule,
  ResponseTransformModule,
  SdkCallModule,
  StreamAdapterModule,
  TextChunkModule,
  ThinkChunkModule,
  ThinkingTagExtractionModule,
  TransformCoreToSdkParamsModule,
  WebSearchModule
}
