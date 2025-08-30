/**
 * 运行时执行器
 * 专注于插件化的AI调用处理
 */
import { ImageModelV2, LanguageModelV2, LanguageModelV2Middleware } from '@ai-sdk/provider'
import {
  experimental_generateImage as generateImage,
  generateObject,
  generateText,
  LanguageModel,
  streamObject,
  streamText
} from 'ai'

import { globalModelResolver } from '../models'
import { type ModelConfig } from '../models/types'
import { type AiPlugin, type AiRequestContext, definePlugin } from '../plugins'
import { type ProviderId } from '../providers'
import { ImageGenerationError, ImageModelResolutionError } from './errors'
import { PluginEngine } from './pluginEngine'
import { type RuntimeConfig } from './types'

export class RuntimeExecutor<T extends ProviderId = ProviderId> {
  public pluginEngine: PluginEngine<T>
  // private options: ProviderSettingsMap[T]
  private config: RuntimeConfig<T>

  constructor(config: RuntimeConfig<T>) {
    // if (!isProviderSupported(config.providerId)) {
    //   throw new Error(`Unsupported provider: ${config.providerId}`)
    // }

    // 存储options供后续使用
    // this.options = config.options
    this.config = config
    // 创建插件客户端
    this.pluginEngine = new PluginEngine(config.providerId, config.plugins || [])
  }

  private createResolveModelPlugin(middlewares?: LanguageModelV2Middleware[]) {
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
   * 流式文本生成 - 使用已创建的模型（高级用法）
   */
  async streamText(
    model: LanguageModel,
    params: Omit<Parameters<typeof streamText>[0], 'model'>
  ): Promise<ReturnType<typeof streamText>>
  async streamText(
    modelId: string,
    params: Omit<Parameters<typeof streamText>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof streamText>>
  async streamText(
    modelOrId: LanguageModel,
    params: Omit<Parameters<typeof streamText>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof streamText>> {
    this.pluginEngine.usePlugins([
      this.createResolveModelPlugin(options?.middlewares),
      this.createConfigureContextPlugin()
    ])

    // 2. 执行插件处理
    return this.pluginEngine.executeStreamWithPlugins(
      'streamText',
      typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
      params,
      async (model, transformedParams, streamTransforms) => {
        const experimental_transform =
          params?.experimental_transform ?? (streamTransforms.length > 0 ? streamTransforms : undefined)

        const finalParams = {
          model,
          ...transformedParams,
          experimental_transform
        } as Parameters<typeof streamText>[0]

        return await streamText(finalParams)
      }
    )
  }

  // === 其他方法的重载 ===

  /**
   * 生成文本 - 使用已创建的模型
   */
  async generateText(
    model: LanguageModel,
    params: Omit<Parameters<typeof generateText>[0], 'model'>
  ): Promise<ReturnType<typeof generateText>>
  async generateText(
    modelId: string,
    params: Omit<Parameters<typeof generateText>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof generateText>>
  async generateText(
    modelOrId: LanguageModel | string,
    params: Omit<Parameters<typeof generateText>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof generateText>> {
    this.pluginEngine.usePlugins([
      this.createResolveModelPlugin(options?.middlewares),
      this.createConfigureContextPlugin()
    ])

    return this.pluginEngine.executeWithPlugins(
      'generateText',
      typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
      params,
      async (model, transformedParams) =>
        generateText({ model, ...transformedParams } as Parameters<typeof generateText>[0])
    )
  }

  /**
   * 生成结构化对象 - 使用已创建的模型
   */
  async generateObject(
    model: LanguageModel,
    params: Omit<Parameters<typeof generateObject>[0], 'model'>
  ): Promise<ReturnType<typeof generateObject>>
  async generateObject(
    modelOrId: string,
    params: Omit<Parameters<typeof generateObject>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof generateObject>>
  async generateObject(
    modelOrId: LanguageModel | string,
    params: Omit<Parameters<typeof generateObject>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof generateObject>> {
    this.pluginEngine.usePlugins([
      this.createResolveModelPlugin(options?.middlewares),
      this.createConfigureContextPlugin()
    ])

    return this.pluginEngine.executeWithPlugins(
      'generateObject',
      typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
      params,
      async (model, transformedParams) =>
        generateObject({ model, ...transformedParams } as Parameters<typeof generateObject>[0])
    )
  }

  /**
   * 流式生成结构化对象 - 使用已创建的模型
   */
  async streamObject(
    model: LanguageModel,
    params: Omit<Parameters<typeof streamObject>[0], 'model'>
  ): Promise<ReturnType<typeof streamObject>>
  async streamObject(
    modelId: string,
    params: Omit<Parameters<typeof streamObject>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof streamObject>>
  async streamObject(
    modelOrId: LanguageModel | string,
    params: Omit<Parameters<typeof streamObject>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof streamObject>> {
    this.pluginEngine.usePlugins([
      this.createResolveModelPlugin(options?.middlewares),
      this.createConfigureContextPlugin()
    ])

    return this.pluginEngine.executeWithPlugins(
      'streamObject',
      typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
      params,
      async (model, transformedParams) =>
        streamObject({ model, ...transformedParams } as Parameters<typeof streamObject>[0])
    )
  }

  /**
   * 生成图像 - 使用已创建的图像模型
   */
  async generateImage(
    model: ImageModelV2,
    params: Omit<Parameters<typeof generateImage>[0], 'model'>
  ): Promise<ReturnType<typeof generateImage>>
  async generateImage(
    modelId: string,
    params: Omit<Parameters<typeof generateImage>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof generateImage>>
  async generateImage(
    modelOrId: ImageModelV2 | string,
    params: Omit<Parameters<typeof generateImage>[0], 'model'>
  ): Promise<ReturnType<typeof generateImage>> {
    try {
      this.pluginEngine.usePlugins([this.createResolveImageModelPlugin(), this.createConfigureContextPlugin()])

      return await this.pluginEngine.executeImageWithPlugins(
        'generateImage',
        typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
        params,
        async (model, transformedParams) => {
          return await generateImage({ model, ...transformedParams })
        }
      )
    } catch (error) {
      if (error instanceof Error) {
        throw new ImageGenerationError(
          `Failed to generate image: ${error.message}`,
          this.config.providerId,
          typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
          error
        )
      }
      throw error
    }
  }

  // === 辅助方法 ===

  /**
   * 解析模型：如果是字符串则创建模型，如果是模型则直接返回
   */
  private async resolveModel(
    modelOrId: LanguageModel,
    middlewares?: LanguageModelV2Middleware[]
  ): Promise<LanguageModelV2> {
    if (typeof modelOrId === 'string') {
      // 🎯 字符串modelId，使用新的ModelResolver解析，传递完整参数
      return await globalModelResolver.resolveLanguageModel(
        modelOrId, // 支持 'gpt-4' 和 'aihubmix:anthropic:claude-3.5-sonnet'
        this.config.providerId, // fallback provider
        this.config.providerSettings, // provider options
        middlewares // 中间件数组
      )
    } else {
      // 已经是模型，直接返回
      return modelOrId
    }
  }

  /**
   * 解析图像模型：如果是字符串则创建图像模型，如果是模型则直接返回
   */
  private async resolveImageModel(modelOrId: ImageModelV2 | string): Promise<ImageModelV2> {
    try {
      if (typeof modelOrId === 'string') {
        // 字符串modelId，使用新的ModelResolver解析
        return await globalModelResolver.resolveImageModel(
          modelOrId, // 支持 'dall-e-3' 和 'aihubmix:openai:dall-e-3'
          this.config.providerId // fallback provider
        )
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
  static create<T extends ProviderId>(
    providerId: T,
    options: ModelConfig<T>['providerSettings'],
    plugins?: AiPlugin[]
  ): RuntimeExecutor<T> {
    return new RuntimeExecutor({
      providerId,
      providerSettings: options,
      plugins
    })
  }

  /**
   * 创建OpenAI Compatible执行器
   */
  static createOpenAICompatible(
    options: ModelConfig<'openai-compatible'>['providerSettings'],
    plugins: AiPlugin[] = []
  ): RuntimeExecutor<'openai-compatible'> {
    return new RuntimeExecutor({
      providerId: 'openai-compatible',
      providerSettings: options,
      plugins
    })
  }
}
