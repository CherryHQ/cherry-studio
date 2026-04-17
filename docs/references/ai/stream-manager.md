# AiStreamManager 架构

## 概述

AiStreamManager 是 Main 进程的**活跃流注册表**。它接管 AI 流式回复的完整生命周期 —— 从用户点击发送到 assistant 消息持久化落库，中间经过的所有环节（多播分发、reconnect、abort、steering、持久化）都由 AiStreamManager 统一管理。

Renderer 不再直接持有流的引用。窗口关闭不等于流终止 —— 流在 Main 中继续执行并完成持久化。用户返回该对话时，AiStreamManager 提供 reconnect 能力（缓存回放 + 恢复实时订阅）。

**唯一标识: `topicId`**。一个 topic 同时最多有一条活跃流。streaming 只是 topic 的一种数据状态，所有订阅方地位平等，不区分"发起者"和"观察者"。

## 解决什么问题

v1 的流是"一次性管线"：Renderer 发起 IPC → AiService 直接耦合于 `event.sender`（WebContents）→ 逐个 chunk 通过 `wc.send` 发送 → 流结束后立即释放。这条管线存在三个结构性缺陷：

### 1. 流的生命周期耦合于窗口

AI SDK `useChat` 内部通过 `useRef` 持有 `Chat` 实例。组件 unmount → Chat 被回收 → Transport 的 ReadableStream 被 cancel → Main 端收到 abort 信号 → 流被终止。

**用户感知**: 切换 topic、关闭窗口、甚至路由跳转，正在生成的回复会静默消失。

### 2. 不支持 reconnect

`IpcChatTransport.reconnectToStream()` 返回 `null`。AI SDK 的 `useChat` 在组件 mount 时会调用此方法检查是否有进行中的流可以恢复，收到 `null` 则认为不存在。

**用户感知**: 切换到其他 topic 后返回，无法看到正在生成的回复，只能等待完成后从数据库读取。

### 3. 持久化在 Renderer 侧执行

`ChatSessionManager.handleFinish`（440 行）在 Renderer 中执行持久化。整条 persistence 路径的可靠性取决于窗口是否存活 —— 如果在写入数据库前 Renderer 崩溃、窗口关闭或页面刷新，数据将丢失。

**核心设计目标**: 将流的生命周期管理、多播分发、持久化全部下沉到 Main 进程，Renderer 仅负责显示 chunk 内容。

## 架构全景

```
┌──────────────── Renderer ────────────────────────────────┐
│                                                          │
│  useChat({ id: topicId, transport: IpcChatTransport })   │
│    ├─ sendMessages   → Ai_Stream_Open  (topicId, userMessageParts, parentAnchorId)
│    ├─ reconnect      → Ai_Stream_Attach ({ topicId })    │
│    └─ cancel         → Ai_Stream_Abort  ({ topicId })    │
│                                                          │
│  历史消息: useQuery('/topics/:id/messages') → DataApi    │
│  活跃流 chunks: onStreamChunk listener, 按 topicId 过滤 │
└──────────────────────────────────────────────────────────┘
                  ↕ IPC (所有通信均以 topicId 为 key)
┌──────────────── Main ────────────────────────────────────┐
│                                                          │
│  ChatContextProvider.prepareDispatch(subscriber, req)    │
│    → PreparedDispatch { models, listeners, userMessage? }│
│                         ↓                                │
│  dispatchStreamRequest  ──┐                              │
│                           ↓                              │
│  AiStreamManager.send(input)                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │ activeStreams: Map<topicId, ActiveStream>           │  │
│  │   listeners: Map<listenerId, StreamListener>       │  │
│  │   executions: Map<modelId, StreamExecution>        │  │
│  │     ├─ abortController / status                    │  │
│  │     ├─ pendingMessages (per-execution queue)       │  │
│  │     └─ buffer (ring) + droppedChunks               │  │
│  └────────────────────────────────────────────────────┘  │
│         ↓ createAndLaunchExecution → runExecutionPump    │
│  AiService.streamText(request, signal) → ReadableStream  │
│         ↓ tee()                                          │
│    ┌────────┴────────┐                                   │
│    ↓                 ↓                                   │
│  broadcast          readUIMessageStream                  │
│  (onChunk)          (finalMessage 聚合)                  │
│                                                          │
│  终止事件 dispatchToListeners → 每个 StreamListener:     │
│    WebContentsListener   → wc.send(Ai_StreamDone)        │
│    PersistenceListener   → PersistenceBackend.persistAssistant
│      • MessageServiceBackend  (SQLite 树)                │
│      • TemporaryChatBackend   (内存)                     │
│      • AgentMessageBackend    (agents DB)                │
│    ChannelAdapterListener → adapter.onStreamComplete     │
│    SSEListener            → res.write('[DONE]')          │
└──────────────────────────────────────────────────────────┘
```

## 文件结构

```
src/main/ai/
├── AiService.ts                       lifecycle 服务: streamText + 非流式 IPC gateway
│                                       (消化了原 AiCompletionService 的全部业务逻辑)
├── PendingMessageQueue.ts             steering 队列 (drain + AsyncIterable 两种消费方式)
├── agentLoop.ts                       多迭代 agent runner (共享给 streamText 使用)
└── stream-manager/
    ├── AiStreamManager.ts             lifecycle 服务 (注册表 + pump + 多播)
    ├── buildCompactReplay.ts          attach 时的 chunk 压缩 (合并 text-delta / reasoning-delta)
    ├── types.ts                       interface + IPC payload + TopicSnapshot
    ├── index.ts                       barrel
    ├── context/                       按 topicId 命名空间分发的 Provider
    │   ├── ChatContextProvider.ts        Provider 接口 + PreparedDispatch
    │   ├── dispatch.ts                   唯一 manager.send 调用点
    │   ├── PersistentChatContextProvider.ts  裸 uuid → SQLite
    │   ├── TemporaryChatContextProvider.ts   内存 (TemporaryChatService)
    │   ├── AgentChatContextProvider.ts       `agent-session:` → agents DB
    │   └── modelResolution.ts            resolveModels / siblingsGroupId
    ├── listeners/
    │   ├── WebContentsListener.ts     chunks → Renderer 窗口
    │   ├── PersistenceListener.ts     observer 协议 + 委托给 PersistenceBackend
    │   ├── ChannelAdapterListener.ts  文本 → Discord / Slack / 飞书
    │   └── SSEListener.ts             UIMessageChunk → SSE response (API Server)
    └── persistence/
        ├── PersistenceBackend.ts      策略接口 (persistAssistant / persistError / afterPersist?)
        └── backends/
            ├── MessageServiceBackend.ts   finalize SQLite pending placeholder
            ├── TemporaryChatBackend.ts    append 到 in-memory topic
            └── AgentMessageBackend.ts     写入 session_messages 表
```

## StreamListener: 观察者接口

AiStreamManager 对所有消费者一视同仁，通过 `StreamListener` 的五个方法统一调度：

```typescript
interface StreamListener {
  readonly id: string
  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void
  onDone(result: StreamDoneResult): void | Promise<void>    // { finalMessage?, status: 'success', ... }
  onPaused(result: StreamPausedResult): void | Promise<void> // { finalMessage?, status: 'paused', ... }
  onError(result: StreamErrorResult): void | Promise<void>  // { finalMessage?, error, status: 'error', ... }
  isAlive(): boolean
}
```

All three terminal results share the same `finalMessage?` slot — it is the
accumulated `UIMessage` produced by the pump's `readUIMessageStream`,
regardless of whether the stream completed, paused, or errored. What
used to be called `partialMessage` in the error path is just a
`finalMessage` that happened to end early; keeping the shape uniform
means `PersistenceBackend` needs a single `persistAssistant` method
rather than a separate `persistError` that duplicates error-part
assembly across three backends.

### 内置实现

| Listener | 职责 | id | isAlive |
|---|---|---|---|
| **WebContentsListener** | chunks 分发到 Renderer | `wc:${wc.id}:${topicId}` | `!wc.isDestroyed()` |
| **PersistenceListener** | 流终结时写入存储（策略模式） | `persistence:${backendKind}:${topicId}:${modelId}` | 始终为 `true` |
| **ChannelAdapterListener** | 文本发到 IM 平台 | `channel:${channelId}:${chatId}` | `adapter.connected` |
| **SSEListener** | API Server SSE 透传 | `sse:${uuid}` | `!res.writableEnded` |

### Liveness 策略统一

`AiStreamManager.dispatchToListeners` 是所有 terminal 事件（`onDone` / `onPaused` / `onError`）的唯一广播入口：

- 广播前检查 `listener.isAlive()`，不活跃的listener 直接从 `stream.listeners` 中移除
- 单个 listener 抛错不会阻塞其他 listener（每个 invoke 独立 try/catch）
- 日志按 event 名标记 (`listenerId` + `event`)

`onChunk` 因为要保持同步语义（pump 不能 block on await）沿用 inline 循环，但 dead-listener reap policy 与 terminal 路径一致。

### PersistenceListener: 策略模式

一个 listener 实现 + 三个 backend：

```typescript
interface PersistenceBackend {
  readonly kind: string   // "sqlite" | "temp" | "agents-db"
  persistAssistant(input: {
    finalMessage?: CherryUIMessage
    status: 'success' | 'paused' | 'error'
    modelId?: UniqueModelId
  }): Promise<void>
  afterPersist?(finalMessage: CherryUIMessage): Promise<void>
}
```

Backend 只有**一个** write 方法，三种状态同构 —— listener 在 `onError` 里先把 `SerializedError` 合并成尾部 `data-error` part 挂到 `finalMessage.parts` 上，再调 `persistAssistant({ status: 'error' })`，所以 backend 从不需要知道如何合成带 error 的 UIMessage。

Listener 负责 observer 协议：按 `modelId` 过滤事件（多模型时每个 execution 对应一个 listener）、error part 合并（只写一次）、吃掉异常避免打断流程、`afterPersist` 仅在 success 且有 finalMessage 时触发（best-effort）。接入第四种存储（例如 outbox）只需实现一个 60 行左右的 backend，不用复制 listener 骨架。

## ActiveStream & StreamExecution

```typescript
interface ActiveStream {
  topicId: string
  executions: Map<UniqueModelId, StreamExecution>  // 单模型 1 条，多模型 N 条
  listeners: Map<string, StreamListener>           // 跨 execution 共享
  status: 'streaming' | 'done' | 'error' | 'aborted'  // 从 executions 派生
  isMultiModel: boolean   // 创建时固定；决定 onChunk 是否带 sourceModelId
  reapAt?: number
  reapTimer?: ReturnType<typeof setTimeout>
}

interface StreamExecution {
  modelId: UniqueModelId
  abortController: AbortController
  status: 'streaming' | 'done' | 'error' | 'aborted'

  // Per-execution steering queue — 与 v2 之前的共享队列不同。
  // 广播由 manager 在 steer 路径上 fan-out 到每个 execution 自己的 queue,
  // 解决多模型下一条 steer 只被一个 execution 消费的 data-loss 问题。
  pendingMessages: PendingMessageQueue

  // Per-execution ring buffer (for reconnect replay)。
  // 到达 maxBufferChunks 时丢弃 oldest + droppedChunks++,
  // 快模型无法再挤出慢模型的回放内容。
  buffer: StreamChunkPayload[]
  droppedChunks: number

  finalMessage?: CherryUIMessage
  error?: SerializedError
  siblingsGroupId?: number
  sourceSessionId?: string
}
```

Topic-level 状态从 executions 派生：
- 任一 execution 仍在 streaming → `'streaming'`
- 全部 done → `'done'`
- 全部 aborted → `'aborted'`
- 有 error 且无 streaming → `'error'`

## AiStreamManager 公开 API

```typescript
class AiStreamManager {
  // 生命周期配置 —— lifecycle 容器无参调用走 DEFAULT_CONFIG；
  // 测试或未来配置入口可传 Partial 覆盖。
  constructor(config?: Partial<AiStreamManagerConfig>)

  // ── 唯一 dispatch 入口 ───────────────────────────────────────
  // 行为由活跃流状态决定:
  //   streaming → steer (push userMessage 到每个 exec 的 queue + upsert listener)
  //   grace 期 → start (evict 后创建新 stream, 按 models fan-out execution)
  // `startExecution` 不再公开 —— send 是唯一入口。
  send(input: SendInput): SendResult

  // ── 订阅管理 ──────────────────────────────────────────────────
  attach(sender: WebContents, req: { topicId }): AiStreamAttachResponse
  detach(sender: WebContents, req: { topicId }): void
  addListener(topicId: string, listener: StreamListener): boolean
  removeListener(topicId: string, listenerId: string): void

  // ── 控制 ──────────────────────────────────────────────────────
  abort(topicId: string, reason: string): void
  steer(topicId: string, message: Message): boolean

  // ── 执行级事件 (pump 驱动, 测试可直接调用以模拟) ─────────────
  onChunk(topicId, modelId, chunk): void
  onExecutionDone(topicId, modelId): Promise<void>
  onExecutionPaused(topicId, modelId): Promise<void>
  onExecutionError(topicId, modelId, error): Promise<void>

  // ── 诊断 / 测试可见状态 (readonly snapshot) ──────────────────
  inspect(topicId: string): TopicSnapshot | undefined
}
```

### `send` 的行为契约

```typescript
interface SendInput {
  topicId: string
  models: ReadonlyArray<{ modelId: UniqueModelId; request: AiStreamRequest }>
  listeners: StreamListener[]
  userMessage?: Message       // steer 时 push 到每个 execution 的 queue
  siblingsGroupId?: number
}

interface SendResult {
  mode: 'started' | 'steered'
  executionIds: UniqueModelId[]  // started → 新启动的；steered → 已运行的
}
```

- **steered**：topic 已在 streaming → `models` 被忽略，`userMessage`（如提供）push 到每个 execution 的 pendingMessages，listeners upsert by id
- **started**：topic 空闲或已终结 → 创建新 ActiveStream，按 `models.length > 1` 推导 `isMultiModel`，逐个起 execution

`isMultiModel` 不再是入参字段，由 `models.length` 自动推导。

### pump: `runExecutionPump`

每个 execution 启动一个独立的 pump：

1. 调 `aiService.streamText(request, signal)` 拿 `ReadableStream<UIMessageChunk>`
2. `tee()` 成两路：一路 `onChunk` 广播 + 写入 per-execution ring buffer；另一路喂给 `readUIMessageStream` 聚合 `finalMessage`
3. signal abort 时 `reader.cancel(reason)`，两路 reader 都被唤醒 break
4. 正常完成 → `onExecutionDone`；signal aborted + exec 状态为 aborted → `onExecutionPaused`（partial 持久化为 paused）；其他错误 → `onExecutionError`（尽力救出 partial，传给 listeners.onError）

## 多模型问答

用户通过 @mentions 触发多个模型并行回复同一条消息：

```
用户: "解释量子力学" @gpt-4o @claude-sonnet
                        ↓
PersistentChatContextProvider.prepareDispatch
    ├─ 持久化 user message (tree 节点)
    ├─ resolveModels → [gpt-4o, claude-sonnet]
    ├─ siblingsGroupId = Date.now()
    ├─ 为每个 model 创建 pending assistant placeholder (SQLite)
    ├─ 构造 listeners: subscriber + 2 个 PersistenceListener (每个绑定一个 backend)
    ├─ 构造 models: 2 个 {modelId, request}
    └─ return PreparedDispatch

dispatchStreamRequest → manager.send({ models: [...], listeners, siblingsGroupId })
                           │
                           ├─ 创建 ActiveStream (isMultiModel = true, 2 个 executions)
                           ├─ 每个 execution 启动独立 pump + 自己的 pendingMessages + buffer
                           └─ return { mode: 'started', executionIds: [gpt-4o, claude-sonnet] }
```

Steering 场景下（用户在生成期间继续发消息）：
- `manager.send` 命中 steer 路径 → 同一条 userMessage 被 push 到**每个** execution 的 queue
- agentLoop 通过 `drain()` 拉自己的那份；Claude Code provider 通过 AsyncIterable 拉自己的那份
- 两种消费方式不再争抢同一个共享队列，消息不会丢失

## 完整数据流

### 发送消息（标准路径）

```
Renderer                           Main
────────                           ────
1. transport.sendMessages()
2. Ai_Stream_Open ────────────→  dispatchStreamRequest(subscriber, req)
                                    │
                                    └─ provider.prepareDispatch(subscriber, req)
                                         ├─ 持久化 user message
                                         ├─ 分配 assistant placeholder(s)
                                         ├─ 构造 listeners + models
                                         └─ return PreparedDispatch
                                    │
                                    └─ manager.send(prepared)
                                         ├─ 创建 ActiveStream + N 个 execution
                                         └─ 每个 execution 启动 runExecutionPump
                                              │
3. ←── Ai_StreamChunk ──── WebContentsListener ←── pump.onChunk 广播
4. ←── Ai_StreamChunk ──── ...
                                              │
                                         (流执行完成)
                                              │
5. ←── Ai_StreamDone ──── WebContentsListener ←── onExecutionDone 广播
                          PersistenceListener ←── onExecutionDone
                             └─ backend.persistAssistant(...)
                                              │
                                         scheduleReap(30s)
```

### Steering（用户在生成期间继续发送消息）

```
Renderer                           Main
────────                           ────
流正在执行...
1. Ai_Stream_Open ────────────→  provider.prepareDispatch → PreparedDispatch
                                    │
                                    └─ manager.send (已有 streaming)
                                         ├─ 对每个 execution: exec.pendingMessages.push(userMessage)
                                         ├─ listeners upsert (by id)
                                         └─ return { mode: 'steered', executionIds }
                                    │
                                    每个 execution 的 agentLoop / Claude Code 从自己的
                                    queue 中消费这条消息，iteration 之间 append 到 history
```

### Reconnect（返回之前的对话）

```
Renderer                           Main
────────                           ────
用户返回该对话 → useChat mount → transport.reconnectToStream()
Ai_Stream_Attach ──────────→  manager.attach(sender, { topicId })
                                 ├─ streaming → 注册 WebContentsListener;
                                 │   对每个 execution 合并 compactReplay 其 buffer
                                 │   (总丢弃数记录到 log)
                                 ├─ done    → 返回 finalMessage
                                 └─ error   → 返回 error
```

### Abort & backgroundMode

```
用户点击停止:
  Ai_Stream_Abort ──→ manager.abort(topicId, 'user-requested')
                       ├─ 关闭每个 execution 的 pendingMessages (唤醒 AsyncIterator)
                       ├─ abortController.abort(reason)
                       │   → pump 的 reader.cancel 两路
                       │   → onExecutionPaused 广播 (partial 持久化为 paused)
                       └─ stream.status = 'aborted'

listeners 全部断开 + config.backgroundMode === 'abort':
  onChunk 里清理 dead listener 之后发现 size === 0
  → 自动 abort(topicId, 'no-subscribers')
  (确保 partial 走 paused 路径而不是被误标为 success 或泄漏占资源)
```

### 多窗口观察

```
窗口 A                              窗口 B
──────                              ──────
Ai_Stream_Open                      (稍后)
  → WebContentsListener(A) +        打开同一 topic
    PersistenceListener             Ai_Stream_Attach
                                     → attach 返回 compact replay
                                     → 注册 WebContentsListener(B)

chunk 到达:
  WebContentsListener(A) → A 渲染
  WebContentsListener(B) → B 渲染   (同一 chunk, 双窗口同步)
```

### Channel / Agent 集成

Channel 和 Agent scheduler 在 Main 内部直接调 `AiStreamManager.send`（不走 IPC）：

```typescript
aiStreamManager.send({
  topicId,
  models: [{ modelId: uniqueModelId, request: {...} }],
  listeners: [new ChannelAdapterListener(adapter, chatId), sentinelListener]
})
```

不同场景差异完全由 listeners 组合表达：

| 场景 | Listeners | 效果 |
|---|---|---|
| Renderer 用户发送 | WebContentsListener + PersistenceListener | 实时显示 + 持久化 |
| Channel bot 回复 | ChannelAdapterListener + PersistenceListener (AgentMessageBackend) | IM 发送 + 写 agents DB |
| Channel + 用户同时观察 | 以上 + WebContentsListener(B) | 全部并行 |
| API Server SSE | SSEListener + PersistenceListener | SSE 推送 + 持久化 |

## IPC 契约

### Request channels (Renderer → Main)

| Channel | Payload | 返回值 | 语义 |
|---|---|---|---|
| `Ai_Stream_Open` | `{ topicId, parentAnchorId, userMessageParts, mentionedModelIds? }` | `{ mode, executionIds? }` | 发送消息；Provider 根据 topicId 路由 |
| `Ai_Stream_Attach` | `{ topicId }` | `AiStreamAttachResponse` | 订阅流状态；streaming 时返回 compact replay |
| `Ai_Stream_Detach` | `{ topicId }` | void | 取消订阅（流继续执行） |
| `Ai_Stream_Abort` | `{ topicId }` | void | 终止当前生成 |

### Push channels (Main → Renderer)

| Channel | Payload | 说明 |
|---|---|---|
| `Ai_StreamStarted` | `{ topicId }` | 广播给所有窗口；sidebar loading 状态同步 |
| `Ai_StreamChunk` | `{ topicId, executionId?, chunk }` | 多模型时带 `executionId`，单模型 undefined |
| `Ai_StreamDone` | `{ topicId, executionId?, status, isTopicDone }` | `status ∈ { 'success', 'paused' }` 区分正常完成 / 用户 abort |
| `Ai_StreamError` | `{ topicId, executionId?, isTopicDone, error }` | SerializedError |

**所有通信均以 topicId 为唯一 key**；多模型场景下 `executionId` 区分 chunks 来源。

## ChatContextProvider: 按 topicId 命名空间分发

`Ai_Stream_Open` 请求进入 Main 后由 `dispatchStreamRequest`（`context/dispatch.ts`）处理：

```
dispatchStreamRequest(manager, subscriber, req)
  → provider = providers.find(p => p.canHandle(req.topicId))
  → prepared = await provider.prepareDispatch(subscriber, req)
  → result = manager.send(prepared)  // ← 唯一 manager.send 调用点
  → return { mode: result.mode, executionIds: prepared.isMultiModel ? result.executionIds : undefined }
```

Provider 只负责"准备"，不再调 manager。这带来两个好处：

- Provider 单测不需要 mock manager —— 只断言 `PreparedDispatch` 结构
- `manager.send` 的 steer / start / multi-model 路由只在 dispatcher 里存在一处

### Provider 接口

```typescript
interface ChatContextProvider {
  readonly name: string
  canHandle(topicId: string): boolean
  prepareDispatch(subscriber: StreamListener, req: AiStreamOpenRequest): Promise<PreparedDispatch>
}

interface PreparedDispatch {
  topicId: string
  models: ReadonlyArray<{ modelId: UniqueModelId; request: AiStreamRequest }>
  listeners: StreamListener[]   // subscriber + per-execution PersistenceListener(s)
  userMessage?: Message
  siblingsGroupId?: number
  isMultiModel: boolean
}
```

### 内置 Provider

| Provider | canHandle | 数据层 | User 消息 | Assistant 消息 |
|---|---|---|---|---|
| **AgentChatContextProvider** | `topicId.startsWith('agent-session:')` | `agentMessageRepository` | 预先写入 | `PersistenceListener(AgentMessageBackend)` onDone 写入 |
| **TemporaryChatContextProvider** | `temporaryChatService.hasTopic(topicId)` | `TemporaryChatService` 内存 | append 一条 | `PersistenceListener(TemporaryChatBackend)` onDone append |
| **PersistentChatContextProvider** | `true` (默认兜底) | `messageService` + SQLite | 事务 create | `PersistenceListener(MessageServiceBackend)` onDone update pending |

路由顺序：Agent → Temporary → Persistent（匹配第一个 `canHandle === true` 的 provider）。

### 持久化路径对比

| | Persistent | Temporary | Agent |
|---|---|---|---|
| user message 时机 | 流开始前（tree 节点） | 流开始前（append） | 流开始前（agents DB） |
| assistant placeholder | 流开始前 pending | 不创建 | 不创建 |
| 终结时操作 | `update` placeholder | `append` 新条目 | `persistAssistantMessage` |
| Backend | `MessageServiceBackend` | `TemporaryChatBackend` | `AgentMessageBackend` |
| Multi-model 支持 | ✓ | ✗（单模型） | ✗（单模型） |
| Regenerate 支持 | ✓ | ✗ | ✗ |

### 跨 topic 类型复用 PersistenceListener

Persistent / Temporary / Agent 三种存储路径**共享同一个 `PersistenceListener` 类**，只通过注入不同的 `PersistenceBackend` 改变落盘行为。observer 协议（按 `modelId` 过滤、error 合成、`skip-when-no-finalMessage`、swallow errors）只写一次。

## AiService 集成

`AiService` 是 lifecycle 服务：

- **Streaming**：`streamText(request, signal)` → `ReadableStream<UIMessageChunk>`，被 `AiStreamManager.runExecutionPump` 消费
- **非流式 IPC gateway**：`generateText` / `checkModel` / `embedMany` / `generateImage` / `listModels` / `abortImage`，在 `onInit` 里注册为 IPC handler

`AiStreamManager` 通过 `application.get('AiService').streamText(...)` 调用，不再经过 `InternalStreamTarget` 的 channel-switch。

## Grace Period & Reconnect

流结束后 `ActiveStream` 在内存保留 30 秒（`config.gracePeriodMs`）。期间用户返回对话可通过 `attach` 直接拿到 `finalMessage`，无需查数据库。过期后 `ActiveStream` 被清除，后续 `attach` 返回 `not-found`，Renderer 通过 `useQuery` 从数据库读（PersistenceListener 已完成持久化）。

停止后立即重试时，`send` 的 start 分支在 `evictStream` 后创建新流，让出 grace-period 内的旧流位置。

## 边界情况速查

| 情况 | 处理策略 |
|---|---|
| 流执行期间用户再次发送 | `send` 路由到 steer；userMessage fan-out 到每个 execution 的 queue |
| 流结束后立即重试 | `send` 驱逐 grace-period 内的旧流，创建新流 |
| 窗口关闭但流未结束 | `WebContentsListener.isAlive()` 返回 false → 被 dispatch 自动 reap；PersistenceListener 不受影响 |
| 所有窗口关闭 + `backgroundMode='continue'` | 流继续执行，完成后持久化 |
| 所有窗口关闭 + `backgroundMode='abort'` | `onChunk` 里 dead listener reap 后 size === 0 → `abort(topic, 'no-subscribers')`；partial 经 paused 持久化 |
| 多窗口查看同一 topic | 各窗口独立 `WebContentsListener`，同时接收 chunks |
| 同一窗口重复 Attach | listener id 稳定，addListener 走 upsert |
| 中途订阅 | `attach` 返回每个 execution 的 compact replay（按 execution 独立压缩） |
| Buffer 溢出 | ring 丢弃 oldest + `droppedChunks++`；attach 在 log 中 warn 总丢弃数 |
| 多模型 steer | 一条消息 fan-out 到每个 execution 的 queue（零数据丢失） |
| Main 进程重启 | `activeStreams` 清空；Renderer 通过数据库读取 |

## 设计备注

### `afterPersist` best-effort 边界

`PersistenceBackend.afterPersist?` 是可选钩子（典型使用：`topicNamingService.maybeRenameFromConversationSummary`）。失败被 swallow 并 warn，不会重试。仅允许 UI 增强类副作用（自动重命名、标题生成）。若将来存在"必须保证执行"的副作用（计费、审计），需要引入 outbox + worker 机制。

### 为什么 `inspect()` 返回 readonly snapshot

内部状态（`activeStreams` / `executions` / `pendingMessages`）没有 public getter。暴露 `inspect(topicId): TopicSnapshot | undefined` 是一次性拷贝，调用方不能反过来 mutate manager 状态。这个设计让诊断 UI、测试、未来的 health check 都通过同一个稳定 contract 查询，不用 `as any` 绕过 private。

### 测试策略

- **Manager 单测**：`createManager({ maxBufferChunks: 3 })` 通过 constructor 注入测试 config；状态断言统一走 `mgr.inspect(topicId)`；listener upsert / abort / backgroundMode 走行为观察（触发 chunk 看谁收到）
- **Provider 单测**：直接断言 `prepareDispatch` 返回值；不 mock manager
- **PersistenceListener 单测**：用 `TemporaryChatBackend` 做测试载体，observer 协议一套覆盖所有 backend
- 所有内部状态访问点都有 public inspection API；生产代码和测试共享同一份 contract
