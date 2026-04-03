# aiCore 后端迁移完整方案（细化版）

## Cherry Studio 现在的调用链路

![alt text](image.png)

### 问题

| 问题 | 影响 |
|------|------|
| 安全性 | API Key、OAuth Token 暴露在 Renderer 进程，可通过 DevTools 获取 |
| 稳定性 | AI 长连接流式请求阻塞 Renderer 主线程，影响 UI 响应性 |
| 可维护性 | src/renderer/src/aiCore/ 包含 50+ 文件，深度耦合 Redux Store、window.api、i18n、toast 等浏览器 API |
| 扩展性 | 无法为外部客户端（Web、Mobile、CLI、API、Plugin）复用 AI 调用能力 |
| 架构债务 | 自建的 30+ 种 ChunkType + BlockManager + AiSdkToChunkAdapter 流式管线，维护成本高 |

## Cherry Studio V2 的调用链路（AI 统一）


![alt text](image-1.png)

## 架构对比

| 维度 | v2 当前 | 目标 (本方案) | 未来 (Utility Process) |
|------|---------|---------------|----------------------|
| AI 执行路径 | 2 条 (Renderer Chat + Main Agent) | 1 条 (Main AiCompletionService) | 1 条 (Utility AiCompletionService) |
| AI 执行进程 | Renderer (Chat) + Main (Agent) | **Main Process** | Utility Process (独立 V8) |
| Main 职责 | 数据层 + Agent SSE + 窗口管理 | 数据层 + 窗口管理 + **AI 执行** | 数据层 + 窗口管理 + Utility 生命周期 |
| 流式协议 | ChunkType (30+) + SSE TextStreamPart | 统一 UIMessageChunk | 统一 UIMessageChunk |
| 流式通道 | 无 (Renderer 直出 HTTP) + SSE | IPC (ipcMain ↔ ipcRenderer) | MessagePort (Renderer ↔ Utility 直连) |
| 渲染管线 | BlockManager + AgentMessageDataSource | 统一 useChat() + UIMessage.parts | 统一 useChat() + UIMessage.parts |
| 持久化 | IndexedDB (Chat) + SQLite (Agent) | 统一 SQLite (v2 DataApi) | 统一 SQLite (v2 DataApi) |
| Renderer AI 代码 | 50+ 文件 aiCore + AgentApiClient | useChat hook + Transport (2 文件) | useChat hook + Transport (2 文件) |
| Provider / Key | Renderer 内存 | Main 进程内存 | Utility 进程内存 (最高隔离) |

### 渐进式策略

**Phase 1-3: 先放 Main 进程**。当前性能足够支撑 3+ 并发 stream，优先解决架构问题（消除 Renderer 耦合、统一流式协议、接入 useChat）。

**未来: 按需迁移到 Utility Process**。如果出现 Main 事件循环阻塞（多窗口并发、大文件编码），再抽到独立进程。迁移成本低——aiCore 代码已通过 BuildContext 依赖注入解耦，只需把数据来源从直接 import 改为 RPC。

**架构预留原则**：aiCore 迁移到 Main 时，不直接 import renderer 的东西（Redux store、window.api），统一用 BuildContext / 依赖注入传参。这样将来挪到 Utility Process 只需换数据来源，不改逻辑。

## 迁移后文件组织总览

```
src/
├── main/
│   ├── services/
│   │   ├── AiService.ts                   # ← 新增: AI 执行服务 (lifecycle)
│   │   ├── ai/                            # ← 新增: AI 相关模块
│   │   │   └── AiCompletionService.ts     #   统一 AI 执行入口 (streamText, generateText)
│   │   ├── NodeTraceService.ts            #   保留 (删除 patchIpcMainHandle)
│   │   └── ...                            #   其他服务不变
│   │
│   ├── aiCore/                            # ← 新增: 从 renderer/src/aiCore/ 迁移
│   │   ├── plugins/                       #   AI SDK 插件 (17 个纯逻辑 + 5 个适配后)
│   │   │   ├── PluginBuilder.ts           #     纯函数版 plugin 构建 (BuildContext 注入)
│   │   │   ├── anthropicCachePlugin.ts
│   │   │   ├── pdfCompatibilityPlugin.ts
│   │   │   ├── searchOrchestrationPlugin.ts  # 直接 import KnowledgeService 等
│   │   │   ├── telemetryPlugin.ts
│   │   │   ├── noThinkPlugin.ts
│   │   │   └── ...                        #     (其余纯逻辑插件)
│   │   ├── prepareParams/                 #   参数构建
│   │   │   ├── parameterBuilder.ts        #     BuildContext 注入版
│   │   │   ├── messageConverter.ts
│   │   │   ├── fileProcessor.ts           #     Node.js fs 直接读文件
│   │   │   ├── modelParameters.ts
│   │   │   ├── modelCapabilities.ts
│   │   │   └── header.ts
│   │   ├── provider/                      #   Provider 配置
│   │   │   ├── providerConfig.ts          #     直接调 service (不再走 window.api)
│   │   │   ├── factory.ts
│   │   │   └── constants.ts
│   │   ├── tools/                         #   内置工具
│   │   │   ├── WebSearchTool.ts           #     直接 import SearchService
│   │   │   ├── KnowledgeSearchTool.ts     #     直接 import KnowledgeService
│   │   │   └── MemorySearchTool.ts
│   │   ├── trace/
│   │   │   └── AiSdkSpanAdapter.ts
│   │   ├── utils/
│   │   │   ├── options.ts
│   │   │   ├── reasoning.ts
│   │   │   ├── websearch.ts
│   │   │   ├── image.ts
│   │   │   └── mcp.ts                    #     直接 import MCPService
│   │   └── types/
│   │       ├── merged.ts
│   │       └── middlewareConfig.ts
│   │
│   └── core/application/
│       └── serviceRegistry.ts             #   修改: 注册 AiService
│
├── renderer/src/
│   ├── transport/                          # ← 新增: 2 个文件替代 50+ aiCore 文件
│   │   └── IpcChatTransport.ts            #   ChatTransport over IPC
│   ├── hooks/
│   │   └── useAiChat.ts                   # ← 新增: useChat + Transport + DataApi
│   ├── pages/home/
│   │   ├── Chat.tsx                       #   修改: 接入 useAiChat
│   │   └── Messages/
│   │       ├── Message.tsx                #   修改: parts 替代 blocks
│   │       └── ...
│   ├── aiCore/                            # ← 删除: 整个目录 (50+ 文件)
│   ├── services/
│   │   ├── messageStreaming/              # ← 删除: BlockManager, StreamingService, callbacks/
│   │   └── ApiService.ts                 #   修改: 移除 AI 调用相关方法
│   └── types/
│       └── chunk.ts                       # ← 删除: ChunkType 枚举
│
├── preload/
│   ├── index.ts                           #   修改: 添加 ai IPC handlers
│   └── preload.d.ts                       #   修改: 类型声明
│
└── packages/
    ├── shared/
    │   └── ai-transport/                  # ← 新增
    │       ├── schemas.ts                 #   Zod schema (请求/响应类型)
    │       ├── dataUIParts.ts             #   自定义 DataUIPart schema
    │       └── index.ts
    └── aiCore/                            #   不变: @cherrystudio/ai-core 包
        └── src/                           #   Main 进程直接 import
```

### 文件变动统计

| 操作 | 数量 | 说明 |
|------|------|------|
| **新建** | ~5 个 | AiService、AiCompletionService、IpcChatTransport、useAiChat、shared schemas |
| **迁移** (renderer → main) | ~30 个 | 纯逻辑直接复制，耦合文件适配（直接 import service 替代 window.api）|
| **修改** | ~8 个 | Chat.tsx、Message.tsx、preload、serviceRegistry |
| **删除** | ~55 个 | renderer/aiCore/、messageStreaming/、chunk.ts、Agent 旧代码 |
| **净变化** | **-50 个** | Renderer 侧从 50+ 文件缩减到 2 个文件 |

---

## 技术方案

AI SDK v6 `ChatTransport` 接口只要求 2 个方法，返回 `ReadableStream<UIMessageChunk>`。
内置的 3 个实现（Default/Text/Direct）均不支持 Electron IPC，但接口开放可自定义。

### Renderer ↔ Main 通信

```
Renderer                           Main

useChat()                          AiService (lifecycle)
  → IpcChatTransport                 → AiCompletionService
    → ipcRenderer.invoke()    ──→      → streamText()
    ← ipcRenderer.on('chunk') ←──      ← UIMessageChunk stream
```

- Renderer 通过 `ipcRenderer.invoke` 发起 AI 请求
- Main 执行 `streamText()`，通过 `webContents.send` 逐 chunk 推送回 Renderer
- `IpcChatTransport` 把 IPC 消息转为 `ReadableStream<UIMessageChunk>` 给 `useChat` 消费

aiCore 在 Main 进程直接 import 所有 service（MCPService、KnowledgeService、PreferenceService 等），无需 RPC。

### 未来 Utility Process 迁移路径

如果出现 Main 事件循环阻塞（多窗口并发、大文件编码），可按以下路径迁移：

| 场景 | Main 中的影响 | 迁移到 Utility Process 后 |
|------|--------------|--------------------------|
| 长回复 30s+ stream | 事件循环被占用，窗口操作卡顿 | Main 完全空闲 |
| 多窗口并发 3-5 个 | stream 竞争单线程 | 独立 V8，不竞争 |
| 大文件 base64 10MB | Main 完全阻塞 | 编码在独立进程 |
| Utility 崩溃 | N/A | 不影响 Main/Renderer |

**迁移成本低**：aiCore 已通过 BuildContext 解耦，只需将直接 import service 改为 oRPC 调用。通信改为 MessagePort 直连。`IpcChatTransport` 换成 `IpcChatTransport`。

---

## RPC 选型: oRPC（Utility Process 迁移时启用）

当前阶段 aiCore 在 Main 进程，直接 import service，不需要 RPC。但当未来迁移到 Utility Process 时，跨进程通信需要 RPC 框架：

| 调用方向 | 场景 | 数量 |
|----------|------|------|
| Renderer → Utility | AI 流式请求、abort | 高频 |
| Main → Utility | Agent AI 调用、ApiServer 转发 | 中频 |
| Utility → Main | 获取配置/API key、MCP 工具调用、知识库搜索、telemetry 上报 | 高频 |

以下为预选方案，在迁移到 Utility Process 时启用。

### 候选方案对比

| | **oRPC** | comlink | birpc | 手写 MainBridge |
|---|---------|---------|-------|----------------|
| MessagePort 适配 | **官方 adapter** (`@orpc/server/message-port`) | 需写 adapter (~10 行) | 手写 | 手写 (~100 行) |
| **流式 (async generator)** | **原生支持** (Event Iterator) | 不支持 | 不支持 | 需手写 |
| Schema 验证 | Zod/Valibot/ArkType | 无 | 无 | 手写 |
| 端到端类型安全 | **完整** (contract → client 自动推导) | Proxy 推断 | 泛型 | 手写 interface |
| 中间件 | 有 (logging, tracing, auth) | 无 | 无 | 手写 |
| Electron 支持 | **官方 Electron adapter** | 无 | 无 | N/A |
| **AI SDK 集成** | **`@orpc/ai-sdk`** (Tool 桥接) | 无 | 无 | 无 |
| 双向调用 | 单向 (client→server) | 单向 | **双向** | 双向 |
| 大小 | ~32KB | ~1KB | ~2KB | 0 |

### 选择 oRPC 的决定性理由

#### 1. 原生流式支持 — AI 流式回复的核心需求

comlink 和 birpc 都**不支持流式传输**。AI 模型回复是 async generator / ReadableStream，手写流式 RPC 需要处理背压、取消、错误传播、断线恢复等。oRPC 用 Event Iterator 原生解决：

```typescript
// UtilityProcess 侧 — 定义流式 AI procedure
const streamText = os
  .input(aiStreamRequestSchema)
  .output(eventIterator(uiMessageChunkSchema))
  .handler(async function* ({ input }) {
    const executor = createExecutor(input.providerId, config, plugins)
    const result = await executor.streamText(params)
    for await (const part of result.fullStream) {
      yield toUIMessageChunk(part)
    }
  })
```

```typescript
// Renderer 侧 — 消费流
for await (const chunk of client.ai.streamText({ messages, providerId: 'openai' })) {
  // chunk 已通过 Zod schema 验证，完全类型安全
}
```

#### 2. Electron MessagePort 官方适配

oRPC 的 `SupportedMessagePort` 类型已经覆盖了 Electron 的三种 port 接口：

```typescript
// oRPC 内部自动检测 port 类型
interface MessagePortMainLike {
  on: (event: string, callback: (event?: { data: any }) => void) => void  // Electron MessagePortMain
  postMessage: (data: any, transfer?: any[]) => void
}
```

- 标准 `MessagePort` (Renderer 侧) — `addEventListener`
- Electron `MessagePortMain` (Main 侧) — `.on()`
- 都无需写 adapter，oRPC 自动识别

#### 3. `@orpc/ai-sdk` — MCP 动态工具桥接

Cherry Studio 的工具不是固定的 3 个——用户可以安装任意数量的 MCP server，每个 server 暴露多个 tool。工具数量是动态的、不可预知的。

`@orpc/ai-sdk` 提供 `createTool`，把 oRPC procedure 直接转为 AI SDK `Tool`。核心价值在于 **MCP 工具的动态批量生成**：

```typescript
// Utility Process 侧 — 动态生成 AI SDK Tools
import { createTool } from '@orpc/ai-sdk'

// 1. 通过 RPC 从 Main 的 MCPService 获取工具列表
const mcpTools = await mainClient.mcp.listTools({ serverId })

// 2. 每个 MCP tool → oRPC procedure → AI SDK Tool（一行搞定）
const aiSdkTools = Object.fromEntries(
  mcpTools.map(tool => [
    tool.name,
    createTool(
      os
        .input(tool.inputSchema)   // MCP tool 的 JSON Schema 直接传入
        .handler(async ({ input }) => {
          // 执行时通过 RPC 回调 Main 的 MCPService
          return await mainClient.mcp.callTool({
            serverId,
            toolName: tool.name,
            args: input
          })
        })
    )
  ])
)

// 3. 内置工具也一样
const builtinTools = {
  webSearch: createTool(webSearchProcedure),
  knowledge: createTool(knowledgeSearchProcedure),
  memory: createTool(memorySearchProcedure),
}

// 4. 合并后传给 streamText
await executor.streamText({
  tools: { ...builtinTools, ...aiSdkTools },
  ...params
})
```

**不用 `createTool` 的话**，每个 MCP 工具都要手动写 AI SDK `tool()` 调用，重复定义 schema 和 execute。MCP 工具数量不固定（10 个 server × 5 个 tool = 50 个工具很常见），手写不现实。

`createTool` 的另一个好处是 **schema 验证自动生效**——MCP tool 的 `inputSchema` 传入后，oRPC + AI SDK 在模型调用工具时自动验证参数合法性，防止模型产生非法参数导致工具执行失败。

#### 4. Schema 验证 + 端到端类型安全

所有跨进程调用在边界自动验证，防止序列化后类型丢失：

```typescript
const aiRouter = {
  streamText: os
    .input(z.object({
      messages: z.array(uiMessageSchema),
      providerId: z.string(),
      modelId: z.string(),
      assistantConfig: assistantConfigSchema,
    }))
    .output(eventIterator(uiMessageChunkSchema))
    .handler(async function* ({ input }) { ... }),

  getPreference: os
    .input(z.object({ key: z.string() }))
    .output(z.any())
    .handler(async ({ input }) => { ... }),
}

// client 端自动推导类型，重构 procedure 签名时编译器报错
const client = createORPCClient<typeof aiRouter>(link)
```

#### 5. 中间件 + `@orpc/otel` — 零配置 tracing

`@orpc/otel` 一行代码启用，自动为每个 oRPC procedure 调用生成 span 层级，无需手写中间件：

```typescript
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { ORPCInstrumentation } from '@orpc/otel'

// 一行启用 — 所有 procedure 自动带 tracing
registerInstrumentations({ instrumentations: [new ORPCInstrumentation()] })
```

自动生成的 span 层级：
```
call_procedure (procedure.path = ['ai', 'streamText'])
  ├── validate_input
  ├── handler
  │   └── consume_event_iterator_output (流式 yield/complete 事件追踪)
  └── validate_output
```

**与 `NodeTraceService` 的关系**：`@orpc/otel` 替代的是手动为 RPC 调用打 span 的代码，但 OTel SDK 初始化（`NodeTracer.init`）、`CacheBatchSpanProcessor`、Trace 窗口管理仍由 `NodeTraceService` 负责。迁移后可删除 `NodeTraceService.patchIpcMainHandle()`（IPC context 传播不再需要，oRPC 内部处理）。

### 架构中的 oRPC 使用位置

```
Renderer                    Main                         UtilityProcess
                                                         ┌──────────────┐
                        fork() ──────────→ parentPort ──→ │ oRPC Server  │
                        oRPC Client                       │ (RPCHandler) │
                        (RPCLink via                      │              │
                         child.postMessage)               │ aiRouter:    │
                                                         │  streamText  │
Window₁ ──portA₁──→ oRPC Client ──────→ portA₁ ────────→│  generateText│
                    (RPCLink via                          │  embed       │
                     MessagePort)                        │              │
                                                         │ toolRouter:  │
                                                         │  webSearch   │
                                                         │  knowledge   │
                                                         │  memory      │
                                                         └──────────────┘
```

| 位置 | oRPC 角色 | 包 |
|------|----------|-----|
| UtilityProcess | **Server** (定义 router + handler) | `@orpc/server`, `@orpc/server/message-port`, `@orpc/otel` |
| Main | **Client** (通过 parentPort 调用) + **Server** (暴露 service) | `@orpc/client`, `@orpc/client/message-port`, `@orpc/server/message-port` |
| Renderer | **Client** (通过 MessagePort 调用) | `@orpc/client`, `@orpc/client/message-port` |
| UtilityProcess 内部 | **Tool 桥接** (procedure → AI SDK Tool) | `@orpc/ai-sdk` |

### 单向性的处理

oRPC 是单向的（client → server），Utility Process 无法主动调 Main。对于反向通信（配置推送、telemetry 上报）：

**方案**: 在 Main 侧也起一个 oRPC Server，Utility Process 作为 Client 调用

```typescript
// Main 侧 — 也是 oRPC Server
const mainRouter = {
  preference: { get: os.input(...).handler(async ({ input }) => preferenceService.get(input.key)) },
  mcp: { callTool: os.input(...).handler(async ({ input }) => mcpService.callTool(...)) },
  knowledge: { search: os.input(...).handler(async ({ input }) => knowledgeService.search(...)) },
  telemetry: { exportSpans: os.input(...).handler(async ({ input }) => nodeTraceService.export(...)) },
}

// Main: 在 parentPort 上挂载 server
const mainHandler = new RPCHandler(mainRouter)
mainHandler.upgrade(childPortAdapter)

// Utility Process: 用 oRPC Client 调 Main
const mainClient = createORPCClient<typeof mainRouter>(new RPCLink({ port: parentPortAdapter }))
const apiKey = await mainClient.preference.get({ key: 'openai.apiKey' })
```

这样双向通信都走 oRPC，**不需要手写任何 RPC 代码**。parentPort 上同时挂两个 oRPC 实例（Main Server + Utility Server），通过消息格式自动路由。

---

## Cherry Studio MessageBlock vs AI SDK UIMessage.parts 逐项映射

| Cherry Studio Block | AI SDK UIPart | 覆盖度 | 差异 |
|---------------------|---------------|--------|------|
| MainTextMessageBlock | TextUIPart { type: 'text', text, state } | 完全 | knowledgeBaseIds 放 metadata |
| ThinkingMessageBlock | ReasoningUIPart { type: 'reasoning', text, state, providerMetadata } | 完全 | thinking_millsec 放 providerMetadata |
| ImageMessageBlock (URL) | FileUIPart { type: 'file', mediaType: 'image/*', url } | 基本 | 见下方差异分析 |
| FileMessageBlock | FileUIPart { type: 'file', mediaType, url, filename } | 基本 | 见下方差异分析 |
| ToolMessageBlock | ToolUIPart { type: 'tool-{name}', toolCallId, state, input, output } | 基本 | 状态模型不同，见下方 |
| ErrorMessageBlock | DataUIPart { type: 'data-error', data } | 完全 | 自定义 DataUIPart，持久化在消息内 |

### 不能完全处理（需自定义 DataUIPart）

| Cherry Studio Block | AI SDK 最接近的 | 缺口 | 建议方案 |
|---------------------|-----------------|------|----------|
| CitationMessageBlock | SourceUrlUIPart | SourceUrl 只有 url + title，无法承载完整的 WebSearchResponse / KnowledgeReference[] / MemoryItem[] | DataUIPart: data-citation |
| TranslationMessageBlock | 无对应 | AI SDK 无翻译概念 | DataUIPart: data-translation |
| CodeMessageBlock | 无对应 (text 里的 markdown code block) | AI SDK 没有独立的 code part | DataUIPart: data-code 或合并到 TextUIPart 的 markdown |
| VideoMessageBlock | 无对应 | AI SDK 无 video part | DataUIPart: data-video |
| CompactMessageBlock | 无对应 | /compact 命令特有 | DataUIPart: data-compact |
| ErrorMessageBlock | 无对应 | `UIMessage` 无 status/error 字段，`chat.error` 不持久化 | DataUIPart: data-error |
| PlaceholderMessageBlock | 无对应 | 占位符 | 不需要迁移 |

---

## MessageBlock → UIMessage.parts 数据迁移方案

### 数据库现状

数据存储在 `message.data` 列（JSON），结构为 `{ blocks: MessageDataBlock[] }`。

**现有数据量统计**（来自 `cherrystudio.sqlite`）:

| BlockType | 数量 | 迁移目标 |
|-----------|------|----------|
| main_text | 14425 | TextUIPart |
| thinking | 1373 | ReasoningUIPart |
| tool | 605 | ToolUIPart |
| image | 230 | FileUIPart |
| error | 183 | DataUIPart: data-error |
| translation | 68 | DataUIPart: data-translation |
| file | 48 | FileUIPart |

### 逐项映射（含实际 DB 字段）

#### 1. MainTextBlock → TextUIPart

```json
// 源 (DB 实际数据)
{ "type": "main_text", "content": "...", "createdAt": 1759893405032, "references": [...] }

// 目标
{ "type": "text", "text": "...", "state": "done",
  "providerMetadata": { "cherry": { "createdAt": 1759893405032, "references": [...] } } }
```

| 源字段 | 目标字段 | 说明 |
|--------|----------|------|
| `content` | `text` | 直接映射 |
| `createdAt` | `providerMetadata.cherry.createdAt` | 保留时间戳 |
| `references` | `providerMetadata.cherry.references` | citation/mention 引用数据保留 |

#### 2. ThinkingBlock → ReasoningUIPart

```json
// 源 (DB 实际数据)
{ "type": "thinking", "content": "...", "thinkingMs": 17205, "createdAt": 1754915309541 }

// 目标
{ "type": "reasoning", "text": "...", "state": "done",
  "providerMetadata": { "cherry": { "thinkingMs": 17205, "createdAt": 1754915309541 } } }
```

| 源字段 | 目标字段 | 说明 |
|--------|----------|------|
| `content` | `text` | 直接映射 |
| `thinkingMs` | `providerMetadata.cherry.thinkingMs` | AI SDK 无计时字段，放 metadata |

#### 3. ToolBlock → ToolUIPart

```json
// 源 (DB 实际数据)
{ "type": "tool", "toolId": "call_68qB3VFjTpuJmjR3R5exXw", "toolName": "fetch_markdown",
  "content": { "content": [...], "isError": false },
  "metadata": { "rawMcpToolResponse": ... }, "createdAt": 1764035892657 }

// 目标
{ "type": "tool-fetch_markdown", "toolCallId": "call_68qB3VFjTpuJmjR3R5exXw",
  "state": "output-available",
  "input": {},
  "output": { "content": [...], "isError": false } }
```

| 源字段 | 目标字段 | 说明 |
|--------|----------|------|
| `toolName` | `type` = `"tool-{toolName}"` | AI SDK 按工具名分类 |
| `toolId` | `toolCallId` | 直接映射 |
| `arguments` | `input` | 直接映射（DB 中部分为空，默认 `{}`）|
| `content` | `output` | 工具执行结果 |
| (无 status 字段) | `state` | 历史数据统一为 `"output-available"` |
| `content.isError === true` | `state` = `"error"`, `errorText` | 错误工具调用 |

**ToolUIPart 状态模型**（AI SDK 有 6 种 state）:

| state | 含义 | 历史数据映射 |
|-------|------|-------------|
| `input-streaming` | 参数流式输入中 | 不会出现在持久化数据 |
| `input-available` | 参数已就绪 | 不会出现在持久化数据 |
| `approval-requested` | 等待用户审批 | 不会出现在持久化数据 |
| `approval-responded` | 用户已审批 | 不会出现在持久化数据 |
| `output-available` | 执行完成 | **所有正常工具调用** |
| `error` | 执行出错 | `content.isError === true` |

#### 4. ImageBlock → FileUIPart

```json
// 源 (DB 实际数据)
{ "type": "image", "fileId": "38b4a8f5-4e6e-4208-9426-2c04e0812cbf", "createdAt": 1764035892657 }

// 目标 (fileId 在转换时解析为实际路径)
{ "type": "file", "mediaType": "image/png",
  "url": "file:///Users/xxx/CherryStudio/Data/Files/38b4a8f5.png" }
```

| 源字段 | 目标字段 | 说明 |
|--------|----------|------|
| `fileId` | `url` | 转换时通过 `fileService.getFilePath(fileId)` 解析为 `file://` 绝对路径 |
| `url`（如有） | `url` | 外部 URL 直接使用 |
| (无) | `mediaType` | 从文件扩展名推断 MIME type |

#### 5. FileBlock → FileUIPart

```json
// 源 (DB 实际数据)
{ "type": "file", "fileId": "f51e2906-c617-4783-826c-f8b9d79eaff8", "createdAt": 1745747491890 }

// 目标 (fileId 在转换时解析为实际路径)
{ "type": "file", "mediaType": "application/pdf",
  "url": "file:///Users/xxx/CherryStudio/Data/Files/f51e2906.pdf" }
```

| 源字段 | 目标字段 | 说明 |
|--------|----------|------|
| `fileId` | `url` | 同 ImageBlock，转换时解析为 `file://` 绝对路径 |
| (无) | `mediaType` | 从文件扩展名推断 MIME type |
| (无) | `filename` | 从文件路径获取原始文件名 |

#### 6. ErrorBlock → DataUIPart (data-error)

```json
// 源 (DB 实际数据)
{ "type": "error",
  "error": { "name": "AbortError", "message": "pause_placeholder", "stack": "..." },
  "createdAt": 1746591931382 }

// 目标
{ "type": "data-error",
  "data": { "name": "AbortError", "message": "pause_placeholder" } }
```

| 源字段 | 目标字段 | 说明 |
|--------|----------|------|
| `error.name` | `data.name` | 错误类型 |
| `error.message` | `data.message` | 错误信息 |
| `error.stack` | 不迁移 | stack trace 无需持久化展示 |
| `error.code` | `data.code` | 可选错误码 |

**为什么用 DataUIPart 而不是 message-level error**:

- `UIMessage` 接口没有 `status` 或 `error` 字段
- `useChat` 的 `chat.error` 是实时状态，不持久化——历史消息加载后错误信息丢失
- DataUIPart 是 AI SDK 官方扩展机制，错误信息持久化在消息 parts 内，加载历史消息时仍可渲染

| 场景 | 处理方式 |
|------|----------|
| `error.message === 'pause_placeholder'` | 生成 `data-error`，UI 渲染为"已暂停"样式 |
| API 错误 (rate limit, auth, timeout) | 生成 `data-error`，UI 渲染错误提示 |
| 网络错误 | 生成 `data-error`，UI 渲染连接失败提示 |

#### 7. TranslationBlock → DataUIPart (data-translation)

```json
// 源 (DB 实际数据)
{ "type": "translation", "content": "翻译内容...", "targetLanguage": "chinese", "createdAt": 1748435353193 }

// 目标
{ "type": "data-translation",
  "data": { "content": "翻译内容...", "targetLanguage": "chinese" } }
```

### 迁移实现

#### 转换函数

**文件**: `src/main/data/migration/v2/migrators/MessageBlockToPartsMigrator.ts`

```typescript
import type { MessageDataBlock, MainTextBlock, ThinkingBlock, ToolBlock, ImageBlock, FileBlock, TranslationBlock, ErrorBlock } from '@shared/data/types/message'
import type { UIMessagePart } from 'ai'

export function blocksToUIParts(blocks: MessageDataBlock[]): UIMessagePart[] {
  return blocks.flatMap((block): UIMessagePart | UIMessagePart[] => {
    switch (block.type) {
      case 'main_text':
        return {
          type: 'text',
          text: (block as MainTextBlock).content,
          state: 'done',
          providerMetadata: {
            cherry: {
              createdAt: block.createdAt,
              ...((block as MainTextBlock).references && { references: (block as MainTextBlock).references })
            }
          }
        }

      case 'thinking':
        return {
          type: 'reasoning',
          text: (block as ThinkingBlock).content,
          state: 'done',
          providerMetadata: {
            cherry: {
              thinkingMs: (block as ThinkingBlock).thinkingMs,
              createdAt: block.createdAt
            }
          }
        }

      case 'tool': {
        const tb = block as ToolBlock
        const isError = typeof tb.content === 'object' && tb.content !== null && 'isError' in tb.content && tb.content.isError
        return {
          type: `tool-${tb.toolName || 'unknown'}`,
          toolCallId: tb.toolId,
          state: isError ? 'error' : 'output-available',
          input: tb.arguments ?? {},
          ...(isError
            ? { errorText: typeof tb.content === 'string' ? tb.content : JSON.stringify(tb.content) }
            : { output: tb.content }
          )
        }
      }

      case 'image': {
        const ib = block as ImageBlock
        const filePath = ib.url || fileService.getFilePath(ib.fileId)
        return {
          type: 'file',
          mediaType: getMimeType(filePath) ?? 'image/png',
          url: ib.url?.startsWith('http') ? ib.url : `file://${filePath}`
        }
      }

      case 'file': {
        const fb = block as FileBlock
        const filePath = fileService.getFilePath(fb.fileId)
        return {
          type: 'file',
          mediaType: getMimeType(filePath) ?? 'application/octet-stream',
          url: `file://${filePath}`,
          filename: path.basename(filePath)
        }
      }

      case 'translation': {
        const tb = block as TranslationBlock
        return {
          type: 'data-translation',
          data: {
            content: tb.content,
            targetLanguage: tb.targetLanguage,
            ...(tb.sourceLanguage && { sourceLanguage: tb.sourceLanguage })
          }
        }
      }

      case 'error': {
        const eb = block as ErrorBlock
        return {
          type: 'data-error',
          data: {
            name: eb.error?.name,
            message: eb.error?.message ?? 'Unknown error',
            ...(eb.error?.code && { code: eb.error.code })
          }
        }
      }

      case 'citation':
        // Citation 数据已合并到 MainTextBlock.references
        return []

      default:
        return []
    }
  })
}
```

#### 迁移策略: v2 migration 一次性转换

在 v2 数据迁移阶段，通过 migration script 将所有 `data.blocks` 一次性转为 `data.parts`，发版时不存在新旧格式共存。

**新建文件**: `src/main/data/migration/v2/migrators/MessageBlockToPartsMigrator.ts`

```typescript
// v2 migration pipeline 中执行
async function migrateAllMessages(db: DrizzleDb) {
  const messages = await db.select().from(messageTable)
  for (const msg of messages) {
    const data = JSON.parse(msg.data)
    if (data.blocks && !data.parts) {
      const parts = blocksToUIParts(data.blocks)
      await db.update(messageTable)
        .set({ data: JSON.stringify({ parts }) })
        .where(eq(messageTable.id, msg.id))
    }
  }
}
```

#### FTS Trigger 更新

迁移后 trigger 直接使用 parts 格式，不需要兼容旧格式：

```sql
-- 替换现有 trigger (blocks → parts)
CREATE TRIGGER IF NOT EXISTS message_ai AFTER INSERT ON message BEGIN
  UPDATE message SET searchable_text = (
    SELECT group_concat(json_extract(value, '$.text'), ' ')
    FROM json_each(json_extract(NEW.data, '$.parts'))
    WHERE json_extract(value, '$.type') = 'text'
  ) WHERE id = NEW.id;
  INSERT INTO message_fts(rowid, searchable_text)
  SELECT rowid, searchable_text FROM message WHERE id = NEW.id;
END
```

#### MessageData 类型更新

**修改文件**: `packages/shared/data/types/message.ts`

```typescript
// 迁移后: 只有 parts，不再有 blocks
export interface MessageData {
  parts: UIMessagePart[]
}
```

---

## 当前 Renderer aiCore 文件分类（迁移指引）

### 纯逻辑文件（可直接搬到 Main Process）

| 文件 | 用途 |
|------|------|
| `plugins/noThinkPlugin.ts` | OVMS 禁用 thinking |
| `plugins/openrouterReasoningPlugin.ts` | OpenRouter reasoning 脱敏 |
| `plugins/qwenThinkingPlugin.ts` | Qwen thinking 模式控制 |
| `plugins/reasoningExtractionPlugin.ts` | OpenAI/Azure reasoning 提取 |
| `plugins/reasoningTimePlugin.ts` | Reasoning 耗时度量 |
| `plugins/simulateStreamingPlugin.ts` | 非流式→流式模拟 |
| `plugins/skipGeminiThoughtSignaturePlugin.ts` | Gemini thought 签名处理 |
| `prepareParams/modelParameters.ts` | temperature, topP, maxTokens |
| `prepareParams/modelCapabilities.ts` | 模型能力检测 |
| `prepareParams/header.ts` | Anthropic beta headers |
| `provider/factory.ts` | Provider ID 映射 |
| `provider/constants.ts` | Copilot 常量 |
| `provider/custom/aihubmix-provider.ts` | AiHubMix 自定义 provider |
| `provider/custom/newapi-provider.ts` | NewAPI 自定义 provider |
| `services/schemas.ts` | Zod 验证 schema |
| `trace/AiSdkSpanAdapter.ts` | Span 格式转换 |
| `types/merged.ts` | Provider 类型定义 |
| `types/middlewareConfig.ts` | Middleware 配置类型 |
| `utils/websearch.ts` | Web search 配置构建 |
| `utils/reasoning.ts` | Reasoning 参数构建 |
| `utils/options.ts` | Provider options 构建 |
| `utils/image.ts` | Image generation 参数 |

### 耦合文件（需适配后搬到 Main Process）

| 文件 | 耦合依赖 | 适配方案 |
|------|----------|----------|
| `AiProvider.ts` | Redux store, window.api, CacheService, PreferenceService, SpanManagerService | 直接 import Main 侧 service，移除 window.api / Redux |
| `plugins/PluginBuilder.ts` | preferenceService, 所有 plugin 引用 | 重写为纯函数，配置通过 BuildContext 注入 |
| `plugins/anthropicCachePlugin.ts` | TokenService (token 估算) | 直接在 Main 进程本地调用 |
| `plugins/pdfCompatibilityPlugin.ts` | window.api (PDF 提取), i18n, toast | Node.js fs 直接读，移除 toast/i18n |
| `plugins/searchOrchestrationPlugin.ts` | Redux store, window.api, MemoryProcessor, AssistantService | 直接 import service |
| `plugins/telemetryPlugin.ts` | window.api.trace, SpanManagerService | 直接 import NodeTraceService |
| `prepareParams/parameterBuilder.ts` | Redux store, AssistantService | 配置通过 BuildContext 注入 |
| `prepareParams/messageConverter.ts` | window.api (文件操作) | Node.js fs 直接读 |
| `prepareParams/fileProcessor.ts` | window.api, i18n, toast, fileService | Node.js fs 直接读，移除 toast/i18n |
| `provider/providerConfig.ts` | window.api (OAuth, AWS Bedrock, Vertex AI, Copilot) | 直接 import 对应 service |
| `tools/WebSearchTool.ts` | WebSearchService | 直接 import SearchService |
| `tools/MemorySearchTool.ts` | Redux store, MemoryProcessor | 直接 import service |
| `tools/KnowledgeSearchTool.ts` | KnowledgeService | 直接 import KnowledgeService |
| `utils/mcp.ts` | window.api, Redux store, 用户确认弹窗 | 直接 import MCPService，用户确认走 IPC |

### Phase 3 删除的文件（useChat 替代后不再需要）

| 文件 | 原因 |
|------|------|
| `chunk/AiSdkToChunkAdapter.ts` | useChat 自动处理流式 chunks |
| `chunk/handleToolCallChunk.ts` | useChat ToolUIPart 替代 |
| `services/listModels.ts` | 保留，移到 Main |
| `services/index.ts` | 随 services/ 一起迁移 |

---

## Phase 1: Main Process AI 服务层

**前置**: 无 (不触及 v2 数据模型)
**产出**: Main Process 可独立执行 AI 调用，输出 UIMessageStream
**负责人**: Person A (AI 服务) + Person C (IPC + preload)

### Step 1.1: 构建配置

**修改文件**: `electron.vite.config.ts`

**操作**:
1. 在 main resolve.alias 中添加: `'@cherrystudio/ai-core': resolve('packages/aiCore/src')`
2. 确认 `@cherrystudio/ai-core` 对 main 构建生效（目前只在 renderer 配置了）

### Step 1.2: 创建 AiService（lifecycle 服务）

**新建文件**: `src/main/services/AiService.ts`

```typescript
@Injectable('AiService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['PreferenceService', 'MCPService'])
export class AiService extends BaseService {
  private completionService: AiCompletionService

  protected async onInit() {
    this.completionService = new AiCompletionService()

    // IPC: Renderer 发起 AI 流式请求
    this.ipcHandle(IpcChannel.Ai_StreamText, async (event, request) => {
      const requestId = request.requestId
      const abortController = new AbortController()

      // 流式回传 chunk
      for await (const chunk of this.completionService.streamText(request, abortController.signal)) {
        if (event.sender.isDestroyed()) break
        event.sender.send(IpcChannel.Ai_StreamChunk, { requestId, chunk })
      }
      event.sender.send(IpcChannel.Ai_StreamDone, { requestId })
    })

    // IPC: 中止请求
    this.ipcHandle(IpcChannel.Ai_Abort, (_, requestId) => {
      this.completionService.abort(requestId)
    })
  }
}
```

**操作**:
1. 新建 `src/main/services/AiService.ts`
2. 修改 `src/main/core/application/serviceRegistry.ts` — 注册 `AiService`

### Step 1.3: 创建 AiCompletionService（AI 执行入口）

**新建文件**: `src/main/services/ai/AiCompletionService.ts`

```typescript
// 统一 AI 完成服务 — 在 Main 进程直接 import 所有 service
import { application } from '@main/core/application'
import { createExecutor } from '@cherrystudio/ai-core'

export class AiCompletionService {
  async *streamText(request: AiStreamRequest, signal: AbortSignal) {
    // 1. 直接从 service 获取配置 (无需 RPC)
    const preferenceService = application.get('PreferenceService')
    const mcpService = application.get('MCPService')

    // 2. 构建参数 (BuildContext 模式)
    const context: BuildContext = {
      assistant: request.assistantConfig,
      websearchConfig: request.websearchConfig,
      mcpTools: await mcpService.listTools(request.mcpServerId),
      preferences: preferenceService.getMany([...]),
    }
    const params = buildStreamTextParams(context)
    const plugins = buildPlugins(context)

    // 3. 执行
    const executor = createExecutor(request.providerId, config, plugins)
    const result = await executor.streamText({ ...params, abortSignal: signal })

    // 4. 输出 UIMessageChunk
    for await (const part of result.fullStream) {
      yield toUIMessageChunk(part)
    }
  }

  abort(requestId: string) { /* AbortController.abort() */ }
}
```

### Step 1.5: 搬迁纯逻辑文件到 Main Process

**操作**:
1. 新建 `src/main/aiCore/` 目录
2. **直接复制** 以下 17 个纯逻辑文件（不改代码，只改 import 路径）:

```
src/renderer/src/aiCore/plugins/noThinkPlugin.ts
  → src/main/aiCore/plugins/noThinkPlugin.ts

src/renderer/src/aiCore/plugins/openrouterReasoningPlugin.ts
  → src/main/aiCore/plugins/openrouterReasoningPlugin.ts

src/renderer/src/aiCore/plugins/qwenThinkingPlugin.ts
  → src/main/aiCore/plugins/qwenThinkingPlugin.ts

src/renderer/src/aiCore/plugins/reasoningExtractionPlugin.ts
  → src/main/aiCore/plugins/reasoningExtractionPlugin.ts

src/renderer/src/aiCore/plugins/reasoningTimePlugin.ts
  → src/main/aiCore/plugins/reasoningTimePlugin.ts

src/renderer/src/aiCore/plugins/simulateStreamingPlugin.ts
  → src/main/aiCore/plugins/simulateStreamingPlugin.ts

src/renderer/src/aiCore/plugins/skipGeminiThoughtSignaturePlugin.ts
  → src/main/aiCore/plugins/skipGeminiThoughtSignaturePlugin.ts

src/renderer/src/aiCore/prepareParams/modelParameters.ts
  → src/main/aiCore/prepareParams/modelParameters.ts

src/renderer/src/aiCore/prepareParams/modelCapabilities.ts
  → src/main/aiCore/prepareParams/modelCapabilities.ts

src/renderer/src/aiCore/prepareParams/header.ts
  → src/main/aiCore/prepareParams/header.ts

src/renderer/src/aiCore/provider/factory.ts
  → src/main/aiCore/provider/factory.ts

src/renderer/src/aiCore/provider/constants.ts
  → src/main/aiCore/provider/constants.ts

src/renderer/src/aiCore/utils/websearch.ts
  → src/main/aiCore/utils/websearch.ts

src/renderer/src/aiCore/utils/reasoning.ts
  → src/main/aiCore/utils/reasoning.ts

src/renderer/src/aiCore/utils/options.ts
  → src/main/aiCore/utils/options.ts

src/renderer/src/aiCore/utils/image.ts
  → src/main/aiCore/utils/image.ts

src/renderer/src/aiCore/trace/AiSdkSpanAdapter.ts
  → src/main/aiCore/trace/AiSdkSpanAdapter.ts
```

3. 复制类型文件:
```
src/renderer/src/aiCore/types/merged.ts → src/main/aiCore/types/merged.ts
src/renderer/src/aiCore/types/middlewareConfig.ts → src/main/aiCore/types/middlewareConfig.ts
```

### Step 1.6: 适配耦合文件 — providerConfig

**源文件**: `src/renderer/src/aiCore/provider/providerConfig.ts`
**目标文件**: `src/main/aiCore/provider/providerConfig.ts`

**当前耦合点**:
- `window.api.copilot.getToken()` → Copilot OAuth
- `window.api.auth.*` → AWS Bedrock, Vertex AI 凭证
- `window.api.file.*` → 证书文件读取

**适配操作**:
1. 复制文件
2. 替换 `window.api.copilot.getToken()` → `直接 import CopilotService`
3. 替换 `window.api.auth.*` → `直接 import AuthService`
4. 替换 `window.api.file.*` → `Node.js `fs` 直接读` 或 Node.js `fs` 直接读
5. 在 Main 进程直接 import 对应 service（无需 RPC）

### Step 1.7: 适配耦合文件 — parameterBuilder

**源文件**: `src/renderer/src/aiCore/prepareParams/parameterBuilder.ts`
**目标文件**: `src/main/aiCore/prepareParams/parameterBuilder.ts`

**当前耦合点**:
- Redux store: `store.getState()` 获取 websearch config, assistant settings
- `AssistantService`: 获取 assistant prompt, settings
- `setupToolsConfig()`: MCP tools 来自 renderer 的 store

**适配操作**:
1. 复制文件
2. `buildStreamTextParams()` 改为接收一个 `BuildContext` 参数对象:
   ```typescript
   interface BuildContext {
     assistant: Assistant
     websearchConfig: WebSearchConfig
     mcpTools: MCPTool[]
     memoryConfig: MemoryConfig
     preferences: Record<string, any>
     // ... 所有之前从 Redux/service 获取的数据
   }
   ```
3. 移除所有 `store.getState()` 调用，从 `BuildContext` 取值
4. 移除 `AssistantService` 直接 import，数据通过 `BuildContext.assistant` 传入

### Step 1.8: 适配耦合文件 — messageConverter + fileProcessor

**源文件**:
- `src/renderer/src/aiCore/prepareParams/messageConverter.ts`
- `src/renderer/src/aiCore/prepareParams/fileProcessor.ts`

**目标文件**:
- `src/main/aiCore/prepareParams/messageConverter.ts`
- `src/main/aiCore/prepareParams/fileProcessor.ts`

**当前耦合点**:
- `window.api.file.read()` → 读取文件内容
- `window.api.file.extractPdfText()` → PDF 文字提取
- `i18n.t()` → 错误消息国际化
- `window.toast.*` → 用户通知

**适配操作**:
1. 复制文件
2. 文件操作: `window.api.file.*` → `Node.js `fs` 直接读` 或 Node.js `fs` 直接读
3. PDF 提取: `window.api.file.extractPdfText()` → `直接调用 `extractPdfText()`` 或在 Utility 进程本地用 `pdf-parse`
4. 移除所有 `i18n.t()` 调用 → 使用英文硬编码错误消息（worker 不需要 i18n）
5. 移除所有 `window.toast.*` → 通过 IPC 通知 Renderer 展示错误

### Step 1.9: 适配耦合 plugin — searchOrchestrationPlugin

**源文件**: `src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts`
**目标文件**: `src/main/aiCore/plugins/searchOrchestrationPlugin.ts`

**当前耦合点**:
- Redux store: memory config, MCP servers
- `window.api.knowledgeBase.search()` → 知识库搜索
- `MemoryProcessor` → 记忆搜索
- `WebSearchService` → Web 搜索
- `AssistantService` → assistant 配置

**适配操作**:
1. 复制文件
2. 知识库搜索: `window.api.knowledgeBase.search()` → `直接 import KnowledgeService`
3. 记忆搜索: `MemoryProcessor` → `直接 import MemoryService`
4. Web 搜索: `WebSearchService` → `直接 import SearchService`
5. 配置数据: 全部通过 `BuildContext` 传入（不再从 store 读取）

### Step 1.10: 适配耦合 plugin — telemetryPlugin

**源文件**: `src/renderer/src/aiCore/plugins/telemetryPlugin.ts`
**目标文件**: `src/main/aiCore/plugins/telemetryPlugin.ts`

**当前耦合点**:
- `window.api.trace.*` → 保存 trace
- `SpanManagerService` → 管理活跃 span
- OpenTelemetry API → 创建 span

**适配操作**:
1. 复制文件
2. Utility 进程本地初始化 OpenTelemetry SDK（使用 `@mcp-trace/trace-node`）
3. Span 数据通过 parentPort 上报给 Main 的 `NodeTraceService` / `SpanCacheService`
4. 移除 `window.api.trace.*` 调用

### Step 1.11: 适配耦合 plugin — pdfCompatibilityPlugin + anthropicCachePlugin

**pdfCompatibilityPlugin**:
- `window.api.file.extractPdfText()` → `直接调用 `extractPdfText()`` 或本地 `pdf-parse`
- 移除 `i18n.t()` 和 `window.toast`

**anthropicCachePlugin**:
- `TokenService.estimateTextTokens()` → 搬到 Utility 进程本地（纯计算，无外部依赖）

### Step 1.12: 适配 tools — WebSearchTool, KnowledgeSearchTool, MemorySearchTool

**源文件**: `src/renderer/src/aiCore/tools/*.ts`
**目标文件**: `src/main/aiCore/tools/*.ts`

**操作**:
1. `WebSearchTool.ts`: `WebSearchService.search()` → `直接 import SearchService`
2. `KnowledgeSearchTool.ts`: `KnowledgeService.search()` → `直接 import KnowledgeService`
3. `MemorySearchTool.ts`: `MemoryProcessor.search()` → `直接 import MemoryService`; Redux store → 通过 BuildContext 传入

### Step 1.13: 适配 utils/mcp.ts

**源文件**: `src/renderer/src/aiCore/utils/mcp.ts`
**目标文件**: `src/main/aiCore/utils/mcp.ts`

**当前耦合点**:
- `window.api.mcp.callTool()` → MCP 工具调用
- Redux store → MCP server 列表
- 用户确认弹窗 → 工具执行授权

**操作**:
1. MCP 调用: `window.api.mcp.callTool()` → `直接 import MCPService`
2. MCP 工具列表: 通过请求参数传入（不再从 store 读取）
3. 用户确认: 通过 IPC 转发到 Renderer 弹窗，等待用户响应

### Step 1.14: 实现 PluginBuilder（纯函数版）

**新建文件**: `src/main/aiCore/plugins/PluginBuilder.ts`

**操作**:
1. 基于 `src/renderer/src/aiCore/plugins/PluginBuilder.ts` 重写
2. `buildPlugins()` 改为纯函数:
   ```typescript
   function buildPlugins(config: PluginBuildConfig): AiPlugin[] {
     // config 包含所有之前从 service/store 获取的数据
     // 不再有任何 import service 的行为
   }
   ```
3. `PluginBuildConfig` 类型定义参考当前 `buildPlugins` 的所有参数

### Step 1.15: 实现 AiCompletionService（Utility 进程入口）

**新建文件**: `src/main/services/ai/AiCompletionService.ts`（已在 Step 1.3 定义）

```typescript
// 统一 AI 完成服务
// 接收请求 → 构建参数 → 构建 plugins → createExecutor → streamText
// 返回 UIMessageStream (通过 MessagePort)
export class AiCompletionService {
  // Main 进程直接 import service，无需 RPC client

  async handleStreamRequest(
    requestId: string,
    payload: AiStreamRequest,
    responsePort: MessagePort
  ): Promise<void> {
    // 1. 从 payload 提取: messages, providerId, modelId, assistantConfig, ...
    // 2. 直接 import service 获取: provider 配置, API key, MCP tools
    // 3. 调用 providerToAiSdkConfig() 构建 provider config
    // 4. 调用 buildStreamTextParams() 构建参数
    // 5. 调用 buildPlugins() 构建 plugin 数组
    // 6. createExecutor() + executor.streamText()
    // 7. 将 AI SDK stream 转为 UIMessageChunk，通过 responsePort 发送
    // 8. 完成后上报 token usage
  }
}
```

**操作**:
1. 新建文件
2. 实现 `handleStreamRequest` 方法
3. 实现 `handleGenerateRequest` 方法（非流式）
4. 实现 `handleEmbedRequest` 方法（embedding）
5. AI SDK stream → UIMessageChunk 转换逻辑:
   - 使用 AI SDK 的 `toUIMessageStreamResponse()` 或手动遍历 `fullStream`
   - 每个 `UIMessageChunk` 通过 `responsePort.postMessage()` 发送

### Step 1.16: 定义共享 Zod Schema

oRPC 使用 Zod schema 作为跨进程的类型契约，不需要手写 `BridgeRequest` / `WorkerMessage` / `WorkerControl` 等消息类型——oRPC 内部处理序列化、requestId 匹配、错误传播。

**新建文件**: `packages/shared/ai-transport/schemas.ts`

```typescript
import { z } from 'zod'

export const assistantConfigSchema = z.object({
  prompt: z.string(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  maxTokens: z.number().optional(),
  reasoningEffort: z.string().optional(),
  streamOutput: z.boolean().optional(),
})

export const aiStreamRequestSchema = z.object({
  chatId: z.string(),
  trigger: z.enum(['submit-message', 'regenerate-message']),
  messages: z.array(z.any()), // UIMessage[]
  providerId: z.string(),
  modelId: z.string(),
  assistantConfig: assistantConfigSchema,
  websearchConfig: z.any().optional(),
  mcpToolIds: z.array(z.string()).optional(),
  knowledgeBaseIds: z.array(z.string()).optional(),
})

export const uiMessageChunkSchema = z.any() // AI SDK 类型，运行时不严格验证
```

**操作**:
1. 新建 `packages/shared/ai-transport/` 目录
2. 新建 `schemas.ts` — Zod schema（同时作为 oRPC contract 和 TypeScript 类型来源）
3. 新建 `index.ts` — barrel export

### Step 1.17: 单元测试

**新建文件**:
- `src/main/services/__tests__/AiService.test.ts`
- `src/main/services/ai/__tests__/AiCompletionService.test.ts`

**操作**:
1. AiService 测试: mock IPC，验证流式 chunk 推送
2. AiCompletionService 测试: mock createExecutor，验证流式输出
3. 集成测试: Renderer IPC → AiService → AiCompletionService → chunk 回传

---

## Phase 2: IPC 通道 + IpcChatTransport

**前置**: Phase 1
**产出**: Renderer 通过 IPC 调用 Main 的 AI 服务，流式回传 UIMessageChunk
**负责人**: Person B (Renderer Transport) + Person C (IPC + preload)

### Step 2.1: IPC Channel 定义

**修改文件**: `packages/shared/IpcChannel.ts`

**操作**:
1. 添加以下 channel 常量:
   ```typescript
   Ai_StreamText = 'ai:stream-text'      // Renderer → Main: 发起流式请求
   Ai_StreamChunk = 'ai:stream-chunk'    // Main → Renderer: 流式 chunk 推送
   Ai_StreamDone = 'ai:stream-done'      // Main → Renderer: 流结束
   Ai_StreamError = 'ai:stream-error'    // Main → Renderer: 流错误
   Ai_Abort = 'ai:abort'                 // Renderer → Main: 中止请求
   ```

### Step 2.2: Preload 暴露 AI API

**修改文件**: `src/preload/index.ts`

**操作**:
1. 在 `api` 对象中添加 `ai` 命名空间:
   ```typescript
   ai: {
     streamText: (request) => ipcRenderer.invoke(IpcChannel.Ai_StreamText, request),
     abort: (requestId) => ipcRenderer.send(IpcChannel.Ai_Abort, requestId),
     onStreamChunk: (callback) => ipcRenderer.on(IpcChannel.Ai_StreamChunk, (_, data) => callback(data)),
     onStreamDone: (callback) => ipcRenderer.on(IpcChannel.Ai_StreamDone, (_, data) => callback(data)),
     onStreamError: (callback) => ipcRenderer.on(IpcChannel.Ai_StreamError, (_, data) => callback(data)),
   }
   ```

**修改文件**: `src/preload/preload.d.ts` — 添加类型声明

### Step 2.3: 实现 IpcChatTransport

**新建文件**: `src/renderer/src/transport/IpcChatTransport.ts`

```typescript
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

export class IpcChatTransport implements ChatTransport<UIMessage> {
  async sendMessages({
    trigger, chatId, messages, abortSignal, body,
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<ReadableStream<UIMessageChunk>> {
    const requestId = crypto.randomUUID()

    window.api.ai.streamText({ requestId, chatId, trigger, messages, ...body })

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        window.api.ai.onStreamChunk((data) => {
          if (data.requestId === requestId) controller.enqueue(data.chunk)
        })
        window.api.ai.onStreamDone((data) => {
          if (data.requestId === requestId) controller.close()
        })
        window.api.ai.onStreamError((data) => {
          if (data.requestId === requestId) controller.error(new Error(data.error))
        })
        abortSignal?.addEventListener('abort', () => {
          window.api.ai.abort(requestId)
        })
      }
    })
  }

  async reconnectToStream() { return null }
}
```

**操作**:
1. 新建 `src/renderer/src/transport/` 目录
2. 新建 `IpcChatTransport.ts`

### Step 2.4: 验证测试

**新建文件**: `src/renderer/src/transport/__tests__/IpcChatTransport.test.ts`

**操作**:
1. Mock `window.api.ai`，验证 IPC 调用和流式回传
2. 验证 abort 信号正确传递
3. 端到端集成测试: 发送消息 → 流式回复 → 完成

---

## Phase 3: Renderer useChat 接入（普通聊天）

**前置**: Phase 2 + v2 数据模型稳定
**产出**: 普通聊天完全走 useChat 渲染
**负责人**: Person B (Renderer)

### Step 3.1: 安装依赖

**操作**:
```bash
pnpm add @ai-sdk/react
```

### Step 3.2: 定义 DataUIPart schema

**新建文件**: `packages/shared/ai-transport/dataUIParts.ts`

```typescript
// 自定义 DataUIPart 定义（AI SDK 内建 part 无法覆盖的类型）
export const dataPartSchemas = {
  citation: z.object({
    type: z.enum(['web', 'knowledge', 'memory']),
    sources: z.array(z.object({
      url: z.string().optional(),
      title: z.string().optional(),
      content: z.string().optional(),
      // ... KnowledgeReference / MemoryItem 字段
    }))
  }),
  translation: z.object({
    sourceLanguage: z.string(),
    targetLanguage: z.string(),
    originalText: z.string(),
    translatedText: z.string()
  }),
  video: z.object({
    url: z.string(),
    mimeType: z.string().optional()
  }),
  compact: z.object({
    summary: z.string(),
    removedCount: z.number()
  }),
  code: z.object({
    language: z.string(),
    code: z.string(),
    filename: z.string().optional()
  }),
  error: z.object({
    name: z.string().optional(),
    message: z.string(),
    code: z.string().optional()
  })
}
```

### Step 3.3: 实现 useAiChat hook

**新建文件**: `src/renderer/src/hooks/useAiChat.ts`

```typescript
import { useChat } from '@ai-sdk/react'
import { IpcChatTransport } from '@renderer/transport/IpcChatTransport'

const transport = new IpcChatTransport()

export function useAiChat(options: UseAiChatOptions) {
  const chat = useChat({
    id: options.chatId,
    transport,
    dataPartSchemas,
    // 消息持久化
    onFinish: async (message) => {
      // 通过 DataApi 持久化到 SQLite
      await dataApi.messages.upsert(message)
    },
    onError: (error) => {
      // 错误处理
    },
    // 初始消息从 DataApi 加载
    messages: options.initialMessages
  })

  return {
    ...chat,
    // 扩展方法
    regenerate: (messageId: string) => {
      chat.reload({ messageId })
    }
  }
}
```

**操作**:
1. 新建 `src/renderer/src/hooks/useAiChat.ts`
2. 封装 `useChat` + `IpcChatTransport`
3. 集成 DataApi 持久化（`onFinish` 回调）
4. 集成初始消息加载（从 SQLite 加载历史消息）

### Step 3.4: 改造 Message 渲染组件

**修改文件**:
- `src/renderer/src/pages/home/Messages/Message.tsx`
- `src/renderer/src/pages/home/Messages/MessageGroup.tsx`
- `src/renderer/src/pages/home/Messages/Messages.tsx`

**操作**:
1. 从 `BlockManager` 读取改为从 `UIMessage.parts` 读取:
   ```typescript
   // Before (v1):
   message.blocks.map(blockId => {
     const block = messageBlocks[blockId]
     switch (block.type) {
       case 'main_text': return <TextBlock block={block} />
       case 'thinking': return <ThinkingBlock block={block} />
     }
   })

   // After (v2):
   message.parts.map((part, index) => {
     switch (part.type) {
       case 'text': return <TextPart key={index} part={part} />
       case 'reasoning': return <ReasoningPart key={index} part={part} />
       case 'tool-invocation': return <ToolPart key={index} part={part} />
       case 'file': return <FilePart key={index} part={part} />
       case 'data-citation': return <CitationPart key={index} part={part} />
       case 'data-video': return <VideoPart key={index} part={part} />
     }
   })
   ```
2. 为每种 UIPart 创建对应的渲染组件（可复用现有 Block 组件的内部逻辑）

### Step 3.5: 改造 Chat 页面

**修改文件**: `src/renderer/src/pages/home/Chat.tsx`

**操作**:
1. 引入 `useAiChat` hook 替代当前的 `ApiService.fetchChatCompletion()`
2. 消息发送: `chat.sendMessage(text, { body: { providerId, modelId, assistantConfig } })`
3. 重新生成: `chat.reload()`
4. 停止生成: `chat.stop()`
5. 消息状态: `chat.status` 替代自定义的 streaming state
6. 移除 `StreamProcessingService` / `BlockManager` 调用

### Step 3.6: 删除旧代码

**删除文件**（整个目录）:
```
src/renderer/src/aiCore/                    # 整个目录
src/renderer/src/services/messageStreaming/  # BlockManager, StreamingService, callbacks/
src/renderer/src/types/chunk.ts             # ChunkType 枚举
```

**修改文件**:
- `src/renderer/src/services/ApiService.ts` — 移除 `fetchChatCompletion()` 及相关方法
- `src/renderer/src/services/StreamProcessingService.ts` — 删除（如存在）

**注意**: `services/listModels.ts` 如果仍需在 renderer 使用，保留并改为通过 IPC 调用 Utility 进程的 listModels

### Step 3.7: 清理 import 和类型

**操作**:
1. 全局搜索 `from.*aiCore` 的 import，确认全部移除
2. 全局搜索 `ChunkType` 的使用，确认全部移除
3. 全局搜索 `BlockManager` 的使用，确认全部移除
4. 全局搜索 `AiSdkToChunkAdapter` 的使用，确认全部移除
5. 更新 `electron.vite.config.ts` renderer alias，移除 `@cherrystudio/ai-core` 相关别名（renderer 不再直接使用）

---

## Phase 4: Agent 统一 + 清理

**前置**: Phase 3
**产出**: Agent 复用统一 AI 完成层，两套管线合一
**负责人**: Person A (Utility Agent Strategy) + Person B (Renderer Agent UI)

### Step 4.1: 实现 AgentStrategy

**修改文件**: `src/main/services/ai/AiCompletionService.ts`

**操作**:
1. 在 Main 进程的 AiCompletionService 中添加 Agent 调用策略
2. AgentStrategy 与 ChatStrategy 共享 `AiCompletionService` 入口
3. 差异处理:
   - Agent 有权限审批流程 → 通过 IPC 转发到 Renderer
   - Agent 有 session 管理 → sessionId 通过请求参数传递
   - Agent 有工具执行 → 复用现有 ClaudeCodeService

### Step 4.2: 实现 Agent DataUIPart

**修改文件**: `packages/shared/ai-transport/dataUIParts.ts`

**操作**:
1. 添加 Agent 专属 DataUIPart:
   ```typescript
   'agent-permission': z.object({
     toolName: z.string(),
     args: z.record(z.any()),
     status: z.enum(['pending', 'approved', 'denied'])
   }),
   'agent-session': z.object({
     sessionId: z.string(),
     agentId: z.string()
   }),
   'agent-tool-use': z.object({
     toolName: z.string(),
     input: z.any(),
     output: z.any(),
     status: z.enum(['pending', 'running', 'complete', 'error'])
   })
   ```

### Step 4.3: Agent 权限审批双向通信

**操作**:
1. Main 发送 `agent-permission` DataUIPart（status: pending）通过 IPC 推送到 Renderer
2. Renderer 通过 `useAiChat` 的 `onToolCall` 拦截，弹出审批 UI
3. 用户操作后，Renderer 通过 IPC 发送审批结果
4. Main 接收审批结果，继续/中止 Agent 执行

### Step 4.4: useAiChat 支持 Agent 模式

**修改文件**: `src/renderer/src/hooks/useAiChat.ts`

**操作**:
1. chatId 前缀判断: `agent-session:*` → Agent 模式
2. Agent 模式下通过 body 传递 `agentConfig`
3. Agent 消息渲染使用 `agent-*` DataUIPart

### Step 4.5: 删除旧 Agent 代码

**删除文件**:
```
src/renderer/src/services/AgentApiClient.ts      # SSE 客户端
src/renderer/src/utils/parseAgentSSEChunk.ts      # SSE 解析
src/renderer/src/services/AgentMessageDataSource.ts # Agent 消息源
```

**修改文件**:
- `src/main/apiServer/routes/agents/handlers/messages.ts` — 改为调用 AiCompletionService（Main 进程直接调用）
- `src/main/services/agents/services/AgentService.ts` — 流式部分由 AgentStrategy 接管

### Step 4.6: E2E 测试 + 性能 benchmark

**新建文件**:
- `tests/e2e/ai-transport.spec.ts`
- `tests/e2e/agent-chat.spec.ts`

**操作**:
1. 端到端测试: 完整聊天流程（发送消息 → 流式回复 → 持久化）
2. Agent 测试: 权限审批 → 工具执行 → 结果回传
3. 性能 benchmark:
   - Main Process 模式 vs 旧 Renderer 模式的 UI 响应延迟对比
   - Main 事件循环在 AI 流式传输期间的占用率
   - 多窗口并发测试 (3-5 个同时流式)

---

## 两人分工总览

aiCore 在 Main 进程，无需 Utility Process 编排，简化为两人分工。

### Person A: Main 侧 AI 服务 + aiCore 迁移

| Phase | Step | 文件 | 操作 |
|-------|------|------|------|
| 1 | 1.1 | `electron.vite.config.ts` | 修改 (添加 aiCore alias) |
| 1 | 1.2 | `src/main/services/AiService.ts` | 新建 (lifecycle 服务) |
| 1 | 1.3 | `src/main/services/ai/AiCompletionService.ts` | 新建 |
| 1 | 1.4 | `src/main/aiCore/` (全部文件) | 从 renderer 复制 |
| 1 | 1.5-1.13 | 耦合文件适配 (直接 import service) | 复制+适配 |
| 1 | 1.14 | `src/main/aiCore/plugins/PluginBuilder.ts` | 重写 (BuildContext) |
| 1 | 1.16 | `packages/shared/ai-transport/schemas.ts` | 新建 |
| 1 | — | `src/main/core/application/serviceRegistry.ts` | 修改 (注册 AiService) |
| 2 | 2.1 | `packages/shared/IpcChannel.ts` | 修改 |
| 4 | 4.1 | Agent 策略集成到 AiCompletionService | 修改 |
| 4 | 4.5 | `src/main/apiServer/routes/agents/handlers/messages.ts` | 修改 |

### Person B: Renderer Transport + useChat

| Phase | Step | 文件 | 操作 |
|-------|------|------|------|
| 2 | 2.2 | `src/preload/index.ts` | 修改 (添加 ai API) |
| 2 | 2.2 | `src/preload/preload.d.ts` | 修改 (类型声明) |
| 2 | 2.3 | `src/renderer/src/transport/IpcChatTransport.ts` | 新建 |
| 2 | 2.4 | `src/renderer/src/transport/__tests__/IpcChatTransport.test.ts` | 新建 |
| 3 | 3.1 | `package.json` | 修改 (添加 @ai-sdk/react) |
| 3 | 3.2 | `packages/shared/ai-transport/dataUIParts.ts` | 新建 |
| 3 | 3.3 | `src/renderer/src/hooks/useAiChat.ts` | 新建 |
| 3 | 3.4 | `src/renderer/src/pages/home/Messages/Message.tsx` | 修改 |
| 3 | 3.5 | `src/renderer/src/pages/home/Chat.tsx` | 修改 |
| 3 | 3.6 | `src/renderer/src/aiCore/` | 删除整个目录 |
| 3 | 3.6 | `src/renderer/src/services/messageStreaming/` | 删除整个目录 |
| 3 | 3.6 | `src/renderer/src/types/chunk.ts` | 删除 |
| 3 | 3.6 | `src/renderer/src/services/ApiService.ts` | 修改 (移除 AI 调用) |
| 3 | 3.7 | `electron.vite.config.ts` | 修改 (移除 renderer aiCore alias) |
| 4 | 4.4 | `src/renderer/src/hooks/useAiChat.ts` | 修改 (Agent 支持) |
| 4 | 4.5 | Agent 相关旧文件 | 删除 |

---

## 依赖时序图

```
Week 1-2: Phase 1 (Main AI 服务)
  Day 1:   A: AiService + AiCompletionService 骨架
  Day 2:   A: 复制纯逻辑文件到 src/main/aiCore/
  Day 3-4: A: 适配耦合文件 (直接 import service 替代 window.api)
  Day 5:   A: PluginBuilder 重写 + 单元测试

Week 2: Phase 2 (IPC 通道)
  Day 6:   A: IPC Channel 定义 + AiService IPC handlers
           B: preload API + IpcChatTransport
  Day 7:   A+B: 联调 — Renderer 发请求 → Main 流式回传

Week 3-4: Phase 3 (useChat 接入)
  Day 8:   B: @ai-sdk/react + DataUIPart schema + useAiChat hook
  Day 9-10: B: Message 渲染组件改造 (parts 替代 blocks)
  Day 11:  B: Chat.tsx 改造
  Day 12:  B: 删除旧代码 + 清理 import

Week 5: Phase 4 (Agent 统一)
  Day 13-14: A: Agent 策略集成
  Day 15:    B: useAiChat Agent 支持
  Day 16:    全员: E2E 测试
```
