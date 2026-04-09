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
| **新建/重写** | ~4 个 | AiService (已存在,更新)、AiCompletionService (已存在,重写)、IpcChatTransport、useAiChat、shared schemas |
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
    this.ipcOn(IpcChannel.Ai_Abort, (_, requestId: string) => {
      this.completionService.abort(requestId)
    })

    // Agent 执行中注入新消息 (steering, fire-and-forget)
    this.ipcOn(IpcChannel.Ai_SteerMessage, (_, requestId: string, message: any) => {
      this.completionService.steer(requestId, message)
    })
  }

  /**
   * 执行 AI stream 并逐 chunk 推送到 target webContents。
   * 同时用于 Renderer IPC 请求和 Main 内部 Agent/Channel 调用。
   */
  async executeStream(target: Electron.WebContents, request: AiStreamRequest) {
    const { requestId } = request
    const abortController = new AbortController()
    this.completionService.registerRequest(requestId, abortController)

    try {
      const stream = await this.completionService.streamText(request, abortController.signal)
      const reader = stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done || target.isDestroyed()) break
        target.send(IpcChannel.Ai_StreamChunk, { requestId, chunk: value })
      }

      if (!target.isDestroyed()) {
        target.send(IpcChannel.Ai_StreamDone, { requestId })
      }
    } catch (error) {
      if (!target.isDestroyed()) {
        target.send(IpcChannel.Ai_StreamError, { requestId, error: serializeError(error) })
      }
    } finally {
      this.completionService.removeRequest(requestId)
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
    const pendingMessages = this.getPendingMessageQueue(request.requestId)

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
        requestId: request.requestId,
        chatId: request.chatId,
        modelContextWindow: model.contextWindow ?? 128_000,
        onStepProgress: (progress) => this.emitStepProgress(request.requestId, progress),
      },
      request.messages,
      signal,
    )
  }

  // --- Request tracking ---
  registerRequest(requestId: string, controller: AbortController) { ... }
  removeRequest(requestId: string) { ... }
  abort(requestId: string) { ... }

  // --- Pending Messages (Steering) ---
  private pendingMessageQueues = new Map<string, PendingMessageQueue>()

  getPendingMessageQueue(requestId: string): PendingMessageQueue {
    if (!this.pendingMessageQueues.has(requestId)) {
      this.pendingMessageQueues.set(requestId, new PendingMessageQueue())
    }
    return this.pendingMessageQueues.get(requestId)!
  }

  /** 用户在执行中注入新消息（由 AiService IPC handler 调用） */
  steer(requestId: string, message: ModelMessage) {
    this.getPendingMessageQueue(requestId).push(message)
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

    // agent.generate() — 没有 tools 时就是单步 LLM 调用
    // 有 tools 时 agent 自主决策多步调用后返回最终结果
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
  abort: (requestId) => ipcRenderer.send(Ai_Abort, requestId),
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
 *   onStepFinish: (step) => emitStepProgress(requestId, step),
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

oRPC 使用 Zod schema 作为跨进程的类型契约，不需要手写 `BridgeRequest` / `WorkerMessage` / `WorkerControl` 等消息类型——oRPC 内部处理序列化、requestId 匹配、错误传播。

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

export const aiStreamRequestSchema = z.object({
  /** 请求唯一标识，用于 IPC chunk 路由和 abort */
  requestId: z.string(),
  /** 对话 ID，映射到 useChat({ id }) */
  chatId: z.string(),
  /** AI SDK ChatTransport 定义的触发类型 */
  trigger: z.enum(['submit-message', 'regenerate-message']),
  /** regenerate 时指定的消息 ID */
  messageId: z.string().optional(),
  /** 对话历史 (UIMessage[]) */
  messages: z.array(z.any()),
  /** Provider ID (e.g. 'openai', 'anthropic') */
  providerId: z.string().optional(),
  /** Model ID (e.g. 'gpt-4o', 'claude-sonnet-4-20250514') */
  modelId: z.string().optional(),
  /** Assistant 级别设置 */
  assistantConfig: assistantConfigSchema.optional(),
  /** Web search 配置 */
  websearchConfig: z.any().optional(),
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
  // 注意：不再需要 toolsRequiringApproval — 每个 tool 在 ToolRegistry 注册时
  // 自带 needsApproval 声明，AI SDK 自动管理审批流程
})

export const uiMessageChunkSchema = z.any() // AI SDK 类型，运行时不严格验证
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
   Ai_SteerMessage = 'ai:steer-message'  // Renderer → Main: Agent 执行中注入新消息（steering）
   Ai_AgentStepProgress = 'ai:agent-step-progress' // Main → Renderer: Agent 步骤进度推送
   ```

### Step 2.2: Preload 暴露 AI API

**修改文件**: `src/preload/index.ts`

**操作**:
1. 在 `api` 对象中添加 `ai` 命名空间:
   ```typescript
   ai: {
     streamText: (request) => ipcRenderer.invoke(IpcChannel.Ai_StreamText, request),
     abort: (requestId) => ipcRenderer.send(IpcChannel.Ai_Abort, requestId),
     steerMessage: (requestId, message) => ipcRenderer.send(IpcChannel.Ai_SteerMessage, requestId, message),
     onStreamChunk: (callback) => ipcRenderer.on(IpcChannel.Ai_StreamChunk, (_, data) => callback(data)),
     onStreamDone: (callback) => ipcRenderer.on(IpcChannel.Ai_StreamDone, (_, data) => callback(data)),
     onStreamError: (callback) => ipcRenderer.on(IpcChannel.Ai_StreamError, (_, data) => callback(data)),
     onAgentStepProgress: (callback) => ipcRenderer.on(IpcChannel.Ai_AgentStepProgress, (_, data) => callback(data)),
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

### Step 4.3: Tool 权限审批 — AI SDK 原生方案

**不再自建 IPC round-trip**。AI SDK v6 内置完整的 tool approval 机制：

```
Server (Main)                                    Client (Renderer)
                                                 useChat({ sendAutomaticallyWhen:
                                                   lastAssistantMessageIsCompleteWithApprovalResponses })

Agent 调用 needsApproval=true 的 tool
  → AI SDK 自动发送 tool-approval-request         → ToolUIPart state: 'approval-requested'
                                                   → 渲染审批 UI (Approve / Deny)
                                                   → 用户点击
  ← addToolApprovalResponse({ id, approved })     ←
AI SDK 根据 approved 决定:
  approved=true  → 执行 tool.execute()  → output-available
  approved=false → 跳过执行             → output-denied
```

**操作**:

Main 侧:
1. `createMcpTool()` 已声明 `needsApproval` — 但当前硬编码无此字段
   → 根据 MCPServer 配置决定: `needsApproval: !server.disabledAutoApproveTools?.includes(toolName)`
   → 即 disabledAutoApproveTools 中的 tool 需要审批，其余自动批准
2. 内置 tools (WebSearch, Knowledge, Memory) 设置 `needsApproval: false`
3. Agent tools 可通过 `needsApproval: async ({ toolCall }) => shouldApprove(toolCall)` 做条件审批

Renderer 侧:
4. `useAiChat` 配置 `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`
   → AI SDK 在所有 approval 响应后自动发送下一轮请求
5. Message 渲染组件处理 ToolUIPart 的 `approval-requested` 状态 → 渲染审批按钮
   → 替代当前 `useMcpToolApproval` hook + `ToolApprovalActions` 组件
6. 审批按钮调用 `chat.addToolApprovalResponse({ id, approved, reason })`
   → 替代当前 `confirmToolAction` / `cancelToolAction`
7. AI SDK 自动完成后续流程（执行或拒绝），**无需自建 IPC channel**

**需要删除的旧代码**（自建 approval 系统）:
```
src/renderer/src/utils/userConfirmation.ts           # requestToolConfirmation / confirmToolAction 等
src/renderer/src/utils/mcp-tools.ts                  # isToolAutoApproved 等
src/renderer/src/pages/home/Messages/Tools/hooks/
  useMcpToolApproval.ts                              # 自建 approval 状态管理
  useAgentToolApproval.ts                            # Agent 专用 approval
  useToolApproval.ts                                 # 通用 approval 接口
src/renderer/src/pages/home/Messages/Tools/
  ToolApprovalActions.tsx                            # 审批按钮组件
  ToolPermissionRequestCard.tsx                      # 权限请求卡片
```

**需要修改的文件**:
```
src/renderer/src/hooks/useAiChat.ts                  # 添加 sendAutomaticallyWhen
src/renderer/src/pages/home/Messages/Tools/
  MessageMcpTool.tsx                                 # 用 ToolUIPart states 替代自建 approval
src/main/ai/tools/mcpTools.ts                        # createMcpTool 添加 needsApproval 逻辑
```

**与旧方案对比**:

| | 旧方案（自建） | 新方案（AI SDK 原生） |
|--|--------------|-------------------|
| 权限声明 | `toolsRequiringApproval` 字符串数组 | `needsApproval` 在 tool 定义时声明 |
| 审批流程 | `experimental_onToolCallStart` → 自建 IPC → 等待 → 返回 | AI SDK 自动: tool-approval-request → addToolApprovalResponse |
| UI 状态 | 自定义 DataUIPart `agent-permission` | AI SDK 内置 ToolUIPart states (`approval-requested` / `approval-responded` / `output-denied`) |
| 条件审批 | 手动 if/else | `needsApproval: async ({ toolCall }) => shouldApprove(toolCall)` |
| 自动继续 | 手动 IPC 回调 | `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` |

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
| 2 | 2.3 | `src/renderer/src/transport/IpcChatTransport.ts` | 已存在，验证 |
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
- [x] MCP tools 按需注册（registerMcpTools + createMcpTool + callTool + toolCallId）
- [ ] 删除 renderer ApiService 中的 AI 调用代码 + AiProvider 类（等所有调用方确认无残留）

### Phase 1 剩余（功能增强，可渐进）

```
  ② 适配耦合文件 — parameterBuilder, messageConverter, fileProcessor
     (替换 window.api → Node.js fs / 直接 import service, 移除 @ts-nocheck)
     ⚠️ 阻塞: 部分 stubs 依赖 v2 data layer 完成
  ③ 复制缺失的耦合 plugin (searchOrchestration, telemetry, pdf, anthropicCache)
  ④ ToolRegistry 接入内置 tools (WebSearch, Knowledge, Memory)
  ⑤ MCP tool 动态生命周期（server 连接/断开自动注册/注销）
     ⚠️ 依赖 #14123 MCPService 重构:
       - 需要 MCPService 统一入口 + server 生命周期事件
       - 需要 isServerConnected(id) API 实现 checkAvailable
       - 需要 CallToolArgs 扩展支持 context 传递
  ⑥ PluginBuilder 接入已有 plugins (reasoning, noThink, etc.)
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

### Phase 3 (useChat 接入)

```
  ⑰ @ai-sdk/react + DataUIPart schema + useAiChat hook
  ⑱ Message 渲染组件改造 (parts 替代 blocks)
  ⑲ Chat.tsx 改造 + 删除旧 aiCore 代码
```

### Phase 4 (Agent 统一)

```
  ⑳ Agent 特有功能完善 (ToolRegistry needsApproval 配置 + 步骤进度)
  ㉑ useAiChat Agent 支持
  ㉒ 删除旧 Agent 代码 + E2E 测试
```

### Phase 5 (架构优化，迁移完成后)

```
  ㉓ 纯逻辑文件提取到 packages/aiCore
  ㉔ parameterBuilder 拆分为 aiCore plugins
  ㉕ 评估 Utility Process 迁移时机
```

Phase 6 (TODO: ClaudeCodeService → 统一 ToolLoopAgent):
  ⑲ 替代 ClaudeCodeService (Claude Agent SDK) 为统一的 ToolLoopAgent 实现
```
