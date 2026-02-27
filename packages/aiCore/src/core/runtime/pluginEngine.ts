/* eslint-disable @eslint-react/naming-convention/context-name */
import type { ImageModelV3, LanguageModelV3 } from '@ai-sdk/provider'
import type { generateImage, LanguageModel } from 'ai'
import { wrapLanguageModel } from 'ai'

import { ModelResolutionError, RecursiveDepthError } from '../errors'
import {
  type AiPlugin,
  type AiRequestContext,
  createContext,
  type GenerateTextParams,
  type GenerateTextResult,
  PluginManager,
  type StreamTextParams,
  type StreamTextResult
} from '../plugins'
import { type ProviderId } from '../providers/types'

/**
 * 插件增强的 AI 客户端
 * 专注于插件处理，不暴露用户API
 */
export class PluginEngine<T extends ProviderId = ProviderId> {
  /**
   * Plugin storage with explicit any/any generics
   *
   * SAFETY: Plugins are contravariant in TParams and covariant in TResult.
   * The cast to AiPlugin<TParams, TResult>[] in PluginManager is safe due to variance rules:
   * - A plugin accepting any params (TParams = any) can handle specific params
   * - A plugin returning any result (TResult = any) can be used as any specific result type
   *
   * Using AiPlugin<any, any> instead of AiPlugin preserves generic type information
   * and makes the variance relationship explicit for type checking.
   */
  private basePlugins: AiPlugin<any, any>[] = []

  constructor(
    private readonly providerId: T,
    // private readonly options: ProviderSettingsMap[T],
    plugins: AiPlugin[] = []
  ) {
    this.basePlugins = plugins
  }

  /**
   * 添加插件
   */
  use(plugin: AiPlugin): this {
    this.basePlugins.push(plugin)
    return this
  }

  /**
   * 批量添加插件
   */
  usePlugins(plugins: AiPlugin[]): this {
    this.basePlugins.push(...plugins)
    return this
  }

  /**
   * 移除插件
   */
  removePlugin(pluginName: string): this {
    this.basePlugins = this.basePlugins.filter((p) => p.name !== pluginName)
    return this
  }

  /**
   * 获取插件统计
   */
  getPluginStats() {
    // 创建临时 manager 来获取统计信息
    const tempManager = new PluginManager(this.basePlugins)
    return tempManager.getStats()
  }

  /**
   * 获取所有插件
   */
  getPlugins() {
    return [...this.basePlugins]
  }

  /**
   * 执行带插件的操作（非流式）
   * 提供给AiExecutor使用
   */
  async executeWithPlugins<TParams extends GenerateTextParams, TResult extends GenerateTextResult>(
    methodName: string,
    params: TParams,
    executor: (model: LanguageModel, transformedParams: TParams) => TResult,
    _context?: AiRequestContext<TParams, TResult>
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

    // 创建类型安全的 context
    const context = _context ?? createContext(this.providerId, model, params)

    // ✅ 创建类型化的 manager（逆变安全）
    const manager = new PluginManager<TParams, TResult>(this.basePlugins as AiPlugin<TParams, TResult>[])

    // ✅ 递归调用泛型化，增加深度限制
    context.recursiveCall = async <R = TResult>(newParams: Partial<TParams>): Promise<R> => {
      if (context.recursiveDepth >= context.maxRecursiveDepth) {
        throw new RecursiveDepthError(context.requestId, context.recursiveDepth, context.maxRecursiveDepth)
      }

      const previousDepth = context.recursiveDepth
      const wasRecursive = context.isRecursiveCall

      try {
        context.recursiveDepth = previousDepth + 1
        context.isRecursiveCall = true

        return (await this.executeWithPlugins(
          methodName,
          { ...params, ...newParams } as TParams,
          executor,
          context
        )) as unknown as R
      } finally {
        // ✅ finally 确保状态恢复
        context.recursiveDepth = previousDepth
        context.isRecursiveCall = wasRecursive
      }
    }

    try {
      // 0. 配置上下文
      await manager.executeConfigureContext(context)

      // 1. 触发请求开始事件
      await manager.executeParallel('onRequestStart', context)

      // 2. 解析模型（如果是字符串）
      if (typeof model === 'string') {
        const resolved = await manager.executeFirst<LanguageModel>('resolveModel', modelId, context)
        if (!resolved) {
          throw new ModelResolutionError(modelId, this.providerId)
        }
        resolvedModel = resolved
      }

      if (!resolvedModel) {
        throw new ModelResolutionError(modelId, this.providerId)
      }

      // 2.5 统一应用 context.middlewares（由各插件在 configureContext 阶段写入）
      if (context.middlewares && context.middlewares.length > 0) {
        resolvedModel = wrapLanguageModel({
          model: resolvedModel as LanguageModelV3,
          middleware: context.middlewares
        })
      }

      // 3. 转换请求参数
      const transformedParams = await manager.executeTransformParams(params, context)

      // 4. 执行具体的 API 调用
      const result = await executor(resolvedModel, transformedParams)

      // 5. 转换结果（对于非流式调用）
      const transformedResult = await manager.executeTransformResult(result, context)

      // 6. 触发完成事件
      await manager.executeParallel('onRequestEnd', context, transformedResult)

      return transformedResult
    } catch (error) {
      // 7. 触发错误事件
      await manager.executeParallel('onError', context, undefined, error as Error)
      throw error
    }
  }

  /**
   * 执行带插件的图像生成操作
   * 提供给AiExecutor使用
   */
  async executeImageWithPlugins<
    TParams extends Omit<Parameters<typeof generateImage>[0], 'model'> & { model: string | ImageModelV3 },
    TResult extends ReturnType<typeof generateImage>
  >(
    methodName: string,
    params: TParams,
    executor: (model: ImageModelV3, transformedParams: TParams) => TResult,
    _context?: AiRequestContext<TParams, TResult>
  ): Promise<TResult> {
    // 统一处理模型解析
    let resolvedModel: ImageModelV3 | undefined
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

    // 创建类型安全的 context
    const context = _context ?? createContext(this.providerId, model, params)

    // ✅ 创建类型化的 manager（逆变安全）
    const manager = new PluginManager<TParams, TResult>(this.basePlugins as AiPlugin<TParams, TResult>[])

    // ✅ 递归调用泛型化，增加深度限制
    context.recursiveCall = async <R = TResult>(newParams: Partial<TParams>): Promise<R> => {
      if (context.recursiveDepth >= context.maxRecursiveDepth) {
        throw new RecursiveDepthError(context.requestId, context.recursiveDepth, context.maxRecursiveDepth)
      }

      const previousDepth = context.recursiveDepth
      const wasRecursive = context.isRecursiveCall

      try {
        context.recursiveDepth = previousDepth + 1
        context.isRecursiveCall = true

        return (await this.executeImageWithPlugins(
          methodName,
          { ...params, ...newParams } as TParams,
          executor,
          context
        )) as unknown as R
      } finally {
        // ✅ finally 确保状态恢复
        context.recursiveDepth = previousDepth
        context.isRecursiveCall = wasRecursive
      }
    }

    try {
      // 0. 配置上下文
      await manager.executeConfigureContext(context)

      // 1. 触发请求开始事件
      await manager.executeParallel('onRequestStart', context)

      // 2. 解析模型（如果是字符串）
      if (typeof model === 'string') {
        const resolved = await manager.executeFirst<ImageModelV3>('resolveModel', modelId, context)
        if (!resolved) {
          throw new ModelResolutionError(modelId, this.providerId)
        }
        resolvedModel = resolved
      }

      if (!resolvedModel) {
        throw new ModelResolutionError(modelId, this.providerId)
      }

      // 3. 转换请求参数
      const transformedParams = await manager.executeTransformParams(params, context)

      // 4. 执行具体的 API 调用
      const result = await executor(resolvedModel, transformedParams)

      // 5. 转换结果
      const transformedResult = await manager.executeTransformResult(result, context)

      // 6. 触发完成事件
      await manager.executeParallel('onRequestEnd', context, transformedResult)

      return transformedResult
    } catch (error) {
      // 7. 触发错误事件
      await manager.executeParallel('onError', context, undefined, error as Error)
      throw error
    }
  }

  /**
   * 执行流式调用的通用逻辑（支持流转换器）
   * 提供给AiExecutor使用
   */
  async executeStreamWithPlugins<TParams extends StreamTextParams, TResult extends StreamTextResult>(
    methodName: string,
    params: TParams,
    executor: (model: LanguageModel, transformedParams: TParams, streamTransforms: any[]) => TResult,
    _context?: AiRequestContext<TParams, TResult>
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

    // 创建类型安全的 context
    const context = _context ?? createContext(this.providerId, model, params)

    // ✅ 创建类型化的 manager（逆变安全）
    const manager = new PluginManager<TParams, TResult>(this.basePlugins as AiPlugin<TParams, TResult>[])

    // ✅ 递归调用泛型化，增加深度限制
    context.recursiveCall = async <R = TResult>(newParams: Partial<TParams>): Promise<R> => {
      if (context.recursiveDepth >= context.maxRecursiveDepth) {
        throw new RecursiveDepthError(context.requestId, context.recursiveDepth, context.maxRecursiveDepth)
      }

      const previousDepth = context.recursiveDepth
      const wasRecursive = context.isRecursiveCall

      try {
        context.recursiveDepth = previousDepth + 1
        context.isRecursiveCall = true

        return (await this.executeStreamWithPlugins(
          methodName,
          { ...params, ...newParams } as TParams,
          executor,
          context
        )) as unknown as R
      } finally {
        // ✅ finally 确保状态恢复
        context.recursiveDepth = previousDepth
        context.isRecursiveCall = wasRecursive
      }
    }

    try {
      // 0. 配置上下文
      await manager.executeConfigureContext(context)

      // 1. 触发请求开始事件
      await manager.executeParallel('onRequestStart', context)

      // 2. 解析模型（如果是字符串）
      if (typeof model === 'string') {
        const resolved = await manager.executeFirst<LanguageModel>('resolveModel', modelId, context)
        if (!resolved) {
          throw new ModelResolutionError(modelId, this.providerId)
        }
        resolvedModel = resolved
      }

      if (!resolvedModel) {
        throw new ModelResolutionError(modelId, this.providerId)
      }

      // 2.5 应用 context.middlewares 到模型
      if (typeof model !== 'string' && context.middlewares && context.middlewares.length > 0) {
        resolvedModel = wrapLanguageModel({
          model: resolvedModel as LanguageModelV3,
          middleware: context.middlewares
        })
      }

      // 3. 转换请求参数
      const transformedParams = await manager.executeTransformParams(params, context)

      // 4. 收集流转换器
      const streamTransforms = manager.collectStreamTransforms(transformedParams, context)

      // 5. 执行流式 API 调用
      const result = await executor(resolvedModel, transformedParams, streamTransforms)

      const transformedResult = await manager.executeTransformResult(result, context)

      // 6. 触发完成事件（注意：对于流式调用，这里触发的是开始流式响应的事件）
      await manager.executeParallel('onRequestEnd', context, transformedResult)

      return transformedResult
    } catch (error) {
      // 7. 触发错误事件
      await manager.executeParallel('onError', context, undefined, error as Error)
      throw error
    }
  }
}
