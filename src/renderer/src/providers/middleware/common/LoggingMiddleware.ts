import { BaseContext, MethodMiddleware } from '../type'

/**
 * Helper function to safely stringify arguments for logging, handling circular references and large objects.
 * 安全地字符串化日志参数的辅助函数，处理循环引用和大型对象。
 * @param args - The arguments array to stringify. 要字符串化的参数数组。
 * @returns A string representation of the arguments. 参数的字符串表示形式。
 */
const stringifyArgsForLogging = (args: any[]): string => {
  try {
    return args
      .map((arg) => {
        if (typeof arg === 'function') return '[Function]'
        if (typeof arg === 'object' && arg !== null && arg.constructor === Object && Object.keys(arg).length > 20) {
          return '[Object with >20 keys]'
        }
        // Truncate long strings to avoid flooding logs 截断长字符串以避免日志泛滥
        const stringifiedArg = JSON.stringify(arg, null, 2)
        return stringifiedArg && stringifiedArg.length > 200 ? stringifiedArg.substring(0, 200) + '...' : stringifiedArg
      })
      .join(', ')
  } catch (e) {
    return '[Error serializing arguments]' // Handle potential errors during stringification 处理字符串化期间的潜在错误
  }
}

/**
 * Generic logging middleware for provider methods.
 * 为提供者方法创建一个通用的日志中间件。
 * This middleware logs the initiation, success/failure, and duration of a method call.
 * 此中间件记录方法调用的启动、成功/失败以及持续时间。
 */
export const GenericLoggingMiddleware: MethodMiddleware = async (ctx: BaseContext, next) => {
  const middlewareName = 'GenericLoggingMiddleware'
  const methodName = ctx.methodName
  const apiClientId = ctx.apiClientInstance.provider?.id || 'unknown-provider'
  const logPrefix = `[${middlewareName} (${apiClientId}-${methodName})]`

  console.log(`${logPrefix} ===== MIDDLEWARE STARTED =====`)

  // Log initiation of the method call with relevant context info
  const contextInfo = [
    ctx.originalParams.messages?.length ? `${ctx.originalParams.messages.length} messages` : 'no messages',
    ctx.originalParams.mcpTools?.length ? `${ctx.originalParams.mcpTools.length} tools` : 'no tools',
    ctx.originalParams.streamOutput ? 'streaming' : 'non-streaming'
  ]
  console.log(`${logPrefix} Initiating method call. Context:`, stringifyArgsForLogging(contextInfo))

  const startTime = Date.now()
  try {
    console.log(`${logPrefix} Calling next middleware in chain...`)
    await next()
    const duration = Date.now() - startTime
    console.log(`${logPrefix} Successful. Duration: ${duration}ms`)
    console.log(`${logPrefix} ===== MIDDLEWARE COMPLETED =====`)
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`${logPrefix} Failed. Duration: ${duration}ms`, error)
    console.error(`${logPrefix} ===== MIDDLEWARE FAILED =====`)
    throw error // Re-throw the error to be handled by subsequent layers or the caller
  }
}

/**
 * Creates a generic logging middleware for provider methods.
 * 为提供者方法创建一个通用的日志中间件。
 * @returns A `MethodMiddleware` instance. 一个 `MethodMiddleware` 实例。
 */
export const createGenericLoggingMiddleware = (): MethodMiddleware => {
  return GenericLoggingMiddleware
}
