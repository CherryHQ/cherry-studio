# AiStreamManager 架构

## 概述

AiStreamManager 是 Main 进程的**活跃流注册表（active stream registry）**，同时充当所有 stream 事件的 broker。它负责 AI 流式回复的完整生命周期 —— 从用户触发发送到 assistant 消息完成持久化写入，期间的多播分发、reconnect、abort、mid-stream 消息注入、持久化触发都由它统一编排。

Renderer 不再直接持有流的引用。窗口关闭不等于流终止——流在 Main 继续执行并完成持久化。用户回到该对话时，AiStreamManager 提供 reconnect 能力。

**唯一标识：`topicId`**。一个 topic 同时至多有一条活跃流；streaming 是 topic 的一种瞬时运行状态，所有订阅方地位对等，不区分"发起者"与"观察者"。

## 解决什么问题

v1 的流是 single-use pipeline：Renderer 发起 IPC → AiService 直接耦合于 `event.sender`（WebContents）→ 逐个 chunk 通过 `wc.send` 推送 → 流结束后管道释放。这条管线存在三个结构性缺陷：

### 1. 流的生命周期耦合于窗口

AI SDK 的 `useChat` hook 内部用 `useRef` 持有 `Chat` 实例，Chat 实例又持有 Transport 的 `ReadableStream` 引用。一旦 React 组件 unmount，这条引用链会被逐级释放：

1. Chat 实例随 ref 被 GC 回收
2. Transport 的 `ReadableStream` 失去消费者，触发其 `cancel()`
3. Main 端此前建立的 stream 监听到 reader 取消，通过 `AbortSignal` 中止上游 AI 请求
4. 未完成的流被丢弃，部分生成的内容不会持久化

**可观察行为**：切换 topic、关闭窗口或路由跳转时，正在生成的回复被静默丢弃。

### 2. 不支持 reconnect

Renderer 侧的 `IpcChatTransport.reconnectToStream()` 总是返回 `null`。AI SDK 的 `useChat` 在组件 mount 时会调用此方法检查是否有"进行中的流"可以恢复；收到 `null` 等价于"此 topic 没有活跃流"。

**可观察行为**：切换到其它 topic 后返回，即便 Main 端实际上仍在生成，Renderer 也看不到；只能等流完成后从数据库读出。

### 3. 持久化在 Renderer 侧执行

消息写入数据库的路径由 Renderer 的 `ChatSessionManager.handleFinish`（实现长度约 440 行）承担。整条 persistence 路径的存活取决于窗口：若 Renderer 在写库前崩溃、窗口关闭或页面刷新，数据就彻底丢失。

**核心设计目标**：将流的生命周期管理、多播分发与持久化统一迁移到 Main 进程，Renderer 仅承担 chunk 渲染职责。

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
│         ↓ createAndLaunchExecution → runExecutionLoop    │
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

## 发布-订阅模型

AiStreamManager 是事件 broker：一端接入若干 producer，一端向若干 consumer 分发事件。整套系统采用 observer pattern 组织订阅，并按**事件的数据量级与受众规模**把分发拆成两条语义不同的通道。

### Producers


| Producer               | 产出事件                        | 触发源                                                                                                |
| ---------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `StreamExecution` 执行循环 | `UIMessageChunk`（chunk 级增量） | `AiService.streamText` 返回的 `ReadableStream`                                                        |
| `AiStreamManager`（状态机） | topic 生命周期状态迁移              | `send()`（`pending`）、`onChunk()` 首 chunk（`streaming`）、三个 terminal handler（`done`/`error`/`aborted`） |


### Consumers


| Consumer                                    | 关心的事件            | 接入方式                                       |
| ------------------------------------------- | ---------------- | ------------------------------------------ |
| `WebContentsListener`                       | chunk + terminal | `attach` 显式注册到 `ActiveStream.listeners`    |
| `PersistenceListener`                       | terminal         | `send()` 时由 provider 构造并一次性注册              |
| `ChannelAdapterListener` / `SSEListener`    | chunk + terminal | 调用方在构造 `send` 输入时注入                        |
| Renderer cache mirror（`aiStreamTopicCache`） | topic 状态迁移       | 订阅广播（无需 `attach`）                          |
| UI 间接消费者（sidebar indicator、backup gate 等）   | topic 状态         | 经 cache 读 `topic.stream.status.${topicId}` |


### 两条通道：targeted vs broadcast


|           | Targeted（定向分发）                                            | Broadcast（广播）                              |
| --------- | --------------------------------------------------------- | ------------------------------------------ |
| 通道        | `Ai_StreamChunk` / `Ai_StreamDone` / `Ai_StreamError`     | `Ai_TopicStatusChanged`                    |
| Main 侧注册表 | `ActiveStream.listeners: Map<listenerId, StreamListener>` | 无——`WindowService.getAllWindows()` fan-out |
| 订阅语义      | 显式 `attach` / `detach`                                    | webContents 存在即接收                          |
| 单事件数据量    | 数十字节至 KB 级（每秒数十条 chunk）                                   | 数十字节（一个流完整生命周期最多 5 次状态迁移）                  |
| 目标消费者规模   | 窄（通常 1 个窗口对应 1 个 listener）                                | 宽（所有窗口的 sidebar 等都关心）      |
| 无用推送代价    | 高（带宽 + 反序列化）                                              | 可忽略                                        |


### 通道选择的依据

按 **consumer / producer 比例**决定：

- chunk 流：一个 execution 产出，只服务正在渲染该 topic 的那一个窗口 → **targeted**，避免给无关窗口推数据
- topic 状态：一次迁移，所有 UI mirror 都要同步 → **broadcast**，维护订阅表的开销大于省下的推送成本

### 从通道分层派生的规则

后面章节的多个设计点都是此分层的自然推论：

- `**Ai_Stream_Attach` 的必要性**：targeted 通道要求 consumer 显式声明；`attach` 是注册入口，同时返回 `compact replay` 填补"注册前已产生"的 chunk
- `**Ai_Topic_GetStatuses` 的必要性**：broadcast 通道没有"订阅历史"概念，新挂载的消费者无法回放过往 delta；一次性快照是必要的 bootstrap 手段
- **snapshot 与 delta 之间的竞态**：broadcast 通道下 pull 与 push 到达顺序不可保证，`aiStreamTopicCache` 使用"delta 永远覆盖 snapshot"作为隐式全序（依赖 IPC 通道内 FIFO）
- **grace-period cleanup 是否广播**：broadcast 通道只承载"状态迁移通知"，grace-period cleanup 是 broker 内部的资源回收而非状态迁移；`getStatuses` 已经自动排除过期 topic，所以 cleanup 无需广播
- **PersistenceListener 的装配位置**：terminal-only 消费者，不需要 chunk 带宽 → 不用 `attach`；在 `send` 时随 provider 一次性注册即可

## 文件结构

```
src/main/ai/
├── AiService.ts                       lifecycle 服务: streamText + 非流式 IPC gateway
│                                       (消化了原 AiCompletionService 的全部业务逻辑)
├── PendingMessageQueue.ts             injected 消息队列 (drain + AsyncIterable 两种消费方式)
├── agentLoop.ts                       多迭代 agent runner (共享给 streamText 使用)
└── stream-manager/
    ├── AiStreamManager.ts             lifecycle 服务 (注册表 + 执行循环 + 多播)
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

AiStreamManager 对所有消费者采用统一接口，每个消费者实现下面五个方法，由 Manager 在对应事件点统一调度：

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

三种 terminal 结果共用同一个 `finalMessage?` 字段 —— 它就是执行循环中 `readUIMessageStream` 聚合出的 `UIMessage`，不论流是正常完成、用户 abort 还是出错都是同一个变量，只是"停止的时间点"不同。早期设计把错误路径下的部分内容单独叫 `partialMessage`，这实质上只是一个"提前结束的 `finalMessage`"；统一字段形态之后，`PersistenceBackend` 只需要一个 `persistAssistant` 方法，不必为 error 路径再写一份重复的持久化逻辑。

### 内置实现


| Listener                   | 职责                  | id                                                 | isAlive              |
| -------------------------- | ------------------- | -------------------------------------------------- | -------------------- |
| **WebContentsListener**    | chunks 分发到 Renderer | `wc:${wc.id}:${topicId}`                           | `!wc.isDestroyed()`  |
| **PersistenceListener**    | 流终结时写入存储（策略模式）      | `persistence:${backendKind}:${topicId}:${modelId}` | 始终为 `true`           |
| **ChannelAdapterListener** | 文本发到 IM 平台          | `channel:${channelId}:${chatId}`                   | `adapter.connected`  |
| **SSEListener**            | API Server SSE 透传   | `sse:${uuid}`                                      | `!res.writableEnded` |


### Liveness 策略统一

`AiStreamManager.dispatchToListeners` 是所有 terminal 事件（`onDone` / `onPaused` / `onError`）的唯一广播入口，对每个 listener 执行以下处理：

- 广播前调用 `listener.isAlive()`，返回 `false` 的 listener 从 `stream.listeners` 中移除（清理死 listener）
- 每个 listener 的调用独立包在 try/catch 中，单个 listener 抛错不会阻塞其他 listener 的分发
- 日志按 event 名打标记（`listenerId` + `event`）便于排查

`onChunk` 因为要保持同步语义（执行循环不能为单个 listener await 而阻塞整条 chunk 流）沿用内联循环派发，没有走 `dispatchToListeners`；但清理死 listener 的策略与 terminal 路径完全一致。

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

Backend 只暴露**一个** write 方法，三种状态同构 —— `PersistenceListener` 在 `onError` 分支里先把 `SerializedError` 合成为一个 `data-error` part 追加到 `finalMessage.parts` 末尾，再调用 `persistAssistant({ status: 'error' })`；backend 因此不需要知道如何把错误信息拼进 UIMessage，它只负责写。

Listener 负责 observer 协议：按 `modelId` 过滤事件（多模型时每个 execution 对应一个 listener）、error part 合并（exactly-once）、swallow 异常以避免中断下游分发、`afterPersist` 仅在 `status === 'success'` 且 `finalMessage` 非空时触发（best-effort）。接入第四种存储（例如 outbox）只需实现一个 60 行左右的 backend，不用复制 listener 骨架。

## ActiveStream & StreamExecution

```typescript
interface ActiveStream {
  topicId: string
  executions: Map<UniqueModelId, StreamExecution>  // 单模型 1 条，多模型 N 条
  listeners: Map<string, StreamListener>           // 跨 execution 共享
  // 初始 'pending'；收到首 chunk 翻转到 'streaming'；全部 execution 到
  // terminal 时由 executions 派生出 'done' / 'error' / 'aborted'。
  status: TopicStreamStatus
  isMultiModel: boolean   // 创建时固定；决定 onChunk 是否带 sourceModelId
  expiresAt?: number
  cleanupTimer?: ReturnType<typeof setTimeout>
}

interface StreamExecution {
  modelId: UniqueModelId
  abortController: AbortController
  status: 'streaming' | 'done' | 'error' | 'aborted'

  // Per-execution queue of injected follow-up messages。每个 execution
  // 有自己的队列，Manager 的 injectMessage 路径把 userMessage fan-out
  // 到每个 execution 队列各一份。早期版本所有 execution 共用一个队列
  // —— 一条注入消息只会被先调用 next() 的 execution 消费走，其它
  // execution 丢失，多模型下会看到部分模型响应滞后。拆分后不再有这个问题。
  pendingMessages: PendingMessageQueue

  // Per-execution ring buffer，供 reconnect 回放使用。容量达到
  // maxBufferChunks 时丢弃最旧一条并把 droppedChunks +1。
  // 独立 buffer 保证快模型的高频 chunk 不会挤占慢模型的缓冲名额
  // —— 若共用单一 buffer，慢模型尚未送达的 chunk 会被快模型填满后挤出。
  buffer: StreamChunkPayload[]
  droppedChunks: number

  finalMessage?: CherryUIMessage
  error?: SerializedError
  siblingsGroupId?: number
  sourceSessionId?: string

  // Transport-side timings owned by the execution loop — chunk-shape-agnostic.
  // Semantic timings (firstTextAt / reasoning*) live on the listener
  // that cares; see "Stats composition" below.
  timings: TransportTimings
}

interface TransportTimings {
  readonly startedAt: number  // 执行循环进入时
  completedAt?: number        // 执行循环退出时（try / catch 两条路径都统一赋值）
}

interface SemanticTimings {
  firstTextAt?: number          // first text-delta chunk (TTFT endpoint)
  reasoningStartedAt?: number   // first reasoning-* chunk
  reasoningEndedAt?: number     // first non-reasoning chunk after reasoning
}
```

Topic-level 状态从 executions 派生，初始为 `'pending'`（流已创建但尚未有任何 execution 吐出 chunk）：

- 初始（`send()` 刚返回）→ `'pending'`
- 任一 execution 产出第一个 chunk → `'streaming'`
- 全部 execution 到达 terminal 且全为 `done` → `'done'`
- 全部 execution 到达 terminal 且全为 `aborted` → `'aborted'`
- 存在 `error`、不存在 `streaming` → `'error'`

一个多模型流从 `pending` 到 `streaming` 只会翻转一次（第一个 chunk 到达那一刻）；到达 terminal 时一次性派生出对应的 `done` / `aborted` / `error`。

### Stats composition — tokens + timings → MessageStats

**Ownership 分层**（关键不变式：manager 不 peek chunk payload）：


| 字段来源                                         | 拥有者                         | 采集点                                                                         |
| -------------------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `TransportTimings.startedAt`                 | `AiStreamManager`           | `createAndLaunchExecution` 构造 execution 时                                   |
| `TransportTimings.completedAt`               | `AiStreamManager`           | 执行循环 try 块主循环退出；catch 块用 `??=` 做 fallback 赋值                                |
| `SemanticTimings.firstTextAt`                | `PersistenceListener`       | 自己 `onChunk` 里看见第一个 `text-delta`                                            |
| `SemanticTimings.reasoningStartedAt/EndedAt` | `PersistenceListener`       | 自己 `onChunk` 里观察 `reasoning-`* 边界                                           |
| Token metadata                               | `agentLoop.messageMetadata` | `finish` chunk 上把 AI SDK `LanguageModelUsage` 投影到 `CherryUIMessageMetadata` |


AiStreamManager 对 chunk 形状保持 agnostic —— 只做 multicast / reconnect / abort / message-injection / persist 触发，不判断 "什么是文本 / 推理"。这样 AI SDK chunk 类型变化（vNext 改名等）只影响 `PersistenceListener`，manager 稳定。

**最终合成**：`statsFromTerminal(finalMessage, mergedTimings)` 一处 projection，listener 把自己维护的 `SemanticTimings` 与 `result.timings`（transport）合并后调用：

```typescript
// PersistenceListener 内部
const mergedTimings = { ...result.timings, ...this.semanticTimings }
const stats = statsFromTerminal(finalMessage, mergedTimings)
await this.opts.backend.persistAssistant({ finalMessage, status, modelId, stats })
```

投影的 `MessageStats` 字段：


| 字段                                                               | 来源                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `totalTokens / promptTokens / completionTokens / thoughtsTokens` | `finalMessage.metadata.*`                                                                                         |
| `timeFirstTokenMs`                                               | `round(firstTextAt - startedAt)`                                                                                  |
| `timeCompletionMs`                                               | `round(completedAt - startedAt)`                                                                                  |
| `timeThinkingMs`                                                 | **不投影** —— wall-clock `reasoningEndedAt - reasoningStartedAt` 可能包含中间 tool 执行时间，精确拆分见 `stream-stats-followup` TODO |


Backend 不自己派生 stats，只写 `input.stats` —— 三个 backend 共享同一条 projection 路径，避免重复。

## AiStreamManager 公开 API

```typescript
class AiStreamManager {
  // 生命周期配置 —— lifecycle 容器无参调用使用 DEFAULT_CONFIG；
  // 测试或未来配置入口可传 Partial 覆盖。
  constructor(config?: Partial<AiStreamManagerConfig>)

  // ── 唯一 dispatch 入口 ───────────────────────────────────────
  // 行为由当前 topic 的活跃流状态决定：
  //   活跃（pending / streaming）→ inject：
  //     push userMessage 到每个 execution 的队列，listeners 按 id upsert
  //   空闲 或 已到 terminal（grace period 内）→ start：
  //     驱逐旧流，按 models 清单创建新 ActiveStream + 启动 N 条 execution
  // `startExecution` 不对外暴露，`send` 是唯一入口，路由逻辑集中在此。
  send(input: SendInput): SendResult

  // ── 订阅管理 ──────────────────────────────────────────────────
  attach(sender: WebContents, req: { topicId }): AiStreamAttachResponse
  detach(sender: WebContents, req: { topicId }): void
  addListener(topicId: string, listener: StreamListener): boolean
  removeListener(topicId: string, listenerId: string): void

  // ── 控制 ──────────────────────────────────────────────────────
  abort(topicId: string, reason: string): void
  // 往每个 execution 的 pendingMessages 队列各推一条消息（用于
  // mid-stream 追加用户输入）。send() 命中 'injected' 分支时走的就是这个。
  injectMessage(topicId: string, message: Message): boolean

  // ── 执行级事件 (执行循环驱动, 测试可直接调用以模拟) ─────────────
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
  userMessage?: Message       // inject 时 push 到每个 execution 的 queue
  siblingsGroupId?: number
}

interface SendResult {
  mode: 'started' | 'injected'
  executionIds: UniqueModelId[]  // started → 新启动的；injected → 已运行的
}
```

- **injected**：topic 已有活跃流（`pending` 或 `streaming`）→ `models` 被忽略，`userMessage`（如提供）push 到每个 execution 的 `pendingMessages` 队列，`listeners` 按 id upsert
- **started**：topic 空闲或已到 terminal（含 grace period 内的残留）→ 创建新 `ActiveStream`，按 `models.length > 1` 推导 `isMultiModel`，为每个 model 启动一条 execution

`isMultiModel` 不是入参，由 `models.length` 自动推导。

### 执行循环: `runExecutionLoop`

每个 execution 启动一条独立的执行循环。它的职责是桥接"AI SDK 产出的单一 `ReadableStream`"与"manager 要做的事情"——向所有 listener 广播、缓存 chunk 以支持 reconnect、同时累计出一份可持久化的 `finalMessage`。

**步骤 1：拿到原始 chunk 流**

```typescript
const stream: ReadableStream<UIMessageChunk> = await aiService.streamText(request, signal)
```

`streamText` 返回 AI SDK agentLoop 产出的原始 chunk 流。`signal` 由 `StreamExecution.abortController` 派生，Manager 调用 `abort()` 时会触发它。

**步骤 2：用 `tee()` 把原始流复制成两条独立子流**

Web Streams 的 `stream.tee()` 返回两条**互不干扰的** `ReadableStream`，任何上游 chunk 都会被同时推入这两条；每条子流有自己的 reader、自己的背压、自己的取消，互不阻塞。执行循环用这两条分别做两件事：


| 子流  | 消费者                                           | 目的                                                                                                                         |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A   | `for await (chunk of readerA)` 循环             | 每个 chunk 先写入 `exec.buffer`（ring buffer，reconnect 时回放用），再调 `manager.onChunk(...)` 广播给所有 listener                            |
| B   | `readUIMessageStream(streamB)`（AI SDK helper） | 把 chunk 序列累加为一个完整的 `UIMessage`，执行循环每收到一次聚合快照就把它写回 `exec.finalMessage`；流结束时，`finalMessage` 即是最终交给 PersistenceBackend 的那条消息 |


**步骤 3：中途 abort 的传播**

Manager 调 `abort(topicId, reason)` → `execution.abortController.abort(reason)` → 原始 `signal` 进入 aborted 状态。执行循环内部监听 `signal`，触发后对**两条子流分别调用 `reader.cancel()`**：

- 子流 A 的循环下一次 `reader.read()` 立即返回 `{ done: true }`，`for await` 退出，不再向 listener 广播
- 子流 B 的 `readUIMessageStream` 停止读取，最后一次聚合出的 `UIMessage` 即为 "partial finalMessage"

这就是 paused / error 场景下仍能拿到"已生成了一半"的 `finalMessage` 的机制。

**步骤 4：按执行循环的退出路径分派 terminal 事件**


| 退出路径                                                                   | 触发方法                                      | 行为                                                                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 正常读完                                                                   | `onExecutionDone(topicId, modelId)`       | 状态置 `done`，`finalMessage` 交给 PersistenceBackend 按 `success` 持久化                                                                               |
| `signal.aborted === true` 且 `exec.status` 已被 `abort()` 显式标记为 `aborted` | `onExecutionPaused(topicId, modelId)`     | `finalMessage`（可能 partial）按 `paused` 持久化                                                                                                      |
| 任意其他 throw                                                             | `onExecutionError(topicId, modelId, err)` | 保留已累积的 partial `finalMessage`，连同 `SerializedError` 一起分发给所有 listener 的 `onError`；Persistence 在持久化前会把 error 合成一个 `data-error` part 追加到 parts 尾部 |


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
                           ├─ 每个 execution 启动独立执行循环 + 自己的 pendingMessages + buffer
                           └─ return { mode: 'started', executionIds: [gpt-4o, claude-sonnet] }
```

Mid-stream 消息注入场景（用户在生成期间继续发送消息）：

- `manager.send` 进入 inject 分支，把同一条 `userMessage` **复制一份**推入每个 execution 自己的 `pendingMessages` 队列
- 不同 execution 的消费方式可能不同：agentLoop 调 `drain()` 拉取本队列的所有消息；Claude Code provider 把队列当 AsyncIterable 迭代。因为队列互不共享，两条消费路径不会互相争抢同一条消息
- 因此多模型下注入不会丢消息，每个模型都能看到完整的后续输入

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
                                         └─ 每个 execution 启动 runExecutionLoop
                                              │
3. ←── Ai_StreamChunk ──── WebContentsListener ←── 执行循环的 onChunk 广播
4. ←── Ai_StreamChunk ──── ...
                                              │
                                         (流执行完成)
                                              │
5. ←── Ai_StreamDone ──── WebContentsListener ←── onExecutionDone 广播
                          PersistenceListener ←── onExecutionDone
                             └─ backend.persistAssistant(...)
                                              │
                                         scheduleCleanup(30s)
```

### Mid-stream 消息注入（用户在生成期间继续发送消息）

```
Renderer                           Main
────────                           ────
流正在执行...
1. Ai_Stream_Open ────────────→  provider.prepareDispatch → PreparedDispatch
                                    │
                                    └─ manager.send (已有活跃流)
                                         ├─ 对每个 execution: exec.pendingMessages.push(userMessage)
                                         ├─ listeners upsert (by id)
                                         └─ return { mode: 'injected', executionIds }
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

**用户主动停止（`Ai_Stream_Abort`）**

1. 调用 `manager.abort(topicId, 'user-requested')`
2. Manager 对每个 execution 依次：
  - 关闭 `exec.pendingMessages` 队列 → 让正在等队列 `next()` 的消费者（agentLoop / Claude Code）立即解除阻塞
  - `exec.status` 标记为 `aborted`
  - 调用 `abortController.abort(reason)` → 执行循环的 `signal` 进入 aborted 状态 → 对两条 tee 子流 `reader.cancel()` → 两个读循环下一次 read 返回 done，执行循环退出
3. 执行循环的退出路径为 "signal aborted + exec.status = aborted"，分派到 `onExecutionPaused`：partial `finalMessage` 按 `paused` 持久化
4. 最后整个 topic 的 `stream.status` 派生为 `aborted`

**所有 listener 失效 + `config.backgroundMode === 'abort'`**

场景：所有观察窗口都关闭了（所有 `WebContentsListener.isAlive()` 返回 false）。

1. `onChunk` 每次广播前会移除不活跃的 listener
2. 清理完后 `stream.listeners.size === 0` → Manager 自动调 `abort(topicId, 'no-subscribers')`
3. 后续流程与"用户主动停止"相同，partial 走 `paused` 持久化

这样保证了：即使所有窗口都关了，已生成的部分会被正确标记为 paused 持久化，不会误标 success，也不会因为没人消费而泄漏执行循环所占用的资源。

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

**Topic status 不需要 attach**：只关心 "这个 topic 是否有活跃流" 的观察者（侧边栏的 loading 指示、Topics 列表的状态点等）不必注册 `WebContentsListener`。`Ai_TopicStatusChanged` 是广播到所有窗口的 broadcast 通道，`Ai_Topic_GetStatuses` 提供 side-effect-free 的初始快照；观察者只需监听这两个通道即可与 Main 的权威状态保持同步。`Ai_Stream_Attach` 只有当窗口需要接收实时 chunk（例如 Renderer 渲染正在生成的消息）时才用。

### Channel / Agent 集成

Channel 和 Agent scheduler 在 Main 进程内部直接调用 `AiStreamManager.send`，不经 IPC：

```typescript
aiStreamManager.send({
  topicId,
  models: [{ modelId: uniqueModelId, request: {...} }],
  listeners: [new ChannelAdapterListener(adapter, chatId), sentinelListener]
})
```

不同场景差异完全由 listeners 组合表达：


| 场景               | Listeners                                                          | 效果                  |
| ---------------- | ------------------------------------------------------------------ | ------------------- |
| Renderer 用户发送    | WebContentsListener + PersistenceListener                          | 实时显示 + 持久化          |
| Channel bot 回复   | ChannelAdapterListener + PersistenceListener (AgentMessageBackend) | IM 发送 + 写 agents DB |
| Channel + 用户同时观察 | 以上 + WebContentsListener(B)                                        | 全部并行                |
| API Server SSE   | SSEListener + PersistenceListener                                  | SSE 推送 + 持久化        |


## IPC 契约

### Request channels (Renderer → Main)


| Channel                | Payload                                                             | 返回值                                         | 语义                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Ai_Stream_Open`       | `{ topicId, parentAnchorId, userMessageParts, mentionedModelIds? }` | `{ mode, executionIds? }`                   | 发送消息；Provider 根据 topicId 路由                                                                                                                      |
| `Ai_Stream_Attach`     | `{ topicId }`                                                       | `AiStreamAttachResponse`                    | 订阅流状态；streaming 时返回 compact replay                                                                                                               |
| `Ai_Stream_Detach`     | `{ topicId }`                                                       | void                                        | 取消订阅（流继续执行）                                                                                                                                      |
| `Ai_Stream_Abort`      | `{ topicId }`                                                       | void                                        | 终止当前生成                                                                                                                                           |
| `Ai_Topic_GetStatuses` | —                                                                   | `Record<topicId, TopicStatusSnapshotEntry>` | 一次性快照（每项含 `status` + `activeExecutionIds`），用于新挂载的 consumer 初始化 cache mirror；side-effect-free（不注册 listener、不分配 replay）。已过期（grace period 之后）的 topic 不出现在 map 中 |


### Push channels (Main → Renderer)


| Channel                 | Payload                                          | 说明                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ai_StreamChunk`        | `{ topicId, executionId?, chunk }`               | 多模型时带 `executionId`，单模型 undefined；**仅发给 attach 过的窗口**                                                                                                                                                             |
| `Ai_StreamDone`         | `{ topicId, executionId?, status, isTopicDone }` | `status ∈ { 'success', 'paused' }` 区分正常完成 / 用户 abort；**仅发给 attach 过的窗口**                                                                                                                                          |
| `Ai_StreamError`        | `{ topicId, executionId?, isTopicDone, error }`  | SerializedError；**仅发给 attach 过的窗口**                                                                                                                                                                               |
| `Ai_TopicStatusChanged` | `{ topicId, status, activeExecutionIds }`        | 广播给所有窗口，`status ∈ { 'pending', 'streaming', 'done', 'aborted', 'error' }`；观察者不需要 attach 即可跟踪 topic 状态。`pending` 还兼任 "新 stream 创建" 的通知（旧 `Ai_StreamStarted` 已下线）。**grace-period cleanup 不广播** — cache 镜像保留终态直到本地消费者清理 |


**所有通信均以 topicId 为唯一 key**；多模型场景下 `executionId` 区分 chunks 来源。

**Topic status vs message status**：两种状态不要混淆。

- **Topic stream status**（`Ai_TopicStatusChanged` / `Ai_Topic_GetStatuses` 暴露）：每个 topic 一个，`AiStreamManager.ActiveStream.status` 为 source of truth，只在 `ActiveStream` 存活期（+ grace period）内有值。`pending` 表示"流已创建但尚未收到首个 chunk"，`streaming` 表示"至少一个 execution 已产出 chunk，内容正在流动"。
- **Assistant message status**（`AssistantMessageStatus`：`PENDING` / `PROCESSING` / `SUCCESS` / `ERROR`）：每条 assistant 消息一个，SQLite 持久化，由 `PersistenceListener.onDone/onError` 写入。多模型下一次 topic 状态迁移对应 N 条消息各自的状态写入。

Cache schema 以路径前缀把两者分离：

- `topic.stream.status.${topicId}`：ActiveStream 生命周期状态的 renderer 侧镜像
- `topic.stream.executions.${topicId}`：当前处于非终态的 execution ID 列表（`UniqueModelId[]`），与 status 迁移一同从同一 payload 更新
- （不涉及）message 表的 `status` 列：由 DataApi 管理，不进 cache

broadcast 通道只写，不清理终态：renderer 侧的 local-consume 逻辑（例如 active-topic `useEffect` 把 `done` 置空）负责 cache eviction，Main 不参与。

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
- `manager.send` 的 inject / start / multi-model 路由只在 dispatcher 里存在一处

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


| Provider                          | canHandle                                | 数据层                       | User 消息   | Assistant 消息                                                       |
| --------------------------------- | ---------------------------------------- | ------------------------- | --------- | ------------------------------------------------------------------ |
| **AgentChatContextProvider**      | `topicId.startsWith('agent-session:')`   | `agentMessageRepository`  | 预先写入      | `PersistenceListener(AgentMessageBackend)` onDone 写入               |
| **TemporaryChatContextProvider**  | `temporaryChatService.hasTopic(topicId)` | `TemporaryChatService` 内存 | append 一条 | `PersistenceListener(TemporaryChatBackend)` onDone append          |
| **PersistentChatContextProvider** | `true`（catch-all 默认）                     | `messageService` + SQLite | 事务 create | `PersistenceListener(MessageServiceBackend)` onDone update pending |


路由顺序：Agent → Temporary → Persistent（匹配第一个 `canHandle === true` 的 provider）。

### 持久化路径对比


|                       | Persistent              | Temporary              | Agent                     |
| --------------------- | ----------------------- | ---------------------- | ------------------------- |
| user message 时机       | 流开始前（tree 节点）           | 流开始前（append）           | 流开始前（agents DB）           |
| assistant placeholder | 流开始前 pending            | 不创建                    | 不创建                       |
| 终结时操作                 | `update` placeholder    | `append` 新条目           | `persistAssistantMessage` |
| Backend               | `MessageServiceBackend` | `TemporaryChatBackend` | `AgentMessageBackend`     |
| Multi-model 支持        | ✓                       | ✗（单模型）                 | ✗（单模型）                    |
| Regenerate 支持         | ✓                       | ✗                      | ✗                         |


### 跨 topic 类型复用 PersistenceListener

Persistent / Temporary / Agent 三种存储路径**共享同一个 `PersistenceListener` 类**，仅通过注入不同的 `PersistenceBackend` 改变持久化行为。observer 协议（按 `modelId` 过滤、error 合成、`skip-when-no-finalMessage`、swallow errors）只需实现一次。

## AiService 集成

`AiService` 是 lifecycle 服务：

- **Streaming**：`streamText(request, signal)` → `Promise<ReadableStream<UIMessageChunk>>`，被 `AiStreamManager.runExecutionLoop` 消费
- **非流式 IPC gateway**：`generateText` / `checkModel` / `embedMany` / `generateImage` / `listModels` / `abortImage`，在 `onInit` 里注册为 IPC handler

`AiStreamManager` 通过 `await application.get('AiService').streamText(...)` 调用。pre-stream 错误（provider/model 解析、agent 参数构建）从 Promise reject 抛出；mid-stream 错误从返回的 stream 自身 error 传播 —— 两条错误路径不会混在一起。

## Grace Period & Reconnect

流结束后 `ActiveStream` 在内存保留 30 秒（`config.gracePeriodMs`）。期间用户返回对话可通过 `attach` 直接拿到 `finalMessage`，无需查数据库。过期后 `ActiveStream` 被清除，后续 `attach` 返回 `not-found`，Renderer 通过 `useQuery` 从数据库读（PersistenceListener 已完成持久化）。

用户停止后立即重试同一 topic 时，`send` 进入 start 分支：先调用 `evictStream` 把 grace period 内的旧流提前回收（清空 cleanup timer + 从 `activeStreams` 移除），随后再创建新流，避免旧流挡住新流的位置。

## 边界情况速查


| 情况                                   | 处理策略                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 流执行期间用户再次发送同一 topic                  | `send` 走 inject 分支；`userMessage` 被 fan-out 复制到每个 execution 的 pendingMessages 队列                                                          |
| 流刚结束立即重试同一 topic                     | `send` 走 start 分支：先 `evictStream` 清掉 grace period 内的旧流，再创建新流                                                                               |
| 窗口关闭但流未结束                            | 下次广播时 `WebContentsListener.isAlive()` 返回 false → dispatch 时自动把它从 listener 列表移除；`PersistenceListener` 不依赖窗口存活，持久化路径不受影响                      |
| 所有窗口关闭 + `backgroundMode='continue'` | 流在 Main 中继续执行直至结束，PersistenceListener 完成持久化                                                                                                 |
| 所有窗口关闭 + `backgroundMode='abort'`    | `onChunk` 清理完 dead listener 后发现 `stream.listeners.size === 0` → 自动 `abort(topicId, 'no-subscribers')`；partial `finalMessage` 走 paused 路径持久化 |
| 多窗口查看同一 topic                        | 每个窗口各自持有一个 `WebContentsListener`，每个 chunk 被广播给所有活跃的 listener                                                                               |
| 同一窗口重复 Attach                        | listener id 形如 `wc:${wc.id}:${topicId}`，值稳定；`addListener` 按 id upsert，不会出现重复订阅                                                             |
| 流已开始后才 Attach                        | `attach` 对每个 execution 返回 compact replay（每个 execution 的 buffer 单独压缩），观察者可从"完整消息"语义上补齐之前错过的内容                                               |
| Ring buffer 溢出                       | 到达 `maxBufferChunks` 上限后丢弃最旧一条 chunk 并 `droppedChunks++`；后续 attach 在日志里 warn 累计丢弃数（回放不再能完整还原流）                                             |
| 多模型场景下的消息注入                          | 一条注入消息被 fan-out 复制到每个 execution 的 pendingMessages 队列，消息不会丢失                                                                               |
| Main 进程重启                            | `activeStreams` 清空；活跃中的流全部丢失，Renderer 从数据库读取已持久化的消息                                                                                         |


## 设计备注

### 测试策略

- **Manager 单测**：`createManager({ maxBufferChunks: 3 })` 通过 constructor 注入测试 config；状态断言统一使用 `mgr.inspect(topicId)`；listener upsert / abort / backgroundMode 采用行为观察（触发 chunk 后断言哪些 listener 接收到）
- **Provider 单测**：直接断言 `prepareDispatch` 返回值；不 mock manager
- **PersistenceListener 单测**：用 `TemporaryChatBackend` 做测试载体，observer 协议一套覆盖所有 backend
- 所有内部状态访问点都有 public inspection API；生产代码和测试共享同一份 contract

