# AI SDK 中间件建造者

## 概述

`AiSdkMiddlewareBuilder` 是一个用于动态构建 AI SDK 中间件数组的建造者模式实现。它可以根据不同的条件（如流式输出、思考模型、provider类型等）自动构建合适的中间件组合。

## 使用方式

### 基本用法

```typescript
import { buildAiSdkMiddlewares, type AiSdkMiddlewareConfig } from './AiSdkMiddlewareBuilder'

// 配置中间件参数
const config: AiSdkMiddlewareConfig = {
  streamOutput: false, // 非流式输出
  onChunk: chunkHandler, // chunk回调函数
  model: currentModel, // 当前模型
  provider: currentProvider, // 当前provider
  enableReasoning: true, // 启用推理
  enableTool: false, // 禁用工具
  enableWebSearch: false // 禁用网页搜索
}

// 构建中间件数组
const middlewares = buildAiSdkMiddlewares(config)

// 创建带有中间件的客户端
const client = createClient(providerId, options, middlewares)
```

### 手动构建

```typescript
import { AiSdkMiddlewareBuilder, createAiSdkMiddlewareBuilder } from './AiSdkMiddlewareBuilder'

const builder = createAiSdkMiddlewareBuilder()

// 添加特定中间件
builder.add({
  name: 'custom-middleware',
  aiSdkMiddlewares: [customMiddleware()]
})

// 检查是否包含某个中间件
if (builder.has('thinking-time')) {
  console.log('已包含思考时间中间件')
}

// 移除不需要的中间件
builder.remove('simulate-streaming')

// 构建最终数组
const middlewares = builder.build()
```

## 支持的条件

### 1. 流式输出控制

- **streamOutput = false**: 自动添加 `simulateStreamingMiddleware`
- **streamOutput = true**: 使用原生流式处理

### 2. 思考模型处理

- **条件**: `onChunk` 存在 && `isReasoningModel(model)` 为 true
- **效果**: 自动添加 `thinkingTimeMiddleware`

### 3. Provider 特定中间件

根据不同的 provider 类型添加特定中间件：

- **anthropic**: Anthropic 特定处理
- **openai**: OpenAI 特定处理
- **gemini**: Gemini 特定处理

### 4. 模型特定中间件

根据模型特性添加中间件：

- **图像生成模型**: 添加图像处理相关中间件
- **多模态模型**: 添加多模态处理中间件

## 扩展指南

### 添加新的条件判断

在 `buildAiSdkMiddlewares` 函数中添加新的条件：

```typescript
// 例如：添加缓存中间件
if (config.enableCache) {
  builder.add({
    name: 'cache',
    aiSdkMiddlewares: [cacheMiddleware(config.cacheOptions)]
  })
}
```

### 添加 Provider 特定处理

在 `addProviderSpecificMiddlewares` 函数中添加：

```typescript
case 'custom-provider':
  builder.add({
    name: 'custom-provider-middleware',
    aiSdkMiddlewares: [customProviderMiddleware()]
  })
  break
```

### 添加模型特定处理

在 `addModelSpecificMiddlewares` 函数中添加：

```typescript
if (config.model.id.includes('custom-model')) {
  builder.add({
    name: 'custom-model-middleware',
    aiSdkMiddlewares: [customModelMiddleware()]
  })
}
```

## 中间件执行顺序

中间件按照添加顺序执行：

1. **simulate-streaming** (如果 streamOutput = false)
2. **thinking-time** (如果是思考模型且有 onChunk)
3. **provider-specific** (根据 provider 类型)
4. **model-specific** (根据模型类型)

## 注意事项

1. 中间件的执行顺序很重要，确保按正确顺序添加
2. 避免添加冲突的中间件
3. 某些中间件可能有依赖关系，需要确保依赖的中间件先添加
4. 建议在开发环境下启用日志，以便调试中间件构建过程
