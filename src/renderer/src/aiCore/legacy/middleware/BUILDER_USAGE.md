# MiddlewareBuilder 使用指南

`MiddlewareBuilder` 是一个用于动态构建和管理中间件链的工具，提供灵活的中间件组织和配置能力。

## 主要特性

### 1. 统一的中间件命名

所有中间件都通过导出的 `MIDDLEWARE_NAME` 常量标识：

```typescript
// 中间件文件示例
export const MIDDLEWARE_NAME = 'SdkCallMiddleware'
export const SdkCallMiddleware: CompletionsMiddleware = ...
```

### 2. NamedMiddleware 接口

中间件使用统一的 `NamedMiddleware` 接口格式：

```typescript
interface NamedMiddleware<TMiddleware = any> {
  name: string
  middleware: TMiddleware
}
```

### 3. 中间件注册表

通过 `MiddlewareRegistry` 集中管理所有可用中间件：

```typescript
import { MiddlewareRegistry } from './register'

// 通过名称获取中间件
const sdkCallMiddleware = MiddlewareRegistry['SdkCallMiddleware']
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
import { createCompletionsBuilder, MiddlewareRegistry } from './builder'

const builder = createCompletionsBuilder([
  MiddlewareRegistry['AbortHandlerMiddleware'],
  MiddlewareRegistry['TextChunkMiddleware']
])

const middlewares = builder.build()
```

### 3. 动态调整中间件链

```typescript
const builder = CompletionsMiddlewareBuilder.withDefaults()

// 根据条件添加、移除、替换中间件
if (needsLogging) {
  builder.prepend(MiddlewareRegistry['GenericLoggingMiddleware'])
}

if (disableTools) {
  builder.remove('McpToolChunkMiddleware')
}

if (customThinking) {
  builder.replace('ThinkingTagExtractionMiddleware', customThinkingMiddleware)
}

const middlewares = builder.build()
```

### 4. 链式操作

```typescript
const middlewares = CompletionsMiddlewareBuilder.withDefaults()
  .add(MiddlewareRegistry['CustomMiddleware'])
  .insertBefore('SdkCallMiddleware', MiddlewareRegistry['SecurityCheckMiddleware'])
  .remove('WebSearchMiddleware')
  .build()
```

## API 参考

### CompletionsMiddlewareBuilder

**静态方法：**

- `static withDefaults()`: 创建带有默认中间件链的构建器

**实例方法：**

- `add(middleware: NamedMiddleware)`: 在链末尾添加中间件
- `prepend(middleware: NamedMiddleware)`: 在链开头添加中间件
- `insertAfter(targetName: string, middleware: NamedMiddleware)`: 在指定中间件后插入
- `insertBefore(targetName: string, middleware: NamedMiddleware)`: 在指定中间件前插入
- `replace(targetName: string, middleware: NamedMiddleware)`: 替换指定中间件
- `remove(targetName: string)`: 移除指定中间件
- `has(name: string)`: 检查是否包含指定中间件
- `build()`: 构建最终的中间件数组
- `getChain()`: 获取当前链（包含名称信息）
- `clear()`: 清空中间件链
- `execute(context, params, middlewareExecutor)`: 直接执行构建好的中间件链

### 工厂函数

- `createCompletionsBuilder(baseChain?)`: 创建 Completions 中间件构建器
- `createMethodBuilder(baseChain?)`: 创建通用方法中间件构建器
- `addMiddlewareName(middleware, name)`: 为中间件添加名称属性的辅助函数

### 中间件注册表

- `MiddlewareRegistry`: 所有注册中间件的集中访问点
- `getMiddleware(name)`: 根据名称获取中间件
- `getRegisteredMiddlewareNames()`: 获取所有注册的中间件名称
- `DefaultCompletionsNamedMiddlewares`: 默认的 Completions 中间件链（NamedMiddleware 格式）

## 类型安全

构建器提供完整的 TypeScript 类型支持：

- `CompletionsMiddlewareBuilder` 专门用于 `CompletionsMiddleware` 类型
- `MethodMiddlewareBuilder` 用于通用的 `MethodMiddleware` 类型
- 所有中间件操作都基于 `NamedMiddleware<TMiddleware>` 接口

## 默认中间件链

默认的 Completions 中间件执行顺序：

1. `FinalChunkConsumerMiddleware` - 最终消费者
2. `TransformCoreToSdkParamsMiddleware` - 参数转换
3. `AbortHandlerMiddleware` - 中止处理
4. `McpToolChunkMiddleware` - 工具处理
5. `WebSearchMiddleware` - Web搜索处理
6. `TextChunkMiddleware` - 文本处理
7. `ThinkingTagExtractionMiddleware` - 思考标签提取处理
8. `ThinkChunkMiddleware` - 思考处理
9. `ResponseTransformMiddleware` - 响应转换
10. `StreamAdapterMiddleware` - 流适配器
11. `SdkCallMiddleware` - SDK调用

## 在 AiProvider 中的使用

```typescript
export default class AiProvider {
  public async completions(params: CompletionsParams): Promise<CompletionsResult> {
    // 1. 构建中间件链
    const builder = CompletionsMiddlewareBuilder.withDefaults()

    // 2. 根据参数动态调整
    if (params.enableCustomFeature) {
      builder.insertAfter('StreamAdapterMiddleware', customFeatureMiddleware)
    }

    // 3. 应用中间件
    const middlewares = builder.build()
    const wrappedMethod = applyCompletionsMiddlewares(this.apiClient, this.apiClient.createCompletions, middlewares)

    return wrappedMethod(params)
  }
}
```

## 注意事项

1. **类型兼容性**：`MethodMiddleware` 和 `CompletionsMiddleware` 不兼容，需要使用对应的构建器
2. **中间件名称**：所有中间件必须导出 `MIDDLEWARE_NAME` 常量用于标识
3. **注册表管理**：新增中间件需要在 `register.ts` 中注册
4. **默认链**：默认链通过 `DefaultCompletionsNamedMiddlewares` 提供，支持延迟加载避免循环依赖

这种设计使得中间件链的构建既灵活又类型安全，同时保持了简洁的 API 接口。
