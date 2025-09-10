/* eslint-disable @eslint-react/naming-convention/context-name */
import { ImageModelV2 } from '@ai-sdk/provider'
import { experimental_generateImage, generateObject, generateText, LanguageModel, streamObject, streamText } from 'ai'

import { type AiPlugin, createContext, PluginManager } from '../plugins'
import { type ProviderId } from '../providers/types'

/**
 * 插件增强的 AI 客户端
 * 专注于插件处理，不暴露用户API
 */
export class PluginEngine<T extends ProviderId = ProviderId> {
  private pluginManager: PluginManager

  constructor(
    private readonly providerId: T,
    // private readonly options: ProviderSettingsMap[T],
    plugins: AiPlugin[] = []
  ) {
    this.pluginManager = new PluginManager(plugins)
  }

  /**
   * 添加插件
   */
  use(plugin: AiPlugin): this {
    this.pluginManager.use(plugin)
    return this
  }

  /**
   * 批量添加插件
   */
  usePlugins(plugins: AiPlugin[]): this {
    plugins.forEach((plugin) => this.use(plugin))
    return this
  }

  /**
   * 移除插件
   */
  removePlugin(pluginName: string): this {
    this.pluginManager.remove(pluginName)
    return this
  }

  /**
   * 获取插件统计
   */
  getPluginStats() {
    return this.pluginManager.getStats()
  }

  /**
   * 获取所有插件
   */
  getPlugins() {
    return this.pluginManager.getPlugins()
  }

  /**
   * 执行带插件的操作（非流式）
   * 提供给AiExecutor使用
   */
  async executeWithPlugins<
    TParams extends Parameters<typeof generateText | typeof generateObject>[0],
    TResult extends ReturnType<typeof generateText | typeof generateObject>
  >(
    methodName: string,
    params: TParams,
    executor: (model: LanguageModel, transformedParams: TParams) => TResult,
    _context?: ReturnType<typeof createContext>
  ): Promise<TResult> {
    // 统一处理模型解析
    let resolvedModel: LanguageModel | undefined
    let modelId: string
    const { model } = params
    if (typeof model === 'string') {
      // 字符串：需要通过插件解析
      modelId = model
    } else {
      // 模型对象：直接使用
      resolvedModel = model
      modelId = model.modelId
    }

    // 使用正确的createContext创建请求上下文
    const context = _context ? _context : createContext(this.providerId, model, params)

    // 🔥 为上下文添加递归调用能力
    context.recursiveCall = async (newParams: any): Promise<TResult> => {
      // 递归调用自身，重新走完整的插件流程
      context.isRecursiveCall = true
      const result = await this.executeWithPlugins(methodName, newParams, executor, context)
      context.isRecursiveCall = false
      return result
    }

    try {
      // 0. 配置上下文
      await this.pluginManager.executeConfigureContext(context)

      // 1. 触发请求开始事件
      await this.pluginManager.executeParallel('onRequestStart', context)

      // 2. 解析模型（如果是字符串）
      if (typeof model === 'string') {
        const resolved = await this.pluginManager.executeFirst<LanguageModel>('resolveModel', modelId, context)
        if (!resolved) {
          throw new Error(`Failed to resolve model: ${modelId}`)
        }
        resolvedModel = resolved
      }

      if (!resolvedModel) {
        throw new Error(`Model resolution failed: no model available`)
      }

      // 3. 转换请求参数
      const transformedParams = await this.pluginManager.executeSequential('transformParams', params, context)

      // 4. 执行具体的 API 调用
      const result = await executor(resolvedModel, transformedParams)

      // 5. 转换结果（对于非流式调用）
      const transformedResult = await this.pluginManager.executeSequential('transformResult', result, context)

      // 6. 触发完成事件
      await this.pluginManager.executeParallel('onRequestEnd', context, transformedResult)

      return transformedResult
    } catch (error) {
      // 7. 触发错误事件
      await this.pluginManager.executeParallel('onError', context, undefined, error as Error)
      throw error
    }
  }

  /**
   * 执行带插件的图像生成操作
   * 提供给AiExecutor使用
   */
  async executeImageWithPlugins<
    TParams extends Omit<Parameters<typeof experimental_generateImage>[0], 'model'> & { model: string | ImageModelV2 },
    TResult extends ReturnType<typeof experimental_generateImage>
  >(
    methodName: string,
    params: TParams,
    executor: (model: ImageModelV2, transformedParams: TParams) => TResult,
    _context?: ReturnType<typeof createContext>
  ): Promise<TResult> {
    // 统一处理模型解析
    let resolvedModel: ImageModelV2 | undefined
    let modelId: string
    const { model } = params
    if (typeof model === 'string') {
      // 字符串：需要通过插件解析
      modelId = model
    } else {
      // 模型对象：直接使用
      resolvedModel = model
      modelId = model.modelId
    }

    // 使用正确的createContext创建请求上下文
    const context = _context ? _context : createContext(this.providerId, model, params)

    // 🔥 为上下文添加递归调用能力
    context.recursiveCall = async (newParams: any): Promise<TResult> => {
      // 递归调用自身，重新走完整的插件流程
      context.isRecursiveCall = true
      const result = await this.executeImageWithPlugins(methodName, newParams, executor, context)
      context.isRecursiveCall = false
      return result
    }

    try {
      // 0. 配置上下文
      await this.pluginManager.executeConfigureContext(context)

      // 1. 触发请求开始事件
      await this.pluginManager.executeParallel('onRequestStart', context)

      // 2. 解析模型（如果是字符串）
      if (typeof model === 'string') {
        const resolved = await this.pluginManager.executeFirst<ImageModelV2>('resolveModel', modelId, context)
        if (!resolved) {
          throw new Error(`Failed to resolve image model: ${modelId}`)
        }
        resolvedModel = resolved
      }

      if (!resolvedModel) {
        throw new Error(`Image model resolution failed: no model available`)
      }

      // 3. 转换请求参数
      const transformedParams = await this.pluginManager.executeSequential('transformParams', params, context)

      // 4. 执行具体的 API 调用
      const result = await executor(resolvedModel, transformedParams)

      // 5. 转换结果
      const transformedResult = await this.pluginManager.executeSequential('transformResult', result, context)

      // 6. 触发完成事件
      await this.pluginManager.executeParallel('onRequestEnd', context, transformedResult)

      return transformedResult
    } catch (error) {
      // 7. 触发错误事件
      await this.pluginManager.executeParallel('onError', context, undefined, error as Error)
      throw error
    }
  }

  /**
   * 执行流式调用的通用逻辑（支持流转换器）
   * 提供给AiExecutor使用
   */
  async executeStreamWithPlugins<
    TParams extends Parameters<typeof streamText | typeof streamObject>[0],
    TResult extends ReturnType<typeof streamText | typeof streamObject>
  >(
    methodName: string,
    params: TParams,
    executor: (model: LanguageModel, transformedParams: TParams, streamTransforms: any[]) => TResult,
    _context?: ReturnType<typeof createContext>
  ): Promise<TResult> {
    // 统一处理模型解析
    let resolvedModel: LanguageModel | undefined
    let modelId: string
    const { model } = params
    if (typeof model === 'string') {
      // 字符串：需要通过插件解析
      modelId = model
    } else {
      // 模型对象：直接使用
      resolvedModel = model
      modelId = model.modelId
    }

    // 创建请求上下文
    const context = _context ? _context : createContext(this.providerId, model, params)

    // 🔥 为上下文添加递归调用能力
    context.recursiveCall = async (newParams: any): Promise<TResult> => {
      // 递归调用自身，重新走完整的插件流程
      context.isRecursiveCall = true
      const result = await this.executeStreamWithPlugins(methodName, newParams, executor, context)
      context.isRecursiveCall = false
      return result
    }

    try {
      // 0. 配置上下文
      await this.pluginManager.executeConfigureContext(context)

      // 1. 触发请求开始事件
      await this.pluginManager.executeParallel('onRequestStart', context)

      // 2. 解析模型（如果是字符串）
      if (typeof model === 'string') {
        const resolved = await this.pluginManager.executeFirst<LanguageModel>('resolveModel', modelId, context)
        if (!resolved) {
          throw new Error(`Failed to resolve model: ${modelId}`)
        }
        resolvedModel = resolved
      }

      if (!resolvedModel) {
        throw new Error(`Model resolution failed: no model available`)
      }

      // 3. 转换请求参数
      const transformedParams = await this.pluginManager.executeSequential('transformParams', params, context)

      // 4. 收集流转换器
      const streamTransforms = this.pluginManager.collectStreamTransforms(transformedParams, context)

      // 5. 执行流式 API 调用
      const result = await executor(resolvedModel, transformedParams, streamTransforms)

      const transformedResult = await this.pluginManager.executeSequential('transformResult', result, context)

      // 6. 触发完成事件（注意：对于流式调用，这里触发的是开始流式响应的事件）
      await this.pluginManager.executeParallel('onRequestEnd', context, transformedResult)

      return transformedResult
    } catch (error) {
      // 7. 触发错误事件
      await this.pluginManager.executeParallel('onError', context, undefined, error as Error)
      throw error
    }
  }
}
