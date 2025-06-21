# @cherrystudio/ai-core

Cherry Studio AI Core 是一个基于 Vercel AI SDK 的统一 AI Provider 接口包。

## 特性

- 🚀 统一的 AI Provider 接口
- 🔄 动态导入支持
- 💾 智能缓存机制
- 🛠️ TypeScript 支持
- 📦 轻量级设计

## 支持的 Providers

基于 [AI SDK 官方支持的 providers](https://ai-sdk.dev/providers/ai-sdk-providers)：

**核心 Providers:**

- OpenAI
- Anthropic
- Google Generative AI
- Google Vertex AI
- Mistral AI
- xAI (Grok)
- Azure OpenAI
- Amazon Bedrock

**扩展 Providers:**

- Cohere
- Groq
- Together.ai
- Fireworks
- DeepSeek
- Cerebras
- DeepInfra
- Replicate
- Perplexity
- Fal AI
- Vercel

## 安装

```bash
npm install @cherrystudio/ai-core ai
```

还需要安装你要使用的 AI SDK provider:

```bash
npm install @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
```

## 使用示例

### 基础用法

```typescript
import { createAiSdkClient } from '@cherrystudio/ai-core'

// 创建 OpenAI 客户端
const client = await createAiSdkClient('openai', {
  apiKey: 'your-api-key'
})

// 流式生成
const result = await client.stream({
  modelId: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
})

// 非流式生成
const response = await client.generate({
  modelId: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }]
})
```

### 便捷函数

```typescript
import { createOpenAIClient, streamGeneration } from '@cherrystudio/ai-core'

// 快速创建 OpenAI 客户端
const client = await createOpenAIClient({
  apiKey: 'your-api-key'
})

// 便捷流式生成
const result = await streamGeneration('openai', 'gpt-4', [{ role: 'user', content: 'Hello!' }], {
  apiKey: 'your-api-key'
})
```

### 多 Provider 支持

```typescript
import { createAiSdkClient } from '@cherrystudio/ai-core'

// 支持多种 AI providers
const openaiClient = await createAiSdkClient('openai', { apiKey: 'openai-key' })
const anthropicClient = await createAiSdkClient('anthropic', { apiKey: 'anthropic-key' })
const googleClient = await createAiSdkClient('google', { apiKey: 'google-key' })
const xaiClient = await createAiSdkClient('xai', { apiKey: 'xai-key' })
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
- **插件支持**：自定义注册表仍可享受 Cherry Studio 插件系统的部分功能
- **最佳实践**：结合两种方式的优点，既有动态加载的性能优势，又有统一注册表的便利性

## License

MIT
