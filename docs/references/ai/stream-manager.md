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

  // Transport-side timings owned by the pump — chunk-shape-agnostic.
  // Semantic timings (firstTextAt / reasoning*) live on the listener
  // that cares; see "Stats composition" below.
  timings: TransportTimings
}

interface TransportTimings {
  readonly startedAt: number  // pump entry
  completedAt?: number        // pump loop exit (try / catch 兜底)
}

interface SemanticTimings {
  firstTextAt?: number          // first text-delta chunk (TTFT endpoint)
  reasoningStartedAt?: number   // first reasoning-* chunk
  reasoningEndedAt?: number     // first non-reasoning chunk after reasoning
}
```

Topic-level 状态从 executions 派生：
- 任一 execution 仍在 streaming → `'streaming'`
- 全部 done → `'done'`
- 全部 aborted → `'aborted'`
- 有 error 且无 streaming → `'error'`

### Stats composition — tokens + timings → MessageStats

**Ownership 分层**（关键不变式：manager 不 peek chunk payload）：

| 字段来源 | 拥有者 | 采集点 |
|---|---|---|
| `TransportTimings.startedAt` | `AiStreamManager` | `createAndLaunchExecution` 构造 execution 时 |
| `TransportTimings.completedAt` | `AiStreamManager` | pump try 块主循环退出 / catch 块 `??=` 兜底 |
| `SemanticTimings.firstTextAt` | `PersistenceListener` | 自己 `onChunk` 里看见第一个 `text-delta` |
| `SemanticTimings.reasoningStartedAt/EndedAt` | `PersistenceListener` | 自己 `onChunk` 里观察 `reasoning-*` 边界 |
| Token metadata | `agentLoop.messageMetadata` | `finish` chunk 上把 AI SDK `LanguageModelUsage` 投影到 `CherryUIMessageMetadata` |

AiStreamManager 对 chunk 形状保持 agnostic —— 只做 multicast / reconnect / abort / steering / persist 触发，不判断 "什么是文本 / 推理"。这样 AI SDK chunk 类型变化（vNext 改名等）只影响 `PersistenceListener`，manager 稳定。

**最终合成**：`statsFromTerminal(finalMessage, mergedTimings)` 一处 projection，listener 把自己维护的 `SemanticTimings` 与 `result.timings`（transport）合并后调用：

```typescript
// PersistenceListener 内部
const mergedTimings = { ...result.timings, ...this.semanticTimings }
const stats = statsFromTerminal(finalMessage, mergedTimings)
await this.opts.backend.persistAssistant({ finalMessage, status, modelId, stats })
```

投影的 `MessageStats` 字段：

| 字段 | 来源 |
|---|---|
| `totalTokens / promptTokens / completionTokens / thoughtsTokens` | `finalMessage.metadata.*` |
| `timeFirstTokenMs` | `round(firstTextAt - startedAt)` |
| `timeCompletionMs` | `round(completedAt - startedAt)` |
| `timeThinkingMs` | **不投影** —— wall-clock `reasoningEndedAt - reasoningStartedAt` 可能包含中间 tool 执行时间，精确拆分见 `stream-stats-followup` TODO |

Backend 不自己派生 stats，只写 `input.stats` —— 三个 backend 共享同一条 projection 路径，避免重复。

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

**Topic status 不需要 attach**：只关心"这个 topic 现在在不在跑"的观察者（sidebar loading dot、Topics 列表等）不必注册 `WebContentsListener`。`Ai_TopicStatusChanged` 是广播到**所有**窗口的，`Ai_Topic_GetStatuses` 又能提供 zero-side-effect 的初始快照；观察者只需监听这两个通道即可保持同步。`Ai_Stream_Attach` 只在需要实时 chunk（例如 Renderer 渲染正在生成的消息）时才用。

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
| `Ai_Topic_GetStatuses` | — | `Record<topicId, TopicStreamStatus>` | 一次性快照，用于窗口 mount 时初始化 status 视图；零副作用（不注册 listener、不分配 replay） |

### Push channels (Main → Renderer)

| Channel | Payload | 说明 |
|---|---|---|
| `Ai_StreamStarted` | `{ topicId }` | 广播给所有窗口；保留以兼容旧消费方，新代码用 `Ai_TopicStatusChanged: pending` |
| `Ai_StreamChunk` | `{ topicId, executionId?, chunk }` | 多模型时带 `executionId`，单模型 undefined；**仅发给 attach 过的窗口** |
| `Ai_StreamDone` | `{ topicId, executionId?, status, isTopicDone }` | `status ∈ { 'success', 'paused' }` 区分正常完成 / 用户 abort；**仅发给 attach 过的窗口** |
| `Ai_StreamError` | `{ topicId, executionId?, isTopicDone, error }` | SerializedError；**仅发给 attach 过的窗口** |
| `Ai_TopicStatusChanged` | `{ topicId, status }` | 广播给所有窗口，`status ∈ { 'pending', 'streaming', 'done', 'aborted', 'error', 'idle' }`；观察者不需要 attach 即可跟踪 topic 状态 |

**所有通信均以 topicId 为唯一 key**；多模型场景下 `executionId` 区分 chunks 来源。

**Topic status vs message status**：两种状态不要混淆。
- **Topic stream status**（`Ai_TopicStatusChanged` / `Ai_Topic_GetStatuses` 暴露）：每个 topic 一个，`AiStreamManager.ActiveStream.status` 为 source of truth，只在 ActiveStream 存活期（+ grace period）内有值。`pending` 表示"已创建流但还没收到第一个 chunk"，`streaming` 表示"至少一个 chunk 到了，内容正在产生"。
- **Assistant message status**（`AssistantMessageStatus`：`PENDING` / `PROCESSING` / `SUCCESS` / `ERROR`）：每条 assistant 消息一个，SQLite 持久化，由 `PersistenceListener.onDone/onError` 写入。多模型下一个 topic 状态转一次，但 N 条消息各自转一次。

Cache schema 的路径前缀也把两者分开：`topic.stream.status.${topicId}` 明确表示"这是关于 ActiveStream 的"，不会与 message 行的状态字段搞混。

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

- **Streaming**：`streamText(request, signal)` → `Promise<ReadableStream<UIMessageChunk>>`，被 `AiStreamManager.runExecutionPump` 消费
- **非流式 IPC gateway**：`generateText` / `checkModel` / `embedMany` / `generateImage` / `listModels` / `abortImage`，在 `onInit` 里注册为 IPC handler

`AiStreamManager` 通过 `await application.get('AiService').streamText(...)` 调用。pre-stream 错误（provider/model 解析、agent 参数构建）从 Promise reject 抛出；mid-stream 错误从返回的 stream 自身 error 传播 —— 两条错误路径不会混在一起。

### Per-call extensions（AiService 层，stream-manager 不参与）

`AiService.streamText` 和 `generateText` 各自接受一个可选的第三参数，用于**per-call tuning** —— 某一次调用想改的 hooks / options / plugins / tools：

```typescript
// AiService.ts
async streamText(
  request: AiStreamRequest,
  signal: AbortSignal,
  extensions?: AiStreamExtensions
): Promise<ReadableStream<UIMessageChunk>>

export interface AiStreamExtensions {
  hooks?: AgentLoopHooks
  optionsOverride?: Partial<AgentOptions>
  extraPlugins?: AiPlugin[]
  extraTools?: ToolSet
}
```

**设计原则 — 三条路径互不干涉**：

| 路径 | 用途 | 走哪里 |
|---|---|---|
| **per-call tuning** | 某次调用真的需要不同的 toolChoice / providerOptions / debug hook | `AiService.streamText(req, signal, ext)` 第三参数 |
| **cross-cutting behavior**（未来） | 全局 trace、自动重命名、用量统计 | 独立的 Plugin Registry 层（尚未实现）—— AiService 从 registry 拉 hook，不走第三参数 |
| **topic dispatch** | 发消息到 topic、多播、persistence、reconnect | `AiStreamManager.send({...})` —— stream-manager **完全不感知 SDK 类型** |

**关键分层**：`SendModelSpec` **不含** extensions 字段，stream-manager 的 pump 里调 `aiService.streamText(req, signal)` 也不传第三参数。理由：
- Provider / Scheduler / Channel 这些 stream-manager 的调用方只负责构造请求数据，对 AI 调用行为无意见
- 谁要 per-call tuning（例如某个 standalone API endpoint），**直接调 `AiService.streamText(req, signal, ext)`**，绕过 stream-manager（它们本来就不需要 multicast / persistence / attach）
- stream-manager 的 transport schema 里因此没有任何 SDK 特定类型，AI SDK 升级（`AgentLoopHooks` 加新字段）不会波及 dispatch 代码

**扩展点详细**：

| 字段 | 类型 | 语义 |
|---|---|---|
| `hooks` | `AgentLoopHooks` | agentLoop 的 iteration 钩子。仅 `AiStreamExtensions` 有（generateText 无 iteration 模型） |
| `optionsOverride` | `Partial<AgentOptions>` | AI SDK agent settings 覆盖层，shallow-merge 在 assistant 默认之上 |
| `extraPlugins` | `AiPlugin[]` | 追加到内建 plugin 之后。顺序敏感 —— caller plugins 在 Cherry 的 reasoning / simulate-streaming 等之后跑 |
| `extraTools` | `ToolSet` | 合并到解析后的 ToolSet。Cherry 的 MCP / assistant 工具在名字冲突时获胜（caller 只填补空位） |

`onFinish` 的 compose 行为：**内建 token tracker 永远先跑**，caller 的 `onFinish` 之后跑，caller 抛错被日志吞掉，不影响内建 analytics。其他有返回值的 hook（`prepareStep` / `onError` / `beforeIteration` / `afterIteration`）由 caller 接管 —— AiService 目前在这些 hook 上没有内建行为需要保留。

这套 surface 直接转发 agentLoop 的契约，不做 Cherry 自定义 wrapper。当 AI SDK 升级 `AgentLoopHooks` / `AgentOptions` 时消费方需要跟着升级 —— 采用更保守的 wrapper 会以降低表达力为代价，目前未采用。未来引入完整 Plugin Registry 时，它是独立新层，与本节的 per-call extensions 并行共存，互不干扰。

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
