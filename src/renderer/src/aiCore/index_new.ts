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
import { normalizeGatewayModels } from '@renderer/services/models/ModelAdapter'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import type { StartSpanParams } from '@renderer/trace/types/ModelSpanEntity'
import {
  type Assistant,
  type EditImageParams,
  type GenerateImageParams,
  type Model,
  type Provider,
  SystemProviderIds
} from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { SUPPORTED_IMAGE_ENDPOINT_LIST } from '@renderer/utils'
import { buildClaudeCodeSystemModelMessage } from '@shared/anthropic'
import { gateway } from 'ai'

import AiSdkToChunkAdapter from './chunk/AiSdkToChunkAdapter'
import { buildPlugins } from './plugins/PluginBuilder'
import { adaptProvider, getActualProvider, providerToAiSdkConfig } from './provider/providerConfig'
import { ModelListService } from './services/ModelListService'
import type { AppProviderSettingsMap, CompletionsResult, ProviderConfig } from './types'
import type { AiSdkMiddlewareConfig } from './types/middlewareConfig'

const logger = loggerService.withContext('ModernAiProvider')

export type ModernAiProviderConfig = AiSdkMiddlewareConfig & {
  assistant: Assistant
  // topicId for tracing
  topicId?: string
  callType: string
}

export default class ModernAiProvider {
  private config?: ProviderConfig
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

  public async completions(modelId: string, params: StreamTextParams, middlewareConfig: ModernAiProviderConfig) {
    // 检查model是否存在
    if (!this.model) {
      throw new Error('Model is required for completions. Please use constructor with model parameter.')
    }

    // Config is now set in constructor, ApiService handles key rotation before passing provider
    if (!this.config) {
      // If config wasn't set in constructor (when provider only), generate it now
      this.config = await Promise.resolve(providerToAiSdkConfig(this.actualProvider, this.model!))
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
    // 专用图像生成模型已在 ApiService 层分流到 fetchImageGeneration
    // 这里只处理普通的 completions
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
    const plugins = buildPlugins(middlewareConfig)

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

      return {
        getText: () => finalText
      }
    }
  }

  /**
   * 获取模型列表
   * 使用 ModelListService 统一处理各 Provider 的模型列表获取
   */
  public async models(): Promise<Model[]> {
    // Gateway provider 使用 AI SDK 的 gateway API
    if (this.actualProvider.id === SystemProviderIds.gateway) {
      const gatewayModels = (await gateway.getAvailableModels()).models
      return normalizeGatewayModels(this.actualProvider, gatewayModels)
    }

    // 使用新的 ModelListService
    return await ModelListService.listModels(this.actualProvider)
  }

  /**
   * 获取嵌入模型的维度
   * 使用 AI SDK embedMany 测试获取维度
   */
  public async getEmbeddingDimensions(model: Model): Promise<number> {
    // 确保 config 已定义
    if (!this.config) {
      this.config = await Promise.resolve(providerToAiSdkConfig(this.actualProvider, model))
    }

    const executor = await createExecutor<AppProviderSettingsMap>(
      this.config.providerId,
      this.config.providerSettings,
      []
    )

    // 使用 AI SDK embedMany 测试获取维度
    const result = await executor.embedMany({
      model: model.id,
      values: ['test']
    })

    return result.embeddings[0].length
  }

  /**
   * 生成图像
   * 使用现代化 AI SDK 实现，不再 fallback 到 legacy
   */
  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    // 确保 config 已定义
    if (!this.config) {
      throw new Error('Provider config is undefined; cannot proceed with generateImage')
    }

    return await this.modernGenerateImage(params, this.config)
  }

  /**
   * 编辑图像 - 基于输入图像和文本提示生成新图像
   * 内部使用 AI SDK 的 generateImage，通过 prompt.images 参数实现编辑功能
   */
  public async editImage(params: EditImageParams): Promise<string[]> {
    // 确保 config 已定义
    if (!this.config) {
      throw new Error('Provider config is undefined; cannot proceed with editImage')
    }

    return await this.modernEditImage(params, this.config)
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

    return this.convertImageResult(result)
  }

  /**
   * 使用现代化 AI SDK 的图像编辑实现
   * 通过 AI SDK 的 generateImage 并传入 prompt.images 参数实现编辑功能
   */
  private async modernEditImage(params: EditImageParams, providerConfig: ProviderConfig): Promise<string[]> {
    const { model, prompt, inputImages, mask, imageSize, signal } = params

    const executor = await createExecutor<AppProviderSettingsMap>(
      providerConfig.providerId,
      providerConfig.providerSettings,
      []
    )

    // 使用 AI SDK 的 generateImage，通过 prompt.images 实现编辑
    const result = await executor.generateImage({
      model: model,
      prompt: {
        text: prompt,
        images: inputImages, // 输入图像（必需）
        ...(mask && { mask }) // 可选的 mask（用于 inpainting）
      },
      size: (imageSize || '1024x1024') as `${number}x${number}`,
      ...(signal && { abortSignal: signal })
    })

    return this.convertImageResult(result)
  }

  /**
   * 转换图像生成结果格式
   */
  private convertImageResult(result: any): string[] {
    const images: string[] = []
    if (result.images) {
      for (const image of result.images) {
        if ('base64' in image && image.base64) {
          images.push(`data:${image.mediaType || 'image/png'};base64,${image.base64}`)
        } else if ('url' in image && image.url) {
          images.push(image.url)
        }
      }
    }
    return images
  }

  public getBaseURL(): string {
    return this.actualProvider.apiHost || ''
  }

  public getApiKey(): string {
    const apiKey = this.actualProvider.apiKey
    if (!apiKey || apiKey.trim() === '') {
      return ''
    }

    const keys = apiKey
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)

    if (keys.length === 0) {
      return ''
    }

    if (keys.length === 1) {
      return keys[0]
    }

    // Multi-key rotation
    const keyName = `provider:${this.actualProvider.id}:last_used_key`
    const lastUsedKey = window.keyv.get(keyName)

    if (!lastUsedKey) {
      window.keyv.set(keyName, keys[0])
      return keys[0]
    }

    const currentIndex = keys.indexOf(lastUsedKey)
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]
    window.keyv.set(keyName, nextKey)

    return nextKey
  }
}
