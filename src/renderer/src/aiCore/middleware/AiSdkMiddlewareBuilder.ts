import type { WebSearchPluginConfig } from '@cherrystudio/ai-core/built-in/plugins'
import { loggerService } from '@logger'
import { isSupportedThinkingTokenQwenModel } from '@renderer/config/models'
import { isSupportEnableThinkingProvider } from '@renderer/config/providers'
import type { MCPTool } from '@renderer/types'
import { type Assistant, type Message, type Model, type Provider } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import type { LanguageModelMiddleware } from 'ai'
import { extractReasoningMiddleware, simulateStreamingMiddleware } from 'ai'
import { isEmpty } from 'lodash'

import { isOpenRouterGeminiGenerateImageModel } from '../utils/image'
import { noThinkMiddleware } from './noThinkMiddleware'
import { openrouterGenerateImageMiddleware } from './openrouterGenerateImageMiddleware'
import { qwenThinkingMiddleware } from './qwenThinkingMiddleware'
import { toolChoiceMiddleware } from './toolChoiceMiddleware'

const logger = loggerService.withContext('AiSdkMiddlewareBuilder')

/**
 * AI SDK 中间件配置项
 */
export interface AiSdkMiddlewareConfig {
  streamOutput: boolean
  onChunk?: (chunk: Chunk) => void
  model?: Model
  provider?: Provider
  assistant?: Assistant
  enableReasoning: boolean
  // 是否开启提示词工具调用
  isPromptToolUse: boolean
  // 是否支持工具调用
  isSupportedToolUse: boolean
  // image generation endpoint
  isImageGenerationEndpoint: boolean
  // 是否开启内置搜索
  enableWebSearch: boolean
  enableGenerateImage: boolean
  enableUrlContext: boolean
  enableCodeExecution: boolean
  mcpTools?: MCPTool[]
  uiMessages?: Message[]
  // 内置搜索配置
  webSearchPluginConfig?: WebSearchPluginConfig
  // 知识库识别开关，默认开启
  knowledgeRecognition?: 'off' | 'on'
}

/**
 * 具名的 AI SDK 中间件
 */
export interface NamedAiSdkMiddleware {
  name: string
  middleware: LanguageModelMiddleware
}

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
      logger.warn(`AiSdkMiddlewareBuilder: Middleware named '${targetName}' not found, cannot insert`)
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
  public build(): LanguageModelMiddleware[] {
    return this.middlewares.map((m) => m.middleware)
  }

  /**
   * 获取具名中间件数组（用于调试）
   */
  public buildNamed(): NamedAiSdkMiddleware[] {
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
export function buildAiSdkMiddlewares(config: AiSdkMiddlewareConfig): LanguageModelMiddleware[] {
  const builder = new AiSdkMiddlewareBuilder()

  // 0. 知识库强制调用中间件（必须在最前面，确保第一轮强制调用知识库）
  if (!isEmpty(config.assistant?.knowledge_bases?.map((base) => base.id)) && config.knowledgeRecognition !== 'on') {
    builder.add({
      name: 'force-knowledge-first',
      middleware: toolChoiceMiddleware('builtin_knowledge_search')
    })
    logger.debug('Added toolChoice middleware to force knowledge base search on first round')
  }

  // 1. 根据provider添加特定中间件
  if (config.provider) {
    addProviderSpecificMiddlewares(builder, config)
  }

  // 2. 根据模型类型添加特定中间件
  if (config.model) {
    addModelSpecificMiddlewares(builder, config)
  }

  // 3. 非流式输出时添加模拟流中间件
  if (config.streamOutput === false) {
    builder.add({
      name: 'simulate-streaming',
      middleware: simulateStreamingMiddleware()
    })
  }

  return builder.build()
}

const tagName = {
  reasoning: 'reasoning',
  think: 'think',
  thought: 'thought',
  seedThink: 'seed:think'
}

function getReasoningTagName(modelId: string | undefined): string {
  if (modelId?.includes('gpt-oss')) return tagName.reasoning
  if (modelId?.includes('gemini')) return tagName.thought
  if (modelId?.includes('seed-oss-36b')) return tagName.seedThink
  return tagName.think
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
    case 'azure-openai': {
      if (config.enableReasoning) {
        const tagName = getReasoningTagName(config.model?.id.toLowerCase())
        builder.add({
          name: 'thinking-tag-extraction',
          middleware: extractReasoningMiddleware({ tagName })
        })
      }
      break
    }
    case 'gemini':
      // Gemini特定中间件
      break
    case 'aws-bedrock': {
      break
    }
    default:
      // 其他provider的通用处理
      break
  }

  // OVMS+MCP's specific middleware
  if (config.provider.id === 'ovms' && config.mcpTools && config.mcpTools.length > 0) {
    builder.add({
      name: 'no-think',
      middleware: noThinkMiddleware()
    })
  }
}

/**
 * 添加模型特定的中间件
 */
function addModelSpecificMiddlewares(builder: AiSdkMiddlewareBuilder, config: AiSdkMiddlewareConfig): void {
  if (!config.model || !config.provider) return

  // Qwen models on providers that don't support enable_thinking parameter (like Ollama, LM Studio, NVIDIA)
  // Use /think or /no_think suffix to control thinking mode
  if (
    config.provider &&
    isSupportedThinkingTokenQwenModel(config.model) &&
    !isSupportEnableThinkingProvider(config.provider)
  ) {
    const enableThinking = config.assistant?.settings?.reasoning_effort !== undefined
    builder.add({
      name: 'qwen-thinking-control',
      middleware: qwenThinkingMiddleware(enableThinking)
    })
    logger.debug(`Added Qwen thinking middleware with thinking ${enableThinking ? 'enabled' : 'disabled'}`)
  }

  // 可以根据模型ID或特性添加特定中间件
  // 例如：图像生成模型、多模态模型等
  if (isOpenRouterGeminiGenerateImageModel(config.model, config.provider)) {
    builder.add({
      name: 'openrouter-gemini-image-generation',
      middleware: openrouterGenerateImageMiddleware()
    })
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

  // 将普通中间件数组转换为具名中间件并添加
  defaultMiddlewares.forEach((middleware, index) => {
    builder.add({
      name: `default-middleware-${index}`,
      middleware
    })
  })

  return builder
}
