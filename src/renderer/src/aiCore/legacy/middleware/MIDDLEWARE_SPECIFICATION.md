# Cherry Studio 中间件规范

本文档定义了 Cherry Studio `aiCore` 模块中中间件的设计、实现和使用规范。目标是建立一个灵活、可维护且易于扩展的中间件系统。

## 1. 核心概念

### 1.1. 中间件 (Middleware)

中间件是一个函数或对象，它在 AI 请求的处理流程中的特定阶段执行，可以访问和修改请求上下文 (`AiProviderMiddlewareContext`)、请求参数 (`Params`)，并控制是否将请求传递给下一个中间件或终止流程。

每个中间件应该专注于一个单一的横切关注点，例如日志记录、错误处理、流适配、特性解析等。

### 1.2. `AiProviderMiddlewareContext` (上下文对象)

这是一个在整个中间件链执行过程中传递的对象，包含以下核心信息：

- `_apiClientInstance: ApiClient<any,any,any>`: 当前选定的、已实例化的 AI Provider 客户端。
- `_coreRequest: CoreRequestType`: 标准化的内部核心请求对象。
- `resolvePromise: (value: AggregatedResultType) => void`: 用于在整个操作成功完成时解析 `AiCoreService` 返回的 Promise。
- `rejectPromise: (reason?: any) => void`: 用于在发生错误时拒绝 `AiCoreService` 返回的 Promise。
- `onChunk?: (chunk: Chunk) => void`: 应用层提供的流式数据块回调。
- `abortController?: AbortController`: 用于中止请求的控制器。
- 其他中间件可能读写的、与当前请求相关的动态数据。

### 1.3. `MiddlewareName` (中间件名称)

为了方便动态操作（如插入、替换、移除）中间件，每个重要的、可能被其他逻辑引用的中间件都应该有一个唯一的、可识别的名称。推荐使用 TypeScript 的 `enum` 来定义：

```typescript
// example
export enum MiddlewareName {
  LOGGING_START = 'LoggingStartMiddleware',
  LOGGING_END = 'LoggingEndMiddleware',
  ERROR_HANDLING = 'ErrorHandlingMiddleware',
  ABORT_HANDLER = 'AbortHandlerMiddleware',
  // Core Flow
  TRANSFORM_CORE_TO_SDK_PARAMS = 'TransformCoreToSdkParamsMiddleware',
  REQUEST_EXECUTION = 'RequestExecutionMiddleware',
  STREAM_ADAPTER = 'StreamAdapterMiddleware',
  RAW_SDK_CHUNK_TO_APP_CHUNK = 'RawSdkChunkToAppChunkMiddleware',
  // Features
  THINKING_TAG_EXTRACTION = 'ThinkingTagExtractionMiddleware',
  TOOL_USE_TAG_EXTRACTION = 'ToolUseTagExtractionMiddleware',
  MCP_TOOL_HANDLER = 'McpToolHandlerMiddleware',
  // Finalization
  FINAL_CHUNK_CONSUMER = 'FinalChunkConsumerAndNotifierMiddleware'
  // Add more as needed
}
```

中间件实例需要某种方式暴露其 `MiddlewareName`，例如通过一个 `name` 属性。

### 1.4. 中间件执行结构

我们采用一种灵活的中间件执行结构。一个中间件通常是一个函数，它接收 `Context`、`Params`，以及一个 `next` 函数（用于调用链中的下一个中间件）。

```typescript
// 简化形式的中间件函数签名
type MiddlewareFunction = (
  context: AiProviderMiddlewareContext,
  params: any, // e.g., CompletionsParams
  next: () => Promise<void> // next 通常返回 Promise 以支持异步操作
) => Promise<void> // 中间件自身也可能返回 Promise

// 或者更经典的 Koa/Express 风格 (三段式)
// type MiddlewareFactory = (api?: MiddlewareApi) =>
//                          (nextMiddleware: (ctx: AiProviderMiddlewareContext, params: any) => Promise<void>) =>
//                              (context: AiProviderMiddlewareContext, params: any) => Promise<void>;
// 当前设计更倾向于上述简化的 MiddlewareFunction，由 MiddlewareExecutor 负责 next 的编排。
```

`MiddlewareExecutor` (或 `applyMiddlewares`) 会负责管理 `next` 的调用。

## 2. `MiddlewareBuilder` (通用中间件构建器)

为了动态构建和管理中间件链，我们引入一个通用的 `MiddlewareBuilder` 类。

### 2.1. 设计理念

`MiddlewareBuilder` 提供了一个流式 API，用于以声明式的方式构建中间件链。它允许从一个基础链开始，然后根据特定条件添加、插入、替换或移除中间件。

### 2.2. API 概览

```typescript
class MiddlewareBuilder {
  constructor(baseChain?: Middleware[])

  add(middleware: Middleware): this
  prepend(middleware: Middleware): this
  insertAfter(targetName: MiddlewareName, middlewareToInsert: Middleware): this
  insertBefore(targetName: MiddlewareName, middlewareToInsert: Middleware): this
  replace(targetName: MiddlewareName, newMiddleware: Middleware): this
  remove(targetName: MiddlewareName): this

  build(): Middleware[] // 返回构建好的中间件数组

  // 可选：直接执行链
  execute(
    context: AiProviderMiddlewareContext,
    params: any,
    middlewareExecutor: (chain: Middleware[], context: AiProviderMiddlewareContext, params: any) => void
  ): void
}
```

### 2.3. 使用示例

```typescript
// 1. 定义一些中间件实例 (假设它们有 .name 属性)
const loggingStart = { name: MiddlewareName.LOGGING_START, fn: loggingStartFn }
const requestExec = { name: MiddlewareName.REQUEST_EXECUTION, fn: requestExecFn }
const streamAdapter = { name: MiddlewareName.STREAM_ADAPTER, fn: streamAdapterFn }
const customFeature = { name: MiddlewareName.CUSTOM_FEATURE, fn: customFeatureFn } // 假设自定义

// 2. 定义一个基础链 (可选)
const BASE_CHAIN: Middleware[] = [loggingStart, requestExec, streamAdapter]

// 3. 使用 MiddlewareBuilder
const builder = new MiddlewareBuilder(BASE_CHAIN)

if (params.needsCustomFeature) {
  builder.insertAfter(MiddlewareName.STREAM_ADAPTER, customFeature)
}

if (params.isHighSecurityContext) {
  builder.insertBefore(MiddlewareName.REQUEST_EXECUTION, высокоSecurityCheckMiddleware)
}

if (params.overrideLogging) {
  builder.replace(MiddlewareName.LOGGING_START, newSpecialLoggingMiddleware)
}

// 4. 获取最终链
const finalChain = builder.build()

// 5. 执行 (通过外部执行器)
// middlewareExecutor(finalChain, context, params);
// 或者 builder.execute(context, params, middlewareExecutor);
```

## 3. `MiddlewareExecutor` / `applyMiddlewares` (中间件执行器)

这是负责接收 `MiddlewareBuilder` 构建的中间件链并实际执行它们的组件。

### 3.1. 职责

- 接收 `Middleware[]`, `AiProviderMiddlewareContext`, `Params`。
- 按顺序迭代中间件。
- 为每个中间件提供正确的 `next` 函数，该函数在被调用时会执行链中的下一个中间件。
- 处理中间件执行过程中的Promise（如果中间件是异步的）。
- 基础的错误捕获（具体错误处理应由链内的 `ErrorHandlingMiddleware` 负责）。

## 4. 在 `AiCoreService` 中使用

`AiCoreService` 中的每个核心业务方法 (如 `executeCompletions`) 将负责：

1.  准备基础数据：实例化 `ApiClient`，转换 `Params` 为 `CoreRequest`。
2.  实例化 `MiddlewareBuilder`，可能会传入一个特定于该业务方法的基础中间件链。
3.  根据 `Params` 和 `CoreRequest` 中的条件，调用 `MiddlewareBuilder` 的方法来动态调整中间件链。
4.  调用 `MiddlewareBuilder.build()` 获取最终的中间件链。
5.  创建完整的 `AiProviderMiddlewareContext` (包含 `resolvePromise`, `rejectPromise` 等)。
6.  调用 `MiddlewareExecutor` (或 `applyMiddlewares`) 来执行构建好的链。

## 5. 组合功能

对于组合功能（例如 "Completions then Translate"）：

- 不推荐创建一个单一、庞大的 `MiddlewareBuilder` 来处理整个组合流程。
- 推荐在 `AiCoreService` 中创建一个新的方法，该方法按顺序 `await` 调用底层的原子 `AiCoreService` 方法（例如，先 `await this.executeCompletions(...)`，然后用其结果 `await this.translateText(...)`）。
- 每个被调用的原子方法内部会使用其自身的 `MiddlewareBuilder` 实例来构建和执行其特定阶段的中间件链。
- 这种方式最大化了复用，并保持了各部分职责的清晰。

## 6. 中间件命名和发现

为中间件赋予唯一的 `MiddlewareName` 对于 `MiddlewareBuilder` 的 `insertAfter`, `insertBefore`, `replace`, `remove` 等操作至关重要。确保中间件实例能够以某种方式暴露其名称（例如，一个 `name` 属性）。
