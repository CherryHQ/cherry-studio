# Cherry Studio AI Core 架构文档

> **版本**: v2.2 (StringKeys 工具类型 + 变体自反映射)
> **更新日期**: 2026-01-02
> **适用范围**: Cherry Studio v1.7.7+

本文档详细描述了 Cherry Studio 从用户交互到 AI SDK 调用的完整数据流和架构设计，是理解应用核心功能的关键文档。

---

## 📖 目录

1. [整体架构概览](#1-整体架构概览)
2. [完整调用流程](#2-完整调用流程)
3. [核心组件详解](#3-核心组件详解)
4. [Provider 系统架构](#4-provider-系统架构)
5. [插件与中间件系统](#5-插件与中间件系统)
6. [消息处理流程](#6-消息处理流程)
7. [类型安全机制](#7-类型安全机制)
8. [Trace 和可观测性](#8-trace-和可观测性)
9. [错误处理机制](#9-错误处理机制)
10. [性能优化](#10-性能优化)

---

## 1. 整体架构概览

### 1.1 架构分层

Cherry Studio 的 AI 调用采用清晰的分层架构：

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│  (React Components, Redux Store, User Interactions)         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Service Layer                              │
│  src/renderer/src/services/                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │ ApiService.ts                                       │    │
│  │  - transformMessagesAndFetch()                      │    │
│  │  - fetchChatCompletion()                            │    │
│  │  - fetchMessagesSummary()                           │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 AI Provider Layer                            │
│  src/renderer/src/aiCore/                                    │
│  ┌────────────────────────────────────────────────────┐    │
│  │ ModernAiProvider (index_new.ts)                     │    │
│  │  - completions()                                    │    │
│  │  - modernCompletions()                              │    │
│  │  - _completionsForTrace()                           │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Provider Config & Adaptation                        │    │
│  │  - providerConfig.ts                                │    │
│  │  - providerToAiSdkConfig()                          │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Core Package Layer                          │
│  packages/aiCore/ (@cherrystudio/ai-core)                    │
│  ┌────────────────────────────────────────────────────┐    │
│  │ RuntimeExecutor                                     │    │
│  │  - streamText()                                     │    │
│  │  - generateText()                                   │    │
│  │  - generateImage()                                  │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Provider Extension System                           │    │
│  │  - ProviderExtension (LRU Cache)                    │    │
│  │  - ExtensionRegistry                                │    │
│  │  - OpenAI/Anthropic/Google Extensions              │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Plugin Engine                                       │    │
│  │  - PluginManager                                    │    │
│  │  - AiPlugin Lifecycle Hooks                         │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   AI SDK Layer                              │
│  Vercel AI SDK v6.x (@ai-sdk/*)                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Provider Implementations                            │    │
│  │  - @ai-sdk/openai                                   │    │
│  │  - @ai-sdk/anthropic                                │    │
│  │  - @ai-sdk/google-generative-ai                     │    │
│  │  - @ai-sdk/mistral                                  │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Core Functions                                      │    │
│  │  - streamText()                                     │    │
│  │  - generateText()                                   │    │
│  └─────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   LLM Provider API
│  (OpenAI, Anthropic, Google, etc.)                          │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计理念

#### 1.2.1 关注点分离 (Separation of Concerns)

- **Service Layer**: 业务逻辑、消息准备、工具调用
- **AI Provider Layer**: Provider 适配、参数转换、插件构建
- **Core Package**: 统一 API、Provider 管理、插件执行
- **AI SDK Layer**: 实际的 LLM API 调用

#### 1.2.2 类型安全优先

- 端到端 TypeScript 类型推断
- Provider Settings 自动关联
- 编译时参数验证

#### 1.2.3 可扩展性

- 插件化架构 (AiPlugin)
- Provider Extension 系统
- 中间件机制

---

## 2. 完整调用流程

### 2.1 从用户输入到 LLM 响应的完整流程

#### 流程图

```
User Input (UI)
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. UI Event Handler                                          │
│    - ChatView/MessageInput Component                         │
│    - Redux dispatch action                                   │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. ApiService.transformMessagesAndFetch()                    │
│    Location: src/renderer/src/services/ApiService.ts:92      │
│                                                               │
│    Step 2.1: ConversationService.prepareMessagesForModel()   │
│    ├─ 消息格式转换 (UI Message → Model Message)              │
│    ├─ 处理图片/文件附件                                       │
│    └─ 应用消息过滤规则                                        │
│                                                               │
│    Step 2.2: replacePromptVariables()                        │
│    └─ 替换 system prompt 中的变量                            │
│                                                               │
│    Step 2.3: injectUserMessageWithKnowledgeSearchPrompt()    │
│    └─ 注入知识库搜索提示（如果启用）                          │
│                                                               │
│    Step 2.4: fetchChatCompletion() ────────────────────────► │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. ApiService.fetchChatCompletion()                          │
│    Location: src/renderer/src/services/ApiService.ts:139     │
│                                                               │
│    Step 3.1: getProviderByModel() + API Key Rotation         │
│    ├─ 获取 provider 配置                                     │
│    ├─ 应用 API Key 轮换（多 key 负载均衡）                   │
│    └─ 创建 providerWithRotatedKey                            │
│                                                               │
│    Step 3.2: new ModernAiProvider(model, provider)           │
│    └─ 初始化 AI Provider 实例                                │
│                                                               │
│    Step 3.3: buildStreamTextParams()                         │
│    ├─ 构建 AI SDK 参数                                       │
│    ├─ 处理 MCP 工具                                          │
│    ├─ 处理 Web Search 配置                                   │
│    └─ 返回 aiSdkParams + capabilities                        │
│                                                               │
│    Step 3.4: buildPlugins(middlewareConfig)                  │
│    └─ 根据 capabilities 构建插件数组                         │
│                                                               │
│    Step 3.5: AI.completions(modelId, params, config) ──────► │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. ModernAiProvider.completions()                            │
│    Location: src/renderer/src/aiCore/index_new.ts:116        │
│                                                               │
│    Step 4.1: providerToAiSdkConfig()                         │
│    ├─ 转换 Cherry Provider → AI SDK Config                   │
│    ├─ 设置 providerId ('openai', 'anthropic', etc.)          │
│    └─ 设置 providerSettings (apiKey, baseURL, etc.)          │
│                                                               │
│    Step 4.2: Claude Code OAuth 特殊处理                      │
│    └─ 注入 Claude Code system message（如果是 OAuth）        │
│                                                               │
│    Step 4.3: 路由选择                                        │
│    ├─ 如果启用 trace → _completionsForTrace()                │
│    └─ 否则 → _completionsOrImageGeneration()                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. ModernAiProvider._completionsOrImageGeneration()          │
│    Location: src/renderer/src/aiCore/index_new.ts:167        │
│                                                               │
│    判断：                                                     │
│    ├─ 图像生成端点 → legacyProvider.completions()            │
│    └─ 文本生成 → modernCompletions() ──────────────────────► │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. ModernAiProvider.modernCompletions()                      │
│    Location: src/renderer/src/aiCore/index_new.ts:284        │
│                                                               │
│    Step 6.1: buildPlugins(config)                            │
│    └─ 构建插件数组（Reasoning, ToolUse, WebSearch, etc.）    │
│                                                               │
│    Step 6.2: createExecutor() ─────────────────────────────► │
│    └─ 创建 RuntimeExecutor 实例                              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. packages/aiCore: createExecutor()                         │
│    Location: packages/aiCore/src/core/runtime/index.ts:25    │
│                                                               │
│    Step 7.1: extensionRegistry.createProvider()              │
│    ├─ 解析 providerId (支持别名和变体)                       │
│    ├─ 获取 ProviderExtension 实例                            │
│    ├─ 计算 settings hash                                     │
│    ├─ LRU 缓存查找                                           │
│    │  ├─ Cache hit → 返回缓存实例                            │
│    │  └─ Cache miss → 创建新实例                             │
│    └─ 返回 ProviderV3 实例                                   │
│                                                               │
│    Step 7.2: RuntimeExecutor.create()                        │
│    ├─ 创建 RuntimeExecutor 实例                              │
│    ├─ 注入 provider 引用                                     │
│    ├─ 初始化 ModelResolver                                   │
│    └─ 初始化 PluginEngine                                    │
│                                                               │
│    返回: RuntimeExecutor<T> 实例 ───────────────────────────► │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. RuntimeExecutor.streamText()                              │
│    Location: packages/aiCore/src/core/runtime/executor.ts    │
│                                                               │
│    Step 8.1: 插件生命周期 - onRequestStart                   │
│    └─ 执行所有插件的 onRequestStart 钩子                     │
│                                                               │
│    Step 8.2: 插件转换 - transformParams                      │
│    └─ 链式执行所有插件的参数转换                             │
│                                                               │
│    Step 8.3: modelResolver.resolveModel()                    │
│    └─ 解析 model string → LanguageModel 实例                 │
│                                                               │
│    Step 8.4: 调用 AI SDK streamText() ──────────────────────►│
│    └─ 传入解析后的 model 和转换后的 params                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. AI SDK: streamText()                                      │
│    Location: node_modules/ai/core/generate-text/stream-text  │
│                                                               │
│    Step 9.1: 参数验证                                        │
│    Step 9.2: 调用 provider.doStream()                        │
│    Step 9.3: 返回 StreamTextResult                           │
│    └─ textStream, fullStream, usage, etc.                    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. 流式数据处理                                             │
│     Location: src/renderer/src/aiCore/chunk/                 │
│                                                               │
│     Step 10.1: AiSdkToChunkAdapter.processStream()           │
│     ├─ 监听 AI SDK 的 textStream                             │
│     ├─ 转换为 Cherry Chunk 格式                              │
│     ├─ 处理 tool calls                                       │
│     ├─ 处理 reasoning blocks                                 │
│     └─ 发送 chunk 到 onChunkReceived callback                │
│                                                               │
│     Step 10.2: StreamProcessingService                       │
│     └─ 处理不同类型的 chunk 并更新 UI                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 11. 插件生命周期 - 完成阶段                                  │
│                                                               │
│     Step 11.1: transformResult                               │
│     └─ 插件可以修改最终结果                                  │
│                                                               │
│     Step 11.2: onRequestEnd                                  │
│     └─ 执行所有插件的完成钩子                                │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 12. UI Update                                                │
│     - Redux state 更新                                       │
│     - React 组件重渲染                                       │
│     - 显示完整响应                                           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 关键时序说明

#### 2.2.1 Provider 实例创建（LRU 缓存机制）

```typescript
// 场景 1: 首次请求 OpenAI (Cache Miss)
const executor1 = await createExecutor('openai', { apiKey: 'sk-xxx' })
// → extensionRegistry.createProvider('openai', { apiKey: 'sk-xxx' })
// → 计算 hash: "abc123"
// → LRU cache miss
// → OpenAIExtension.factory() 创建新 provider
// → 存入 LRU: cache.set("abc123", provider)

// 场景 2: 相同配置的第二次请求 (Cache Hit)
const executor2 = await createExecutor('openai', { apiKey: 'sk-xxx' })
// → 计算 hash: "abc123" (相同)
// → LRU cache hit!
// → 直接返回缓存的 provider
// → executor1 和 executor2 共享同一个 provider 实例

// 场景 3: 不同配置 (Cache Miss + 新实例)
const executor3 = await createExecutor('openai', {
  apiKey: 'sk-yyy',  // 不同的 key
  baseURL: 'https://custom.com/v1'
})
// → 计算 hash: "def456" (不同)
// → LRU cache miss
// → 创建新的独立 provider 实例
// → 存入 LRU: cache.set("def456", provider2)
```

#### 2.2.2 插件执行顺序

```typescript
// 示例：启用 Reasoning + ToolUse + WebSearch
plugins = [ReasoningPlugin, ToolUsePlugin, WebSearchPlugin]

// 执行顺序：
1. onRequestStart:    Reasoning → ToolUse → WebSearch
2. transformParams:   Reasoning → ToolUse → WebSearch (链式)
3. [AI SDK 调用]
4. transformResult:   WebSearch → ToolUse → Reasoning (反向)
5. onRequestEnd:      WebSearch → ToolUse → Reasoning (反向)
```

---

## 3. 核心组件详解

### 3.1 ApiService Layer

#### 文件位置
`src/renderer/src/services/ApiService.ts`

#### 核心职责

1. **消息准备和转换**
2. **MCP 工具集成**
3. **知识库搜索注入**
4. **API Key 轮换**
5. **调用 ModernAiProvider**

#### 关键函数详解

##### 3.1.1 `transformMessagesAndFetch()`

**签名**:
```typescript
async function transformMessagesAndFetch(
  request: {
    messages: Message[]
    assistant: Assistant
    blockManager: BlockManager
    assistantMsgId: string
    callbacks: StreamProcessorCallbacks
    topicId?: string
    options: {
      signal?: AbortSignal
      timeout?: number
      headers?: Record<string, string>
    }
  },
  onChunkReceived: (chunk: Chunk) => void
): Promise<void>
```

**执行流程**:

```typescript
// Step 1: 消息准备
const { modelMessages, uiMessages } =
  await ConversationService.prepareMessagesForModel(messages, assistant)

// modelMessages: 转换为 LLM 理解的格式
// uiMessages: 保留原始 UI 消息（用于某些特殊场景）

// Step 2: 替换 prompt 变量
assistant.prompt = await replacePromptVariables(
  assistant.prompt,
  assistant.model?.name
)
// 例如: "{model_name}" → "GPT-4"

// Step 3: 注入知识库搜索
await injectUserMessageWithKnowledgeSearchPrompt({
  modelMessages,
  assistant,
  assistantMsgId,
  topicId,
  blockManager,
  setCitationBlockId
})

// Step 4: 发起实际请求
await fetchChatCompletion({
  messages: modelMessages,
  assistant,
  topicId,
  requestOptions,
  uiMessages,
  onChunkReceived
})
```

##### 3.1.2 `fetchChatCompletion()`

**关键代码分析**:

```typescript
export async function fetchChatCompletion({
  messages,
  assistant,
  requestOptions,
  onChunkReceived,
  topicId,
  uiMessages
}: FetchChatCompletionParams) {

  // 1. Provider 准备 + API Key 轮换
  const baseProvider = getProviderByModel(assistant.model || getDefaultModel())
  const providerWithRotatedKey = {
    ...baseProvider,
    apiKey: getRotatedApiKey(baseProvider)  // ✅ 多 key 负载均衡
  }

  // 2. 创建 AI Provider 实例
  const AI = new ModernAiProvider(
    assistant.model || getDefaultModel(),
    providerWithRotatedKey
  )

  // 3. 获取 MCP 工具
  const mcpTools: MCPTool[] = []
  if (isPromptToolUse(assistant) || isSupportedToolUse(assistant)) {
    mcpTools.push(...(await fetchMcpTools(assistant)))
  }

  // 4. 构建 AI SDK 参数
  const {
    params: aiSdkParams,
    modelId,
    capabilities,
    webSearchPluginConfig
  } = await buildStreamTextParams(messages, assistant, provider, {
    mcpTools,
    webSearchProviderId: assistant.webSearchProviderId,
    requestOptions
  })

  // 5. 构建中间件配置
  const middlewareConfig: AiSdkMiddlewareConfig = {
    streamOutput: assistant.settings?.streamOutput ?? true,
    onChunk: onChunkReceived,
    model: assistant.model,
    enableReasoning: capabilities.enableReasoning,
    isPromptToolUse: usePromptToolUse,
    isSupportedToolUse: isSupportedToolUse(assistant),
    webSearchPluginConfig,
    enableWebSearch: capabilities.enableWebSearch,
    enableGenerateImage: capabilities.enableGenerateImage,
    enableUrlContext: capabilities.enableUrlContext,
    mcpTools,
    uiMessages,
    knowledgeRecognition: assistant.knowledgeRecognition
  }

  // 6. 调用 AI.completions()
  await AI.completions(modelId, aiSdkParams, {
    ...middlewareConfig,
    assistant,
    topicId,
    callType: 'chat',
    uiMessages
  })
}
```

**API Key 轮换机制**:

```typescript
function getRotatedApiKey(provider: Provider): string {
  const keys = provider.apiKey.split(',').map(k => k.trim()).filter(Boolean)

  if (keys.length === 1) return keys[0]

  const keyName = `provider:${provider.id}:last_used_key`
  const lastUsedKey = window.keyv.get(keyName)

  const currentIndex = keys.indexOf(lastUsedKey)
  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]

  window.keyv.set(keyName, nextKey)
  return nextKey
}

// 使用场景：
// provider.apiKey = "sk-key1,sk-key2,sk-key3"
// 请求 1 → 使用 sk-key1
// 请求 2 → 使用 sk-key2
// 请求 3 → 使用 sk-key3
// 请求 4 → 使用 sk-key1 (轮回)
```

### 3.2 ModernAiProvider Layer

#### 文件位置
`src/renderer/src/aiCore/index_new.ts`

#### 核心职责

1. **Provider 配置转换** (Cherry Provider → AI SDK Config)
2. **插件构建** (根据 capabilities)
3. **Trace 集成** (OpenTelemetry)
4. **调用 RuntimeExecutor**
5. **流式数据适配** (AI SDK Stream → Cherry Chunk)

#### 构造函数详解

```typescript
constructor(modelOrProvider: Model | Provider, provider?: Provider) {
  if (this.isModel(modelOrProvider)) {
    // 情况 1: new ModernAiProvider(model, provider)
    this.model = modelOrProvider
    this.actualProvider = provider
      ? adaptProvider({ provider, model: modelOrProvider })
      : getActualProvider(modelOrProvider)

    // 同步或异步创建 config
    const configOrPromise = providerToAiSdkConfig(
      this.actualProvider,
      modelOrProvider
    )
    this.config = configOrPromise instanceof Promise
      ? undefined
      : configOrPromise
  } else {
    // 情况 2: new ModernAiProvider(provider)
    this.actualProvider = adaptProvider({ provider: modelOrProvider })
  }

  this.legacyProvider = new LegacyAiProvider(this.actualProvider)
}
```

#### completions() 方法详解

```typescript
public async completions(
  modelId: string,
  params: StreamTextParams,
  providerConfig: ModernAiProviderConfig
) {
  // 1. 确保 config 已准备
  if (!this.config) {
    this.config = await Promise.resolve(
      providerToAiSdkConfig(this.actualProvider, this.model!)
    )
  }

  // 2. Claude Code OAuth 特殊处理
  if (this.actualProvider.id === 'anthropic' &&
      this.actualProvider.authType === 'oauth') {
    const claudeCodeSystemMessage = buildClaudeCodeSystemModelMessage(
      params.system
    )
    params.system = undefined
    params.messages = [...claudeCodeSystemMessage, ...(params.messages || [])]
  }

  // 3. 路由选择
  if (providerConfig.topicId && getEnableDeveloperMode()) {
    return await this._completionsForTrace(modelId, params, {
      ...providerConfig,
      topicId: providerConfig.topicId
    })
  } else {
    return await this._completionsOrImageGeneration(modelId, params, providerConfig)
  }
}
```

#### modernCompletions() 核心实现

```typescript
private async modernCompletions(
  modelId: string,
  params: StreamTextParams,
  config: ModernAiProviderConfig
): Promise<CompletionsResult> {

  // 1. 构建插件
  const plugins = buildPlugins(config)

  // 2. 创建 RuntimeExecutor
  const executor = await createExecutor(
    this.config!.providerId,
    this.config!.providerSettings,
    plugins
  )

  // 3. 流式调用
  if (config.onChunk) {
    const accumulate = this.model!.supported_text_delta !== false
    const adapter = new AiSdkToChunkAdapter(
      config.onChunk,
      config.mcpTools,
      accumulate,
      config.enableWebSearch
    )

    const streamResult = await executor.streamText({
      ...params,
      model: modelId,
      experimental_context: { onChunk: config.onChunk }
    })

    const finalText = await adapter.processStream(streamResult)

    return { getText: () => finalText }
  } else {
    // 非流式调用
    const streamResult = await executor.streamText({
      ...params,
      model: modelId
    })

    await streamResult?.consumeStream()
    const finalText = await streamResult.text

    return { getText: () => finalText }
  }
}
```

#### Trace 集成详解

```typescript
private async _completionsForTrace(
  modelId: string,
  params: StreamTextParams,
  config: ModernAiProviderConfig & { topicId: string }
): Promise<CompletionsResult> {

  const traceName = `${this.actualProvider.name}.${modelId}.${config.callType}`

  // 1. 创建 OpenTelemetry Span
  const span = addSpan({
    name: traceName,
    tag: 'LLM',
    topicId: config.topicId,
    modelName: config.assistant.model?.name,
    inputs: params
  })

  if (!span) {
    return await this._completionsOrImageGeneration(modelId, params, config)
  }

  try {
    // 2. 在 span 上下文中执行
    const result = await this._completionsOrImageGeneration(modelId, params, config)

    // 3. 标记 span 成功
    endSpan({
      topicId: config.topicId,
      outputs: result,
      span,
      modelName: modelId
    })

    return result
  } catch (error) {
    // 4. 标记 span 失败
    endSpan({
      topicId: config.topicId,
      error: error as Error,
      span,
      modelName: modelId
    })
    throw error
  }
}
```

---

## 4. Provider 系统架构

### 4.1 Provider 配置转换

#### providerToAiSdkConfig() 详解

**文件**: `src/renderer/src/aiCore/provider/providerConfig.ts`

```typescript
export function providerToAiSdkConfig(
  provider: Provider,
  model?: Model
): ProviderConfig | Promise<ProviderConfig> {

  // 1. 根据 provider.id 路由到具体实现
  switch (provider.id) {
    case 'openai':
      return {
        providerId: 'openai',
        providerSettings: {
          apiKey: provider.apiKey,
          baseURL: provider.apiHost,
          organization: provider.apiOrganization,
          headers: provider.apiHeaders
        }
      }

    case 'anthropic':
      return {
        providerId: 'anthropic',
        providerSettings: {
          apiKey: provider.apiKey,
          baseURL: provider.apiHost
        }
      }

    case 'openai-compatible':
      return {
        providerId: 'openai-compatible',
        providerSettings: {
          baseURL: provider.apiHost,
          apiKey: provider.apiKey,
          name: provider.name
        }
      }

    case 'gateway':
      // 特殊处理：gateway 需要异步创建
      return createGatewayConfig(provider, model)

    // ... 其他 providers
  }
}
```

#### Gateway Provider 特殊处理

```typescript
async function createGatewayConfig(
  provider: Provider,
  model?: Model
): Promise<ProviderConfig> {

  // 1. 从 gateway 获取模型列表
  const gatewayModels = await fetchGatewayModels(provider)

  // 2. 标准化模型格式
  const normalizedModels = normalizeGatewayModels(gatewayModels)

  // 3. 使用 AI SDK 的 gateway() 函数
  const gatewayProvider = gateway({
    provider: {
      languageModel: (modelId) => {
        const targetModel = normalizedModels.find(m => m.id === modelId)
        if (!targetModel) {
          throw new Error(`Model ${modelId} not found in gateway`)
        }
        // 动态创建对应的 provider
        return createLanguageModel(targetModel)
      }
    }
  })

  return {
    providerId: 'gateway',
    provider: gatewayProvider
  }
}
```

### 4.2 Provider Extension 系统

**文件**: `packages/aiCore/src/core/providers/core/ProviderExtension.ts`

#### 核心设计

```typescript
export class ProviderExtension<
  TSettings = any,
  TStorage extends ExtensionStorage = ExtensionStorage,
  TProvider extends ProviderV3 = ProviderV3,
  TConfig extends ProviderExtensionConfig<TSettings, TStorage, TProvider> =
    ProviderExtensionConfig<TSettings, TStorage, TProvider>
> {

  // 1. LRU 缓存（settings hash → provider 实例）
  private instances: LRUCache<string, TProvider>

  constructor(public readonly config: TConfig) {
    this.instances = new LRUCache<string, TProvider>({
      max: 10,                // 最多缓存 10 个实例
      updateAgeOnGet: true    // LRU 行为
    })
  }

  // 2. 创建 provider（带缓存）
  async createProvider(
    settings?: TSettings,
    variantSuffix?: string
  ): Promise<TProvider> {

    // 2.1 合并默认配置
    const mergedSettings = this.mergeSettings(settings)

    // 2.2 计算 hash（包含 variantSuffix）
    const hash = this.computeHash(mergedSettings, variantSuffix)

    // 2.3 LRU 缓存查找
    const cachedInstance = this.instances.get(hash)
    if (cachedInstance) {
      return cachedInstance
    }

    // 2.4 缓存未命中，创建新实例
    const provider = await this.factory(mergedSettings, variantSuffix)

    // 2.5 执行生命周期钩子
    await this.lifecycle.onCreate?.(provider, mergedSettings)

    // 2.6 存入 LRU 缓存
    this.instances.set(hash, provider)

    return provider
  }

  // 3. Hash 计算（保证相同配置得到相同 hash）
  private computeHash(settings?: TSettings, variantSuffix?: string): string {
    const baseHash = (() => {
      if (settings === undefined || settings === null) {
        return 'default'
      }

      // 稳定序列化（对象键排序）
      const stableStringify = (obj: any): string => {
        if (obj === null || obj === undefined) return 'null'
        if (typeof obj !== 'object') return JSON.stringify(obj)
        if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`

        const keys = Object.keys(obj).sort()
        const pairs = keys.map(key =>
          `${JSON.stringify(key)}:${stableStringify(obj[key])}`
        )
        return `{${pairs.join(',')}}`
      }

      const serialized = stableStringify(settings)

      // 简单哈希函数
      let hash = 0
      for (let i = 0; i < serialized.length; i++) {
        const char = serialized.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash
      }

      return `${Math.abs(hash).toString(36)}`
    })()

    // 附加 variantSuffix
    return variantSuffix ? `${baseHash}:${variantSuffix}` : baseHash
  }
}
```

#### OpenAI Extension 示例

```typescript
// packages/aiCore/src/core/providers/extensions/openai.ts

export const OpenAIExtension = new ProviderExtension({
  name: 'openai',
  aliases: ['oai'],
  variants: [
    {
      suffix: 'chat',
      name: 'OpenAI Chat',
      transform: (baseProvider, settings) => {
        return customProvider({
          fallbackProvider: {
            ...baseProvider,
            languageModel: (modelId) => baseProvider.chat(modelId)
          }
        })
      }
    }
  ],

  // Factory 函数
  create: async (settings: OpenAIProviderSettings) => {
    return createOpenAI({
      apiKey: settings.apiKey,
      baseURL: settings.baseURL,
      organization: settings.organization,
      headers: settings.headers
    })
  },

  // 默认配置
  defaultSettings: {
    baseURL: 'https://api.openai.com/v1'
  },

  // 生命周期钩子
  lifecycle: {
    onCreate: async (provider, settings) => {
      console.log(`OpenAI provider created with baseURL: ${settings.baseURL}`)
    }
  }
})
```

### 4.3 Extension Registry

**文件**: `packages/aiCore/src/core/providers/core/ExtensionRegistry.ts`

```typescript
export class ExtensionRegistry {
  private extensions: Map<string, ProviderExtension<any, any, any>> = new Map()
  private aliasMap: Map<string, string> = new Map()

  // 1. 注册 extension
  register(extension: ProviderExtension<any, any, any>): this {
    const { name, aliases, variants } = extension.config

    // 注册主 ID
    this.extensions.set(name, extension)

    // 注册别名
    if (aliases) {
      for (const alias of aliases) {
        this.aliasMap.set(alias, name)
      }
    }

    // 注册变体 ID
    if (variants) {
      for (const variant of variants) {
        const variantId = `${name}-${variant.suffix}`
        this.aliasMap.set(variantId, name)
      }
    }

    return this
  }

  // 2. 创建 provider（类型安全）
  async createProvider<T extends RegisteredProviderId>(
    id: T,
    settings: CoreProviderSettingsMap[T]
  ): Promise<ProviderV3>

  async createProvider(id: string, settings?: any): Promise<ProviderV3>

  async createProvider(id: string, settings?: any): Promise<ProviderV3> {
    // 2.1 解析 ID（支持别名和变体）
    const parsed = this.parseProviderId(id)
    if (!parsed) {
      throw new Error(`Provider extension "${id}" not found`)
    }

    const { baseId, mode: variantSuffix } = parsed

    // 2.2 获取 extension
    const extension = this.get(baseId)
    if (!extension) {
      throw new Error(`Provider extension "${baseId}" not found`)
    }

    // 2.3 委托给 extension 创建
    try {
      return await extension.createProvider(settings, variantSuffix)
    } catch (error) {
      throw new ProviderCreationError(
        `Failed to create provider "${id}"`,
        id,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  // 3. 解析 providerId
  parseProviderId(providerId: string): {
    baseId: RegisteredProviderId
    mode?: string
    isVariant: boolean
  } | null {

    // 3.1 检查是否是基础 ID 或别名
    const extension = this.get(providerId)
    if (extension) {
      return {
        baseId: extension.config.name as RegisteredProviderId,
        isVariant: false
      }
    }

    // 3.2 查找变体
    for (const ext of this.extensions.values()) {
      if (!ext.config.variants) continue

      for (const variant of ext.config.variants) {
        const variantId = `${ext.config.name}-${variant.suffix}`
        if (variantId === providerId) {
          return {
            baseId: ext.config.name as RegisteredProviderId,
            mode: variant.suffix,
            isVariant: true
          }
        }
      }
    }

    return null
  }
}

// 全局单例
export const extensionRegistry = new ExtensionRegistry()
```

---

## 5. 插件与中间件系统

### 5.1 插件架构

#### AiPlugin 接口定义

**文件**: `packages/aiCore/src/core/plugins/types.ts`

```typescript
export interface AiPlugin {
  /** 插件名称 */
  name: string

  /** 请求开始前 */
  onRequestStart?: (context: PluginContext) => void | Promise<void>

  /** 转换参数（链式调用） */
  transformParams?: (
    params: any,
    context: PluginContext
  ) => any | Promise<any>

  /** 转换结果 */
  transformResult?: (
    result: any,
    context: PluginContext
  ) => any | Promise<any>

  /** 请求结束后 */
  onRequestEnd?: (context: PluginContext) => void | Promise<void>

  /** 错误处理 */
  onError?: (
    error: Error,
    context: PluginContext
  ) => void | Promise<void>
}

export interface PluginContext {
  providerId: string
  model?: string
  messages?: any[]
  tools?: any
  // experimental_context 中的自定义数据
  [key: string]: any
}
```

#### PluginEngine 实现

**文件**: `packages/aiCore/src/core/plugins/PluginEngine.ts`

```typescript
export class PluginEngine {
  constructor(
    private providerId: string,
    private plugins: AiPlugin[]
  ) {}

  // 1. 执行 onRequestStart
  async executeOnRequestStart(params: any): Promise<void> {
    const context = this.createContext(params)

    for (const plugin of this.plugins) {
      if (plugin.onRequestStart) {
        await plugin.onRequestStart(context)
      }
    }
  }

  // 2. 链式执行 transformParams
  async executeTransformParams(params: any): Promise<any> {
    let transformedParams = params
    const context = this.createContext(params)

    for (const plugin of this.plugins) {
      if (plugin.transformParams) {
        transformedParams = await plugin.transformParams(
          transformedParams,
          context
        )
      }
    }

    return transformedParams
  }

  // 3. 执行 transformResult
  async executeTransformResult(result: any, params: any): Promise<any> {
    let transformedResult = result
    const context = this.createContext(params)

    // 反向执行
    for (let i = this.plugins.length - 1; i >= 0; i--) {
      const plugin = this.plugins[i]
      if (plugin.transformResult) {
        transformedResult = await plugin.transformResult(
          transformedResult,
          context
        )
      }
    }

    return transformedResult
  }

  // 4. 执行 onRequestEnd
  async executeOnRequestEnd(params: any): Promise<void> {
    const context = this.createContext(params)

    // 反向执行
    for (let i = this.plugins.length - 1; i >= 0; i--) {
      const plugin = this.plugins[i]
      if (plugin.onRequestEnd) {
        await plugin.onRequestEnd(context)
      }
    }
  }

  // 5. 执行 onError
  async executeOnError(error: Error, params: any): Promise<void> {
    const context = this.createContext(params)

    for (const plugin of this.plugins) {
      if (plugin.onError) {
        try {
          await plugin.onError(error, context)
        } catch (pluginError) {
          console.error(`Error in plugin ${plugin.name}:`, pluginError)
        }
      }
    }
  }

  private createContext(params: any): PluginContext {
    return {
      providerId: this.providerId,
      model: params.model,
      messages: params.messages,
      tools: params.tools,
      ...params.experimental_context
    }
  }
}
```

### 5.2 内置插件

#### 5.2.1 ReasoningPlugin

**文件**: `src/renderer/src/aiCore/plugins/ReasoningPlugin.ts`

```typescript
export const ReasoningPlugin: AiPlugin = {
  name: 'ReasoningPlugin',

  transformParams: async (params, context) => {
    if (!context.enableReasoning) {
      return params
    }

    // 根据模型类型添加 reasoning 配置
    if (context.model?.includes('o1') || context.model?.includes('o3')) {
      // OpenAI o1/o3 系列
      return {
        ...params,
        reasoning_effort: context.reasoningEffort || 'medium'
      }
    } else if (context.model?.includes('claude')) {
      // Anthropic Claude 系列
      return {
        ...params,
        thinking: {
          type: 'enabled',
          budget_tokens: context.thinkingBudget || 2000
        }
      }
    } else if (context.model?.includes('qwen')) {
      // Qwen 系列
      return {
        ...params,
        experimental_providerMetadata: {
          qwen: { think_mode: true }
        }
      }
    }

    return params
  }
}
```

#### 5.2.2 ToolUsePlugin

**文件**: `src/renderer/src/aiCore/plugins/ToolUsePlugin.ts`

```typescript
export const ToolUsePlugin: AiPlugin = {
  name: 'ToolUsePlugin',

  transformParams: async (params, context) => {
    if (!context.isSupportedToolUse && !context.isPromptToolUse) {
      return params
    }

    // 1. 收集所有工具
    const tools: Record<string, CoreTool> = {}

    // 1.1 MCP 工具
    if (context.mcpTools && context.mcpTools.length > 0) {
      for (const mcpTool of context.mcpTools) {
        tools[mcpTool.name] = convertMcpToolToCoreTool(mcpTool)
      }
    }

    // 1.2 内置工具（WebSearch, GenerateImage, etc.）
    if (context.enableWebSearch) {
      tools['web_search'] = webSearchTool
    }

    if (context.enableGenerateImage) {
      tools['generate_image'] = generateImageTool
    }

    // 2. Prompt Tool Use 模式特殊处理
    if (context.isPromptToolUse) {
      return {
        ...params,
        messages: injectToolsIntoPrompt(params.messages, tools)
      }
    }

    // 3. 标准 Function Calling 模式
    return {
      ...params,
      tools,
      toolChoice: 'auto'
    }
  }
}
```

#### 5.2.3 WebSearchPlugin

**文件**: `src/renderer/src/aiCore/plugins/WebSearchPlugin.ts`

```typescript
export const WebSearchPlugin: AiPlugin = {
  name: 'WebSearchPlugin',

  transformParams: async (params, context) => {
    if (!context.enableWebSearch) {
      return params
    }

    // 添加 web search 工具
    const webSearchTool = {
      type: 'function' as const,
      function: {
        name: 'web_search',
        description: 'Search the web for current information',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            }
          },
          required: ['query']
        }
      },
      execute: async ({ query }: { query: string }) => {
        return await executeWebSearch(query, context.webSearchProviderId)
      }
    }

    return {
      ...params,
      tools: {
        ...params.tools,
        web_search: webSearchTool
      }
    }
  }
}
```

### 5.3 插件构建器

**文件**: `src/renderer/src/aiCore/plugins/PluginBuilder.ts`

```typescript
export function buildPlugins(config: AiSdkMiddlewareConfig): AiPlugin[] {
  const plugins: AiPlugin[] = []

  // 1. Reasoning Plugin
  if (config.enableReasoning) {
    plugins.push(ReasoningPlugin)
  }

  // 2. Tool Use Plugin
  if (config.isSupportedToolUse || config.isPromptToolUse) {
    plugins.push(ToolUsePlugin)
  }

  // 3. Web Search Plugin
  if (config.enableWebSearch) {
    plugins.push(WebSearchPlugin)
  }

  // 4. Image Generation Plugin
  if (config.enableGenerateImage) {
    plugins.push(ImageGenerationPlugin)
  }

  // 5. URL Context Plugin
  if (config.enableUrlContext) {
    plugins.push(UrlContextPlugin)
  }

  return plugins
}
```

---

## 6. 消息处理流程

### 6.1 消息转换

**文件**: `src/renderer/src/services/ConversationService.ts`

```typescript
export class ConversationService {

  /**
   * 准备消息用于 LLM 调用
   *
   * @returns {
   *   modelMessages: AI SDK 格式的消息
   *   uiMessages: 原始 UI 消息（用于特殊场景）
   * }
   */
  static async prepareMessagesForModel(
    messages: Message[],
    assistant: Assistant
  ): Promise<{
    modelMessages: CoreMessage[]
    uiMessages: Message[]
  }> {

    // 1. 过滤消息
    let filteredMessages = messages
      .filter(m => !m.isDeleted)
      .filter(m => m.role !== 'system')

    // 2. 应用上下文窗口限制
    const contextLimit = assistant.settings?.contextLimit || 10
    if (contextLimit > 0) {
      filteredMessages = takeRight(filteredMessages, contextLimit)
    }

    // 3. 转换为 AI SDK 格式
    const modelMessages: CoreMessage[] = []

    for (const msg of filteredMessages) {
      const converted = await this.convertMessageToAiSdk(msg, assistant)
      if (converted) {
        modelMessages.push(converted)
      }
    }

    // 4. 添加 system message
    if (assistant.prompt) {
      modelMessages.unshift({
        role: 'system',
        content: assistant.prompt
      })
    }

    return {
      modelMessages,
      uiMessages: filteredMessages
    }
  }

  /**
   * 转换单条消息
   */
  static async convertMessageToAiSdk(
    message: Message,
    assistant: Assistant
  ): Promise<CoreMessage | null> {

    switch (message.role) {
      case 'user':
        return await this.convertUserMessage(message)

      case 'assistant':
        return await this.convertAssistantMessage(message)

      case 'tool':
        return {
          role: 'tool',
          content: message.content,
          toolCallId: message.toolCallId
        }

      default:
        return null
    }
  }

  /**
   * 转换用户消息（处理多模态内容）
   */
  static async convertUserMessage(message: Message): Promise<CoreMessage> {
    const parts: Array<TextPart | ImagePart | FilePart> = []

    // 1. 处理文本内容
    const textContent = getMainTextContent(message)
    if (textContent) {
      parts.push({
        type: 'text',
        text: textContent
      })
    }

    // 2. 处理图片
    const imageBlocks = findImageBlocks(message)
    for (const block of imageBlocks) {
      const imageData = await this.loadImageData(block.image.url)
      parts.push({
        type: 'image',
        image: imageData
      })
    }

    // 3. 处理文件
    const fileBlocks = findFileBlocks(message)
    for (const block of fileBlocks) {
      const fileData = await this.loadFileData(block.file)
      parts.push({
        type: 'file',
        data: fileData,
        mimeType: block.file.mime_type
      })
    }

    return {
      role: 'user',
      content: parts
    }
  }

  /**
   * 转换助手消息（处理工具调用）
   */
  static async convertAssistantMessage(
    message: Message
  ): Promise<CoreMessage> {

    const parts: Array<TextPart | ToolCallPart> = []

    // 1. 处理文本内容
    const textContent = getMainTextContent(message)
    if (textContent) {
      parts.push({
        type: 'text',
        text: textContent
      })
    }

    // 2. 处理工具调用
    const toolCallBlocks = findToolCallBlocks(message)
    for (const block of toolCallBlocks) {
      parts.push({
        type: 'tool-call',
        toolCallId: block.toolCallId,
        toolName: block.toolName,
        args: block.args
      })
    }

    return {
      role: 'assistant',
      content: parts
    }
  }
}
```

### 6.2 流式数据适配

**文件**: `src/renderer/src/aiCore/chunk/AiSdkToChunkAdapter.ts`

```typescript
export default class AiSdkToChunkAdapter {

  constructor(
    private onChunk: (chunk: Chunk) => void,
    private mcpTools?: MCPTool[],
    private accumulate: boolean = true,
    private enableWebSearch: boolean = false
  ) {}

  /**
   * 处理 AI SDK 流式结果
   */
  async processStream(streamResult: StreamTextResult<any>): Promise<string> {
    const startTime = Date.now()
    let fullText = ''
    let firstTokenTime = 0

    try {
      // 1. 监听 textStream
      for await (const textDelta of streamResult.textStream) {
        if (!firstTokenTime) {
          firstTokenTime = Date.now()
        }

        if (this.accumulate) {
          fullText += textDelta

          // 发送文本增量 chunk
          this.onChunk({
            type: ChunkType.TEXT_DELTA,
            text: textDelta
          })
        } else {
          // 不累积，直接发送完整文本
          this.onChunk({
            type: ChunkType.TEXT,
            text: textDelta
          })
        }
      }

      // 2. 处理工具调用
      const toolCalls = streamResult.toolCalls
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          await this.handleToolCall(toolCall)
        }
      }

      // 3. 处理 reasoning/thinking
      const reasoning = streamResult.experimental_providerMetadata?.reasoning
      if (reasoning) {
        this.onChunk({
          type: ChunkType.REASONING,
          content: reasoning
        })
      }

      // 4. 发送完成 chunk
      const usage = await streamResult.usage
      const finishReason = await streamResult.finishReason

      this.onChunk({
        type: ChunkType.BLOCK_COMPLETE,
        response: {
          usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.totalTokens
          },
          metrics: {
            completion_tokens: usage.completionTokens,
            time_first_token_millsec: firstTokenTime - startTime,
            time_completion_millsec: Date.now() - startTime
          },
          finish_reason: finishReason
        }
      })

      this.onChunk({
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: {
          usage: {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.totalTokens
          }
        }
      })

      return fullText

    } catch (error) {
      this.onChunk({
        type: ChunkType.ERROR,
        error: error as Error
      })
      throw error
    }
  }

  /**
   * 处理工具调用
   */
  private async handleToolCall(toolCall: ToolCall): Promise<void> {
    // 1. 发送工具调用开始 chunk
    this.onChunk({
      type: ChunkType.TOOL_CALL,
      toolCall: {
        id: toolCall.toolCallId,
        name: toolCall.toolName,
        arguments: toolCall.args
      }
    })

    // 2. 查找工具定义
    const mcpTool = this.mcpTools?.find(t => t.name === toolCall.toolName)

    // 3. 执行工具
    try {
      let result: any

      if (mcpTool) {
        // MCP 工具
        result = await window.api.mcp.callTool(
          mcpTool.serverName,
          toolCall.toolName,
          toolCall.args
        )
      } else if (toolCall.toolName === 'web_search' && this.enableWebSearch) {
        // Web Search 工具
        result = await executeWebSearch(toolCall.args.query)
      } else {
        result = { error: `Unknown tool: ${toolCall.toolName}` }
      }

      // 4. 发送工具结果 chunk
      this.onChunk({
        type: ChunkType.TOOL_RESULT,
        toolResult: {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          result
        }
      })

    } catch (error) {
      // 5. 发送工具错误 chunk
      this.onChunk({
        type: ChunkType.TOOL_ERROR,
        toolError: {
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          error: error as Error
        }
      })
    }
  }
}
```

---

## 7. 类型安全机制

### 7.1 类型工具

**文件**: `packages/aiCore/src/core/providers/types/index.ts`

#### StringKeys<T> - 提取字符串键

```typescript
/**
 * 提取对象类型中的字符串键
 * 使用 Extract 实现简洁的类型推断
 * @example StringKeys<{ foo: 1, 0: 2 }> = 'foo'
 */
export type StringKeys<T> = Extract<keyof T, string>

// 在泛型约束中使用：
export interface RuntimeConfig<
  TSettingsMap extends Record<string, any> = CoreProviderSettingsMap,
  T extends StringKeys<TSettingsMap> = StringKeys<TSettingsMap>
> {
  providerId: T
  providerSettings: TSettingsMap[T]
}
```

### 7.2 Provider ID 解析映射

`appProviderIds` 常量提供类型安全的 provider ID 解析，**别名**和**变体**有不同的行为：

```typescript
// 别名 → 基础名（规范化）
appProviderIds['claude']           // → 'anthropic'
appProviderIds['vertexai']         // → 'google-vertex'

// 变体 → 自身（自反映射）
appProviderIds['openai-chat']      // → 'openai-chat'
appProviderIds['azure-responses']  // → 'azure-responses'
```

**设计原理**：

| 类型 | 语义 | 映射行为 |
|------|------|---------|
| 别名 (Alias) | 同一事物的另一个名字 | 规范化到基础名 ✓ |
| 变体 (Variant) | 同一 provider 的不同模式 | 自反映射 ✓ |

**类型定义**：

```typescript
// 辅助类型：提取变体 ID
type ExtractVariantIds<TConfig, TName extends string> = TConfig extends {
  variants: readonly { suffix: infer TSuffix extends string }[]
}
  ? `${TName}-${TSuffix}`
  : never

// 带条件自反映射的类型映射
export type ExtensionConfigToIdResolutionMap<TConfig> =
  TConfig extends { name: infer TName extends string }
    ? {
        readonly [K in
          | TName
          | (TConfig extends { aliases: readonly (infer TAlias extends string)[] } ? TAlias : never)
          | ExtractVariantIds<TConfig, TName>
        ]: K extends ExtractVariantIds<TConfig, TName>
          ? K      // 变体 → 自身
          : TName  // 基础名和别名 → TName
      }
    : never
```

### 7.3 Provider Settings 类型映射

**文件**: `packages/aiCore/src/core/providers/types/index.ts`

```typescript
/**
 * Core Provider Settings Map
 * 自动从 Extension 提取类型
 */
export type CoreProviderSettingsMap = UnionToIntersection<
  ExtensionToSettingsMap<(typeof coreExtensions)[number]>
>

/**
 * 结果类型（示例）：
 * {
 *   openai: OpenAIProviderSettings
 *   'openai-chat': OpenAIProviderSettings
 *   anthropic: AnthropicProviderSettings
 *   google: GoogleProviderSettings
 *   ...
 * }
 */
```

### 7.4 类型安全的 createExecutor

```typescript
// 1. 已知 provider（类型安全）
const executor = await createExecutor('openai', {
  apiKey: 'sk-xxx',      // ✅ 类型推断为 string
  baseURL: 'https://...' // ✅ 类型推断为 string | undefined
  // wrongField: 123     // ❌ 编译错误：不存在的字段
})

// 2. 动态 provider（any）
const executor = await createExecutor('custom-provider', {
  anyField: 'value'      // ✅ any 类型
})
```

### 7.3 Extension Registry 类型安全

```typescript
export class ExtensionRegistry {

  // 类型安全的函数重载
  async createProvider<
    T extends RegisteredProviderId
  >(
    id: T,
    settings: CoreProviderSettingsMap[T]
  ): Promise<ProviderV3>

  async createProvider(
    id: string,
    settings?: any
  ): Promise<ProviderV3>

  async createProvider(id: string, settings?: any): Promise<ProviderV3> {
    // 实现
  }
}

// 使用：
const provider = await extensionRegistry.createProvider('openai', {
  apiKey: 'sk-xxx',      // ✅ 类型检查
  baseURL: 'https://...'
})
```

---

## 8. Trace 和可观测性

### 8.1 OpenTelemetry 集成

#### Span 创建

**文件**: `src/renderer/src/services/SpanManagerService.ts`

```typescript
export function addSpan(params: StartSpanParams): Span | null {
  const { name, tag, topicId, modelName, inputs } = params

  // 1. 获取或创建 tracer
  const tracer = getTracer(topicId)
  if (!tracer) return null

  // 2. 创建 span
  const span = tracer.startSpan(name, {
    kind: SpanKind.CLIENT,
    attributes: {
      'llm.tag': tag,
      'llm.model': modelName,
      'llm.topic_id': topicId,
      'llm.input_messages': JSON.stringify(inputs.messages),
      'llm.temperature': inputs.temperature,
      'llm.max_tokens': inputs.maxTokens
    }
  })

  // 3. 设置 span context 为 active
  context.with(trace.setSpan(context.active(), span), () => {
    // 后续的 AI SDK 调用会自动继承这个 span
  })

  return span
}
```

#### Span 结束

```typescript
export function endSpan(params: EndSpanParams): void {
  const { topicId, span, outputs, error, modelName } = params

  if (outputs) {
    // 成功情况
    span.setAttributes({
      'llm.output_text': outputs.getText(),
      'llm.finish_reason': outputs.finishReason,
      'llm.usage.prompt_tokens': outputs.usage.promptTokens,
      'llm.usage.completion_tokens': outputs.usage.completionTokens
    })
    span.setStatus({ code: SpanStatusCode.OK })
  } else if (error) {
    // 错误情况
    span.recordException(error)
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message
    })
  }

  span.end()
}
```

### 8.2 Trace 层级结构

```
Parent Span: fetchChatCompletion
│
├─ Child Span: prepareMessagesForModel
│  └─ attributes: message_count, filters_applied
│
├─ Child Span: buildStreamTextParams
│  └─ attributes: tools_count, web_search_enabled
│
├─ Child Span: AI.completions (创建于 _completionsForTrace)
│  │
│  ├─ Child Span: buildPlugins
│  │  └─ attributes: plugin_names
│  │
│  ├─ Child Span: createExecutor
│  │  └─ attributes: provider_id, cache_hit
│  │
│  └─ Child Span: executor.streamText
│     │
│     ├─ Child Span: AI SDK doStream (自动创建)
│     │  └─ attributes: model, temperature, tokens
│     │
│     └─ Child Span: Tool Execution (如果有工具调用)
│        ├─ attributes: tool_name, args
│        └─ attributes: result, latency
│
└─ attributes: total_duration, final_token_count
```

### 8.3 Trace 导出

```typescript
// 配置 OTLP Exporter
const exporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
  headers: {
    'Authorization': 'Bearer xxx'
  }
})

// 配置 Trace Provider
const provider = new WebTracerProvider({
  resource: new Resource({
    'service.name': 'cherry-studio',
    'service.version': app.getVersion()
  })
})

provider.addSpanProcessor(
  new BatchSpanProcessor(exporter, {
    maxQueueSize: 100,
    maxExportBatchSize: 10,
    scheduledDelayMillis: 500
  })
)

provider.register()
```

---

## 9. 错误处理机制

### 9.1 错误类型层级

```typescript
// 1. Base Error
export class ProviderError extends Error {
  constructor(
    message: string,
    public providerId: string,
    public code?: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

// 2. Provider Creation Error
export class ProviderCreationError extends ProviderError {
  constructor(message: string, providerId: string, cause: Error) {
    super(message, providerId, 'PROVIDER_CREATION_FAILED', cause)
    this.name = 'ProviderCreationError'
  }
}

// 3. Model Resolution Error
export class ModelResolutionError extends ProviderError {
  constructor(
    message: string,
    public modelId: string,
    providerId: string
  ) {
    super(message, providerId, 'MODEL_RESOLUTION_FAILED')
    this.name = 'ModelResolutionError'
  }
}

// 4. API Error
export class ApiError extends ProviderError {
  constructor(
    message: string,
    providerId: string,
    public statusCode?: number,
    public response?: any
  ) {
    super(message, providerId, 'API_REQUEST_FAILED')
    this.name = 'ApiError'
  }
}
```

### 9.2 错误传播

```
RuntimeExecutor.streamText()
   │
   ├─ try {
   │    await pluginEngine.executeOnRequestStart()
   │  } catch (error) {
   │    await pluginEngine.executeOnError(error)
   │    throw error
   │  }
   │
   ├─ try {
   │    params = await pluginEngine.executeTransformParams(params)
   │  } catch (error) {
   │    await pluginEngine.executeOnError(error)
   │    throw error
   │  }
   │
   └─ try {
        const result = await aiSdk.streamText(...)
        return result
      } catch (error) {
        await pluginEngine.executeOnError(error)

        // 转换 AI SDK 错误为统一格式
        if (isAiSdkError(error)) {
          throw new ApiError(
            error.message,
            this.config.providerId,
            error.statusCode,
            error.response
          )
        }

        throw error
      }
```

### 9.3 用户友好的错误处理

**文件**: `src/renderer/src/services/ApiService.ts`

```typescript
try {
  await fetchChatCompletion({...})
} catch (error: any) {

  // 1. API Key 错误
  if (error.statusCode === 401) {
    onChunkReceived({
      type: ChunkType.ERROR,
      error: {
        message: i18n.t('error.invalid_api_key'),
        code: 'INVALID_API_KEY'
      }
    })
    return
  }

  // 2. Rate Limit
  if (error.statusCode === 429) {
    onChunkReceived({
      type: ChunkType.ERROR,
      error: {
        message: i18n.t('error.rate_limit'),
        code: 'RATE_LIMIT',
        retryAfter: error.response?.headers['retry-after']
      }
    })
    return
  }

  // 3. Abort
  if (isAbortError(error)) {
    onChunkReceived({
      type: ChunkType.ERROR,
      error: {
        message: i18n.t('error.request_aborted'),
        code: 'ABORTED'
      }
    })
    return
  }

  // 4. 通用错误
  onChunkReceived({
    type: ChunkType.ERROR,
    error: {
      message: error.message || i18n.t('error.unknown'),
      code: error.code || 'UNKNOWN_ERROR',
      details: getEnableDeveloperMode() ? error.stack : undefined
    }
  })
}
```

---

## 10. 性能优化

### 10.1 Provider 实例缓存（LRU）

**优势**:
- ✅ 避免重复创建相同配置的 provider
- ✅ 自动清理最久未使用的实例
- ✅ 内存可控（max: 10 per extension）

**性能指标**:
```
Cache Hit:  <1ms  (直接从 Map 获取)
Cache Miss: ~50ms (创建新 AI SDK provider)
```

### 10.2 并行请求优化

```typescript
// ❌ 串行执行（慢）
const mcpTools = await fetchMcpTools(assistant)
const params = await buildStreamTextParams(...)
const plugins = buildPlugins(config)

// ✅ 并行执行（快）
const [mcpTools, params, plugins] = await Promise.all([
  fetchMcpTools(assistant),
  buildStreamTextParams(...),
  Promise.resolve(buildPlugins(config))
])
```

### 10.3 流式响应优化

```typescript
// 1. 使用 textStream 而非 fullStream
for await (const textDelta of streamResult.textStream) {
  onChunk({ type: ChunkType.TEXT_DELTA, text: textDelta })
}

// 2. 批量发送 chunks（减少 IPC 开销）
const chunkBuffer: Chunk[] = []
for await (const textDelta of streamResult.textStream) {
  chunkBuffer.push({ type: ChunkType.TEXT_DELTA, text: textDelta })

  if (chunkBuffer.length >= 10) {
    onChunk({ type: ChunkType.BATCH, chunks: chunkBuffer })
    chunkBuffer.length = 0
  }
}
```

### 10.4 内存优化

```typescript
// 1. 及时清理大对象
async processStream(streamResult: StreamTextResult) {
  try {
    for await (const delta of streamResult.textStream) {
      // 处理 delta
    }
  } finally {
    // 确保流被消费完毕
    await streamResult.consumeStream()
  }
}

// 2. LRU 缓存自动淘汰
// 当缓存达到 max: 10 时，最久未使用的实例会被自动移除
```

---

## 11. 模型解析器 (ModelResolver)

### 11.1 简化后的设计

`ModelResolver` 负责将 modelId 字符串解析为 AI SDK 的模型实例。在 v2.1 版本中，我们进行了大幅简化：

**重构前** (176 行):
- 包含冗余的 `providerId`、`fallbackProviderId` 参数
- 硬编码了 OpenAI 模式选择逻辑
- 多个重复的辅助方法

**重构后** (84 行):
- 简化 API：`resolveLanguageModel(modelId, middlewares?)`
- 移除所有硬编码逻辑（由 ProviderExtension variants 处理）
- 清晰的单一职责

```typescript
export class ModelResolver {
  private provider: ProviderV3

  constructor(provider: ProviderV3) {
    this.provider = provider
  }

  /**
   * 解析语言模型
   * @param modelId - 模型ID（如 "gpt-4", "claude-3-5-sonnet"）
   * @param middlewares - 可选的中间件数组
   */
  async resolveLanguageModel(
    modelId: string,
    middlewares?: LanguageModelV3Middleware[]
  ): Promise<LanguageModelV3> {
    let model = this.provider.languageModel(modelId)
    if (middlewares && middlewares.length > 0) {
      model = wrapModelWithMiddlewares(model, middlewares)
    }
    return model
  }

  /**
   * 解析嵌入模型
   */
  async resolveEmbeddingModel(modelId: string): Promise<EmbeddingModelV3> {
    return this.provider.embeddingModel(modelId)
  }

  /**
   * 解析图像模型
   */
  async resolveImageModel(modelId: string): Promise<ImageModelV3> {
    return this.provider.imageModel(modelId)
  }
}
```

### 11.2 模式选择机制

OpenAI、Azure 等 provider 的模式选择（如 `openai-chat`、`azure-responses`）现在完全由 ProviderExtension 的 variants 机制处理：

```typescript
// ProviderExtension 定义中的 variants
const OpenAIExtension = ProviderExtension.create({
  name: 'openai',
  variants: [
    {
      suffix: 'chat',           // 产生 providerId: 'openai-chat'
      name: 'OpenAI Chat Mode',
      transform: (baseProvider, settings) => {
        return customProvider({
          fallbackProvider: {
            ...baseProvider,
            languageModel: (modelId) => baseProvider.chat(modelId)
          }
        })
      }
    }
  ],
  create: (settings) => createOpenAI(settings)
})
```

---

## 12. HubProvider 系统

### 12.1 多 Provider 路由

`HubProvider` 是一个特殊的 provider，它可以将请求路由到多个不同的底层 provider。使用命名空间格式的 modelId：

```
hub|provider|modelId
例如: aihubmix|openai|gpt-4
     aihubmix|anthropic|claude-3-5-sonnet
```

### 12.2 类型安全的配置

`HubProviderConfig` 使用 `CoreProviderSettingsMap` 确保类型安全：

```typescript
export interface HubProviderConfig {
  hubId?: string
  debug?: boolean
  registry: ExtensionRegistry
  // 类型安全的 provider 设置映射
  providerSettingsMap: Map<string, CoreProviderSettingsMap[keyof CoreProviderSettingsMap]>
}

// 使用示例
const hubProvider = await createHubProviderAsync({
  hubId: 'aihubmix',
  registry,
  providerSettingsMap: new Map([
    ['openai', { apiKey: 'sk-xxx', baseURL: 'https://...' }],    // OpenAI 设置
    ['anthropic', { apiKey: 'ant-xxx' }],                        // Anthropic 设置
    ['google', { apiKey: 'goog-xxx' }]                           // Google 设置
  ])
})
```

### 12.3 输入验证

HubProvider 现在包含严格的输入验证：

```typescript
function parseHubModelId(modelId: string): { provider: string; actualModelId: string } {
  const parts = modelId.split(DEFAULT_SEPARATOR)
  // 验证格式：必须有两部分，且都不为空
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new HubProviderError(
      `Invalid hub model ID format. Expected "provider|modelId", got: ${modelId}`,
      'unknown'
    )
  }
  return { provider: parts[0], actualModelId: parts[1] }
}
```

---

## 13. 测试架构

### 13.1 测试工具 (test-utils)

`@cherrystudio/ai-core` 提供了完整的测试工具集：

```typescript
// packages/aiCore/test_utils/helpers/model.ts

// 创建完整的 mock provider（方法是 vi.fn() spies）
export function createMockProviderV3(overrides?: {
  provider?: string
  languageModel?: (modelId: string) => LanguageModelV3
  imageModel?: (modelId: string) => ImageModelV3
  embeddingModel?: (modelId: string) => EmbeddingModelV3
}): ProviderV3

// 创建 mock 语言模型（包含完整的 doGenerate/doStream 实现）
export function createMockLanguageModel(overrides?: Partial<LanguageModelV3>): LanguageModelV3

// 创建 mock 图像模型
export function createMockImageModel(overrides?: Partial<ImageModelV3>): ImageModelV3

// 创建 mock 嵌入模型
export function createMockEmbeddingModel(overrides?: Partial<EmbeddingModelV3>): EmbeddingModelV3
```

### 13.2 集成测试

HubProvider 集成测试覆盖以下场景：

```typescript
// packages/aiCore/src/core/providers/__tests__/HubProvider.integration.test.ts

describe('HubProvider Integration Tests', () => {
  // 1. 端到端测试
  describe('End-to-End with RuntimeExecutor', () => {
    it('should resolve models through HubProvider using namespace format')
    it('should handle multiple providers in the same hub')
    it('should work with direct model objects instead of strings')
  })

  // 2. LRU 缓存测试
  describe('ProviderExtension LRU Cache Integration', () => {
    it('should leverage ProviderExtension LRU cache when creating multiple HubProviders')
    it('should create new providers when settings differ')
  })

  // 3. 错误处理测试
  describe('Error Handling Integration', () => {
    it('should throw error when using provider not in providerSettingsMap')
    it('should throw error on invalid model ID format')
  })

  // 4. 高级场景
  describe('Advanced Scenarios', () => {
    it('should support image generation through hub')
    it('should handle concurrent model resolutions')
    it('should work with middlewares')
  })
})
```

### 13.3 测试覆盖率

当前测试覆盖：
- **ModelResolver**: 20 个测试用例
- **HubProvider 单元测试**: 26 个测试用例
- **HubProvider 集成测试**: 17 个测试用例
- **ExtensionRegistry**: 68 个测试用例
- **PluginEngine**: 38 个测试用例
- **总计**: 376+ 个测试用例

---

## 附录 A: 关键文件索引

### Service Layer
- `src/renderer/src/services/ApiService.ts` - 主要 API 服务
- `src/renderer/src/services/ConversationService.ts` - 消息准备
- `src/renderer/src/services/SpanManagerService.ts` - Trace 管理

### AI Provider Layer
- `src/renderer/src/aiCore/index_new.ts` - ModernAiProvider
- `src/renderer/src/aiCore/provider/providerConfig.ts` - Provider 配置
- `src/renderer/src/aiCore/chunk/AiSdkToChunkAdapter.ts` - 流式适配
- `src/renderer/src/aiCore/plugins/PluginBuilder.ts` - 插件构建

### Core Package
- `packages/aiCore/src/core/runtime/executor.ts` - RuntimeExecutor
- `packages/aiCore/src/core/runtime/index.ts` - createExecutor
- `packages/aiCore/src/core/providers/core/ProviderExtension.ts` - Extension 基类
- `packages/aiCore/src/core/providers/core/ExtensionRegistry.ts` - 注册表
- `packages/aiCore/src/core/models/ModelResolver.ts` - 模型解析
- `packages/aiCore/src/core/plugins/PluginEngine.ts` - 插件引擎

### Extensions
- `packages/aiCore/src/core/providers/extensions/openai.ts` - OpenAI Extension
- `packages/aiCore/src/core/providers/extensions/anthropic.ts` - Anthropic Extension
- `packages/aiCore/src/core/providers/extensions/google.ts` - Google Extension

### Features
- `packages/aiCore/src/core/providers/features/HubProvider.ts` - Hub Provider 实现

### Test Utilities
- `packages/aiCore/test_utils/helpers/model.ts` - Mock 模型创建工具
- `packages/aiCore/test_utils/helpers/provider.ts` - Provider 测试辅助
- `packages/aiCore/test_utils/mocks/providers.ts` - Mock Provider 实例
- `packages/aiCore/src/core/providers/__tests__/HubProvider.integration.test.ts` - 集成测试

---

## 附录 B: 常见问题

### Q1: 为什么要用 LRU 缓存？
**A**: 避免为相同配置重复创建 provider，同时自动控制内存（最多 10 个实例/extension）。

### Q2: Plugin 和 Middleware 有什么区别？
**A**:
- **Plugin**: Cherry Studio 层面的功能扩展（Reasoning, ToolUse, WebSearch）
- **Middleware**: AI SDK 层面的请求/响应拦截器

### Q3: 什么时候用 Legacy Provider？
**A**: 仅在图像生成端点且非 gateway 时使用，因为需要图片编辑等高级功能。

### Q4: 如何添加新的 Provider？
**A**:
1. 在 `packages/aiCore/src/core/providers/extensions/` 创建 Extension
2. 注册到 `coreExtensions` 数组
3. 在 `providerConfig.ts` 添加配置转换逻辑

---

**文档版本**: v2.2
**最后更新**: 2026-01-02
**维护者**: Cherry Studio Team
