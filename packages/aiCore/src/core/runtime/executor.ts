/**
 * 运行时执行器
 * 专注于插件化的AI调用处理
 */
import type { ImageModelV3, LanguageModelV3, LanguageModelV3Middleware, ProviderV3 } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'
import {
  embedMany as _embedMany,
  generateImage as _generateImage,
  generateText as _generateText,
  streamText as _streamText,
  wrapLanguageModel
} from 'ai'

import { ModelResolver } from '../models'
import { isV3Model } from '../models/utils'
import { type AiPlugin, type AiRequestContext, definePlugin } from '../plugins'
import type { CoreProviderSettingsMap, StringKeys } from '../providers/types'
import { ImageGenerationError, ImageModelResolutionError } from './errors'
import { PluginEngine } from './pluginEngine'
import type {
  EmbedManyParams,
  EmbedManyResult,
  generateImageParams,
  generateImageResult,
  generateTextParams,
  RuntimeConfig,
  streamTextParams
} from './types'

export class RuntimeExecutor<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
> {
  public pluginEngine: PluginEngine<T>
  private config: RuntimeConfig<TSettingsMap, T>
  private modelResolver: ModelResolver

  constructor(config: RuntimeConfig<TSettingsMap, T>) {
    this.config = config
    // 创建插件客户端
    this.pluginEngine = new PluginEngine(config.providerId, config.plugins || [])
    this.modelResolver = new ModelResolver(config.provider)
  }

  private createResolveModelPlugin(middlewares?: LanguageModelV3Middleware[]) {
    return definePlugin({
      name: '_internal_resolveModel',
      enforce: 'post',

      resolveModel: async (modelId: string) => {
        // 注意：extraModelConfig 暂时不支持，已在新架构中移除
        return await this.resolveModel(modelId, middlewares)
      }
    })
  }

  private createResolveImageModelPlugin() {
    return definePlugin({
      name: '_internal_resolveImageModel',
      enforce: 'post',

      resolveModel: async (modelId: string) => {
        return await this.resolveImageModel(modelId)
      }
    })
  }

  private createConfigureContextPlugin() {
    return definePlugin({
      name: '_internal_configureContext',
      configureContext: async (context: AiRequestContext) => {
        context.executor = this
      }
    })
  }

  // === 高阶重载：直接使用模型 ===

  /**
   * 流式文本生成
   */
  async streamText(
    params: streamTextParams,
    options?: {
      middlewares?: LanguageModelV3Middleware[]
    }
  ): Promise<ReturnType<typeof _streamText>> {
    const { model } = params

    // 根据 model 类型决定插件配置
    if (typeof model === 'string') {
      this.pluginEngine.usePlugins([
        this.createResolveModelPlugin(options?.middlewares),
        this.createConfigureContextPlugin()
      ])
    } else {
      this.pluginEngine.usePlugins([this.createConfigureContextPlugin()])
    }

    return this.pluginEngine.executeStreamWithPlugins(
      'streamText',
      params,
      (resolvedModel, transformedParams, streamTransforms) => {
        const experimental_transform =
          params?.experimental_transform ?? (streamTransforms.length > 0 ? streamTransforms : undefined)

        return _streamText({
          ...transformedParams,
          model: resolvedModel,
          experimental_transform
        })
      }
    )
  }

  // === 其他方法的重载 ===

  /**
   * 生成文本
   */
  async generateText(
    params: generateTextParams,
    options?: {
      middlewares?: LanguageModelV3Middleware[]
    }
  ): Promise<ReturnType<typeof _generateText>> {
    const { model } = params

    // 根据 model 类型决定插件配置
    if (typeof model === 'string') {
      this.pluginEngine.usePlugins([
        this.createResolveModelPlugin(options?.middlewares),
        this.createConfigureContextPlugin()
      ])
    } else {
      this.pluginEngine.usePlugins([this.createConfigureContextPlugin()])
    }

    return this.pluginEngine.executeWithPlugins<Parameters<typeof _generateText>[0], ReturnType<typeof _generateText>>(
      'generateText',
      params,
      (resolvedModel, transformedParams) => _generateText({ ...transformedParams, model: resolvedModel })
    )
  }

  /**
   * 生成图像
   */
  async generateImage(params: generateImageParams): Promise<generateImageResult> {
    try {
      const { model } = params

      // 根据 model 类型决定插件配置
      if (typeof model === 'string') {
        this.pluginEngine.usePlugins([this.createResolveImageModelPlugin(), this.createConfigureContextPlugin()])
      } else {
        this.pluginEngine.usePlugins([this.createConfigureContextPlugin()])
      }

      return this.pluginEngine.executeImageWithPlugins('generateImage', params, (resolvedModel, transformedParams) =>
        _generateImage({ ...transformedParams, model: resolvedModel })
      )
    } catch (error) {
      if (error instanceof Error) {
        const modelId = typeof params.model === 'string' ? params.model : params.model.modelId
        throw new ImageGenerationError(
          `Failed to generate image: ${error.message}`,
          this.config.providerId,
          modelId,
          error
        )
      }
      throw error
    }
  }

  /**
   * 批量嵌入文本
   */
  async embedMany(params: EmbedManyParams): Promise<EmbedManyResult> {
    const { model: modelOrId, ...options } = params

    // 解析 embedding 模型
    const embeddingModel =
      typeof modelOrId === 'string' ? await this.modelResolver.resolveEmbeddingModel(modelOrId) : modelOrId

    return _embedMany({
      model: embeddingModel,
      ...options
    })
  }

  // === 辅助方法 ===

  /**
   * 解析模型：如果是字符串则创建模型，如果是模型则直接返回
   */
  private async resolveModel(
    modelOrId: LanguageModel,
    middlewares?: LanguageModelV3Middleware[]
  ): Promise<LanguageModelV3> {
    if (typeof modelOrId === 'string') {
      // 字符串modelId，使用 ModelResolver 解析
      // Provider会处理命名空间格式路由（如果是HubProvider）
      return await this.modelResolver.resolveLanguageModel(modelOrId, middlewares)
    } else {
      // 已经是模型对象
      // 所有 provider 都应该返回 V3 模型（通过 wrapProvider 确保）
      if (!isV3Model(modelOrId)) {
        throw new Error(
          `Model must be V3. Provider "${this.config.providerId}" returned a V2 model. ` +
            'All providers should be wrapped with wrapProvider to return V3 models.'
        )
      }

      // V3 模型，使用 wrapLanguageModel 应用中间件
      return wrapLanguageModel({
        model: modelOrId,
        middleware: middlewares || []
      })
    }
  }

  /**
   * 解析图像模型：如果是字符串则创建图像模型，如果是模型则直接返回
   */
  private async resolveImageModel(modelOrId: ImageModelV3 | string): Promise<ImageModelV3> {
    try {
      if (typeof modelOrId === 'string') {
        // 字符串modelId，使用 ModelResolver 解析
        // Provider会处理命名空间格式路由（如果是HubProvider）
        return await this.modelResolver.resolveImageModel(modelOrId)
      } else {
        // 已经是模型，直接返回
        return modelOrId
      }
    } catch (error) {
      throw new ImageModelResolutionError(
        typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
        this.config.providerId,
        error instanceof Error ? error : undefined
      )
    }
  }

  // === 静态工厂方法 ===

  /**
   * 创建执行器 - 支持已知provider的类型安全
   */
  static create<
    TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
    T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
  >(
    providerId: T,
    provider: ProviderV3,
    options: TSettingsMap[T],
    plugins?: AiPlugin[]
  ): RuntimeExecutor<TSettingsMap, T> {
    return new RuntimeExecutor<TSettingsMap, T>({
      providerId,
      provider,
      providerSettings: options,
      plugins
    })
  }

  /**
   * 创建OpenAI Compatible执行器
   * ✅ Now accepts provider instance directly
   */
  static createOpenAICompatible(
    provider: ProviderV3, // ✅ Accept provider instance
    options: CoreProviderSettingsMap['openai-compatible'],
    plugins: AiPlugin[] = []
  ): RuntimeExecutor<CoreProviderSettingsMap, 'openai-compatible'> {
    return new RuntimeExecutor<CoreProviderSettingsMap, 'openai-compatible'>({
      providerId: 'openai-compatible',
      provider, // ✅ Pass provider to config
      providerSettings: options,
      plugins
    })
  }
}
