import { createExecutor } from '@cherrystudio/ai-core'
import type { generateImageResult } from '@cherrystudio/ai-core/core/runtime/types'
import { cacheService } from '@data/CacheService'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import type { Assistant, EditImageParams, GenerateImageParams, Model, Provider } from '@renderer/types'
import type { StreamTextParams } from '@renderer/types/aiCoreTypes'
import { getLowerBaseModelName } from '@renderer/utils'
import type { StartSpanParams } from '@renderer/windows/trace/types/ModelSpanEntity'
import type { JSONValue } from 'ai'

import AiSdkToChunkAdapter from './chunk/AiSdkToChunkAdapter'
import { buildPlugins } from './plugins/PluginBuilder'
import { adaptProvider, getActualProvider, providerToAiSdkConfig } from './provider/providerConfig'
import { listModels } from './services/listModels'
import type { AppProviderSettingsMap, CompletionsResult, ProviderConfig } from './types'
import type { AiSdkMiddlewareConfig } from './types/middlewareConfig'
import { type ClassifiedImage, classifyImageOutput, downloadImageUrls } from './utils/imageDownload'
import { buildImageProviderOptions } from './utils/imageOptions'

const logger = loggerService.withContext('AiProvider')

/**
 * Merge caller-supplied extra `providerOptions` (e.g. the polling `onProgress`
 * callback for ppio) into the structurally-built map. Per-provider
 * keys are shallow-merged so structured params and pass-through params coexist.
 * Extra values are kept by reference — non-JSON callbacks survive the plugin
 * chain (it shallow-copies, no JSON clone).
 */
function mergeExtraProviderOptions(
  base: Record<string, Record<string, unknown>>,
  extra?: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  if (!extra) return base
  const merged: Record<string, Record<string, unknown>> = { ...base }
  for (const [providerKey, values] of Object.entries(extra)) {
    merged[providerKey] = { ...merged[providerKey], ...values }
  }
  return merged
}

/**
 * Resolve the AI SDK `size` parameter from the caller's `imageSize`.
 *
 * `undefined` (returned only when `allowAutoSize` is true) tells the caller to
 * omit the `size` field entirely — preserving the bespoke painting behavior
 * where `painting.size === 'auto'` did NOT send `size:'1024x1024'` to the
 * server (some backends, e.g. newapi gpt-image, treat `auto` differently from
 * an explicit `1024x1024`).
 */
function resolveImageSize(
  imageSize: string | undefined,
  allowAutoSize: boolean | undefined
): `${number}x${number}` | undefined {
  if (imageSize) return imageSize as `${number}x${number}`
  if (allowAutoSize) return undefined
  return '1024x1024'
}

/**
 * Normalize the painting form's `ASPECT_X_Y` enum (or already-normalized
 * `X:Y`) into the `${number}:${number}` shape the AI SDK ImageModelV3 expects.
 * Returns `undefined` for non-strings or mismatched values so the call site
 * can omit the field entirely.
 */
function resolveAspectRatio(value: string | undefined): `${number}:${number}` | undefined {
  if (!value) return undefined
  const stripped = value.replace(/^ASPECT_/i, '').replace('_', ':')
  return /^\d+:\d+$/.test(stripped) ? (stripped as `${number}:${number}`) : undefined
}

export type AiProviderConfig = AiSdkMiddlewareConfig & {
  assistant: Assistant
  // topicId for tracing
  topicId?: string
  callType: string
}

export default class AiProvider {
  private config?: ProviderConfig
  private actualProvider: Provider
  private model?: Model

  /**
   * Constructor for AiProvider
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
   * const ai = new AiProvider(model)
   *
   * // Provider will be adapted
   * const ai = new AiProvider(model, customProvider)
   *
   * // For operations that don't need a model
   * const ai = new AiProvider(provider)
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

  public async completions(modelId: string, params: StreamTextParams, middlewareConfig: AiProviderConfig) {
    // 检查model是否存在
    if (!this.model) {
      throw new Error('Model is required for completions. Please use constructor with model parameter.')
    }

    // Config is now set in constructor, ApiService handles key rotation before passing provider
    if (!this.config) {
      // If config wasn't set in constructor (when provider only), generate it now
      this.config = await Promise.resolve(providerToAiSdkConfig(this.actualProvider, this.model))
    }
    logger.debug('Using provider config for completions', this.config)

    // 注意：模型对象将由 createExecutor 内部处理，不再需要预先创建

    if (middlewareConfig.topicId && (await preferenceService.get('app.developer_mode.enabled'))) {
      // TypeScript类型窄化：确保topicId是string类型
      const traceConfig = {
        ...middlewareConfig,
        topicId: middlewareConfig.topicId
      }
      return await this._completionsForTrace(modelId, params, traceConfig, this.config)
    } else {
      return await this.modernCompletions(modelId, params, middlewareConfig, this.config)
    }
  }

  /**
   * 带trace支持的completions方法
   * 类似于legacy的completionsForTrace，确保AI SDK spans在正确的trace上下文中
   */
  private async _completionsForTrace(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: AiProviderConfig & { topicId: string },
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
      toolNames: params.tools ? Object.keys(params.tools) : []
    })

    const span = await addSpan(traceParams)
    if (!span) {
      logger.warn('Failed to create span, falling back to regular completions', {
        topicId: middlewareConfig.topicId,
        modelId,
        traceName
      })
      return await this.modernCompletions(modelId, params, middlewareConfig, providerConfig)
    }

    try {
      logger.info('Created parent span, now calling completions', {
        spanId: span.spanContext().spanId,
        traceId: span.spanContext().traceId,
        topicId: middlewareConfig.topicId,
        modelId,
        parentSpanCreated: true
      })

      const result = await this.modernCompletions(modelId, params, middlewareConfig, providerConfig)

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
  /**
   * Note: This implementation always uses `executor.streamText` and never
   * calls `generateText`, even when `onChunk` is not provided.
   */
  private async modernCompletions(
    modelId: string,
    params: StreamTextParams,
    middlewareConfig: AiProviderConfig,
    providerConfig: ProviderConfig
  ): Promise<CompletionsResult> {
    const plugins = await buildPlugins({
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
        middlewareConfig.enableWebSearch,
        undefined,
        undefined,
        providerConfig.providerId,
        middlewareConfig.idleTimeout
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
      // Since no onChunk is provided, the external consumer would not handle error chunk.
      // So we need to capture the actual stream error so we can throw it instead of the
      // generic NoTextGeneratedError ("No output generated. Check the stream
      // for errors.") that AI SDK raises when streamResult.text is accessed
      // after a failed stream.
      let streamError: unknown = undefined

      const streamResult = await executor.streamText({
        ...params,
        model: modelId,
        onError({ error }) {
          streamError = error
        }
      })

      // 强制消费流,不然await streamResult.text会阻塞
      await streamResult?.consumeStream({
        onError(error) {
          if (!streamError) {
            streamError = error
          }
        }
      })

      try {
        const finalText = await streamResult.text
        const usage = await streamResult.totalUsage

        return {
          getText: () => finalText,
          usage
        }
      } catch (error) {
        // If we captured the real stream error, throw that instead of the
        // generic NoTextGeneratedError so callers get actionable diagnostics.
        if (streamError) {
          throw streamError
        }
        throw error
      }
    }
  }

  /**
   * 获取模型列表
   * 使用 ModelListService 统一处理各 Provider 的模型列表获取
   */
  public async models(options?: { throwOnError?: boolean }): Promise<Model[]> {
    return await listModels(this.actualProvider, undefined, options)
  }

  /**
   * 获取嵌入模型的维度
   * 使用 AI SDK embedMany 测试获取维度
   */
  public async getEmbeddingDimensions(model: Model, signal?: AbortSignal): Promise<number> {
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
      values: ['test'],
      abortSignal: signal
    })

    return result.embeddings[0].length
  }

  /**
   * 懒加载初始化 config
   * 当 constructor 只传入 provider 时，config 不会被初始化
   * 此方法根据 modelId 从 provider 的 models 中查找真实 Model 并生成 config
   */
  private async ensureConfig(modelId: string): Promise<void> {
    if (this.config) {
      return
    }

    // 从 provider 的 models 中查找真实的 model
    const model = this.actualProvider.models.find((m) => getLowerBaseModelName(m.id) === getLowerBaseModelName(modelId))
    if (!model) {
      throw new Error(`Model "${modelId}" not found in provider "${this.actualProvider.id}"`)
    }

    this.actualProvider = adaptProvider({ provider: this.actualProvider, model })
    this.config = await Promise.resolve(providerToAiSdkConfig(this.actualProvider, model))
  }

  /**
   * 生成图像
   * 使用现代化 AI SDK 实现，不再 fallback 到 legacy
   */
  public async generateImage(params: GenerateImageParams): Promise<string[]> {
    await this.ensureConfig(params.model)
    return await this.modernGenerateImage(params, this.config!)
  }

  /**
   * Painting-oriented image generation (R1 shared infra).
   *
   * Keeps the painting result shape (`url` or raw base64) while allowing AI SDK
   * URL outputs to be downloaded through `experimental_download` before media
   * sniffing.
   */
  public async generatePaintingImage(params: GenerateImageParams): Promise<ClassifiedImage[]> {
    await this.ensureConfig(params.model)
    return await this.modernGeneratePaintingImage(params, this.config!)
  }

  /**
   * 编辑图像 - 基于输入图像和文本提示生成新图像
   * 内部使用 AI SDK 的 generateImage，通过 prompt.images 参数实现编辑功能
   */
  public async editImage(params: EditImageParams): Promise<string[]> {
    await this.ensureConfig(params.model)
    return await this.modernEditImage(params, this.config!)
  }

  /**
   * 使用现代化 AI SDK 的图像生成实现
   */
  private async modernGenerateImage(params: GenerateImageParams, providerConfig: ProviderConfig): Promise<string[]> {
    const { model, prompt, imageSize, aspectRatio, batchSize, signal, allowAutoSize } = params

    // Forward the remaining params (negativePrompt/seed/steps/guidance/
    // promptEnhancement/personGeneration/quality) via AI SDK providerOptions —
    // they were previously dropped here. Keyed by the resolved provider id,
    // which is the providerOptions key the image model reads.
    const providerOptions = mergeExtraProviderOptions(
      buildImageProviderOptions(providerConfig.providerId, params),
      params.providerOptions
    )

    // 转换参数格式
    const resolvedSize = resolveImageSize(imageSize, allowAutoSize)
    const resolvedAspectRatio = resolveAspectRatio(aspectRatio)
    const aiSdkParams = {
      prompt,
      ...(resolvedSize !== undefined && { size: resolvedSize }),
      ...(resolvedAspectRatio !== undefined && { aspectRatio: resolvedAspectRatio }),
      n: batchSize || 1,
      // Cast: extra providerOptions may carry non-JSON callbacks (e.g. the
      // polling `onProgress`) which the AI SDK passes through by reference.
      ...(Object.keys(providerOptions).length > 0 && {
        providerOptions: providerOptions as Record<string, Record<string, JSONValue>>
      }),
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
   * Painting variant of {@link modernGenerateImage}: identical request
   * construction, but injects {@link downloadImageUrls} so URL results are
   * downloaded before the SDK wraps them as generated files.
   */
  private async modernGeneratePaintingImage(
    params: GenerateImageParams,
    providerConfig: ProviderConfig
  ): Promise<ClassifiedImage[]> {
    const { model, prompt, inputImages, imageSize, aspectRatio, batchSize, signal, allowAutoSize } = params

    const providerOptions = mergeExtraProviderOptions(
      buildImageProviderOptions(providerConfig.providerId, params),
      params.providerOptions
    )

    const resolvedSize = resolveImageSize(imageSize, allowAutoSize)
    const resolvedAspectRatio = resolveAspectRatio(aspectRatio)
    const aiSdkParams = {
      prompt: inputImages && inputImages.length > 0 ? { text: prompt, images: inputImages } : prompt,
      ...(resolvedSize !== undefined && { size: resolvedSize }),
      ...(resolvedAspectRatio !== undefined && { aspectRatio: resolvedAspectRatio }),
      n: batchSize || 1,
      experimental_download: downloadImageUrls,
      ...(Object.keys(providerOptions).length > 0 && {
        providerOptions: providerOptions as Record<string, Record<string, JSONValue>>
      }),
      ...(signal && { abortSignal: signal })
    }

    const executor = await createExecutor<AppProviderSettingsMap>(
      providerConfig.providerId,
      providerConfig.providerSettings,
      []
    )
    const result = await executor.generateImage({
      model: model,
      ...aiSdkParams
    })

    const out: ClassifiedImage[] = []
    if (result.images) {
      for (const image of result.images) {
        if (image.base64) {
          out.push(classifyImageOutput(image.base64))
        }
      }
    }
    return out
  }

  /**
   * 使用现代化 AI SDK 的图像编辑实现
   * 通过 AI SDK 的 generateImage 并传入 prompt.images 参数实现编辑功能
   */
  private async modernEditImage(params: EditImageParams, providerConfig: ProviderConfig): Promise<string[]> {
    const { model, prompt, inputImages, mask, imageSize, signal, allowAutoSize } = params

    // Parity with modernGenerateImage: forward quality/background/moderation via
    // providerOptions, keyed by the resolved provider id (the providerOptions key
    // the image model reads). Justified by the unified newapi edit consumer.
    const providerOptions = mergeExtraProviderOptions(
      buildImageProviderOptions(providerConfig.providerId, params),
      params.providerOptions
    )

    const executor = await createExecutor<AppProviderSettingsMap>(
      providerConfig.providerId,
      providerConfig.providerSettings,
      []
    )

    // 使用 AI SDK 的 generateImage，通过 prompt.images 实现编辑
    const resolvedSize = resolveImageSize(imageSize, allowAutoSize)
    const result = await executor.generateImage({
      model: model,
      prompt: {
        text: prompt,
        images: inputImages, // 输入图像（必需）
        ...(mask && { mask }) // 可选的 mask（用于 inpainting）
      },
      ...(resolvedSize !== undefined && { size: resolvedSize }),
      // Cast: see modernGenerateImage — extra providerOptions may carry
      // non-JSON callbacks the AI SDK passes through by reference.
      ...(Object.keys(providerOptions).length > 0 && {
        providerOptions: providerOptions as Record<string, Record<string, JSONValue>>
      }),
      ...(signal && { abortSignal: signal })
    })

    return this.convertImageResult(result)
  }

  /**
   * 转换图像生成结果格式
   */
  private convertImageResult(result: generateImageResult): string[] {
    const images: string[] = []
    if (result.images) {
      for (const image of result.images) {
        if (image.base64) {
          // Defensive: some transports already return a `data:<mt>;base64,…`
          // string; strip it so we don't emit a double-prefixed (corrupt)
          // data URL.
          const base64 = image.base64.replace(/^data:[^;,]*;base64,/, '')
          images.push(`data:${image.mediaType || 'image/png'};base64,${base64}`)
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
    const lastUsedKey = cacheService.getCasual<string>(keyName)

    if (!lastUsedKey) {
      cacheService.setCasual(keyName, keys[0])
      return keys[0]
    }

    const currentIndex = keys.indexOf(lastUsedKey)
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]
    cacheService.setCasual(keyName, nextKey)

    return nextKey
  }
}
