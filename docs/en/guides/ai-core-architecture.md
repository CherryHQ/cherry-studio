# Cherry Studio AI Core Architecture Documentation

> **Version**: v2.1 (ModelResolver Simplification + HubProvider Type Safety)
> **Updated**: 2026-01-02
> **Applicable to**: Cherry Studio v1.7.7+

This document describes the complete data flow and architectural design from user interaction to AI SDK calls in Cherry Studio. It serves as the key documentation for understanding the application's core functionality.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Complete Call Flow](#2-complete-call-flow)
3. [Core Components](#3-core-components)
4. [Provider System Architecture](#4-provider-system-architecture)
5. [Plugin and Middleware System](#5-plugin-and-middleware-system)
6. [Message Processing Flow](#6-message-processing-flow)
7. [Type Safety Mechanisms](#7-type-safety-mechanisms)
8. [Tracing and Observability](#8-tracing-and-observability)
9. [Error Handling](#9-error-handling)
10. [Performance Optimization](#10-performance-optimization)
11. [Model Resolver](#11-model-resolver)
12. [HubProvider System](#12-hubprovider-system)
13. [Testing Architecture](#13-testing-architecture)

---

## 1. Architecture Overview

### 1.1 Architectural Layers

Cherry Studio's AI calls follow a clear layered architecture:

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
│                   LLM Provider API                          │
│  (OpenAI, Anthropic, Google, etc.)                          │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Core Design Principles

#### 1.2.1 Separation of Concerns

- **Service Layer**: Business logic, message preparation, tool invocation
- **AI Provider Layer**: Provider adaptation, parameter conversion, plugin building
- **Core Package**: Unified API, provider management, plugin execution
- **AI SDK Layer**: Actual LLM API calls

#### 1.2.2 Type Safety First

- End-to-end TypeScript type inference
- Automatic Provider Settings association
- Compile-time parameter validation

#### 1.2.3 Extensibility

- Plugin architecture (AiPlugin)
- Provider Extension system
- Middleware mechanism

---

## 2. Complete Call Flow

### 2.1 Full Flow from User Input to LLM Response

#### Flow Diagram

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
│    ├─ Message format conversion (UI Message → Model Message) │
│    ├─ Process image/file attachments                         │
│    └─ Apply message filtering rules                          │
│                                                               │
│    Step 2.2: replacePromptVariables()                        │
│    └─ Replace variables in system prompt                     │
│                                                               │
│    Step 2.3: injectUserMessageWithKnowledgeSearchPrompt()    │
│    └─ Inject knowledge base search prompt (if enabled)       │
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
│    ├─ Get provider configuration                             │
│    ├─ Apply API key rotation (multi-key load balancing)      │
│    └─ Create providerWithRotatedKey                          │
│                                                               │
│    Step 3.2: new ModernAiProvider(model, provider)           │
│    └─ Initialize AI Provider instance                        │
│                                                               │
│    Step 3.3: buildStreamTextParams()                         │
│    ├─ Build AI SDK parameters                                │
│    ├─ Process MCP tools                                      │
│    ├─ Process Web Search configuration                       │
│    └─ Return aiSdkParams + capabilities                      │
│                                                               │
│    Step 3.4: buildPlugins(middlewareConfig)                  │
│    └─ Build plugin array based on capabilities               │
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
│    ├─ Convert Cherry Provider → AI SDK Config                │
│    ├─ Set providerId ('openai', 'anthropic', etc.)           │
│    └─ Set providerSettings (apiKey, baseURL, etc.)           │
│                                                               │
│    Step 4.2: Claude Code OAuth special handling              │
│    └─ Inject Claude Code system message (if OAuth)           │
│                                                               │
│    Step 4.3: Routing selection                               │
│    ├─ If trace enabled → _completionsForTrace()              │
│    └─ Otherwise → _completionsOrImageGeneration()            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. ModernAiProvider._completionsOrImageGeneration()          │
│    Location: src/renderer/src/aiCore/index_new.ts:167        │
│                                                               │
│    Decision:                                                  │
│    ├─ Image generation endpoint → legacyProvider.completions()│
│    └─ Text generation → modernCompletions() ───────────────► │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. ModernAiProvider.modernCompletions()                      │
│    Location: src/renderer/src/aiCore/index_new.ts:284        │
│                                                               │
│    Step 6.1: buildPlugins(config)                            │
│    └─ Build plugin array (Reasoning, ToolUse, WebSearch, etc.)│
│                                                               │
│    Step 6.2: createExecutor() ─────────────────────────────► │
│    └─ Create RuntimeExecutor instance                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. packages/aiCore: createExecutor()                         │
│    Location: packages/aiCore/src/core/runtime/index.ts:25    │
│                                                               │
│    Step 7.1: extensionRegistry.createProvider()              │
│    ├─ Parse providerId (supports aliases and variants)       │
│    ├─ Get ProviderExtension instance                         │
│    ├─ Compute settings hash                                  │
│    ├─ LRU cache lookup                                       │
│    │  ├─ Cache hit → Return cached instance                  │
│    │  └─ Cache miss → Create new instance                    │
│    └─ Return ProviderV3 instance                             │
│                                                               │
│    Step 7.2: RuntimeExecutor.create()                        │
│    ├─ Create RuntimeExecutor instance                        │
│    ├─ Inject provider reference                              │
│    ├─ Initialize ModelResolver                               │
│    └─ Initialize PluginEngine                                │
│                                                               │
│    Return: RuntimeExecutor<T> instance ────────────────────► │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. RuntimeExecutor.streamText()                              │
│    Location: packages/aiCore/src/core/runtime/executor.ts    │
│                                                               │
│    Step 8.1: Plugin lifecycle - onRequestStart               │
│    └─ Execute all plugins' onRequestStart hooks              │
│                                                               │
│    Step 8.2: Plugin transform - transformParams              │
│    └─ Chain execute all plugins' parameter transformations   │
│                                                               │
│    Step 8.3: modelResolver.resolveModel()                    │
│    └─ Parse model string → LanguageModel instance            │
│                                                               │
│    Step 8.4: Call AI SDK streamText() ─────────────────────►│
│    └─ Pass resolved model and transformed params             │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. AI SDK: streamText()                                      │
│    Location: node_modules/ai/core/generate-text/stream-text  │
│                                                               │
│    Step 9.1: Parameter validation                            │
│    Step 9.2: Call provider.doStream()                        │
│    Step 9.3: Return StreamTextResult                         │
│    └─ textStream, fullStream, usage, etc.                    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. Stream Data Processing                                   │
│     Location: src/renderer/src/aiCore/chunk/                 │
│                                                               │
│     Step 10.1: AiSdkToChunkAdapter.processStream()           │
│     ├─ Listen to AI SDK's textStream                         │
│     ├─ Convert to Cherry Chunk format                        │
│     ├─ Process tool calls                                    │
│     ├─ Process reasoning blocks                              │
│     └─ Send chunk to onChunkReceived callback                │
│                                                               │
│     Step 10.2: StreamProcessingService                       │
│     └─ Process different chunk types and update UI           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 11. Plugin Lifecycle - Completion Phase                      │
│                                                               │
│     Step 11.1: transformResult                               │
│     └─ Plugins can modify final result                       │
│                                                               │
│     Step 11.2: onRequestEnd                                  │
│     └─ Execute all plugins' completion hooks                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 12. UI Update                                                │
│     - Redux state update                                     │
│     - React component re-render                              │
│     - Display complete response                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Key Timing Notes

#### 2.2.1 Provider Instance Creation (LRU Cache Mechanism)

```typescript
// Scenario 1: First OpenAI request (Cache Miss)
const executor1 = await createExecutor('openai', { apiKey: 'sk-xxx' })
// → extensionRegistry.createProvider('openai', { apiKey: 'sk-xxx' })
// → Compute hash: "abc123"
// → LRU cache miss
// → OpenAIExtension.factory() creates new provider
// → Store in LRU: cache.set("abc123", provider)

// Scenario 2: Second request with same config (Cache Hit)
const executor2 = await createExecutor('openai', { apiKey: 'sk-xxx' })
// → Compute hash: "abc123" (same)
// → LRU cache hit!
// → Return cached provider directly
// → executor1 and executor2 share the same provider instance

// Scenario 3: Different config (Cache Miss + New Instance)
const executor3 = await createExecutor('openai', {
  apiKey: 'sk-yyy',  // different key
  baseURL: 'https://custom.com/v1'
})
// → Compute hash: "def456" (different)
// → LRU cache miss
// → Create new independent provider instance
// → Store in LRU: cache.set("def456", provider2)
```

#### 2.2.2 Plugin Execution Order

```typescript
// Example: Reasoning + ToolUse + WebSearch enabled
plugins = [ReasoningPlugin, ToolUsePlugin, WebSearchPlugin]

// Execution order:
1. onRequestStart:    Reasoning → ToolUse → WebSearch
2. transformParams:   Reasoning → ToolUse → WebSearch (chain)
3. [AI SDK call]
4. transformResult:   WebSearch → ToolUse → Reasoning (reverse)
5. onRequestEnd:      WebSearch → ToolUse → Reasoning (reverse)
```

---

## 3. Core Components

### 3.1 ApiService Layer

#### File Location
`src/renderer/src/services/ApiService.ts`

#### Core Responsibilities

1. **Message preparation and conversion**
2. **MCP tool integration**
3. **Knowledge base search injection**
4. **API Key rotation**
5. **Call ModernAiProvider**

#### Key Function Details

##### 3.1.1 `transformMessagesAndFetch()`

**Signature**:
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

**Execution Flow**:

```typescript
// Step 1: Message preparation
const { modelMessages, uiMessages } =
  await ConversationService.prepareMessagesForModel(messages, assistant)

// modelMessages: Converted to LLM-understandable format
// uiMessages: Original UI messages (for special scenarios)

// Step 2: Replace prompt variables
assistant.prompt = await replacePromptVariables(
  assistant.prompt,
  assistant.model?.name
)
// e.g.: "{model_name}" → "GPT-4"

// Step 3: Inject knowledge base search
await injectUserMessageWithKnowledgeSearchPrompt({
  modelMessages,
  assistant,
  assistantMsgId,
  topicId,
  blockManager,
  setCitationBlockId
})

// Step 4: Make actual request
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

**Key Code Analysis**:

```typescript
export async function fetchChatCompletion({
  messages,
  assistant,
  requestOptions,
  onChunkReceived,
  topicId,
  uiMessages
}: FetchChatCompletionParams) {

  // 1. Provider preparation + API Key rotation
  const baseProvider = getProviderByModel(assistant.model || getDefaultModel())
  const providerWithRotatedKey = {
    ...baseProvider,
    apiKey: getRotatedApiKey(baseProvider)  // ✅ Multi-key load balancing
  }

  // 2. Create AI Provider instance
  const AI = new ModernAiProvider(
    assistant.model || getDefaultModel(),
    providerWithRotatedKey
  )

  // 3. Get MCP tools
  const mcpTools: MCPTool[] = []
  if (isPromptToolUse(assistant) || isSupportedToolUse(assistant)) {
    mcpTools.push(...(await fetchMcpTools(assistant)))
  }

  // 4. Build AI SDK parameters
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

  // 5. Build middleware configuration
  const middlewareConfig: AiSdkMiddlewareConfig = {
    streamOutput: assistant.settings?.streamOutput ?? true,
    onChunk: onChunkReceived,
    model: assistant.model,
    enableReasoning: capabilities.enableReasoning,
    isPromptToolUse: usePromptToolUse,
    isSupportedToolUse: isSupportedToolUse(assistant),
    isImageGenerationEndpoint: isDedicatedImageGenerationModel(assistant.model),
    webSearchPluginConfig,
    enableWebSearch: capabilities.enableWebSearch,
    enableGenerateImage: capabilities.enableGenerateImage,
    enableUrlContext: capabilities.enableUrlContext,
    mcpTools,
    uiMessages,
    knowledgeRecognition: assistant.knowledgeRecognition
  }

  // 6. Call AI.completions()
  await AI.completions(modelId, aiSdkParams, {
    ...middlewareConfig,
    assistant,
    topicId,
    callType: 'chat',
    uiMessages
  })
}
```

**API Key Rotation Mechanism**:

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

// Usage scenario:
// provider.apiKey = "sk-key1,sk-key2,sk-key3"
// Request 1 → use sk-key1
// Request 2 → use sk-key2
// Request 3 → use sk-key3
// Request 4 → use sk-key1 (cycle)
```

### 3.2 ModernAiProvider Layer

#### File Location
`src/renderer/src/aiCore/index_new.ts`

#### Core Responsibilities

1. **Provider configuration conversion** (Cherry Provider → AI SDK Config)
2. **Plugin building** (based on capabilities)
3. **Trace integration** (OpenTelemetry)
4. **Call RuntimeExecutor**
5. **Stream data adaptation** (AI SDK Stream → Cherry Chunk)

#### Constructor Details

```typescript
constructor(modelOrProvider: Model | Provider, provider?: Provider) {
  if (this.isModel(modelOrProvider)) {
    // Case 1: new ModernAiProvider(model, provider)
    this.model = modelOrProvider
    this.actualProvider = provider
      ? adaptProvider({ provider, model: modelOrProvider })
      : getActualProvider(modelOrProvider)

    // Sync or async config creation
    const configOrPromise = providerToAiSdkConfig(
      this.actualProvider,
      modelOrProvider
    )
    this.config = configOrPromise instanceof Promise
      ? undefined
      : configOrPromise
  } else {
    // Case 2: new ModernAiProvider(provider)
    this.actualProvider = adaptProvider({ provider: modelOrProvider })
  }

  this.legacyProvider = new LegacyAiProvider(this.actualProvider)
}
```

#### completions() Method Details

```typescript
public async completions(
  modelId: string,
  params: StreamTextParams,
  providerConfig: ModernAiProviderConfig
) {
  // 1. Ensure config is ready
  if (!this.config) {
    this.config = await Promise.resolve(
      providerToAiSdkConfig(this.actualProvider, this.model!)
    )
  }

  // 2. Claude Code OAuth special handling
  if (this.actualProvider.id === 'anthropic' &&
      this.actualProvider.authType === 'oauth') {
    const claudeCodeSystemMessage = buildClaudeCodeSystemModelMessage(
      params.system
    )
    params.system = undefined
    params.messages = [...claudeCodeSystemMessage, ...(params.messages || [])]
  }

  // 3. Routing selection
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

#### modernCompletions() Core Implementation

```typescript
private async modernCompletions(
  modelId: string,
  params: StreamTextParams,
  config: ModernAiProviderConfig
): Promise<CompletionsResult> {

  // 1. Build plugins
  const plugins = buildPlugins(config)

  // 2. Create RuntimeExecutor
  const executor = await createExecutor(
    this.config!.providerId,
    this.config!.providerSettings,
    plugins
  )

  // 3. Streaming call
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
    // Non-streaming call
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

---

## 4. Provider System Architecture

### 4.1 Provider Configuration Conversion

#### providerToAiSdkConfig() Details

**File**: `src/renderer/src/aiCore/provider/providerConfig.ts`

```typescript
export function providerToAiSdkConfig(
  provider: Provider,
  model?: Model
): ProviderConfig | Promise<ProviderConfig> {

  // 1. Route to specific implementation based on provider.id
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
      // Special handling: gateway requires async creation
      return createGatewayConfig(provider, model)

    // ... other providers
  }
}
```

### 4.2 Provider Extension System

**File**: `packages/aiCore/src/core/providers/core/ProviderExtension.ts`

#### Core Design

```typescript
export class ProviderExtension<
  TSettings = any,
  TStorage extends ExtensionStorage = ExtensionStorage,
  TProvider extends ProviderV3 = ProviderV3,
  TConfig extends ProviderExtensionConfig<TSettings, TStorage, TProvider> =
    ProviderExtensionConfig<TSettings, TStorage, TProvider>
> {

  // 1. LRU cache (settings hash → provider instance)
  private instances: LRUCache<string, TProvider>

  constructor(public readonly config: TConfig) {
    this.instances = new LRUCache<string, TProvider>({
      max: 10,                // Cache up to 10 instances
      updateAgeOnGet: true    // LRU behavior
    })
  }

  // 2. Create provider (with caching)
  async createProvider(
    settings?: TSettings,
    variantSuffix?: string
  ): Promise<TProvider> {

    // 2.1 Merge default configuration
    const mergedSettings = this.mergeSettings(settings)

    // 2.2 Compute hash (including variantSuffix)
    const hash = this.computeHash(mergedSettings, variantSuffix)

    // 2.3 LRU cache lookup
    const cachedInstance = this.instances.get(hash)
    if (cachedInstance) {
      return cachedInstance
    }

    // 2.4 Cache miss, create new instance
    const provider = await this.factory(mergedSettings, variantSuffix)

    // 2.5 Execute lifecycle hooks
    await this.lifecycle.onCreate?.(provider, mergedSettings)

    // 2.6 Store in LRU cache
    this.instances.set(hash, provider)

    return provider
  }

  // 3. Hash computation (ensures same config gets same hash)
  private computeHash(settings?: TSettings, variantSuffix?: string): string {
    const baseHash = (() => {
      if (settings === undefined || settings === null) {
        return 'default'
      }

      // Stable serialization (sort object keys)
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

      // Simple hash function
      let hash = 0
      for (let i = 0; i < serialized.length; i++) {
        const char = serialized.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash
      }

      return `${Math.abs(hash).toString(36)}`
    })()

    // Append variantSuffix
    return variantSuffix ? `${baseHash}:${variantSuffix}` : baseHash
  }
}
```

### 4.3 Extension Registry

**File**: `packages/aiCore/src/core/providers/core/ExtensionRegistry.ts`

```typescript
export class ExtensionRegistry {
  private extensions: Map<string, ProviderExtension<any, any, any>> = new Map()
  private aliasMap: Map<string, string> = new Map()

  // 1. Register extension
  register(extension: ProviderExtension<any, any, any>): this {
    const { name, aliases, variants } = extension.config

    // Register primary ID
    this.extensions.set(name, extension)

    // Register aliases
    if (aliases) {
      for (const alias of aliases) {
        this.aliasMap.set(alias, name)
      }
    }

    // Register variant IDs
    if (variants) {
      for (const variant of variants) {
        const variantId = `${name}-${variant.suffix}`
        this.aliasMap.set(variantId, name)
      }
    }

    return this
  }

  // 2. Create provider (type-safe)
  async createProvider<T extends RegisteredProviderId & keyof CoreProviderSettingsMap>(
    id: T,
    settings: CoreProviderSettingsMap[T]
  ): Promise<ProviderV3>

  async createProvider(id: string, settings?: any): Promise<ProviderV3>

  async createProvider(id: string, settings?: any): Promise<ProviderV3> {
    // 2.1 Parse ID (supports aliases and variants)
    const parsed = this.parseProviderId(id)
    if (!parsed) {
      throw new Error(`Provider extension "${id}" not found`)
    }

    const { baseId, mode: variantSuffix } = parsed

    // 2.2 Get extension
    const extension = this.get(baseId)
    if (!extension) {
      throw new Error(`Provider extension "${baseId}" not found`)
    }

    // 2.3 Delegate to extension for creation
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
}

// Global singleton
export const extensionRegistry = new ExtensionRegistry()
```

---

## 5. Plugin and Middleware System

### 5.1 Plugin Architecture

#### AiPlugin Interface Definition

**File**: `packages/aiCore/src/core/plugins/types.ts`

```typescript
export interface AiPlugin {
  /** Plugin name */
  name: string

  /** Before request starts */
  onRequestStart?: (context: PluginContext) => void | Promise<void>

  /** Transform parameters (chained call) */
  transformParams?: (
    params: any,
    context: PluginContext
  ) => any | Promise<any>

  /** Transform result */
  transformResult?: (
    result: any,
    context: PluginContext
  ) => any | Promise<any>

  /** After request ends */
  onRequestEnd?: (context: PluginContext) => void | Promise<void>

  /** Error handling */
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
  // Custom data from experimental_context
  [key: string]: any
}
```

#### PluginEngine Implementation

**File**: `packages/aiCore/src/core/plugins/PluginEngine.ts`

```typescript
export class PluginEngine {
  constructor(
    private providerId: string,
    private plugins: AiPlugin[]
  ) {}

  // 1. Execute onRequestStart
  async executeOnRequestStart(params: any): Promise<void> {
    const context = this.createContext(params)

    for (const plugin of this.plugins) {
      if (plugin.onRequestStart) {
        await plugin.onRequestStart(context)
      }
    }
  }

  // 2. Chain execute transformParams
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

  // 3. Execute transformResult
  async executeTransformResult(result: any, params: any): Promise<any> {
    let transformedResult = result
    const context = this.createContext(params)

    // Execute in reverse order
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

  // 4. Execute onRequestEnd
  async executeOnRequestEnd(params: any): Promise<void> {
    const context = this.createContext(params)

    // Execute in reverse order
    for (let i = this.plugins.length - 1; i >= 0; i--) {
      const plugin = this.plugins[i]
      if (plugin.onRequestEnd) {
        await plugin.onRequestEnd(context)
      }
    }
  }
}
```

### 5.2 Built-in Plugins

#### 5.2.1 ReasoningPlugin

**File**: `src/renderer/src/aiCore/plugins/ReasoningPlugin.ts`

```typescript
export const ReasoningPlugin: AiPlugin = {
  name: 'ReasoningPlugin',

  transformParams: async (params, context) => {
    if (!context.enableReasoning) {
      return params
    }

    // Add reasoning configuration based on model type
    if (context.model?.includes('o1') || context.model?.includes('o3')) {
      // OpenAI o1/o3 series
      return {
        ...params,
        reasoning_effort: context.reasoningEffort || 'medium'
      }
    } else if (context.model?.includes('claude')) {
      // Anthropic Claude series
      return {
        ...params,
        thinking: {
          type: 'enabled',
          budget_tokens: context.thinkingBudget || 2000
        }
      }
    } else if (context.model?.includes('qwen')) {
      // Qwen series
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

**File**: `src/renderer/src/aiCore/plugins/ToolUsePlugin.ts`

```typescript
export const ToolUsePlugin: AiPlugin = {
  name: 'ToolUsePlugin',

  transformParams: async (params, context) => {
    if (!context.isSupportedToolUse && !context.isPromptToolUse) {
      return params
    }

    // 1. Collect all tools
    const tools: Record<string, CoreTool> = {}

    // 1.1 MCP tools
    if (context.mcpTools && context.mcpTools.length > 0) {
      for (const mcpTool of context.mcpTools) {
        tools[mcpTool.name] = convertMcpToolToCoreTool(mcpTool)
      }
    }

    // 1.2 Built-in tools (WebSearch, GenerateImage, etc.)
    if (context.enableWebSearch) {
      tools['web_search'] = webSearchTool
    }

    if (context.enableGenerateImage) {
      tools['generate_image'] = generateImageTool
    }

    // 2. Prompt Tool Use mode special handling
    if (context.isPromptToolUse) {
      return {
        ...params,
        messages: injectToolsIntoPrompt(params.messages, tools)
      }
    }

    // 3. Standard Function Calling mode
    return {
      ...params,
      tools,
      toolChoice: 'auto'
    }
  }
}
```

---

## 6. Message Processing Flow

### 6.1 Message Conversion

**File**: `src/renderer/src/services/ConversationService.ts`

```typescript
export class ConversationService {

  /**
   * Prepare messages for LLM call
   *
   * @returns {
   *   modelMessages: AI SDK format messages
   *   uiMessages: Original UI messages (for special scenarios)
   * }
   */
  static async prepareMessagesForModel(
    messages: Message[],
    assistant: Assistant
  ): Promise<{
    modelMessages: CoreMessage[]
    uiMessages: Message[]
  }> {

    // 1. Filter messages
    let filteredMessages = messages
      .filter(m => !m.isDeleted)
      .filter(m => m.role !== 'system')

    // 2. Apply context window limit
    const contextLimit = assistant.settings?.contextLimit || 10
    if (contextLimit > 0) {
      filteredMessages = takeRight(filteredMessages, contextLimit)
    }

    // 3. Convert to AI SDK format
    const modelMessages: CoreMessage[] = []

    for (const msg of filteredMessages) {
      const converted = await this.convertMessageToAiSdk(msg, assistant)
      if (converted) {
        modelMessages.push(converted)
      }
    }

    // 4. Add system message
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
}
```

### 6.2 Stream Data Adaptation

**File**: `src/renderer/src/aiCore/chunk/AiSdkToChunkAdapter.ts`

```typescript
export default class AiSdkToChunkAdapter {

  constructor(
    private onChunk: (chunk: Chunk) => void,
    private mcpTools?: MCPTool[],
    private accumulate: boolean = true,
    private enableWebSearch: boolean = false
  ) {}

  /**
   * Process AI SDK streaming result
   */
  async processStream(streamResult: StreamTextResult<any>): Promise<string> {
    const startTime = Date.now()
    let fullText = ''
    let firstTokenTime = 0

    try {
      // 1. Listen to textStream
      for await (const textDelta of streamResult.textStream) {
        if (!firstTokenTime) {
          firstTokenTime = Date.now()
        }

        if (this.accumulate) {
          fullText += textDelta

          // Send text delta chunk
          this.onChunk({
            type: ChunkType.TEXT_DELTA,
            text: textDelta
          })
        } else {
          // Don't accumulate, send complete text
          this.onChunk({
            type: ChunkType.TEXT,
            text: textDelta
          })
        }
      }

      // 2. Process tool calls
      const toolCalls = streamResult.toolCalls
      if (toolCalls && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          await this.handleToolCall(toolCall)
        }
      }

      // 3. Process reasoning/thinking
      const reasoning = streamResult.experimental_providerMetadata?.reasoning
      if (reasoning) {
        this.onChunk({
          type: ChunkType.REASONING,
          content: reasoning
        })
      }

      // 4. Send completion chunk
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

      return fullText

    } catch (error) {
      this.onChunk({
        type: ChunkType.ERROR,
        error: error as Error
      })
      throw error
    }
  }
}
```

---

## 7. Type Safety Mechanisms

### 7.1 Provider Settings Type Mapping

**File**: `packages/aiCore/src/core/providers/types/index.ts`

```typescript
/**
 * Core Provider Settings Map
 * Automatically extracts types from Extensions
 */
export type CoreProviderSettingsMap = UnionToIntersection<
  ExtensionToSettingsMap<(typeof coreExtensions)[number]>
>

/**
 * Result type (example):
 * {
 *   openai: OpenAIProviderSettings
 *   'openai-chat': OpenAIProviderSettings
 *   anthropic: AnthropicProviderSettings
 *   google: GoogleProviderSettings
 *   ...
 * }
 */
```

### 7.2 Type-Safe createExecutor

```typescript
// 1. Known provider (type-safe)
const executor = await createExecutor('openai', {
  apiKey: 'sk-xxx',      // ✅ Type inferred as string
  baseURL: 'https://...' // ✅ Type inferred as string | undefined
  // wrongField: 123     // ❌ Compile error: unknown field
})

// 2. Dynamic provider (any)
const executor = await createExecutor('custom-provider', {
  anyField: 'value'      // ✅ any type
})
```

---

## 8. Tracing and Observability

### 8.1 OpenTelemetry Integration

#### Span Creation

**File**: `src/renderer/src/services/SpanManagerService.ts`

```typescript
export function addSpan(params: StartSpanParams): Span | null {
  const { name, tag, topicId, modelName, inputs } = params

  // 1. Get or create tracer
  const tracer = getTracer(topicId)
  if (!tracer) return null

  // 2. Create span
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

  // 3. Set span context as active
  context.with(trace.setSpan(context.active(), span), () => {
    // Subsequent AI SDK calls will automatically inherit this span
  })

  return span
}
```

### 8.2 Trace Hierarchy Structure

```
Parent Span: fetchChatCompletion
│
├─ Child Span: prepareMessagesForModel
│  └─ attributes: message_count, filters_applied
│
├─ Child Span: buildStreamTextParams
│  └─ attributes: tools_count, web_search_enabled
│
├─ Child Span: AI.completions (created in _completionsForTrace)
│  │
│  ├─ Child Span: buildPlugins
│  │  └─ attributes: plugin_names
│  │
│  ├─ Child Span: createExecutor
│  │  └─ attributes: provider_id, cache_hit
│  │
│  └─ Child Span: executor.streamText
│     │
│     ├─ Child Span: AI SDK doStream (auto-created)
│     │  └─ attributes: model, temperature, tokens
│     │
│     └─ Child Span: Tool Execution (if tool calls exist)
│        ├─ attributes: tool_name, args
│        └─ attributes: result, latency
│
└─ attributes: total_duration, final_token_count
```

---

## 9. Error Handling

### 9.1 Error Type Hierarchy

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

---

## 10. Performance Optimization

### 10.1 Provider Instance Caching (LRU)

**Advantages**:
- ✅ Avoid recreating providers with same configuration
- ✅ Automatically clean up least recently used instances
- ✅ Memory controlled (max: 10 per extension)

**Performance Metrics**:
```
Cache Hit:  <1ms  (direct Map retrieval)
Cache Miss: ~50ms (create new AI SDK provider)
```

### 10.2 Parallel Request Optimization

```typescript
// ❌ Sequential execution (slow)
const mcpTools = await fetchMcpTools(assistant)
const params = await buildStreamTextParams(...)
const plugins = buildPlugins(config)

// ✅ Parallel execution (fast)
const [mcpTools, params, plugins] = await Promise.all([
  fetchMcpTools(assistant),
  buildStreamTextParams(...),
  Promise.resolve(buildPlugins(config))
])
```

### 10.3 Streaming Response Optimization

```typescript
// 1. Use textStream instead of fullStream
for await (const textDelta of streamResult.textStream) {
  onChunk({ type: ChunkType.TEXT_DELTA, text: textDelta })
}

// 2. Batch send chunks (reduce IPC overhead)
const chunkBuffer: Chunk[] = []
for await (const textDelta of streamResult.textStream) {
  chunkBuffer.push({ type: ChunkType.TEXT_DELTA, text: textDelta })

  if (chunkBuffer.length >= 10) {
    onChunk({ type: ChunkType.BATCH, chunks: chunkBuffer })
    chunkBuffer.length = 0
  }
}
```

---

## 11. Model Resolver

### 11.1 Simplified Design

`ModelResolver` is responsible for parsing modelId strings into AI SDK model instances. In v2.1, we significantly simplified this:

**Before Refactoring** (176 lines):
- Redundant `providerId`, `fallbackProviderId` parameters
- Hardcoded OpenAI mode selection logic
- Multiple duplicate helper methods

**After Refactoring** (84 lines):
- Simplified API: `resolveLanguageModel(modelId, middlewares?)`
- Removed all hardcoded logic (handled by ProviderExtension variants)
- Clear single responsibility

```typescript
export class ModelResolver {
  private provider: ProviderV3

  constructor(provider: ProviderV3) {
    this.provider = provider
  }

  /**
   * Resolve language model
   * @param modelId - Model ID (e.g., "gpt-4", "claude-3-5-sonnet")
   * @param middlewares - Optional middleware array
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
   * Resolve embedding model
   */
  async resolveEmbeddingModel(modelId: string): Promise<EmbeddingModelV3> {
    return this.provider.embeddingModel(modelId)
  }

  /**
   * Resolve image model
   */
  async resolveImageModel(modelId: string): Promise<ImageModelV3> {
    return this.provider.imageModel(modelId)
  }
}
```

### 11.2 Mode Selection Mechanism

Mode selection for OpenAI, Azure, etc. (e.g., `openai-chat`, `azure-responses`) is now fully handled by ProviderExtension's variants mechanism:

```typescript
// Variants in ProviderExtension definition
const OpenAIExtension = ProviderExtension.create({
  name: 'openai',
  variants: [
    {
      suffix: 'chat',           // produces providerId: 'openai-chat'
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

## 12. HubProvider System

### 12.1 Multi-Provider Routing

`HubProvider` is a special provider that routes requests to multiple underlying providers. It uses namespace-format modelIds:

```
provider|modelId
e.g.: openai|gpt-4
      anthropic|claude-3-5-sonnet
```

### 12.2 Type-Safe Configuration

`HubProviderConfig` uses `CoreProviderSettingsMap` to ensure type safety:

```typescript
export interface HubProviderConfig {
  hubId?: string
  debug?: boolean
  registry: ExtensionRegistry
  // Type-safe provider settings map
  providerSettingsMap: Map<string, CoreProviderSettingsMap[keyof CoreProviderSettingsMap]>
}

// Usage example
const hubProvider = await createHubProviderAsync({
  hubId: 'aihubmix',
  registry,
  providerSettingsMap: new Map([
    ['openai', { apiKey: 'sk-xxx', baseURL: 'https://...' }],    // OpenAI settings
    ['anthropic', { apiKey: 'ant-xxx' }],                        // Anthropic settings
    ['google', { apiKey: 'goog-xxx' }]                           // Google settings
  ])
})
```

### 12.3 Input Validation

HubProvider now includes strict input validation:

```typescript
function parseHubModelId(modelId: string): { provider: string; actualModelId: string } {
  const parts = modelId.split(DEFAULT_SEPARATOR)
  // Validate format: must have two parts, both non-empty
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

## 13. Testing Architecture

### 13.1 Test Utilities (test-utils)

`@cherrystudio/ai-core` provides a complete set of testing utilities:

```typescript
// packages/aiCore/test_utils/helpers/model.ts

// Create complete mock provider (methods are vi.fn() spies)
export function createMockProviderV3(overrides?: {
  provider?: string
  languageModel?: (modelId: string) => LanguageModelV3
  imageModel?: (modelId: string) => ImageModelV3
  embeddingModel?: (modelId: string) => EmbeddingModelV3
}): ProviderV3

// Create mock language model (with complete doGenerate/doStream implementation)
export function createMockLanguageModel(overrides?: Partial<LanguageModelV3>): LanguageModelV3

// Create mock image model
export function createMockImageModel(overrides?: Partial<ImageModelV3>): ImageModelV3

// Create mock embedding model
export function createMockEmbeddingModel(overrides?: Partial<EmbeddingModelV3>): EmbeddingModelV3
```

### 13.2 Integration Tests

HubProvider integration tests cover the following scenarios:

```typescript
// packages/aiCore/src/core/providers/__tests__/HubProvider.integration.test.ts

describe('HubProvider Integration Tests', () => {
  // 1. End-to-end tests
  describe('End-to-End with RuntimeExecutor', () => {
    it('should resolve models through HubProvider using namespace format')
    it('should handle multiple providers in the same hub')
    it('should work with direct model objects instead of strings')
  })

  // 2. LRU cache tests
  describe('ProviderExtension LRU Cache Integration', () => {
    it('should leverage ProviderExtension LRU cache when creating multiple HubProviders')
    it('should create new providers when settings differ')
  })

  // 3. Error handling tests
  describe('Error Handling Integration', () => {
    it('should throw error when using provider not in providerSettingsMap')
    it('should throw error on invalid model ID format')
  })

  // 4. Advanced scenarios
  describe('Advanced Scenarios', () => {
    it('should support image generation through hub')
    it('should handle concurrent model resolutions')
    it('should work with middlewares')
  })
})
```

### 13.3 Test Coverage

Current test coverage:
- **ModelResolver**: 20 test cases
- **HubProvider unit tests**: 26 test cases
- **HubProvider integration tests**: 17 test cases
- **ExtensionRegistry**: 68 test cases
- **PluginEngine**: 38 test cases
- **Total**: 376+ test cases

---

## Appendix A: Key File Index

### Service Layer
- `src/renderer/src/services/ApiService.ts` - Main API service
- `src/renderer/src/services/ConversationService.ts` - Message preparation
- `src/renderer/src/services/SpanManagerService.ts` - Trace management

### AI Provider Layer
- `src/renderer/src/aiCore/index_new.ts` - ModernAiProvider
- `src/renderer/src/aiCore/provider/providerConfig.ts` - Provider configuration
- `src/renderer/src/aiCore/chunk/AiSdkToChunkAdapter.ts` - Stream adaptation
- `src/renderer/src/aiCore/plugins/PluginBuilder.ts` - Plugin building

### Core Package
- `packages/aiCore/src/core/runtime/executor.ts` - RuntimeExecutor
- `packages/aiCore/src/core/runtime/index.ts` - createExecutor
- `packages/aiCore/src/core/providers/core/ProviderExtension.ts` - Extension base class
- `packages/aiCore/src/core/providers/core/ExtensionRegistry.ts` - Registry
- `packages/aiCore/src/core/models/ModelResolver.ts` - Model resolution
- `packages/aiCore/src/core/plugins/PluginEngine.ts` - Plugin engine

### Extensions
- `packages/aiCore/src/core/providers/extensions/openai.ts` - OpenAI Extension
- `packages/aiCore/src/core/providers/extensions/anthropic.ts` - Anthropic Extension
- `packages/aiCore/src/core/providers/extensions/google.ts` - Google Extension

### Features
- `packages/aiCore/src/core/providers/features/HubProvider.ts` - Hub Provider implementation

### Test Utilities
- `packages/aiCore/test_utils/helpers/model.ts` - Mock model creation utilities
- `packages/aiCore/test_utils/helpers/provider.ts` - Provider test helpers
- `packages/aiCore/test_utils/mocks/providers.ts` - Mock Provider instances
- `packages/aiCore/src/core/providers/__tests__/HubProvider.integration.test.ts` - Integration tests

---

## Appendix B: Frequently Asked Questions

### Q1: Why use LRU cache?
**A**: Avoid recreating providers with same configuration, while automatically controlling memory (max 10 instances/extension).

### Q2: What's the difference between Plugin and Middleware?
**A**:
- **Plugin**: Feature extension at Cherry Studio level (Reasoning, ToolUse, WebSearch)
- **Middleware**: Request/response interceptor at AI SDK level

### Q3: When to use Legacy Provider?
**A**: Only for image generation endpoints when not using gateway, as it requires advanced features like image editing.

### Q4: How to add a new Provider?
**A**:
1. Create Extension in `packages/aiCore/src/core/providers/extensions/`
2. Register to `coreExtensions` array
3. Add configuration conversion logic in `providerConfig.ts`

---

**Document Version**: v2.1
**Last Updated**: 2026-01-02
**Maintainer**: Cherry Studio Team
