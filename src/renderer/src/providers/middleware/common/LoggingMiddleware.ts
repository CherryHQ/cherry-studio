import { AiProviderMiddlewareBaseContext, MiddlewareAPI, ProviderMethodMiddleware } from '../middlewareTypes'

/**
 * Helper function to safely stringify arguments for logging, handling circular references and large objects. /
 * 安全地字符串化日志参数的辅助函数，处理循环引用和大型对象。
 * @param args - The arguments array to stringify. / 要字符串化的参数数组。
 * @returns A string representation of the arguments. / 参数的字符串表示形式。
 */
const stringifyArgsForLogging = (args: any[]): string => {
  try {
    return args
      .map((arg) => {
        if (typeof arg === 'function') return '[Function]'
        if (typeof arg === 'object' && arg !== null && arg.constructor === Object && Object.keys(arg).length > 20) {
          return '[Object with >20 keys]'
        }
        // Truncate long strings to avoid flooding logs / 截断长字符串以避免日志泛滥
        const stringifiedArg = JSON.stringify(arg, null, 2)
        return stringifiedArg && stringifiedArg.length > 200 ? stringifiedArg.substring(0, 200) + '...' : stringifiedArg
      })
      .join(', ')
  } catch (e) {
    return '[Error serializing arguments]' // Handle potential errors during stringification / 处理字符串化期间的潜在错误
  }
}

/**
 * Creates a generic logging middleware for provider methods. /
 * 为提供者方法创建一个通用的日志中间件。
 * This middleware logs the initiation, success/failure, and duration of a method call. /
 * 此中间件记录方法调用的启动、成功/失败以及持续时间。
 * It uses a helper to stringify arguments for logging, preventing issues with complex objects. /
 * 它使用一个辅助函数来字符串化日志参数，以防止复杂对象带来的问题。
 * @returns A `ProviderMethodMiddleware` instance. / 一个 `ProviderMethodMiddleware` 实例。
 */
export const createGenericLoggingMiddleware: () => ProviderMethodMiddleware = () => {
  const middlewareName = 'GenericLoggingMiddleware'

  return (api: MiddlewareAPI<AiProviderMiddlewareBaseContext, any[]>) => {
    const providerId = api.getProviderId() || 'unknown-provider'

    return (next) => {
      return async (context, args) => {
        const methodName = context.methodName
        const logPrefix = `[${middlewareName} (${providerId}-${methodName})]`

        // Log initiation of the method call with stringified arguments. /
        // 使用字符串化的参数记录方法调用的启动。
        console.log(`${logPrefix} Initiating. Args:`, stringifyArgsForLogging(args))

        const startTime = Date.now()
        try {
          const result = await next(context, args)
          const duration = Date.now() - startTime
          // Log successful completion of the method call with duration. /
          // 记录方法调用成功完成及其持续时间。
          console.log(`${logPrefix} Successful. Duration: ${duration}ms`)
          return result
        } catch (error) {
          const duration = Date.now() - startTime
          // Log failure of the method call with duration and error information. /
          // 记录方法调用失败及其持续时间和错误信息。
          console.error(`${logPrefix} Failed. Duration: ${duration}ms`, error)
          throw error // Re-throw the error to be handled by subsequent layers or the caller / 重新抛出错误，由后续层或调用者处理
        }
      }
    }
  }
}
