import { AbortHandlerMiddleware } from './common/AbortHandlerMiddleware'
import FinalChunkConsumerMiddleware from './common/FinalChunkConsumerMiddleware'
import { createGenericLoggingMiddleware } from './common/LoggingMiddleware'
import { McpToolChunkMiddleware } from './core/McpToolChunkMiddleware'
import { ResponseTransformMiddleware } from './core/ResponseTransformMiddleware'
import { SdkCallMiddleware } from './core/SdkCallMiddleware'
import { StreamAdapterMiddleware } from './core/StreamAdapterMiddleware'
import { TextChunkMiddleware } from './core/TextChunkMiddleware'
import { ThinkChunkMiddleware } from './core/ThinkChunkMiddleware'
import { TransformCoreToSdkParamsMiddleware } from './core/TransformCoreToSdkParamsMiddleware'
import { WebSearchMiddleware } from './core/WebSearchMiddleware'
import { ThinkingTagExtractionMiddleware } from './feat/ThinkingTagExtractionMiddleware'
import { MiddlewareConfig } from './type'

const middlewareConfig: MiddlewareConfig = {
  id: 'universal-provider-middleware',
  name: 'Universal Provider Middleware Stack',

  // 通用completions中间件
  completions: [
    // createGenericLoggingMiddleware(),
    FinalChunkConsumerMiddleware, // 最终消费者
    TransformCoreToSdkParamsMiddleware, // 参数转换
    AbortHandlerMiddleware, // 中止处理
    McpToolChunkMiddleware, // 工具处理
    WebSearchMiddleware, // Web搜索处理
    TextChunkMiddleware, // 文本处理
    ThinkingTagExtractionMiddleware, // 思考标签提取处理（特定provider）
    ThinkChunkMiddleware, // 思考处理（通用SDK）
    ResponseTransformMiddleware, // 响应转换
    StreamAdapterMiddleware, // 流适配器
    SdkCallMiddleware // SDK调用
  ],

  // 通用Koa风格的通用方法中间件
  methods: {
    translate: [createGenericLoggingMiddleware()],
    summaries: [createGenericLoggingMiddleware()]
  }
}

export default middlewareConfig
