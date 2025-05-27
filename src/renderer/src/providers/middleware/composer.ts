import type { CompletionsParams } from '../AiProvider' // For createCompletionsContext typing
import CompletionsResult from '../AiProvider'
import type BaseProvider from '../AiProvider/BaseProvider'
import {
  AiProviderMiddlewareBaseContext,
  AiProviderMiddlewareCompletionsContext,
  CompletionsMiddleware,
  MIDDLEWARE_CONTEXT_SYMBOL,
  MiddlewareAPI,
  ProviderMethodMiddleware
} from './middlewareTypes'

/**
 * Creates the initial context for a method call, populating method-specific fields. /
 * 为方法调用创建初始上下文，并填充特定于该方法的字段。
 * @param methodName - The name of the method being called. / 被调用的方法名。
 * @param originalCallArgs - The actual arguments array from the proxy/method call. / 代理/方法调用的实际参数数组。
 * @param providerId - The ID of the provider, if available. / 提供者的ID（如果可用）。
 * @param providerInstance - The instance of the provider. / 提供者实例。
 * @param specificContextFactory - An optional factory function to create a specific context type from the base context and original call arguments. / 一个可选的工厂函数，用于从基础上下文和原始调用参数创建特定的上下文类型。
 * @returns The created context object. / 创建的上下文对象。
 */
function createInitialCallContext<TContext extends AiProviderMiddlewareBaseContext, TCallArgs extends any[]>(
  methodName: string,
  originalCallArgs: TCallArgs, // Renamed from originalArgs to avoid confusion with context.originalArgs
  providerId: string | undefined,
  providerInstance: BaseProvider,
  // Factory to create specific context from base and the *original call arguments array*
  specificContextFactory?: (base: AiProviderMiddlewareBaseContext, callArgs: TCallArgs) => TContext
): TContext {
  const baseContext: AiProviderMiddlewareBaseContext = {
    [MIDDLEWARE_CONTEXT_SYMBOL]: true,
    methodName,
    originalArgs: originalCallArgs, // Store the full original arguments array in the context
    providerId,
    _providerInstance: providerInstance
  }

  if (specificContextFactory) {
    return specificContextFactory(baseContext, originalCallArgs)
  }
  return baseContext as TContext // Fallback to base context if no specific factory
}

/**
 * Composes an array of functions from right to left. /
 * 从右到左组合一个函数数组。
 * `compose(f, g, h)` is `(...args) => f(g(h(...args)))`. /
 * `compose(f, g, h)` 等同于 `(...args) => f(g(h(...args)))`。
 * Each function in funcs is expected to take the result of the next function
 * (or the initial value for the rightmost function) as its argument. /
 * `funcs` 中的每个函数都期望接收下一个函数的结果（或最右侧函数的初始值）作为其参数。
 * @param funcs - Array of functions to compose. / 要组合的函数数组。
 * @returns The composed function. / 组合后的函数。
 */
function compose(...funcs: Array<(...args: any[]) => any>): (...args: any[]) => any {
  if (funcs.length === 0) {
    // If no functions to compose, return a function that returns its first argument, or undefined if no args. /
    // 如果没有要组合的函数，则返回一个函数，该函数返回其第一个参数，如果没有参数则返回undefined。
    return (...args: any[]) => (args.length > 0 ? args[0] : undefined)
  }
  if (funcs.length === 1) {
    return funcs[0]
  }
  return funcs.reduce(
    (a, b) =>
      (...args: any[]) =>
        a(b(...args))
  )
}

/**
 * Applies an array of Redux-style middlewares to a generic provider method. /
 * 将一组Redux风格的中间件应用于一个通用的提供者方法。
 * This version keeps arguments as an array throughout the middleware chain. /
 * 此版本在整个中间件链中将参数保持为数组形式。
 * @param originalProviderInstance - The original provider instance. / 原始提供者实例。
 * @param methodName - The name of the method to be enhanced. / 需要增强的方法名。
 * @param originalMethod - The original method to be wrapped. / 需要包装的原始方法。
 * @param middlewares - An array of `ProviderMethodMiddleware` to apply. / 要应用的 `ProviderMethodMiddleware` 数组。
 * @param specificContextFactory - An optional factory to create a specific context for this method. / 可选的工厂函数，用于为此方法创建特定的上下文。
 * @returns An enhanced method with the middlewares applied. / 应用了中间件的增强方法。
 */
export function applyMiddlewaresToMethod<
  TArgs extends any[] = any[], // Original method's arguments array type / 原始方法的参数数组类型
  TResult = any,
  TContext extends AiProviderMiddlewareBaseContext = AiProviderMiddlewareBaseContext
>(
  originalProviderInstance: BaseProvider,
  methodName: string,
  originalMethod: (...args: TArgs) => Promise<TResult>,
  middlewares: ProviderMethodMiddleware[], // Expects generic middlewares / 期望通用中间件
  specificContextFactory?: (base: AiProviderMiddlewareBaseContext, callArgs: TArgs) => TContext
): (...args: TArgs) => Promise<TResult> {
  // Returns a function matching the original method signature. /
  // 返回一个与原始方法签名匹配的函数。
  return async function enhancedMethod(...methodCallArgs: TArgs): Promise<TResult> {
    const ctx = createInitialCallContext<TContext, TArgs>(
      methodName,
      methodCallArgs, // Pass the actual call arguments array / 传递实际的调用参数数组
      originalProviderInstance.getProviderInfo?.()?.id,
      originalProviderInstance,
      specificContextFactory
    )

    const api: MiddlewareAPI<TContext, TArgs> = {
      getContext: () => ctx,
      getOriginalArgs: () => methodCallArgs, // API provides the original arguments array / API提供原始参数数组
      getProviderId: () => originalProviderInstance.getProviderInfo?.()?.id,
      getProviderInstance: () => originalProviderInstance
    }

    // `finalDispatch` is the function that will ultimately call the original provider method. /
    // `finalDispatch` 是最终将调用原始提供者方法的函数。
    // It receives the current context and arguments, which may have been transformed by middlewares. /
    // 它接收当前的上下文和参数，这些参数可能已被中间件转换。
    const finalDispatch = async (
      _: TContext,
      currentArgs: TArgs // Generic final dispatch expects args array / 通用finalDispatch期望参数数组
    ): Promise<TResult> => {
      return originalMethod.apply(originalProviderInstance, currentArgs)
    }

    const chain = middlewares.map((middleware) => middleware(api as MiddlewareAPI<any, any>)) // Cast API if TContext/TArgs mismatch general ProviderMethodMiddleware / 如果TContext/TArgs与通用的ProviderMethodMiddleware不匹配，则转换API
    const composedMiddlewareLogic = compose(...chain)
    const enhancedDispatch = composedMiddlewareLogic(finalDispatch)

    return enhancedDispatch(ctx, methodCallArgs) // Pass context and original args array / 传递上下文和原始参数数组
  }
}

/**
 * Applies an array of `CompletionsMiddleware` to the `completions` method. /
 * 将一组 `CompletionsMiddleware` 应用于 `completions` 方法。
 * This version adapts for `CompletionsMiddleware` expecting a single `params` object. /
 * 此版本适配了期望单个 `params` 对象的 `CompletionsMiddleware`。
 * @param originalProviderInstance - The original provider instance. / 原始提供者实例。
 * @param originalCompletionsMethod - The original `completions` method. / 原始的 `completions` 方法。
 * @param middlewares - An array of `CompletionsMiddleware` to apply. / 要应用的 `CompletionsMiddleware` 数组。
 * @returns An enhanced `completions` method with the middlewares applied. / 应用了中间件的增强版 `completions` 方法。
 */
export function applyCompletionsMiddlewares(
  originalProviderInstance: BaseProvider,
  originalCompletionsMethod: (params: CompletionsParams) => Promise<CompletionsResult>,
  middlewares: CompletionsMiddleware[]
): (params: CompletionsParams) => Promise<CompletionsResult> {
  // Returns a function matching the original method signature. /
  // 返回一个与原始方法签名匹配的函数。

  const methodName = 'completions'

  // Factory to create AiProviderMiddlewareCompletionsContext. /
  // 用于创建 AiProviderMiddlewareCompletionsContext 的工厂函数。
  const completionsContextFactory = (
    base: AiProviderMiddlewareBaseContext,
    callArgs: [CompletionsParams] // Expects an array with one CompletionsParams object / 期望一个包含单个CompletionsParams对象的数组
  ): AiProviderMiddlewareCompletionsContext => {
    const params = callArgs[0]
    return {
      ...base,
      methodName: 'completions',
      assistant: params.assistant,
      model: params.assistant.model ?? params.assistant.defaultModel,
      messages: params.messages,
      mcpTools: params.mcpTools,
      onChunk: params.onChunk,
      onFilterMessages: params.onFilterMessages,
      _internal: {}
    }
  }

  return async function enhancedCompletionsMethod(params: CompletionsParams): Promise<CompletionsResult> {
    // `originalCallArgs` for context creation is `[params]`. /
    // 用于上下文创建的 `originalCallArgs` 是 `[params]`。
    const originalCallArgs: [CompletionsParams] = [params]

    const ctx = createInitialCallContext<AiProviderMiddlewareCompletionsContext, [CompletionsParams]>(
      methodName,
      originalCallArgs,
      originalProviderInstance.getProviderInfo?.()?.id,
      originalProviderInstance,
      completionsContextFactory
    )

    const api: MiddlewareAPI<AiProviderMiddlewareCompletionsContext, [CompletionsParams]> = {
      getContext: () => ctx,
      getOriginalArgs: () => originalCallArgs, // API provides [CompletionsParams] / API提供 `[CompletionsParams]`
      getProviderId: () => originalProviderInstance.getProviderInfo?.()?.id,
      getProviderInstance: () => originalProviderInstance
    }

    // `finalDispatch` for CompletionsMiddleware: expects (context, params) not (context, args_array). /
    // `CompletionsMiddleware` 的 `finalDispatch`：期望 (context, params) 而不是 (context, args_array)。
    const finalDispatch = async (
      _context: AiProviderMiddlewareCompletionsContext, // Context passed through / 上下文透传
      currentParams: CompletionsParams // Directly takes params / 直接接收参数
    ): Promise<CompletionsResult> => {
      // Call original method with original `this` and the params object. /
      // 使用原始的 `this` 和参数对象调用原始方法。
      return originalCompletionsMethod.call(originalProviderInstance, currentParams)
    }

    const chain = middlewares.map((middleware) => middleware(api))
    const composedMiddlewareLogic = compose(...chain)

    // `enhancedDispatch` has the signature `(context, params) => Promise<CompletionsResult>`. /
    // `enhancedDispatch` 的签名为 `(context, params) => Promise<CompletionsResult>`。
    const enhancedDispatch = composedMiddlewareLogic(finalDispatch)

    // 将 enhancedDispatch 保存到 context 中，供中间件进行递归调用
    // 这样可以避免重复执行整个中间件链
    ctx._internal = {
      ...ctx._internal,
      enhancedDispatch
    }

    // Execute with context and the single params object. /
    // 使用上下文和单个参数对象执行。
    return enhancedDispatch(ctx, params)
  }
}
