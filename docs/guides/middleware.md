# How to Write Middleware for AI Providers

This document guides developers on how to create and integrate custom middleware for our AI Provider framework. Middleware provides a powerful and flexible way to enhance, modify, or observe Provider method invocations — for example, logging, caching, request/response transformation, and error handling.

## Architecture Overview

Our middleware architecture draws from Redux's three-layer design, combined with JavaScript Proxy to dynamically apply middleware to Provider methods.

- **Proxy**: Intercepts calls to Provider methods and routes them through the middleware chain.
- **Middleware Chain**: A series of middleware functions executed in order. Each middleware can handle the request/response, then pass control to the next middleware in the chain, or terminate the chain early in certain cases.
- **Context**: An object passed between middleware, carrying information about the current invocation (method name, original arguments, Provider instance, and middleware-custom data).

## Middleware Types

Two main types of middleware are currently supported, sharing a similar structure but targeting different scenarios:

1. **`CompletionsMiddleware`**: Designed specifically for the `completions` method. This is the most commonly used middleware type, as it allows fine-grained control over the core chat/text generation functionality of AI models.
2. **`ProviderMethodMiddleware`**: A generic middleware that can be applied to any other method on a Provider (e.g., `translate`, `summarize`, if those methods are also wrapped through the middleware system).

## Writing a `CompletionsMiddleware`

The basic signature (TypeScript type) for `CompletionsMiddleware` is:

```typescript
import { AiProviderMiddlewareCompletionsContext, CompletionsParams, MiddlewareAPI } from './AiProviderMiddlewareTypes'

export type CompletionsMiddleware = (
  api: MiddlewareAPI<AiProviderMiddlewareCompletionsContext, [CompletionsParams]>
) => (
  next: (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => Promise<any>
) => (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => Promise<void>
```

Let's break down this three-layer structure:

1. **First layer `(api) => { ... }`**:

   - Receives an `api` object.
   - `api` provides the following methods:
     - `api.getContext()`: Get the current invocation context (`AiProviderMiddlewareCompletionsContext`).
     - `api.getOriginalArgs()`: Get the original arguments array passed to the `completions` method (i.e., `[CompletionsParams]`).
     - `api.getProviderId()`: Get the current Provider's ID.
     - `api.getProviderInstance()`: Get the original Provider instance.
   - This function is typically used for one-time setup or to obtain required services/configuration. It returns the second-layer function.

2. **Second layer `(next) => { ... }`**:

   - Receives a `next` function.
   - `next` represents the next link in the middleware chain. Calling `next(context, params)` passes control to the next middleware, or if the current middleware is the last in the chain, it invokes the core Provider method logic (e.g., the actual SDK call).
   - `next` receives the current `context` and `params` (which may have been modified by upstream middleware).
   - **Important**: The return type of `next` is typically `Promise<any>`. For the `completions` method, if `next` invokes the actual SDK, it returns the raw SDK response (e.g., an OpenAI stream object or JSON object). You need to handle this response.
   - This function returns the third (and most core) function.

3. **Third layer `(context, params) => { ... }`**:
   - This is where the main middleware logic executes.
   - It receives the current `context` (`AiProviderMiddlewareCompletionsContext`) and `params` (`CompletionsParams`).
   - Here you can:
     - **Before calling `next`**:
       - Read or modify `params`. E.g., add default parameters, transform message format.
       - Read or modify `context`. E.g., set a timestamp for later latency calculation.
       - Perform checks; if conditions aren't met, skip calling `next` and return or throw an error (e.g., parameter validation failure).
     - **Call `await next(context, params)`**:
       - This is the key step to pass control downstream.
       - The return value of `next` is the raw SDK response or downstream middleware result; handle it accordingly (e.g., if it's a stream, start consuming it).
     - **After calling `next`**:
       - Process the result from `next`. E.g., if `next` returned a stream, iterate over it and send data chunks via `context.onChunk`.
       - Perform further operations based on `context` changes or `next` results. E.g., calculate total elapsed time, record logs.

### Example: A Simple Logging Middleware

```typescript
import {
  AiProviderMiddlewareCompletionsContext,
  CompletionsParams,
  MiddlewareAPI,
} from './AiProviderMiddlewareTypes'
import { ChunkType } from '@renderer/types'

export const createSimpleLoggingMiddleware = (): CompletionsMiddleware => {
  return (api: MiddlewareAPI<AiProviderMiddlewareCompletionsContext, [CompletionsParams]>) => {
    return (next: (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => Promise<any>) => {
      return async (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams): Promise<void> => {
        const startTime = Date.now()
        const onChunk = context.onChunk

        logger.debug(
          `[LoggingMiddleware] Request for ${context.methodName} with params:`,
          params.messages?.[params.messages.length - 1]?.content
        )

        try {
          const rawSdkResponse = await next(context, params)

          const duration = Date.now() - startTime
          logger.debug(`[LoggingMiddleware] Request for ${context.methodName} completed in ${duration}ms.`)
        } catch (error) {
          const duration = Date.now() - startTime
          logger.error(`[LoggingMiddleware] Request for ${context.methodName} failed after ${duration}ms:`, error)

          if (onChunk) {
            onChunk({
              type: ChunkType.ERROR,
              error: { message: (error as Error).message, name: (error as Error).name, stack: (error as Error).stack }
            })
            onChunk({ type: ChunkType.BLOCK_COMPLETE, response: {} })
          }
          throw error
        }
      }
    }
  }
}
```

### `AiProviderMiddlewareCompletionsContext` Importance

`AiProviderMiddlewareCompletionsContext` is the core object for passing state and data between middleware. It typically contains:

- `methodName`: The current method name (always `'completions'`).
- `originalArgs`: The original arguments array passed to `completions`.
- `providerId`: The Provider's ID.
- `_providerInstance`: The Provider instance.
- `onChunk`: The callback from the original `CompletionsParams` for streaming data chunks. **All middleware should send data through `context.onChunk`.**
- `messages`, `model`, `assistant`, `mcpTools`: Common fields extracted from `CompletionsParams` for convenient access.
- **Custom fields**: Middleware can add custom fields to the context for downstream middleware. For example, a caching middleware might set `context.cacheHit = true`.

**Key**: When you modify `params` or `context` in middleware, these modifications propagate to downstream middleware (if made before the `next` call).

### Middleware Ordering

The execution order of middleware is critical. They execute in the order defined in the `AiProviderMiddlewareConfig` array.

- Requests flow through the first middleware, then the second, and so on.
- Responses (or `next` call results) "bubble" back in reverse order.

For example, if the chain is `[AuthMiddleware, CacheMiddleware, LoggingMiddleware]`:

1. `AuthMiddleware` executes its "before `next`" logic.
2. Then `CacheMiddleware` executes its "before `next`" logic.
3. Then `LoggingMiddleware` executes its "before `next`" logic.
4. The core SDK call (or end of chain).
5. `LoggingMiddleware` receives the result first, executing its "after `next`" logic.
6. Then `CacheMiddleware` receives the result, executing its "after `next`" logic (e.g., storing the result).
7. Finally `AuthMiddleware` receives the result, executing its "after `next`" logic.

### Registering Middleware

Middleware is registered in `src/renderer/src/providers/middleware/register.ts` (or a similar configuration file).

```typescript
// register.ts
import { AiProviderMiddlewareConfig } from './AiProviderMiddlewareTypes'
import { createSimpleLoggingMiddleware } from './common/SimpleLoggingMiddleware'
import { createCompletionsLoggingMiddleware } from './common/CompletionsLoggingMiddleware'

const middlewareConfig: AiProviderMiddlewareConfig = {
  completions: [
    createSimpleLoggingMiddleware(),
    createCompletionsLoggingMiddleware()
    // ... other completions middleware
  ],
  methods: {
    // translate: [createGenericLoggingMiddleware()],
    // ... middleware for other methods
  }
}

export default middlewareConfig
```

### Best Practices

1. **Single Responsibility**: Each middleware should focus on a specific function (e.g., logging, caching, transforming specific data).
2. **Minimal Side Effects**: Apart from explicit side effects through `context` or `onChunk`, avoid modifying global state or producing hidden side effects.
3. **Error Handling**:
   - Use `try...catch` within middleware to handle potential errors.
   - Decide whether to handle errors internally (e.g., sending error chunks via `onChunk`) or re-throw them upstream.
   - If re-throwing, ensure the error object contains sufficient information.
4. **Performance**: Middleware adds overhead to request processing. Avoid very time-consuming synchronous operations. Ensure IO-intensive operations are asynchronous.
5. **Configurability**: Make middleware behavior adjustable through parameters or configuration. For example, a logging middleware can accept a log level parameter.
6. **Context Management**:
   - Add data to `context` carefully. Avoid polluting the context or adding overly large objects.
   - Clearly define the purpose and lifecycle of fields you add to `context`.
7. **Calling `next`**:
   - Unless you have a good reason to terminate the request early (e.g., cache hit, authorization failure), **always ensure you call `await next(context, params)`**. Otherwise, downstream middleware and core logic will not execute.
   - Understand the return value of `next` and handle it correctly, especially when it's a stream. You are responsible for consuming the stream or passing it to another component/middleware that can consume it.
8. **Clear Naming**: Give your middleware and their factory functions descriptive names.
9. **Documentation and Comments**: Add comments to complex middleware logic explaining how it works and its purpose.

### Debugging Tips

- Use `logger.debug` or a debugger at key points in your middleware to inspect `params`, `context` state, and `next` return values.
- Temporarily simplify the middleware chain, keeping only the middleware you're debugging and the simplest core logic, to isolate issues.
- Write unit tests to independently verify each middleware's behavior.
