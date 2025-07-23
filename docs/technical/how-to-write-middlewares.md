# 如何为 AI Provider 编写中间件

本文档旨在指导开发者如何为我们的 AI Provider 框架创建和集成自定义中间件。中间件提供了一种强大而灵活的方式来增强、修改或观察 Provider 方法的调用过程，例如日志记录、缓存、请求/响应转换、错误处理等。

## 架构概览

我们的中间件架构借鉴了 Redux 的三段式设计，并结合了 JavaScript Proxy 来动态地将中间件应用于 Provider 的方法。

- **Proxy**: 拦截对 Provider 方法的调用，并将调用引导至中间件链。
- **中间件链**: 一系列按顺序执行的中间件函数。每个中间件都可以处理请求/响应，然后将控制权传递给链中的下一个中间件，或者在某些情况下提前终止链。
- **上下文 (Context)**: 一个在中间件之间传递的对象，携带了关于当前调用的信息（如方法名、原始参数、Provider 实例、以及中间件自定义的数据）。

## 中间件的类型

目前主要支持两种类型的中间件，它们共享相似的结构但针对不同的场景：

1.  **`CompletionsMiddleware`**: 专门为 `completions` 方法设计。这是最常用的中间件类型，因为它允许对 AI 模型的核心聊天/文本生成功能进行精细控制。
2.  **`ProviderMethodMiddleware`**: 通用中间件，可以应用于 Provider 上的任何其他方法（例如，`translate`, `summarize` 等，如果这些方法也通过中间件系统包装）。

## 编写一个 `CompletionsMiddleware`

`CompletionsMiddleware` 的基本签名（TypeScript 类型）如下：

```typescript
import { AiProviderMiddlewareCompletionsContext, CompletionsParams, MiddlewareAPI } from './AiProviderMiddlewareTypes' // 假设类型定义文件路径

export type CompletionsMiddleware = (
  api: MiddlewareAPI<AiProviderMiddlewareCompletionsContext, [CompletionsParams]>
) => (
  next: (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => Promise<any> // next 返回 Promise<any> 代表原始SDK响应或下游中间件的结果
) => (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => Promise<void> // 最内层函数通常返回 Promise<void>，因为结果通过 onChunk 或 context 副作用传递
```

让我们分解这个三段式结构：

1.  **第一层函数 `(api) => { ... }`**:

    - 接收一个 `api` 对象。
    - `api` 对象提供了以下方法：
      - `api.getContext()`: 获取当前调用的上下文对象 (`AiProviderMiddlewareCompletionsContext`)。
      - `api.getOriginalArgs()`: 获取传递给 `completions` 方法的原始参数数组 (即 `[CompletionsParams]`)。
      - `api.getProviderId()`: 获取当前 Provider 的 ID。
      - `api.getProviderInstance()`: 获取原始的 Provider 实例。
    - 此函数通常用于进行一次性的设置或获取所需的服务/配置。它返回第二层函数。

2.  **第二层函数 `(next) => { ... }`**:

    - 接收一个 `next` 函数。
    - `next` 函数代表了中间件链中的下一个环节。调用 `next(context, params)` 会将控制权传递给下一个中间件，或者如果当前中间件是链中的最后一个，则会调用核心的 Provider 方法逻辑 (例如，实际的 SDK 调用)。
    - `next` 函数接收当前的 `context` 和 `params` (这些可能已被上游中间件修改)。
    - **重要的是**：`next` 的返回类型通常是 `Promise<any>`。对于 `completions` 方法，如果 `next` 调用了实际的 SDK，它将返回原始的 SDK 响应（例如，OpenAI 的流对象或 JSON 对象）。你需要处理这个响应。
    - 此函数返回第三层（也是最核心的）函数。

3.  **第三层函数 `(context, params) => { ... }`**:
    - 这是执行中间件主要逻辑的地方。
    - 它接收当前的 `context` (`AiProviderMiddlewareCompletionsContext`) 和 `params` (`CompletionsParams`)。
    - 在此函数中，你可以：
      - **在调用 `next` 之前**:
        - 读取或修改 `params`。例如，添加默认参数、转换消息格式。
        - 读取或修改 `context`。例如，设置一个时间戳用于后续计算延迟。
        - 执行某些检查，如果不满足条件，可以不调用 `next` 而直接返回或抛出错误（例如，参数校验失败）。
      - **调用 `await next(context, params)`**:
        - 这是将控制权传递给下游的关键步骤。
        - `next` 的返回值是原始的 SDK 响应或下游中间件的结果，你需要根据情况处理它（例如，如果是流，则开始消费流）。
      - **在调用 `next` 之后**:
        - 处理 `next` 的返回结果。例如，如果 `next` 返回了一个流，你可以在这里开始迭代处理这个流，并通过 `context.onChunk` 发送数据块。
        - 基于 `context` 的变化或 `next` 的结果执行进一步操作。例如，计算总耗时、记录日志。
        - 修改最终结果（尽管对于 `completions`，结果通常通过 `onChunk` 副作用发出）。

### 示例：一个简单的日志中间件

```typescript
import {
  AiProviderMiddlewareCompletionsContext,
  CompletionsParams,
  MiddlewareAPI,
  OnChunkFunction // 假设 OnChunkFunction 类型被导出
} from './AiProviderMiddlewareTypes' // 调整路径
import { ChunkType } from '@renderer/types' // 调整路径

export const createSimpleLoggingMiddleware = (): CompletionsMiddleware => {
  return (api: MiddlewareAPI<AiProviderMiddlewareCompletionsContext, [CompletionsParams]>) => {
    return (next: (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams) => Promise<any>) => {
      return async (context: AiProviderMiddlewareCompletionsContext, params: CompletionsParams): Promise<void> => {
        const startTime = Date.now()
        // 从 context 中获取 onChunk (它最初来自 params.onChunk)
        const onChunk = context.onChunk

        logger.debug(
          `[LoggingMiddleware] Request for ${context.methodName} with params:`,
          params.messages?.[params.messages.length - 1]?.content
        )

        try {
          // 调用下一个中间件或核心逻辑
          // `rawSdkResponse` 是来自下游的原始响应 (例如 OpenAIStream 或 ChatCompletion 对象)
          const rawSdkResponse = await next(context, params)

          // 此处简单示例不处理 rawSdkResponse，假设下游中间件 (如 StreamingResponseHandler)
          // 会处理它并通过 onChunk 发送数据。
          // 如果这个日志中间件在 StreamingResponseHandler 之后，那么流已经被处理。
          // 如果在之前，那么它需要自己处理 rawSdkResponse 或确保下游会处理。

          const duration = Date.now() - startTime
          logger.debug(`[LoggingMiddleware] Request for ${context.methodName} completed in ${duration}ms.`)

          // 假设下游已经通过 onChunk 发送了所有数据。
          // 如果这个中间件是链的末端，并且需要确保 BLOCK_COMPLETE 被发送，
          // 它可能需要更复杂的逻辑来跟踪何时所有数据都已发送。
        } catch (error) {
          const duration = Date.now() - startTime
          logger.error(`[LoggingMiddleware] Request for ${context.methodName} failed after ${duration}ms:`, error)

          // 如果 onChunk 可用，可以尝试发送一个错误块
          if (onChunk) {
            onChunk({
              type: ChunkType.ERROR,
              error: { message: (error as Error).message, name: (error as Error).name, stack: (error as Error).stack }
            })
            // 考虑是否还需要发送 BLOCK_COMPLETE 来结束流
            onChunk({ type: ChunkType.BLOCK_COMPLETE, response: {} })
          }
          throw error // 重新抛出错误，以便上层或全局错误处理器可以捕获
        }
      }
    }
  }
}
```

### `AiProviderMiddlewareCompletionsContext` 的重要性

`AiProviderMiddlewareCompletionsContext` 是在中间件之间传递状态和数据的核心。它通常包含：

- `methodName`: 当前调用的方法名 (总是 `'completions'`)。
- `originalArgs`: 传递给 `completions` 的原始参数数组。
- `providerId`: Provider 的 ID。
- `_providerInstance`: Provider 实例。
- `onChunk`: 从原始 `CompletionsParams` 传入的回调函数，用于流式发送数据块。**所有中间件都应该通过 `context.onChunk` 来发送数据。**
- `messages`, `model`, `assistant`, `mcpTools`: 从原始 `CompletionsParams` 中提取的常用字段，方便访问。
- **自定义字段**: 中间件可以向上下文中添加自定义字段，以供后续中间件使用。例如，一个缓存中间件可能会添加 `context.cacheHit = true`。

**关键**: 当你在中间件中修改 `params` 或 `context` 时，这些修改会向下游中间件传播（如果它们在 `next` 调用之前修改）。

### 中间件的顺序

中间件的执行顺序非常重要。它们在 `AiProviderMiddlewareConfig` 的数组中定义的顺序就是它们的执行顺序。

- 请求首先通过第一个中间件，然后是第二个，依此类推。
- 响应（或 `next` 的调用结果）则以相反的顺序"冒泡"回来。

例如，如果链是 `[AuthMiddleware, CacheMiddleware, LoggingMiddleware]`：

1.  `AuthMiddleware` 先执行其 "调用 `next` 之前" 的逻辑。
2.  然后 `CacheMiddleware` 执行其 "调用 `next` 之前" 的逻辑。
3.  然后 `LoggingMiddleware` 执行其 "调用 `next` 之前" 的逻辑。
4.  核心SDK调用（或链的末端）。
5.  `LoggingMiddleware` 先接收到结果，执行其 "调用 `next` 之后" 的逻辑。
6.  然后 `CacheMiddleware` 接收到结果（可能已被 LoggingMiddleware 修改的上下文），执行其 "调用 `next` 之后" 的逻辑（例如，存储结果）。
7.  最后 `AuthMiddleware` 接收到结果，执行其 "调用 `next` 之后" 的逻辑。

### 注册中间件

中间件在 `src/renderer/src/providers/middleware/register.ts` (或其他类似的配置文件) 中进行注册。

```typescript
// register.ts
import { AiProviderMiddlewareConfig } from './AiProviderMiddlewareTypes'
import { createSimpleLoggingMiddleware } from './common/SimpleLoggingMiddleware' // 假设你创建了这个文件
import { createCompletionsLoggingMiddleware } from './common/CompletionsLoggingMiddleware' // 已有的

const middlewareConfig: AiProviderMiddlewareConfig = {
  completions: [
    createSimpleLoggingMiddleware(), // 你新加的中间件
    createCompletionsLoggingMiddleware() // 已有的日志中间件
    // ... 其他 completions 中间件
  ],
  methods: {
    // translate: [createGenericLoggingMiddleware()],
    // ... 其他方法的中间件
  }
}

export default middlewareConfig
```

### 最佳实践

1.  **单一职责**: 每个中间件应专注于一个特定的功能（例如，日志、缓存、转换特定数据）。
2.  **无副作用 (尽可能)**: 除了通过 `context` 或 `onChunk` 明确的副作用外，尽量避免修改全局状态或产生其他隐蔽的副作用。
3.  **错误处理**:
    - 在中间件内部使用 `try...catch` 来处理可能发生的错误。
    - 决定是自行处理错误（例如，通过 `onChunk` 发送错误块）还是将错误重新抛出给上游。
    - 如果重新抛出，确保错误对象包含足够的信息。
4.  **性能考虑**: 中间件会增加请求处理的开销。避免在中间件中执行非常耗时的同步操作。对于IO密集型操作，确保它们是异步的。
5.  **可配置性**: 使中间件的行为可通过参数或配置进行调整。例如，日志中间件可以接受一个日志级别参数。
6.  **上下文管理**:
    - 谨慎地向 `context` 添加数据。避免污染 `context` 或添加过大的对象。
    - 明确你添加到 `context` 的字段的用途和生命周期。
7.  **`next` 的调用**:
    - 除非你有充分的理由提前终止请求（例如，缓存命中、授权失败），否则**总是确保调用 `await next(context, params)`**。否则，下游的中间件和核心逻辑将不会执行。
    - 理解 `next` 的返回值并正确处理它，特别是当它是一个流时。你需要负责消费这个流或将其传递给另一个能够消费它的组件/中间件。
8.  **命名清晰**: 给你的中间件和它们创建的函数起描述性的名字。
9.  **文档和注释**: 对复杂的中间件逻辑添加注释，解释其工作原理和目的。

### 调试技巧

- 在中间件的关键点使用 `logger.debug` 或调试器来检查 `params`、`context` 的状态以及 `next` 的返回值。
- 暂时简化中间件链，只保留你正在调试的中间件和最简单的核心逻辑，以隔离问题。
- 编写单元测试来独立验证每个中间件的行为。

通过遵循这些指南，你应该能够有效地为我们的系统创建强大且可维护的中间件。如果你有任何疑问或需要进一步的帮助，请咨询团队。
