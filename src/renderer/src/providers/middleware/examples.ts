import { CompletionsMiddlewareBuilder, createCompletionsBuilder, createMethodBuilder } from './builder'
// 导入中间件模块以访问 MIDDLEWARE_NAME
import * as AbortHandlerModule from './common/AbortHandlerMiddleware'
// 导入现有的中间件实例
import { createGenericLoggingMiddleware } from './common/LoggingMiddleware'
import * as McpToolChunkModule from './core/McpToolChunkMiddleware'
// import * as SdkCallModule from './core/SdkCallMiddleware'
import * as TextChunkModule from './core/TextChunkMiddleware'
import * as TransformCoreToSdkParamsModule from './core/TransformCoreToSdkParamsMiddleware'
import * as ThinkingTagExtractionModule from './feat/ThinkingTagExtractionMiddleware'
import { getMiddleware } from './register'
import { CompletionsParams } from './schemas'
import { CompletionsMiddleware, MethodMiddleware } from './types'

/**
 * 使用示例 1: 使用默认中间件链
 */
export function basicMiddlewareBuilderExample(): CompletionsMiddleware[] {
  // 使用默认链构建器
  const builder = CompletionsMiddlewareBuilder.withDefaults()

  // 构建最终链
  return builder.build()
}

/**
 * 使用示例 2: 简化的API使用，直接构造 NamedMiddleware 对象
 */
export function simplifiedApiExample(): CompletionsMiddleware[] {
  // 使用简化的构建器API - 直接构造 NamedMiddleware 对象
  const builder = createCompletionsBuilder([
    { name: AbortHandlerModule.MIDDLEWARE_NAME, middleware: AbortHandlerModule.AbortHandlerMiddleware },
    { name: TextChunkModule.MIDDLEWARE_NAME, middleware: TextChunkModule.TextChunkMiddleware }
  ])

  // 链式添加更多中间件
  builder.prepend({ name: AbortHandlerModule.MIDDLEWARE_NAME, middleware: AbortHandlerModule.AbortHandlerMiddleware })

  return builder.build()
}

/**
 * 使用示例 3: 根据条件动态构建中间件链
 */
export function conditionalMiddlewareBuilderExample(params: CompletionsParams): CompletionsMiddleware[] {
  // 从默认链开始
  const builder = CompletionsMiddlewareBuilder.withDefaults()

  // 如果禁用工具调用，移除工具相关中间件
  if (params.mcpTools?.length) {
    builder.remove(McpToolChunkModule.MIDDLEWARE_NAME)
  }

  //   // 如果需要特殊的思考处理，替换默认中间件
  //   if (params.specialThinkingMode) {
  //     // 可以替换为特殊的思考中间件
  //     // const specialThinkingMiddleware = createSpecialThinkingMiddleware()
  //     // builder.replace(ThinkingTagExtractionModule.MIDDLEWARE_NAME,
  //     //   { name: ThinkingTagExtractionModule.MIDDLEWARE_NAME, middleware: specialThinkingMiddleware })
  //   }

  return builder.build()
}

/**
 * 使用示例 4: 工厂模式创建不同类型的构建器
 */
export function factoryPatternExample(): {
  completionsChain: CompletionsMiddleware[]
  translateChain: MethodMiddleware[]
} {
  // 创建 Completions 链 - 使用默认配置
  const completionsBuilder = CompletionsMiddlewareBuilder.withDefaults()

  // 创建通用方法链（例如翻译）- 使用自定义中间件
  const loggingMiddleware = { name: 'LoggingStartMiddleware', middleware: createGenericLoggingMiddleware() }
  const methodBuilder = createMethodBuilder([loggingMiddleware])

  return {
    completionsChain: completionsBuilder.build(),
    translateChain: methodBuilder.build()
  }
}

/**
 * 使用示例 5: 复杂的中间件链操作
 */
export function complexMiddlewareOperationsExample(): CompletionsMiddleware[] {
  const builder = CompletionsMiddlewareBuilder.withDefaults()

  // 检查是否包含特定中间件
  if (builder.has(ThinkingTagExtractionModule.MIDDLEWARE_NAME)) {
    console.log('包含思考标签提取中间件')
  }

  // 获取当前链信息
  console.log(`当前中间件数量: ${builder.length}`)
  const currentChain = builder.getChain()
  console.log(
    '当前中间件链:',
    currentChain.map((item) => item.name)
  )

  // 进行多个操作 - 直接构造中间件对象
  // builder.insertBefore(SdkCallModule.MIDDLEWARE_NAME, {
  //   name: AbortHandlerModule.MIDDLEWARE_NAME,
  //   middleware: AbortHandlerModule.AbortHandlerMiddleware
  // })

  console.log(`操作后中间件数量: ${builder.length}`)

  return builder.build()
}

/**
 * 使用示例 6: 在 AiCoreService 中的实际应用模拟
 */
export function aiCoreServiceUsageExample(
  params: CompletionsParams,
  needsSpecialProcessing: boolean = false,
  highSecurityContext: boolean = false
): CompletionsMiddleware[] {
  // 1. 从默认链开始
  const builder = CompletionsMiddlewareBuilder.withDefaults()

  // 2. 根据参数动态调整
  if (params.assistant.settings?.streamOutput) {
    console.log('启用流式输出功能 - 需要 CompletionsMiddleware 兼容的流式输出中间件')
  }

  // 3. 根据特殊需求添加中间件
  if (needsSpecialProcessing) {
    // 在核心处理之前插入特殊处理逻辑
    // const specialMiddleware = { name: 'SPECIAL_PROCESSING', middleware: createSpecialProcessingMiddleware() }
    // builder.insertBefore(SdkCallModule.MIDDLEWARE_NAME, specialMiddleware)
  }

  // 4. 安全上下文处理
  if (highSecurityContext) {
    // 在请求执行前添加安全检查
    // const securityMiddleware = { name: 'SECURITY_CHECK', middleware: createSecurityCheckMiddleware() }
    // builder.insertBefore(TransformCoreToSdkParamsModule.MIDDLEWARE_NAME, securityMiddleware)
  }

  // 5. 返回构建好的链
  return builder.build()
}

/**
 * 使用示例 7: 演示如何创建自定义具名中间件
 */
export function middlewareWithNameExample(): {
  completionsExample: CompletionsMiddleware[]
  methodExample: MethodMiddleware[]
} {
  // Completions 中间件示例 - 直接构造中间件对象
  const completionsBuilder = createCompletionsBuilder([
    { name: AbortHandlerModule.MIDDLEWARE_NAME, middleware: AbortHandlerModule.AbortHandlerMiddleware }
  ])

  // Method 中间件示例 - 使用自定义中间件
  const namedMiddleware = { name: 'LoggingStartMiddleware', middleware: createGenericLoggingMiddleware() }
  const methodBuilder = createMethodBuilder([namedMiddleware])

  return {
    completionsExample: completionsBuilder.build(),
    methodExample: methodBuilder.build()
  }
}

/**
 * 使用示例 8: 演示使用 getMiddleware 辅助函数（仅在需要通过注册表查找时使用）
 */
export function usingGetMiddlewareExample(): CompletionsMiddleware[] {
  const builder = createCompletionsBuilder()

  // 使用 getMiddleware 辅助函数获取中间件（适用于动态查找场景）
  builder
    .add(getMiddleware(AbortHandlerModule.MIDDLEWARE_NAME))
    .add(getMiddleware(TransformCoreToSdkParamsModule.MIDDLEWARE_NAME))
  // .add(getMiddleware(SdkCallModule.MIDDLEWARE_NAME))

  return builder.build()
}
