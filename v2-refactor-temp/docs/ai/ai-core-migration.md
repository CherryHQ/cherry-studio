# aiCore 后端迁移完整方案

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

**未来: 按需迁移到 Utility Process**。如果出现 Main 事件循环阻塞（多窗口并发、大文件编码），再抽到独立进程。迁移成本低——aiCore 中的纯函数通过参数接收数据，不直接 import service，只需把调用方的数据来源从直接 import 改为 RPC。

**架构预留原则**：aiCore 迁移到 Main 时，不直接 import renderer 的东西（Redux store、window.api）。纯函数通过参数接收数据，AiCompletionService 作为调用方负责从 service 获取数据并传参。这样将来挪到 Utility Process 只需换数据来源，不改逻辑。

## 迁移后文件组织总览

所有 AI 相关代码统一放在 `src/main/ai/` 下。不拆分 `services/` 和 `aiCore/` 两个目录——AiService 是 lifecycle 服务但与 aiCore 逻辑紧密耦合，放在一起更易维护。

```
src/
├── main/
│   ├── ai/                                # ← AI 执行层（所有 AI 相关代码）
│   │   ├── AiService.ts                   #   lifecycle 服务: IPC 桥 + 流管理
│   │   ├── AiCompletionService.ts         #   统一 AI 执行入口 (chat + agent)
│   │   ├── agentLoop.ts                   #   双循环纯函数: 外层 while(true) + 内层 ToolLoopAgent
│   │   ├── compileContext.ts              #   上下文编译器: 从 DB 检索 + 组装最优 context window
│   │   ├── PendingMessageQueue.ts         #   Steering 消息队列
│   │   ├── types/
│   │   │   ├── index.ts                   #   类型 re-export
│   │   │   ├── merged.ts                  #   Provider 类型定义
│   │   │   └── middlewareConfig.ts        #   Middleware 配置类型
│   │   ├── plugins/                       #   AI SDK 插件
│   │   │   ├── PluginBuilder.ts           #     纯函数版 plugin 构建 (具体参数传入)
│   │   │   ├── anthropicCachePlugin.ts
│   │   │   ├── pdfCompatibilityPlugin.ts
│   │   │   ├── searchOrchestrationPlugin.ts
│   │   │   ├── telemetryPlugin.ts
│   │   │   ├── noThinkPlugin.ts
│   │   │   └── ...                        #     (其余纯逻辑插件)
│   │   ├── prepareParams/                 #   参数构建
│   │   │   ├── parameterBuilder.ts        #     接收具体参数版
│   │   │   ├── messageConverter.ts
│   │   │   ├── fileProcessor.ts           #     Node.js fs 直接读文件
│   │   │   ├── modelParameters.ts
│   │   │   ├── modelCapabilities.ts
│   │   │   └── header.ts
│   │   ├── provider/                      #   Provider 配置
│   │   │   ├── providerConfig.ts          #     直接调 service (不再走 window.api)
│   │   │   ├── factory.ts
│   │   │   ├── extensions/
│   │   │   │   └── index.ts              #     15 个 provider extensions
│   │   │   ├── custom/
│   │   │   │   ├── newapi-provider.ts
│   │   │   │   └── aihubmix-provider.ts
│   │   │   └── constants.ts
│   │   ├── tools/                         #   工具注册 + 内置工具
│   │   │   ├── ToolRegistry.ts            #     统一工具注册表 (MCP + 内置)
│   │   │   ├── WebSearchTool.ts           #     直接 import SearchService
│   │   │   ├── KnowledgeSearchTool.ts     #     直接 import KnowledgeService
│   │   │   └── MemorySearchTool.ts
│   │   ├── trace/
│   │   │   └── AiSdkSpanAdapter.ts
│   │   ├── services/
│   │   │   └── schemas.ts                #     API response Zod schemas
│   │   ├── utils/
│   │   │   ├── options.ts
│   │   │   ├── reasoning.ts
│   │   │   ├── websearch.ts
│   │   │   ├── image.ts
│   │   │   └── mcp.ts                    #     直接 import MCPService
│   │   └── __tests__/
│   │       ├── AiService.test.ts
│   │       └── AiCompletionService.test.ts
│   │
│   └── core/application/
│       └── serviceRegistry.ts             #   修改: 注册 AiService
│
├── renderer/src/
│   ├── transport/                          # ← 新增: IpcChatTransport(Phase 2)
│   │   └── IpcChatTransport.ts            #   ChatTransport over IPC + reconnect
│   ├── pages/home/
│   │   ├── Chat.tsx                       #   修改: 直接使用官方 useChat + useQuery
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

### 设计原则

- **不引入 AiRuntime 中间层**：AiCompletionService 直接调用 `packages/aiCore` 的 `createAgent()`。aiCore 已经封装了 provider 解析 + plugin pipeline + model resolution，再包一层只是透传没有价值。
- **不使用 BuildContext**：AiCompletionService 直接从各 service 获取数据，传具体参数给具体函数。不引入中间"context bag"对象——每个函数只接收它需要的参数。
- **AiCompletionService 是所有 AI 调用的唯一入口**：不仅 chat streaming（`streamText`），还包括 topic 命名、笔记摘要、通用文本生成（`generateText`）、embedding 维度检测（`getEmbeddingDimensions`）、图片生成（`generateImage`）、模型列表（`listModels`）、API 验证（`checkModel`）。所有方法共享 provider 解析（`resolveFromRedux` → `buildAgentParams`）+ plugin pipeline。Renderer ApiService 中的 AI 调用逐步迁移为 `window.api.ai.*` IPC 调用。
- **统一使用 ToolLoopAgent，不区分 chat/agent 模式**：Chat 和 Agent 的唯一区别是 tools 的配置方式——Chat 由用户手动配置 tools（MCP tools、web search 等），Agent 自主决策 tools。统一走 `createAgent()` → `agent.stream()`，一条代码路径，无分支。
- **双循环架构（借鉴 Hermes / pi-mono）**：内层 = AI SDK ToolLoopAgent（LLM → tool call → execute → repeat）；外层 = `runAgentLoop()` 的 `while(true)`。内层退出条件是"LLM 不再调用 tool"，外层退出条件是"没有更多工作"（pending messages 为空、无 follow-up）。`prepareStep` 处理内层步间的 steering，外层兜住内层结束后到达的 steering。
- **通过 ToolLoopAgent 内置钩子实现内层控制**：`prepareStep`（动态调整 tools/model/messages、消费 steering 消息）、`onStepFinish`（进度推送）、`onFinish`（token 汇总）、`stopWhen`（停止条件）。
- **ToolRegistry + AI SDK 原生 `needsApproval` 实现工具权限**：不自建权限审批逻辑。所有 tools（MCP + 内置）通过 `ToolRegistry` 注册，每个 tool 声明 `needsApproval`（boolean 或 async function）。AI SDK 自动管理 `approval-requested` → `approval-responded` → `output-available` / `output-denied` 全流程，Renderer 通过 `useChat` 的 `addToolApprovalResponse()` 处理审批 UI。
- **ToolRegistry 是纯容器，不主动发现 tool**：谁创建 tool，谁负责注册。内置 tools 由 `AiService.onStart()` 注册，MCP tools 由 `MCPService` 在 server 连接/断开时 register/unregister。`AiCompletionService` 通过构造函数注入 registry，只调用 `resolve()`。
- **ToolRegistry 借鉴 Hermes `check_fn` 模式**：每个 tool 可选声明 `checkAvailable(): boolean`（API key 缺失？服务未启动？）。`resolve()` 时自动过滤不可用的 tool，LLM 根本看不到——无需错误处理。
- **无损上下文管理（检索 + 分层缓存）**：context window 不是 memory，是 viewport。所有消息持久化到 SQLite（single source of truth），context window 从 DB 编译而非内存中累积。Messages 数组分三层：① System prompt（session 级不变）② Retrieved context（外层循环边界更新，内层多步间稳定 → prompt cache hit）③ Working memory（当前轮次 raw messages，每步追加增长）。无 summary、无截断——用语义检索替代有损压缩，从全量历史中按 `relevance × recency` 加权检索最相关的消息填充 budget。内层 `prepareStep` 只管尾部（steering + `pruneMessages()` 裁剪旧 tool calls），不动前缀 → 保护 prompt cache。
- **完成边界持久化，非流式写 DB**：v2 架构下 stream 是 IPC 传输通道（Renderer 实时渲染），不是存储。不逐 chunk 写 DB——在完成边界一次性持久化完整消息：`onFinish`（内层结束）写 assistant message + usage，外层边界写 steering messages。持久化后 Main 发送 `Ai_MessagesPersisted` IPC 事件，Renderer 通过已有的 `useInvalidateCache()` (SWR) 刷新 `/messages` 缓存。消除了 partial message、chunk 拼接、恢复逻辑。
- **Pending Messages (Steering) 双层保障**：Renderer 通过 IPC 写入 `PendingMessageQueue`。**内层**：`prepareStep` 每步执行前 drain 队列并追加到 messages。**外层**：内层 ToolLoopAgent 退出后，`runAgentLoop` 再次 drain——如果有消息，将 assistant 响应 + pending messages 追加到 context，重启内层循环。两层保证 steering 消息不丢失。
- **迁移期间冻结 renderer/aiCore 的修改**：纯逻辑文件从 renderer 复制到 main 后，所有 AI 逻辑变更只在 `src/main/ai/` 上进行。Renderer 版保持不动直到 Phase 3 删除。这避免了两份代码 drift 的问题。
- **parameterBuilder 先保留后拆分**：Phase 1-4 保持 `buildStreamTextParams()` 大函数不变（逻辑正确且经过验证），Phase 5 再逐步拆成 aiCore plugins。避免同时改架构和改位置的风险。

### 文件变动统计

| 操作 | 数量 | 说明 |
|------|------|------|
| **新建/重写** | ~9 个 | AiService (已存在,更新)、AiCompletionService (已存在,重写)、IpcChatTransport、shared schemas、`AiStreamManager` + 三个 Listener 实现 (`WebContentsListener`, `PersistenceListener`, `ChannelAdapterListener`) + `InternalStreamTarget` + `claudeCodeSettingsBuilder`(全部在 Phase 2+6 完成;**不**造 `UIMessageAccumulator`,**不**造 `MessagePersistenceService` —— 前者复用 AI SDK 工具,后者直接用 Main 端已有的 `messageService` singleton;~~`ClaudeCodeStreamAdapter` 已删除~~ — Claude Code 作为标准 AI SDK provider 走统一路径) |
| **删除** (main 侧) | 4 个 | AiRuntime.ts、prepareParams/stubs.ts、utils/stubs.ts、prepareParams/messageUtilStubs.ts |
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
Renderer                           Main (src/main/ai/)

useChat()                          AiService (lifecycle, IPC 桥)
  → IpcChatTransport                 │
    → ipcRenderer.invoke()    ──→    ├→ AiCompletionService
    ← ipcRenderer.on('chunk') ←──    │    └→ createAgent() → agent.stream() → toUIMessageStream()
                                     │       (chat 和 agent 统一路径，区别仅在 tools 配置方式)
                                     │
                                     └→ packages/aiCore (provider 解析 + plugin pipeline)
```

- Renderer 通过 `ipcRenderer.invoke` 发起 AI 请求
- Main 统一走 `createAgent()` → `agent.stream()` 执行 AI 调用（chat 和 agent 同一路径，区别仅在 tools 配置方式：chat 用户手动配、agent 自主决策），通过 `webContents.send` 逐 chunk 推送回 Renderer
- `IpcChatTransport` 把 IPC 消息转为 `ReadableStream<UIMessageChunk>` 给 `useChat` 消费
- AiCompletionService 在 Main 进程直接 import 所有 service（MCPService、KnowledgeService、PreferenceService 等），无需 RPC
- **不存在 AiRuntime 中间层**——AiCompletionService 直接调用 `packages/aiCore` 的 `createAgent()` API

### 未来 Utility Process 迁移路径

如果出现 Main 事件循环阻塞（多窗口并发、大文件编码），可按以下路径迁移：

| 场景 | Main 中的影响 | 迁移到 Utility Process 后 |
|------|--------------|--------------------------|
| 长回复 30s+ stream | 事件循环被占用，窗口操作卡顿 | Main 完全空闲 |
| 多窗口并发 3-5 个 | stream 竞争单线程 | 独立 V8，不竞争 |
| 大文件 base64 10MB | Main 完全阻塞 | 编码在独立进程 |
| Utility 崩溃 | N/A | 不影响 Main/Renderer |

**迁移成本低**：aiCore 中的纯函数通过参数接收数据，不直接依赖 service。只需将 AiCompletionService 的数据来源从直接 import service 改为 oRPC 调用。通信改为 MessagePort 直连。

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
| `plugins/PluginBuilder.ts` | preferenceService, 所有 plugin 引用 | 重写为纯函数，接收具体参数 |
| `plugins/anthropicCachePlugin.ts` | TokenService (token 估算) | 直接在 Main 进程本地调用 |
| `plugins/pdfCompatibilityPlugin.ts` | window.api (PDF 提取), i18n, toast | Node.js fs 直接读，移除 toast/i18n |
| `plugins/searchOrchestrationPlugin.ts` | Redux store, window.api, MemoryProcessor, AssistantService | 直接 import service |
| `plugins/telemetryPlugin.ts` | window.api.trace, SpanManagerService | 直接 import NodeTraceService |
| `prepareParams/parameterBuilder.ts` | Redux store, AssistantService | 改为接收具体参数 |
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

**文件**: `src/main/ai/AiService.ts`（已存在，需更新）

AiService 是纯粹的 IPC 桥 + 流管理层。它不包含任何 AI 业务逻辑，只负责：
- 注册 IPC handlers
- 管理 AbortController
- 将 ReadableStream 的 chunk 通过 IPC 推送给 Renderer

```typescript
@Injectable('AiService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['PreferenceService', 'MCPService'])
export class AiService extends BaseService {
  private completionService = new AiCompletionService()

  protected async onInit() {
    this.registerIpcHandlers()
  }

  private registerIpcHandlers() {
    // Renderer 发起 AI 流式请求
    this.ipcHandle(IpcChannel.Ai_StreamRequest, async (event, request: AiStreamRequest) => {
      await this.executeStream(event.sender, request)
    })

    // 中止请求 (fire-and-forget)
    this.ipcOn(IpcChannel.Ai_Abort, (_, topicId: string) => {
      this.completionService.abort(topicId)
    })

    // Agent 执行中注入新消息 (steering, fire-and-forget)
    this.ipcOn(IpcChannel.Ai_SteerMessage, (_, topicId: string, message: any) => {
      this.completionService.steer(topicId, message)
    })
  }

  /**
   * 执行 AI stream 并逐 chunk 推送到 target webContents。
   * 同时用于 Renderer IPC 请求和 Main 内部 Agent/Channel 调用。
   */
  async executeStream(target: Electron.WebContents, request: AiStreamRequest) {
    const { topicId } = request
    const abortController = new AbortController()
    this.completionService.registerRequest(topicId, abortController)

    try {
      const stream = await this.completionService.streamText(request, abortController.signal)
      const reader = stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done || target.isDestroyed()) break
        target.send(IpcChannel.Ai_StreamChunk, { topicId, chunk: value })
      }

      if (!target.isDestroyed()) {
        target.send(IpcChannel.Ai_StreamDone, { topicId })
      }
    } catch (error) {
      if (!target.isDestroyed()) {
        target.send(IpcChannel.Ai_StreamError, { topicId, error: serializeError(error) })
      }
    } finally {
      this.completionService.removeRequest(topicId)
    }
  }
}
```

**操作**:
1. 更新 `src/main/ai/AiService.ts`（已存在）
2. 确认 `src/main/core/application/serviceRegistry.ts` 已注册 `AiService`

### Step 1.3: 创建 AiCompletionService（AI 执行入口）

**文件**: `src/main/ai/AiCompletionService.ts`（已存在 mock 版，需重写为真实实现）

AiCompletionService 是**唯一的 AI 执行入口**，统一使用 `createAgent()` — chat 和 agent 是同一条代码路径：

- **Chat**：用户手动配置的 tools（MCP tools、web search 等）
- **Agent**：自主决策的 tools + steering/权限审批/步骤进度推送

两者都走 `createAgent()` → `agent.stream()`，区别仅在于参数配置和钩子行为，不分支。

```typescript
import { application } from '@main/core/application'

/**
 * AiCompletionService: 编排层。准备参数，委托 runAgentLoop() 执行。
 * 不直接调用 createAgent()——runAgentLoop 纯函数负责双循环。
 */
/**
 * ToolRegistry 由外部注入，不由 AiCompletionService 拥有。
 * 注册发生在各自的 service 生命周期中：
 * - 内置 tools: AiService.onStart() 时注册（或各 tool 文件 export 自注册）
 * - MCP tools: MCPService 在 server 连接/断开时 register/unregister
 * AiCompletionService 只做 resolve，不做 register。
 */
export class AiCompletionService {
  private activeRequests = new Map<string, AbortController>()

  constructor(private toolRegistry: ToolRegistry) {}

  async streamText(request: AiStreamRequest, signal: AbortSignal): Promise<ReadableStream<UIMessageChunk>> {
    // 1. 从 ReduxService 读 provider 数据（过渡期：provider 尚在 Redux，未迁移到独立 service）
    // 未来 ProviderService 就绪后，替换为 providerService.getProvider()
    const reduxService = application.get('ReduxService')
    const providers: Provider[] = await reduxService.select('state.llm.providers')
    const provider = providers.find(p => p.id === request.providerId)
    const model = provider?.models.find(m => m.id === request.modelId)

    // 2. 从 ToolRegistry resolve tools（registry 已由外部填充，这里只读）
    // 合并内置 tool IDs + MCP tool IDs，传给 resolve 过滤 checkAvailable
    const toolIds = [
      ...getBuiltinToolIds(request),  // 根据 request 的 feature toggles 决定启用哪些内置 tools
      ...(request.mcpToolIds ?? []),
    ]
    const tools = this.toolRegistry.resolve(toolIds)

    // 3. 构建参数 + plugins
    const providerSettings = providerToAiSdkConfig(provider, model)
    const params = buildStreamTextParams(
      request.messages, request.assistantConfig, model, provider,
      request.websearchConfig,
    )
    const plugins = buildPlugins(model, provider, request.assistantConfig)

    // 4. 委托 runAgentLoop（双循环纯函数）
    const pendingMessages = this.getPendingMessageQueue(request.topicId)

    return runAgentLoop(
      {
        providerId: request.providerId,
        providerSettings,
        modelId: request.modelId,
        plugins,
        tools,
        params,
        pendingMessages,
        maxSteps: request.maxSteps ?? 20,
        isAgentMode: request.agentMode === true,
        topicId: request.topicId,
        chatId: request.chatId,
        modelContextWindow: model.contextWindow ?? 128_000,
        onStepProgress: (progress) => this.emitStepProgress(request.topicId, progress),
      },
      request.messages,
      signal,
    )
  }

  // --- Request tracking ---
  registerRequest(topicId: string, controller: AbortController) { ... }
  removeRequest(topicId: string) { ... }
  abort(topicId: string) { ... }

  // --- Pending Messages (Steering) ---
  private pendingMessageQueues = new Map<string, PendingMessageQueue>()

  getPendingMessageQueue(topicId: string): PendingMessageQueue {
    if (!this.pendingMessageQueues.has(topicId)) {
      this.pendingMessageQueues.set(topicId, new PendingMessageQueue())
    }
    return this.pendingMessageQueues.get(topicId)!
  }

  /** 用户在执行中注入新消息（由 AiService IPC handler 调用） */
  steer(topicId: string, message: ModelMessage) {
    this.getPendingMessageQueue(topicId).push(message)
  }
}

### AiCompletionService 统一 API 设计

AiCompletionService 不只服务 chat streaming，还要替代 renderer ApiService 中所有的 AI 调用。
所有调用共享同一个 provider 解析 + plugin pipeline + 错误处理逻辑。

**核心设计：`streamText` 和 `generateText` 都走 `createAgent()`**。
`ToolLoopAgent` 同时有 `.stream()` 和 `.generate()` 方法。没有 tools 时 `agent.generate()` 等价于直接 `generateText()`。
一条 agent 创建路径，两种执行方式——不需要分支。

```
streamText()    → createAgent() → agent.stream()    → ReadableStream<UIMessageChunk>
generateText()  → createAgent() → agent.generate()  → { text, usage }
```

**Agent 也能 generate 的场景**：
- Topic 命名：无 tools，单步 generate
- 带工具的一次性生成：有 tools，多步 generate（agent 自主调用 tools 后返回最终结果）
- 摘要/翻译：无 tools，单步 generate

调用方不需要关心是否走 agent——`generateText()` 内部统一通过 `createAgent()` → `agent.generate()`。

**Renderer ApiService 现有入口 → Main AiCompletionService 对应方法**:

| Renderer (ApiService) | 用途 | Agent 方法 | Main 方法 |
|---|---|---|---|
| `fetchChatCompletion` | 主聊天（流式） | `agent.stream()` | `streamText()` ✅ 已实现 |
| `fetchMessagesSummary` | Topic 命名 | `agent.generate()` | `generateText()` |
| `fetchNoteSummary` | 笔记摘要 | `agent.generate()` | `generateText()` |
| `fetchGenerate` | 通用文本生成 | `agent.generate()` | `generateText()` |
| `fetchImageGeneration` | 图片生成 + 编辑 | `aiCoreGenerateImage()` | `generateImage()` |
| `fetchModels` | 模型列表 | — (HTTP) | `listModels()` |
| `checkApi` (非 embedding) | API 验证 | `agent.generate()` | `checkModel()` ✅ 已实现 |
| `checkApi` (embedding) | Embedding 验证 | `executor.embedMany()` | `getEmbeddingDimensions()` |
| `InputEmbeddingDimension` | 知识库维度检测 | `executor.embedMany()` | `getEmbeddingDimensions()` |
| `fetchMcpTools` | MCP 工具发现 | — | 不需要（MCPService 已在 Main） |

```typescript
export class AiCompletionService {
  constructor(private toolRegistry: ToolRegistry) {}

  // ── 流式对话（已实现）──
  // createAgent() → agent.stream() → toUIMessageStream()
  streamText(request: AiStreamRequest, signal: AbortSignal): ReadableStream<UIMessageChunk>

  // ── 非流式文本生成 ──
  // createAgent() → agent.generate()
  // 用于: topic 命名、笔记摘要、通用文本生成、带工具的一次性生成
  async generateText(request: AiGenerateRequest): Promise<{ text: string; usage?: LanguageModelUsage }> {
    const { provider, model } = await this.resolveFromRedux(request)
    const adapted = adaptProvider({ provider })
    const sdkConfig = await providerToAiSdkConfig(adapted, model)
    const plugins = buildPlugins()

    // 和 streamText 共享同一个 agent 创建路径
    const tools = this.toolRegistry.resolve(request.mcpToolIds)
    const agent = await createAgent({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      modelId: model.id,
      plugins,
      agentSettings: {
        tools,
        instructions: request.system,
      },
    })

    const result = await agent.generate({
      messages: request.messages ?? [],
      prompt: request.prompt,
    })

    return { text: result.text, usage: result.usage }
  }

  // ── 图片生成（非 agent 路径，支持 generate + edit）──
  async generateImage(request: AiImageRequest): Promise<AiImageResult> {
    const { sdkConfig } = await this.buildAgentParams(request)

    // edit mode: prompt 带 images/mask；generate mode: prompt 是纯字符串
    const promptParam = request.inputImages
      ? { text: request.prompt, images: request.inputImages, ...(request.mask && { mask: request.mask }) }
      : request.prompt

    const result = await aiCoreGenerateImage({
      providerId: sdkConfig.providerId,
      providerSettings: sdkConfig.providerSettings,
      model: sdkConfig.modelId,
      prompt: promptParam,
      n: request.n ?? 1,
      size: (request.size ?? '1024x1024'),
    })

    // 转换为 data URL 格式
    const images: string[] = []
    for (const image of result.images ?? []) {
      if (image.base64) {
        images.push(`data:${image.mediaType || 'image/png'};base64,${image.base64}`)
      }
    }
    return { images }
  }

  // ── 模型列表（非 agent 路径）──
  async listModels(request: { assistantId?: string; providerId?: string }): Promise<Model[]> {
    const { provider } = await this.resolveFromRedux(request as AiStreamRequest)
    return fetchModelsFromProvider(provider)
  }

  // ── API 验证 ──
  async checkModel(request: AiBaseRequest & { timeout?: number }): Promise<{ latency: number }> {
    const start = performance.now()
    const timeout = request.timeout ?? 15000
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Check model timeout')), timeout)
    )
    await Promise.race([this.generateText({ ...request, system: 'test', prompt: 'hi' }), timeoutPromise])
    return { latency: performance.now() - start }
  }

  // ── Embedding（底层原语）──
  // embedMany 是原语，getEmbeddingDimensions 是业务封装
  async embedMany(request: AiEmbedRequest): Promise<{ embeddings: number[][]; usage?: EmbeddingTokenUsage }> {
    const { sdkConfig } = await this.buildAgentParams(request)
    const executor = await createExecutor<AppProviderSettingsMap>(
      sdkConfig.providerId, sdkConfig.providerSettings, []
    )
    return executor.embedMany({ model: sdkConfig.modelId, values: request.values })
  }

  /** 业务封装: 发送 ['test'] 获取 embedding 维度 */
  async getEmbeddingDimensions(request: AiBaseRequest): Promise<number> {
    const { embeddings } = await this.embedMany({ ...request, values: ['test'] })
    return embeddings[0].length
  }

  // ... resolveFromRedux, registerRequest, abort 等已有方法
}
```

**和 agentLoop 的关系**:

| 方法 | 路径 | 工具支持 | 流式 |
|---|---|---|---|
| `streamText()` | `runAgentLoop()` → `agent.stream()` | ✅ tools + steering | ✅ |
| `generateText()` | 直接 `createAgent()` → `agent.generate()` | ✅ tools | ❌ |
| `generateImage()` | `aiCoreGenerateImage()` (generate + edit) | ❌ | ❌ |
| `embedMany()` | `executor.embedMany()` | ❌ | ❌ |
| `getEmbeddingDimensions()` | `embedMany()` 业务封装 | ❌ | ❌ |
| `listModels()` | Provider HTTP | ❌ | ❌ |

`streamText` 走 `runAgentLoop`（因为需要双循环 + steering + 流式拼接）。
`generateText` 直接创建 agent 调 `.generate()`（不需要循环，一次调用返回结果）。
两者共享 `createAgent()` 的 provider 解析 + plugin pipeline。

**共享 provider 解析**: 所有方法复用 `resolveFromRedux()`，通过 assistantId 或 explicit providerId/modelId 解析。

**IPC 通道**:

| IPC Channel | 方向 | 用途 |
|---|---|---|
| `Ai_StreamRequest` | Renderer → Main | 流式聊天（已有） |
| `Ai_StreamChunk/Done/Error` | Main → Renderer | 流式响应（已有） |
| `Ai_Abort` | Renderer → Main | 取消请求（已有） |
| `Ai_GenerateText` | Renderer → Main | 非流式文本生成 ✅ 已实现 |
| `Ai_GenerateImage` | Renderer → Main | 图片生成 + 编辑 ✅ 已实现 |
| `Ai_ListModels` | Renderer → Main | 模型列表（新增） |
| `Ai_CheckModel` | Renderer → Main | API 验证 ✅ 已实现 |
| `Ai_EmbedMany` | Renderer → Main | Embedding 原语 ✅ 已实现 |

**Preload API 扩展**:

```typescript
ai: {
  // 已有
  streamText: (request) => ipcRenderer.invoke(Ai_StreamRequest, request),
  abort: (topicId) => ipcRenderer.send(Ai_Abort, topicId),
  onStreamChunk: (callback) => ...,
  onStreamDone: (callback) => ...,
  onStreamError: (callback) => ...,

  // 新增
  generateText: (request) => ipcRenderer.invoke(Ai_GenerateText, request),
  generateImage: (request) => ipcRenderer.invoke(Ai_GenerateImage, request),
  listModels: (request) => ipcRenderer.invoke(Ai_ListModels, request),
  checkModel: (request) => ipcRenderer.invoke(Ai_CheckModel, request),
  embedMany: (request) => ipcRenderer.invoke(Ai_EmbedMany, request),
}
```

**Renderer 侧迁移**: ApiService 中的函数逐个替换为 `window.api.ai.*` 调用：

```typescript
// Before (renderer 直接调 LLM):
export async function fetchMessagesSummary({ messages }) {
  const model = getQuickModel()
  const provider = getProviderByModel(model)
  const AI = new AiProvider(model, provider)
  const { getText } = await AI.completions(model.id, params, config)
  return getText()
}

// After (通过 IPC 走 Main):
export async function fetchMessagesSummary({ messages }) {
  const { text } = await window.api.ai.generateText({
    assistantId: getDefaultAssistant().id,
    system: namingPrompt,
    prompt: conversationJson,
  })
  return text
}
```

**迁移顺序** (从低风险到高风险):

1. ✅ `checkModel` (非 embedding) — 最简单，最小请求
2. ✅ `fetchMessagesSummary` / `fetchNoteSummary` — `generateText`，非流式
3. ✅ `fetchGenerate` — 同上
4. ✅ `embedMany` + `getEmbeddingDimensions` — embedding 验证 + 知识库维度检测
5. ✅ `generateImage` — Main IPC 已就绪（generate + edit），renderer 侧迁移涉及消息图片提取 + ChunkType 回调重构
6. `fetchModels` — 200+ 行 provider-specific HTTP 逻辑，独立任务
7. `fetchChatCompletion` — 已被 V2 路径 (`streamText`) 替代，最后删除

**Token Usage 追踪迁移**:

AI 调用迁移到 Main 后，`trackTokenUsage` 不再需要绕回 Renderer：

```
Before (Renderer):
  AI.completions() → usage → trackTokenUsage() → window.api.analytics.trackTokenUsage() → IPC → Main AnalyticsService

After (Main):
  AiCompletionService.generateText() → usage → AnalyticsService.trackTokenUsage() (直接调用，无 IPC)
```

实现方式：在 `AiCompletionService` 的每个方法（`generateText`、`streamText`、`generateImage`、`embedMany`）中，
拿到 `result.usage` 后直接调用 `AnalyticsService.trackTokenUsage()`：

```typescript
// AiCompletionService 内部（每个方法的 return 前）
const analyticsService = application.get('AnalyticsService')
analyticsService.trackTokenUsage({
  provider: model.provider,
  model: model.id,
  input_tokens: result.usage?.inputTokens ?? 0,
  output_tokens: result.usage?.outputTokens ?? 0,
})
```

Renderer 侧的 `trackTokenUsage()` 工具函数和 `window.api.analytics.trackTokenUsage()` IPC 调用在 ApiService 完全迁移后可以删除。

**请求类型**:

```typescript
// 所有非流式请求的基础类型
interface AiBaseRequest {
  assistantId?: string
  providerId?: string
  modelId?: string
}

// 文本生成
interface AiGenerateRequest extends AiBaseRequest {
  system?: string
  prompt?: string
  messages?: ModelMessage[]
  providerOptions?: Record<string, unknown>
}

// 图片生成 + 编辑
interface AiImageRequest extends AiBaseRequest {
  prompt: string
  inputImages?: string[]  // 有则走 edit mode，无则走 generate mode
  mask?: string           // inpainting mask（仅 edit mode）
  n?: number
  size?: string
}

interface AiImageResult {
  images: string[]  // data URL 格式 (data:image/png;base64,...)
}

// Embedding
interface AiEmbedRequest extends AiBaseRequest {
  values: string[]
}
```

/**
 * ToolRegistry: 统一管理所有 tools（MCP + 内置），每个 tool 自带 AI SDK needsApproval 声明。
 *
 * 替代命令式的 buildTools()：
 * - Before: AiCompletionService 手动组装 tools，自建 IPC round-trip 做权限审批
 * - After:  ToolRegistry 注册 tools，AI SDK 原生 needsApproval 自动管理审批流程
 *
 * AI SDK tool approval 全流程（无需自建）：
 * 1. Tool 声明 needsApproval: true（或 async function 条件判断）
 * 2. Agent 调用该 tool 时，AI SDK 自动发送 approval-requested 到 Renderer
 * 3. Renderer 通过 useChat 的 addToolApprovalResponse({ id, approved, reason }) 响应
 * 4. AI SDK 根据响应继续执行（output-available）或拒绝（output-denied）
 */
interface RegisteredTool {
  name: string
  tool: ReturnType<typeof tool>   // AI SDK tool()，已包含 needsApproval
  source: 'builtin' | 'mcp'
  /** 动态可用性检查（借鉴 Hermes check_fn）。返回 false 时 resolve() 自动跳过该 tool */
  checkAvailable?: () => boolean
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()

  /** 注册 tool（由各 service 在自身生命周期中调用，ToolRegistry 不主动发现 tool） */
  register(entry: RegisteredTool) {
    this.tools.set(entry.name, entry)
  }

  /**
   * 根据 tool IDs 解析出 AI SDK ToolSet。
   * 过滤 checkAvailable() === false 的 tool，LLM 看不到不可用的 tool。
   */
  resolve(toolIds: string[]): ToolSet {
    const result: ToolSet = {}
    for (const id of toolIds) {
      const entry = this.tools.get(id)
      if (!entry) continue
      if (entry.checkAvailable && !entry.checkAvailable()) continue
      result[id] = entry.tool
    }
    return result
  }

  unregister(name: string) { this.tools.delete(name) }
}
// Tool call hooks（日志、指标、参数变换）使用 AI SDK 原生：
// experimental_onToolCallStart / experimental_onToolCallFinish
// 在 createAgent() 的 agentSettings 中配置，不在 ToolRegistry 自建。

/**
 * 注册流程：谁创建 tool，谁负责注册。ToolRegistry 是纯容器。
 *
 * 1. 内置 tools — 各 tool 文件 export createXxxTool()，
 *    由 AiService.onStart() 统一注册（或各 service 自行注册）：
 */

// --- src/main/ai/tools/webSearchTool.ts ---
export function createWebSearchTool(): RegisteredTool {
  return {
    name: 'webSearch',
    source: 'builtin',
    tool: tool({
      description: 'Search the web for information',
      parameters: z.object({ query: z.string() }),
      needsApproval: false,
      execute: async ({ query }) => {
        const searchService = application.get('SearchService')
        return searchService.search(query)
      },
    }),
    checkAvailable: () => application.get('SearchService').isConfigured(),
  }
}

/**
 * 2. MCP tools — MCPService 在 server 连接/断开时 register/unregister：
 */

// --- src/main/services/MCPService.ts (生命周期 hook) ---
class MCPService extends BaseService {
  private toolRegistry: ToolRegistry  // 通过 DI 注入

  onServerConnected(server: MCPServer) {
    for (const mcpTool of server.listTools()) {
      this.toolRegistry.register(createMcpTool(mcpTool))
    }
  }

  onServerDisconnected(server: MCPServer) {
    for (const mcpTool of server.listTools()) {
      this.toolRegistry.unregister(mcpTool.name)
    }
  }
}

function createMcpTool(mcpTool: MCPToolDefinition): RegisteredTool {
  return {
    name: mcpTool.name,
    source: 'mcp',
    tool: tool({
      description: mcpTool.description,
      parameters: mcpTool.inputSchema,
      needsApproval: mcpTool.requiresApproval ?? true,
      execute: async (args) => {
        const mcpService = application.get('MCPService')
        return mcpService.callTool(mcpTool.serverId, mcpTool.name, args)
      },
    }),
    checkAvailable: () => application.get('MCPService').isServerConnected(mcpTool.serverId),
  }
}

/**
 * 3. AiService.onStart() — 组装 ToolRegistry，注入 AiCompletionService：
 */

// --- src/main/ai/AiService.ts ---
class AiService extends BaseService {
  async onStart() {
    const toolRegistry = new ToolRegistry()

    // 内置 tools 注册
    toolRegistry.register(createWebSearchTool())
    toolRegistry.register(createKnowledgeTool())
    toolRegistry.register(createMemoryTool())

    // MCP tools 已由 MCPService 生命周期自动注册（MCPService 持有同一个 registry 引用）

    this.completionService = new AiCompletionService(toolRegistry)
  }
}

/**
 * agentLoop 生命周期钩子设计
 *
 * 双循环: 外层 while(true) + 内层 AI SDK ToolLoopAgent
 * 钩子分两层: AI SDK 提供的（内层） vs 我们自建的（外层 + 跨层）
 *
 * ┌─ runAgentLoop ──────────────────────────────────────────────────────────┐
 * │                                                                         │
 * │  ★ hooks.onStart()               ← 自建: otel root span, 加载 memory  │
 * │                                                                         │
 * │  ┌─ outer loop ──────────────────────────────────────────────────────┐  │
 * │  │                                                                   │  │
 * │  │  ★ hooks.beforeIteration()    ← 自建: compileContext, otel span  │  │
 * │  │                                                                   │  │
 * │  │  ┌─ inner (ToolLoopAgent) ─────────────────────────────────────┐  │  │
 * │  │  │                                                             │  │  │
 * │  │  │  ◆ agentSettings.prepareStep()   ← AI SDK: 每步 LLM 调前   │  │  │
 * │  │  │    → hooks.prepareStep() 转发     (steering + 尾部裁剪)     │  │  │
 * │  │  │                                                             │  │  │
 * │  │  │  ◆ agentSettings.onStepFinish()  ← AI SDK: 每步完成        │  │  │
 * │  │  │    → hooks.onStepFinish() 转发    (进度推送 + otel span)    │  │  │
 * │  │  │                                                             │  │  │
 * │  │  │  ◆ agentSettings.onFinish()      ← AI SDK: 内层全部完成    │  │  │
 * │  │  │    (不直接暴露，由外层 afterIteration 统一处理)              │  │  │
 * │  │  │                                                             │  │  │
 * │  │  │  ◆ result.totalUsage             ← AI SDK: Promise, 流结束  │  │  │
 * │  │  │                                   后 resolve                │  │  │
 * │  │  └─────────────────────────────────────────────────────────────┘  │  │
 * │  │                                                                   │  │
 * │  │  ★ hooks.afterIteration()     ← 自建: persist, memory 更新       │  │
 * │  │                                 检查 pending → continue/break    │  │
 * │  └───────────────────────────────────────────────────────────────────┘  │
 * │                                                                         │
 * │  ★ hooks.onFinish()              ← 自建: analytics, otel root span 结束│
 * │  ★ hooks.onError()               ← 自建: otel record, retry/abort 决策 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * 图例: ◆ = AI SDK 原生钩子   ★ = 我们自建钩子
 *
 * 关键原则:
 * - AI SDK 钩子只在内层（ToolLoopAgent）生效，由 agentSettings 传入
 * - 自建钩子覆盖外层循环的生命周期（AI SDK 不管外层）
 * - prepareStep / onStepFinish 由自建 hooks 定义，agentLoop 转发到 agentSettings
 * - onFinish 不直接用 AI SDK 的（它只管内层一次），由外层 afterIteration + 最终 onFinish 统一处理
 */

// ── AI SDK 提供的钩子（内层 ToolLoopAgent）──
// 以下由 AI SDK ToolLoopAgentSettings 定义，agentLoop 转发 hooks 到 agentSettings:
//
// prepareStep({ stepNumber, steps, messages, model })
//   → 每步 LLM 调用前。可替换 messages / tools / model / system
//   → 用于: steering drain, 尾部 pruneMessages, 动态 activeTools
//
// onStepFinish({ stepNumber, text, toolCalls, toolResults, usage, finishReason })
//   → 每步完成后。观察者，不能修改流程
//   → 用于: 进度推送, otel step span
//
// onFinish({ steps, totalUsage })
//   → 内层全部完成。agentLoop 内部用于获取 totalUsage
//   → 不直接暴露给外部——由 afterIteration 统一处理
//
// stopWhen(stepCountIs(N))
//   → 停止条件。AI SDK 内置
//
// experimental_telemetry
//   → AI SDK 原生 otel 集成（自动生成 span）
//
// experimental_context
//   → 跨步骤持久化自定义状态，传入 tool execute 和 prepareStep

// ── 我们自建的钩子（外层 + 跨层）──

interface AgentLoopHooks {
  /** Loop 启动前。用于: otel root span, 加载 memory */
  onStart?: () => Promise<void>

  /** 每轮外层循环开始前。用于: compileContext, otel iteration span */
  beforeIteration?: (ctx: IterationContext) => Promise<BeforeIterationResult | void>

  /** 转发到 AI SDK prepareStep。用于: steering drain, 尾部 pruneMessages */
  prepareStep?: PrepareStepFunction

  /** 转发到 AI SDK onStepFinish。用于: 进度推送, otel step span */
  onStepFinish?: (step: StepResult) => void

  /** 每轮外层循环结束后。用于: persist, memory 更新, SWR invalidate */
  afterIteration?: (ctx: IterationContext, result: IterationResult) => Promise<void>

  /** 整个 loop 完成（所有迭代结束）。用于: analytics trackUsage, otel root span end */
  onFinish?: (result: LoopFinishResult) => void

  /** 错误处理。返回 'retry' 重试当前迭代，'abort' 终止 */
  onError?: (error: Error, ctx: ErrorContext) => Promise<'retry' | 'abort'>
}

interface IterationContext {
  iterationNumber: number
  messages: UIMessage[]
  totalSteps: number
}

interface BeforeIterationResult {
  messages?: UIMessage[]  // 替换 messages（compileContext 输出）
  system?: string         // 替换 system prompt（memory 注入）
}

interface IterationResult {
  messages: ModelMessage[]
  usage: LanguageModelUsage
}

interface LoopFinishResult {
  totalUsage: LanguageModelUsage
  totalIterations: number
  totalSteps: number
}

interface ErrorContext {
  iterationNumber: number
  stepNumber?: number
  isRetryable: boolean
}

// ── AI SDK 透传选项 ──
// CallSettings + Agent 特有设置，直接转发到 ToolLoopAgent agentSettings

interface AgentOptions {
  // CallSettings（模型参数）
  maxOutputTokens?: number       // 最大输出 token
  temperature?: number           // 温度
  topP?: number                  // 核采样
  topK?: number                  // Top-K 采样
  presencePenalty?: number       // 重复惩罚
  frequencyPenalty?: number      // 频率惩罚
  stopSequences?: string[]       // 停止序列
  seed?: number                  // 确定性采样
  maxRetries?: number            // 重试次数，默认 2
  timeout?: number | { totalMs?; stepMs?; chunkMs? }  // 超时
  headers?: Record<string, string | undefined>        // 额外 HTTP 头

  // Agent 特有
  toolChoice?: ToolChoice        // 'auto' | 'required' | 'none' | { type: 'tool', toolName }
  activeTools?: string[]         // 限制可用 tools 子集（不改类型）
  providerOptions?: ProviderOptions  // provider 特有（reasoning effort, web search 等）
  context?: unknown              // 跨步骤共享状态，传入 tool execute

  // 循环控制
  stopWhen?: StopCondition       // 内层终止条件，默认 stepCountIs(20)
  telemetry?: TelemetrySettings  // AI SDK 原生 otel
}

// TODO: 以下 AI SDK ToolLoopAgentSettings 字段暂未暴露，按需添加：
// - id: agent ID，用于 telemetry functionId 分组
// - output: 结构化输出 schema (Output.object / Output.array)，
//   启用后 agent 返回类型化的 JSON 而非自由文本
// - prepareCall: 每次 .stream()/.generate() 调用前触发，
//   可根据输入动态切换 model/temperature/tools 等所有设置。
//   当前被 beforeIteration hook 覆盖（外层循环每轮可改所有参数），
//   但如果需要"同一 agent 实例根据不同输入切换 model"的场景，需要暴露此字段。
// - callOptionsSchema: 与 prepareCall 配合，定义 CALL_OPTIONS 的 schema

// ── AgentLoopParams ──

interface AgentLoopParams {
  // Provider 配置（由 AiCompletionService.buildAgentParams 解析）
  providerId: string
  providerSettings: ProviderSettings
  modelId: string
  plugins?: AiPlugin[]
  tools?: ToolSet
  system?: string

  // AI SDK 透传选项
  options?: AgentOptions

  // 生命周期钩子
  hooks?: AgentLoopHooks
}

function runAgentLoop(
  params: AgentLoopParams,
  initialMessages: UIMessage[],
  signal: AbortSignal,
): ReadableStream<UIMessageChunk> {
  const { readable, writable } = new TransformStream<UIMessageChunk>()
  const writer = writable.getWriter()
  const hooks = params.hooks ?? {}

  ;(async () => {
    await hooks.onStart?.()

    let messages = initialMessages
    let iterationNumber = 0
    let totalSteps = 0
    let totalUsage: LanguageModelUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

    while (!signal.aborted) {
      iterationNumber++

      // ★ 自建: 外层循环开始前（compileContext, memory, otel span）
      const beforeResult = await hooks.beforeIteration?.({ iterationNumber, messages, totalSteps })
      if (beforeResult?.messages) messages = beforeResult.messages
      const system = beforeResult?.system ?? params.system

      // ◆ AI SDK: 创建 agent，转发 hooks 到 agentSettings
      const agent = await createAgent({
        providerId: params.providerId,
        providerSettings: params.providerSettings,
        modelId: params.modelId,
        plugins: params.plugins,
        agentSettings: {
          tools: params.tools,
          instructions: system,
          prepareStep: hooks.prepareStep,           // ◆ 转发到 AI SDK
          onStepFinish: hooks.onStepFinish,         // ◆ 转发到 AI SDK
        },
      })

      const result = await agent.stream({ messages, abortSignal: signal })

      // stream → writer（传输通道）
      for await (const chunk of result.toUIMessageStream()) {
        await writer.write(chunk)
      }

      // ◆ AI SDK: totalUsage 在 stream 结束后可用
      const iterationUsage = await result.totalUsage
      totalUsage = mergeUsage(totalUsage, iterationUsage)
      totalSteps += (await result.steps).length

      // ★ 自建: 外层循环结束后（persist, memory, otel）
      await hooks.afterIteration?.(
        { iterationNumber, messages, totalSteps },
        { messages: (await result.response).messages, usage: iterationUsage }
      )

      // 检查 pending（afterIteration 中可能已 drain）
      // 如果 afterIteration 没有设置新 messages，说明没有 pending → break
      // 具体的 pending 检查逻辑由 afterIteration 通过修改 messages 实现
      break // Phase 1: 单次执行。Phase 2: afterIteration 决定是否 continue
    }

    // ★ 自建: 全部完成
    hooks.onFinish?.({ totalUsage, totalIterations: iterationNumber, totalSteps })
  })()
    .then(() => writer.close())
    .catch(async (err) => {
      if (!signal.aborted && hooks.onError) {
        const action = await hooks.onError(err, {
          iterationNumber: 0, isRetryable: false
        })
        if (action === 'retry') {
          // TODO Phase 2: retry logic
        }
      }
      writer.abort(err).catch(() => {})
    })

  return readable
}

/**
 * AiCompletionService 组装示例:
 *
 * hooks: {
 *   onStart: async () => { span = tracer.startSpan('ai.stream') },
 *   beforeIteration: async (ctx) => {
 *     const compiled = await compileContext(chatId, ctx.messages)
 *     const memories = await memoryService.recall(ctx.messages)
 *     return { messages: compiled.messages, system: `${system}\n${memories}` }
 *   },
 *   prepareStep: ({ messages }) => {
 *     const drained = pendingMessages.drain()
 *     return drained.length > 0 ? { messages: [...messages, ...drained] } : {}
 *   },
 *   onStepFinish: (step) => emitStepProgress(topicId, step),
 *   afterIteration: async (ctx, result) => {
 *     await persistMessages(chatId, result.messages)
 *     ipcMain.emit('Ai_MessagesPersisted', { chatId })
 *     await memoryService.ingest(result.messages)
 *   },
 *   onFinish: (result) => {
 *     trackUsage(model, result.totalUsage)
 *     span?.end()
 *   },
 *   onError: async (err, ctx) => {
 *     span?.recordException(err)
 *     return ctx.isRetryable ? 'retry' : 'abort'
 *   },
 * }
 */

### Retry 策略：两层互补

Agent 执行期间不可避免会遇到 rate limit、timeout、context overflow 等错误。
Retry 分两层，各管各的：

```
agentLoop hooks.onError              → 迭代级（context overflow → truncate → retry iteration）
  └── ai-retry createRetryable(model) → API 调用级（rate limit 429 → delay → retry same call）
      └── AI SDK maxRetries: 2        → 内置基础重试（网络抖动等）
```

**Layer 1: AI SDK 内置 `maxRetries`**（已通过 `AgentOptions.maxRetries` 暴露）

最底层。对 transient errors（网络断开、5xx）自动重试，指数退避。默认 2 次。
不感知 rate limit header，不做 provider fallback。

**Layer 2: `ai-retry` — API 调用级 retry + provider fallback**

包装 model 对象，在 AI SDK 调用前拦截错误。核心能力：

| 内置策略 | 触发条件 | 行为 |
|---|---|---|
| `retryAfterDelay` | 429 rate limit | 尊重 `retry-after` header + 指数退避 |
| `serviceOverloaded` | 529 | 延迟重试，可配 maxAttempts |
| `serviceUnavailable` | 503 | 切 fallback model |
| `requestTimeout` | 超时 | 切 fallback model |
| `contentFilterTriggered` | 内容过滤 | 切 fallback model |

集成方式 — model wrapper，在 aiCore plugin 层或 createAgent 前包装：

```typescript
import { createRetryable } from 'ai-retry'
import { retryAfterDelay, serviceOverloaded } from 'ai-retry/retryables'

// 在 buildAgentParams 中包装 model
const retryableModel = createRetryable({
  model: resolvedModel,
  retries: [
    retryAfterDelay({ delay: 1000, backoffFactor: 2, maxAttempts: 3 }),
    serviceOverloaded(fallbackModel, { delay: 2000, maxAttempts: 2 }),
  ],
  onRetry: (ctx) => logger.warn('Retrying AI call', ctx),
})
```

限制：
- 流式：第一个 chunk 发出后不能 retry（mid-stream 错误传播到调用方）
- Result-based retry（content filter）仅 generate，不支持 stream
- 只管单次 API 调用，不管迭代/循环级别

**Layer 3: `hooks.onError` — 迭代级 retry**

最上层。在 agentLoop 外层循环 catch 中调用。感知迭代上下文，可以：

| 错误类型 | onError 行为 |
|---|---|
| Context overflow | truncate messages → return 'retry'（重启迭代） |
| 所有 retries 耗尽 | return 'abort'（终止循环） |
| Tool 执行失败 | 记录错误 → return 'retry'（让 LLM 看到错误重新决策） |
| 用户 abort | 不触发 onError（signal.aborted 检查在前） |

```typescript
hooks: {
  onError: async ({ error, iterationNumber }) => {
    if (isContextOverflow(error)) {
      // truncate context → retry
      return 'retry'
    }
    if (iterationNumber < 3 && isRetryableError(error)) {
      return 'retry'
    }
    return 'abort'
  }
}
```

**三层分工总结**:

| 层 | 管什么 | 谁提供 |
|---|---|---|
| `maxRetries` | transient 网络错误 | AI SDK 内置 |
| `ai-retry` | rate limit + provider fallback + timeout | 第三方库 |
| `hooks.onError` | context overflow + 迭代级决策 | 自建（agentLoop） |

/**
 * compileContext: 上下文编译器。
 *
 * 从 DB 编译最优 context window，不做有损压缩。
 * Context window = system prompt + 检索到的历史消息（原文）+ 当前轮次 messages。
 *
 * 检索排序: score = relevance(embedding similarity) × recency(time decay)
 * - 最近的消息天然有 recency 优势，但不绝对
 * - 一条旧消息如果和当前任务高度相关，会胜过不相关的近消息
 * - 所有放入 context 的消息都是 DB 中的原始数据，无 summary
 */
async function compileContext(params: {
  chatId: string
  currentTurnMessages: UIMessage[]
  modelContextWindow: number
}): Promise<{ contextPrefix: UIMessage[], workingMemory: UIMessage[] }> {
  const budget = Math.floor(params.modelContextWindow * 0.85)

  // Layer 1: System prompt（永远在）
  const systemPrompt = await getSystemPrompt(params.chatId)

  // Layer 3: Working memory（当前轮次，必须完整保留）
  const workingMemory = params.currentTurnMessages

  // 计算剩余 budget 给 Layer 2
  const fixedTokens = estimateTokens([systemPrompt]) + estimateTokens(workingMemory)
  const remainingBudget = budget - fixedTokens

  // Layer 2: Retrieved context（从 DB 全量历史中语义检索）
  // query = 当前轮次内容（用户最新消息 + 最近 tool results）
  const query = extractQueryFromMessages(workingMemory)
  const retrieved = await retrieveByRelevance({
    chatId: params.chatId,
    query,
    tokenBudget: remainingBudget,
    // 按 relevance × recency 加权排序，贪心填充直到 budget 用完
    scorer: (msg, similarity) => similarity * recencyDecay(msg.timestamp),
  })

  // contextPrefix = system + retrieved（内层多步间不变）
  // workingMemory = 当前轮次（每步追加增长）
  return {
    contextPrefix: [systemPrompt, ...sortByTimestamp(retrieved)],
    workingMemory,
  }
}

/**
 * 消息队列。steer() 写入，内层 prepareStep 和外层 loop 的 drain() 读取并清空。
 */
class PendingMessageQueue {
  private messages: ModelMessage[] = []

  push(message: ModelMessage) { this.messages.push(message) }
  drain(): ModelMessage[] {
    const drained = this.messages
    this.messages = []
    return drained
  }
  get length() { return this.messages.length }
}
```

**关键设计决策**:

| 决策 | 选择 | 理由 |
|------|------|------|
| AiRuntime 中间层 | **不引入** | `packages/aiCore` 已有 `createAgent`，再包一层只是透传 |
| Chat vs Agent | **统一 `createAgent()`** | 唯一区别是 tools 配置方式（chat 用户手动配、agent 自主决策）。一条代码路径，无分支 |
| Agent loop | **双循环** (`runAgentLoop` + ToolLoopAgent) | 内层 = AI SDK ToolLoopAgent（tool loop）；外层 = `runAgentLoop()` while(true)（兜住内层退出后的 pending messages）。纯函数，借鉴 Hermes / pi-mono |
| Tools 管理 | **ToolRegistry** | 替代命令式 `buildTools()`。所有 tools 注册到 registry，按请求 resolve 出 ToolSet |
| Tool 可用性 | **`checkAvailable()`** | 借鉴 Hermes `check_fn`。每个 tool 可选声明可用性检查，resolve() 时自动过滤。API key 缺失、MCP 断连 → tool 从 LLM 视野消失 |
| Tool 权限 | **AI SDK 原生 `needsApproval`** | 替代自建 `experimental_onToolCallStart` + IPC round-trip。AI SDK 自动管理 approval-requested → approval-responded → output-available/denied |
| 内层钩子 | **AI SDK 原生** | `prepareStep`、`onStepFinish`、`stopWhen`、`experimental_telemetry` — ToolLoopAgent 提供 |
| 外层钩子 | **自建 AgentLoopHooks** | `onStart`、`beforeIteration`、`afterIteration`、`onFinish`、`onError` — AI SDK 不管外层循环 |
| 钩子转发 | agentLoop 负责 | `hooks.prepareStep` / `hooks.onStepFinish` 转发到 AI SDK `agentSettings` |
| AI SDK 透传 | **AgentOptions** | CallSettings（temperature 等 11 个）+ toolChoice + activeTools + providerOptions + context + stopWhen + telemetry，全部转发到 agentSettings |
| Pending Messages | `PendingMessageQueue` + 双层 drain | 内层 `prepareStep` 步间消费 + 外层循环退出后消费。两层保证 steering 不丢失 |
| 上下文管理 | **无损：检索 + 分层缓存** | DB 是 memory，context window 是 viewport。三层结构（system / retrieved context / working memory）。外层更新检索，内层只追加尾部 → prompt cache friendly |
| 消息持久化 | **完成边界，非流式** | stream 是传输通道，不是存储。`onFinish` 持久化完整消息 → `Ai_MessagesPersisted` IPC → Renderer `useInvalidateCache('/messages')` (SWR) |
| AI 统一入口 | **AiCompletionService** | 所有 AI 调用（chat stream、generateText、generateImage、checkModel、listModels）走同一个 service，共享 provider 解析 + plugin pipeline |
| BuildContext | **不使用** | 直接传具体参数给具体函数，避免 God Object |

### Step 1.5: 搬迁纯逻辑文件到 Main Process

> **注意**: `src/main/ai/` 目录已存在，部分文件已从 renderer 复制过来（含 `@ts-nocheck`）。
> 此步骤检查已有文件是否与 renderer 最新版本同步，补充缺失文件。

**操作**:
1. 检查 `src/main/ai/` 已有文件，与 renderer 版本对齐
2. **直接复制**缺失的纯逻辑文件（不改代码，只改 import 路径）:

```
src/renderer/src/aiCore/plugins/noThinkPlugin.ts
  → src/main/ai/plugins/noThinkPlugin.ts

src/renderer/src/aiCore/plugins/openrouterReasoningPlugin.ts
  → src/main/ai/plugins/openrouterReasoningPlugin.ts

src/renderer/src/aiCore/plugins/qwenThinkingPlugin.ts
  → src/main/ai/plugins/qwenThinkingPlugin.ts

src/renderer/src/aiCore/plugins/reasoningExtractionPlugin.ts
  → src/main/ai/plugins/reasoningExtractionPlugin.ts

src/renderer/src/aiCore/plugins/reasoningTimePlugin.ts
  → src/main/ai/plugins/reasoningTimePlugin.ts

src/renderer/src/aiCore/plugins/simulateStreamingPlugin.ts
  → src/main/ai/plugins/simulateStreamingPlugin.ts

src/renderer/src/aiCore/plugins/skipGeminiThoughtSignaturePlugin.ts
  → src/main/ai/plugins/skipGeminiThoughtSignaturePlugin.ts

src/renderer/src/aiCore/prepareParams/modelParameters.ts
  → src/main/ai/prepareParams/modelParameters.ts

src/renderer/src/aiCore/prepareParams/modelCapabilities.ts
  → src/main/ai/prepareParams/modelCapabilities.ts

src/renderer/src/aiCore/prepareParams/header.ts
  → src/main/ai/prepareParams/header.ts

src/renderer/src/aiCore/provider/factory.ts
  → src/main/ai/provider/factory.ts

src/renderer/src/aiCore/provider/constants.ts
  → src/main/ai/provider/constants.ts

src/renderer/src/aiCore/utils/websearch.ts
  → src/main/ai/utils/websearch.ts

src/renderer/src/aiCore/utils/reasoning.ts
  → src/main/ai/utils/reasoning.ts

src/renderer/src/aiCore/utils/options.ts
  → src/main/ai/utils/options.ts

src/renderer/src/aiCore/utils/image.ts
  → src/main/ai/utils/image.ts

src/renderer/src/aiCore/trace/AiSdkSpanAdapter.ts
  → src/main/ai/trace/AiSdkSpanAdapter.ts
```

3. 复制类型文件:
```
src/renderer/src/aiCore/types/merged.ts → src/main/ai/types/merged.ts
src/renderer/src/aiCore/types/middlewareConfig.ts → src/main/ai/types/middlewareConfig.ts
```

### Step 1.6: 适配耦合文件 — providerConfig

**文件**: `src/main/ai/provider/providerConfig.ts`（已从 renderer 复制，含 `@ts-nocheck`）

**当前耦合点**:
- `window.api.copilot.getToken()` → Copilot OAuth
- `window.api.auth.*` → AWS Bedrock, Vertex AI 凭证
- `window.api.file.*` → 证书文件读取

**适配操作**:
1. 替换 `window.api.copilot.getToken()` → 直接 import CopilotService
2. 替换 `window.api.auth.*` → 直接 import AuthService
3. 替换 `window.api.file.*` → Node.js `fs` 直接读
4. 移除 `@ts-nocheck`，修复类型错误

### Step 1.7: 适配耦合文件 — parameterBuilder

**文件**: `src/main/ai/prepareParams/parameterBuilder.ts`（已从 renderer 复制，含 `@ts-nocheck`）

**当前状态**:
- 文件已存在，但用 stub 函数 + `@ts-nocheck` 标记
- `store.getState().websearch` 被替换为空对象 mock

**适配操作**:
1. `buildStreamTextParams()` 改为接收具体参数（messages, assistantConfig, model, provider, websearchConfig, mcpTools），不使用 BuildContext
2. 移除所有 `store.getState()` 调用，websearchConfig 从函数参数传入
3. 移除 `getAssistantSettings()` / `getDefaultModel()` 等 stub 调用，数据从函数参数传入
4. 移除 `@ts-nocheck`，修复类型错误
5. 删除 `prepareParams/stubs.ts`（不再需要）

### Step 1.8: 适配耦合文件 — messageConverter + fileProcessor

**文件**（已从 renderer 复制，含 `@ts-nocheck`）:
- `src/main/ai/prepareParams/messageConverter.ts`
- `src/main/ai/prepareParams/fileProcessor.ts`

**当前耦合点**:
- `window.api.file.read()` → 读取文件内容
- `window.api.file.extractPdfText()` → PDF 文字提取
- `i18n.t()` → 错误消息国际化
- `window.toast.*` → 用户通知

**适配操作**:
1. 文件操作: `window.api.file.*` → Node.js `fs` 直接读
2. PDF 提取: `window.api.file.extractPdfText()` → 直接调用 `extractPdfText()` 或本地 `pdf-parse`
3. 移除所有 `i18n.t()` 调用 → 使用英文硬编码错误消息（Main 进程不需要 i18n）
4. 移除所有 `window.toast.*` → 通过 IPC 通知 Renderer 展示错误
5. 删除 `prepareParams/messageUtilStubs.ts`（实现真实的 message block 查询逻辑）
6. 移除 `@ts-nocheck`

### Step 1.9: 适配耦合 plugin — searchOrchestrationPlugin

**文件**: `src/main/ai/plugins/searchOrchestrationPlugin.ts`（待从 renderer 复制）

**当前耦合点**:
- Redux store: memory config, MCP servers
- `window.api.knowledgeBase.search()` → 知识库搜索
- `MemoryProcessor` → 记忆搜索
- `WebSearchService` → Web 搜索
- `AssistantService` → assistant 配置

**适配操作**:
1. 从 renderer 复制文件
2. 知识库搜索: `window.api.knowledgeBase.search()` → 直接 import KnowledgeService
3. 记忆搜索: `MemoryProcessor` → 直接 import MemoryService
4. Web 搜索: `WebSearchService` → 直接 import SearchService
5. 配置数据: 通过函数参数传入（不再从 store 读取）

### Step 1.10: 适配耦合 plugin — telemetryPlugin

**文件**: `src/main/ai/plugins/telemetryPlugin.ts`（待从 renderer 复制）

**当前耦合点**:
- `window.api.trace.*` → 保存 trace
- `SpanManagerService` → 管理活跃 span
- OpenTelemetry API → 创建 span

**适配操作**:
1. 从 renderer 复制文件
2. Main 进程直接使用 OpenTelemetry SDK（已有 `@mcp-trace/trace-node`）
3. Span 数据直接 import `NodeTraceService` / `SpanCacheService`
4. 移除 `window.api.trace.*` 调用

### Step 1.11: 适配耦合 plugin — pdfCompatibilityPlugin + anthropicCachePlugin

**pdfCompatibilityPlugin**:
- `window.api.file.extractPdfText()` → `直接调用 `extractPdfText()`` 或本地 `pdf-parse`
- 移除 `i18n.t()` 和 `window.toast`

**anthropicCachePlugin**:
- `TokenService.estimateTextTokens()` → 搬到 Utility 进程本地（纯计算，无外部依赖）

### Step 1.12: 实现 ToolRegistry + 内置 tools

**新建文件**: `src/main/ai/tools/ToolRegistry.ts`、`src/main/ai/tools/webSearchTool.ts`、`src/main/ai/tools/knowledgeTool.ts`、`src/main/ai/tools/memoryTool.ts`、`src/main/ai/tools/mcpTool.ts`

借鉴 Hermes Agent 的 `check_fn` 动态可用性模式。

**核心原则**: ToolRegistry 是纯容器（存储 + resolve），不主动发现或创建 tool。谁创建 tool，谁注册。

**操作**:
1. 实现 `ToolRegistry` 类（纯容器）：
   - `register(entry)` / `unregister(name)` — 注册/注销 tool
   - `resolve(toolIds)` — 按 ID 查找 → 过滤 `checkAvailable()` → 返回 ToolSet
3. 实现各 tool factory（每个文件 export `createXxxTool(): RegisteredTool`）：
   - `createWebSearchTool()` — `checkAvailable: () => searchService.isConfigured()`
   - `createKnowledgeTool()` — `checkAvailable` 动态检查
   - `createMemoryTool()`
   - `createMcpTool()` — `needsApproval: true`，`checkAvailable: () => mcpService.isServerConnected()`
4. 注册时机（不在 AiCompletionService 中）：
   - 内置 tools: `AiService.onStart()` 调用各 `createXxxTool()` 注册
   - MCP tools: `MCPService.onServerConnected()` 注册，`onServerDisconnected()` unregister
5. `AiCompletionService` 通过构造函数注入 `ToolRegistry`，只调用 `resolve()`，不调用 `register()`

### Step 1.14: 实现 PluginBuilder（纯函数版）

**新建文件**: `src/main/ai/plugins/PluginBuilder.ts`

**操作**:
1. 基于 `src/renderer/src/aiCore/plugins/PluginBuilder.ts` 重写
2. `buildPlugins()` 改为纯函数，接收具体参数:
   ```typescript
   function buildPlugins(model: Model, provider: Provider, assistantConfig: AssistantConfig): AiPlugin[] {
     // 每个参数都是明确的，不使用 context bag
   }
   ```

### Step 1.15: 实现 agentLoop + AiCompletionService（真实执行）

**新建文件**: `src/main/ai/agentLoop.ts`、`src/main/ai/compileContext.ts`、`src/main/ai/PendingMessageQueue.ts`
**重写文件**: `src/main/ai/AiCompletionService.ts`（替换 Step 1.3 的 mock 为真实调用）

**操作**:
1. 实现 `runAgentLoop()` 纯函数 — 双循环，所有依赖通过参数传入：
   - 返回跨迭代的连续 `ReadableStream<UIMessageChunk>`（`TransformStream` 拼接）
   - 内层：`prepareStep` 只管尾部（steering + `pruneMessages()`），不动前缀 → prompt cache hit
   - 内层：`onFinish` 完成边界持久化（一次性写完整 assistant message 到 DB，不逐 chunk 写）
   - 外层：`onFinish` 已持久化 → drain pending → persist steering → `compileContext()` 从 DB 重建 → 重启内层
2. 实现 `compileContext()` — 无损上下文编译器：
   - 从 DB 全量历史中按 `relevance × recency` 语义检索相关消息（原文，非 summary）
   - 输出 `{ contextPrefix, workingMemory }` 三层结构
   - contextPrefix（system + retrieved）在内层多步间不变 → prompt cache friendly
   - 不做有损压缩：不截断、不 summary、不丢弃——只选择最优子集
3. 实现 `PendingMessageQueue` — push/drain 队列
4. 重写 `AiCompletionService.streamText()` — 编排层，准备参数后调用 `runAgentLoop()`
5. `AiCompletionService` 通过构造函数注入 `ToolRegistry`，只调用 `resolve()`
6. 删除 mock ReadableStream 代码
7. 删除 `AiRuntime.ts`（不需要中间层）
8. 删除 `prepareParams/stubs.ts`、`utils/stubs.ts`、`prepareParams/messageUtilStubs.ts`（直接传参替代）

### Step 1.16: 定义共享 Zod Schema

oRPC 使用 Zod schema 作为跨进程的类型契约，不需要手写 `BridgeRequest` / `WorkerMessage` / `WorkerControl` 等消息类型——oRPC 内部处理序列化、topicId 匹配、错误传播。

**新建文件**: `packages/shared/ai-transport/schemas.ts`

```typescript
import { z } from 'zod'

export const assistantConfigSchema = z.object({
  prompt: z.string().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  maxTokens: z.number().optional(),
  reasoningEffort: z.string().optional(),
  streamOutput: z.boolean().optional(),
})

/**
 * 用户消息的 content-only 载体 —— **没有 id**。
 *
 * Phase 2 里 Renderer 不再预落 user message(`streamingService.createUserMessage` 被删),
 * 而是把内容通过这个 schema 传到 Main,由 `handleStreamRequest` 用 `parentAnchorId`
 * 作为显式父节点调 `messageService.create` 原子落库,拿到真实的 SQLite id 后再
 * 构造 PersistenceListener。从源头避开 `activeNodeId` 多窗口竞态(Codex Finding 2 根治)。
 */
/**
 * AI SDK UIMessagePart 的宽松验证 —— 只要求有 `type: string`,允许扩展字段。
 *
 * 为什么不用 `z.any()`:项目禁止 any。
 * 为什么不把所有 part type 都列成严格 discriminatedUnion:
 *   - AI SDK 的 UIMessagePart 是一个持续演进的联合类型(TextUIPart / ReasoningUIPart /
 *     ToolUIPart / FileUIPart / SourceUIPart / StepStartUIPart / DataUIPart / ...),
 *     每个小版本都可能加新成员
 *   - Cherry Studio 还有自定义 DataUIPart(data-error / data-translation 等)
 *   - 如果在 IPC 契约里严格枚举所有 type,每次 AI SDK 升级都要改 schema —— 维护成本 >> 收益
 *
 * 折中:`z.object({ type: z.string() }).passthrough()` 保证每个 part 至少有 `type`
 * 字段(满足 discriminated union 的运行时可检查性),其余字段透传(不丢失任何数据)。
 * 如果需要对特定 part type 做深层验证,在消费侧用 narrowing + 专用 schema 处理,
 * 不在 IPC 传输层做。
 */
const uiMessagePartSchema = z.object({ type: z.string() }).passthrough()

export const userMessageContentSchema = z.object({
  role: z.literal('user'),
  data: z.object({
    parts: z.array(uiMessagePartSchema),
  }),
})

export const aiStreamRequestSchema = z.object({
  /**
   * 一次生成尝试的身份 —— Renderer 在用户点发送时 `crypto.randomUUID()` 生成。
   *
   * **唯一标识**:AiStreamManager 主表 key、`Ai_Stream_Abort` / `Ai_Stream_Detach` 精确路由键、
   * in-memory 去重键(rapid retry / 双击 / 网络重发幂等)。详见 Phase 2 Step 2.3
   * 的 "topicId / topicId 命名空间与并发约束" 小节。
   */
  topicId: z.string(),
  /**
   * 会话身份 —— = Cherry Studio SQLite `topics` 表的主键,同时用作 AI SDK
   * `useChat({ id })` 的状态复用 key。
   *
   * **数据平面身份**:push payload 的过滤键、DataApi 关联键。Renderer 侧
   * `chatId` 和 `topicId` 是同一样东西(AI SDK `useChat` 叫 chatId,我们 domain
   * 里一律叫 topicId,IPC 契约用 domain 术语)。
   */
  topicId: z.string(),
  /**
   * 显式父节点锚点 —— = 当前分支末端 message id(Renderer 从 `useQuery` 读树拿),
   * 或 `null` 表示 topic 的第一条消息。Main `messageService.create` **必须**用这个值
   * 作为 `parentId`,禁止 fall back 到 `topic.activeNodeId` 自动解析。
   *
   * 并发语义(`parentAnchorId` 陈旧快照 vs 严格线性 tip):见 Phase 2 Step 2.3
   * "未决的产品定性" TBD 标记,待产品侧拍板 A / B。
   */
  parentAnchorId: z.string().nullable(),
  /**
   * 触发本轮的用户消息 —— **只传内容,不传 id**。由 Main 端 `handleStreamRequest`
   * 步骤 1 在 `messageService.create` 事务里生成真实 SQLite id。
   */
  userMessage: userMessageContentSchema,
  /**
   * Assistant 身份 —— 写 `messages.assistantId` 字段,标记"这条 assistant 消息
   * 属于哪个 assistant 配置"(不同 assistant 可能共享同一 topic 作为讨论区)。
   */
  assistantId: z.string(),
  /**
   * 对话历史(**optional**)—— Phase 2 里 Main 权威地从 `messageService.getTree`
   * 读历史,Renderer **不需要**把整棵消息树再塞回来。这里保留 optional 是给
   * Phase 1(AiStreamManager 未落地)阶段的老路径做过渡;Phase 2 Step 2.3 之后应该不再
   * 传这个字段,Main 从 DB + `parentAnchorId` 自己拼 context window。
   */
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    parts: z.array(uiMessagePartSchema),
  }).passthrough()).optional(),
  /** Provider ID (e.g. 'openai', 'anthropic') */
  providerId: z.string().optional(),
  /** Model ID (e.g. 'gpt-4o', 'claude-sonnet-4-20250514') */
  modelId: z.string().optional(),
  /** Assistant 级别设置(temperature / maxTokens / prompt 等) */
  assistantConfig: assistantConfigSchema.optional(),
  /** Web search 配置 */
  websearchConfig: z.record(z.unknown()).optional(),
  /** 启用的 MCP tool IDs */
  mcpToolIds: z.array(z.string()).optional(),
  /** 知识库 IDs (RAG) */
  knowledgeBaseIds: z.array(z.string()).optional(),

  // ── 统一 agent 配置（chat 和 agent 都走 createAgent，以下字段控制行为差异）──

  /** 是否启用 agent 模式（启用 steering、权限审批、步骤进度推送） */
  agentMode: z.boolean().optional(),
  /** 最大步数，默认 20 */
  maxSteps: z.number().optional(),
  /** Agent 专属配置 */
  agentConfig: z.object({
    /** Session ID，用于 agent 会话管理 */
    sessionId: z.string().optional(),
  }).optional(),
  // 注意:
  // 1. 不再需要 `toolsRequiringApproval` — 每个 tool 在 ToolRegistry 注册时
  //    自带 needsApproval 声明，AI SDK 自动管理审批流程
  // 2. 不再有 `trigger: 'submit-message' | 'regenerate-message'` 和 `messageId` —
  //    Phase 2 的 AiStreamManager 模型下,regenerate 退化成"Renderer 生成新 topicId +
  //    指向被重新生成那条消息的父节点的 parentAnchorId",语义完全由 `topicId`
  //    + `parentAnchorId` 表达,AI SDK 那套 trigger/messageId 在我们的契约里是冗余
  // 3. 不再有 `chatId` — 和 `topicId` 是同一东西,统一用 domain 术语
})

/**
 * TypeScript 类型别名 —— Phase 2 Step 2.3 的 `AiStreamOpenRequest` **就是这个**,
 * 不再在 Phase 2 章节重复定义字段。如果两边字段对不上,以本 schema 为准。
 */
export type AiStreamOpenRequest = z.infer<typeof aiStreamRequestSchema>

/** AI SDK UIMessageChunk —— 同 uiMessagePartSchema 的理由,只验证 type 字段 */
export const uiMessageChunkSchema = z.object({ type: z.string() }).passthrough()
```

**操作**:
1. 新建 `packages/shared/ai-transport/` 目录
2. 新建 `schemas.ts` — Zod schema（同时作为 oRPC contract 和 TypeScript 类型来源）
3. 新建 `index.ts` — barrel export

### Step 1.17: 单元测试

**文件**:
- `src/main/ai/__tests__/AiService.test.ts`
- `src/main/ai/__tests__/AiCompletionService.test.ts`（已存在 mock 版测试，需更新）

**操作**:
1. AiService 测试: mock IPC，验证流式 chunk 推送
2. AiCompletionService 测试: mock createAgent，验证统一路径（chat: 用户配置 tools，agent: 自主 tools + steering + 进度推送）
3. 数据获取测试: 验证从各 service 获取数据并传参的逻辑
4. 集成测试: Renderer IPC → AiService → AiCompletionService → chunk 回传

---

## Phase 2: IPC 通道 + AiStreamManager 架构

**前置**: Phase 1
**产出**:
- Renderer 通过 IPC 调用 Main 的 AI 服务,流式回传 `UIMessageChunk`
- Main 端建立 `AiStreamManager` 作为"活跃流注册表",**按 `topicId` 索引**(一次生成尝试的身份),配合 `topicId → 当前活跃 topicId` 的辅助索引(给 steering 和多窗口观察者 attach 用);支持多订阅者、reconnect、grace period
- 持久化下沉到 Main 端 —— `PersistenceListener` 直接调 Main 端已有的 `messageService` singleton(`src/main/data/services/MessageService.ts`),不新增中间 Service。**注意**:Main 端**没有** Renderer 那个 HTTP-like `dataApiService` —— Renderer 客户端不能在 Main 里用,Main 直接用 service singleton
- Channel push 流和 Renderer user 流走同一套 AiStreamManager 机制,不再分两条路径

**负责人**: Person A (Main AiStreamManager + 持久化) + Person B (Renderer Transport + preload) + Person C (IPC channel 契约)

> **重要**:本阶段一次到位地把 AiStreamManager 架构建起来。之前版本的文档把这部分拆在 Phase 7 作为"事后补丁",踩过坑之后再补;现在前置到 Phase 2,避免 Phase 3/4 在错误的 Transport 基础上构建 Renderer 侧代码。架构详细设计见下方各 Step。

### Step 2.1: IPC Channel 定义

**修改文件**: `packages/shared/IpcChannel.ts`

**操作**:
1. 添加以下 channel 常量:
   ```typescript
   // === AiStreamManager 拥有的 4 个请求通道 ===
   Ai_Stream_Open   = 'ai:stream:open'     // Renderer → Main: 发送消息(AiStreamManager 按 topicId 判断开新 request 或 steer)
   Ai_Stream_Attach = 'ai:stream:attach'   // Renderer → Main: reconnect(支持 topicId 两种模式)
   Ai_Stream_Detach = 'ai:stream:detach'   // Renderer → Main: 按 topicId 主动退订(不 abort,流继续跑)
   Ai_Stream_Abort  = 'ai:stream:abort'    // Renderer → Main: 按 topicId abort 一次生成尝试

   // === Main → Renderer 推送通道(payload 同时带 topicId + topicId) ===
   Ai_StreamChunk = 'ai:stream-chunk'     // 流式 chunk 推送
   Ai_StreamDone  = 'ai:stream-done'      // 流结束
   Ai_StreamError = 'ai:stream-error'     // 流错误
   ```

**关键约束**:
- **两个 id,分工明确**:
  - `topicId` = Cherry Studio SQLite `topics` 主键,数据平面身份(`useChat({ id })` 复用 key、DataApi 关联、多窗口观察者反查)
  - `topicId` = Renderer 在 `sendMessages` 里 `crypto.randomUUID()` 生成,唯一标识(AiStreamManager 主表 key、abort/detach 路由、in-memory 去重)
- 详见 [topicId / topicId 命名空间与并发约束](#requestid--topicid-命名空间与并发约束) 小节
- 订阅者身份由 `(event.sender, topicId)` 联合确定 —— 同一 WebContents 对同一 request 只挂一个 Listener
- Payload 类型见 Step 2.6 的 **IPC 契约** 小节

### Step 2.2: Preload 暴露 AI API

**修改文件**: `src/preload/index.ts`

**操作**:
1. 在 `api` 对象中添加 `ai` 命名空间:
   ```typescript
   ai: {
     // 请求
     streamOpen:   (req) => ipcRenderer.invoke(IpcChannel.Ai_Stream_Open, req),
     streamAttach: (req) => ipcRenderer.invoke(IpcChannel.Ai_Stream_Attach, req),
     streamDetach: (req) => ipcRenderer.invoke(IpcChannel.Ai_Stream_Detach, req),
     streamAbort:  (req) => ipcRenderer.invoke(IpcChannel.Ai_Stream_Abort, req),

     // 推送监听(payload 按 topicId 过滤)
     onStreamChunk: (cb) => ipcRenderer.on(IpcChannel.Ai_StreamChunk, (_, data) => cb(data)),
     onStreamDone:  (cb) => ipcRenderer.on(IpcChannel.Ai_StreamDone,  (_, data) => cb(data)),
     onStreamError: (cb) => ipcRenderer.on(IpcChannel.Ai_StreamError, (_, data) => cb(data)),
   }
   ```

**修改文件**: `src/preload/preload.d.ts` — 添加对应类型声明(payload 类型见 Step 2.6)。

**注意**:
- **不暴露** `steerMessage` 接口 —— 用户追加消息直接调 `streamOpen`,AiStreamManager 内部根据当前 topic 是否有活跃流自动路由到 `steer` 或 `startStream`,Renderer 无感
- **`abort` 按 `topicId` 精确路由**(而不是 topicId)—— 这样 regenerate / stop+retry 场景下,迟到的 abort 不会误杀下一轮新流;同样地 `detach` 也按 `topicId`

### Step 2.3 及后续:AiStreamManager 架构详细设计

如果 Phase 2 只写一个朴素的 `IpcChatTransport`(一次 invoke 换一条流、`reconnectToStream` 返回 `null`、`cancel` 直接 abort)—— 看似能跑,但它会**强迫 Phase 3 走上错误的路线**,并在产品使用中踩到三个根本性问题:

1. **流的生命周期绑死在组件生命周期上**:`useChat` 内部用 `useRef` 持有 `Chat` 实例,组件 unmount → Chat GC → Transport 的 ReadableStream 被 cancel → `window.api.ai.abort(...)` 被调 → Main 端流被动杀。用户切 topic、关窗口、甚至仅仅路由跳转都会让"正在跑的流"被静默终止
2. **历史消息和活跃流被硬塞进同一个 `chat.messages`**:为了"切回 topic 能看到历史",朴素方案会把 SQLite 历史通过 `initialMessages` 灌进 `useChat`,导致 `Chat.messages` 同时装"DB 历史"和"正在流的消息",状态源不唯一,多窗口一致性难以保证
3. **为了保护上面两点,被迫造 `ChatSessionManager` 类似的 singleton**:把 `new Chat<...>()` 抬到服务层,用 refCount / reap timer / LRU 驱逐管理生命周期,`handleFinish` 方法里堆"持久化 + reasoning 规范化 + refresh 回灌 chat.messages + fulfilled 标记 + 通知"共 100+ 行 —— 这个服务会迅速演变成新的 Redux thunk,正是 v2 想消除的东西

> **历史注释**:在更早的文档版本里,上述三个问题被描述为"Phase 3 落地后才发现的 retrospective 问题",AiStreamManager 作为"Phase 7 补丁"事后追加。现在把它前置到 Phase 2,是吸取这个教训 —— 把正确的架构一次建对,不要给错的 Transport 留插入点。

### 现状:Renderer 侧已经有两条 transport 了

AiStreamManager 的价值不止是"让 Phase 3 不走弯路"—— 它还**同时修复了 v1 / 过渡期 v2 里已经存在的两条并存 transport**。这个现状很多人意识不到,所以单独列出来。

看 `src/renderer/src/store/thunk/messageThunk.ts`:

**通道 1 · HTTP SSE**(v1 遗留,用户主动发起的 agent chat)
`messageThunk.ts:421-461` 的 `createAgentMessageStream`:
```ts
const url = `${baseURL}/v1/agents/${agentId}/sessions/${sessionId}/messages`
const response = await fetch(url, {
  headers: { 'Accept': 'text/event-stream', ... }, ...
})
// → createSSEReadableStream → withAbortStreamPart → AiSdkToChunkAdapter → BlockManager
```
Renderer 直接 HTTP/SSE 打 API server,API server 调 `ClaudeCodeService.invoke`,再通过 SSE 把 chunks 推回 Renderer。`fetchAndProcessAgentResponseImpl` 走的就是这条路径。

**通道 2 · IPC push**(用于 IM channel 触发的 agent 回复)
`messageThunk.ts:2269-2338` 的 `setupChannelStream`:
```ts
const stream = new ReadableStream<TextStreamPart<...>>({
  start(controller) { streamController = controller }
})
// 返回 pushChunk / complete / error 供 Main 端通过 IPC 调用
```
Main 端 channel adapter 收到消息 → `ClaudeCodeService.invoke` → Main 端通过 IPC 调 Renderer 的 `pushChunk` → 注入到同样的 `BlockManager` 管线。

**两条路径的共同点**:终点都是 `AiSdkToChunkAdapter → BlockManager → 渲染`。也就是说 Renderer 侧的**消费管线早就统一了**,不统一的只是"chunks 怎么从 Main 流到 Renderer 这一段 transport"。两条 transport 各有一套解析器、错误处理、abort 语义、生命周期 —— 维护两遍。

**AiStreamManager 把这俩彻底合并**:

| 原路径 | AiStreamManager 之后 |
|---|---|
| HTTP SSE (`createAgentMessageStream`) | 删除整条 —— Renderer 不再打 API server 的 SSE endpoint |
| `createSSEReadableStream`(SSE 解析器) | 删除 |
| `withAbortStreamPart`(abort 语义 middleware) | 删除 |
| `fetchAndProcessAgentResponseImpl`(~150 行 orchestration) | 删除 |
| IPC push (`setupChannelStream`) | 删除,被 `WebContentsListener` 通用实现取代 |
| `addChannelUserMessage`(~50 行) | 删除,用户消息由 Main 端 `PersistenceListener` 落库 + DataApi 广播 |
| `ChannelStreamController` 类型 | 删除,AiStreamManager 的 `StreamListener` 接口取代 |
| API server 的 `/v1/agents/:id/sessions/:id/messages` SSE endpoint | Renderer 停止调用。保留为公共 API(给外部客户端)还是删除,由产品决定 |

估算 `messageThunk.ts` 里 **~500 行 Renderer 侧 transport + streaming 胶水代码**可以随 AiStreamManager 落地一起删掉;API server 侧的 SSE route 也可以简化或停用。这部分节省在"为什么值得做"小节里被列为独立收益。

### 根因溯源:"reconnectToStream 返回 null" 这个错误假设

朴素 Transport 方案的诱因来自一句错误注释:

```ts
// 错误的代码和注释
async reconnectToStream() { return null }
// "Electron IPC does not support stream reconnection" —— 错
```

IPC 本身完全支持 reconnect —— 它只是一个消息通道,既不知道也不关心"流"是什么概念。**reconnect 是应用层能力**,取决于 Main 端有没有:
- 按稳定 key(Cherry Studio 里就是 `topicId`)索引活跃流
- Buffer 已推送的 chunks 供回放
- 支持多订阅者(新 Renderer 接入时加入,旧 Renderer unmount 时退订)

如果 Main 端 `AiService.executeStream` 是"一次性管线":`topicId` 每次新生成、`target = event.sender` 硬绑单个 WebContents、`target.isDestroyed()` 就 break,没有 buffer、没有多订阅者,那 reconnect 确实没法做 —— 但这是 Main 端的实现选择,不是 IPC 的约束。

Phase 2 的核心设计就是把 Main 端从"一次性管线"升级成"按 `topicId` 索引的活跃流注册表"(即 `AiStreamManager`,`topicId` 是一次生成尝试的身份,`topicId` 保留作为会话维度 + steering/多窗口 attach 的反查键),让 Transport 的 `reconnectToStream` 从一开始就是真的。一旦可用,上面三个 Renderer 侧的问题全部自然消失。

### 设计总览

```
┌─────────────────── Renderer ───────────────────┐
│ 官方 useChat + IpcChatTransport(改造后)        │
│   ├─ sendMessages     → Ai_Stream_Open          │
│   ├─ reconnectToStream → Ai_Stream_Attach         │
│   └─ cancel            → Ai_Stream_Detach         │
│                                                │
│ 历史消息: useQuery('/topics/:id/messages')    │
└────────────────────────────────────────────────┘
                     ↕ IPC (req/resp 按 topicId;push 按 topicId)
┌─────────────────── Main ───────────────────────┐
│  AiStreamManager (新增 lifecycle 服务)           │
│  ┌──────────────────────────────────────────┐  │
│  │ activeStreams: Map<topicId, ActiveStream> │
│  │   - topicId / abortController / status   │  │
│  │   - buffer: UIMessageChunk[]             │  │
│  │   - listeners:  Map<listenerId, StreamListener>      │  │
│  │   - finalMessage (由上游 setFinalMessage)│  │
│  │                                          │  │
│  │ : Map<topicId, rid>  │  │
│  │   (反查索引,给 steering / byTopicId       │  │
│  │    attach / Open 路由判断用)             │  │
│  └──────────────────────────────────────────┘  │
│          ↓ 通过 InternalStreamTarget 委托          │
│  AiService.executeStream(target, req, options) │
│    options: { signal, pendingMessages }        │
│          ↓                                     │
│  AiCompletionService.streamText(req, signal)    │
└────────────────────────────────────────────────┘
                     ↓ 流完成
        PersistenceListener.onDone → SQLite (DataApi)
```

**两 id 分层原则**:Phase 2 架构有**两个** id,分管控制平面和数据平面,互不交叉:

| id | 平面 | 用途 |
|---|---|---|
| `topicId 作为唯一 key、`abort/detach/attach(byRequestId)` 精确路由、in-memory 去重键、一次生成尝试的身份 |
| `topicId` | 数据平面 | Listener.id 构造(`wc:X:topicId`, `persistence:topicId`,配合 steering 的 upsert 语义)、push payload 的过滤键、useChat `{ id }` 状态复用 key、DataApi 关联键、`attach(byTopicId)` 观察者模式 |

详见 [`topicId / topicId 命名空间与并发约束`](#requestid--topicid-命名空间与并发约束) 小节。

**核心抽象**:
- **`StreamListener`**:任何想消费 chunks 的东西都实现这个极窄接口。`WebContentsListener`(推给 Renderer)、`PersistenceListener`(写 SQLite)、`ChannelAdapterListener`(推回 Discord/飞书等)是三个内置实现
- **`InternalStreamTarget`**:伪装成 `WebContents` 的虚拟 target,实现 `send` + `isDestroyed` 两个方法,加上可选的 `setFinalMessage`。传给 `AiService.executeStream`,让它误以为在推给一个真 WebContents;内部把每个 chunk 记入 buffer、多播给所有 listeners;上游(agentLoop)在流结束前通过 `setFinalMessage` 塞进 AI SDK 工具产出的完整 UIMessage。`AiService` 主体方法对这些近乎无感,只在 `hooks.afterIteration` 里多一次 `target.setFinalMessage?.()` 调用

### 核心数据结构

```ts
// src/main/ai/stream-manager/types.ts

/**
 * AiStreamManager 传给 Listener 的终态 —— 区分"正常完成"vs"被用户中止"的半成品,
 * 保留 v1 ChatSession.handleFinish 的 success / paused 语义。
 *
 * 定义在 types.ts 而不是 PersistenceListener.ts,是因为它是 `StreamListener.onDone`
 * 的签名组成部分,所有 listener 实现都要引用它,不是 PersistenceListener 专属。
 */
export interface StreamDoneResult {
  finalMessage?: CherryUIMessage
  /** 'success' = 自然结束; 'paused' = abort/取消路径下,上游塞进来的部分结果 */
  status: 'success' | 'paused'
}

/**
 * `AiService.executeStream` 实际使用的 WebContents 子集 —— 一次流的"出口"接口。
 *
 * `send` / `isDestroyed` 是原本 `Electron.WebContents` 就有的两个方法。
 * `setFinalMessage` 是 AiStreamManager 专用的可选扩展 —— 上游(agentLoop)
 * 在流结束前把 AI SDK 工具函数产出的完整 UIMessage
 * 通过这个 setter 传下来,避免 AiStreamManager 自己 rebuild。
 *
 * 定义在 types.ts 是因为:
 *   1. `AiService.executeStream` 的签名就用它作为参数类型(见"对 AiService
 *      的最小侵入清单"小节),是 Phase 2 分层的关键接口,不是 InternalStreamTarget
 *      私有
 *   2. 理论上任何"流的出口"(比如 unit test 里的 MockStreamTarget)都可以实现它,
 *      放在类型文件里让测试代码不用 import InternalStreamTarget
 */
export interface StreamTarget {
  send(channel: string, payload: { chunk?: UIMessageChunk; error?: SerializedError }): void
  isDestroyed(): boolean
  /** Optional:上游用 AI SDK 工具产出完整 UIMessage 后写进来 */
  setFinalMessage?(message: CherryUIMessage): void
}

/**
 * 流的消费者抽象。AiStreamManager 不区分 listener 的种类,通过四个方法统一调度。
 * listener 的任何内部状态/分类都封装在实现内部,不向外暴露。
 */
export interface StreamListener {
  /**
   * 稳定唯一标识,用于:
   *   - listeners 集合去重(同一个订阅者不重复加入)
   *   - detach 时精确定位
   *   - 日志 trace
   * 实现者负责保证唯一。AiStreamManager 不解析它的内容。
   */
  readonly id: string

  onChunk(chunk: UIMessageChunk): void
  /**
   * 流结束(**包含 success 和 paused 两种终态**)。AiStreamManager 传入一个终态对象:
   *
   *   - `result.finalMessage` 由上游(agentLoop.afterIteration hook)通过
   *     `InternalStreamTarget.setFinalMessage` 在 onDone 之前塞进 `stream.finalMessage`,
   *     由 AiStreamManager 原样转发给每个 listener。可能为 `undefined`(上游未提供或异常路径);
   *     listener 自己决定 undefined 时如何降级。
   *   - `result.status` 区分"自然结束"('success')和"用户中止时的半成品"('paused'),
   *     对应 v1 `ChatSession.handleFinish:114-127` 的 success/paused 分支。
   *     AiStreamManager 根据"终止路径是自然 agentLoop 兑现 还是 abortController 触发"决定;
   *     Listener 可以用这个字段决定是否执行 post-done 副作用(rename / metering 等)。
   *
   * 为什么是对象而不是多参数:新增终态字段时不用改所有 listener 的签名,只加字段即可。
   */
  onDone(result: StreamDoneResult): void | Promise<void>
  onError(error: SerializedError): void | Promise<void>

  /**
   * Listener 的**存活检查**(liveness),不是"生命周期阶段"。
   *
   * AiStreamManager 在多播 chunks 时调用 isAlive() 判断该 listener 是否还应该收事件:
   *   - `false` → AiStreamManager 立即从 listeners map 里剔除它,不再收到任何后续回调
   *   - `true`  → 继续接收 onChunk/onDone/onError
   *
   * 各 listener 的存活条件:
   *   - `WebContentsListener`  = `!wc.isDestroyed()`(窗口未销毁)
   *   - `ChannelAdapterListener` = `adapter.connected`(IM adapter 未断线)
   *   - `PersistenceListener`  = `true`(永远,直到流结束被 AiStreamManager 显式删除)
   *
   * ⚠️ 这和文档里其他两个"生命周期"是**不同层次**的概念,不要混淆:
   *   1. **BaseService 生命周期**(`@Injectable` + `onInit/onStop`)是 DI 容器
   *      管理的**服务**级别生存期,per app 一次。AiStreamManager 本身是一个
   *      BaseService,但 AiStreamManager 里的单个 Listener 不是。
   *   2. **`agentLoop` 执行钩子**(`onStart/beforeIteration/onStepFinish/
   *      afterIteration/onFinish`,见 `src/main/ai/agentLoop.ts:28`)是
   *      **一次流执行内部的时序阶段**,per stream 一次,用于让 AiService
   *      在 agentLoop 执行到某一步时做事。Listener 完全不参与这个时序 ——
   *      Listener 只接收流 **事件**(chunk/done/error),不接收执行 **阶段**。
   *
   * 简言之:
   *   - BaseService 生命周期 = "这个服务实例什么时候活着"(coarse,per app)
   *   - agentLoop 执行钩子 = "这次流执行到哪一步了"(fine,per iteration)
   *   - Listener `isAlive()` = "这个 observer 还有效吗"(瞬时 boolean,per check)
   */
  isAlive(): boolean
}

export interface ActiveStream {
  /**
   * AiStreamManager 控制平面的**主身份** —— 一次生成尝试的唯一 id,由 Renderer 在用户点
   * 发送时生成 UUID 并随 `Ai_Stream_Open` 传入。
   *
   * **为什么不直接用 topicId 做主 key**:`topicId` 是会话身份(整棵消息树),
   * 一个会话生命周期内会发生**多次生成尝试**(第一次发送、重新生成、用户 stop
   * 后再次发送……)。如果用 topicId 作为路由 key,那么:
   *   - 迟到的 `abort` 区分不出是"上一次的取消"还是"下一次的取消"
   *   - 迟到的 `attach` 可能错挂到下一轮流上,拿错 finalMessage
   *   - Listener 的生命周期被压进"整个 topic"的时间轴,per-turn 的副作用会跨轮串台
   * 所以控制平面(`abort`/`attach`/`done`/Listener id)必须按 `topicId` 路由,
   * `topicId` 保留为"数据平面"身份(useChat 复用 key、DataApi 关联键、
   * steering 聚合的归属判断)。
   */
  topicId: string

  /** 数据平面身份 —— Cherry Studio 对话的 topicId,整个 ActiveStream 生命周期不变 */
  topicId: string

  /** AiStreamManager 拥有的 AbortController,独立于 Renderer 生命周期。
   *  AiStreamManager 直接持有,通过 abortController.abort() 掐流。 */
  abortController: AbortController

  /** 所有消费者。key = listener.id。AiStreamManager 不关心 value 的具体类型。 */
  listeners: Map<string, StreamListener>

  /**
   * Steering 队列(搬自 Phase 1 的 `PendingMessageQueue`,按 topicId 归属)。
   *
   * 当用户在流进行中继续发消息时,这些消息入本队列,**不创建新 topicId**
   * (后续发送只是 steer 当前轮,不算新轮次)。`runAgentLoop` 的 `prepareStep`
   * (内层步间)和外层循环边界都会 drain 这个队列,把新消息拼进下一轮 context。
   * 流 reap 时随 ActiveStream 一起 GC,无需独立注册表。
   */
  pendingMessages: PendingMessageQueue

  /** 已推送 chunks 的顺序缓存,供 reconnect 回放 */
  buffer: UIMessageChunk[]

  status: 'streaming' | 'done' | 'error' | 'aborted'

  /**
   * 流完成后的完整 UIMessage。
   *
   * **由上游(agentLoop)通过 `InternalStreamTarget.setFinalMessage()`
   * 在流结束前塞进来**,AiStreamManager 自己不 rebuild —— 直接复用 AI SDK 的
   * `readUIMessageStream` 等工具函数产出,避免重造 chunk 状态机。
   *
   * 可能为 `undefined`(上游没提供 / 流异常中断 / 旧路径直接调 executeStream
   * 不走 agentLoop 的 afterIteration hook)。listener 自己决定 undefined 时怎么降级。
   */
  finalMessage?: CherryUIMessage

  error?: SerializedError

  /** done 之后保留至此时刻,供迟到的 reconnect 读取 finalMessage */
  reapAt?: number

  /** scheduleReap 记录的 timer handle,用于被 startStream 提前驱逐(见 grace period 处理) */
  reapTimer?: ReturnType<typeof setTimeout>

  /**
   * Backend-specific resume token(可选,目前只有 ClaudeCodeService 路径用)。
   *
   * Claude Agent SDK 的 init 消息会携带一个 `session_id`(见
   * `src/main/services/agents/services/claudecode/index.ts:864`),下次 invoke
   * 时传给 `options.resume` 即可在 SDK 内部续跑。adapter 在 init chunk 到达时
   * 写入这个字段,startStream 新建流时检查并作为 `lastAgentSessionId` 传回。
   *
   * 纯 AiCompletionService 路径(普通 chat)不使用这个字段,留空即可。
   *
   * ⚠️ 这是 backend-owned metadata,不是"流的类型 discriminator"。AiStreamManager
   *    主体代码不读它,只由 claude-code provider 路径写入和读回。
   */
  sourceSessionId?: string
}

export interface AiStreamManagerConfig {
  /** 流完成后在内存中保留多久,供迟到的 reconnect 使用 */
  readonly gracePeriodMs: number      // default 30_000
  /** 无订阅者时是否继续后台跑完 */
  readonly backgroundMode: 'continue' | 'abort'  // default 'continue'
  /** 单条流的 buffer 上限,超出停止 buffer 但不影响实时多播 */
  readonly maxBufferChunks: number    // default 10_000
}
```

**关键约束(写进 `AiStreamManager` 注释作为不变量)**:

1. AiStreamManager 不得通过 `instanceof`、`id` 前缀解析、或任何其他方式判别 listener 的具体类型。所有分派都通过 `StreamListener` 的四个方法完成
2. 任何针对特定种类 listener 的行为都必须封装在该 listener 的实现内部。若 AiStreamManager 需要新的协调能力,扩展 `StreamListener` 接口,不要绕过去
3. Listeners 相互独立:单个 listener 抛异常或死亡不得影响其他 listener 或流本身
4. `listener.id` 唯一性由实现者负责,AiStreamManager 把重复 id 当作 upsert(新替换旧)
5. `PersistenceListener` 是否挂载是 `startStream` 的前置条件,由调用方决定;AiStreamManager 不做"没挂就兜底挂一个"这种隐式行为 —— 有些场景(playground / debug 试跑)就是故意不落库

### InternalStreamTarget:伪装的 WebContents

`StreamTarget` interface 已经在 `types.ts` 里定义(见上方"核心数据结构"小节)。这里是它的 AiStreamManager 专用实现 —— 一个"伪装成 WebContents 的出口",让 `AiService.executeStream` 不用知道它在跟 AiStreamManager 说话。

```ts
// src/main/ai/stream-manager/InternalStreamTarget.ts
import type { StreamTarget } from './types'

export class InternalStreamTarget implements StreamTarget {
  /**
   * **按 topicId 绑定**,不是 topicId。
   *
   * 为什么:target 是一次生成尝试的"出口",它代表"这条具体的流",而"这条具体
   * 的流"的身份就是 AiStreamManager 控制平面的 `topicId`。上游 agentLoop / ClaudeCodeStream
   * 产生的 chunk / done / error 事件都要精确回到这条流,不能按 topicId 路由
   * (否则在同一 topic 的前一轮流刚结束、下一轮立刻开始的场景下,迟到的事件会
   * 挂错流)。
   */
  constructor(
    private readonly broker: AiStreamManager,
    private readonly topicId: string
  ) {}

  send(channel: string, payload: { chunk?: UIMessageChunk; error?: SerializedError }): void {
    switch (channel) {
      case IpcChannel.Ai_StreamChunk:
        if (payload.chunk) this.manager.onChunk(this.topicId, payload.chunk)
        break
      case IpcChannel.Ai_StreamDone:
        void this.manager.onDone(this.topicId)
        break
      case IpcChannel.Ai_StreamError:
        if (payload.error) void this.manager.onError(this.topicId, payload.error)
        break
    }
  }

  isDestroyed(): boolean {
    return this.manager.shouldStopStream(this.topicId)
  }

  /**
   * 上游在流结束前调这个方法,把 AI SDK 产出的完整 UIMessage 塞进 stream。
   *
   * 调用时序:
   *   1. agentLoop 消费 result.toUIMessageStream(),每个 chunk 走 send(Ai_StreamChunk)
   *   2. 流结束后,agentLoop 的 afterIteration hook 用 AI SDK 工具从 result 拿 UIMessage
   *   3. AiService 把 uiMessage 通过 target.setFinalMessage?.() 传下来
   *   4. AiService 调 send(Ai_StreamDone) → manager.onDone → 分发到 listeners(此时 stream.finalMessage 已经就位)
   *
   * Claude Code 作为标准 AI SDK provider 走同一条 agentLoop 路径,无需额外 adapter。
   */
  setFinalMessage(message: CherryUIMessage): void {
    // @ts-expect-error 访问 AiStreamManager 内部 map,或在 AiStreamManager 上暴露 setter 方法
    const stream = this.manager.activeStreams.get(this.topicId)
    if (stream) stream.finalMessage = message
  }
}
```

> **InternalStreamTarget 的两个职责**:
> 1. **收 chunks**(通过 `send` 的 `.chunk` / `.error` 字段)—— 实时多播给 listeners
> 2. **收最终 UIMessage**(通过 `setFinalMessage`)—— 由上游从 AI SDK 工具拿现成的,AiStreamManager 自己不造轮子
>
> 两条路径都是"上游塞什么我存什么",没有任何 rebuild 状态机。`UIMessageAccumulator` 类不存在。

### 三个内置 Listener 实现

```ts
// src/main/ai/stream-manager/listeners/WebContentsListener.ts

export class WebContentsListener implements StreamListener {
  /**
   * 订阅者身份 = `(wc.id, topicId)` —— 同一窗口对同一 topic 只订阅一次。
   *
   * **为什么 id 按 topicId 而不是 topicId**:这是数据平面 vs 控制平面的分层。
   * 同一个 topic 的 steering 路径下,Renderer 连续发 msg1/msg2 时,AiStreamManager 会把
   * msg2 的 listeners 追加到 msg1 的 ActiveStream.listeners Map 里。如果 WebContentsListener
   * 的 id 按 topicId 构造,msg1 的 `wc:X:R1` 和 msg2 的 `wc:X:R2` 会**同时存在**,
   * onChunk 会往同一个 WebContents **双发**每条 chunk,UI 上重影。用 topicId
   * 作为 id 可以让第二个 listener 通过 upsert **替换**第一个,只保留一条订阅。
   *
   * 跨轮次隔离不需要 listener id 保证 —— 两轮对应两个不同的 ActiveStream 实例,
   * 各自拥有独立的 listeners Map,从来不会同时出现在同一个 Map 里。
   */
  readonly id: string

  constructor(
    private readonly wc: Electron.WebContents,
    private readonly topicId: string
  ) {
    this.id = `wc:${wc.id}:${topicId}`
  }

  onChunk(chunk: UIMessageChunk): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamChunk, {
      topicId: this.topicId,
      chunk
    } satisfies AiStreamChunkPayload)
  }

  onDone(result: StreamDoneResult): void {
    // WebContentsListener 不关心 finalMessage —— Renderer 侧的 useChat 自己会从 chunks 重建 UIMessage。
    // 但要把 status ('success' | 'paused') 转发给 Renderer,让 UI 能区分"自然结束"和"被中止的半成品"。
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamDone, {
      topicId: this.topicId,
      status: result.status
    } satisfies AiStreamDonePayload)
  }

  onError(error: SerializedError): void {
    if (this.wc.isDestroyed()) return
    this.wc.send(IpcChannel.Ai_StreamError, {
      topicId: this.topicId,
      error
    } satisfies AiStreamErrorPayload)
  }

  isAlive(): boolean {
    return !this.wc.isDestroyed()
  }
}
```

> **push payload 为什么只带 topicId 不带 topicId**:数据平面(chunk 推送 + Renderer 过滤)用 topicId 就够了 —— useChat 给我们的 chatId 就是 topicId,transport 的 listener 按 topicId 过滤;多窗口观察者天然走这条路径;steering 路径下两次发送的 chunks 本来就属于**同一条流**(同一个 ActiveStream,单个 PersistenceListener,线性持久化),所以用 topicId 过滤正是正确的聚合语义。控制平面(abort/detach/attach)才需要 topicId 做精确路由 —— 那是另一层,和 chunk 分发无关。

```ts
// src/main/ai/stream-manager/listeners/PersistenceListener.ts

// 注意:Main 端没有 `dataApiService.post(...)` 这种 HTTP-like 客户端。
// `src/main/data/DataApiService.ts` 是 lifecycle 协调器(只有 getApiServer/start/stop),
// HTTP-like 的 `dataApiService` 仅存在于 Renderer (`src/renderer/src/data/DataApiService.ts`),
// 底层走 `window.api.dataApi.request`,Main 根本不能调用。
// 所以 PersistenceListener 直接调用 Main 端真正的 `MessageService` singleton。
import { messageService } from '@main/data/services/MessageService'
import type { StreamListener, StreamDoneResult } from '../types'

export interface PersistenceListenerOptions {
  /** 一次生成尝试的身份 —— **仅用于日志/trace**,不参与 listener.id 构造。
   *  listener.id 按 topicId 构造(见 constructor 注释),这里留一个 topicId 字段是
   *  为了 onDone 里写 warn/info 日志时能带上 topicId 做追溯。 */
  topicId: string
  topicId: string
  assistantId: string
  /** 触发本轮流的 user message 的 id —— 由 `handleStreamRequest` 在 Main 端
   *  **原子落库 user message 之后**回填得到,不接受 Renderer 传入的 id。
   *  这样既避开 `streamingService.createUserMessage` 的 activeNodeId 竞态,
   *  也保证 PersistenceListener 拿到的 parent 是**真实存在于 SQLite 的** message id。 */
  parentUserMessageId: string
  /**
   * 持久化成功后的可选钩子(post-persist hook)。
   *
   * 用途:agent session 自动重命名、usage 上报、知识库回填、telemetry 收尾……
   * 所有"只关心 finalMessage + 在落库成功后做一次"的业务副作用,都在这里注入。
   * 由调用方(`handleStreamRequest` / `ChannelMessageHandler` / Agent scheduler)
   * 按场景构造闭包传入。PersistenceListener 本身不 care 里面做什么。
   *
   * 失败不影响落库结果 —— PersistenceListener 内部会 try/catch 包一层,只 warn 不 throw。
   */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class PersistenceListener implements StreamListener {
  readonly id: string

  constructor(private readonly ctx: PersistenceListenerOptions) {
    // id 按 topicId 构造,**不用 topicId**。
    //
    // 关键原因:steering 路径下,用户连续发送的消息会被路由成"同 topic 现有流的
    // 追加",新来的 PersistenceListener 必须 **upsert 替换**旧的(更新 parentUserMessageId
    // 为最新一条 steered user message),才能保证 onDone 时只写一条 assistant 且
    // parent 正确。如果用 topicId 作为 id,两次的 PersistenceListener 会**共存**在
    // 同一个 ActiveStream.listeners Map 里,onDone 触发两次,导致同一次 AI 回复被
    // 复制成两条 DB 记录(parent 一条指 U1 一条指 U2),破坏 v1 的"steering = 线性链"
    // 语义(U1 → U2 → A,只有一条 A)。
    //
    // 跨轮次隔离不需要靠 listener id 保证 —— 两轮对应两个不同的 ActiveStream 实例,
    // 各自拥有独立的 listeners Map,从来不会同时出现在同一个 Map 里。
    this.id = `persistence:${ctx.topicId}`
  }

  onChunk(_chunk: UIMessageChunk): void {
    // no-op:持久化只在 onDone 一次性写入
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    const { finalMessage, status } = result

    // v1 ChatSession.handleFinish:114-127 的降级逻辑:没有 finalMessage
    // 就跳过落库(没有任何内容可以持久化),和历史行为一致。
    // 注意:paused + 有 partial finalMessage 仍然要落库,只是 status 标成 paused。
    if (!finalMessage) {
      logger.warn('PersistenceListener.onDone without finalMessage, skipping persistence', {
        topicId: this.ctx.topicId,
        status
      })
      return
    }

    // 1. 核心职责:落库。调 Main 端 `MessageService.create` —— 显式传
    //    `parentId = parentUserMessageId`,绝不走 activeNodeId 自动解析,
    //    从源头避开 "多窗口同时改 activeNodeId 导致 parent 挂错分支" 的竞态。
    const totalTokens = finalMessage.metadata?.totalTokens
    await messageService.create(this.ctx.topicId, {
      role: 'assistant',
      parentId: this.ctx.parentUserMessageId,   // 显式,不允许 undefined
      assistantId: this.ctx.assistantId,
      data: { parts: finalMessage.parts },
      status,                                    // 'success' | 'paused' —— 保留 v1 语义
      ...(totalTokens !== undefined && { stats: { totalTokens } })
    })

    // 2. 可选 hook:调用方注入的 post-persist 业务副作用
    //    注意 try/catch —— hook 的失败不影响落库结果,也不阻断 AiStreamManager.onDone 对
    //    其他 listener 的分发(AiStreamManager 的 listener loop 本身也有 try/catch,这里是双保险)。
    //    也不 await paused 分支:被用户中止的流通常不需要触发 rename / metering,
    //    afterPersist 只在 success 路径下跑。
    if (status === 'success' && this.ctx.afterPersist) {
      try {
        await this.ctx.afterPersist(finalMessage)
      } catch (err) {
        logger.warn('afterPersist hook threw', { topicId: this.ctx.topicId, err })
      }
    }
  }

  async onError(_error: SerializedError): Promise<void> {
    // 策略待定:建议不落错误消息(和当前 ChatSession.handleFinish 行为一致)
  }

  isAlive(): boolean {
    return true
  }
}
```

> **为什么 PersistenceListener 不新建一个 `MessagePersistenceService`**:Main 端真正的持久化入口就是 `messageService`(`src/main/data/services/MessageService.ts` 的 named export singleton)—— 它已经是 DataApi 后面的 SQLite 写入实现,自带事务 + parent 校验 + activeNodeId 维护。PersistenceListener 直接调它即可,再造一个 `MessagePersistenceService.saveExchange()` 只是无意义的间接(v1 `ChatSession.handleFinish` 走的是 Renderer 端 `dataApiService.post` HTTP 客户端,Phase 2 之后持久化改在 Main 端,自然用 Main 端的同一个 service singleton)。整个 PersistenceListener 文件 < 60 行。
>
> **user message 为什么不是 PersistenceListener 的职责(但也不能让 Renderer 自己落)**:Renderer 端 `streamingService.createUserMessage`(`messageThunk.ts:1068`)有一个已知竞态:它不传 `parentId`,依赖 `topic.activeNodeId` 做自动解析,多窗口同时操作同一 topic 时容易挂错分支。Phase 2 之后的策略是:
>
> - **Renderer 在 `Ai_Stream_Open` 请求里同时传 `userMessage` 的完整内容 + 一个显式的 `parentAnchorId`**(= 当前分支末端的 message id,来自 `useQuery` 读出的树状态,Renderer 侧本来就有)
> - **Main 端 `handleStreamRequest` 在一个事务内完成"落 user message → 起流 → 构造 PersistenceListener(parentUserMessageId = 刚落的 user.id)"**,整个过程显式 `parentId`,完全不碰 `topic.activeNodeId` 自动解析
> - PersistenceListener 仍然只管 assistant message,但它拿到的 `parentUserMessageId` 是 Main 端刚刚原子落库完的真实 id,不再信任 Renderer 传来的任何外键
>
> ChannelMessageHandler / Agent scheduler 路径同理:由它们自己在 Main 端先调 `messageService.create` 落 user message 再构造 PersistenceListener。
>
> **关键**:`streamingService.createUserMessage` 这个 Renderer 函数在 Phase 2 Step 2.6 **整个删掉**,不再是 v2 对话路径的一部分。
>
> **reasoning parts 规范化的 `thinking_millsec → cherry.thinkingMs`**:如果 Phase 1 的 stream plugin 已经产出规范化的 provider metadata,这一步不需要;如果还没,抽一个 10 行的 `normalizeReasoningParts(parts)` 纯函数,在 onDone 里调一次。**不是 Service,是 util。**

```ts
// src/main/ai/stream-manager/listeners/ChannelAdapterListener.ts

export class ChannelAdapterListener implements StreamListener {
  readonly id: string
  /** 兜底用的文本累积 —— 当上游没提供 finalMessage 时从这里拼 */
  private fallbackText = ''

  constructor(
    private readonly adapter: ChannelAdapter,
    private readonly platformChatId: string
  ) {
    this.id = `channel:${adapter.channelId}:${platformChatId}`
  }

  onChunk(chunk: UIMessageChunk): void {
    // 主路径:不流式推送 —— 多数 IM 平台不支持 message edit,逐字推送体验差。
    // 兜底:同时累积 text-delta,万一上游没给 finalMessage 也能发一条凑合的纯文本
    if (chunk.type === 'text-delta') {
      this.fallbackText += chunk.delta
    }
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    // 优先用 finalMessage 提取结构化纯文本(会忽略 reasoning / tool-call 等非展示 part)。
    // paused 状态也正常发送 —— 把已产生的部分内容推回 IM 平台比默默吞掉更符合用户预期。
    const text = result.finalMessage ? extractPlainText(result.finalMessage) : this.fallbackText
    if (!text) return
    const suffix = result.status === 'paused' ? '\n\n_(已中止)_' : ''
    await this.adapter.sendMessage(this.platformChatId, text + suffix)
  }

  async onError(error: SerializedError): Promise<void> {
    await this.adapter.sendMessage(
      this.platformChatId,
      `⚠️ ${error.message ?? 'Unknown error'}`
    )
  }

  isAlive(): boolean {
    return this.adapter.connected
  }
}
```

### AiStreamManager 骨架

```ts
// src/main/ai/stream-manager/AiStreamManager.ts

@Injectable('AiStreamManager')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiService'])
export class AiStreamManager extends BaseService {
  /**
   * 主注册表 —— **按 topicId 索引**。这是 AiStreamManager 控制平面的权威 Map。
   * 一次生成尝试 = 一条 ActiveStream = 一个 topicId。
   *
   * 为什么不按 topicId 索引(v1 / Phase 2 早期设计):
   *   见 `ActiveStream.topicId` 字段的注释 —— 一个 topic 生命周期内会发生多次
   *   生成尝试(发送、regenerate、stop-and-retry),控制平面消息(abort/attach/
   *   done)必须能区分是哪一次,topicId 粒度太粗。
   */
  private readonly activeStreams = new Map<string /* topicId */, ActiveStream>()

  /**
   * 辅助反查索引 —— 按 `topicId` 查"当前活跃 request"。
   *
   * 用途:
   *   1. **Steering**:用户在流进行中继续发消息,AiStreamManager 需要找到"这个 topic
   *      正在跑的那条 ActiveStream"并把新消息入 pendingMessages。steering 消息
   *      只认 topic,不认 topicId(用户不知道 topicId 是什么)。
   *   2. **多窗口观察者 attach**:第二个窗口打开同一个 topic 时,它只知道
   *      topicId(useQuery 读出来的),不知道原始发起者生成的 topicId。
   *      `Ai_Stream_Attach` 的 topicId 模式通过这个索引查到当前活跃 request
   *      并挂 WebContentsListener 上去。
   *   3. **去重**:Renderer 重复调 `Ai_Stream_Open` 时,先按 topicId 查主表;
   *      但"旧 request 结束了又来新 request"的判断也可以用这个索引快速剔除。
   *
   * 只记录 `status === 'streaming'` 的流;进入 done/error/aborted 后立即清理,
   * 避免 Attach 误挂到已完成的旧流。
   */
  private readonly  = new Map<string /* topicId */, string /* topicId */>()

  private readonly config: AiStreamManagerConfig = {
    gracePeriodMs: 30_000,
    backgroundMode: 'continue',
    maxBufferChunks: 10_000
  }

  protected async onInit(): Promise<void> {
    // === IPC handlers(供 Renderer 使用) ===
    this.ipcHandle(IpcChannel.Ai_Stream_Open, (event, req: AiStreamOpenRequest) =>
      this.handleStreamRequest(event.sender, req)
    )
    this.ipcHandle(IpcChannel.Ai_Stream_Attach, (event, req: AiStreamAttachRequest) =>
      this.handleAttach(event.sender, req)
    )
    this.ipcHandle(IpcChannel.Ai_Stream_Detach, (event, req: AiStreamDetachRequest) =>
      this.handleDetach(event.sender, req)
    )
    this.ipcHandle(IpcChannel.Ai_Stream_Abort, (_, req: AiStreamAbortRequest) =>
      this.abort(req.topicId, 'user-requested')
    )

    // WebContents 销毁时自动清理它挂载的所有 listeners
    this.registerDisposable(
      onWebContentsDestroyed((wc) => this.cleanupByWebContents(wc))
    )
  }

  // === Main 内部 API(供 ChannelMessageHandler / AgentScheduler 等使用) ===

  /**
   * 启动一条新流。调用方负责构造所有初始 listeners —— 持久化不是隐式兜底。
   *
   * 语义:
   *   - 如果 topicId 主表里没有这条流 **且** topicId 没有活跃流 → 创建新 ActiveStream
   *   - 如果 topicId 主表命中(重复调用,in-memory 去重) → **直接返回现有 stream**,
   *     不重开、不重新跑 AI,整个调用变成幂等(配合 Renderer 重试)
   *   - 如果 topicId 有 done/error/aborted 状态的旧流(grace period 内) → 提前驱逐旧流
   *   - 如果 topicId 有 streaming 状态的流(topicId 不同)→ 抛 ConflictError
   *     —— 正常路径不应该走到这里,想"同 topic 继续发消息"应该走 `send()` 让它 route 到 steer
   */
  startStream(input: {
    topicId: string
    topicId: string
    request: AiStreamRequest
    listeners: StreamListener[]
  }): ActiveStream {
    // 内存去重:同一 topicId 重复到达 → 返回现有 stream,绝不重复执行
    const existingByRequest = this.activeStreams.get(input.topicId)
    if (existingByRequest) {
      // 把本次调用想挂的新 listeners 追加上去(重试场景下 Renderer 的 WebContents
      // 可能换了,需要让新 WebContentsListener 接上,但 PersistenceListener 由第一次
      // 调用已挂,这里 listener.id 去重会自动吞掉重复)
      for (const listener of input.listeners) this.addListenerByRequestId(input.topicId, listener)
      return existingByRequest
    }

    let inheritedSessionId: string | undefined
    const existingRequestIdForTopic = this..get(input.topicId)
    if (existingRequestIdForTopic) {
      const existing = this.activeStreams.get(existingRequestIdForTopic)
      if (existing) {
        if (existing.status === 'streaming') {
          throw new ConflictError(
            `Topic ${input.topicId} already has an active stream (topicId=${existingRequestIdForTopic}); use send() to steer instead of startStream()`
          )
        }
        // grace period 内的 done/error/aborted —— 提前驱逐旧 request,放行新 request
        // 注意:evict 之前抄下 sourceSessionId,这样 Claude Code 路径可以跨 evict
        //       继续 resume 上一轮的 SDK session
        inheritedSessionId = existing.sourceSessionId
        this.evictStream(existingRequestIdForTopic, existing)
      }
    }

    const stream: ActiveStream = {
      
      topicId: input.topicId,
      abortController: new AbortController(),
      listeners: new Map(input.listeners.map((s) => [s.id, s])),
      pendingMessages: new PendingMessageQueue(),
      buffer: [],
      status: 'streaming',
      sourceSessionId: inheritedSessionId
      // finalMessage 字段不在这里初始化;等上游 agentLoop.afterIteration 把它塞进来
    }
    this.activeStreams.set(input.topicId, stream)
    this..set(input.topicId, input.topicId)

    const target = new InternalStreamTarget(this, input.topicId)
    const aiService = application.get('AiService')

    // 把 AiStreamManager 拥有的 signal + pendingMessages 传进去 ——
    // AiService 不再自己管 AbortController 注册表,
    // agentLoop.prepareStep 从 stream.pendingMessages 取 steering 消息
    void aiService
      .executeStream(target, input.request, {
        signal: stream.abortController.signal,
        pendingMessages: stream.pendingMessages
      })
      .catch((err) => this.onError(input.topicId, serializeError(err)))

    return stream
  }

  /**
   * Steer:在已有流中追加一条用户消息。
   *
   * **按 topicId 路由**(用户视角只有 topic,不知道 topicId)。
   * 不创建新流,只把消息推进 pendingMessages 队列。正在跑的 `runAgentLoop`
   * 会在 `prepareStep`(内层步间)或外层循环边界 drain 并拼进 context。
   */
  steer(topicId: string, message: CherryUIMessage): boolean {
    const topicId = this..get(topicId)
    if (!topicId) return false
    const stream = this.activeStreams.get(topicId)
    if (!stream || stream.status !== 'streaming') return false
    stream.pendingMessages.push(message)
    return true
  }

  /**
   * Send:统一的"为某 topic 发消息"入口 —— IPC handler 和 Main 内部调用者都走这里。
   *
   * 路由逻辑(**按 topicId 判断,不按 topicId**):
   *   - 该 topic 已有 streaming 流 → `steer()` + 把发起者的 listeners 追加到**已有那条流**上
   *     (注意:此时传入的 `topicId` **被忽略**,steering 不算新轮次)
   *   - 该 topic 没有流 / 流已结束 → `startStream(topicId, ...)` 开新流
   *
   * 这个语义保证了"用户在流进行中连发多条消息"被合并到同一轮,不会因为 Renderer
   * 每次生成新 topicId 就误开新流。
   */
  send(input: {
    topicId: string
    topicId: string
    request: AiStreamRequest
    userMessage: Message          // 本次用户发的消息(已原子落库,见 handleStreamRequest)
    listeners: StreamListener[]           // 本次发起者的 listeners(通常是 WebContentsListener + PersistenceListener)
  }): { mode: 'started' | 'steered'; activeRequestId: string } {
    const activeRequestId = this..get(input.topicId)
    if (activeRequestId) {
      const existing = this.activeStreams.get(activeRequestId)
      if (existing?.status === 'streaming') {
        // Steering 路径:把消息入队,把发起者的 listeners 挂到已有流上
        existing.pendingMessages.push(input.userMessage)
        for (const listener of input.listeners) this.addListenerByRequestId(activeRequestId, listener)
        return { mode: 'steered', activeRequestId }
      }
    }
    // 新流路径 —— 用调用方传入的 topicId 作为主 key
    this.startStream(input)
    return { mode: 'started', activeRequestId: input.topicId }
  }

  /** 按 topicId 加入一个新的 listener。返回 true 表示已加入;false 表示流不存在。 */
  addListenerByRequestId(topicId: string, listener: StreamListener): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return false
    stream.listeners.set(listener.id, listener)  // upsert:同 id 覆盖
    // 回放 buffer 给这个新 listener
    for (const chunk of stream.buffer) listener.onChunk(chunk)
    return true
  }

  removeListenerByRequestId(topicId: string, listenerId: string): void {
    const stream = this.activeStreams.get(topicId)
    stream?.listeners.delete(listenerId)
  }

  abort(topicId: string, reason: string): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return
    stream.status = 'aborted'
    stream.abortController.abort(reason)
    // 立刻从  里摘掉,防止后续 steer/attach 误挂
    if (this..get(stream.topicId) === topicId) {
      this..delete(stream.topicId)
    }
    // 下一轮 onChunk/onDone 会看到 status 变化自动停止分发
  }

  // === InternalStreamTarget 的回调入口(全部按 topicId) ===

  onChunk(topicId: string, chunk: UIMessageChunk): void {
    const stream = this.activeStreams.get(topicId)
    if (!stream || stream.status !== 'streaming') return

    // 1. 入 buffer(reconnect 回放 + 可选的 backup 重建路径)
    if (stream.buffer.length < this.config.maxBufferChunks) {
      stream.buffer.push(chunk)
    }

    // 2. 多播给所有 listener,统一调用不区分类型
    //    不做任何 UIMessage 重建 —— 上游 agentLoop 已经在用
    //    AI SDK 工具函数产出完整 UIMessage,通过 setFinalMessage 塞进 stream
    const dead: string[] = []
    for (const [id, listener] of stream.listeners) {
      if (!listener.isAlive()) {
        dead.push(id)
        continue
      }
      try {
        listener.onChunk(chunk)
      } catch (err) {
        logger.warn('Listener onChunk threw', { topicId, listenerId: id, err })
      }
    }
    for (const id of dead) stream.listeners.delete(id)
  }

  /**
   * 流终态广播(按 topicId)。由两个上游路径触发:
   *   - 自然结束:AiService.executeStream 的 finally → 调 `onDone(topicId, 'success')`
   *   - 被中止:AiStreamManager 自己的 `abort(topicId)` 内部,在 abort 之后给 listeners 发一次
   *     `onDone(topicId, 'paused')`,前提是上游能在 abort 分支里把部分结果
   *     通过 `setFinalMessage` 塞进 `stream.finalMessage`(agentLoop 的 onError/abort
   *     分支需要做这件事)。
   */
  async onDone(topicId: string, status: 'success' | 'paused' = 'success'): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    stream.status = status === 'paused' ? 'aborted' : 'done'
    // 从  里摘掉这个 topic → request 的指向,防止后续新请求走 steer
    if (this..get(stream.topicId) === topicId) {
      this..delete(stream.topicId)
    }
    // 注意:stream.finalMessage 应该已经被上游通过 InternalStreamTarget.setFinalMessage
    // 在 onDone 之前塞好了(agentLoop.afterIteration hook)。AiStreamManager 自己不做 rebuild。
    // 如果 finalMessage 仍是 undefined,说明上游没有提供 —— listener 自己按 undefined 处理。
    const result: StreamDoneResult = { finalMessage: stream.finalMessage, status }

    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onDone(result)
      } catch (err) {
        logger.warn('Listener onDone threw', { topicId, listenerId: id, err })
      }
    }

    // 进入 grace period,供迟到 reconnect 读取 finalMessage
    this.scheduleReap(topicId, stream)
  }

  async onError(topicId: string, error: SerializedError): Promise<void> {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return

    stream.status = 'error'
    stream.error = error
    if (this..get(stream.topicId) === topicId) {
      this..delete(stream.topicId)
    }

    for (const [id, listener] of stream.listeners) {
      try {
        await listener.onError(error)
      } catch (err) {
        logger.warn('Listener onError threw', { topicId, listenerId: id, err })
      }
    }

    this.scheduleReap(topicId, stream)
  }

  private scheduleReap(topicId: string, stream: ActiveStream): void {
    stream.reapAt = Date.now() + this.config.gracePeriodMs
    stream.reapTimer = setTimeout(() => {
      if (this.activeStreams.get(topicId) === stream) {
        this.activeStreams.delete(topicId)
      }
    }, this.config.gracePeriodMs)
  }

  /**
   * 提前驱逐一个 grace period 内的 done/error/aborted 流,让出 topic slot。
   *
   * 代价:迟到的按 topicId 的 reconnect 会拿到 'not-found' 而不是 'done + finalMessage',
   * Renderer 需要退化到 `useQuery('/topics/:id/messages')` 从 DB 读。因为
   * `PersistenceListener.onDone` 已经把消息落库,数据不会丢,只是走 DB 路径一次。
   *
   * 这个代价换的是"用户停/错/完之后立即重试"的顺滑体验,值得。
   */
  private evictStream(topicId: string, stream: ActiveStream): void {
    if (stream.reapTimer) clearTimeout(stream.reapTimer)
    this.activeStreams.delete(topicId)
    if (this..get(stream.topicId) === topicId) {
      this..delete(stream.topicId)
    }
  }

  /** InternalStreamTarget 用它决定 isDestroyed 返回什么 */
  shouldStopStream(topicId: string): boolean {
    const stream = this.activeStreams.get(topicId)
    if (!stream) return true
    if (stream.status !== 'streaming') return true
    if (stream.abortController.signal.aborted) return true
    if (stream.listeners.size === 0 && this.config.backgroundMode === 'abort') return true
    return false
  }

  /**
   * === Ai_Stream_Open handler ===
   *
   * 核心顺序:
   *   0. **内存去重**:先查 `activeStreams.get(req.topicId)`,命中就返回 ——
   *      同一个 topicId 的重复调用幂等(rapid retry / 双击 / 网络重发)
   *   1. 用请求里的 `parentAnchorId` **显式**调 `messageService.create` 落 user message
   *      → 得到真实的 user.id(`messageService.create` 会在同一事务里更新
   *        `topic.activeNodeId`,这是 v2 数据层的契约)
   *   2. 构造 WebContentsListener(event.sender, topicId) + PersistenceListener(parentUserMessageId = 步骤 1 的 id)
   *   3. 调 `this.send({ topicId, topicId, request, userMessage, listeners })`
   *      (内部会判断是 startStream 还是 steer —— 同一 topic 已有活跃流时走 steer,
   *       不再起第二条,这是"用户连续发多条消息"的合法路径)
   *
   * 注意事项:
   *   - **步骤 0 的去重只靠内存**,Main 重启后 Map 清空,重启后的重复请求会被当新请求处理 ——
   *     这个 edge case 在 v1/v2 都没有覆盖,现状就是重启即失忆,保持一致
   *   - **步骤 1 必须同步 await 完成**,因为步骤 2 的 PersistenceListener 依赖它的返回 id
   *   - 步骤 1 失败要把错误直接返回给 Renderer,不继续起流
   *   - ChannelMessageHandler / Agent scheduler 路径走自己的入口,在各自的 handler 里
   *     同样先调 `messageService.create` 落 user-side 消息再构造 PersistenceListener,并自己
   *     生成一个 topicId(通常是 `crypto.randomUUID()`)
   */
  private async handleStreamRequest(
    sender: WebContents,
    req: AiStreamOpenRequest
  ): Promise<{ topicId: string; mode: 'started' | 'steered' |  }> {
    // 步骤 0:内存去重 —— topicId 命中就返回,不重复落库、不重复起流
    if (this.activeStreams.has(req.topicId)) {
      logger.info('Ai_Stream_Open deduped by topicId', { topicId: req.topicId })
      // 把本次发起者的 WebContentsListener 挂上去(可能是 Renderer 重连场景)。
      // 注意 listener id 按 topicId 构造,addListener 的 upsert 语义会吞掉重复订阅。
      this.addListenerByRequestId(req.topicId, new WebContentsListener(sender, req.topicId))
      return {  mode:  }
    }

    // 步骤 1:原子落库 user message,显式 parentId,绝不 fall back 到 activeNodeId
    const userMessage = await messageService.create(req.topicId, {
      role: 'user',
      parentId: req.parentAnchorId,   // 显式,可以是 string 或 null,但不能是 undefined
      data: req.userMessage.data
    })

    // 步骤 2:构造 listeners —— id 都按 topicId 构造(见 listener 实现的注释)。
    // topicId 只在 PersistenceListenerOptions 里作为日志/trace 字段传入,不参与 id。
    const persistenceListener = new PersistenceListener({
      
      topicId: req.topicId,
      assistantId: req.assistantId,
      parentUserMessageId: userMessage.id,
      afterPersist: this.buildAfterPersistHook(req, userMessage)  // agent rename 等
    })
    const webContentsListener = new WebContentsListener(sender, req.topicId)

    // 步骤 3:路由给 AiStreamManager(内部会判断是 startStream 还是 steer)
    const result = this.send({
      
      topicId: req.topicId,
      request: req,
      userMessage,
      listeners: [webContentsListener, persistenceListener]
    })
    return { topicId: result.activeRequestId, mode: result.mode }
  }

  /**
   * === Ai_Stream_Attach handler ===
   *
   * 支持两种 attach 模式:
   *   - **byRequestId**:原始发起者重连(Renderer 侧仍然持有 topicId,比如页面
   *     刷新后从 sessionStorage 恢复),精准挂回同一条 ActiveStream
   *   - **byTopicId**:多窗口观察者 attach —— 第二个窗口打开同一 topic,它只知道
   *     topicId(useQuery 读出来的树),不知道原始 topicId。AiStreamManager 用
   *      反查当前活跃 request,挂 WebContentsListener 上去
   *
   * 返回值告诉 Renderer 它 attach 到了哪个 topicId,后续 chunk listener 按
   * topicId 过滤。
   */
  private handleAttach(
    sender: WebContents,
    req: AiStreamAttachRequest
  ): AiStreamAttachResponse {
    let topicId: string | undefined
    if ('topicId' in req && req.topicId) {
      topicId = req.topicId
    } else if ('topicId' in req && req.topicId) {
      topicId = this..get(req.topicId)
    }
    if (!topicId) return { status: 'not-found' }

    const stream = this.activeStreams.get(topicId)
    if (!stream) return { status: 'not-found' }

    if (stream.status === 'done') {
      return { status: 'done', topicId, finalMessage: stream.finalMessage! }
    }
    if (stream.status === 'error') {
      return { status: 'error', topicId, error: stream.error! }
    }
    if (stream.status === 'aborted') {
      return { status: 'done', topicId, finalMessage: stream.finalMessage! }  // paused 也算 done,带 partial
    }

    // streaming 中:挂 listener + 回放 buffer。listener id 按 topicId 构造,不按 topicId。
    this.addListenerByRequestId(topicId, new WebContentsListener(sender, stream.topicId))
    return { status: 'attached', topicId, replayedChunks: stream.buffer.length }
  }

  private handleDetach(sender: WebContents, req: AiStreamDetachRequest): void {
    // Detach:按 topicId 找到 ActiveStream,按 (wc.id, topicId) 构造 listener id 移除。
    // topicId 是控制平面路由键(告诉 AiStreamManager 去哪个 Map 里找),topicId 是 listener 身份键。
    const stream = this.activeStreams.get(req.topicId)
    if (!stream) return
    this.removeListenerByRequestId(req.topicId, `wc:${sender.id}:${stream.topicId}`)
  }

  private cleanupByWebContents(wc: WebContents): void {
    // 遍历 activeStreams,删掉 id 前缀为 `wc:${wc.id}:` 的所有 listener
    const prefix = `wc:${wc.id}:`
    for (const stream of this.activeStreams.values()) {
      for (const listenerId of stream.listeners.keys()) {
        if (listenerId.startsWith(prefix)) stream.listeners.delete(listenerId)
      }
    }
  }
}
```

### 对 AiService 的最小侵入清单

Phase 2 架构对 `AiService.ts` / `AiCompletionService.ts` 的**全部**改动:

1. **放宽 `executeStream` 的 target 参数类型**: `Electron.WebContents` → `StreamTarget`(一个只有 `send` 和 `isDestroyed` 两个方法的 interface,外加可选的 `setFinalMessage`)。`Electron.WebContents` 本身不实现 `setFinalMessage`,但因为是 optional 方法,老的直接调用路径零破坏
2. **`executeStream` 新增 options 参数**: 签名由 `(target, request)` 改为 `(target, request, options?: { signal?: AbortSignal; pendingMessages?: PendingMessageQueue })`,方法体把内部 `new AbortController()` 删掉,改为把 `options.signal` 直接透传给 `runAgentLoop` / `this.completionService.streamText`;`options.pendingMessages` 透传给 `runAgentLoop`,供 `prepareStep` 在内层步间 drain steering 消息
3. **`executeStream` 注册 `afterIteration` hook 捕获 UIMessage**:这是 Phase 2 新增的责任 —— 在 `runAgentLoop` 的 hooks 里挂一个 `afterIteration(ctx, result)` 回调,从 `result.uiMessage` 拿到 AI SDK 工具产出的完整 UIMessage,调 `target.setFinalMessage?.(result.uiMessage)` 塞给 AiStreamManager。见下方 "`agentLoop` 的配套修改" 小节
4. **把 AiCompletionService 的两个 per-topicId 注册表上移到 AiStreamManager 层**(注意:topicId 这个**概念**没删,只是管理方从 AiCompletionService 换成 AiStreamManager):
   - `AiCompletionService.registerRequest / removeRequest / abort(topicId)` —— 删掉,AiStreamManager 在 `activeStreams: Map<topicId, ActiveStream>` 主表里直接持有每条流的 `AbortController`,abort 走 `AiStreamManager.abort(topicId)`(`Ai_Stream_Abort` IPC 直接路由到这里)
   - `AiCompletionService.pendingMessageQueues: Map<topicId, PendingMessageQueue>` 和 `getPendingMessageQueue / steer(topicId, message)` —— 删掉,队列的归属从"按 topicId 索引的全局 Map"改为"`ActiveStream.pendingMessages` 字段",随流 GC(steering 消息由 AiStreamManager 根据 topicId 反查当前活跃 topicId,再推进对应的队列)
   - 对应的 `ipcOn(Ai_Abort)` 和 `ipcOn(Ai_SteerMessage)` 挂接都删掉,Renderer 的 abort 走 `Ai_Stream_Abort({ topicId })`,steer 走 `Ai_Stream_Open`(AiStreamManager 按 topicId 发现当前有活跃流则路由到 steer,忽略 Renderer 传的 topicId)
   - **executeStream 本身不再认识 topicId** —— 它只收 `target: StreamTarget` + `signal: AbortSignal`,`target` 实际上是 `InternalStreamTarget(broker, topicId)`,topicId 被**封装在 target 闭包里**,executeStream 完全看不到。这是关键的分层:AiCompletionService 是"一次 AI 调用的库函数",不关心"这次调用是谁的哪一轮";AiStreamManager 才是那个管"谁的哪一轮"的控制平面
5. **删除 `Ai_StreamRequest` / `Ai_Abort` / `Ai_SteerMessage` 三个 `ipcHandle` / `ipcOn` 注册**。Renderer 全部走 `Ai_Stream_*`,由 AiStreamManager 接管

**不动**:`AiCompletionService.streamText` 本身(它本来就接受 `AbortSignal`)、`ToolRegistry`、`generateText`/`checkModel`/`embedMany`/`generateImage`/`listModels` 等其他 IPC handler、`@DependsOn` 依赖、服务生命周期。

将来如果把"流执行"从 `AiService` 里剥离出来(比如合并到 AiStreamManager 内部),这个 `StreamTarget` 接口也是清晰的切分点。

**顺带收益**:`AiService.ts` 会从 ~140 行瘦到 ~100 行左右,因为一次性管线管理 + per-call registry 是它内部最啰嗦的一部分。瘦身之后 `AiService` 的职责变得非常纯粹:**一个 lifecycle-managed 服务,封装 AiCompletionService 的各种非流 API,流由 AiStreamManager 调用 `executeStream` 作为库函数使用**。

### `agentLoop` 的配套修改:IterationResult 新增 `uiMessage` 字段

`src/main/ai/agentLoop.ts` 当前在每次迭代结束时通过 `Promise.all([result.totalUsage, result.steps, result.finishReason, result.response, result.sources])` 兑现 AI SDK 的 promised 字段(`agentLoop.ts:258-264`)。这里是**拿完整 UIMessage 的最佳位置** —— `result` 对象本身就有所有需要的状态,只需要调一个 AI SDK 工具函数就行。

**改动 1: 给 `IterationResult` 加一个字段**

```ts
// agentLoop.ts
export interface IterationResult {
  messages: ModelMessage[]         // 原有:给模型下一轮回传用
  uiMessage: CherryUIMessage       // ← 新增:给持久化/UI/AiStreamManager 用,由 AI SDK 工具产出
  usage: LanguageModelUsage
  finishReason: string
  steps: StepResult<ToolSet>[]
  response: { id: string; modelId: string; timestamp: Date }
  sources: unknown[]
}
```

**改动 2: 在兑现 result 之后调 AI SDK 工具**

```ts
// agentLoop.ts 大致位置:当前的 Promise.all 之后
const [iterationUsage, steps, finishReason, response, sources] = await Promise.all([
  result.totalUsage,
  result.steps,
  result.finishReason,
  result.response,
  result.sources
])

// ← 新增:用 AI SDK 工具从 result/steps/response 拿完整 UIMessage
//   具体 import 名字待实现时查当前 ai 包版本 —— 可能是
//   `readUIMessageStream` + 把 result.toUIMessageStream() 喂进去(tee 一份),
//   也可能是更直接的 utility。无论哪个,都 **不自己写状态机**。
const uiMessage = await aiSdkReconstructUIMessage({ result, steps, response })

totalUsage = mergeUsage(totalUsage, iterationUsage)
totalSteps += steps.length
lastFinishReason = finishReason

const shouldContinue = await hooks.afterIteration?.(
  { iterationNumber, messages, totalSteps },
  {
    messages: response.messages,
    uiMessage,                                  // ← 新增
    usage: iterationUsage,
    finishReason,
    steps,
    response: { id: response.id, modelId: response.modelId, timestamp: response.timestamp },
    sources
  }
)
```

**实现提示**:AI SDK v5 里获取完整 UIMessage 的最直接方式是对 `result.toUIMessageStream()` 的输出做一次 `tee()`,一路给 AiStreamManager 实时流转,另一路喂给 `readUIMessageStream`(或同名 utility)消费到最后一条 message。tee 是 Web Streams 原生 API,零额外状态机代价。具体 import 看 `@ai-sdk/ui-utils` 或 `ai` 包当前版本,实现时查一下即可。

**改动 3: `AiService.executeStream` 在 `hooks.afterIteration` 里调 `target.setFinalMessage`**

```ts
// AiService.executeStream 里构造 agentLoop 调用参数时:
const stream = runAgentLoop(params, request.messages, options?.signal, {
  hooks: {
    ...request.hooks,  // 透传用户自定义 hooks
    afterIteration: async (ctx, result) => {
      // 关键:把 AI SDK 产出的 UIMessage 通过 target 传给 AiStreamManager
      target.setFinalMessage?.(result.uiMessage)
      // 继续调用原 hooks.afterIteration(如果有)
      return request.hooks?.afterIteration?.(ctx, result)
    }
  }
})
```

### IPC 契约

```ts
// @shared/IpcChannel 新增
enum IpcChannel {
  // === 保留用于流 chunks 的推送(payload 只带 topicId,Renderer listener 按 topicId 过滤) ===
  Ai_StreamChunk = 'ai:stream-chunk',
  Ai_StreamDone  = 'ai:stream-done',
  Ai_StreamError = 'ai:stream-error',

  // === Phase 2 新增(AiStreamManager 拥有) ===
  Ai_Stream_Open   = 'ai:stream:open',   // Renderer → Main:发送消息(AiStreamManager 按 topicId 判断开新流 or steer)
  Ai_Stream_Attach = 'ai:stream:attach', // Renderer → Main:reconnect(支持 topicId 两种模式)
  Ai_Stream_Detach = 'ai:stream:detach', // Renderer → Main:主动退订(按 topicId)
  Ai_Stream_Abort  = 'ai:stream:abort',  // Renderer → Main:按 topicId abort(一次生成尝试停止)

  // === Phase 2 Step 2.8 最终删除 ===
  Ai_StreamRequest = 'ai:stream-request',  // @deprecated 由 Ai_Stream_Open 取代
  Ai_Abort         = 'ai:abort',           // @deprecated 由 Ai_Stream_Abort 取代
}
```

Payload 类型(**request/response 带 `topicId` 做控制平面精确路由,Main→Renderer 的 push 只带 `topicId` 做数据平面聚合过滤** —— 两个 id 分管两个平面,不是到处都并存):

**Phase 2 里 Renderer → Main 的统一流请求 payload,不在这里重新定义字段** —— 它就是 Step 1.16 的 `aiStreamRequestSchema` 的 TypeScript 类型:

```ts
// === Request payloads ===

// AiStreamOpenRequest 的 single source of truth 在 Step 1.16:
//   `packages/shared/ai-transport/schemas.ts` 的 aiStreamRequestSchema
// 这里不重复字段定义。
import type { AiStreamOpenRequest } from '@shared/ai-transport'
// 等价于 z.infer<typeof aiStreamRequestSchema>

// 字段速览(权威定义见 Step 1.16):
//   - topicId
//   - topicId         —— SQLite topics 主键,数据平面身份 + useChat({ id }) 复用 key
//   - parentAnchorId  —— 显式父节点(Renderer 从 useQuery 读树拿,可能为 null)
//   - userMessage     —— { role: 'user', data: { parts } } 内容载体,无 id
//   - assistantId     —— 写入 SQLite 的 assistant 归属
//   - 其余: providerId / modelId / assistantConfig / websearchConfig /
//           mcpToolIds / knowledgeBaseIds / agentMode / agentConfig 等
//
// 如果本小节的速览和 Step 1.16 的 schema 字段对不上,**以 Step 1.16 为准**。
```

> **⚠️ 未决的产品定性(TBD,待确认)**:`parentAnchorId` 只能证明 **Renderer 读树那一刻它是分支 tip**,证明不了"Main 处理请求时它还是 tip"。多窗口并发场景下(两个窗口同时看一个 topic 同时发消息),第二个请求到达 Main 时,第一个请求可能已经在原 tip 下面挂了新节点 —— Main 会**沉默地**在原 tip 下创建兄弟分支,产生 `msg2 ├─ A 分支 / └─ B 分支` 这种形状。
>
> 这需要**产品定性**:
>
> - **定性 A(严格线性)**:两个并发窗口的消息应该接成 `A → B` 链,Main 需要拒绝陈旧 `parentAnchorId` + Renderer 刷新重试 / 冲突 UI
> - **定性 B(git 式分叉)**:两个窗口本来就是独立上下文,各自产生兄弟分支是设计结果,文档明确写"并发发送 = 沉默分叉"语义即可
>
> 当前文档的措辞是"定性 A 的口吻,实际实现的是定性 B",这是 Codex adversarial review 指出的言行不一致问题。**TODO**:产品侧确认走 A 还是 B,确认后相应修改本节措辞或添加冲突检测逻辑。在此之前,此字段的并发语义**待定**,不要被当成 linearizable 契约使用。

```ts

/**
 * Attach 请求 —— 两种模式之一(判别式联合):
 *   - **byRequestId**:原始发起者重连(Renderer 持有 topicId,比如刷新页面
 *     后从 sessionStorage 恢复),精准挂回同一条 ActiveStream
 *   - **byTopicId**:多窗口观察者 attach —— 第二个窗口打开同一 topic 只知道
 *     topicId,AiStreamManager 用 `` 反查当前活跃 request
 */
type AiStreamAttachRequest = { topicId: string }

interface AiStreamDetachRequest {
  /** 按 topicId 精确退订 —— Renderer 在发起时就生成了 topicId,detach 时能传 */
  topicId: string
  // 不需要 subscriber id —— event.sender 就是身份,AiStreamManager 按
  // `wc:${event.sender.id}:${topicId}` 精确定位这个窗口对该 request 的 listener
}

interface AiStreamAbortRequest {
  /** abort 的是一次具体的生成尝试 —— 按 topicId 路由,和 topic 无关 */
  topicId: string
}

type AiStreamAttachResponse =
  | { status: 'not-found' }
  | { status: 'attached'; topicId: string; replayedChunks: number }
  | { status: 'done'; topicId: string; finalMessage: CherryUIMessage }
  | { status: 'error'; topicId: string; error: SerializedError }

// === Push payloads (Main → Renderer, 由 WebContentsListener 发出) ===
// 所有 push **只带 topicId,不带 topicId** —— 数据平面按 topicId 聚合,
// 原因见 WebContentsListener 注释。控制平面的 topicId 只存在于 request/response
// IPC(Ai_Stream_Open / Ai_Stream_Abort / Ai_Stream_Detach / Ai_Stream_Attach)里。

interface AiStreamChunkPayload {
  topicId: string
  chunk: UIMessageChunk
}

interface AiStreamDonePayload {
  topicId: string
  /** 'success' = 自然结束;'paused' = 被中止时的半成品(Renderer 用来区分 UI 态) */
  status: 'success' | 'paused'
}

interface AiStreamErrorPayload {
  topicId: string
  error: SerializedError
}
```

Renderer 侧 chunk listener 统一按 `topicId` 过滤 —— useChat 本来就给我们 `chatId` (= topicId),transport 闭包持有它,一条 listener 就够:

```ts
window.api.ai.onStreamChunk((data) => {
  if (data.topicId === myTopicId) controller.enqueue(data.chunk)
})
```

多窗口场景:两个窗口看同一 topic,它们的 listener 都会收到相同的 chunks(因为 topicId 一致),两边 UI 同步更新 —— 这正是期望行为,不需要额外区分订阅者。

**为什么 Renderer 的 listener 不按 topicId 过滤**:steering 路径下 msg2 和 msg1 属于**同一条 ActiveStream**,chunks 是作为一条连续的流发给 WebContents 的(只有一个 WebContentsListener 通过 upsert 保留)。如果 Renderer 按 topicId 过滤,transport 闭包持有的 topicId 是 msg2 生成的 R2,而 chunks 来自 msg1 发起的 AS_R1,过滤就会漏掉所有 chunks。用 topicId 过滤则天然正确 —— 它表达的就是"这个对话的流",包含 steering 聚合后的所有 chunks。

### Renderer 侧 Transport 改造

```ts
// src/renderer/src/transport/IpcChatTransport.ts (Phase 2 最终形态)

export class IpcChatTransport implements ChatTransport<UIMessage> {
  async sendMessages(options) {
    const { chatId: topicId, messages, abortSignal, body } = options
    // 注意:AI SDK 的 `chatId` 参数映射为我们的 topicId —— 两者意义相同

    // Renderer 在发送时生成 topicId —— **只用于控制平面**(abort/detach 精确路由
    // + Main 端内存去重 key)。chunks 的 listener 仍然按 topicId 过滤,因为 steering
    // 路径下同一 topic 的多次发送会被 AiStreamManager 合并到一条 ActiveStream,chunks 属于
    // 同一条流,只能按 topicId 聚合。
    const 
    const stream = this.buildListenerStream(topicId)

    const lastMessage = messages.at(-1)!
    window.api.ai.streamOpen({
      topicId,
      topicId,
      assistantId: body.assistantId,
      // 注意:只传内容,不传 id —— user message 的 id 由 Main 端原子落库时生成
      userMessage: { role: 'user', data: { parts: lastMessage.parts } },
      // 显式父节点:body.parentAnchorId 由调用方从当前分支末端算出。
      // Renderer 本来就持有消息树(通过 useQuery 读 DataApi),拿末端 id 是 O(1)。
      parentAnchorId: body.parentAnchorId,
      // ...其余 AiStreamRequest 字段
    })

    // abort 改为 detach —— 仅退订,流在 Main 端继续跑完并落库。按 topicId 精确路由。
    abortSignal?.addEventListener('abort', () => {
      window.api.ai.streamDetach({ topicId })
    })

    return stream
  }

  /**
   * Reconnect 支持两种 attach 模式(mode 由 transport 根据有无保存的 topicId 决定):
   *   - **页面刷新后恢复原始发起者的流**:transport 从 sessionStorage 拿回 topicId,
   *     走 `byRequestId` 精准挂回同一条 ActiveStream(拿到的 finalMessage 能精确到
   *     正是那一轮的结果,而不是"当前这个 topic 的流")
   *   - **第二个窗口打开同一 topic 加入观察**:没有 topicId,走 `byTopicId`
   *     让 AiStreamManager 反查当前活跃 request 并 attach
   *
   * 不管哪种 mode,返回的 ReadableStream 都按 `topicId` 过滤 —— Renderer 侧的数据
   * 平面统一只认 topicId(见 buildListenerStream)。
   */
  async reconnectToStream({ chatId: topicId }): Promise<ReadableStream<UIMessageChunk> | null> {
    const savedRequestId = this.getSavedRequestId?.(topicId)  // 可选的 sessionStorage 恢复
    const attachReq: AiStreamAttachRequest = savedRequestId
      ? { mode: 'byRequestId', topicId: savedRequestId }
      : { mode: 'byTopicId', topicId }

    const result = await window.api.ai.streamAttach(attachReq)
    if (result.status === 'not-found') return null
    if (result.status === 'done') return this.buildFinishedStream(result.finalMessage)
    if (result.status === 'error') throw new Error(result.error.message)
    return this.buildListenerStream(topicId)  // 带 buffer 回放,按 topicId 过滤
  }

  /** 构造一个按 topicId 过滤 chunks 的 ReadableStream */
  private buildListenerStream(topicId: string): ReadableStream<UIMessageChunk> {
    return new ReadableStream({
      start(controller) {
        const unsubs = [
          window.api.ai.onStreamChunk((data) => {
            if (data.topicId === topicId) controller.enqueue(data.chunk)
          }),
          window.api.ai.onStreamDone((data) => {
            if (data.topicId === topicId) { controller.close(); unsubs.forEach(u => u()) }
          }),
          window.api.ai.onStreamError((data) => {
            if (data.topicId === topicId) {
              controller.error(new Error(data.error.message))
              unsubs.forEach(u => u())
            }
          })
        ]
      }
    })
  }
}
```

**Phase 2 两个 id 的分层(重要)**:
- **数据平面(chunk 推送 + listener 过滤)** = `topicId`。理由见上方 steering 解释:msg1 和 msg2 在 AiStreamManager 里合并成一条流,chunks 属于同一个 WebContentsListener(upsert 去重后只有一个),只能按 topicId 聚合,过滤不能按 topicId
- **控制平面(sendOpen 去重 / abort / detach / attach)** = `topicId`。这是 Codex Finding 1 + 2 的根治 —— 让迟到的 abort 精确打到特定的一轮,让 Renderer 重发请求被 Main 内存去重识别为同一次操作
- **两层互不相干**:transport 的 `topicId` 是 `sendMessages` 的局部变量,只在 `streamOpen` 和 `streamDetach` 的 IPC 请求体里出现;`buildListenerStream` 根本不 care 它,只认 topicId

### Channel Push 流的对称支持

Cherry Studio 有至少三种流发起场景,AiStreamManager 都要统一支持 —— 但 **AiStreamManager 本身不区分它们**,所有差异通过"注册哪些 listeners"表达:

| 发起场景 | Listeners 组合 | 备注 |
|---|---|---|
| Renderer user 发起 | `WebContentsListener` + `PersistenceListener` | 标准对话 |
| Channel incoming(纯 bot 回复) | `ChannelAdapterListener` + `PersistenceListener` | Discord/Slack/飞书 |
| Channel incoming + 用户同时在看 | `ChannelAdapterListener` + `PersistenceListener` + `WebContentsListener` | bot 回复且 debug 面板开着 |
| Agent scheduler(定时任务) | `PersistenceListener`(+ 可选 `WebContentsListener`) | 后台自主 agent |

`ChannelMessageHandler.handleIncoming` 的改造样子:

```ts
async handleIncoming(adapter: ChannelAdapter, msg: IncomingMessage) {
  const topicId = await this.resolveTopicId(adapter, msg)
  const assistantId = adapter.assistantId
  const request = await this.buildStreamRequest(topicId, msg)

  // Channel 路径也要有 topicId —— ChannelMessageHandler 自己生成一个,
  // 作为 AiStreamManager 主表 key + in-memory 去重键。
  const 

  // 在这之前先调 `messageService.create` 落 user-side 消息(用 channel 平台消息
  // 转成 CherryUIMessage 的 parts),拿到真实的 id 后才能构造 PersistenceListener。
  // 和 Renderer 路径一样,parentId 从 channel 侧的分支末端算出,显式传,
  // 不 fall back 到 activeNodeId。
  const createdUserMessage = await messageService.create(topicId, {
    role: 'user',
    parentId: await this.resolveChannelBranchTip(topicId, adapter, msg),
    data: convertIncomingToCherryMessageData(msg)
  })

  aiStreamAiStreamManager.startStream({
    topicId,
    topicId,
    request,
    listeners: [
      new ChannelAdapterListener(adapter, msg.chatId),   // adapter + platformChatId 在 listener 里固化
      new PersistenceListener({
        topicId,
        topicId,
        assistantId,
        parentUserMessageId: createdUserMessage.id
      })
    ]
  })
}
```

> **发起源信息在哪**:注意上面的调用**没有** `source` / `kind` 字段。AiStreamManager 从 listeners 列表就能完整地知道它要多播给谁、向谁落库、向谁推回 bot 回复。"谁发起的"这个问题对 AiStreamManager 没有意义 —— 它只关心"chunks 往哪送"。调用方如果想打日志说明是 channel 触发的,自己在调用前 `logger.info('starting stream', { topicId, from: 'channel', channelId: adapter.channelId })` 就行,不污染 AiStreamManager 数据结构。

> **注意命名空间**:`msg.chatId` 是 Discord/Slack/飞书等 IM 平台的会话 id(例如 Discord channel id),**不是** AiStreamManager 的 key。AiStreamManager 的 key 始终是 Cherry Studio 的 `topicId`,由 `resolveTopicId(adapter, msg)` 从 `(channelId, platformChatId)` 映射得到。两者同名容易混淆,留意类型和来源。

**顺带获得的能力**:Renderer 用户打开对应 topic 时,`Ai_Stream_Attach` 会把新的 `WebContentsListener` 加入这条由 channel 发起的流 —— **用户可以实时看到 bot 正在回复什么**。这是 v1/v2 现状都没有的能力,在新架构下零成本。

### topicId / topicId 命名空间与并发约束

AiStreamManager 中有**两个 id**,分工明确,不要混用:

| id | 来源 | 用途 | 生命周期 |
|---|---|---|---|
| `topicId` | Cherry Studio SQLite `topics` 表的主键 | **数据平面身份**:AI SDK `useChat({ id })` 的状态复用 key、DataApi 关联 key、多窗口观察者 attach 时的反查 key、steering 消息的归属判断 | 永久(= topic 生命周期) |
| `topicId、IPC chunks listener 过滤键 | 一次生成尝试(start → done/error/aborted + grace period) |

**为什么要两个**:`topicId` 粒度太粗,一个 topic 生命周期内会发生多次生成尝试(首次发送、regenerate、stop 后再发……),控制平面消息(abort/attach/done)必须能区分"哪一次",所以需要 `topicId`。但 `topicId` 仍然是**用户视角**的身份(UI 只知道"我在哪个对话里"),steering 消息和多窗口观察者只认 topic,所以不能把 topicId 丢掉。

三种发起源对两个 id 的处理:

- **Renderer 发起**:UI 传入当前打开的 `topicId` + `crypto.randomUUID()` 作为新 topicId
- **Channel 发起**:`ChannelMessageHandler` 根据 `(channelId, platformChatId)` → `topicId`,自己生成 topicId
- **Agent 发起**:调度器用自己的 agent task 元数据解析出 `topicId`,自己生成 topicId

**并发约束**:同一 `topicId` 在 AiStreamManager 里同时只能有一条活跃 request(由 `` 反查索引强制)。但"一条流"不等于"一次发送" —— 用户在流跑的时候继续发消息是合法的,AiStreamManager 的 `send()` 路由会检测到当前 topic 已有活跃 request,把新消息的 `topicId` **忽略**,把消息 push 到现有 `ActiveStream.pendingMessages` 队列,由 `runAgentLoop.prepareStep` 在内层步间 drain 拼进 context(Phase 1 设计原则里的 "Pending Messages Steering 双层保障")。

所以:
- **同一 topic 同时一条活跃 request** —— 这是对 AiStreamManager 的约束,对用户透明
- **用户感知的"多次发送"** —— 都合法,通过 steering 队列聚合到当前 request,不报错也不开新 request
- **真正会被拒绝的** —— 只有 Main 内部直接调 `startStream`(绕过 `send()` 路由)且当前正 streaming 的情况。这通常是调用方写错了(应该调 `send`),`ConflictError` 在 dev/test 阶段能帮忙发现这种 bug

**topicId 幂等性**:`startStream` 开头先查 `activeStreams.get(topicId)` 主表,命中就直接返回,不重新起流。这覆盖了 rapid retry / 双击 / 网络重发场景。Main 重启后 Map 清空,重启后的重复请求被当成新请求 —— 这个 edge case 在 v1/v2 都没有覆盖,保持一致。

`startStream` 遇到 `` 指向 grace period 内(done/error/aborted)的旧 request 时,会**提前驱逐**旧 request,让新 request 立即开始 —— 这修复了"停止后立即重试"/"出错后立即重发"/"完成后秒速连发"三种用户动作的顺滑度。迟到 reconnect 的代价:按旧 topicId attach 会拿到 'not-found',Renderer 退化到 `useQuery('/topics/:id/messages')` 从 DB 读,由 `PersistenceListener` 已落库的数据兜底。

#### `persistAgentSessionId` 在 Renderer 侧消失

`messageThunk.ts:721-785` 的 `persistAgentSessionId` 现在负责:"SDK init 消息到达 Renderer → 写 Redux + IndexedDB + SWR mutate 刷 session 缓存"。整个 60 行逻辑**Phase 2 之后在 Renderer 侧完全消失**:

- sdkSessionId 由 Main 端 adapter 捕获,写进 `ActiveStream.sourceSessionId` + 持久化到 SQLite topic 元数据(新加一个 `sourceSessionId` 字段)
- Renderer 通过 DataApi 失效机制看到新 sessionId,不需要自己做 Redux + SWR 同步
- `messageThunk` 里的 `persistAgentSessionId` + 它的调用点一起删

#### `renameAgentSessionIfNeeded` 作为 `PersistenceListener.afterPersist` hook 注入

`messageThunk.ts:220-279` 的"流完成后用摘要给 session 自动重命名"逻辑,**Phase 2 之后作为 `PersistenceListener` 的 post-persist 钩子注入**,而不是新写一个独立的 Listener 类。

**`PersistenceListener` 加一个 `afterPersist` 可选参数**:

```ts
export interface PersistenceListenerOptions {
  topicId: string
  assistantId: string
  parentUserMessageId: string
  /**
   * 持久化成功后的可选 hook。
   * 用途:agent session 自动重命名、usage 上报、知识库回填、telemetry 收尾……
   * 由调用方(handleStreamRequest / ChannelMessageHandler / Agent scheduler)
   * 按场景注入。PersistenceListener 本身不 care hook 里做什么,只负责在落库成功之后
   * try/catch 包一层调用,让 hook 的失败不污染落库结果、不阻断 AiStreamManager.onDone 的
   * 其他 listener 分发。
   */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}
```

**`handleStreamRequest` 按场景注入 hook**(承接上一节 AiStreamManager 里 `handleStreamRequest` 的步骤 2,展开 `buildAfterPersistHook` 的细节):

```ts
private buildAfterPersistHook(
  req: AiStreamOpenRequest,
  userMessage: Message  // 步骤 1 里落库完的真实 user message,带真实 id
): PersistenceListenerOptions['afterPersist'] {
  if (!isAgentSession(req.topicId)) return undefined

  return async (finalMessage) => {
    // 直接用内存里的 [userMessage, finalMessage] 生成摘要,不走 DB 读
    const { text: summary } = await fetchMessagesSummary({
      messages: [userMessage, finalMessage]
    })
    if (summary?.trim()) {
      await agentClient.updateSession(req.agentId, {
        id: extractSessionId(req.topicId),
        name: summary.trim()
      })
    }
  }
}
```

**为什么是 hook 参数而不是独立 Listener 类**:

`SessionAutoRenameListener` 如果升级成独立 listener,`StreamListener` 接口的四个方法里只有 `onDone` 是"真的用"的,`onChunk / onError` 是 no-op,`isAlive` 永远 true。**用一个完整的观察者类装一个纯粹的后置副作用,是杀鸡用牛刀**。区分"真正的 Listener"和"post-persist hook"的经验法则(详见 `StreamListener.isAlive` 注释):

| 如果这个消费者…… | 用 Listener 类 | 用 `afterPersist` hook |
|---|---|---|
| 需要 `onChunk` 实时做事 | ✅ | ❌ |
| 有独立的生命条件(`isAlive` 会返回 false) | ✅ | ❌ |
| 有独立的错误处理策略(`onError` 要推通知) | ✅ | ❌ |
| 只关心流结束后的 finalMessage | ❌ | ✅ |
| 永远存活(不会被主动清理) | ❌ | ✅ |
| 错误静默吞 / 只打 warn | ❌ | ✅ |

**三个内置 Listener(WebContents / Persistence / ChannelAdapter)**每个都在左列勾了**至少一项**,它们是真正的观察者。**Agent 重命名、usage 上报、知识库回填、自动标题生成**这类 post-done 副作用全部落在右列,统一用 `afterPersist` hook。

**多个 post-persist 动作怎么组合**:如果将来 hook 里要做的事 ≥ 3 件,用 `Promise.allSettled` 并发跑多个 helper 函数(**不是**拆成多个 Listener):

```ts
afterPersist: async (finalMessage) => {
  await Promise.allSettled([
    maybeRenameAgentSession(req, finalMessage),
    maybeReportUsage(req, finalMessage),
    maybeIndexKnowledge(req, finalMessage),
    maybeGenerateTitle(req, finalMessage),
  ])
}
```

`Promise.allSettled` 天然提供 error isolation —— 每个 helper 自己的失败不影响其他。PersistenceListener 的 try/catch 只需要在最外层包一层 warn,就覆盖所有情况。

> **⚠️ 已知局限:`afterPersist` 是 best-effort(TBD,Phase 2 暂不处理)**
>
> Codex adversarial review 指出,把 rename / usage 上报 / 知识库索引 / telemetry 等所有 post-done 副作用都塞进 `afterPersist` 闭包,有两个结构性问题:
>
> 1. **best-effort 语义**:`Promise.allSettled` + 外层 warn 意味着失败会被**静默吞掉**,没有持久化痕迹、没有重试路径、没有幂等边界。对 rename / 标题生成这类 UI 修饰类副作用可以接受(下一轮会再跑,用户感知弱);但对 **计费 / 索引 / 关键 telemetry** 这类"丢了就永远丢了"的副作用,从 SQLite 数据根本看不出漏了哪些、没法事后重放。
>
> 2. **per-entrypoint 碎片化**:副作用由调用方(`handleStreamRequest` / `ChannelMessageHandler` / Agent scheduler)各自构造闭包注入,意味着"这条 assistant 消息会触发哪些副作用"取决于它从哪个入口进来,而不是取决于"它是什么消息"。Channel 路径忘了挂 indexing、Agent scheduler 直接留空 undefined —— 工程师记忆力成了系统正确性的依赖,新增入口时容易漏。
>
> **正确分层**是把"所有 assistant 消息都应该跑的副作用"从 Listener 层抽出来,走 outbox + worker 模式:
> - `PersistenceListener.onDone` 在同事务里往 outbox 表插一条 `message_persisted` domain event
> - 独立 worker(BaseService)轮询 outbox,跑全局注册的处理器列表(metering / indexing / telemetry),带 retry count + error,失败可查、可重放
> - `afterPersist` hook 仍然保留,但**文档明确划边界**:仅限 UI 修饰类(rename / title),系统保证类必须走 outbox
>
> **Phase 2 的取舍(当前方案)**:产品侧评估"暂时不需要确保副作用的执行必须被记录" —— 现阶段 Cherry Studio 还没有**强一致要求**的 post-done 副作用(没有计费、KB 索引目前也是 best-effort、telemetry 丢失可以接受),所以 Phase 2 **不实现 outbox + worker**,现有的 `afterPersist` + `Promise.allSettled` 就够用。
>
> **TODO(触发条件)**:当下面任意一件事发生时,这个限制就必须被修掉,届时再单独立项做 outbox:
> - 计费 / usage metering 上线(失败 = 账算错)
> - 知识库索引从 best-effort 升级为"必须 eventually indexed"
> - 关键业务 telemetry / 审计埋点落地(合规要求)
> - 任何"出现两个及以上入口,其中一个漏挂 afterPersist 就会引发用户投诉"的副作用类型
>
> 在触发条件到来前,**不要**在 `afterPersist` 里加"失败了会出大问题"的副作用 —— 如果必须加,请先做 outbox 而不是塞进闭包。

#### ⚠️ 为什么 `afterPersist` **不能**推回 agentLoop 的 hooks

看 agentLoop.ts 就会想:它已经有 `afterIteration` / `onFinish` / `onError` 这些 hook 了,为什么不直接在那里做 rename / metering / 知识库回填?**这条路有两个致命问题**:

> **已过时**：原文讨论的"两条后端路径"(agentLoop + ClaudeCodeStreamAdapter)已在 Phase 6 统一为一条路径。afterPersist hook 仍然是正确的分层，但理由简化为：agentLoop hooks 是执行引擎控制面，PersistenceListener.afterPersist 是业务副作用层。

1. **层次分工被污染**。`agentLoop` 的 hooks 是**执行引擎内部的控制面**(drain steering、token 汇总、otel span、retry 控制、prepareStep 里动态调整 messages/tools),全部是"如何正确地跑这次 AI 调用"级别的问题。塞业务副作用进来,agentLoop 就从"纯粹的 AI 执行函数"退化成"Cherry Studio 业务 orchestrator",违反 agentLoop 的设计契约(`AgentLoopHooks` 的注释原文:*"lifecycle extension points"* —— 给**执行**生命周期开的 hook,不是给业务副作用开的)

2. **次序被破坏**。agentLoop 的 `afterIteration` 在**每次 outer iteration 结束时**触发,一次流的 multi-iteration steering 场景下会触发**多次**;而 rename 是"整条流结束一次"语义。如果硬塞进 afterIteration,rename 会被触发 N 次,每次摘要源都是"当前这一轮的 assistant message",结果就是 session 名字一直变。更糟:`afterIteration` 发生在 **persistence 之前**(persistence 发生在 `AiStreamManager.onDone` 里,由 `Ai_StreamDone` 信号触发,时序在 agentLoop 兑现之后),rename 想依赖"消息已落库"这个状态就拿不到,回到"必须 persistence-first"的隐式约束 —— 而 Listener 层的 `afterPersist` 天然就是"落库成功后"语义,次序自然正确

**所以这两个理由都足以说明"把 post-done 副作用推回 agentLoop"是错的**。正确的分层是:

- **`agentLoop.hooks`** = 执行引擎内部的控制面(AiService 是读者)
- **`PersistenceListener.afterPersist`** = 流完成后的业务副作用(handleStreamRequest 是读者)
- **两个 hook 的时序关系**:agentLoop hooks 全部跑完 → agentLoop 兑现 result → AiService 调 `AiStreamManager.onDone(topicId, 'success')` → PersistenceListener.onDone → `messageService.create(…)` → `afterPersist`(只在 success 路径下跑)

一个是"流怎么跑",一个是"流跑完后业务上还要做什么",这两个层次永远不要糅在一起。

### Phase 2 子阶段实施顺序

虽然逻辑上这些都属于 Phase 2,但**不要一次性上**。按依赖顺序拆成 6 个可独立 merge 的子步骤(编号 Step 2.3 - 2.8,紧接 Step 2.1 / 2.2 之后):

**Step 2.3 · 基础设施 (1-2 天)** ✅ 已完成
- [x] 新建 `src/main/ai/stream-manager/` 目录(当前已扩展为 `context/` + `persistence/` + `listeners/` 三个子系统)
- [x] 定义 `StreamListener` / `StreamTarget` / `ActiveStream` / `AiStreamManagerConfig` 类型(**不定义 `StreamSource`** —— AiStreamManager 不区分流的发起源)
- [x] `ActiveStream.sourceSessionId` 字段预留给 ClaudeCodeService 路径使用
- [x] 实现 `InternalStreamTarget`(后续已合入 AiStreamManager 的 target 参数类型)
- [x] **不写** `UIMessageAccumulator` —— 最终 UIMessage 由上游 agentLoop 调 AI SDK 的 `readUIMessageStream` 产出
- [x] `AiStreamManager` lifecycle 注册 + 4 个 channel 注册
- [x] `AiService.executeStream` 参数类型放宽为 `StreamTarget`
- [x] **不新建** `MessagePersistenceService` —— 演进为 `PersistenceBackend` 接口 + 3 个 backend(`MessageServiceBackend` / `AgentMessageBackend` / `TemporaryChatBackend`)
- [x] `PendingMessageQueue` 事件订阅能力(AsyncIterable 形态)
- [x] 单元测试:`__tests__/` 已覆盖分发逻辑、buffer 回放、lifecycle

**Step 2.4 · Renderer 流接入 (2-3 天)** ✅ 已完成
- [x] `AiStreamManager.startStream` / `send` / `steer` / `onChunk` / `onDone` / `onError` / `abort` 完整实现
- [x] stream request handling 引入 ChatContextProvider 分层(commit 7ae8b920a)
- [x] 新建 `src/renderer/src/transport/IpcChatTransport.ts`,`sendMessages` 走 `Ai_Stream_Open`(含 `ExecutionTransport` 多模型分叉)
- [x] E2E:发消息、收 chunk、正常完成、错误、abort

**Step 2.5 · Reconnect (1-2 天)** ✅ 已完成
- [x] `handleAttach` + `addListener` + buffer 回放
- [x] `IpcChatTransport.reconnectToStream` 真正实现 + `buildCompactReplay` 支持
- [x] 切 topic → 切回来 → 流继续 → 完成
- [x] 多窗口同看 topic → chunks 两边同步
- [x] WebContents destroyed 时自动从 listeners 剔除

**Step 2.6 · 持久化下沉 & 旧 Renderer 侧路径清理 (2 天)** ✅ 已完成
- [x] `AiStreamManager.onDone` 通过 `PersistenceBackend`(非 Listener)完成落库,status 根据自然完成 vs abort 路径决定
- [x] `handleStreamRequest` 起流前原子落 user message(显式 parentAnchorId,避开 activeNodeId 竞态)
- [x] `renameAgentSessionIfNeeded` 逻辑迁入 —— 作为 agent session 自动重命名能力(commit 27aade780)
- [x] 删除 v1 `messageThunk.ts` 旧 transport 代码
- [x] Renderer 侧改用官方 `useChat` —— `useChatWithHistory` hook(`V2ChatContent.tsx`)
- [x] 历史消息走 `useTopicMessagesV2` / DataApi
- [x] `src/renderer/src/aiCore/` 整个目录删除(commit 188f25478 `refactor(renderer): remove legacy aiCore layer`)

> **"PersistenceListener 不做业务逻辑磁铁" 原则**:`PersistenceListener.onDone` 的主体方法只管"把消息写 SQLite"一件事,**业务副作用通过 `afterPersist` hook 参数注入**,不直接写进 PersistenceListener 的代码里。将来增加新副作用时:
> - 在 `handleStreamRequest` 构造 PersistenceListener 时,把新动作加到 `afterPersist` 闭包里
> - 如果 hook 里要做的事 ≥ 3 件,用 `Promise.allSettled([maybeRename, maybeMeter, maybeIndex, ...])` 并发跑多个 helper 函数
> - **不改** AiStreamManager,**不改** PersistenceListener 主体,**不改** 任何已有 listener
>
> **为什么是 hook 参数而不是独立 Listener 类**:Listener 是"对流有结构性交互"的观察者(需要 `onChunk` / 有独立 `isAlive` / 有独立错误处理),它有四个方法要实现。post-persist 副作用只用 `onDone` 的 finalMessage,其他三个方法都是 no-op —— 用一个完整的观察者类装一个纯粹的后置回调,是杀鸡用牛刀。详见前面 "`renameAgentSessionIfNeeded` 作为 `PersistenceListener.afterPersist` hook 注入" 小节里"Listener vs post-persist hook 的选择经验法则"。
>
> **为什么不是推回 `agentLoop.afterIteration` / `onFinish`**:agentLoop 的 hooks 是执行引擎的控制面,不该沾业务副作用;还会破坏"persistence-first"的次序。详见前面小节里对两条反对理由的完整论证。

**Step 2.7 · Channel Push 迁移 (2 天)** ✅ 已完成
- [x] 实现 `ChannelAdapterListener`(含 `SSEListener` 为 API gateway 提供格式转换)
- [x] 改造 `ChannelMessageHandler.handleIncoming` 走 `AiStreamManager.startStream`
- [x] 测试:Discord/Slack 收消息 → bot 正常回复
- [x] 测试:Channel 发起期间 Renderer 打开对应 topic → 能看到实时流
- [x] 测试:channel 断线时 abort 语义正确
- [x] agent session stream 旧 IPC 彻底移除(commit 18c9fc621)

**Step 2.8 · 兼容期清理 (1 天)** ✅ 已完成
- [x] 删除 `AiService.ts` 的 `Ai_StreamRequest` / `Ai_Abort` / `Ai_SteerMessage` 旧 `ipcHandle` / `ipcOn` 注册
- [x] 删除 `AiCompletionService` 的 per-call AbortController 注册表 + `PendingMessageQueue` 全局 Map
- [x] `docs/ai-core-renderer-dev-plan.md` 已删除
- [x] `docs/ai-core-renderer-design.md` 已对齐当前架构
- [ ] 补:Phase 3/4 的 SUPERSEDED 标注全文替换(可延后)

### 边界情况检查清单

在设计评审和 E2E 测试时要逐条对齐:

| 情况 | 策略 |
|---|---|
| 同一 topicId 流进行中再次 `Ai_Stream_Open`(同一用户追加消息) | **不是冲突**。AiStreamManager `send()` 路由到 `steer()` —— 把新消息推进 `stream.pendingMessages`,由 `runAgentLoop.prepareStep` 在下一步边界 drain 并拼进 context。同时把发起者的 listeners 挂上去,继续观察同一条流 |
| 流完成/出错/abort 后进入 grace period,用户立即重试 | **不是冲突**。`startStream` 发现 existing.status ≠ 'streaming' 时调 `evictStream` 提前驱逐旧流,放行新流。代价:迟到的 reconnect 拿不到 finalMessage,退化到 `useQuery` 从 DB 读(`PersistenceListener` 已落库,数据不丢) |
| Renderer + Channel 同时起同一 topic | **真·竞态**(但可处理)。JS 单线程下谁先 `send()` 谁建流,后到的走 steer 把自己的消息塞进同一流。产品语义:Discord user 的消息会和 Renderer user 的消息合流到同一 context,下一步边界一起处理 |
| WebContents 意外 crash | `onWebContentsDestroyed` 自动遍历 `activeStreams`,删掉 id 前缀为 `wc:${wc.id}:` 的所有 listener,走 detach 逻辑 |
| 所有 Renderer 全关 + `backgroundMode='continue'` | AiStreamManager 继续跑,完成后 `PersistenceListener` 落库,下次启动从 DB 读到结果 |
| 所有 Renderer 全关 + `backgroundMode='abort'` | `InternalStreamTarget.isDestroyed()` 返回 true,`AiService.executeStream` 循环退出,流被 abort,不落库 |
| 流完成后 Renderer 迟到 reconnect (grace 内) | `handleAttach` 返回 `{status:'done', finalMessage}`,Renderer 展示结果 |
| 流完成后 Renderer 迟到 reconnect (grace 外) | `handleAttach` 返回 `{status:'not-found'}`,Renderer 改走 `useQuery` 从 DB 读 |
| 多窗口同看同一 topic | 两个窗口各有一个 `WebContentsListener`(id 分别是 `wc:1:topicX` / `wc:2:topicX`),都收到实时 chunks;持久化只在 Main 端做一次 |
| abort 时机:有些 listener 想停、有些不想 | `Ai_Stream_Abort` 是全局 abort(停整条流);单个窗口只退订用 `Ai_Stream_Detach` |
| abort 时的半成品要不要落库 | 取决于上游在 abort 路径下是否调了 `setFinalMessage`。agentLoop 可以在 `onError` / abort 分支里也调一次 AI SDK 工具拿当前部分结果,塞进 stream.finalMessage;PersistenceListener 看到有值就落 `status='paused'`,没值就按当前 `ChatSession.handleFinish:114-127` 的判断降级(有内容落库 / 无内容跳过) |
| Buffer 溢出(超长流) | 超过 `maxBufferChunks` 停止 buffer 但继续多播;迟到 reconnect 只能拿到部分回放 → UI 提示"历史不完整,请从 DB 重新加载" |
| 同一 WebContents 对同一 topicId 重复 Attach | listener id = `wc:${wc.id}:${topicId}` 稳定,`addListener` 自动 upsert(替换旧的),不会重复分发。调用方可以无脑调 Attach,AiStreamManager 幂等 |
| Main 自启动时有从 DB 恢复的"未完成"流 | 不做。AiStreamManager 只管内存中的活跃流,Main 重启 = 流丢失。Renderer 重连拿不到 → 走 DB fallback |

### AiStreamManager 测试策略

AiStreamManager 的核心逻辑可以用一个最小 FakeListener 覆盖,不需要 mock `WebContents` / `ChannelAdapter` / `DataApi`:

```ts
class FakeListener implements StreamListener {
  readonly id = crypto.randomUUID()
  readonly chunks: UIMessageChunk[] = []
  done = false
  error?: SerializedError
  alive = true

  onChunk(c) { this.chunks.push(c) }
  onDone() { this.done = true }
  onError(e) { this.error = e }
  isAlive() { return this.alive }
}
```

覆盖场景:
- chunk 按顺序分发给所有 listener
- `alive = false` 后会被自动清理
- `onChunk` 抛异常不影响其他 listener 和流本身
- buffer 回放到新加入的 listener(通过 `addListener`)
- `abort` 后不再分发 chunk,`abortController.signal` 被正确触发
- `startStream` 遇到已存在 topicId 抛 `ConflictError`
- grace period 后 `activeStreams` 被清理
- `backgroundMode='abort'` 且 listeners 全清空时 `shouldStopStream` 返回 true
- 重复 `addListener` 同一 listener id 时 upsert 生效(不重复分发)

这正是 `StreamListener` 接口统一的直接收益:**AiStreamManager 的测试不需要知道生产里真实的 listener 长什么样**,也不需要 Electron 环境。

### 文件变动汇总

| Step | 文件 | 操作 |
|---|---|---|
| 2.1 | `packages/shared/IpcChannel.ts` | 修改(新增 `Ai_Stream_*` channels + 保留 `Ai_StreamChunk/Done/Error` 复用) |
| 2.2 | `src/preload/index.ts` / `preload.d.ts` | 修改(暴露 `stream*` API) |
| 2.3 | `src/main/ai/stream-manager/types.ts` | 新建(`StreamListener` / `StreamTarget` / `ActiveStream` / `AiStreamManagerConfig` 等接口) |
| 2.3 | `src/main/ai/stream-manager/InternalStreamTarget.ts` | 新建 |
| 2.3 | `src/main/ai/agentLoop.ts` | 修改(`IterationResult` 加 `uiMessage` 字段 + 在 Promise.all 之后调 AI SDK 工具产出 UIMessage) |
| 2.3 | `src/main/ai/stream-manager/AiStreamManager.ts` | 新建(lifecycle 服务 + 4 个 IPC handler 骨架) |
| 2.3 | `src/main/ai/stream-manager/listeners/WebContentsListener.ts` | 新建 |
| 2.3 | `src/main/ai/stream-manager/listeners/PersistenceListener.ts` | 新建 |
| 2.3 | `src/main/ai/AiService.ts` | 修改(`executeStream` target 类型放宽 + 新增 options 参数) |
| 2.3 | `src/main/core/application/serviceRegistry.ts` | 修改(注册 `AiStreamManager`)|
| 2.4 | `src/renderer/src/transport/IpcChatTransport.ts` | 新建(sendMessages 走 `Ai_Stream_Open`) |
| 2.4 | `src/main/ai/AiStreamManager.ts` | `startStream` / `send` / `steer` / `onChunk` / `onDone` / `onError` / `abort` 完整实现 |
| 2.5 | `src/renderer/src/transport/IpcChatTransport.ts` | 修改(`reconnectToStream` 真实现 + buffer 回放) |
| 2.6 | `handleStreamRequest` 构造 `PersistenceListener` 的地方 | 修改(agent session 时注入 `afterPersist` hook,搬迁 `renameAgentSessionIfNeeded` 逻辑作为闭包 —— 不新建独立文件) |
| 2.6 | `src/renderer/src/store/thunk/messageThunk.ts` | **删除** `createAgentMessageStream` / `createSSEReadableStream` / `withAbortStreamPart` / `fetchAndProcessAgentResponseImpl` / `setupChannelStream` / `addChannelUserMessage` / `renameAgentSessionIfNeeded` 等 ~500 行 |
| 2.6 | 对话面板组件 | 改用官方 `useChat` + `useQuery('/topics/:id/messages')` |
| 2.7 | `src/main/ai/stream-manager/listeners/ChannelAdapterListener.ts` | 新建 |
| 2.7 | `src/main/services/agents/services/channels/ChannelMessageHandler.ts` | 修改(走 `aiStreamAiStreamManager.startStream`) |
| 2.8 | `src/main/ai/AiService.ts` | 修改(删除 `Ai_StreamRequest` / `Ai_Abort` / `Ai_SteerMessage` 注册) |
| 2.8 | `src/main/ai/AiCompletionService.ts` | 修改(删除 per-call AbortController 注册表 + `PendingMessageQueue` 全局 Map) |
| 2.8(可选) | API server 的 `/v1/agents/:id/sessions/:id/messages` SSE route | Renderer 停用后可选删除或保留为外部 API(由产品决定) |

### 风险与回退

- **双写期(Step 2.6)**:在 Step 2.6 切换的过渡一两天里,如果旧 `messageThunk.ts` 里的某些函数还没来得及全部删除,Renderer 侧旧持久化逻辑和 Main 侧 `PersistenceListener` 可能同时写。**风险**:如果去重逻辑有 bug,可能出现重复消息。**缓解**:过渡期不超过一周;E2E 测试覆盖"切 topic + 关窗口 + 重开"的组合;准备 SQL 清理脚本
- ~~UIMessageAccumulator 的 chunk state machine 风险~~ —— **这条风险不存在**。AiStreamManager 不自己 rebuild,直接让上游 agentLoop 调 AI SDK 的 `readUIMessageStream`(或等价工具)产出 UIMessage。"chunks → UIMessage" 状态机是 AI SDK 官方维护的,我们只是消费者
- **回退**:每个子步骤(Step 2.3-2.8)独立可 merge、独立可回退。Step 2.6 的大删除 PR 单独做,一旦出问题 revert 这一个 commit 就回到旧 thunk 状态
- **与 Phase 6(ClaudeCodeService → ToolLoopAgent)的顺序**:Phase 6 已完成。Claude Code 作为标准 AI SDK provider 走统一 agentLoop 路径,无需额外 adapter

### 为什么值得做(给决策者)

- **避免走弯路**:如果 Phase 2 先写"朴素 Transport" + Phase 3 再追 `ChatSessionManager` + 事后再 Phase 7 重构,这条路线会产生 ~400 行中间死代码 + 一轮额外的 revert 风险。直接在 Phase 2 上 AiStreamManager,省 2-3 周往返
- **直接解锁一个产品能力**:Discord bot 回复期间用户打开 debug 面板,能看到 bot 正在说什么。当前 v1/v2 都做不到(channel 流和 user 流是两条独立管线)
- **持久化的可靠性提升**:当前关闭窗口时还在跑的流会丢消息,AiStreamManager 之后流在 Main 端跑完并落库,和 Renderer 生死无关
- **多窗口一致性**:当前两个窗口看同一 topic 可能看到不同历史(各自内存副本),之后都走 DataApi 真源,跨窗口失效机制自动同步
- **官方写法回归**:Renderer 侧直接用 `useChat({ id: topicId, transport })`,和官方 AI SDK example 一致,后续升级 AI SDK 不再担心私有 API(`~registerMessagesCallback` 等)改动
- **Transport 层削减**:消除"HTTP SSE(agent) + IPC push(channel)"两条并行管线(见 `messageThunk.ts:421-461` 和 `:2269-2338`),统一为"IPC push 一条路"。删除 ~500 行 Renderer 侧死代码 + `createSSEReadableStream` / `withAbortStreamPart` / `AiSdkToChunkAdapter` 对 SSE 格式的适配代码

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

### Step 3.3: 不再需要 `useAiChat` 自定义 hook

Renderer 侧的对话入口最终形态是**直接使用官方 `useChat`**,不需要 Cherry Studio 自定义的 `useAiChat` 包装:

- **历史**:走 `useQuery('/topics/:id/messages')`(DataApi),SQLite 是单一真源
- **活跃流**:走官方 `useChat({ id: topicId, transport })`,只负责当前正在流的那一条
- **持久化**:下沉到 Main 端 `PersistenceListener`(已在 Phase 2 Step 2.3 建立),Renderer **不** 使用 `onFinish` 写库
- **Reconnect**:Transport 的 `reconnectToStream` 在 Phase 2 Step 2.5 已经实现,切回 topic 能自动接上正在跑的流

原方案(`useChat` + Renderer 侧 `onFinish` 持久化 + `initialMessages` 灌历史)有三个根本性问题 —— 组件 unmount 即丢消息、被迫造 440 行的 `ChatSessionManager`、历史和活跃流混装于 `chat.messages` —— 详见 [Phase 2 架构详述: AiStreamManager](#phase-2-架构详述-aistreambroker) 章节。

Phase 3 阶段只需完成 Step 3.1(安装 `@ai-sdk/react` 依赖)和 Step 3.2(定义 DataUIPart schema);活跃流 hook 的实际接入依赖 Phase 2 Step 2.4 已经就绪的 Transport,直接在 Step 3.5 里 `useChat` 调用处完成。

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
1. 历史消息走 `useQuery('/topics/:id/messages')`(DataApi,SQLite 真源)
2. 活跃流走官方 `useChat({ id: topicId, transport })` 替代当前的 `ApiService.fetchChatCompletion()`
3. 消息发送: `chat.sendMessage(text, { body: { providerId, modelId, assistantConfig } })`
4. 重新生成: `chat.regenerate()`
5. 停止生成: `chat.stop()`(Phase 2 的 Transport 已经把它改成 detach 语义,流在 Main 端继续跑完)
6. 消息状态: `chat.status` 替代自定义的 streaming state
7. 移除 `StreamProcessingService` / `BlockManager` 调用
8. **不要** 在 `useChat` 里写 `onFinish` 做持久化 —— 持久化由 Main 端 `PersistenceListener` 完成

> 本步骤依赖 Phase 2 Step 2.3-2.5 已经就绪的 Transport 和 `PersistenceListener`。

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

## Phase 4: Agent 功能完善 + 清理

**前置**: Phase 3
**产出**: Agent 特有功能（工具、权限、进度）完善，旧 Agent 代码清理
**负责人**: Person A (Agent 功能) + Person B (Renderer Agent UI)

> **注意**: Phase 1 已统一 chat/agent 为同一代码路径（`createAgent()`）。Phase 4 不再需要"合并两套管线"，
> 而是在已统一的路径上完善 agent 特有功能。

### Step 4.1: 完善 Agent 特有功能

**修改文件**: `src/main/ai/AiCompletionService.ts`

Step 1.3/1.15 已经统一了 chat/agent 路径（都走 `createAgent()`）。此步骤完善 agent 特有的功能：ToolRegistry、权限审批、步骤进度推送。

**核心调用链（chat 和 agent 共用）**:
```
AiCompletionService.streamText(request)
  → toolRegistry.resolve()       # 按请求解析出 ToolSet（每个 tool 自带 needsApproval）
  → createAgent({                # packages/aiCore 的 createAgent()
      providerId, providerSettings, modelId, plugins,
      agentSettings: { tools, stopWhen, prepareStep, onStepFinish, onFinish }
    })
  → agent.stream({ messages })   # AI SDK ToolLoopAgent 内部驱动
  → result.toUIMessageStream()   # 输出统一的 UIMessageChunk 流

Tool 权限审批（AI SDK 原生，无需自建）:
  Agent 调用 needsApproval=true 的 tool
    → AI SDK 发送 approval-requested 到 Renderer
    → Renderer useChat 渲染审批 UI
    → 用户调用 addToolApprovalResponse({ id, approved, reason })
    → AI SDK 根据响应执行（output-available）或拒绝（output-denied）
```

**AI SDK ToolLoopAgent 内置机制使用方案**:

| 需求 | AI SDK 机制 | 实现方式 |
|------|------------|----------|
| 停止条件 | `stopWhen` | `stepCountIs(maxSteps)` 限制步数 |
| **Tool 权限审批** | **`needsApproval` (tool 级别)** | 每个 tool 在 ToolRegistry 注册时声明 `needsApproval`。AI SDK 自动管理 `approval-requested` → `approval-responded` → `output-available` / `output-denied`。Renderer 通过 `addToolApprovalResponse()` 响应，**不需要自建 IPC round-trip** |
| **Pending Messages (Steering)** | `prepareStep` | 每步执行前 drain `PendingMessageQueue`，追加到 `messages` 返回值中（见下方详细流程） |
| 动态调整 tools/model | `prepareStep({ stepNumber, steps, model, messages })` | 返回 `{ toolChoice, activeTools, model, messages }` 覆盖当前步设置 |
| 上下文裁剪 | `prepareStep` | 在 `messages` 返回值中裁剪/压缩历史消息 |
| 步骤进度推送 | `onStepFinish({ stepNumber, toolCalls, toolResults, usage })` | 通过 IPC `Ai_AgentStepProgress` 推送给 Renderer |
| 总结 token 用量 | `onFinish({ steps, totalUsage })` | 记录完整的 token 消耗 |
| 流式 chunk 处理 | `onChunk` (stream 模式) | 处理 text-delta、tool-call、tool-result 等 chunk |
| 流被中止 | `onAbort({ steps })` | 清理资源、记录中止状态 |
| 流式错误 | `onError({ error })` | 错误处理、重试逻辑 |

**Pending Messages (Steering) 双循环流程**:

借鉴 Hermes / pi-mono 的双循环架构。`prepareStep` 处理内层步间的 steering，外层 `runAgentLoop` 兜住内层退出后的 steering：

```
Renderer                     Main (runAgentLoop)
                             ┌──────────────────────────────────────────┐
用户在 agent 执行中输入新消息   │  PendingMessageQueue (per request)       │
  │                          │                                          │
  ├─ steerMessage() ────────→│  push(message)                           │
  │                          │                                          │
  │                          │  ┌─ 外层 while(true) ─────────────────┐  │
  │                          │  │                                    │  │
  │                          │  │  ┌─ 内层 ToolLoopAgent ─────────┐  │  │
  │                          │  │  │ Step N:                      │  │  │
  │                          │  │  │  prepareStep() {             │  │  │
  │                          │  │  │    drained = queue.drain()   │  │  │ ← 内层: 步间消费
  │                          │  │  │    messages += drained       │  │  │
  │                          │  │  │  }                           │  │  │
  │                          │  │  │  → LLM sees new messages     │  │  │
  │                          │  │  │  → tool calls / text response│  │  │
  │                          │  │  └──────────────────────────────┘  │  │
  │                          │  │                                    │  │
  │                          │  │  // 内层退出（onFinish 已持久化到 DB）│  │
  │                          │  │  pending = queue.drain()           │  │ ← 外层: 退出后消费
  │                          │  │  if (pending.length === 0) break   │  │
  │                          │  │  persist(pending)                  │  │ ← 只写 steering messages
  │                          │  │  compileContext(chatId) → DB 检索   │  │ ← 从 DB 重建 context
  │                          │  │  continue // 重启内层               │  │
  │                          │  └────────────────────────────────────┘  │
  │                          └──────────────────────────────────────────┘
```

**与 Hermes / pi-mono 的对比**:

| 维度 | Hermes / pi-mono | Cherry Studio |
|------|------------------|--------------|
| 外层循环 | 自建 `while(true)` | `runAgentLoop()` `while(!signal.aborted)` |
| 内层循环 | 自建 tool loop | AI SDK `ToolLoopAgent` |
| 步间 steering | 自建 hook 在 tool 执行后检查队列 | `prepareStep` 在每步 LLM 调用前 drain |
| 退出后 steering | 外层 loop 检查 pending → 重启内层 | 同（`runAgentLoop` 外层 persist → drain → `compileContext()` → 重启） |
| Context 管理 | 手动管理 context.messages + `transformContext` | 无损：DB 是 memory，`compileContext()` 从 DB 检索编译 viewport |
| Prompt cache | N/A | 三层结构：contextPrefix 内层不变 → cache hit；外层边界重建 → 一次 miss |
| 流式拼接 | 自建 event emitter | `TransformStream` writer 跨迭代写入 |

**操作**:
1. 完善 ToolRegistry — 内置 tools 注册（WebSearch, Knowledge, Memory）+ MCP tools 动态注册
2. 每个 tool 声明 `needsApproval`（AI SDK 原生机制）：
   - MCP tools: 默认 `needsApproval: true`（由 MCP server metadata 或用户配置覆盖）
   - 内置 tools: 默认 `needsApproval: false`（搜索类不需审批）
3. 完善 ToolLoopAgent 钩子的 agent 特有逻辑：
   - `prepareStep`: ① drain steering messages ② 根据已执行的 tool results 动态限制 `activeTools` ③ 裁剪过长的 messages
   - `onStepFinish`: 通过 IPC `Ai_AgentStepProgress` 推送 `{ stepNumber, toolCalls }` 给 Renderer
4. Session 管理 → sessionId 通过 `AiStreamRequest.agentConfig` 传递

### Step 4.2: 实现 Agent DataUIPart

**修改文件**: `packages/shared/ai-transport/dataUIParts.ts`

**操作**:
1. 添加 Agent 专属 DataUIPart:
   ```typescript
   'agent-session': z.object({
     sessionId: z.string(),
     agentId: z.string()
   }),
   ```

> **注意**: 不再需要自定义 `agent-permission` DataUIPart。AI SDK 的 ToolUIPart 已内置
> `approval-requested` / `approval-responded` / `output-denied` 状态，完整覆盖权限审批 UI 需求。

### Step 4.3: Tool 权限审批 — AI SDK 原生 + 最小 IPC 侧通道

**状态**：✅ 已完成（2026-04-19）

**最终架构**：MCP 工具走 AI SDK v6 纯原生路径；Claude Agent SDK 工具因为 `canUseTool` 是阻塞型 promise，保留一条 thin unblock IPC。两条路径共享同一份审批 UI（`ToolUIPart` 驱动）。

```
┌─── MCP 工具（纯原生，无 IPC）─────────────────────────────────────┐
│ Main                                          Renderer           │
│ createMcpTool({ needsApproval: fn })                             │
│   ↓ LLM 决定调此 tool                                            │
│ AI SDK 触发 needsApproval → emit                                 │
│   tool-approval-request ────────────────→ ToolUIPart             │
│                                              state='approval-requested' │
│                                            用户点 Approve         │
│                                            chat.addToolApprovalResponse │
│   sendAutomaticallyWhen 为 true                                  │
│   ↓ renderer 自动发新 turn                                       │
│ AI SDK 在历史里看到 approval-responded                            │
│   → 执行 tool.execute()          / 跳过并 emit output-denied     │
└──────────────────────────────────────────────────────────────────┘

┌─── Claude Agent SDK 工具（阻塞 canUseTool + 侧通道解锁）────────┐
│ Main                                          Renderer           │
│ canUseTool 触发（SDK 内同一 turn）                                │
│   ↓ register 到 ToolApprovalRegistry                             │
│   ↓ emit v3 'tool-approval-request' chunk (通过 holder)          │
│   ↓ await pending promise                    ToolUIPart          │
│                                              state='approval-requested' │
│                                              providerMetadata.cherry.transport='claude-agent' │
│                                            用户点 Approve         │
│                                            chat.addToolApprovalResponse │
│                                            (sendAutomaticallyWhen 为 false — 不重发)│
│                                            window.api.ai.toolApproval.respond │
│   ← Ai_ToolApproval_Respond IPC  ───────── │
│ ToolApprovalRegistry.dispatch                                    │
│   → resolve canUseTool promise                                   │
│   → SDK 继续同一 stream → 执行 tool                               │
└──────────────────────────────────────────────────────────────────┘
```

**为什么 Claude Agent 需要侧通道**：`canUseTool` 是 Claude Agent SDK 的阻塞回调，没有"结束 turn → resend → 从历史查 approval"的干净重入点。强行终止当前 turn 会触发 `PersistenceListener.onDone` 写一条中间 assistant 消息，resume 要去重；且 SDK 不保证重发时 tool_use 的 input 稳定。让 `canUseTool` 阻塞在 promise 上、用侧通道解锁最小侵入。

**核心文件**：

Main 侧：
```
src/main/services/toolApproval/autoApprovePolicy.ts
  shouldAutoApprove({ toolKind, toolName, agentAllowedTools?, permissionMode?, serverDisabledAutoApprove? })
  — MCP 和 Claude Agent 共享的决策源；MCP 默认 allow（opt-out），Claude Agent 默认 deny（allowlist）。

src/main/services/agents/services/claudecode/ToolApprovalRegistry.ts
  toolApprovalRegistry.register({ approvalId, sessionId, toolCallId, signal, resolve, ... })
  toolApprovalRegistry.dispatch(approvalId, { approved, reason?, updatedInput? })
  toolApprovalRegistry.abort(sessionId, reason)
  — 主进程 approval 分发表；per-approval signal 自动 dispatch on abort；session-level abort 作为兜底。

src/main/ai/tools/mcpTools.ts
  createMcpTool({ needsApproval: async () => !shouldAutoApprove({ toolKind:'mcp', ... }) })

src/main/ai/provider/claudeCodeSettingsBuilder.ts
  canUseTool = async (toolName, input, opts) => {
    if (shouldAutoApprove({ toolKind:'claude-agent', ... })) return { behavior:'allow', updatedInput:input }
    register to ToolApprovalRegistry, emit LanguageModelV3ToolApprovalRequest via holder, await promise
  }
  approvalEmitter holder 还携带 dispose = () => toolApprovalRegistry.abort(session.id, 'stream-ended')

src/main/ai/provider/claude-code/
  types.ts — ToolApprovalEmitterHolder = { emit?, dispose? }
  claude-code-language-model.ts — doStream start 绑 emit=controller.enqueue；finally 清 emit + 调 dispose

src/main/ai/AiService.ts
  ipcHandle(Ai_ToolApproval_Respond) → toolApprovalRegistry.dispatch
```

Renderer 侧：
```
packages/shared/IpcChannel.ts
  Ai_ToolApproval_Respond = 'ai:tool-approval:respond'

src/preload/index.ts
  window.api.ai.toolApproval.respond({ approvalId, approved, reason?, updatedInput? })

src/renderer/src/utils/toolApprovalPredicate.ts
  cherryApprovalPredicate — sendAutomaticallyWhen 谓词
  — MCP approval：返回 true（重发）
  — Claude Agent approval：返回 false（当前 stream 自己会继续）

src/renderer/src/hooks/ToolApprovalContext.ts
  ToolApprovalProvider / useToolApprovalRespond
  — context 承载 "Approve/Deny 决策的分发函数"，V2ChatContent 在 PartsProvider 里面套一层

src/renderer/src/hooks/useToolApprovalBridge.ts
  useToolApprovalBridge({ addToolApprovalResponse })
  — 包装 chat.addToolApprovalResponse；对 Claude Agent part 额外调 IPC 解锁

src/renderer/src/hooks/useChatWithHistory.ts
  useChat({ ..., sendAutomaticallyWhen: cherryApprovalPredicate })
  — 暴露 addToolApprovalResponse 给 V2ChatContent

src/renderer/src/pages/home/Messages/Tools/toolResponse.ts
  findToolPartByCallId(partsMap, toolCallId) → ToolApprovalMatch
  isToolPartAwaitingApproval(...)
  APPROVAL_REQUESTED / APPROVAL_RESPONDED / CLAUDE_AGENT_TRANSPORT 常量

src/renderer/src/pages/home/Messages/Tools/hooks/
  useAgentToolApproval.ts / useMcpToolApproval.ts
  — 都从 PartsContext 找 part → 按 match.state 派生 isWaiting/isExecuting → confirm/cancel 调 bridge

src/renderer/src/pages/home/Messages/Tools/AskUserQuestionCard.tsx
  读 part.input.questions → 用户填答案 → bridge({ updatedInput:{ ...input, answers } })
  —— updatedInput 走 IPC（v6 的 addToolApprovalResponse 不支持这字段）；主侧用 canUseTool 的 PermissionResult.updatedInput 把答案灌回 tool 调用
```

**特殊情况**

1. **AskUserQuestion 的 `updatedInput`**：v6 的 `addToolApprovalResponse` 只接 `{id, approved, reason}`，用户答案要走我们的 `Ai_ToolApproval_Respond` IPC 的 `updatedInput` 字段回传。`ToolApprovalRegistry.dispatch` 透传给 `PermissionResult.updatedInput`，Claude Agent SDK 用它作为 tool 的最终 input。
2. **`providerMetadata.cherry.transport`**：发 chunk 时打标 `'claude-agent'`。谓词和 bridge 都读这个决定走哪条路径。
3. **环境变量 `CHERRY_AUTO_ALLOW_TOOLS=1`**：policy 第一条，测试模式一律 allow。
4. **`permissionMode === 'bypassPermissions'`**：session 级全局开关，policy 第二条命中。

**已删除的旧代码**：
```
src/main/services/agents/services/claudecode/tool-permissions.ts  (335L，整个删)
src/renderer/src/store/toolPermissions.ts                         (150L Redux slice)
src/renderer/src/utils/userConfirmation.ts                        (162L promise map)
packages/shared/IpcChannel.ts: AgentToolPermission_Request/Response/Result
src/preload/index.ts: window.api.agentTools.respondToPermission
src/renderer/src/env.d.ts: window.agentTools 全局类型
src/renderer/src/hooks/useAppInit.ts: approval IPC 监听 + Redux dispatch (~95L)
claudeCodeSettingsBuilder.ts: preToolUseHook 的 display-only 广播 + DEFAULT_AUTO_ALLOW_TOOLS 本地常量
CHERRY_TOOL_APPROVAL_V2 feature flag（已直接切默认）
```

**旧方案 vs 新方案对比**

| | 旧（v1 自建） | 新（v6 原生 + 最小 IPC） |
|--|-------------|---------------------|
| 权限声明 | 字符串数组 + hook | `needsApproval: fn`（MCP）/ `shouldAutoApprove` policy（Claude Agent） |
| 审批事件通道 | 自建 `AgentToolPermission_*` IPC (3 条) | MCP 纯 AI SDK；Claude Agent 一条 `Ai_ToolApproval_Respond` 解锁 |
| UI 状态来源 | Redux slice | `ToolUIPart.state` (`approval-requested` / `approval-responded`) |
| 持久化 | Redux 不持久化，多窗口不同步 | 活在 UIMessage.parts 里，天然持久化 + reconnect + 多窗口同步 |
| 条件审批 | 手写 if/else + IPC | `needsApproval: async () => !shouldAutoApprove(...)` |
| 自动继续 | 手动 IPC 回调 | MCP: `sendAutomaticallyWhen` 重发；Claude Agent: 同一 stream 不重发 |
| UpdatedInput | `ToolPermissionResponsePayload.updatedInput` | `Ai_ToolApproval_Respond.updatedInput` |

### Step 4.4: Agent 模式接入 → 不再需要专用 hook

原计划在 `useAiChat` 里做 chatId 前缀判断(`agent-session:*`)切换 Agent 模式。由于 `useAiChat` 本身在 Phase 2 AiStreamManager 架构下不再需要,Agent 模式改为在 `useChat` 调用处直接处理:

1. chatId 命名空间:Agent 会话的 topicId 本身即可区分,不需要前缀 trick
2. Agent 配置通过 `chat.sendMessage(text, { body: { ...agentConfig } })` 传入
3. Agent 专用 DataUIPart 在 Message 渲染组件里按 `part.type` 分派(Step 3.4 已覆盖)

本步骤无独立文件改动。

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
| 1 | 1.2 | `src/main/ai/AiService.ts` | 更新 (已存在) |
| 1 | 1.3 | `src/main/ai/AiCompletionService.ts` | 重写 (mock → 统一 createAgent 调用) |
| 1 | — | `src/main/ai/AiRuntime.ts` | **删除** (不需要中间层) |
| 1 | — | `src/main/ai/prepareParams/stubs.ts` | **删除** (直接传参替代) |
| 1 | — | `src/main/ai/utils/stubs.ts` | **删除** (直接传参替代) |
| 1 | — | `src/main/ai/prepareParams/messageUtilStubs.ts` | **删除** (直接传参替代) |
| 1 | 1.5 | `src/main/ai/` (纯逻辑文件) | 从 renderer 复制 (部分已完成) |
| 1 | 1.6-1.13 | 耦合文件适配 (直接 import service) | 适配 |
| 1 | 1.14 | `src/main/ai/plugins/PluginBuilder.ts` | 重写 (纯函数，具体参数) |
| 1 | 1.16 | `packages/shared/ai-transport/schemas.ts` | 新建 |
| 2 | 2.1 | `packages/shared/IpcChannel.ts` | 已完成 |
| 4 | 4.1 | Agent 特有功能 (ToolRegistry needsApproval + 步骤进度) 完善 | 修改 |
| 4 | 4.5 | `src/main/apiServer/routes/agents/handlers/messages.ts` | 修改 |

### Person B: Renderer Transport + useChat

| Phase | Step | 文件 | 操作 |
|-------|------|------|------|
| 2 | 2.2 | `src/preload/index.ts` | 修改 (添加 ai API) |
| 2 | 2.2 | `src/preload/preload.d.ts` | 修改 (类型声明) |
| 2 | 2.4 | `src/renderer/src/transport/IpcChatTransport.ts` | 新建 |
| 3 | 3.1 | `package.json` | 修改 (添加 @ai-sdk/react) |
| 3 | 3.2 | `packages/shared/ai-transport/dataUIParts.ts` | 新建 |
| 3 | 3.4 | `src/renderer/src/pages/home/Messages/Message.tsx` | 修改 |
| 3 | 3.5 | `src/renderer/src/pages/home/Chat.tsx` | 修改(依赖 Phase 2 AiStreamManager + Transport 已就绪) |
| 3 | 3.6 | `src/renderer/src/aiCore/` | 删除整个目录 |
| 3 | 3.6 | `src/renderer/src/services/messageStreaming/` | 删除整个目录 |
| 3 | 3.6 | `src/renderer/src/types/chunk.ts` | 删除 |
| 3 | 3.6 | `src/renderer/src/services/ApiService.ts` | 修改 (移除 AI 调用) |
| 3 | 3.7 | `electron.vite.config.ts` | 修改 (移除 renderer aiCore alias) |
| 4 | 4.5 | Agent 相关旧文件 | 删除 |
| 7 | 7.1 | `src/main/ai/stream-manager/` | 新建(AiStreamManager + 三个内置 Listener + InternalStreamTarget) |
| 7 | 7.1 | `src/main/ai/AiService.ts` | 放宽 target 类型 + 新增 options(signal + pendingMessages)+ afterIteration hook 调 setFinalMessage |
| 7 | 7.2 | `packages/shared/IpcChannel.ts` | 新增 Ai_Stream_* channels |
| 7 | 7.2 | `src/renderer/src/transport/IpcChatTransport.ts` | 新建(完整实现) |
| 7 | 7.4 | `src/renderer/src/services/ChatSessionManager.ts` | **删除** |
| 7 | 7.4 | `src/renderer/src/hooks/useAiChat.ts` | **删除** |
| 7 | 7.5 | `src/main/services/agents/services/channels/ChannelMessageHandler.ts` | 修改(走 AiStreamManager) |

---

## Phase 5: 架构优化（迁移完成后）

**前置**: Phase 4 完成，renderer/aiCore 已删除，AI 执行层全部在 Main
**产出**: 消除技术债，提升可维护性

### 已知技术债

迁移过程中有两个问题被有意推迟：

1. **纯逻辑文件在 `src/main/ai/` 而非 shared package**：reasoning.ts、options.ts、websearch.ts、modelParameters.ts 等是环境无关的纯函数，理论上应放 `packages/aiCore` 或 `packages/shared`，让任何消费方（Main / Utility Process / 测试）都能 import。Phase 3 删除 renderer 版后只剩 main 版，不存在重复；但如果未来需要在 Utility Process 复用这些逻辑，仍需提取。

2. **parameterBuilder 是巨型函数，与 aiCore plugin 体系冲突**：`buildStreamTextParams()` 手动组装 temperature、reasoning、web search、headers、tools 等所有参数，绕过了 aiCore 的 plugin pipeline（`transformParams` hook）。这使得参数构建逻辑集中在一个大函数里，难以独立测试和复用。

### Step 5.1: 将纯逻辑文件提取到 packages/aiCore

**操作**:
1. 将以下文件从 `src/main/ai/` 移动到 `packages/aiCore/src/`：
   - `utils/reasoning.ts` → `packages/aiCore/src/params/reasoning.ts`
   - `utils/options.ts` → `packages/aiCore/src/params/options.ts`
   - `utils/websearch.ts` → `packages/aiCore/src/params/websearch.ts`
   - `utils/image.ts` → `packages/aiCore/src/params/image.ts`
   - `prepareParams/modelParameters.ts` → `packages/aiCore/src/params/modelParameters.ts`
   - `prepareParams/modelCapabilities.ts` → `packages/aiCore/src/params/modelCapabilities.ts`
   - `prepareParams/header.ts` → `packages/aiCore/src/params/header.ts`
2. 更新 `src/main/ai/` 中的 import 路径
3. 为每个文件补充单元测试

### Step 5.2: 将 parameterBuilder 拆分为 aiCore plugins

将 `buildStreamTextParams()` 的逻辑按能力拆分为独立的 aiCore plugins，每个 plugin 用 `transformParams` hook 增强参数。**逐个拆，每拆一个写测试**：

| 顺序 | 拆出的 plugin | 原 parameterBuilder 中的逻辑 | 优先级 |
|------|-------------|---------------------------|--------|
| 1 | `modelParametersPlugin` | temperature, topP, maxTokens, frequencyPenalty, presencePenalty | 高 — 最独立 |
| 2 | `reasoningPlugin` | reasoning effort, thinking tokens, budget tokens | 高 — 逻辑最复杂 |
| 3 | `webSearchPlugin` | provider-specific web search config | 中 |
| 4 | `headerPlugin` | Anthropic beta headers, custom headers | 中 |
| 5 | `toolsPlugin` | MCP tools config, maxToolCalls | 低 — 依赖 MCPService |
| 6 | `idleTimeoutPlugin` | idle timeout signal reset | 低 |

**拆分后的调用方式**:

```typescript
// Before (Phase 1-4): 大函数手动组装
const params = buildStreamTextParams(messages, assistantConfig, model, provider, websearchConfig, mcpTools)
const executor = await createExecutor(providerId, settings, plugins)
const result = await executor.streamText({ ...params, abortSignal: signal })

// After (Phase 5): plugin pipeline 自动组装，每个 plugin 接收它需要的具体参数
const plugins = [
  modelParametersPlugin(model, assistantConfig),
  reasoningPlugin(model, provider, assistantConfig),
  webSearchPlugin(model, provider, websearchConfig),
  headerPlugin(model, provider),
  toolsPlugin(mcpTools),
  ...otherPlugins,
]
const executor = await createExecutor(providerId, settings, plugins)
// params 由 plugins 的 transformParams hook 自动增强
const result = await executor.streamText({ messages, abortSignal: signal })
```

**验收标准**:
- `buildStreamTextParams()` 被删除
- 每个 plugin 有独立的单元测试
- 所有 provider × capability 的组合回归通过

### Step 5.3: 评估 Utility Process 迁移时机

Phase 5 完成后，aiCore 代码已完全解耦（纯函数在 packages/aiCore，通过参数接收数据）。如果出现以下情况，可启动 Utility Process 迁移：

- Main 事件循环阻塞（多窗口 3+ 并发 stream）
- 大文件 base64 编码阻塞 Main（10MB+）
- 需要更高的进程隔离性

迁移成本：AiCompletionService 的数据来源从"直接 import service"改为"oRPC 调用"，通信从 IPC 改为 MessagePort。纯函数逻辑不变。

---

## Phase 6: ClaudeCodeService → 统一 ToolLoopAgent

### 动机

ClaudeCodeService 使用 `@anthropic-ai/claude-agent-sdk`，存在三个核心问题：

1. **数据不一致**: agent 上下文由 SDK 管理（JSONL 文件 `~/.claude/`），与 Cherry Studio SQLite 中的消息数据完全分离。历史消息无法统一查询/搜索。
2. **流协议分裂**: Agent 使用 `SDKMessage[]` → `TextStreamPart` 转换链，Chat 使用 `UIMessageChunk`。Renderer 需要两套渲染逻辑（`transform.ts` 800+ 行）。
3. **SDK 锁定**: Session resume 依赖 SDK 内部 JSONL，不在我们控制范围。SDK 的 tool 权限系统（`canUseTool` 回调）和我们的 AI SDK `needsApproval` 方案不兼容。

### 目标

用统一的 `AiCompletionService.streamText()` + `runAgentLoop()` + `ToolLoopAgent` 替代整个 ClaudeCodeService。
所有消息存 SQLite，流协议统一为 `UIMessageChunk`，tool 权限走 AI SDK 原生 `needsApproval`。

### 当前 ClaudeCodeService 架构

```
ClaudeCodeService.invoke(prompt, session, ...)
  │
  ├── 环境配置: 90+ env vars (API key, proxy, model, paths...)
  ├── System prompt: PromptBuilder (soul mode) + channel security block + language instruction
  ├── Tool 权限: canUseTool callback → auto-allow whitelist / IPC 审批
  ├── MCP Servers: @cherry/browser, claw, exa, assistant, custom MCPs
  ├── Image 处理: sharp resize → base64 → content blocks
  │
  └── SDK query(messages, options)
        │
        ├── yield SDKMessage[] (stream_event / assistant / user / system / result)
        │
        └── transform.ts: SDKMessage → TextStreamPart (800+ lines)
              └── ClaudeStreamState: block index tracking, tool call lifecycle, usage accumulation
```

### 替代方案（使用统一 AI 执行层）

```
AiCompletionService.streamText(request)
  │
  ├── resolveFromRedux(): provider/model/assistant
  ├── buildAgentParams(): sdkConfig + tools + plugins + system + options
  │     ├── System prompt: 从 assistant.prompt + agent config 构建（含 soul mode / channel security）
  │     ├── Tools: ToolRegistry (内置 agent tools + MCP tools)
  │     └── Options: AgentOptions (temperature, providerOptions, etc.)
  │
  └── runAgentLoop(params, messages, signal)
        │
        ├── hooks.beforeIteration: compileContext (session resume 从 SQLite 加载)
        ├── createAgent() → agent.stream() → toUIMessageStream() (原生，无需 transform.ts)
        ├── hooks.afterIteration: persistMessages → SWR invalidate
        └── hooks.onFinish: trackUsage
```

### 需要实现的组件

#### 1. Agent 内置 Tools（替代 SDK 内置）

每个 tool 都不是简单的 Node.js API 封装——SDK 源码（claude-code/manila-v1/src/tools/）显示大量 edge case 处理。

**实现位置**: `src/main/ai/tools/agent/` 目录（每个 tool 独立文件）

##### Read (SDK: 1184 lines)

| 特性 | 实现细节 |
|------|---------|
| 文本文件 | `readFileInRange()` 逐行流式读取（不加载整个文件），支持 offset/limit 部分读取 |
| PDF | 小文件：直接 base64 传给 LLM（Anthropic document_type）。大文件：`extractPDFPages()` 逐页转 JPEG 图片。支持 `pages: "1-5"` 参数 |
| 图片 | `sharp` resize（token-aware 压缩），超大图退化到 400×400 JPEG 20% quality |
| Notebook | 解析 .ipynb JSON，返回结构化 cells（code/markdown/outputs） |
| 二进制 | `hasBinaryExtension()` 阻止读取（PDF/图片除外） |
| 编码 | BOM 检测（UTF-16LE `0xFF 0xFE`），默认 UTF-8 |
| 大文件 | maxSizeBytes ~16MB 上限，超过提示用 offset/limit。maxTokens 检查防止 context 爆炸 |
| 去重 | 按 `{path, offset, limit, mtime}` 缓存，文件未变时返回 stub |
| 输出 | `   1→` 行号前缀（3 字符 + 箭头） |
| **needsApproval** | `false` |

**我们的实现**: 基础文本读取 + 行号 + offset/limit 必须有。PDF 可复用已有的 `extractPdfText()`（或 OCR 服务）。图片 resize 复用已有的 `sharp` 逻辑。

##### Write (SDK: 435 lines)

| 特性 | 实现细节 |
|------|---------|
| 目录创建 | 自动 `mkdir -p` 父目录 |
| 编码保持 | 读取已有文件的编码（UTF-8/UTF-16LE），写入时保持 |
| 行尾保持 | 检测原文件 LF/CRLF/CR，写入时保持一致 |
| 过期检查 | 比对 mtime + 内容（防止覆盖并发修改的文件） |
| 输出 | 返回 structuredPatch diff 和 git diff |
| **needsApproval** | `true` |

##### Edit (SDK: 626 + 776 lines utils)

**最复杂的 tool。** 不是简单的 string.replace：

| 特性 | 实现细节 |
|------|---------|
| 引号规范化 | 先精确匹配，失败后将弯引号 `'' ""` 规范为直引号再搜索 |
| 引号风格保持 | `preserveQuoteStyle()` — 替换文本保持原文件的引号风格 |
| 唯一性检查 | old_string 在文件中出现 >1 次 → 报错（需要 replace_all=true 或更多上下文） |
| replace_all | `file.replaceAll(old, new)` 全部替换 |
| 1GB 限制 | 文件 >1GB 拒绝编辑（防 OOM） |
| XML 反转义 | `<fnr>`, `<n>`, `</n>` 反转义回 XML 标签（Claude 输出限制） |
| 编码/行尾 | 同 Write — 检测并保持 |
| Diff 输出 | `structuredPatch()` (npm `diff` 库) 生成 4 行上下文的 hunk |
| **needsApproval** | `true` |

##### Glob (SDK: 199 lines)

| 特性 | 实现细节 |
|------|---------|
| 引擎 | **ripgrep** `--files --glob`（不是 fast-glob/minimatch） |
| .gitignore | 默认 `--no-ignore`（忽略 .gitignore），可配置 |
| 最大结果 | 100（截断时返回 `truncated: true`） |
| 排序 | `--sort=modified`（按修改时间） |
| 路径 | 返回相对路径（省 token） |
| 排除 | 权限 deny rules 转为 `--glob !pattern` |
| **needsApproval** | `false` |

**我们的实现**: 可以用 `fast-glob`（Node.js 原生，不需要 ripgrep 二进制）或嵌入 `@vscode/ripgrep`。

##### Grep (SDK: 577 lines)

| 特性 | 实现细节 |
|------|---------|
| 引擎 | **ripgrep** 完整命令行 |
| 上下文行 | `-B N`（前）/ `-A N`（后）/ `-C N`（前后） |
| 输出模式 | `content`（匹配行）/ `files_with_matches`（文件名）/ `count`（计数） |
| 最大结果 | 250 行/匹配（默认），offset 分页 |
| 多行 | `-U --multiline-dotall`（`.` 匹配换行） |
| 大小写 | `-i` 不区分大小写 |
| 二进制 | ripgrep 自动跳过 |
| 排序 | files_with_matches 模式按 mtime 最新在前 |
| VCS 排除 | `.git .svn .hg .bzr .jj .sl` 硬编码排除 |
| **needsApproval** | `false` |

##### Bash (SDK: 1144 lines)

| 特性 | 实现细节 |
|------|---------|
| 安全 | 危险命令黑名单 + sandbox（可选）+ 只读模式校验 |
| 超时 | 默认 30s，最大可配，超时自动后台化 |
| 输出 | stdout+stderr 合并，>30KB 持久化到磁盘 |
| 后台 | `run_in_background: true` 立即返回 taskId。自动后台化（执行 >15s） |
| sed | 检测 `sed -i` 编辑命令 → 预览修改 → 模拟执行（不实际调 sed） |
| 工作目录 | 子 agent 禁止 `cd` 改变父工作目录 |
| 命令解析 | AST 解析 `&&` `||` `|` `;` 运算符和子命令 |
| **needsApproval** | 命令级条件审批（见下方权限设计） |

**Bash 权限设计 — 命令级 needsApproval**

`needsApproval: true` 太粗暴（每个 `ls` 都弹窗），`false` 太危险（`rm -rf /` 直接执行）。
需要按**具体命令 + 子参数**分类判断。

SDK 用 AST 解析（`splitCommandWithOperators` + `parseForSecurity`），拆出管道、`&&`/`||`/`;` 子命令后逐个分类。我们用 `needsApproval: async function` 实现等价逻辑：

```typescript
needsApproval: async ({ toolCall }) => {
  const command = toolCall.args.command as string
  const parsed = parseCommand(command)  // AST 解析，不是正则
  return !parsed.every(isSafeCommand)   // 所有子命令都安全才自动批准
}
```

**命令分类**:

| 分类 | 命令示例 | 自动批准 |
|------|---------|---------|
| **只读文件** | `ls`, `cat`, `head`, `tail`, `wc`, `file`, `stat` | ✅ |
| **只读搜索** | `grep`, `find`, `which`, `whereis`, `type` | ✅ |
| **只读 git** | `git status`, `git diff`, `git log`, `git branch` | ✅ |
| **环境信息** | `echo`, `pwd`, `env`, `uname`, `whoami`, `date` | ✅ |
| **写入文件** | `cp`, `mv`, `mkdir`, `touch` | ❌ 需审批 |
| **删除** | `rm`, `rmdir`, `shred` | ❌ 需审批 |
| **权限修改** | `chmod`, `chown`, `chgrp` | ❌ 需审批 |
| **git 写操作** | `git commit`, `git push`, `git reset`, `git checkout` | ❌ 需审批 |
| **包管理** | `npm install`, `pip install`, `brew install` | ❌ 需审批 |
| **网络** | `curl`, `wget`, `ssh`, `scp` | ❌ 需审批 |
| **执行任意代码** | `eval`, `exec`, `source`, `bash -c`, `sh -c` | ❌ 需审批 |
| **管道到执行** | `curl ... | sh`, `wget ... | bash` | ❌ 需审批（组合判断） |

**子参数影响分类**:

同一命令的不同参数改变安全级别：
- `git status` → 安全 vs `git push --force` → 危险
- `rm file.txt` → 需审批 vs `rm -rf /` → 需审批 + 高亮警告
- `curl https://api.com` → 需审批 vs `curl ... | sh` → 需审批 + 高亮警告

**实现要点**:
1. **AST 解析必须**: 正则不可靠（`echo "rm -rf /"` 不该被标记为危险）
2. **管道链全链路检查**: `cat file | grep pattern` 安全，`curl url | bash` 危险
3. **环境变量展开**: `$CMD` 无法静态分析 → 标记为需审批
4. **accessiblePaths 校验**: 即使命令安全，路径超出 `session.accessible_paths` 也拒绝
5. **用户可配置白名单**: per-agent `allowed_commands` 覆盖默认分类

##### 内置搜索/知识/记忆 Tools（Cherry Studio 自有服务）

| Tool | 服务 | 实现 |
|------|------|------|
| **WebSearch** | `WebSearchService`（多 provider） | 包装已有服务为 AI SDK `tool()` |
| **WebFetch** | `@cherry/browser` MCP server | 通过 ToolRegistry MCP 注册 |
| **Knowledge** | `KnowledgeService`（embedjs RAG） | 包装为 `tool()`，传 knowledgeBaseIds |
| **Memory** | `MemoryService` | 包装为 `tool()`，搜索/存储记忆 |

共 **10 个**核心内置 tools（6 个文件操作 + 4 个 Cherry Studio 服务）。

**权限策略**:
- 只读 tools（Read, Glob, Grep, NotebookRead, TodoWrite）: `needsApproval: false`
- 写入 tools（Write, Edit, MultiEdit, NotebookEdit）: `needsApproval: true`
- Bash: `needsApproval: true`（或条件审批 `needsApproval: async ({ toolCall }) => isDangerous(toolCall)`）
- Web tools: 走 MCP server 的 needsApproval 配置

**accessiblePaths**: 每个文件操作 tool 的 `execute` 需要检查路径是否在 `session.accessible_paths` 内。
通过 `experimental_context` 传递 session 配置给 tools：

```typescript
// agentLoop options.context
experimental_context: {
  sessionId: session.id,
  accessiblePaths: session.accessible_paths,
  agentConfig: session.agent_config,
}

// tool execute 中
execute: async (args, { experimental_context }) => {
  const ctx = experimental_context as AgentContext
  validatePath(args.path, ctx.accessiblePaths)
  return fs.readFile(args.path, 'utf-8')
}
```

#### 2. Session Resume（替代 JSONL）

当前: SDK 内部 JSONL 文件存储会话历史，通过 `options.resume = sessionId` 恢复。

替代: 从 SQLite 加载消息历史 → 传入 `agent.stream({ messages })`。

```typescript
// hooks.beforeIteration 中
beforeIteration: async (ctx) => {
  if (ctx.iterationNumber === 1 && request.resumeSessionId) {
    // 从 SQLite 加载历史消息
    const history = await messageService.getByTopicId(request.topicId)
    const uiMessages = convertToUIMessages(history)
    return { messages: uiMessages }
  }
  return {}
}
```

**优势**: 消息在 SQLite 中统一管理，支持搜索、编辑、分支。
**注意**: 不再需要 `CLAUDE_CONFIG_DIR`、JSONL 文件管理、`NO_RESUME_COMMANDS` 等逻辑。

#### 3. System Prompt 构建

当前 ClaudeCodeService 拼接 3 块:
1. `soulSystemPrompt` — PromptBuilder 从 codebase 分析构建（Soul Mode）
2. `channelSecurityBlock` — 外部渠道安全限制
3. `languageInstruction` — 多语言输出指令

替代方式 — 在 `buildAgentParams` 中组装 system prompt，或通过 `hooks.beforeIteration` 动态注入:

```typescript
// AiCompletionService 中
const system = buildAgentSystemPrompt({
  basePrompt: assistant.prompt,
  soulMode: agentConfig.soul_enabled,
  channelSession: linkedChannel,
  language: getAppLanguage(),
  workspacePaths: session.accessible_paths,
})
```

`PromptBuilder`、`CHANNEL_SECURITY_PROMPT`、语言指令 — 这些纯字符串逻辑直接迁移，不依赖 SDK。

#### 4. MCP Server 注入

当前通过 `options.mcpServers` 传给 SDK。替代: 通过 ToolRegistry 注册。

| MCP Server | 当前注入方式 | 替代 |
|---|---|---|
| `@cherry/browser` | `{ type: 'sdk', instance }` | ToolRegistry 注册（已有 `registerMcpTools`） |
| `exa` | `{ type: 'http', url }` | ToolRegistry 注册 |
| `claw` | `{ type: 'sdk', instance }` | ToolRegistry 注册（Soul Mode only） |
| `assistant` | `{ type: 'sdk', instance }` | ToolRegistry 注册 |
| Custom MCPs | `{ type: 'http', url, headers }` | ToolRegistry 注册（已有） |

关键: MCP server 的 transport 初始化 **不是 ToolRegistry 的职责** — `MCPService` 管理连接，ToolRegistry 只注册 tool 定义。

#### 5. Tool 权限（已设计）

已在 Step 4.3 中完整设计。AI SDK 原生 `needsApproval` + `addToolApprovalResponse` 替代 SDK 的 `canUseTool` 回调。

**新增需求**: ClaudeCodeService 的 `DEFAULT_AUTO_ALLOW_TOOLS`（Read, Glob, Grep）和 per-session `allowed_tools` 白名单。

实现: `needsApproval` 作为 async function，检查 session 配置：

```typescript
needsApproval: async ({ toolCall }) => {
  const ctx = toolCall.experimental_context as AgentContext
  if (AUTO_ALLOW_TOOLS.includes(toolCall.toolName)) return false
  if (ctx.agentConfig.allowed_tools?.includes(toolCall.toolName)) return false
  return true  // 需要审批
}
```

#### 6. Image 处理

当前: `sharp` resize → base64 → SDK content blocks。

替代: 在 `hooks.beforeIteration` 或 message 预处理中，将图片 resize 后转为 AI SDK 的 image content part：

```typescript
// message 预处理
const processedMessages = await processImages(messages, {
  maxDimension: 2000,
  maxFileSize: 5 * 1024 * 1024,
})
```

`sharp` 处理逻辑直接迁移（纯 Node.js，不依赖 SDK）。

#### 7. Slash Commands

当前: SDK 内置 + 自定义 slash commands，在 init message 中声明。

替代: 在请求预处理阶段解析 slash commands，不进入 agent loop：

```typescript
// AiCompletionService.streamText 中
const parsed = parseSlashCommand(request.prompt)
if (parsed) {
  return handleSlashCommand(parsed, request)  // 直接处理，不调 LLM
}
// 否则正常走 runAgentLoop
```

#### 8. Extended Thinking

当前: `options.effort` / `options.thinking` 传给 SDK。

替代: 已有 `AgentOptions.providerOptions` 传递 Anthropic thinking 参数：

```typescript
options: {
  providerOptions: {
    anthropic: {
      thinking: { type: 'enabled', budgetTokens: 10000 },
    }
  }
}
```

#### 9. 流协议统一

当前: `SDKMessage[]` → `transform.ts` (800+ lines) → `TextStreamPart` → 自定义 EventEmitter。

替代: `agent.stream()` → `result.toUIMessageStream()` → 原生 `UIMessageChunk`。

**整个 `transform.ts` + `ClaudeStreamState` + `ClaudeCodeStream` 可以删除。**

这是迁移的最大收益 — 消除 800+ 行转换层。

### 迁移步骤

| Step | 内容 | 依赖 |
|------|------|------|
| 6.1 | 实现 agent 内置 tools (`agentBuiltinTools.ts`) — Read/Write/Edit/Glob/Grep/Bash | 无 |
| 6.2 | 实现 `buildAgentSystemPrompt()` — 迁移 PromptBuilder + channel security + language | 无 |
| 6.3 | Session resume from SQLite — `hooks.beforeIteration` 加载历史 | 无 |
| 6.4 | Image 预处理 — sharp resize → AI SDK image content part | 无 |
| 6.5 | Slash command 解析层 | 无 |
| 6.6 | Soul Mode MCP servers (claw, browser, exa) → ToolRegistry 注册 | #14123 MCPService |
| 6.7 | AgentService 适配 — `invoke()` 改为调用 `AiCompletionService.streamText()` | 6.1-6.6 |
| 6.8 | 删除 ClaudeCodeService + transform.ts + ClaudeStreamState + 相关文件 | 6.7 验证通过 |
| 6.9 | 删除 `@anthropic-ai/claude-agent-sdk` 依赖 | 6.8 |

### 文件变动

| 操作 | 文件 |
|------|------|
| **新建** | `src/main/ai/tools/agentBuiltinTools.ts` — 15+ 内置 agent tools |
| **新建** | `src/main/ai/agentSystemPrompt.ts` — system prompt 构建 |
| **新建** | `src/main/ai/agentImageProcessor.ts` — sharp image resize |
| **新建** | `src/main/ai/agentSlashCommands.ts` — slash command 解析 |
| **修改** | `src/main/services/agents/services/AgentService.ts` — invoke 改为调用 AiCompletionService |
| **删除** | `src/main/services/agents/services/claudecode/index.ts` — ClaudeCodeService |
| **删除** | `src/main/services/agents/services/claudecode/transform.ts` — 800+ 行转换层 |
| **删除** | `src/main/services/agents/services/claudecode/claude-stream-state.ts` |
| **删除** | `src/main/services/agents/services/claudecode/tool-permissions.ts` |
| **删除** | `src/main/services/agents/services/claudecode/tools.ts` |
| **删除** | `src/main/services/agents/services/claudecode/commands.ts` |

### SDK 核心能力深度分析（源码: claude-code/manila-v1）

基于 SDK 源码分析，以下是**之前 Phase 6 文档未覆盖的关键能力**：

#### A. Context Window 管理（五种策略）

SDK 有完整的 context window 管理系统，**ToolLoopAgent 完全不具备**：

| 策略 | 触发条件 | 行为 | 我们的替代 |
|------|----------|------|-----------|
| **Auto-Compaction** | token 超过阈值 | 用小模型（haiku/sonnet）总结旧 turns，保留最近 N 轮 | `hooks.beforeIteration` + LLM 摘要 |
| **Snip Compaction** | 每轮结束 | 去除已完成的 tool_use-result 对（轻量） | `pruneMessages()` (AI SDK 原生) |
| **Reactive Compaction** | 413 prompt-too-long | 紧急全量压缩 + strip 大媒体 → 重试 | `hooks.onError` → truncate → retry |
| **Context Collapse** | 渐进式 | 将细粒度消息暂存，按需 drain 为摘要 | `compileContext` 从 DB 检索 |
| **Microcompact** | prompt cache 优化 | 缓存 tool result 的压缩版本 | 不需要（prompt cache 通过三层 context 结构保护） |

**关键差异**: SDK 在**内存中**管理 messages 数组 + JSONL 持久化。我们用 **SQLite + compileContext** — 设计上已是不同路径，不需要复制 SDK 的 5 种策略，但需要等价的能力。

#### B. 流式并行 Tool 执行（StreamingToolExecutor）

SDK 在 LLM **流式输出的同时**开始执行 tools（不等流结束）：

```
LLM streaming: [text...] [tool_use_1] [text...] [tool_use_2] [text...] [end]
                              ↓                      ↓
                     execute tool_1 (start)    execute tool_2 (start)
                              ↓                      ↓
                     tool_1 result (done)      tool_2 result (done)
```

AI SDK 的 ToolLoopAgent **等流结束后才执行 tools**（串行）。这是性能差异。

**替代方案**: 暂时接受串行执行。未来可通过 `onStepFinish` 分析是否有可并行的 tool calls 并预执行。

#### C. 52 个内置 Tools（不只 15 个）

完整列表（按域分类）：

| 域 | Tools | 数量 |
|---|---|---|
| 文件操作 | Read, Write, Edit, MultiEdit, Glob, Grep | 6 |
| 执行 | Bash, PowerShell, REPL | 3 |
| 工作区 | LSP, EnterWorktree, ExitWorktree, EnterPlanMode, ExitPlanMode | 5 |
| 异步 Agent | Agent (spawn子agent), TeamCreate, SendMessage | 3 |
| Web | WebSearch, WebFetch | 2 |
| MCP | MCPTool, ListMcpResources, ReadMcpResource | 3 |
| UI/交互 | AskUserQuestion, ReviewArtifact, TerminalCapture | 3 |
| 任务管理 | TaskCreate, TaskGet, TaskUpdate, TodoWrite | 4 |
| Notebook | NotebookEdit, NotebookRead | 2 |
| 监控 | Monitor, Brief | 2 |
| 其他 | ScheduleCron, DiscoverSkills, ... | ~19 |

**实现优先级（Cherry Studio 需要的子集）**:

P0（核心，必须实现）: Read, Write, Edit, Glob, Grep, Bash
P1（重要）: Agent (子agent), WebSearch, WebFetch, MCP tools
P2（增强）: LSP, TaskCreate/Get/Update, AskUserQuestion
P3（可选）: Notebook, PowerShell, Monitor, REPL, Worktree

#### D. Tool 权限系统（比 needsApproval 复杂得多）

SDK 的权限系统有 4 层：

```
1. Permission Rules (config-based)
   ├── alwaysAllowRules: ['Bash(git *)'] → 匹配则跳过
   ├── alwaysDenyRules: ['Bash(rm -rf *)'] → 匹配则拒绝
   └── alwaysAskRules: ['Write(*.ts)'] → 匹配则必须问

2. Tool.checkPermissions(input, context)
   → 每个 tool 自带权限检查逻辑（如 Bash 检查命令安全性）

3. Bash Classifier (ML)
   → 流式时预判 Bash 命令是否安全（不等流结束就开始分析）

4. Interactive Approval
   → IPC 到 renderer 显示审批 UI
```

AI SDK 的 `needsApproval` 只覆盖第 4 层。前 3 层需要我们在 tool execute 内部自建。

**替代方案**:
- Rule matching: 在 `needsApproval: async ({ toolCall }) => ...` 中实现
- Tool.checkPermissions: 在 tool execute 开头检查
- Bash classifier: 暂时不实现（用 `needsApproval: true` 全部要审批），后续按需

#### E. Agent 嵌套（SubAgent 实现方案）

SDK 的 AgentTool **递归创建 QueryEngine** — 子 agent 有完整的 agent loop
（独立 messages、tools、abort、transcript），但共享 prompt cache：

```typescript
// SDK 的 AgentTool
execute: async ({ prompt, agentOptions }) => {
  const subEngine = new QueryEngine({ ... })
  for await (const msg of subEngine.submitMessage(prompt)) {
    // 子 agent 的流式输出
  }
  return subEngine.getResult()
}
```

**三种替代路径**（渐进式）：

**路径 A: 递归 `generateText()`（Phase 6a，简单可用）**

子 agent 调 `generateText()` 拿最终结果，不流式输出中间过程：

```typescript
const agentTool: Tool = {
  description: 'Spawn a sub-agent to handle a complex sub-task autonomously',
  inputSchema: jsonSchema({
    type: 'object',
    properties: {
      instructions: { type: 'string', description: 'System instructions for the sub-agent' },
      task: { type: 'string', description: 'The task to accomplish' },
      allowedTools: { type: 'array', items: { type: 'string' } },
    },
    required: ['task'],
  }),
  execute: async (args, { experimental_context }) => {
    const ctx = experimental_context as AgentContext
    const completionService = ctx.completionService

    const { text, usage } = await completionService.generateText({
      system: args.instructions,
      prompt: args.task,
      mcpToolIds: args.allowedTools,
    })

    return {
      content: text,
      metadata: { type: 'sub-agent', usage },
    }
  },
}
```

- ✅ 简单，复用已有 `generateText()`（自带 tools、provider 解析）
- ✅ 子 agent 可用 tools（`generateText` 走 `createAgent` → `agent.generate()`，多步 tool loop）
- ❌ 执行过程对用户不可见（黑盒）
- ❌ 子 agent 执行期间 tool 审批无法交互（`needsApproval` 在 generate 中不可用）

**路径 B: 递归 `runAgentLoop()`（Phase 6c，完整流式）**

子 agent 拿到独立的 `ReadableStream`，在 tool execute 内消费：

```typescript
execute: async (args, { experimental_context, toolCallId, abortSignal }) => {
  const ctx = experimental_context as AgentContext

  const subStream = runAgentLoop(
    {
      providerId: ctx.providerId,
      providerSettings: ctx.providerSettings,
      modelId: ctx.modelId,
      tools: resolveSubAgentTools(args.allowedTools),
      system: args.instructions,
      hooks: {
        onStepFinish: (step) => {
          // 子 agent 进度可通过 IPC 推送给 renderer（但不在父 stream 中）
          ctx.emitSubAgentProgress?.(toolCallId, step)
        },
      },
    },
    [{ role: 'user', content: [{ type: 'text', text: args.task }], id: crypto.randomUUID() }],
    abortSignal ?? new AbortController().signal,
  )

  // 消费子 stream，收集最终文本
  let result = ''
  const reader = subStream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    // 提取文本 chunks（跳过 tool-call chunks）
    if (value.type === 'text-delta') result += value.textDelta
  }

  return { content: result, metadata: { type: 'sub-agent-streamed' } }
}
```

- ✅ 子 agent 有完整的双循环（steering、hooks）
- ✅ 通过 `ctx.emitSubAgentProgress` 可推送进度到 renderer
- ✅ abort 传播（abortSignal 来自 ToolExecutionOptions）
- ❌ tool execute 签名是同步返回，父 stream 看不到子 agent 的 chunks
- ❌ 子 agent 的 tool 审批（needsApproval）无法交互（在 execute 内无法 pause 等用户）

**路径 C: DataUIPart 进度推送（Phase 6 后期，最佳体验）**

结合路径 B + 自定义 DataUIPart，让 renderer 看到子 agent 实时执行过程：

```typescript
// tool 定义
onInputAvailable: async ({ toolCallId }) => {
  // AI SDK 回调: tool call 参数就绪，execute 即将开始
  // → renderer 可渲染 "子 agent 启动中..."
},
execute: async (args, { toolCallId, experimental_context }) => {
  // ... 路径 B 的 runAgentLoop ...
  // 进度通过 DataUIPart 推送: data-subAgentProgress
  return { content: result, metadata: { steps, toolCalls } }
},
```

Renderer 侧通过 `data-subAgentProgress` DataUIPart 渲染子 agent 的 tool 调用过程。

**建议**: Phase 6a 先做路径 A（generateText 递归），验证可用后 Phase 6c 升级路径 B。
路径 C 等 DataUIPart 体系完善后再做。

**abort 传播**: 父 agent 的 `abortSignal` 通过 `ToolExecutionOptions.abortSignal` 传入 tool execute，
子 agent 的 `runAgentLoop` 接收同一个 signal → 父 abort 自动传播到子 agent。

**共享 prompt cache**: 路径 B 中子 agent 使用相同的 `providerId + providerSettings`，
如果 system prompt 也相同，provider 侧的 prompt cache 自然命中（取决于 provider 实现）。

#### F. 错误恢复策略

SDK 有完善的错误恢复：

| 错误 | SDK 行为 | 我们的替代 |
|------|----------|-----------|
| 413 prompt-too-long | drain context collapse → reactive compact → retry | `hooks.onError` → 'retry' + beforeIteration truncate |
| 429 rate limit | 内置 retry with backoff | `ai-retry` library (Layer 2) |
| max_output_tokens | 从 8k 升级到 64k → retry | `hooks.onError` → 增大 maxOutputTokens → retry |
| 媒体过大 | strip images/PDFs → retry | `hooks.onError` → strip media → retry |
| Model fallback | 高并发时自动切模型 | `ai-retry` provider fallback |

#### G. 多模型使用（Opus/Sonnet/Haiku 分工）

SDK 不只用一个模型——不同任务用不同模型：

| 用途 | 模型 | 选择逻辑 |
|------|------|---------|
| **主 agent loop** | Opus 4.6 (Max/Team Premium) 或 Sonnet 4.6 (其他) | 5 级优先级：session override → --model flag → env → settings → default |
| **Auto-compaction 摘要** | Haiku/Sonnet | 用小模型压缩旧 turns，节省成本 |
| **Advisor（审查模型）** | Opus 4.6 | 在执行前审查计划，实验性 |
| **Forked agent（子任务）** | 继承父 agent 模型 | 共享 prompt cache |
| **Fallback（高并发）** | 自动切换到 fallback model | FallbackTriggeredError → 重试 |

**Fast Mode**: 不是换模型——同一个模型更快输出（beta header `fast-mode-2026-02-01`）。

**替代方案**: `AgentOptions` 已支持 `modelId`。多模型使用场景：
- 主 loop：用户选择的 model
- Compaction：`hooks.beforeIteration` 中用小模型调 `generateText()` 做摘要
- Advisor：通过 aiCore plugin 在请求前调用审查模型
- Fallback：`ai-retry` library 的 provider fallback

#### H. Advisor / Coordinator 模式

**Advisor**: 实验性"审查模型"——在主 agent 执行前，用 Opus 审查整个对话，给出建议。
独立的 token 追踪。通过 `server_tool_use` (type='advisor') block 集成。

**Coordinator**: 环境变量 `CLAUDE_CODE_COORDINATOR_MODE` 启用。允许通过 Agent tool spawn 异步 worker，
worker 有受限的 toolset（只有 Bash + FileRead + FileEdit）。

**替代方案**: Advisor 可通过 `hooks.onStart` 或 `hooks.beforeIteration` 调用审查模型。
Coordinator 通过 AgentTool 递归调用 `generateText()` with restricted tool set。

#### I. CLAUDE.md 分层记忆系统

SDK 有 4 层记忆文件加载（后面的优先级更高）：

```
1. /etc/claude-code/CLAUDE.md     — 全局（所有用户）
2. ~/.claude/CLAUDE.md            — 用户级（所有项目）
3. CLAUDE.md / .claude/rules/*.md — 项目级（checked into repo）
4. CLAUDE.local.md                — 本地（不进 repo）
```

支持 `@include` 指令（`@path`, `@./rel`, `@~/home`, `@/abs`），防循环引用，大文件截断。

**替代方案**: Cherry Studio 已有自己的 memory 系统（`MemoryService`）。
CLAUDE.md 加载可在 `hooks.onStart` 中读取对应路径并注入 system prompt。

#### J. Tool Deferral（懒加载 tools）

SDK 用 ToolSearch 实现按需加载——大部分 tools 不在初始 system prompt 中（节省 context）：

- **立即加载**（`alwaysLoad: true`）: ToolSearch 本身、Brief、SendUserFile、Agent
- **延迟加载**（通过 ToolSearch 发现后加载）: 所有 MCP tools + `shouldDefer: true` 的 tools
- **ToolSearch 查询**: `"select:Read,Edit"` 精确选择 / `"notebook jupyter"` 关键词搜索

**替代方案**: 这就是 Hub MCP Server 的 `list` + `inspect` + `invoke` 模式。我们已有。

#### K. Forked Agent（会话分叉）

SDK 支持从当前会话 fork 出子 agent，共享 prompt cache：

- `CacheSafeParams`: system prompt + messages 前缀必须相同 → cache hit
- 隔离: 独立的 `readFileState`（克隆 LRU）、独立的 `abortController`、独立的 transcript
- 用途: session_memory 摘要、compact 生成、advisor 调用

**替代方案**: `hooks.beforeIteration` + `generateText()` 做子任务。
Prompt cache 通过三层 context 结构的 contextPrefix 稳定性自然保护。

#### L. Stop Hooks（turn 结束后处理）

SDK 在每轮结束后执行：
- **Prompt suggestion**: 生成后续建议
- **Memory extraction**: 从对话中提取事实存入记忆（gated by EXTRACT_MEMORIES）
- **Auto-dream**: 后台实验（fire-and-forget）

**替代方案**: `hooks.afterIteration` + `hooks.onFinish` 覆盖所有 post-turn 逻辑。

#### M. Token Budget

用户可在 prompt 中指定 token 预算（`+500k`, `+1m`）：
- 软限制（到阈值时 nudge 继续，非硬切断）
- 每轮追踪实际消耗

**替代方案**: `AgentOptions.maxOutputTokens` + `hooks.afterIteration` 检查 `result.usage` 累计。

#### N. 成本追踪

SDK 追踪完整成本信息：
- Per-model input/output/cache tokens
- API 调用时长
- Tool 执行时长
- Web search 请求数
- Session 持久化 + resume 恢复

**替代方案**: 已有 `trackUsage()` + `AnalyticsService`。
细粒度成本（per-model、cache tokens）从 `IterationResult.usage` 中提取。

### 修正后的迁移策略

**不应该等 Phase 5 完成再做 Phase 6。** 基于以上分析，Phase 6 应拆为：

| Sub-phase | 内容 | 前置 |
|---|---|---|
| **6a** | P0 内置 tools (Read/Write/Edit/Glob/Grep/Bash) | 无 |
| **6b** | Tool 权限规则引擎（config rules + per-tool checkPermissions） | 6a |
| **6c** | Agent 子 agent 嵌套（AgentTool 递归调用 generateText） | 无 |
| **6d** | Context window 管理（auto-compact + reactive compact） | hooks.onError + beforeIteration |
| **6e** | System prompt 构建（PromptBuilder + channel security） | 无 |
| **6f** | Session resume from SQLite | 无 |
| **6g** | AgentService 适配 + 删除 ClaudeCodeService | 6a-6f 全部完成 |

6a/6c/6e/6f **可立即开始**（无阻塞）。6d 需要 agentLoop outer loop 完善。6b 需要 6a 的 tool 实现。

### 风险 & 缓解

| 风险 | 严重性 | 缓解 |
|------|--------|------|
| 52 个 tools 工作量大 | 高 | 只实现 P0-P1 子集（12 个），P2-P3 按需 |
| Context management 缺失 | 高 | 短期：`pruneMessages()` + `hooks.onError` retry。中期：实现 auto-compact |
| 串行 tool 执行（AI SDK 限制） | 中 | 暂时接受。多数场景单 tool call 性能足够 |
| Edit tool diff 语义不一致 | 中 | 严格参考 SDK 源码 `FileEditTool` 实现 |
| Bash 安全性 | 高 | `needsApproval: true` + accessiblePaths 检查 + 命令白名单 |
| 子 agent abort 传播 | 中 | 通过 `experimental_context` 传递 AbortController |


---

## 当前进度 & 依赖时序图

### Phase 1 — Main AI 执行层 ✅

- [x] AiService 骨架（IPC 桥 + 流管理）
- [x] AiCompletionService 真实实现（替代 mock stream）
- [x] `runAgentLoop()` 纯函数（Phase 1 单次执行，Phase 2 加外层循环）
- [x] `ToolRegistry`（register/unregister/resolve + checkAvailable）
- [x] `PendingMessageQueue`（已创建，Phase 2 steering 时使用）
- [x] `PluginBuilder`（已创建，Phase 2 接入已有 plugins）
- [x] IPC Channel（Ai_StreamRequest / Ai_GenerateText / Ai_CheckModel / Ai_EmbedMany / Ai_GenerateImage）
- [x] IpcChatTransport 骨架
- [x] Provider 解析: ReduxService → assistantId → provider/model → providerToAiSdkConfig
- [x] providerConfig format utils 修复（formatApiHost, routeToEndpoint 从 @shared 导入）
- [x] AiRuntime.ts 删除（替代为直接 createAgent 调用）
- [x] 纯逻辑文件复制到 `src/main/ai/`（plugins, prepareParams, provider, utils, types, trace）
- [x] Provider extensions 注册 + 类型系统（merged.ts, middlewareConfig.ts）
- [x] **端到端流式对话验证通过**（Grok provider 确认工作）

### Phase 2 — IPC 通道 ✅

- [x] Preload API 暴露（streamText + generateText + generateImage + checkModel + embedMany）
- [x] 联调 — Renderer 发请求 → Main 流式回传 ✅

### Phase 2.5 — ApiService 迁移 ✅

- [x] fetchGenerate → window.api.ai.generateText
- [x] fetchMessagesSummary → window.api.ai.generateText
- [x] fetchNoteSummary → window.api.ai.generateText
- [x] checkApi (非 embedding) → window.api.ai.checkModel
- [x] checkApi (embedding) → window.api.ai.embedMany
- [x] InputEmbeddingDimension → window.api.ai.embedMany
- [x] generateImage Main IPC（generate + edit mode）
- [x] fetchImageGeneration renderer 侧迁移
- [x] fetchModels → Main（listModels.ts 10 个 provider fetcher）
- [x] Token usage tracking — AnalyticsService 直接调用（hooks.onFinish）
- [x] 基础模型参数（temperature/topP/maxOutputTokens 从 assistant.settings 提取到 AgentOptions）
- [x] MCP tools 按需注册（registerMcpTools + createMcpTool + callTool + toolCallId） + `resolveAssistantMcpTools` 抽离
- [x] renderer `src/aiCore/` 整个目录删除（commit 188f25478）
- [ ] 最后一个 `AiProvider` 引用（`InputEmbeddingDimension.test.tsx`）清理

### Phase 2 子阶段（AiStreamManager 架构） ✅ 已全部落地

- [x] **Step 2.3 基础设施**：`stream-manager/` 目录落地（扩展为 `context/` + `persistence/` + `listeners/` 三子系统）+ `types.ts` + `PendingMessageQueue` AsyncIterable
- [x] **Step 2.4 Renderer 流接入**：`AiStreamManager` 核心方法 + ChatContextProvider 分层（commit 7ae8b920a）+ `IpcChatTransport` / `ExecutionTransport`
- [x] **Step 2.5 Reconnect**：`handleAttach` + `buildCompactReplay` + `IpcChatTransport.reconnectToStream`
- [x] **Step 2.6 持久化下沉**：由 `PersistenceBackend` 接口 + 3 backends（`MessageServiceBackend` / `AgentMessageBackend` / `TemporaryChatBackend`）承担；agent session 自动重命名（commit 27aade780）
- [x] **Step 2.7 Channel Push**：`ChannelAdapterListener` + `SSEListener`（API gateway 格式转换）+ agent session stream 旧 IPC 彻底移除（commit 18c9fc621）
- [x] **Step 2.8 兼容期清理**：删除 `Ai_StreamRequest` / `Ai_Abort` / `Ai_SteerMessage`；dev-plan.md 已删；renderer-design.md 已对齐

### Phase 3 — Renderer useChat 接入 ✅ 已完成

- [x] `src/renderer/src/aiCore/` 整个目录删除（commit 188f25478 `refactor(renderer): remove legacy aiCore layer`）
- [x] `V2ChatContent.tsx` 采用官方 `useChat` 路径：`useChatWithHistory` hook + `ipcChatTransport` singleton
- [x] `ExecutionStreamCollector` 为多模型 execution 处理 `ExecutionTransport`
- [x] `useTopicMessagesV2` 从 DataApi 取历史
- [x] `PartsRenderer` + `CherryUIMessage` / `CherryMessagePart` 类型:parts 替代 blocks

### Phase 4 — Agent 功能完善 🟡 进行中

- [x] Tool 权限审批原生化：`ToolApprovalProvider` + `useToolApprovalBridge` hooks（commits 3f9b9d31b / 906c28a06）
- [x] 新 tool approval 流程 + registry
- [x] 审批 hooks 整合,删除旧代码
- [x] `feat(provider-registry): vendor identity patterns + 模型能力检测`（ce9390bed）
- [x] UniqueModelId 迁移（commit a4309aad6 + greedy path params 14359）
- [ ] Agent 步骤进度推送 UI
- [ ] 残留旧 Agent UI 清理

### Phase 1 剩余（功能增强，可渐进）

```
  ② 适配耦合文件 — parameterBuilder, messageConverter, fileProcessor
     (替换 window.api → Node.js fs / 直接 import service, 移除 @ts-nocheck)
     ⚠️ 阻塞: 部分 stubs 依赖 v2 data layer 完成

  ③ 复制缺失的耦合 plugin
     ✅ anthropicCachePlugin (已存在)
     ✅ pdfCompatibilityPlugin (已存在)
     ✅ telemetryPlugin (已存在, commit d6f113a8c)
     ⏳ searchOrchestrationPlugin (仍缺)

  ④ ~~ToolRegistry 接入内置 tools (WebSearch, Knowledge, Memory)~~
     ❌ 路线已调整 —— 内置 tools 方向作废(commit eff583abb `remove unused builtin tools`)
        转向:通过 MCP tools / Hub meta-tools 暴露这些能力

  ⑤ MCP tool 动态生命周期（server 连接/断开自动注册/注销）
     ⚠️ 依赖 #14123 MCPService 重构:
       - 需要 MCPService 统一入口 + server 生命周期事件
       - 需要 isServerConnected(id) API 实现 checkAvailable
       - 需要 CallToolArgs 扩展支持 context 传递

  ⑥ PluginBuilder 接入已有 plugins (reasoning, noThink, etc.)
     ✅ 已接入 + 条件能力支持(commit f4d4c8b9e)

  ⑦ providerOptions 接入 (reasoning effort, web search 等)
     ⚠️ 阻塞: buildProviderOptions 依赖 stubs
```

### Tool 发现策略：Hub meta-tools vs AI SDK activeTools

Cherry Studio 的 Hub MCP Server 和 AI SDK #14170 提出的 client-side tool search 本质解决同一问题
（tools 过多时 LLM 选择困难 + schema 占 context），但实现路径不同：

| | Hub MCP Server（当前方案） | AI SDK activeTools（#14170） |
|---|---|---|
| 实现层 | MCP server（transport 层） | AI SDK agent（prepareStep + activeTools） |
| LLM 可见 tools | 永远 4 个 meta-tools（list/inspect/invoke/exec） | 初始少（tools_search），按需激活真实 tool schemas |
| Tool 发现 | `list` → 文本描述 | `tools_search` → prepareStep 激活 |
| Tool 调用 | `invoke(name, params)` 或 `exec(code)` 编排多调用 | 直接原生 tool call（类型安全） |
| Schema 可见性 | LLM 不看到真实 tool schema，通过 `inspect` 按需获取 JSDoc | LLM 看到激活的 tool schemas |
| Prompt cache | ✅ 4 个 tool schema 永远不变 | ❌ activeTools 变化 bust cache（#14170 核心痛点） |
| 多工具编排 | `exec` 一次 JS 执行多个 tool（减少 LLM 往返） | 每步一个 tool call，多步循环 |
| 类型安全 | ❌ invoke/exec 参数是动态 JSON | ✅ 激活后有完整 schema |

**结论**：Hub 方案更优——不 bust prompt cache、`exec` 支持编排减少往返、tool schema 不占 context。
代价是失去原生 tool call 的类型安全，但 `inspect` 提供 JSDoc 作为补偿。

**与 agentLoop 的关系**：Hub 作为一个普通 MCP server 通过 ToolRegistry 注册 4 个 meta-tools，
不需要 agentLoop 层面的特殊处理。agentLoop 的 `options.activeTools` 预留给未来需要的场景
（比如某些 provider 不支持 Hub 模式时的 fallback）。

### SDK ToolSearch 深度分析 vs Hub list 改进方向

SDK 的 ToolSearch（源码: claude-code/manila-v1/src/tools/ToolSearchTool/）是 **API 级别的延迟加载**，
不只是应用层搜索。与 Hub 的 `list` 有本质区别：

#### 三种实现对比

| | SDK ToolSearch | Hub `list` | AI SDK activeTools (#14170) |
|---|---|---|---|
| **机制** | API `defer_loading: true` → LLM 看到工具名无 schema → ToolSearch 返回 `tool_reference` → API 自动展开完整 schema | 纯文本返回工具名+描述列表 | `prepareStep` 修改 `activeTools` 数组 |
| **Schema 注入** | API 在 `tool_reference` 响应后自动注入 | 从不注入（通过 `invoke` 动态调用） | 改变 activeTools 后下一步注入 |
| **搜索能力** | ✅ 4 层评分算法 | ❌ 只有分页浏览 | ❌ 手动指定 |
| **Prompt cache** | ✅ `defer_loading` schema 不在 request 中 | ✅ 4 个 meta-tools 不变 | ❌ activeTools 变化 bust cache |
| **Provider 兼容** | ❌ Anthropic API beta 专有 | ✅ 所有 provider | ✅ 所有 provider |

#### SDK ToolSearch 搜索算法（4 层评分）

```
查询: "+slack send message"

Layer 1: 精确匹配（fast path）
  → "mcp__slack__send_message" 完全匹配 → 直接返回

Layer 2: MCP 前缀匹配
  → "mcp__slack" 前缀 → 过滤该 server 所有 tools

Layer 3: 必选项过滤（+ 前缀）
  → "+slack" 必须包含 → 预过滤候选集

Layer 4: 评分排序
  tool: mcp__slack__send_message
  parts: ['slack', 'send', 'message']
    - 'slack' exact part match (MCP): +12
    - 'send' exact part match (MCP):  +12
    - 'message' exact part match:     +12
  Total: 36 → rank #1
```

评分权重：

| 匹配类型 | MCP tool | 普通 tool |
|---------|---------|----------|
| 精确 part 匹配 | +12 | +10 |
| 部分 part 匹配 | +6 | +5 |
| searchHint 匹配 | +4 | +4 |
| full name fallback | +3 | +3 |
| description 匹配 | +2 | +2 |

查询格式：
- `"select:Read,Edit,Grep"` — 精确选择（逗号分隔）
- `"notebook jupyter"` — 关键词搜索
- `"+slack send"` — `+` 前缀 = 必选项，其余为可选

每个 tool 可声明 `searchHint: string`（3-10 词能力描述）提高搜索精度。

#### SDK `defer_loading` + `tool_reference` 机制

```
1. 请求: tools 数组中包含 { name: "Read", defer_loading: true, ... }
   → LLM 看到 "Read" 这个名字，但没有参数 schema，不能直接调用

2. LLM 调用 ToolSearch({ query: "select:Read" })
   → ToolSearch 返回: [{ type: "tool_reference", tool_name: "Read" }]

3. API 看到 tool_reference → 自动将 Read 的完整 schema 注入到下一轮 context
   → LLM 现在可以调用 Read({ file_path: "...", offset: 1, limit: 100 })
```

**这是 Anthropic API 专有的 beta 功能**（需要 `advanced-tool-use` header），其他 provider 不支持。
因此 Hub 的 `invoke` 模式（不需要 schema 注入，LLM 直接传参数给 invoke）更通用。

#### Hub `list` 改进方向

当前 Hub 的 `list` 只有分页浏览，没有搜索。建议从 SDK 借鉴：

1. **给 `list` 加关键词搜索**：用 SDK 的 4 层评分算法，`list({ query: "slack send", limit: 10 })`
2. **给每个 tool 加 `searchHint`**：3-10 词能力描述，提高搜索精度
3. **MCP tool 名解析**：按 `__` 和 `_` 分词，MCP 权重更高（+12 vs +10）
4. **保持 `invoke`/`exec` 不变**：不需要 `tool_reference` — Hub 的无 schema 调用模式更通用

不需要实现 `defer_loading` / `tool_reference`（Anthropic 专有，其他 provider 不支持）。

### Hub `exec` 代码执行能力分析

Hub 的 `exec` tool 让 LLM 写 JS 代码编排多个 tool 调用——这是 Hub 相比 SDK ToolSearch 的独特优势。

#### 架构

```
LLM 生成 JS 代码
  ↓
Hub.handleExec(code)
  ↓
Runtime.execute(code)
  ↓
Worker Thread（隔离执行）
  ├── new Function(...contextKeys, wrappedCode)  ← 在 async context 中运行
  ├── mcp.callTool(name, params)  ← 通过 postMessage 桥接到主线程
  ├── parallel(...promises)       ← Promise.all 并行调用多个 tool
  ├── settle(...promises)         ← Promise.allSettled 容错并行
  └── console.log/warn/error      ← 日志捕获（最多 1000 条）
         ↓
主线程 handleToolCall()
  ↓
callMcpTool(name, params, callId)  ← 实际执行 MCP tool
  ↓
结果通过 postMessage 返回 Worker
```

#### 安全模型

| 机制 | 实现 |
|------|------|
| **线程隔离** | `Worker Thread`（独立 V8 isolate，不共享主线程内存） |
| **超时** | 60s 硬超时 → terminate worker + abort 所有活跃 tool calls |
| **日志上限** | 最多 1000 条 log |
| **上下文限制** | Worker 只能访问 `mcp`、`parallel`、`settle`、`console` — 无 fs/net/process |
| **Tool 中止** | 超时时 `abortActiveTools()` 逐个 abort 所有进行中的 tool calls |

#### 与 just-bash 的对比

| | Hub `exec` | `just-bash` |
|---|---|---|
| 语言 | JavaScript（`new Function`） | Bash（纯 TS 解释器） |
| 隔离 | Worker Thread（V8 isolate） | InMemoryFs（纯内存 FS） |
| Tool 调用 | `mcp.callTool()` 桥接主线程 | 内置 ~80 命令（无 MCP） |
| 并行 | `parallel()` / `settle()` | 管道 `|` |
| 超时 | 60s 硬超时 | 迭代次数限制 |
| 安全 | 无 fs/net/process 访问 | 纯 TS 解释，无真实 shell |

#### exec 与 SDK AgentTool 的能力等价性

SDK 的 `AgentTool` spawn 子 agent 做多步推理。Hub 的 `exec` 用代码编排做同样的事：

```javascript
// SDK: AgentTool（多步推理，多次 LLM 调用）
// LLM 1: "I need to search slack and github"
// LLM 2: tool_use: slack_search
// LLM 3: tool_use: github_search
// LLM 4: "Here are the combined results..."

// Hub exec（一次代码编排，零额外 LLM 调用）
const [slackResults, githubResults] = await parallel(
  mcp.callTool('slack__search', { query: 'project update' }),
  mcp.callTool('github__search_repos', { query: 'cherry-studio' })
)
return { slack: slackResults, github: githubResults }
```

**exec 更高效**：一次 tool call 完成多个并行调用，无额外 LLM 往返。
但需要 LLM 有足够的编程能力来生成正确的编排代码。

#### 改进方向

1. **沙箱增强**: 当前 `new Function` 仍可访问部分全局对象（`Date`、`Math`、`JSON`）。
   可参考 `just-bash` 的 monkey-patch 策略屏蔽更多全局。
2. **结果类型化**: 当前 exec 返回 `JSON.stringify(result)` 纯文本。
   可扩展为结构化返回（区分 text/image/error）。
3. **流式日志**: 当前日志在执行完成后一次性返回。可改为实时推送。
4. **与 agentLoop 集成**: Hub 目前是独立 MCP server。未来可考虑将 exec 能力
   集成到 agentLoop 的 `hooks.prepareStep`（LLM 生成代码 → prepareStep 执行 → 注入结果）。

#### exec 的定位：通用代码执行 + tool 编排

`exec` 不只是 tool 编排器——它本身就是**代码执行引擎**。LLM 可以写任意 JS 逻辑，不调用任何 tool：

```javascript
// 纯计算（不调 tool）
const data = [3, 1, 4, 1, 5, 9, 2, 6]
return { sorted: data.sort((a, b) => a - b), median: data[Math.floor(data.length / 2)] }

// 数据转换（读 tool result → JS 处理）
const csv = await mcp.callTool('read', { path: 'data.csv' })
const rows = csv.split('\n').map(r => r.split(','))
return rows.slice(1).filter(r => r[2] === 'active')
```

exec 覆盖的场景 vs 需要 Bash 的场景：

| 场景 | exec (JS) | Bash |
|------|-----------|------|
| 数据处理/转换 | ✅ JS 原生 | 不需要 |
| 数学计算 | ✅ | 不需要 |
| JSON/CSV/XML 解析 | ✅ | 不需要 |
| 正则匹配/替换 | ✅ | 不需要 |
| 多 tool 并行编排 | ✅ `parallel()` | 不需要 |
| 条件/循环逻辑 | ✅ if/for/try-catch | 不需要 |
| 安装依赖 | ❌ 无 shell | **需要** |
| 启动/停止服务 | ❌ 无 process | **需要** |
| Git 操作 | ❌ 无 shell | **需要** |
| 文件系统直接操作 | ❌ 无 fs | **需要**（或通过 `mcp.callTool('read/write')`） |

**互补关系**：exec 负责逻辑编排和数据处理，Bash 负责系统级操作。
exec 可以调 Bash tool（`mcp.callTool('bash', {command: '...'})`），反过来不行。

### Agent 暴露给 LLM 的完整 Tool 集（原子化总结）

三层工具体系，从底层到高层：

#### Layer 1: 系统操作 tools（直接操作本地环境）

| Tool | 能力 | 实现 | needsApproval |
|------|------|------|--------------|
| **Read** | 读文件（文本/PDF/图片/notebook），支持 offset/limit | Node.js fs + sharp + pdf-parse | `false` |
| **Write** | 写文件，自动建目录，保持编码/行尾 | Node.js fs | `true` |
| **Edit** | 精确字符串替换，引号规范化，replace_all | Node.js fs + diff | `true` |
| **Glob** | 文件模式匹配，按修改时间排序 | ripgrep 或 fast-glob | `false` |
| **Grep** | 内容搜索，3 种输出模式，上下文行 | ripgrep | `false` |
| **Bash** | 命令执行，命令级权限分类 | child_process + AST 安全检查 | 命令级条件审批 |

#### Layer 2: 服务 tools（Cherry Studio 内置服务包装）

| Tool | 能力 | 底层服务 | needsApproval |
|------|------|---------|--------------|
| **WebSearch** | 多 provider 网络搜索 | `WebSearchService` | `false` |
| **WebFetch** | 获取网页内容 | `@cherry/browser` MCP server | `false` |
| **Knowledge** | RAG 知识库检索 | `KnowledgeService` (embedjs) | `false` |
| **Memory** | 记忆搜索/存储 | `MemoryService` | `false` |

#### Layer 3: 元能力 tools（编排 + 发现 + 扩展）

| Tool | 能力 | 实现 | needsApproval |
|------|------|------|--------------|
| **Hub list** | 搜索/发现所有可用 MCP tools（含关键词评分） | Hub MCP Server | `false` |
| **Hub inspect** | 获取单个 tool 的 JSDoc 签名 | Hub MCP Server | `false` |
| **Hub invoke** | 调用单个 MCP tool | Hub MCP Server | 继承目标 tool 的审批策略 |
| **Hub exec** | JS 代码执行 + 多 tool 并行编排 | Hub MCP Server (Worker Thread) | `true` |
| **SubAgent** | spawn 子 agent 处理子任务 | 递归 `generateText()`/`runAgentLoop()` | `false`（子 agent 内部 tools 有自己的审批） |

#### 用户自定义 tools（MCP servers）

| 来源 | 注册方式 | needsApproval |
|------|---------|--------------|
| 用户配置的 MCP servers | `registerMcpTools()` → ToolRegistry | 根据 `server.disabledAutoApproveTools` |
| Hub 聚合的所有 MCP tools | 通过 Hub list/invoke/exec 间接访问 | Hub invoke 继承目标 tool 策略 |

**总计**：6 系统 + 4 服务 + 5 元能力 = **15 个内置 tools** + 用户 MCP tools（无上限）

**设计原则**：
- Layer 1/2 是原子操作（每个 tool 做一件事）
- Layer 3 是组合能力（编排 Layer 1/2 + MCP tools）
- 只有写操作和代码执行需要 `needsApproval`
- MCP tools 通过 Hub 间接访问（不需要全部注册到 ToolLoopAgent 的 tool schema 中，保护 prompt cache）

### 交互能力：不是 tool，是协议

SDK 有一些看起来像 tool 但本质是**交互协议**的能力。它们不操作文件、不调服务、不编排 tools——
它们是 agent ↔ 用户 / agent ↔ 系统 的**通信通道**。不应放入 tool 三层体系，而是用 AI SDK 已有机制实现。

| SDK Tool | 本质 | 为什么不是 tool | AI SDK 替代机制 |
|----------|------|----------------|----------------|
| **AskUserQuestion** | 向用户提问（多选/确认/文本输入） | 不操作任何资源，是流程控制 | `DataUIPart` (type: 'user-question') + `PendingMessageQueue` steering |
| **TodoWrite** | 任务清单管理 | 可用 Write tool 写任何格式的文件 | 不需要专用 tool |
| **TaskCreate/Get/Update** | 结构化任务跟踪 | 是 agent 内部状态管理，不是外部操作 | `experimental_context` 维护 task state + `DataUIPart` 展示进度 |
| **TaskOutput** | 读异步任务输出 | 是后台任务回读，和 Bash background 配套 | Bash `run_in_background` 的输出存入 context，通过 `prepareStep` 注入 |
| **SendMessage** | 给其他 agent 发消息 | 是 agent 间通信协议 | SubAgent 的 `experimental_context` 或专用 IPC channel |

#### AskUserQuestion → DataUIPart + Steering

agent 想问用户问题时，不调 tool，而是**生成一个 DataUIPart**：

```
Agent 生成 DataUIPart:
  { type: 'user-question', data: {
    question: "找到 3 个匹配文件，处理哪个？",
    options: ["src/a.ts", "src/b.ts", "src/c.ts"],
    inputType: "single-select"  // 或 "multi-select" / "text"
  }}
         ↓
Renderer 渲染为交互组件（选择框/输入框）
         ↓
用户选择 "src/b.ts"
         ↓
Renderer 调 steerMessage({ role: 'user', content: '用户选择了 src/b.ts' })
         ↓
PendingMessageQueue → prepareStep drain → agent 看到回答继续执行
```

**不破坏 tool 层级** — 问用户是流程控制，不是 tool 调用。
**不需要 needsApproval 机制** — `needsApproval` 只能 approve/deny，不能传选项。

#### TaskCreate/Get/Update → experimental_context

agent 跟踪多步计划时，不需要专用 tools——用 `experimental_context` 在步间维护状态：

```typescript
// prepareStep 中
prepareStep: ({ experimental_context }) => {
  const ctx = experimental_context as AgentContext
  // 读取当前任务列表
  const tasks = ctx.tasks ?? []
  // agent 可以在 response 中更新任务（通过 text 指令解析或 DataUIPart）
  return {}
}
```

任务进度通过 `DataUIPart` (type: 'task-progress') 推送给 renderer 展示，
而非通过 tool call 的 input/output 在消息流中占位。

#### 设计原则

**Tool 三层体系只包含"做事"的能力**（操作资源 / 调服务 / 编排组合）。
**交互 / 状态管理 / 通信**用 AI SDK 的正交机制：

| 需求类型 | 机制 | 不用 tool 的原因 |
|----------|------|----------------|
| 用户交互 | DataUIPart + PendingMessageQueue | 流程控制 ≠ 资源操作 |
| 二选一确认 | needsApproval | AI SDK 原生 |
| 任务状态 | experimental_context | agent 内部状态 ≠ 外部操作 |
| 进度展示 | DataUIPart | UI 展示 ≠ tool 调用 |
| Agent 间通信 | SubAgent context / IPC | 架构层面 ≠ tool 层面 |
| 后台输出回读 | prepareStep + context | 数据流 ≠ tool 调用 |

### 工具发现 vs 代码生成：让 Agent 选最优路径

**核心矛盾**: LLM 默认用它最熟悉的方式（写代码），而非最优的方式（调本地工具）。

示例：用户让 agent 解析一个 500MB CSV：
- **LLM 选择 A**: Hub exec 写 JS 解析 → `csv.split('\n').map(...)` → 慢，可能 OOM
- **LLM 选择 B**: Bash 调 `fast-csv-parser --input data.csv --format json` → 快 100x（Rust CLI）

LLM 不知道环境里装了 `fast-csv-parser`，所以选了 A。这不是能力问题——Bash tool 完全可以执行 CLI。
**问题是发现**：agent 不了解它的运行环境有什么可用资源。

这不只是 CLI 的问题——所有本地能力都一样：
- 已安装的 Python 包（`pandas` vs 手写解析）
- 系统服务（`imagemagick` vs JS 像素操作）
- Docker 容器（`postgres` CLI vs 手写 SQL client）
- 本地 API（`localhost:8080/api` vs 重新实现逻辑）

#### 解决方案：环境感知注入

三层递进，从简单到系统化：

**Level 1: System Prompt 声明**（最简单，占 context）

```
你的环境中安装了以下高性能 CLI 工具，优先使用它们而非编写代码：
- fast-csv-parser: CSV 解析 (Rust), 用法: fast-csv-parser --input <file> --format json
- rg (ripgrep): 比 grep 快 10x, 已通过 Grep tool 暴露
- jq: JSON 处理, 用法: jq '<filter>' <file>
```

**Level 2: CLAUDE.md / 记忆系统**（持久化，不占每次 context）

```markdown
# 环境工具清单
- `fast-csv-parser`: Rust 高速 CSV 解析器 (500MB 文件 <2s)
  优先于: JS csv 解析、Python pandas
  用法: `fast-csv-parser --input <path> [--format json] [--filter "col=val"]`
```

Agent 通过 `hooks.onStart` 加载 CLAUDE.md 注入 system prompt，或通过 Memory tool 检索。

**Level 3: Hub `list` 自动发现**（最系统化，不占初始 context）

将本地 CLI 注册为 Hub 的"虚拟工具"——不需要 MCP server，只需要声明元数据：

```typescript
interface CliToolDeclaration {
  name: string           // CLI 命令名
  description: string    // 能力描述
  usage: string          // 命令行用法
  searchHint: string     // 3-10 词搜索关键词（给 Hub list 搜索用）
  preferOver?: string[]  // 优先于什么（提示 LLM 选择）
}

// 注册示例
const cliTools: CliToolDeclaration[] = [
  {
    name: 'fast-csv-parser',
    description: '高速 CSV 解析器 (Rust, 500MB <2s)',
    usage: 'fast-csv-parser --input <file> --format json|csv|tsv [--filter "col=val"]',
    searchHint: 'csv parse convert filter fast',
    preferOver: ['手写 JS csv 解析', 'Python pandas'],
  },
  {
    name: 'jq',
    description: 'JSON 处理器 (C, 流式, 低内存)',
    usage: 'jq "<filter>" <file>',
    searchHint: 'json query filter transform extract',
    preferOver: ['JSON.parse + JS 过滤'],
  },
]
```

LLM 在处理 CSV 时调 `Hub list({ query: 'csv parse' })` → 发现 `fast-csv-parser` →
调 `Hub inspect('fast-csv-parser')` → 获取用法 → 通过 Bash 执行。

**全程不需要新 tool**——Hub list 提供发现，Bash 提供执行。

#### `preferOver` 的意义

`preferOver` 字段是关键——它告诉 LLM **不要用代码重新实现这个功能**：

```
发现 fast-csv-parser 后，LLM 的决策变为：
- "我需要解析 CSV"
- "环境有 fast-csv-parser，它优先于手写 JS csv 解析"
- → 选择 Bash 调 CLI，而非 exec 写 JS
```

没有 `preferOver`，LLM 仍可能忽略 CLI 而选择自己写代码（因为写代码是它的"舒适区"）。

#### exec 和 Bash 的协作模式

最优模式是**组合使用**——exec 编排逻辑，Bash 调本地工具：

```javascript
// exec 内部（编排层）
const csvData = await mcp.callTool('bash', {
  command: 'fast-csv-parser --input data.csv --format json'
})
const parsed = JSON.parse(csvData)
const filtered = parsed.filter(row => row.revenue > 10000)
const sorted = filtered.sort((a, b) => b.revenue - a.revenue)
return { topRecords: sorted.slice(0, 10), totalCount: filtered.length }
```

CLI 做重活（解析 500MB CSV），JS 做轻活（filter + sort + 取 top 10）。

### Phase 2 (IPC 通道 + AiStreamManager 架构)

```
  ⑮ IPC channels + preload (Ai_Stream_Open/Attach/Detach/Abort)
  ⑯ StreamListener 接口 + InternalStreamTarget(带 setFinalMessage)
  ⑯ AiStreamManager (activeStreams / buffer / 多播 / grace period / steering)
  ⑯ PersistenceListener 直接调 Main 端 messageService(不新建 MessagePersistenceService)
  ⑰ handleStreamRequest 在起流前原子落 user message(显式 parentAnchorId,避开 activeNodeId 竞态)
  ⑯ IpcChatTransport (sendMessages + reconnectToStream + cancel=detach)
  ⑯ 删除 messageThunk.ts 里 ~500 行旧 transport / streaming 代码
  ⑯ ChannelAdapterListener + ChannelMessageHandler 迁移到 AiStreamManager
  ⑯ 删除 Ai_StreamRequest / Ai_Abort / Ai_SteerMessage,统一走 Ai_Stream_*
```

### Phase 3 (useChat 接入)

```
  ⑰ @ai-sdk/react 依赖 + DataUIPart schema
  ⑱ Message 渲染组件改造 (parts 替代 blocks)
  ⑲ Chat.tsx 改造 + 删除旧 aiCore 代码
  ℹ️ 直接使用官方 useChat({ id: topicId, transport }) —— 依赖 Phase 2 AiStreamManager + Transport 已就绪
```

### Phase 4 (Agent 统一)

```
  ⑳ Agent 特有功能完善 (ToolRegistry needsApproval 配置 + 步骤进度)
  ㉑ ✅ Tool 权限审批接入 AI SDK v6 原生 ToolUIPart + Claude Agent 侧通道（2026-04-19 完成）
  ㉒ 删除旧 Agent 代码 + E2E 测试
```

### Phase 5 (架构优化，迁移完成后)

```
  ㉓ 纯逻辑文件提取到 packages/aiCore
  ㉔ parameterBuilder 拆分为 aiCore plugins
  ㉕ 评估 Utility Process 迁移时机
```

Phase 6 ~~(TODO: ClaudeCodeService → 统一 ToolLoopAgent)~~ **已完成** (2026-04-13):
  ✅ Claude Code 通过 `ai-sdk-provider-claude-code` 作为标准 AI SDK provider 接入
  ✅ 删除 ClaudeCodeService、transform.ts、AgentStreamInterface、ClaudeCodeStreamAdapter
  ✅ SchedulerService + ChannelMessageHandler 迁移到 AiStreamManager StreamListener 模式
  ✅ 删除 SessionStreamBus + sessionStreamIpc（renderer 通过 Ai_Stream_Attach 订阅 topic）

---

## 2026-04-13 后端架构更新

> 以下内容反映 Phase 6 完成后的**当前后端架构**。上文中关于 `ClaudeCodeStreamAdapter`、
> 两条后端路径（agentLoop vs ClaudeCodeService）、`SessionStreamBus` 的设计已过时，
> 保留作为历史决策记录。

### 架构总览：一条路径，统一 provider

```
所有 AI 请求
  → AiStreamManager.startExecution (topic + model + listeners)
    → AiService.executeStream
      → AiCompletionService.streamText
        → buildAgentParams (provider 解析 + session 设置)
          → providerToAiSdkConfig(provider, model, { agentSessionId? })
            → 普通 provider: 原有 config builder
            → claude-code + agentSessionId: buildClaudeCodeConfig 查 DB → buildClaudeCodeSessionSettings → 完整 ClaudeCodeSettings
        → runAgentLoop(config, messages, signal)
      → UIMessageChunk 流
    → InternalStreamTarget → AiStreamManager.onChunk → 分发到所有 listeners
```

**核心变化：Claude Code 不再是特殊路径**。它是一个通过 `ai-sdk-provider-claude-code` 注册的标准 AI SDK provider，和 OpenAI、Anthropic、Gemini 等 provider 平级。Agent session 的 settings（cwd、MCP servers、tool permissions、system prompt）通过 `providerToAiSdkConfig` 流水线解析，不需要绕过 `AiCompletionService`。

### AiStreamManager 职责

```
stream-manager/
  AiStreamManager.ts          — lifecycle 服务（topic 注册表 + 多播 + 生命周期）
  InternalStreamTarget.ts     — 路由 executeStream 输出回 AiStreamManager
  types.ts                    — StreamListener, ActiveStream, StreamExecution 等
  index.ts                    — barrel export
  listeners/
    WebContentsListener.ts    — 推 chunks 到 renderer（IPC）
    PersistenceListener.ts    — 流结束时写 SQLite
    ChannelAdapterListener.ts — 推 chunks 到 IM channel
```

| 方法 | 职责 |
|------|------|
| `startExecution` | 创建 ActiveStream + StreamExecution，启动 agentLoop |
| `send` | 有活跃流 → steer；否则 → startExecution |
| `onChunk` | 多播到所有 listeners |
| `onExecutionDone/Error` | 广播终态到 listeners |
| `handleAttach/Detach` (IPC) | renderer 订阅/退订 topic |
| `abort` | 中止所有 executions |

### 订阅者模型

所有订阅者平等，通过 `StreamListener` 接口消费：

- **Renderer** → `Ai_Stream_Attach` IPC → `WebContentsListener`
- **Channel (Discord/Slack/etc)** → `ChannelAdapterListener`
- **Scheduler** → `ChannelAdapterListener` + inline sentinel
- **PersistenceListener** → 自动添加

不再有 `SessionStreamBus`（旧推送模式）。Renderer 和 Channel 都是 topic 的平等订阅者。

### Claude Code Agent Session 设置流

```
调用方构造 AiStreamRequest:
  chatId: 'agent-session:${sessionId}'    ← topic ID 约定
  uniqueModelId: 'providerId::modelId'    ← 从 session.model 解析

AiCompletionService.buildAgentParams:
  → 检测 chatId 前缀 'agent-session:' → 提取 agentSessionId
  → providerToAiSdkConfig(provider, model, { agentSessionId })

providerConfig.ts / buildClaudeCodeConfig:
  → agentSessionId 存在时从 DB 查 session
  → buildClaudeCodeSessionSettings(session, provider) → 完整 ClaudeCodeSettings
    包含: cwd, env, pathToClaudeCodeExecutable, spawnClaudeCodeProcess,
          systemPrompt, settingSources, permissionMode, maxTurns,
          allowedTools, disallowedTools, canUseTool, hooks,
          mcpServers (browser + exa + claw + assistant), plugins
  → 返回 { providerId: 'claude-code', providerSettings: { defaultSettings: sessionSettings } }
```

### 已删除的旧代码

| 文件/目录 | 替代方案 |
|-----------|---------|
| `claudecode/index.ts` (ClaudeCodeService) | `ai-sdk-provider-claude-code` 作为标准 provider |
| `claudecode/transform.ts` | provider 内部处理 SDKMessage → UIMessageChunk |
| `claudecode/utils.ts` | provider 内部处理 |
| `claudecode/claude-stream-state.ts` | `buildNamespacedToolCallId` 移入 `claudeCodeSettingsBuilder.ts` |
| `interfaces/AgentStreamInterface.ts` | `StreamListener` 接口 |
| `adapters/ClaudeCodeStreamAdapter.ts` | 不需要 — 一条路径 |
| `channels/SessionStreamBus.ts` | `WebContentsListener` via `Ai_Stream_Attach` |
| `channels/sessionStreamIpc.ts` | `AiStreamManager` IPC handlers |
| `apiServer/handlers/messages.ts` | 未来通过 `AiStreamManager` API 重建 |
| `SessionMessageService.createSessionMessage` | `AiStreamManager.startExecution` |

### API Server 订阅 AiStreamManager

#### 废弃旧模式

旧架构中 API Server 暴露两种 AI 调用方式，都已过时：

| 旧接口 | 问题 | 状态 |
|--------|------|------|
| `POST /agents/:agentId/sessions/:sessionId/messages` | 通过 `sessionMessageService.createSessionMessage` 手动 pump stream → SSE | **已删除** |
| `POST /v1/chat/completions` (OpenAI 兼容) | 独立的 `chatCompletionService`，绕过 AiStreamManager，无 listener 分发 | **待废弃** |

两者共同的问题：
- 自己管流生命周期（手动 pump ReadableStream → SSE response），不走 AiStreamManager 的 topic 注册表
- Renderer 无法通过 `Ai_Stream_Attach` 订阅同一个 topic（API 发起的流对 renderer 不可见）
- 不受 PersistenceListener 管理，持久化逻辑自己写
- 无 buffer 回放、无 grace period、无 steering 支持

#### 新模式：API Server 作为 StreamListener

API Server 的 SSE endpoint 应该作为 AiStreamManager 的一个 listener，和 WebContentsListener、ChannelAdapterListener 平等：

```
API Client → POST /v1/agents/:id/sessions/:id/stream
  → API Handler:
    1. 解析 session → topicId
    2. 构建 AiStreamRequest（同 SchedulerService / ChannelMessageHandler 模式）
    3. 注册 inline StreamListener（写 SSE 到 res）
    4. 调 aiStreamManager.startExecution({ topicId, modelId, request, listeners })
    5. listener.onChunk → res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    6. listener.onDone → res.write('data: [DONE]\n\n'); res.end()
    7. listener.onError → res.write(error SSE); res.end()
```

```typescript
// 伪代码 — API handler 内联 listener
const listeners: StreamListener[] = [
  {
    id: `sse:${req.id}`,
    onChunk: (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`),
    onDone: () => { res.write('data: [DONE]\n\n'); res.end() },
    onError: (err) => { res.write(`data: ${JSON.stringify({ type: 'error', error: err })}\n\n`); res.end() },
    isAlive: () => !res.writableEnded
  }
]

aiStreamManager.startExecution({ topicId, modelId, request, listeners })
```

#### API 网关格式转换：`SSEListener` + `mapChunk`

API 网关对外暴露标准 OpenAI 格式（`/v1/chat/completions`、`/v1/responses`），但内部所有 AI 执行产出的是 AI SDK 的 `UIMessageChunk`。两者格式不同：

| AI SDK `UIMessageChunk` | OpenAI `ChatCompletionChunk` |
|---|---|
| `{ type: 'text-delta', text: '你好' }` | `{ choices: [{ delta: { content: '你好' }, finish_reason: null }] }` |
| `{ type: 'tool-call', toolName, input }` | `{ choices: [{ delta: { tool_calls: [...] } }] }` |
| `{ type: 'finish-step', finishReason }` | `{ choices: [{ delta: {}, finish_reason: 'stop' }] }` |

AI SDK 没有内置 `UIMessageChunk → OpenAI ChatCompletionChunk` 转换器。这层映射由 `SSEListener.mapChunk` 承担：

```typescript
// stream-manager/listeners/SSEListener.ts
// mapChunk: 将 UIMessageChunk 转换为目标格式（OpenAI / Anthropic / Responses 等）

new SSEListener(
  (data) => res.write(`data: ${data}\n\n`),
  () => { res.write('data: [DONE]\n\n'); res.end() },
  () => !res.writableEnded,
  {
    mapChunk: (chunk) => {
      // UIMessageChunk → OpenAI ChatCompletionChunk
      if (chunk.type === 'text-delta') {
        return {
          id: requestId,
          object: 'chat.completion.chunk',
          created: timestamp,
          model: modelName,
          choices: [{ index: 0, delta: { content: chunk.text }, finish_reason: null }]
        }
      }
      return null // 过滤非文本 chunk（tool calls、reasoning 等按需处理）
    }
  }
)
```

**关键决策**：API 网关不直接创建 OpenAI client 调上游 provider（旧 `chatCompletionService` 的做法），而是通过 AiStreamManager 统一执行，再通过 `mapChunk` 转换输出格式。这样：
- 所有 provider 都能被 API 网关暴露（不限于 OpenAI 兼容 provider）
- API 发起的流对 renderer 可见（共享 topic）
- 共享 PersistenceListener、buffer 回放、steering 等能力

#### `POST /v1/chat/completions` 的迁移路径

> **注**：#12258（API Gateway + Model Groups + Responses API）尚未合并，以下是合并后的迁移方向。

`chatCompletionService` 当前直接创建 OpenAI client 代理到上游 provider，绕过 AiStreamManager。迁移方向：

1. **非流式** (`stream: false`)：改为调 `AiCompletionService.generateText`，结果转换为 OpenAI `ChatCompletion` 格式
2. **流式** (`stream: true`)：改为 `AiStreamManager.startExecution` + `SSEListener(mapChunk: UIMessageChunk → ChatCompletionChunk)`
3. **Request 映射**：OpenAI `messages` → `CherryUIMessage[]`（已有 `convertToModelMessages`）
4. **Response 映射**：`UIMessageChunk` → OpenAI `ChatCompletionChunk`（via `SSEListener.mapChunk`）
5. **`/v1/responses` 端点**：同理，`mapChunk` 转换为 OpenAI Responses 格式的 semantic events（`response.created`、`response.output_text.delta` 等）

迁移后 `chatCompletionService` 变为薄转换层：只做 OpenAI ↔ Cherry 格式映射，不做 provider 解析、不管流生命周期。

#### 设计原则

- **API Server 不直接调 AI SDK**。所有 AI 调用通过 `AiStreamManager`（流式）或 `AiCompletionService`（非流式）
- **API Server 不管流生命周期**。它是 listener，不是 controller。abort 通过 `Ai_Stream_Abort` 或 AbortController
- **SSE 只是一种 transport**。和 IPC（WebContentsListener）、IM（ChannelAdapterListener）平级
- **同一个 topic 的所有消费者共享同一个流**。API Client + Renderer + Channel 可以同时订阅

### 当前进度总览(2026-04-19)

| Phase | 状态 | 说明 |
|-------|------|------|
| Phase 1 — Main AI 执行层 | ✅ 完成 | AiService, AiCompletionService, agentLoop, ToolRegistry, plugins |
| Phase 2 — IPC 通道 + AiStreamManager | ✅ 完成 | stream-manager, listeners, IpcChatTransport, preload;扩展为 context/ + persistence/ + listeners/ 三子系统 |
| Phase 2.5 — ApiService 迁移 | ✅ 完成 | generateText, checkModel, embedMany, generateImage, listModels;renderer aiCore 目录已删 |
| Phase 3 — Renderer useChat 接入 | ✅ 完成 | `V2ChatContent` + `useChatWithHistory` + `ipcChatTransport`;renderer legacy aiCore 删除(188f25478) |
| Phase 4 — Agent 功能完善 | 🟡 进行中 | ✅ Tool 权限审批原生化(ToolApprovalProvider + 新 registry);✅ agent session 自动重命名;⏳ Agent 步骤进度推送、旧 Agent UI 清理 |
| Phase 6 — Claude Code 统一 | ✅ 完成 | ai-sdk-provider-claude-code, claudeCodeSettingsBuilder, 删除旧代码 |
| Phase 5 — 架构优化 | 待开始 | aiCore plugins 拆分, Utility Process 评估 |

**尚未完成的具体项**:
- Phase 1 ③ `searchOrchestrationPlugin` 仍待复制
- Phase 1 ⑤ MCP tool 动态生命周期(阻塞于 #14123 MCPService 重构)
- Phase 1 ⑦ providerOptions 接入(阻塞于 stubs)
- Phase 2.5 最后 1 处 `AiProvider` 引用(`InputEmbeddingDimension.test.tsx`)
- Phase 4 Agent 步骤进度推送 UI + 旧 Agent 残留 UI 清理
- ~~Phase 1 ④ 内置 tools~~ 已废弃(改走 MCP / Hub 方向)
