import { AiPlugin, extractReasoningMiddleware, simulateStreamingMiddleware } from '@cherrystudio/ai-core'
import { isReasoningModel } from '@renderer/config/models'
import type { Model, Provider } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'

import thinkingTimeMiddleware from './ThinkingTimeMiddleware'

/**
 * AI SDK 中间件配置项
 */
export interface AiSdkMiddlewareConfig {
  streamOutput?: boolean
  onChunk?: (chunk: Chunk) => void
  model?: Model
  provider?: Provider
  enableReasoning?: boolean
  enableTool?: boolean
  enableWebSearch?: boolean
}

/**
 * 具名的 AI SDK 中间件
 */
export type NamedAiSdkMiddleware = AiPlugin

/**
 * AI SDK 中间件建造者
 * 用于根据不同条件动态构建中间件数组
 */
export class AiSdkMiddlewareBuilder {
  private middlewares: NamedAiSdkMiddleware[] = []

  /**
   * 添加具名中间件
   */
  public add(namedMiddleware: NamedAiSdkMiddleware): this {
    this.middlewares.push(namedMiddleware)
    return this
  }

  /**
   * 在指定位置插入中间件
   */
  public insertAfter(targetName: string, middleware: NamedAiSdkMiddleware): this {
    const index = this.middlewares.findIndex((m) => m.name === targetName)
    if (index !== -1) {
      this.middlewares.splice(index + 1, 0, middleware)
    } else {
      console.warn(`AiSdkMiddlewareBuilder: 未找到名为 '${targetName}' 的中间件，无法插入`)
    }
    return this
  }

  /**
   * 检查是否包含指定名称的中间件
   */
  public has(name: string): boolean {
    return this.middlewares.some((m) => m.name === name)
  }

  /**
   * 移除指定名称的中间件
   */
  public remove(name: string): this {
    this.middlewares = this.middlewares.filter((m) => m.name !== name)
    return this
  }

  /**
   * 构建最终的中间件数组
   */
  public build(): NamedAiSdkMiddleware[] {
    return [...this.middlewares]
  }

  /**
   * 清空所有中间件
   */
  public clear(): this {
    this.middlewares = []
    return this
  }

  /**
   * 获取中间件总数
   */
  public get length(): number {
    return this.middlewares.length
  }
}

/**
 * 根据配置构建AI SDK中间件的工厂函数
 * 这里要注意构建顺序，因为有些中间件需要依赖其他中间件的结果
 */
export function buildAiSdkMiddlewares(config: AiSdkMiddlewareConfig): NamedAiSdkMiddleware[] {
  const builder = new AiSdkMiddlewareBuilder()

  // 1. 思考模型且有onChunk回调时添加思考时间中间件
  if (config.onChunk && config.model && isReasoningModel(config.model)) {
    builder.add({
      name: 'thinking-time',
      aiSdkMiddlewares: [thinkingTimeMiddleware()]
    })
  }

  // 2. 可以在这里根据其他条件添加更多中间件
  // 例如：工具调用、Web搜索等相关中间件

  // 3. 根据provider添加特定中间件
  if (config.provider) {
    addProviderSpecificMiddlewares(builder, config)
  }

  // 4. 根据模型类型添加特定中间件
  if (config.model) {
    addModelSpecificMiddlewares(builder, config)
  }

  // 5. 非流式输出时添加模拟流中间件
  if (config.streamOutput === false) {
    builder.add({
      name: 'simulate-streaming',
      aiSdkMiddlewares: [simulateStreamingMiddleware()]
    })
  }

  return builder.build()
}

/**
 * 添加provider特定的中间件
 */
function addProviderSpecificMiddlewares(builder: AiSdkMiddlewareBuilder, config: AiSdkMiddlewareConfig): void {
  if (!config.provider) return

  // 根据不同provider添加特定中间件
  switch (config.provider.type) {
    case 'anthropic':
      // Anthropic特定中间件
      break
    case 'openai':
      builder.add({
        name: 'thinking-tag-extraction',
        aiSdkMiddlewares: [extractReasoningMiddleware({ tagName: 'think' })]
      })
      break
    case 'gemini':
      // Gemini特定中间件
      break
    default:
      // 其他provider的通用处理
      break
  }
}

/**
 * 添加模型特定的中间件
 */
function addModelSpecificMiddlewares(builder: AiSdkMiddlewareBuilder, config: AiSdkMiddlewareConfig): void {
  if (!config.model) return

  // 可以根据模型ID或特性添加特定中间件
  // 例如：图像生成模型、多模态模型等

  // 示例：某些模型需要特殊处理
  if (config.model.id.includes('dalle') || config.model.id.includes('midjourney')) {
    // 图像生成相关中间件
  }
}

/**
 * 创建一个预配置的中间件建造者
 */
export function createAiSdkMiddlewareBuilder(): AiSdkMiddlewareBuilder {
  return new AiSdkMiddlewareBuilder()
}

/**
 * 创建一个带有默认中间件的建造者
 */
export function createDefaultAiSdkMiddlewareBuilder(config: AiSdkMiddlewareConfig): AiSdkMiddlewareBuilder {
  const builder = new AiSdkMiddlewareBuilder()
  const defaultMiddlewares = buildAiSdkMiddlewares(config)

  defaultMiddlewares.forEach((middleware) => {
    builder.add(middleware)
  })

  return builder
}
