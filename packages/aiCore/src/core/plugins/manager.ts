import type { AiPlugin, AiRequestContext } from './types'

/**
 * 插件管理器
 */
export class PluginManager<TParams = unknown, TResult = unknown> {
  private plugins: AiPlugin<TParams, TResult>[] = []

  constructor(plugins: AiPlugin<TParams, TResult>[] = []) {
    this.plugins = this.sortPlugins(plugins)
  }

  /**
   * 添加插件
   */
  use(plugin: AiPlugin<TParams, TResult>): this {
    this.plugins = this.sortPlugins([...this.plugins, plugin])
    return this
  }

  /**
   * 移除插件
   */
  remove(pluginName: string): this {
    this.plugins = this.plugins.filter((p) => p.name !== pluginName)
    return this
  }

  /**
   * 插件排序：pre -> normal -> post
   */
  private sortPlugins(plugins: AiPlugin<TParams, TResult>[]): AiPlugin<TParams, TResult>[] {
    const pre: AiPlugin<TParams, TResult>[] = []
    const normal: AiPlugin<TParams, TResult>[] = []
    const post: AiPlugin<TParams, TResult>[] = []

    plugins.forEach((plugin) => {
      if (plugin.enforce === 'pre') {
        pre.push(plugin)
      } else if (plugin.enforce === 'post') {
        post.push(plugin)
      } else {
        normal.push(plugin)
      }
    })

    return [...pre, ...normal, ...post]
  }

  /**
   * 执行 First 钩子 - 返回第一个有效结果
   */
  async executeFirst<T>(
    hookName: 'resolveModel' | 'loadTemplate',
    arg: any,
    context: AiRequestContext<TParams, TResult>
  ): Promise<T | null> {
    for (const plugin of this.plugins) {
      const hook = plugin[hookName]
      if (hook) {
        const result = await hook(arg, context)
        if (result !== null && result !== undefined) {
          return result as T
        }
      }
    }
    return null
  }

  /**
   * 执行 transformParams 钩子 - 链式参数转换
   * 每个插件返回 Partial<TParams>，逐步合并到原始参数
   */
  async executeTransformParams(initialValue: TParams, context: AiRequestContext<TParams, TResult>): Promise<TParams> {
    let result = initialValue

    for (const plugin of this.plugins) {
      if (plugin.transformParams) {
        const partial = await plugin.transformParams(result, context)
        // 合并 Partial 到现有参数
        result = { ...result, ...partial }
      }
    }

    return result
  }

  /**
   * 执行 transformResult 钩子 - 链式结果转换
   * 每个插件接收并返回完整的 TResult
   */
  async executeTransformResult(initialValue: TResult, context: AiRequestContext<TParams, TResult>): Promise<TResult> {
    let result = initialValue

    for (const plugin of this.plugins) {
      if (plugin.transformResult) {
        // SAFETY: transformResult 的契约保证返回 TResult
        // 由于插件接口定义，这个类型断言是安全的
        const transformed = await plugin.transformResult(result, context)
        result = transformed as TResult
      }
    }

    return result
  }

  /**
   * 执行 ConfigureContext 钩子 - 串行配置上下文
   */
  async executeConfigureContext(context: AiRequestContext<TParams, TResult>): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.configureContext
      if (hook) {
        await hook(context)
      }
    }
  }

  /**
   * 执行 Parallel 钩子 - 并行副作用
   */
  async executeParallel(
    hookName: 'onRequestStart' | 'onRequestEnd' | 'onError',
    context: AiRequestContext<TParams, TResult>,
    result?: TResult,
    error?: Error
  ): Promise<void> {
    const promises = this.plugins
      .map((plugin) => {
        const hook = plugin[hookName]
        if (!hook) return null

        if (hookName === 'onError' && error !== undefined) {
          return (hook as NonNullable<typeof plugin.onError>)(error, context)
        } else if (hookName === 'onRequestEnd' && result !== undefined) {
          return (hook as NonNullable<typeof plugin.onRequestEnd>)(context, result)
        } else if (hookName === 'onRequestStart') {
          return (hook as NonNullable<typeof plugin.onRequestStart>)(context)
        }
        return null
      })
      .filter(Boolean)

    // 使用 Promise.all 而不是 allSettled，让插件错误能够抛出
    await Promise.all(promises)
  }

  /**
   * 收集所有流转换器（返回数组，AI SDK 原生支持）
   */
  collectStreamTransforms(params: TParams, context: AiRequestContext<TParams, TResult>) {
    return this.plugins
      .filter((plugin) => plugin.transformStream)
      .map((plugin) => plugin.transformStream?.(params, context))
  }

  /**
   * 获取所有插件信息
   */
  getPlugins(): AiPlugin<TParams, TResult>[] {
    return [...this.plugins]
  }

  /**
   * 获取插件统计信息
   */
  getStats() {
    const stats = {
      total: this.plugins.length,
      pre: 0,
      normal: 0,
      post: 0,
      hooks: {
        resolveModel: 0,
        loadTemplate: 0,
        transformParams: 0,
        transformResult: 0,
        onRequestStart: 0,
        onRequestEnd: 0,
        onError: 0,
        transformStream: 0
      }
    }

    this.plugins.forEach((plugin) => {
      // 统计 enforce 类型
      if (plugin.enforce === 'pre') stats.pre++
      else if (plugin.enforce === 'post') stats.post++
      else stats.normal++

      // 统计钩子数量
      Object.keys(stats.hooks).forEach((hookName) => {
        if (plugin[hookName as keyof AiPlugin]) {
          stats.hooks[hookName as keyof typeof stats.hooks]++
        }
      })
    })

    return stats
  }
}
