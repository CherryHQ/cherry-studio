import { AiPlugin, AiRequestContext } from './types'

/**
 * 插件管理器
 */
export class PluginManager {
  private plugins: AiPlugin[] = []

  constructor(plugins: AiPlugin[] = []) {
    this.plugins = this.sortPlugins(plugins)
  }

  /**
   * 添加插件
   */
  use(plugin: AiPlugin): this {
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
  private sortPlugins(plugins: AiPlugin[]): AiPlugin[] {
    const pre: AiPlugin[] = []
    const normal: AiPlugin[] = []
    const post: AiPlugin[] = []

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
    context: AiRequestContext
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
   * 执行 Sequential 钩子 - 链式数据转换
   */
  async executeSequential<T>(
    hookName: 'transformParams' | 'transformResult',
    initialValue: T,
    context: AiRequestContext
  ): Promise<T> {
    let result = initialValue

    for (const plugin of this.plugins) {
      const hook = plugin[hookName]
      if (hook) {
        result = await hook<T>(result, context)
      }
    }

    return result
  }

  /**
   * 执行 ConfigureContext 钩子 - 串行配置上下文
   */
  async executeConfigureContext(context: AiRequestContext): Promise<void> {
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
    context: AiRequestContext,
    result?: any,
    error?: Error
  ): Promise<void> {
    const promises = this.plugins
      .map((plugin) => {
        const hook = plugin[hookName]
        if (!hook) return null

        if (hookName === 'onError' && error) {
          return (hook as any)(error, context)
        } else if (hookName === 'onRequestEnd' && result !== undefined) {
          return (hook as any)(context, result)
        } else if (hookName === 'onRequestStart') {
          return (hook as any)(context)
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
  collectStreamTransforms(params: any, context: AiRequestContext) {
    return this.plugins
      .filter((plugin) => plugin.transformStream)
      .map((plugin) => plugin.transformStream?.(params, context))
  }

  /**
   * 获取所有插件信息
   */
  getPlugins(): AiPlugin[] {
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
