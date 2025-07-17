/**
 * 运行时执行器
 * 专注于插件化的AI调用处理
 */
import { LanguageModelV2, LanguageModelV2Middleware } from '@ai-sdk/provider'
import { generateObject, generateText, LanguageModel, streamObject, streamText } from 'ai'

import { type ProviderId } from '../../types'
import { createModel, getProviderInfo } from '../models'
import { type ModelConfig } from '../models/types'
import { type AiPlugin, type AiRequestContext, definePlugin } from '../plugins'
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

  createResolveModelPlugin(middlewares?: LanguageModelV2Middleware[]) {
    return definePlugin({
      name: '_internal_resolveModel',
      enforce: 'post',

      resolveModel: async (modelId: string, context: AiRequestContext) => {
        // 从 context 中读取由用户插件注入的 extraModelConfig
        const extraModelConfig = context.extraModelConfig || {}
        return await this.resolveModel(modelId, middlewares, extraModelConfig)
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

  /**
   * 流式文本生成 - 使用modelId + 可选middleware（灵活用法）
   */
  async streamText(
    modelId: string,
    params: Omit<Parameters<typeof streamText>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof streamText>>

  /**
   * 流式文本生成 - 内部实现（统一处理重载）
   */
  async streamText(
    modelOrId: LanguageModel,
    params: Omit<Parameters<typeof streamText>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof streamText>> {
    this.pluginEngine.use(this.createResolveModelPlugin(options?.middlewares))

    // 2. 执行插件处理
    return this.pluginEngine.executeStreamWithPlugins(
      'streamText',
      typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
      params,
      async (model, transformedParams, streamTransforms) => {
        const experimental_transform =
          params?.experimental_transform ?? (streamTransforms.length > 0 ? streamTransforms : undefined)

        return await streamText({
          model,
          ...transformedParams,
          experimental_transform
        })
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

  /**
   * 生成文本 - 使用modelId + 可选middleware
   */
  async generateText(
    modelId: string,
    params: Omit<Parameters<typeof generateText>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof generateText>>

  /**
   * 生成文本 - 内部实现
   */
  async generateText(
    modelOrId: LanguageModel | string,
    params: Omit<Parameters<typeof generateText>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof generateText>> {
    this.pluginEngine.use(this.createResolveModelPlugin(options?.middlewares))

    return this.pluginEngine.executeWithPlugins(
      'generateText',
      typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
      params,
      async (model, transformedParams) => {
        return await generateText({ model, ...transformedParams })
      }
    )
  }

  /**
   * 生成结构化对象 - 使用已创建的模型
   */
  async generateObject(
    model: LanguageModel,
    params: Omit<Parameters<typeof generateObject>[0], 'model'>
  ): Promise<ReturnType<typeof generateObject>>

  /**
   * 生成结构化对象 - 使用modelId + 可选middleware
   */
  async generateObject(
    modelOrId: string,
    params: Omit<Parameters<typeof generateObject>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof generateObject>>

  /**
   * 生成结构化对象 - 内部实现
   */
  async generateObject(
    modelOrId: LanguageModel | string,
    params: Omit<Parameters<typeof generateObject>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof generateObject>> {
    this.pluginEngine.use(this.createResolveModelPlugin(options?.middlewares))

    return this.pluginEngine.executeWithPlugins(
      'generateObject',
      typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
      params,
      async (model, transformedParams) => {
        return await generateObject({ model, ...transformedParams })
      }
    )
  }

  /**
   * 流式生成结构化对象 - 使用已创建的模型
   */
  async streamObject(
    model: LanguageModel,
    params: Omit<Parameters<typeof streamObject>[0], 'model'>
  ): Promise<ReturnType<typeof streamObject>>

  /**
   * 流式生成结构化对象 - 使用modelId + 可选middleware
   */
  async streamObject(
    modelId: string,
    params: Omit<Parameters<typeof streamObject>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof streamObject>>

  /**
   * 流式生成结构化对象 - 内部实现
   */
  async streamObject(
    modelOrId: LanguageModel | string,
    params: Omit<Parameters<typeof streamObject>[0], 'model'>,
    options?: {
      middlewares?: LanguageModelV2Middleware[]
    }
  ): Promise<ReturnType<typeof streamObject>> {
    this.pluginEngine.use(this.createResolveModelPlugin(options?.middlewares))

    return this.pluginEngine.executeWithPlugins(
      'streamObject',
      typeof modelOrId === 'string' ? modelOrId : modelOrId.modelId,
      params,
      async (model, transformedParams) => {
        return await streamObject({ model, ...transformedParams })
      }
    )
  }

  // === 辅助方法 ===

  /**
   * 解析模型：如果是字符串则创建模型，如果是模型则直接返回
   */
  private async resolveModel(
    modelOrId: LanguageModel,
    middlewares?: LanguageModelV2Middleware[],
    extraModelConfig?: Record<string, any>
  ): Promise<LanguageModelV2> {
    if (typeof modelOrId === 'string') {
      // 字符串modelId，需要创建模型
      return await createModel({
        providerId: this.config.providerId,
        modelId: modelOrId,
        providerSettings: this.config.providerSettings,
        middlewares,
        extraModelConfig
      })
    } else {
      // 已经是模型，直接返回
      return modelOrId
    }
  }

  /**
   * 获取客户端信息
   */
  getClientInfo() {
    return getProviderInfo(this.config.providerId)
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
