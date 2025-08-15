/**
 * Cherry Studio AI Core - 新版本入口
 * 集成 @cherrystudio/ai-core 库的渐进式重构方案
 *
 * 融合方案：简化实现，专注于核心功能
 * 1. 优先使用新AI SDK
 * 2. 失败时fallback到原有实现
 * 3. 暂时保持接口兼容性
 */

import { createExecutor, generateImage, StreamTextParams } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { isNotSupportedImageSizeModel } from '@renderer/config/models'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import { StartSpanParams } from '@renderer/trace/types/ModelSpanEntity'
import type { Assistant, GenerateImageParams, Model, Provider } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'

import AiSdkToChunkAdapter from './chunk/AiSdkToChunkAdapter'
import LegacyAiProvider from './legacy/index'
import { CompletionsResult } from './legacy/middleware/schemas'
import { AiSdkMiddlewareConfig, buildAiSdkMiddlewares } from './middleware/AiSdkMiddlewareBuilder'
import { buildPlugins } from './plugins/PluginBuilder'
import { getActualProvider, isModernSdkSupported, providerToAiSdkConfig } from './provider/ProviderConfigProcessor'

const logger = loggerService.withContext('ModernAiProvider')

export default class ModernAiProvider {
  private legacyProvider: LegacyAiProvider
  private config: ReturnType<typeof providerToAiSdkConfig>
  private actualProvider: Provider

  constructor(model: Model, provider?: Provider) {
    this.actualProvider = provider || getActualProvider(model)
    this.legacyProvider = new LegacyAiProvider(this.actualProvider)

    // 只保存配置，不预先创建executor
    this.config = providerToAiSdkConfig(this.actualProvider)
  }

  public getActualProvider() {
    return this.actualProvider
  }

  public async completions(
    modelId: string,
    params: StreamTextParams,
    config: AiSdkMiddlewareConfig & {
      assistant: Assistant
      // topicId for tracing
      topicId?: string
      callType: string
    }
  ): Promise<CompletionsResult> {
    if (config.isImageGenerationEndpoint) {
      return await this.modernImageGeneration(modelId, params, config)
    }

    return await this.modernCompletions(modelId, params, config)
  }

  /**
   * 带trace支持的completions方法
   * 类似于legacy的completionsForTrace，确保AI SDK spans在正确的trace上下文中
   */
  public async completionsForTrace(
    modelId: string,
    params: StreamTextParams,
    config: AiSdkMiddlewareConfig & {
      assistant: Assistant
      // topicId for tracing
      topicId?: string
      callType: string
    }
  ): Promise<CompletionsResult> {
    if (!config.topicId) {
      logger.warn('No topicId provided, falling back to regular completions')
      return await this.completions(modelId, params, config)
    }

    const traceName = `${this.actualProvider.name}.${modelId}.${config.callType}`
    const traceParams: StartSpanParams = {
      name: traceName,
      tag: 'LLM',
      topicId: config.topicId,
      modelName: config.assistant.model?.name, // 使用modelId而不是provider名称
      inputs: params
    }

    logger.info('Starting AI SDK trace span', {
      traceName,
      topicId: config.topicId,
      modelId,
      hasTools: !!params.tools && Object.keys(params.tools).length > 0,
      toolNames: params.tools ? Object.keys(params.tools) : [],
      isImageGeneration: config.isImageGenerationEndpoint
    })

    const span = addSpan(traceParams)
    if (!span) {
      logger.warn('Failed to create span, falling back to regular completions', {
        topicId: config.topicId,
        modelId,
        traceName
      })
      return await this.completions(modelId, params, config)
    }

    try {
      logger.info('Created parent span, now calling completions', {
        spanId: span.spanContext().spanId,
        traceId: span.spanContext().traceId,
        topicId: config.topicId,
        modelId,
        parentSpanCreated: true
      })

      const result = await this.completions(modelId, params, config)

      logger.info('Completions finished, ending parent span', {
        spanId: span.spanContext().spanId,
        traceId: span.spanContext().traceId,
        topicId: config.topicId,
        modelId,
        resultLength: result.getText().length
      })

      // 标记span完成
      endSpan({
        topicId: config.topicId,
        outputs: result,
        span,
        modelName: modelId // 使用modelId保持一致性
      })

      return result
    } catch (error) {
      logger.error('Error in completionsForTrace, ending parent span with error', error as Error, {
        spanId: span.spanContext().spanId,
        traceId: span.spanContext().traceId,
        topicId: config.topicId,
        modelId
      })

      // 标记span出错
      endSpan({
        topicId: config.topicId,
        error: error as Error,
        span,
        modelName: modelId // 使用modelId保持一致性
      })
      throw error
    }
  }

  /**
   * 使用现代化AI SDK的completions实现
   */
  private async modernCompletions(
    modelId: string,
    params: StreamTextParams,
    config: AiSdkMiddlewareConfig & {
      assistant: Assistant
      // topicId for tracing
      topicId?: string
      callType: string
    }
  ): Promise<CompletionsResult> {
    logger.info('Starting modernCompletions', {
      modelId,
      providerId: this.config.providerId,
      topicId: config.topicId,
      hasOnChunk: !!config.onChunk,
      hasTools: !!params.tools && Object.keys(params.tools).length > 0,
      toolCount: params.tools ? Object.keys(params.tools).length : 0
    })

    // 根据条件构建插件数组
    const plugins = buildPlugins(config)
    logger.debug('Built plugins for AI SDK', {
      pluginCount: plugins.length,
      pluginNames: plugins.map((p) => p.name),
      providerId: this.config.providerId,
      topicId: config.topicId
    })

    // 用构建好的插件数组创建executor
    const executor = createExecutor(this.config.providerId, this.config.options, plugins)
    logger.debug('Created AI SDK executor', {
      providerId: this.config.providerId,
      hasOptions: !!this.config.options,
      pluginCount: plugins.length
    })

    // 动态构建中间件数组
    const middlewares = buildAiSdkMiddlewares(config)
    logger.debug('Built AI SDK middlewares', {
      middlewareCount: middlewares.length,
      topicId: config.topicId
    })

    // 创建带有中间件的执行器
    if (config.onChunk) {
      // 流式处理 - 使用适配器
      logger.info('Starting streaming with chunk adapter', {
        modelId,
        hasMiddlewares: middlewares.length > 0,
        middlewareCount: middlewares.length,
        hasMcpTools: !!config.mcpTools,
        mcpToolCount: config.mcpTools?.length || 0,
        topicId: config.topicId
      })

      const adapter = new AiSdkToChunkAdapter(config.onChunk, config.mcpTools)

      logger.debug('Final params before streamText', {
        modelId,
        hasMessages: !!params.messages,
        messageCount: params.messages?.length || 0,
        hasTools: !!params.tools && Object.keys(params.tools).length > 0,
        toolNames: params.tools ? Object.keys(params.tools) : [],
        hasSystem: !!params.system,
        topicId: config.topicId
      })

      const streamResult = await executor.streamText(
        modelId,
        params,
        middlewares.length > 0 ? { middlewares } : undefined
      )

      logger.info('StreamText call successful, processing stream', {
        modelId,
        topicId: config.topicId,
        hasFullStream: !!streamResult.fullStream
      })

      const finalText = await adapter.processStream(streamResult)

      logger.info('Stream processing completed', {
        modelId,
        topicId: config.topicId,
        finalTextLength: finalText.length
      })

      return {
        getText: () => finalText
      }
    } else {
      // 流式处理但没有 onChunk 回调
      logger.info('Starting streaming without chunk callback', {
        modelId,
        hasMiddlewares: middlewares.length > 0,
        middlewareCount: middlewares.length,
        topicId: config.topicId
      })

      const streamResult = await executor.streamText(
        modelId,
        params,
        middlewares.length > 0 ? { middlewares } : undefined
      )

      logger.info('StreamText call successful, waiting for text', {
        modelId,
        topicId: config.topicId
      })
      // 强制消费流,不然await streamResult.text会阻塞
      await streamResult?.consumeStream()

      const finalText = await streamResult.text

      logger.info('Text extraction completed', {
        modelId,
        topicId: config.topicId,
        finalTextLength: finalText.length
      })

      return {
        getText: () => finalText
      }
    }
    // }
    // catch (error) {
    //   console.error('Modern AI SDK error:', error)
    //   throw error
    // }
  }

  /**
   * 使用现代化 AI SDK 的图像生成实现，支持流式输出
   */
  private async modernImageGeneration(
    modelId: string,
    params: StreamTextParams,
    config: AiSdkMiddlewareConfig & {
      assistant: Assistant
      // topicId for tracing
      topicId?: string
      callType: string
    }
  ): Promise<CompletionsResult> {
    const { onChunk } = config

    try {
      // 检查 messages 是否存在
      if (!params.messages || params.messages.length === 0) {
        throw new Error('No messages provided for image generation.')
      }

      // 从最后一条用户消息中提取 prompt
      const lastUserMessage = params.messages.findLast((m) => m.role === 'user')
      if (!lastUserMessage) {
        throw new Error('No user message found for image generation.')
      }

      // 直接使用消息内容，避免类型转换问题
      const prompt =
        typeof lastUserMessage.content === 'string'
          ? lastUserMessage.content
          : lastUserMessage.content?.map((part) => ('text' in part ? part.text : '')).join('') || ''

      if (!prompt) {
        throw new Error('No prompt found in user message.')
      }

      const startTime = Date.now()

      // 发送图像生成开始事件
      if (onChunk) {
        onChunk({ type: ChunkType.IMAGE_CREATED })
      }

      // 构建图像生成参数
      const imageParams = {
        prompt,
        size: isNotSupportedImageSizeModel(config.model) ? undefined : ('1024x1024' as `${number}x${number}`), // 默认尺寸，使用正确的类型
        n: 1,
        ...(params.abortSignal && { abortSignal: params.abortSignal })
      }

      // 调用新 AI SDK 的图像生成功能
      const result = await generateImage(this.config.providerId, this.config.options, modelId, imageParams)

      // 转换结果格式
      const images: string[] = []
      const imageType: 'url' | 'base64' = 'base64'

      if (result.images) {
        for (const image of result.images) {
          if ('base64' in image && image.base64) {
            images.push(`data:${image.mediaType};base64,${image.base64}`)
          }
        }
      }

      // 发送图像生成完成事件
      if (onChunk && images.length > 0) {
        onChunk({
          type: ChunkType.IMAGE_COMPLETE,
          image: { type: imageType, images }
        })
      }

      // 发送块完成事件（类似于 modernCompletions 的处理）
      if (onChunk) {
        const usage = {
          prompt_tokens: prompt.length, // 估算的 token 数量
          completion_tokens: 0, // 图像生成没有 completion tokens
          total_tokens: prompt.length
        }

        onChunk({
          type: ChunkType.BLOCK_COMPLETE,
          response: {
            usage,
            metrics: {
              completion_tokens: usage.completion_tokens,
              time_first_token_millsec: 0,
              time_completion_millsec: Date.now() - startTime
            }
          }
        })

        // 发送 LLM 响应完成事件
        onChunk({
          type: ChunkType.LLM_RESPONSE_COMPLETE,
          response: {
            usage,
            metrics: {
              completion_tokens: usage.completion_tokens,
              time_first_token_millsec: 0,
              time_completion_millsec: Date.now() - startTime
            }
          }
        })
      }

      return {
        getText: () => '' // 图像生成不返回文本
      }
    } catch (error) {
      // 发送错误事件
      if (onChunk) {
        onChunk({ type: ChunkType.ERROR, error: error as any })
      }
      throw error
    }
  }

  // 代理其他方法到原有实现
  public async models() {
    return this.legacyProvider.models()
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    return this.legacyProvider.getEmbeddingDimensions(model)
  }

  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    // 如果支持新的 AI SDK，使用现代化实现
    if (isModernSdkSupported(this.actualProvider)) {
      try {
        const result = await this.modernGenerateImage(params)
        return result
      } catch (error) {
        console.warn('Modern AI SDK generateImage failed, falling back to legacy:', error)
        // fallback 到传统实现
        return this.legacyProvider.generateImage(params)
      }
    }

    // 直接使用传统实现
    return this.legacyProvider.generateImage(params)
  }

  /**
   * 使用现代化 AI SDK 的图像生成实现
   */
  private async modernGenerateImage(params: GenerateImageParams): Promise<string[]> {
    const { model, prompt, imageSize, batchSize, signal } = params

    // 转换参数格式
    const aiSdkParams = {
      prompt,
      size: (imageSize || '1024x1024') as `${number}x${number}`,
      n: batchSize || 1,
      ...(signal && { abortSignal: signal })
    }

    const result = await generateImage(this.config.providerId, this.config.options, model, aiSdkParams)

    // 转换结果格式
    const images: string[] = []
    if (result.images) {
      for (const image of result.images) {
        if ('base64' in image && image.base64) {
          images.push(`data:image/png;base64,${image.base64}`)
        }
      }
    }

    return images
  }

  public getBaseURL(): string {
    return this.legacyProvider.getBaseURL()
  }

  public getApiKey(): string {
    return this.legacyProvider.getApiKey()
  }
}

// 为了方便调试，导出一些工具函数
export { isModernSdkSupported, providerToAiSdkConfig }
