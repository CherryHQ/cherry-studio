# MiddlewareBuilder 使用指南

`MiddlewareBuilder` 是一个用于动态构建和管理中间件链的工具，解决了之前提到的几个问题：

## 主要改进

### 1. 中间件名称暴露

现在支持多种方式为中间件指定名称：

```typescript
// 方式1：元组格式 [name, middleware]
[MiddlewareName.ABORT_HANDLER, AbortHandlerMiddleware]

// 方式2：命名中间件对象
createNamedMiddleware(MiddlewareName.LOGGING_START, loggingMiddleware)

// 方式3：自动推断（如果中间件有 middlewareName 属性）
// 中间件实现中添加: static middlewareName = MiddlewareName.XXX
```

### 2. 简化的工厂函数

```typescript
// 新的方式
createNamedMiddleware(name, middleware)
createCompletionsBuilder()
```

### 3. 内置默认链

默认的中间件链集成到 builder 内部：

```typescript
// 直接使用默认链
const builder = CompletionsMiddlewareBuilder.withDefaults()

// 或者使用工厂函数
const builder = createCompletionsBuilder(getDefaultCompletionsMiddlewares())
```

## 基本用法

### 1. 使用默认中间件链

```typescript
import { CompletionsMiddlewareBuilder } from './builder'

const builder = CompletionsMiddlewareBuilder.withDefaults()
const middlewares = builder.build()
```

### 2. 自定义中间件链

```typescript
import { createCompletionsBuilder, MiddlewareName } from './builder'

const builder = createCompletionsBuilder([
  [MiddlewareName.ABORT_HANDLER, AbortHandlerMiddleware],
  [MiddlewareName.TEXT_CHUNK, TextChunkMiddleware]
])

const middlewares = builder.build()
```

### 3. 动态调整中间件链

```typescript
const builder = CompletionsMiddlewareBuilder.withDefaults()

// 根据条件添加、移除、替换中间件
if (needsLogging) {
  builder.prepend([MiddlewareName.LOGGING_START, loggingMiddleware])
}

if (disableTools) {
  builder.remove(MiddlewareName.MCP_TOOL_CHUNK)
}

if (customThinking) {
  builder.replace(MiddlewareName.THINKING_TAG_EXTRACTION, 
    [MiddlewareName.THINKING_TAG_EXTRACTION, customThinkingMiddleware])
}

const middlewares = builder.build()
```

### 4. 链式操作

```typescript
const middlewares = CompletionsMiddlewareBuilder
  .withDefaults()
  .add([MiddlewareName.CUSTOM_MIDDLEWARE, customMiddleware])
  .insertBefore(MiddlewareName.SDK_CALL, [MiddlewareName.SECURITY_CHECK, securityMiddleware])
  .remove(MiddlewareName.WEB_SEARCH)
  .build()
```

## API 参考

### CompletionsMiddlewareBuilder

- `static withDefaults()`: 创建带有默认中间件链的构建器
- `add(middleware)`: 在链末尾添加中间件
- `prepend(middleware)`: 在链开头添加中间件
- `insertAfter(target, middleware)`: 在指定中间件后插入
- `insertBefore(target, middleware)`: 在指定中间件前插入
- `replace(target, middleware)`: 替换指定中间件
- `remove(target)`: 移除指定中间件
- `has(name)`: 检查是否包含指定中间件
- `build()`: 构建最终的中间件数组
- `getChain()`: 获取当前链（包含名称信息）

### 工厂函数

- `createCompletionsBuilder(baseChain?)`: 创建 Completions 中间件构建器
- `createMethodBuilder(baseChain?)`: 创建通用方法中间件构建器
- `createNamedMiddleware(name, middleware)`: 创建命名中间件对象
- `getDefaultCompletionsMiddlewares()`: 获取默认的 Completions 中间件链

## 类型安全

构建器提供完整的 TypeScript 类型支持：

- `CompletionsMiddlewareBuilder` 专门用于 `CompletionsMiddleware` 类型
- `MethodMiddlewareBuilder` 用于通用的 `MethodMiddleware` 类型
- 输入格式通过 `MiddlewareEntry<T>` 类型支持多种形式

## 注意事项

1. **类型兼容性**：`MethodMiddleware` 和 `CompletionsMiddleware` 不兼容，需要使用对应的构建器
2. **中间件名称**：确保为每个中间件提供正确的 `MiddlewareName`，用于动态操作
3. **默认链**：默认链使用延迟导入避免循环依赖，首次调用时会加载所有中间件

## 在 AiCoreService 中的使用

```typescript
export class AiCoreService {
  executeCompletions(params: CompletionsParams): Promise<CompletionsResult> {
    // 1. 构建中间件链
    const builder = CompletionsMiddlewareBuilder.withDefaults()
    
    // 2. 根据参数动态调整
    if (params.enableCustomFeature) {
      builder.insertAfter(MiddlewareName.STREAM_ADAPTER, customFeature)
    }
    
    // 3. 应用中间件
    const middlewares = builder.build()
    return applyCompletionsMiddlewares(apiClient, originalMethod, middlewares)
  }
}
```

这种设计使得中间件链的构建既灵活又类型安全，同时保持了简洁的 API 接口。 