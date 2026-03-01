/**
 * 运行时执行器
 * 专注于插件化的AI调用处理
 */
import type { ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'
import {
  createProviderRegistry,
  generateImage as _generateImage,
  generateText as _generateText,
  streamText as _streamText
} from 'ai'

import { isV3Model } from '../models/utils'
import { type AiPlugin, type AiRequestContext, definePlugin } from '../plugins'
import type { CoreProviderSettingsMap, StringKeys } from '../providers/types'
import { ImageGenerationError, ImageModelResolutionError } from './errors'
import { PluginEngine } from './pluginEngine'
import type { generateImageParams, generateTextParams, RuntimeConfig, streamTextParams } from './types'

export class RuntimeExecutor<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
> {
  public pluginEngine: PluginEngine<T>
  private config: RuntimeConfig<TSettingsMap, T>
  private registry: ReturnType<typeof createProviderRegistry>

  constructor(config: RuntimeConfig<TSettingsMap, T>) {
    this.config = config
    // 创建插件客户端
    this.pluginEngine = new PluginEngine(config.providerId, config.plugins || [])
    this.registry = createProviderRegistry({
      [config.providerId]: config.provider
    })
  }

  private createResolveModelPlugin() {
    return definePlugin({
      name: '_internal_resolveModel',
      enforce: 'post',

      resolveModel: async (modelId: string) => {
        // 仅负责解析 modelId → model 对象，middleware 由 pluginEngine 统一应用
        return await this.resolveModel(modelId)
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
  async streamText(params: streamTextParams): Promise<ReturnType<typeof _streamText>> {
    const { model } = params

    // 根据 model 类型决定插件配置
    if (typeof model === 'string') {
      this.pluginEngine.usePlugins([this.createResolveModelPlugin(), this.createConfigureContextPlugin()])
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
  async generateText(params: generateTextParams): Promise<ReturnType<typeof _generateText>> {
    const { model } = params

    // 根据 model 类型决定插件配置
    if (typeof model === 'string') {
      this.pluginEngine.usePlugins([this.createResolveModelPlugin(), this.createConfigureContextPlugin()])
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
  async generateImage(params: generateImageParams): Promise<ReturnType<typeof _generateImage>> {
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

  // === 辅助方法 ===

  /**
   * 解析模型：将字符串 modelId 解析为 model 对象
   * middleware 的应用由 pluginEngine 统一处理
   */
  private async resolveModel(modelOrId: LanguageModel): Promise<LanguageModelV3> {
    if (typeof modelOrId === 'string') {
      return this.registry.languageModel(`${this.config.providerId}:${modelOrId}` as `${string}:${string}`)
    } else {
      if (!isV3Model(modelOrId)) {
        throw new Error(
          `Model must be V3. Provider "${this.config.providerId}" returned a V2 model. ` +
            'All providers should be wrapped with wrapProvider to return V3 models.'
        )
      }
      return modelOrId
    }
  }

  /**
   * 解析图像模型：如果是字符串则创建图像模型，如果是模型则直接返回
   */
  private async resolveImageModel(modelOrId: ImageModelV3 | string): Promise<ImageModelV3> {
    try {
      if (typeof modelOrId === 'string') {
        return this.registry.imageModel(`${this.config.providerId}:${modelOrId}` as `${string}:${string}`)
      } else {
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
