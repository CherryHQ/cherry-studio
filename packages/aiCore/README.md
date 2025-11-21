# @cherrystudio/ai-core

Cherry Studio AI Core 是一个基于 Vercel AI SDK 的统一 AI Provider 接口包，为 AI 应用提供强大的抽象层和插件化架构。

## ✨ 核心亮点

### 🏗️ 优雅的架构设计

- **简化分层**：`models`（模型层）→ `runtime`（运行时层），清晰的职责分离
- **函数式优先**：避免过度抽象，提供简洁直观的 API
- **类型安全**：完整的 TypeScript 支持，直接复用 AI SDK 类型系统
- **最小包装**：直接使用 AI SDK 的接口，避免重复定义和性能损耗

### 🔌 强大的插件系统

- **生命周期钩子**：支持请求全生命周期的扩展点
- **流转换支持**：基于 AI SDK 的 `experimental_transform` 实现流处理
- **插件分类**：First、Sequential、Parallel 三种钩子类型，满足不同场景
- **内置插件**：webSearch、logging、toolUse 等开箱即用的功能

### 🌐 统一多 Provider 接口

- **扩展注册**：支持自定义 Provider 注册，无限扩展能力
- **配置统一**：统一的配置接口，简化多 Provider 管理

### 🚀 多种使用方式

- **函数式调用**：适合简单场景的直接函数调用
- **执行器实例**：适合复杂场景的可复用执行器
- **静态工厂**：便捷的静态创建方法
- **原生兼容**：完全兼容 AI SDK 原生 Provider Registry

### 🔮 面向未来

- **Agent 就绪**：为 OpenAI Agents SDK 集成预留架构空间
- **模块化设计**：独立包结构，支持跨项目复用
- **渐进式迁移**：可以逐步从现有 AI SDK 代码迁移

## 特性

- 🚀 统一的 AI Provider 接口
- 🔄 动态导入支持
- 🛠️ TypeScript 支持
- 📦 强大的插件系统
- 🌍 内置webSearch(Openai,Google,Anthropic,xAI)
- 🎯 多种使用模式（函数式/实例式/静态工厂）
- 🔌 可扩展的 Provider 注册系统
- 🧩 完整的中间件支持
- 📊 插件统计和调试功能

## 支持的 Providers

基于 [AI SDK 官方支持的 providers](https://ai-sdk.dev/providers/ai-sdk-providers)：

**核心 Providers（内置支持）:**

- OpenAI
- Anthropic
- Google Generative AI
- OpenAI-Compatible
- xAI (Grok)
- Azure OpenAI
- DeepSeek

**扩展 Providers（通过注册API支持）:**

- Google Vertex AI
- ...
- 自定义 Provider

## 安装

```bash
npm install @cherrystudio/ai-core ai @ai-sdk/google @ai-sdk/openai
```

### React Native

如果你在 React Native 项目中使用此包，需要在 `metro.config.js` 中添加以下配置：

```javascript
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// 添加对 @cherrystudio/ai-core 的支持
config.resolver.resolverMainFields = ['react-native', 'browser', 'main']
config.resolver.platforms = ['ios', 'android', 'native', 'web']

module.exports = config
```

还需要安装你要使用的 AI SDK provider:

```bash
npm install @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
```

## 使用示例

### 基础用法

```typescript
import { AiCore } from '@cherrystudio/ai-core'

// 创建 OpenAI executor
const executor = AiCore.create('openai', {
  apiKey: 'your-api-key'
})

// 流式生成
const result = await executor.streamText('gpt-4', {
  messages: [{ role: 'user', content: 'Hello!' }]
})

// 非流式生成
const response = await executor.generateText('gpt-4', {
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

### 便捷函数

```typescript
import { createOpenAIExecutor } from '@cherrystudio/ai-core'

// 快速创建 OpenAI executor
const executor = createOpenAIExecutor({
  apiKey: 'your-api-key'
})

// 使用 executor
const result = await executor.streamText('gpt-4', {
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

### 多 Provider 支持

```typescript
import { AiCore } from '@cherrystudio/ai-core'

// 支持多种 AI providers
const openaiExecutor = AiCore.create('openai', { apiKey: 'openai-key' })
const anthropicExecutor = AiCore.create('anthropic', { apiKey: 'anthropic-key' })
const googleExecutor = AiCore.create('google', { apiKey: 'google-key' })
const xaiExecutor = AiCore.create('xai', { apiKey: 'xai-key' })
```

### 扩展 Provider 注册

对于非内置的 providers，可以通过注册 API 扩展支持：

```typescript
import { registerProvider, AiCore } from '@cherrystudio/ai-core'

// 方式一：导入并注册第三方 provider
import { createGroq } from '@ai-sdk/groq'

registerProvider({
  id: 'groq',
  name: 'Groq',
  creator: createGroq,
  supportsImageGeneration: false
})

// 现在可以使用 Groq
const groqExecutor = AiCore.create('groq', { apiKey: 'groq-key' })

// 方式二：动态导入方式注册
registerProvider({
  id: 'mistral',
  name: 'Mistral AI',
  import: () => import('@ai-sdk/mistral'),
  creatorFunctionName: 'createMistral'
})

const mistralExecutor = AiCore.create('mistral', { apiKey: 'mistral-key' })
```

## 🔌 插件系统

AI Core 提供了强大的插件系统，支持请求全生命周期的扩展。

### 内置插件

#### webSearchPlugin - 网络搜索插件

为不同 AI Provider 提供统一的网络搜索能力：

```typescript
import { webSearchPlugin } from '@cherrystudio/ai-core/built-in/plugins'

const executor = AiCore.create('openai', { apiKey: 'your-key' }, [
  webSearchPlugin({
    openai: {
      /* OpenAI 搜索配置 */
    },
    anthropic: { maxUses: 5 },
    google: {
      /* Google 搜索配置 */
    },
    xai: {
      mode: 'on',
      returnCitations: true,
      maxSearchResults: 5,
      sources: [{ type: 'web' }, { type: 'x' }, { type: 'news' }]
    }
  })
])
```

#### loggingPlugin - 日志插件

提供详细的请求日志记录：

```typescript
import { createLoggingPlugin } from '@cherrystudio/ai-core/built-in/plugins'

const executor = AiCore.create('openai', { apiKey: 'your-key' }, [
  createLoggingPlugin({
    logLevel: 'info',
    includeParams: true,
    includeResult: false
  })
])
```

#### promptToolUsePlugin - 提示工具使用插件

为不支持原生 Function Call 的模型提供 prompt 方式的工具调用：

```typescript
import { createPromptToolUsePlugin } from '@cherrystudio/ai-core/built-in/plugins'

// 对于不支持 function call 的模型
const executor = AiCore.create(
  'providerId',
  {
    apiKey: 'your-key',
    baseURL: 'https://your-model-endpoint'
  },
  [
    createPromptToolUsePlugin({
      enabled: true,
      // 可选：自定义系统提示符构建
      buildSystemPrompt: (userPrompt, tools) => {
        return `${userPrompt}\n\nAvailable tools: ${Object.keys(tools).join(', ')}`
      }
    })
  ]
)
```

### 自定义插件

创建自定义插件非常简单：

```typescript
import { definePlugin } from '@cherrystudio/ai-core'

const customPlugin = definePlugin({
  name: 'custom-plugin',
  enforce: 'pre', // 'pre' | 'post' | undefined

  // 在请求开始时记录日志
  onRequestStart: async (context) => {
    console.log(`Starting request for model: ${context.modelId}`)
  },

  // 转换请求参数
  transformParams: async (params, context) => {
    // 添加自定义系统消息
    if (params.messages) {
      params.messages.unshift({
        role: 'system',
        content: 'You are a helpful assistant.'
      })
    }
    return params
  },

  // 处理响应结果
  transformResult: async (result, context) => {
    // 添加元数据
    if (result.text) {
      result.metadata = {
        processedAt: new Date().toISOString(),
        modelId: context.modelId
      }
    }
    return result
  }
})

// 使用自定义插件
const executor = AiCore.create('openai', { apiKey: 'your-key' }, [customPlugin])
```

### 使用 AI SDK 原生 Provider 注册表

> https://ai-sdk.dev/docs/reference/ai-sdk-core/provider-registry

除了使用内建的 provider 管理，你还可以使用 AI SDK 原生的 `createProviderRegistry` 来构建自己的 provider 注册表。

#### 基本用法示例

```typescript
import { createClient } from '@cherrystudio/ai-core'
import { createProviderRegistry } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

// 1. 创建 AI SDK 原生注册表
export const registry = createProviderRegistry({
  // register provider with prefix and default setup:
  anthropic,

  // register provider with prefix and custom setup:
  openai: createOpenAI({
    apiKey: process.env.OPENAI_API_KEY
  })
})

// 2. 创建client,'openai'可以传空或者传providerId(内建的provider)
const client = PluginEnabledAiClient.create('openai', {
  apiKey: process.env.OPENAI_API_KEY
})

// 3. 方式1：使用内建逻辑（传统方式）
const result1 = await client.streamText('gpt-4', {
  messages: [{ role: 'user', content: 'Hello with built-in logic!' }]
})

// 4. 方式2：使用自定义注册表（灵活方式）
const result2 = await client.streamText({
  model: registry.languageModel('openai:gpt-4'),
  messages: [{ role: 'user', content: 'Hello with custom registry!' }]
})

// 5. 支持的重载方法
await client.generateObject({
  model: registry.languageModel('openai:gpt-4'),
  schema: z.object({ name: z.string() }),
  messages: [{ role: 'user', content: 'Generate a user' }]
})

await client.streamObject({
  model: registry.languageModel('anthropic:claude-3-opus-20240229'),
  schema: z.object({ items: z.array(z.string()) }),
  messages: [{ role: 'user', content: 'Generate a list' }]
})
```

#### 与插件系统配合使用

更强大的是，你还可以将自定义注册表与 Cherry Studio 的插件系统结合使用：

```typescript
import { PluginEnabledAiClient } from '@cherrystudio/ai-core'
import { createProviderRegistry } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'

// 1. 创建带插件的客户端
const client = PluginEnabledAiClient.create(
  'openai',
  {
    apiKey: process.env.OPENAI_API_KEY
  },
  [LoggingPlugin, RetryPlugin]
)

// 2. 创建自定义注册表
const registry = createProviderRegistry({
  openai: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  anthropic: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
})

// 3. 方式1：使用内建逻辑 + 完整插件系统
await client.streamText('gpt-4', {
  messages: [{ role: 'user', content: 'Hello with plugins!' }]
})

// 4. 方式2：使用自定义注册表 + 有限插件支持
await client.streamText({
  model: registry.languageModel('anthropic:claude-3-opus-20240229'),
  messages: [{ role: 'user', content: 'Hello from Claude!' }]
})

// 5. 支持的方法
await client.generateObject({
  model: registry.languageModel('openai:gpt-4'),
  schema: z.object({ name: z.string() }),
  messages: [{ role: 'user', content: 'Generate a user' }]
})

await client.streamObject({
  model: registry.languageModel('openai:gpt-4'),
  schema: z.object({ items: z.array(z.string()) }),
  messages: [{ role: 'user', content: 'Generate a list' }]
})
```

#### 混合使用的优势

- **灵活性**：可以根据需要选择使用内建逻辑或自定义注册表
- **兼容性**：完全兼容 AI SDK 的 `createProviderRegistry` API
- **渐进式**：可以逐步迁移现有代码，无需一次性重构
- **插件支持**：自定义注册表仍可享受插件系统的部分功能
- **最佳实践**：结合两种方式的优点，既有动态加载的性能优势，又有统一注册表的便利性

## 📚 相关资源

- [Vercel AI SDK 文档](https://ai-sdk.dev/)
- [Cherry Studio 项目](https://github.com/CherryHQ/cherry-studio)
- [AI SDK Providers](https://ai-sdk.dev/providers/ai-sdk-providers)

## 未来版本

- 🔮 多 Agent 编排
- 🔮 可视化插件配置
- 🔮 实时监控和分析
- 🔮 云端插件同步

## 📄 License

MIT License - 详见 [LICENSE](https://github.com/CherryHQ/cherry-studio/blob/main/LICENSE) 文件

---

**Cherry Studio AI Core** - 让 AI 开发更简单、更强大、更灵活 🚀
