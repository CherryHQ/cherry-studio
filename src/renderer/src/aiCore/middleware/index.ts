import { CompletionsMiddleware, MethodMiddleware } from './types'

// /**
//  * Wraps a provider instance with middlewares.
//  */
// export function wrapProviderWithMiddleware(
//   apiClientInstance: BaseApiClient,
//   middlewareConfig: MiddlewareConfig
// ): BaseApiClient {
//   console.log(`[wrapProviderWithMiddleware] Wrapping provider: ${apiClientInstance.provider?.id}`)
//   console.log(`[wrapProviderWithMiddleware] Middleware config:`, {
//     completions: middlewareConfig.completions?.length || 0,
//     methods: Object.keys(middlewareConfig.methods || {}).length
//   })

//   // Cache for already wrapped methods to avoid re-wrapping on every access.
//   const wrappedMethodsCache = new Map<string, (...args: any[]) => Promise<any>>()

//   const proxy = new Proxy(apiClientInstance, {
//     get(target, propKey, receiver) {
//       const methodName = typeof propKey === 'string' ? propKey : undefined

//       if (!methodName) {
//         return Reflect.get(target, propKey, receiver)
//       }

//       if (wrappedMethodsCache.has(methodName)) {
//         console.log(`[wrapProviderWithMiddleware] Using cached wrapped method: ${methodName}`)
//         return wrappedMethodsCache.get(methodName)
//       }

//       const originalMethod = Reflect.get(target, propKey, receiver)

//       // If the property is not a function, return it directly.
//       if (typeof originalMethod !== 'function') {
//         return originalMethod
//       }

//       let wrappedMethod: ((...args: any[]) => Promise<any>) | undefined

//       // Handle completions method
//       if (methodName === 'completions' && middlewareConfig.completions?.length) {
//         console.log(
//           `[wrapProviderWithMiddleware] Wrapping completions method with ${middlewareConfig.completions.length} middlewares`
//         )
//         const completionsOriginalMethod = originalMethod as (params: CompletionsParams) => Promise<any>
//         wrappedMethod = applyCompletionsMiddlewares(target, completionsOriginalMethod, middlewareConfig.completions)
//       }
//       // Handle other methods
//       else {
//         const methodMiddlewares = middlewareConfig.methods?.[methodName]
//         if (methodMiddlewares?.length) {
//           console.log(
//             `[wrapProviderWithMiddleware] Wrapping method ${methodName} with ${methodMiddlewares.length} middlewares`
//           )
//           const genericOriginalMethod = originalMethod as (...args: any[]) => Promise<any>
//           wrappedMethod = applyMethodMiddlewares(target, methodName, genericOriginalMethod, methodMiddlewares)
//         }
//       }

//       if (wrappedMethod) {
//         console.log(`[wrapProviderWithMiddleware] Successfully wrapped method: ${methodName}`)
//         wrappedMethodsCache.set(methodName, wrappedMethod)
//         return wrappedMethod
//       }

//       // If no middlewares are configured for this method, return the original method bound to the target. /
//       // 如果没有为此方法配置中间件，则返回绑定到目标的原始方法。
//       console.log(`[wrapProviderWithMiddleware] No middlewares for method ${methodName}, returning original`)
//       return originalMethod.bind(target)
//     }
//   })
//   return proxy as BaseApiClient
// }

// Export types for external use
export type { CompletionsMiddleware, MethodMiddleware }

// Export MiddlewareBuilder related types and classes
export {
  CompletionsMiddlewareBuilder,
  createCompletionsBuilder,
  createMethodBuilder,
  MethodMiddlewareBuilder,
  MiddlewareBuilder,
  type MiddlewareExecutor,
  type NamedMiddleware
} from './builder'
