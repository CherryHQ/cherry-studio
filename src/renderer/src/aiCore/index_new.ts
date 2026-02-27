/**
 * Cherry Studio AI Core - 新版本入口
 * 集成 @cherrystudio/ai-core 库的渐进式重构方案
 *
 * 融合方案：简化实现，专注于核心功能
 * 1. 优先使用新AI SDK
 * 2. 暂时保持接口兼容性
 */

import { createExecutor } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { getEnableDeveloperMode } from '@renderer/hooks/useSettings'
import { normalizeGatewayModels, normalizeSdkModels } from '@renderer/services/models/ModelAdapter'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import type { StartSpanParams } from '@renderer/trace/types/ModelSpanEntity'
import { type Assistant, type GenerateImageParams, type Model, type Provider, SystemProviderIds } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { SUPPORTED_IMAGE_ENDPOINT_LIST } from '@renderer/utils'
import { buildClaudeCodeSystemModelMessage } from '@shared/anthropic'
import { gateway } from 'ai'

import AiSdkToChunkAdapter from './chunk/AiSdkToChunkAdapter'
import LegacyAiProvider from './legacy/index'
import type { CompletionsParams, CompletionsResult } from './legacy/middleware/schemas'
import { buildPlugins } from './plugins/PluginBuilder'
import {
  adaptProvider,
  getActualProvider,
  isModernSdkSupported,
  providerToAiSdkConfig
} from './provider/providerConfig'
import type { AppProviderSettingsMap, ProviderConfig } from './types'
import type { AiSdkMiddlewareConfig } from './types/middlewareConfig'

const logger = loggerService.withContext('ModernAiProvider')

export type ModernAiProviderConfig = AiSdkMiddlewareConfig & {
  assistant: Assistant
  // topicId for tracing
  topicId?: string
  callType: string
}

export default class ModernAiProvider {
  private legacyProvider: LegacyAiProvider
  private config?: ProviderConfig
  private configPromise?: Promise<ProviderConfig>
  private actualProvider: Provider
  private model?: Model

  /**
   * Constructor for ModernAiProvider
   *
   * @param modelOrProvider - Model or Provider object
   * @param provider - Optional Provider object (only used when first param is Model)
   *
   * @remarks
   * **Important behavior notes**:
   *
   * 1. When called with `(model)`:
   *    - Calls `getActualProvider(model)` to retrieve and format the provider
   *    - URL will be automatically formatted via `formatProviderApiHost`, adding version suffixes like `/v1`
   *
   * 2. When called with `(model, provider)`:
   *    - The provided provider will be adapted via `adaptProvider`
   *    - URL formatting behavior depends on the adapted result
   *
   * 3. When called with `(provider)`:
   *    - The provider will be adapted via `adaptProvider`
   *    - Used for operations that don't need a model (e.g., fetchModels)
   *
   * @example
   * ```typescript
   * // Recommended: Auto-format URL
   * const ai = new ModernAiProvider(model)
   *
   * // Provider will be adapted
   * const ai = new ModernAiProvider(model, customProvider)
   *
   * // For operations that don't need a model
   * const ai = new ModernAiProvider(provider)
   * ```
   */
  constructor(model: Model, provider?: Provider)
  constructor(provider: Provider)
  constructor(modelOrProvider: Model | Provider, provider?: Provider)
  constructor(modelOrProvider: Model | Provider, provider?: Provider) {
    if (this.isModel(modelOrProvider)) {
      // 传入的是 Model
      this.model = modelOrProvider
      this.actualProvider = provider
        ? adaptProvider({ provider, model: modelOrProvider })
        : getActualProvider(modelOrProvider)
      // 注意：config 可能是同步值或 Promise，在 completions() 中会统一处理
      const configOrPromise = providerToAiSdkConfig(this.actualProvider, modelOrProvider)
      this.config = configOrPromise instanceof Promise ? undefined : configOrPromise
    } else {
      // 传入的是 Provider
      this.actualProvider = adaptProvider({ provider: modelOrProvider })
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

  /**
   * Resolve async config with deduplication.
   * Ensures concurrent callers share the same in-flight promise.
   */
  private async resolveConfig(): Promise<ProviderConfig> {
    if (this.config) return this.config
    if (!this.model) {
      throw new Error('Model is required to resolve provider config. Use constructor with model parameter.')
    }
    if (!this.configPromise) {
      this.configPromise = Promise.resolve(providerToAiSdkConfig(this.actualProvider, this.model)).then((config) => {
        this.config = config
        this.configPromise = undefined
        return config
      })
    }
    return this.configPromise
  }

  public async completions(modelId: string, params: StreamTextParams, middlewareConfig: ModernAiProviderConfig) {
    // 检查model是否存在
    if (!this.model) {
      throw new Error('Model is required for completions. Please use constructor with model parameter.')
    }

    // Config is now set in constructor, ApiService handles key rotation before passing provider
    if (!this.config) {
      this.config = await this.resolveConfig()
    }
    logger.debug('Using provider config for completions', this.config)

    if (this.config.endpoint && (SUPPORTED_IMAGE_ENDPOINT_LIST as readonly string[]).includes(this.config.endpoint)) {
      middlewareConfig.isImageGenerationEndpoint = true
    }

    // 注意：模型对象将由 createExecutor 内部处理，不再需要预先创建

    if (this.actualProvider.id === 'anthropic' && this.actualProvider.authType === 'oauth') {
      // 类型守卫：确保 system 是 string、Array 或 undefined
      const system = params.system
      let systemParam: string | Array<any> | undefined
      if (typeof system === 'string' || Array.isArray(system) || system === undefined) {
        systemParam = system
      } else {
        // SystemModelMessage 类型，转换为 string
        systemParam = undefined
      }

      const claudeCodeSystemMessage = buildClaudeCodeSystemModelMessage(systemParam)
      params.system = undefined // 清除原有system，避免重复
      params.messages = [...claudeCodeSystemMessage, ...(params.messages || [])]
    }

    if (middlewareConfig.topicId && getEnableDeveloperMode()) {
      // TypeScript类型窄化：确保topicId是string类型
      const traceConfig = {
        ...middlewareConfig,
        topicId: middlewareConfig.topicId
      }
      return await this._completionsForTrace(modelId, params, traceConfig, this.config)
    } else {
      return await this._completionsOrImageGeneration(modelId, params, middlewareConfig, this.config)
    }
  }

  private async _completionsOrImageGeneration(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: ModernAiProviderConfig,
    providerConfig: ProviderConfig
  ): Promise<CompletionsResult> {
    // ai-gateway不是image/generation 端点，所以就先不走legacy了
    if (middlewareConfig.isImageGenerationEndpoint && this.getActualProvider().id !== SystemProviderIds.gateway) {
      // 使用 legacy 实现处理图像生成（支持图片编辑等高级功能）
      if (!middlewareConfig.uiMessages) {
        throw new Error('uiMessages is required for image generation endpoint')
      }

      const legacyParams: CompletionsParams = {
        callType: 'chat',
        messages: middlewareConfig.uiMessages, // 使用原始的 UI 消息格式
        assistant: middlewareConfig.assistant,
        streamOutput: middlewareConfig.streamOutput ?? true,
        onChunk: middlewareConfig.onChunk,
        topicId: middlewareConfig.topicId,
        mcpTools: middlewareConfig.mcpTools,
        enableWebSearch: middlewareConfig.enableWebSearch
      }

      // 调用 legacy 的 completions，会自动使用 ImageGenerationMiddleware
      return await this.legacyProvider.completions(legacyParams)
    }

    return await this.modernCompletions(modelId, params, middlewareConfig, providerConfig)
  }

  /**
   * 带trace支持的completions方法
   * 类似于legacy的completionsForTrace，确保AI SDK spans在正确的trace上下文中
   */
  private async _completionsForTrace(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: ModernAiProviderConfig & { topicId: string },
    providerConfig: ProviderConfig
  ): Promise<CompletionsResult> {
    const traceName = `${this.actualProvider.name}.${modelId}.${middlewareConfig.callType}`
    const traceParams: StartSpanParams = {
      name: traceName,
      tag: 'LLM',
      topicId: middlewareConfig.topicId,
      modelName: middlewareConfig.assistant.model?.name, // 使用modelId而不是provider名称
      inputs: params
    }

    logger.info('Starting AI SDK trace span', {
      traceName,
      topicId: middlewareConfig.topicId,
      modelId,
      hasTools: !!params.tools && Object.keys(params.tools).length > 0,
      toolNames: params.tools ? Object.keys(params.tools) : [],
      isImageGeneration: middlewareConfig.isImageGenerationEndpoint
    })

    const span = addSpan(traceParams)
    if (!span) {
      logger.warn('Failed to create span, falling back to regular completions', {
        topicId: middlewareConfig.topicId,
        modelId,
        traceName
      })
      return await this._completionsOrImageGeneration(modelId, params, middlewareConfig, providerConfig)
    }

    try {
      logger.info('Created parent span, now calling completions', {
        spanId: span.spanContext().spanId,
        traceId: span.spanContext().traceId,
        topicId: middlewareConfig.topicId,
        modelId,
        parentSpanCreated: true
      })

      const result = await this._completionsOrImageGeneration(modelId, params, middlewareConfig, providerConfig)

      logger.info('Completions finished, ending parent span', {
        spanId: span.spanContext().spanId,
        traceId: span.spanContext().traceId,
        topicId: middlewareConfig.topicId,
        modelId,
        resultLength: result.getText().length
      })

      // 标记span完成
      endSpan({
        topicId: middlewareConfig.topicId,
        outputs: result,
        span,
        modelName: modelId // 使用modelId保持一致性
      })

      return result
    } catch (error) {
      logger.error('Error in completionsForTrace, ending parent span with error', error as Error, {
        spanId: span.spanContext().spanId,
        traceId: span.spanContext().traceId,
        topicId: middlewareConfig.topicId,
        modelId
      })

      // 标记span出错
      endSpan({
        topicId: middlewareConfig.topicId,
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
    middlewareConfig: ModernAiProviderConfig,
    providerConfig: ProviderConfig
  ): Promise<CompletionsResult> {
    const plugins = buildPlugins({
      provider: this.actualProvider,
      model: this.model!,
      config: middlewareConfig
    })

    // 用构建好的插件数组创建executor
    const executor = await createExecutor<AppProviderSettingsMap>(
      providerConfig.providerId,
      providerConfig.providerSettings,
      plugins
    )

    // 创建带有中间件的执行器
    if (middlewareConfig.onChunk) {
      const accumulate = this.model!.supported_text_delta !== false // true and undefined
      const adapter = new AiSdkToChunkAdapter(
        middlewareConfig.onChunk,
        middlewareConfig.mcpTools,
        accumulate,
        middlewareConfig.enableWebSearch
      )

      const streamResult = await executor.streamText({
        ...params,
        model: modelId,
        experimental_context: { onChunk: middlewareConfig.onChunk }
      })

      const finalText = await adapter.processStream(streamResult)

      return {
        getText: () => finalText
      }
    } else {
      const streamResult = await executor.streamText({
        ...params,
        model: modelId
      })

      // 强制消费流,不然await streamResult.text会阻塞
      await streamResult?.consumeStream()

      const finalText = await streamResult.text
      const usage = await streamResult.totalUsage

      return {
        getText: () => finalText,
        usage
      }
    }
  }

  // /**
  //  * 使用现代化 AI SDK 的图像生成实现，支持流式输出
  //  * @deprecated 已改为使用 legacy 实现以支持图片编辑等高级功能
  //  */
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
      const executor = await createExecutor<AppProviderSettingsMap>(this.config!.providerId, this.config!.providerSettings, [])
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
    if (this.actualProvider.id === SystemProviderIds.gateway) {
      const gatewayModels = (await gateway.getAvailableModels()).models
      return normalizeGatewayModels(this.actualProvider, gatewayModels)
    }
    const sdkModels = await this.legacyProvider.models()
    return normalizeSdkModels(this.actualProvider, sdkModels)
  }

  public async getEmbeddingDimensions(model: Model): Promise<number> {
    return this.legacyProvider.getEmbeddingDimensions(model)
  }

  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    // 如果支持新的 AI SDK，使用现代化实现
    if (isModernSdkSupported(this.actualProvider)) {
      try {
        // Resolve async config if not yet set (mirrors completions() recovery)
        if (!this.config && this.model) {
          this.config = await this.resolveConfig()
        }
        if (!this.config) {
          throw new Error('Provider config is undefined; cannot proceed with generateImage')
        }
        const result = await this.modernGenerateImage(params, this.config)
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
  private async modernGenerateImage(params: GenerateImageParams, providerConfig: ProviderConfig): Promise<string[]> {
    const { model, prompt, imageSize, batchSize, signal } = params

    // 转换参数格式
    const aiSdkParams = {
      prompt,
      size: (imageSize || '1024x1024') as `${number}x${number}`,
      n: batchSize || 1,
      ...(signal && { abortSignal: signal })
    }

    const executor = await createExecutor<AppProviderSettingsMap>(
      providerConfig.providerId,
      providerConfig.providerSettings,
      []
    )
    const result = await executor.generateImage({
      model: model, // 直接使用 model ID 字符串，由 executor 内部解析
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

  public getBaseURL(): string {
    return this.legacyProvider.getBaseURL()
  }

  public getApiKey(): string {
    return this.legacyProvider.getApiKey()
  }
}

// 为了方便调试，导出一些工具函数
export { isModernSdkSupported, providerToAiSdkConfig }
