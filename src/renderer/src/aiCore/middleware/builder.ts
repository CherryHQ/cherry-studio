import { DefaultCompletionsNamedMiddlewares } from './register'
import { BaseContext, CompletionsMiddleware, MethodMiddleware } from './types'

/**
 * 带有名称标识的中间件接口
 */
export interface NamedMiddleware<TMiddleware = any> {
  name: string
  middleware: TMiddleware
}

/**
 * 中间件执行器函数类型
 */
export type MiddlewareExecutor<TContext extends BaseContext = BaseContext> = (
  chain: any[],
  context: TContext,
  params: any
) => Promise<any>

/**
 * 通用中间件构建器类
 * 提供流式 API 用于动态构建和管理中间件链
 *
 * 注意：所有中间件都通过 MiddlewareRegistry 管理，使用 NamedMiddleware 格式
 */
export class MiddlewareBuilder<TMiddleware = any> {
  private middlewares: NamedMiddleware<TMiddleware>[]

  /**
   * 构造函数
   * @param baseChain - 可选的基础中间件链（NamedMiddleware 格式）
   */
  constructor(baseChain?: NamedMiddleware<TMiddleware>[]) {
    this.middlewares = baseChain ? [...baseChain] : []
  }

  /**
   * 在链的末尾添加中间件
   * @param middleware - 要添加的具名中间件
   * @returns this，支持链式调用
   */
  add(middleware: NamedMiddleware<TMiddleware>): this {
    this.middlewares.push(middleware)
    return this
  }

  /**
   * 在链的开头添加中间件
   * @param middleware - 要添加的具名中间件
   * @returns this，支持链式调用
   */
  prepend(middleware: NamedMiddleware<TMiddleware>): this {
    this.middlewares.unshift(middleware)
    return this
  }

  /**
   * 在指定中间件之后插入新中间件
   * @param targetName - 目标中间件名称
   * @param middlewareToInsert - 要插入的具名中间件
   * @returns this，支持链式调用
   */
  insertAfter(targetName: string, middlewareToInsert: NamedMiddleware<TMiddleware>): this {
    const index = this.findMiddlewareIndex(targetName)
    if (index !== -1) {
      this.middlewares.splice(index + 1, 0, middlewareToInsert)
    } else {
      console.warn(`MiddlewareBuilder: 未找到名为 '${targetName}' 的中间件，无法插入`)
    }
    return this
  }

  /**
   * 在指定中间件之前插入新中间件
   * @param targetName - 目标中间件名称
   * @param middlewareToInsert - 要插入的具名中间件
   * @returns this，支持链式调用
   */
  insertBefore(targetName: string, middlewareToInsert: NamedMiddleware<TMiddleware>): this {
    const index = this.findMiddlewareIndex(targetName)
    if (index !== -1) {
      this.middlewares.splice(index, 0, middlewareToInsert)
    } else {
      console.warn(`MiddlewareBuilder: 未找到名为 '${targetName}' 的中间件，无法插入`)
    }
    return this
  }

  /**
   * 替换指定的中间件
   * @param targetName - 要替换的中间件名称
   * @param newMiddleware - 新的具名中间件
   * @returns this，支持链式调用
   */
  replace(targetName: string, newMiddleware: NamedMiddleware<TMiddleware>): this {
    const index = this.findMiddlewareIndex(targetName)
    if (index !== -1) {
      this.middlewares[index] = newMiddleware
    } else {
      console.warn(`MiddlewareBuilder: 未找到名为 '${targetName}' 的中间件，无法替换`)
    }
    return this
  }

  /**
   * 移除指定的中间件
   * @param targetName - 要移除的中间件名称
   * @returns this，支持链式调用
   */
  remove(targetName: string): this {
    const index = this.findMiddlewareIndex(targetName)
    if (index !== -1) {
      this.middlewares.splice(index, 1)
    }
    return this
  }

  /**
   * 构建最终的中间件数组
   * @returns 构建好的中间件数组
   */
  build(): TMiddleware[] {
    return this.middlewares.map((item) => item.middleware)
  }

  /**
   * 获取当前中间件链的副本（包含名称信息）
   * @returns 当前中间件链的副本
   */
  getChain(): NamedMiddleware<TMiddleware>[] {
    return [...this.middlewares]
  }

  /**
   * 检查是否包含指定名称的中间件
   * @param name - 中间件名称
   * @returns 是否包含该中间件
   */
  has(name: string): boolean {
    return this.findMiddlewareIndex(name) !== -1
  }

  /**
   * 获取中间件链的长度
   * @returns 中间件数量
   */
  get length(): number {
    return this.middlewares.length
  }

  /**
   * 清空中间件链
   * @returns this，支持链式调用
   */
  clear(): this {
    this.middlewares = []
    return this
  }

  /**
   * 直接执行构建好的中间件链
   * @param context - 中间件上下文
   * @param params - 参数
   * @param middlewareExecutor - 中间件执行器
   * @returns 执行结果
   */
  execute<TContext extends BaseContext>(
    context: TContext,
    params: any,
    middlewareExecutor: MiddlewareExecutor<TContext>
  ): Promise<any> {
    const chain = this.build()
    return middlewareExecutor(chain, context, params)
  }

  /**
   * 查找中间件在链中的索引
   * @param name - 中间件名称
   * @returns 索引，如果未找到返回 -1
   */
  private findMiddlewareIndex(name: string): number {
    return this.middlewares.findIndex((item) => item.name === name)
  }
}

/**
 * Completions 中间件构建器
 */
export class CompletionsMiddlewareBuilder extends MiddlewareBuilder<CompletionsMiddleware> {
  constructor(baseChain?: NamedMiddleware<CompletionsMiddleware>[]) {
    super(baseChain)
  }

  /**
   * 使用默认的 Completions 中间件链
   * @returns CompletionsMiddlewareBuilder 实例
   */
  static withDefaults(): CompletionsMiddlewareBuilder {
    return new CompletionsMiddlewareBuilder(DefaultCompletionsNamedMiddlewares)
  }
}

/**
 * 通用方法中间件构建器
 */
export class MethodMiddlewareBuilder extends MiddlewareBuilder<MethodMiddleware> {
  constructor(baseChain?: NamedMiddleware<MethodMiddleware>[]) {
    super(baseChain)
  }
}

// 便捷的工厂函数

/**
 * 创建 Completions 中间件构建器
 * @param baseChain - 可选的基础链
 * @returns Completions 中间件构建器实例
 */
export function createCompletionsBuilder(
  baseChain?: NamedMiddleware<CompletionsMiddleware>[]
): CompletionsMiddlewareBuilder {
  return new CompletionsMiddlewareBuilder(baseChain)
}

/**
 * 创建通用方法中间件构建器
 * @param baseChain - 可选的基础链
 * @returns 通用方法中间件构建器实例
 */
export function createMethodBuilder(baseChain?: NamedMiddleware<MethodMiddleware>[]): MethodMiddlewareBuilder {
  return new MethodMiddlewareBuilder(baseChain)
}

/**
 * 为中间件添加名称属性的辅助函数
 * 可以用于给现有的中间件添加名称属性
 */
export function addMiddlewareName<T extends object>(middleware: T, name: string): T & { MIDDLEWARE_NAME: string } {
  return Object.assign(middleware, { MIDDLEWARE_NAME: name })
}
