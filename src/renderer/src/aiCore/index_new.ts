/**
 * Cherry Studio AI Core - 新版本入口
 * 集成 @cherrystudio/ai-core 库的渐进式重构方案
 *
 * 融合方案：简化实现，专注于核心功能
 * 1. 优先使用新AI SDK
 * 2. 暂时保持接口兼容性
 */

import type { GatewayLanguageModelEntry } from '@ai-sdk/gateway'
import { createExecutor } from '@cherrystudio/ai-core'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import type { StartSpanParams } from '@renderer/trace/types/ModelSpanEntity'
import { type Assistant, type GenerateImageParams, type Model, type Provider, SystemProviderIds } from '@renderer/types'
import type { AiSdkModel, StreamTextParams } from '@renderer/types/aiCoreTypes'
import { SUPPORTED_IMAGE_ENDPOINT_LIST } from '@renderer/utils'
import { buildClaudeCodeSystemModelMessage } from '@shared/anthropic'
import { gateway, type ImageModel, type LanguageModel, type Provider as AiSdkProvider, wrapLanguageModel } from 'ai'

import AiSdkToChunkAdapter from './chunk/AiSdkToChunkAdapter'
import LegacyAiProvider from './legacy/index'
import type { CompletionsParams, CompletionsResult } from './legacy/middleware/schemas'
import type { AiSdkMiddlewareConfig } from './middleware/AiSdkMiddlewareBuilder'
import { buildAiSdkMiddlewares } from './middleware/AiSdkMiddlewareBuilder'
import { buildPlugins } from './plugins/PluginBuilder'
import { createAiSdkProvider } from './provider/factory'
import {
  getActualProvider,
  isModernSdkSupported,
  prepareSpecialProviderConfig,
  providerToAiSdkConfig
} from './provider/providerConfig'

const logger = loggerService.withContext('ModernAiProvider')

export type ModernAiProviderConfig = AiSdkMiddlewareConfig & {
  assistant: Assistant
  // topicId for tracing
  topicId?: string
  callType: string
}

export default class ModernAiProvider {
  private legacyProvider: LegacyAiProvider
  private config?: ReturnType<typeof providerToAiSdkConfig>
  private actualProvider: Provider
  private model?: Model
  private localProvider: Awaited<AiSdkProvider> | null = null

  // 构造函数重载签名
  constructor(model: Model, provider?: Provider)
  constructor(provider: Provider)
  constructor(modelOrProvider: Model | Provider, provider?: Provider)
  constructor(modelOrProvider: Model | Provider, provider?: Provider) {
    if (this.isModel(modelOrProvider)) {
      // 传入的是 Model
      this.model = modelOrProvider
      this.actualProvider = provider || getActualProvider(modelOrProvider)
      // 只保存配置，不预先创建executor
      this.config = providerToAiSdkConfig(this.actualProvider, modelOrProvider)
    } else {
      // 传入的是 Provider
      this.actualProvider = modelOrProvider
      // model为可选，某些操作（如fetchModels）不需要model
    }

    this.legacyProvider = new LegacyAiProvider(this.actualProvider)
  }

  /**
   * 类型守卫函数：通过 provider 属性区分 Model 和 Provider
   */
  private isModel(obj: Model | Provider): obj is Model {
    return 'provider' in obj && typeof obj.provider === 'string'
  }

  public getActualProvider() {
    return this.actualProvider
  }

  public async completions(modelId: string, params: StreamTextParams, providerConfig: ModernAiProviderConfig) {
    // 检查model是否存在
    if (!this.model) {
      throw new Error('Model is required for completions. Please use constructor with model parameter.')
    }

    // 每次请求时重新生成配置以确保API key轮换生效
    this.config = providerToAiSdkConfig(this.actualProvider, this.model)
    logger.debug('Generated provider config for completions', this.config)
    if (SUPPORTED_IMAGE_ENDPOINT_LIST.includes(this.config.options.endpoint)) {
      providerConfig.isImageGenerationEndpoint = true
    }
    // 准备特殊配置
    await prepareSpecialProviderConfig(this.actualProvider, this.config)

    // 提前创建本地 provider 实例
    if (!this.localProvider) {
      this.localProvider = await createAiSdkProvider(this.config)
    }

    // 提前构建中间件
    const middlewares = buildAiSdkMiddlewares({
      ...providerConfig,
      provider: this.actualProvider,
      assistant: providerConfig.assistant
    })
    logger.debug('Built middlewares in completions', {
      middlewareCount: middlewares.length,
      isImageGeneration: providerConfig.isImageGenerationEndpoint
    })
    if (!this.localProvider) {
      throw new Error('Local provider not created')
    }

    // 根据endpoint类型创建对应的模型
    let model: AiSdkModel | undefined
    if (providerConfig.isImageGenerationEndpoint) {
      model = this.localProvider.imageModel(modelId)
    } else {
      model = this.localProvider.languageModel(modelId)
      // 如果有中间件，应用到语言模型上
      if (middlewares.length > 0 && typeof model === 'object') {
        model = wrapLanguageModel({ model, middleware: middlewares })
      }
    }

    if (this.actualProvider.id === 'anthropic' && this.actualProvider.authType === 'oauth') {
      const claudeCodeSystemMessage = buildClaudeCodeSystemModelMessage(params.system)
      params.system = undefined // 清除原有system，避免重复
      params.messages = [...claudeCodeSystemMessage, ...(params.messages || [])]
    }

    if (providerConfig.topicId && (await preferenceService.get('app.developer_mode.enabled'))) {
      // TypeScript类型窄化：确保topicId是string类型
      const traceConfig = {
        ...providerConfig,
        topicId: providerConfig.topicId
      }
      return await this._completionsForTrace(model, params, traceConfig)
    } else {
      return await this._completionsOrImageGeneration(model, params, providerConfig)
    }
  }

  private async _completionsOrImageGeneration(
    model: AiSdkModel,
    params: StreamTextParams,
    config: ModernAiProviderConfig
  ): Promise<CompletionsResult> {
    if (config.isImageGenerationEndpoint) {
      // 使用 legacy 实现处理图像生成（支持图片编辑等高级功能）
      if (!config.uiMessages) {
        throw new Error('uiMessages is required for image generation endpoint')
      }

      const legacyParams: CompletionsParams = {
        callType: 'chat',
        messages: config.uiMessages, // 使用原始的 UI 消息格式
        assistant: config.assistant,
        streamOutput: config.streamOutput ?? true,
        onChunk: config.onChunk,
        topicId: config.topicId,
        mcpTools: config.mcpTools,
        enableWebSearch: config.enableWebSearch
      }

      // 调用 legacy 的 completions，会自动使用 ImageGenerationMiddleware
      return await this.legacyProvider.completions(legacyParams)
    }

    return await this.modernCompletions(model as LanguageModel, params, config)
  }

  /**
   * 带trace支持的completions方法
   * 类似于legacy的completionsForTrace，确保AI SDK spans在正确的trace上下文中
   */
  private async _completionsForTrace(
    model: AiSdkModel,
    params: StreamTextParams,
    config: ModernAiProviderConfig & { topicId: string }
  ): Promise<CompletionsResult> {
    const modelId = this.model!.id
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

    const span = await addSpan(traceParams)
    if (!span) {
      logger.warn('Failed to create span, falling back to regular completions', {
        topicId: config.topicId,
        modelId,
        traceName
      })
      return await this._completionsOrImageGeneration(model, params, config)
    }

    try {
      logger.info('Created parent span, now calling completions', {
        spanId: span.spanContext().spanId,
        traceId: span.spanContext().traceId,
        topicId: config.topicId,
        modelId,
        parentSpanCreated: true
      })

      const result = await this._completionsOrImageGeneration(model, params, config)

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
    model: LanguageModel,
    params: StreamTextParams,
    config: ModernAiProviderConfig
  ): Promise<CompletionsResult> {
    // const modelId = this.model!.id
    // logger.info('Starting modernCompletions', {
    //   modelId,
    //   providerId: this.config!.providerId,
    //   topicId: config.topicId,
    //   hasOnChunk: !!config.onChunk,
    //   hasTools: !!params.tools && Object.keys(params.tools).length > 0,
    //   toolCount: params.tools ? Object.keys(params.tools).length : 0
    // })

    // 根据条件构建插件数组
    const plugins = await buildPlugins(config)

    // 用构建好的插件数组创建executor
    const executor = createExecutor(this.config!.providerId, this.config!.options, plugins)

    // 创建带有中间件的执行器
    if (config.onChunk) {
      const accumulate = this.model!.supported_text_delta !== false // true and undefined
      const adapter = new AiSdkToChunkAdapter(config.onChunk, config.mcpTools, accumulate, config.enableWebSearch)

      const streamResult = await executor.streamText({
        ...params,
        model,
        experimental_context: { onChunk: config.onChunk }
      })

      const finalText = await adapter.processStream(streamResult)

      return {
        getText: () => finalText
      }
    } else {
      const streamResult = await executor.streamText({
        ...params,
        model
      })

      // 强制消费流,不然await streamResult.text会阻塞
      await streamResult?.consumeStream()

      const finalText = await streamResult.text

      return {
        getText: () => finalText
      }
    }
  }

  /**
   * 使用现代化 AI SDK 的图像生成实现，支持流式输出
   * @deprecated 已改为使用 legacy 实现以支持图片编辑等高级功能
   */
  /*
  private async modernImageGeneration(
    model: ImageModel,
    params: StreamTextParams,
    config: ModernAiProviderConfig
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
      const executor = createExecutor(this.config!.providerId, this.config!.options, [])
      const result = await executor.generateImage({
        model,
        ...imageParams
      })

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
  */

  // 代理其他方法到原有实现
  public async models() {
    if (this.actualProvider.id === SystemProviderIds['ai-gateway']) {
      const formatModel = function (models: GatewayLanguageModelEntry[]): Model[] {
        return models.map((m) => ({
          id: m.id,
          name: m.name,
          provider: 'gateway',
          group: m.id.split('/')[0],
          description: m.description ?? undefined
        }))
      }
      return formatModel((await gateway.getAvailableModels()).models)
    }
    return this.legacyProvider.models()
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    return this.legacyProvider.getEmbeddingDimensions(model)
  }

  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    // 如果支持新的 AI SDK，使用现代化实现
    if (isModernSdkSupported(this.actualProvider)) {
      try {
        // 确保本地provider已创建
        if (!this.localProvider) {
          this.localProvider = await createAiSdkProvider(this.config)
          if (!this.localProvider) {
            throw new Error('Local provider not created')
          }
        }

        const result = await this.modernGenerateImage(params)
        return result
      } catch (error) {
        logger.warn('Modern AI SDK generateImage failed, falling back to legacy:', error as Error)
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

    const executor = createExecutor(this.config!.providerId, this.config!.options, [])
    const result = await executor.generateImage({
      model: this.localProvider?.imageModel(model) as ImageModel,
      ...aiSdkParams
    })

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

  /**
   * We manually implement this method before aisdk supports it well
   */
  public async createVideo(params: CreateVideoParams): Promise<CreateVideoResult> {
    return this.legacyProvider.createVideo(params)
  }

  /**
   * We manually implement this method before aisdk supports it well
   */
  public async retrieveVideo(params: RetrieveVideoParams): Promise<RetrieveVideoResult> {
    return this.legacyProvider.retrieveVideo(params)
  }

  /**
   * We manually implement this method before aisdk supports it well
   */
  public async retrieveVideoContent(params: RetrieveVideoContentParams): Promise<RetrieveVideoContentResult> {
    return this.legacyProvider.retrieveVideoContent(params)
  }

  /**
   * We manually implement this method before aisdk supports it well
   */
  public async deleteVideo(params: DeleteVideoParams): Promise<DeleteVideoResult> {
    return this.legacyProvider.deleteVideo(params)
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
