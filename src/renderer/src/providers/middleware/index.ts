import { CompletionsParams } from '../AiProvider'
import BaseProvider from '../AiProvider/BaseProvider'
import { applyCompletionsMiddlewares } from './composer'
import { applyMiddlewaresToMethod } from './composer'
import { AiProviderMiddlewareConfig, CompletionsMiddleware, ProviderMethodMiddleware } from './middlewareTypes'

/**
 * Wraps a provider instance with middlewares defined in the AiProviderMiddlewareConfig. /
 * 使用在 AiProviderMiddlewareConfig 中定义的中间件包装一个提供者实例。
 * Middlewares are applied using the composer functions. /
 * 中间件通过 composer 函数应用。
 * @param providerInstance The provider instance to wrap. / 需要包装的提供者实例。
 * @param middlewareConfig The configuration object specifying which middlewares to apply to which methods. / 指定哪些中间件应用于哪些方法的配置对象。
 * @returns A new provider instance wrapped with the specified middlewares. / 一个用指定中间件包装的新提供者实例。
 */
export function wrapProviderWithMiddleware(
  providerInstance: BaseProvider,
  middlewareConfig: AiProviderMiddlewareConfig
): BaseProvider {
  // Cache for already wrapped methods to avoid re-wrapping on every access. /
  // 缓存已包装的方法，以避免每次访问时重新包装。
  const wrappedMethodsCache = new Map<string, (...args: any[]) => Promise<any>>()

  const proxy = new Proxy(providerInstance, {
    get(target, propKey, receiver) {
      const methodName = typeof propKey === 'string' ? propKey : undefined

      if (!methodName) {
        return Reflect.get(target, propKey, receiver)
      }

      if (wrappedMethodsCache.has(methodName)) {
        return wrappedMethodsCache.get(methodName)
      }

      const originalMethod = Reflect.get(target, propKey, receiver)

      // If the property is not a function, return it directly. /
      // 如果属性不是函数，则直接返回。
      if (typeof originalMethod !== 'function') {
        return originalMethod
      }

      let wrappedMethod: ((...args: any[]) => Promise<any>) | undefined

      // Special handling for 'completions' method. /
      // 对 'completions' 方法的特殊处理。
      if (methodName === 'completions' && middlewareConfig.completions?.length) {
        const completionsOriginalMethod = originalMethod as (params: CompletionsParams) => Promise<any>
        wrappedMethod = applyCompletionsMiddlewares(
          target, // The original provider instance / 原始提供者实例
          completionsOriginalMethod,
          middlewareConfig.completions as CompletionsMiddleware[]
        )
      } else {
        // Handle generic methods using the 'methods' config. /
        // 使用 'methods' 配置处理通用方法。
        const genericMethodMiddlewares = middlewareConfig.methods?.[methodName]
        if (genericMethodMiddlewares?.length) {
          const genericOriginalMethod = originalMethod as (...args: any[]) => Promise<any>
          // For generic methods, applyMiddlewaresToMethod will use its default BaseContext. /
          // 对于通用方法，applyMiddlewaresToMethod 将使用其默认的 BaseContext。
          // A specificContextFactory could be passed here if needed for this particular method. /
          // 如果特定方法需要，可以在此处传递 specificContextFactory。
          wrappedMethod = applyMiddlewaresToMethod(
            target, // Pass the original provider instance (target of proxy) / 传递原始提供者实例（代理的目标）
            methodName,
            genericOriginalMethod,
            genericMethodMiddlewares as ProviderMethodMiddleware[]
          )
        }
      }

      if (wrappedMethod) {
        wrappedMethodsCache.set(methodName, wrappedMethod)
        return wrappedMethod
      }

      // If no middlewares are configured for this method, return the original method bound to the target. /
      // 如果没有为此方法配置中间件，则返回绑定到目标的原始方法。
      return originalMethod.bind(target)
    }
  })
  return proxy as BaseProvider
}
