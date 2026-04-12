# AiStreamManager 架构

## 概述

AiStreamManager 是 Main 进程的**活跃流注册表**。它接管 AI 流式回复的完整生命周期 —— 从用户点击发送到 assistant 消息持久化至 SQLite,中间经过的所有环节(多播分发、reconnect、abort、steering、持久化)都由 AiStreamManager 统一管理。

Renderer 不再直接持有流的引用。窗口关闭不等于流终止 —— 流在 Main 中继续执行并完成持久化。用户返回该对话时,AiStreamManager 提供 reconnect 能力(缓存回放 + 恢复实时订阅)。

**唯一标识: `topicId`**。一个 topic 同时最多有一条活跃流。streaming 只是 topic 的一种数据状态,所有订阅方地位平等,不区分"发起者"和"观察者"。

## 解决什么问题

v1 的流是"一次性管线":Renderer 发起 IPC → AiService 直接耦合于 `event.sender`(WebContents)→ 逐个 chunk 通过 `wc.send` 发送 → 流结束后立即释放。这条管线存在三个结构性缺陷:

### 1. 流的生命周期耦合于窗口

AI SDK `useChat` 内部通过 `useRef` 持有 `Chat` 实例。组件 unmount → Chat 被回收 → Transport 的 ReadableStream 被 cancel → Main 端收到 abort 信号 → 流被终止。

**用户感知**: 切换 topic、关闭窗口、甚至路由跳转,正在生成的回复会静默消失。

### 2. 不支持 reconnect

`IpcChatTransport.reconnectToStream()` 返回 `null`。AI SDK 的 `useChat` 在组件 mount 时会调用此方法检查是否有进行中的流可以恢复,收到 `null` 则认为不存在。

**用户感知**: 切换到其他 topic 后返回,无法看到正在生成的回复,只能等待完成后从数据库读取。

### 3. 持久化在 Renderer 侧执行

`ChatSessionManager.handleFinish`(440 行)在 Renderer 中执行持久化。整条 persistence 路径的可靠性取决于窗口是否存活 —— 如果在写入数据库前 Renderer 崩溃、窗口关闭或页面刷新,数据将丢失。

**核心设计目标**: 将流的生命周期管理、多播分发、持久化全部下沉到 Main 进程,Renderer 仅负责显示 chunk 内容。

## 架构全景

```
┌──────────────── Renderer ────────────────────────────────┐
│                                                          │
│  useChat({ id: topicId, transport: IpcChatTransport })   │
│    ├─ sendMessages   → Ai_Stream_Open  (topicId, userMessage, parentAnchorId)
│    ├─ reconnect      → Ai_Stream_Attach ({ topicId })    │
│    └─ cancel         → Ai_Stream_Abort  ({ topicId })    │
│                                                          │
│  历史消息: useQuery('/topics/:id/messages') → DataApi    │
│  活跃流 chunks: onStreamChunk listener, 按 topicId 过滤 │
└──────────────────────────────────────────────────────────┘
                  ↕ IPC (所有通信均以 topicId 为 key)
┌──────────────── Main ────────────────────────────────────┐
│                                                          │
│  AiStreamManager (lifecycle 服务)                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │ activeStreams: Map<topicId, ActiveStream>           │  │
│  │   topicId / abortController / status               │  │
│  │   listeners: Map<listenerId, StreamListener>       │  │
│  │   buffer: UIMessageChunk[]                         │  │
│  │   pendingMessages: PendingMessageQueue             │  │
│  │   finalMessage?                                    │  │
│  └────────────────────────────────────────────────────┘  │
│         ↓ 通过 InternalStreamTarget 委托                 │
│  AiService.executeStream(target, request, { signal })    │
│         ↓                                                │
│  AiCompletionService.streamText / runAgentLoop           │
│                                                          │
│  流结束后:                                               │
│    PersistenceListener.onDone → messageService.create    │
│    WebContentsListener.onDone → wc.send(Ai_StreamDone)   │
│    ChannelAdapterListener.onDone → adapter.sendMessage   │
└──────────────────────────────────────────────────────────┘
```

## 文件结构

```
src/main/ai/stream-manager/
├── types.ts                    所有接口和 IPC payload 定义
├── InternalStreamTarget.ts     AiService 的 StreamTarget 适配器
├── AiStreamManager.ts          lifecycle 服务(多播 + 生命周期管理)
├── listeners/
│   ├── WebContentsListener.ts      将 chunks 分发到 Renderer 窗口
│   ├── PersistenceListener.ts      流结束时将 assistant 消息写入 SQLite
│   └── ChannelAdapterListener.ts   将回复文本发送到 Discord / Slack / 飞书
├── adapters/
│   └── ClaudeCodeStreamAdapter.ts  桥接 Claude Agent SDK 的事件到 AiStreamManager
└── index.ts                    barrel export
```

## StreamListener: 观察者接口

AiStreamManager 对所有消费者一视同仁,通过 `StreamListener` 的四个方法统一调度:

```typescript
interface StreamListener {
  readonly id: string
  onChunk(chunk: UIMessageChunk): void
  onDone(result: StreamDoneResult): void | Promise<void>
  onError(error: SerializedError): void | Promise<void>
  isAlive(): boolean
}
```

### 三个内置实现

| Listener | 职责 | id | isAlive | onChunk | onDone |
|---|---|---|---|---|---|
| **WebContentsListener** | 将 chunks 分发到 Renderer | `wc:${wc.id}:${topicId}` | `!wc.isDestroyed()` | `wc.send(Ai_StreamChunk)` | `wc.send(Ai_StreamDone)` |
| **PersistenceListener** | 流结束时写入 SQLite | `persistence:${topicId}` | 始终为 `true` | 不处理 | `messageService.create` + `afterPersist` 钩子 |
| **ChannelAdapterListener** | 将文本发送到 IM 平台 | `channel:${channelId}:${chatId}` | `adapter.connected` | 累积文本 + `onTextUpdate` | `onStreamComplete` / `sendMessage` |

### 为什么 Listener id 按 topicId 构造

steering 场景下,用户在生成期间继续发送消息时,新的 listeners 会通过 `addListener` 追加到已有 ActiveStream 的 listeners Map 中。topicId 构造的 id 保证 upsert 机制用新 listener 替换旧 listener(同一 topic 同一窗口只保留一个订阅),避免重复分发 chunks 或重复写入数据库。

## StreamTarget: AiService 解耦接口

```typescript
interface StreamTarget {
  send(channel: string, payload: { chunk?; error?; [key: string]: unknown }): void
  isDestroyed(): boolean
  setFinalMessage?(message: CherryUIMessage): void
}
```

`AiService.executeStream` 的 target 参数从 `Electron.WebContents` 拓宽为 `StreamTarget`。InternalStreamTarget 实现此接口,将 chunks 路由回 AiStreamManager 的 `onChunk/onDone/onError` 方法。AiService 不感知对端的具体类型。

### InternalStreamTarget

```typescript
class InternalStreamTarget implements StreamTarget {
  constructor(manager: ManagerCallbacks, topicId: string)

  send(channel, payload) → 根据 channel 类型分发到 manager.onChunk / onDone / onError
  isDestroyed()          → manager.shouldStopStream(topicId)
  setFinalMessage(msg)   → manager.setStreamFinalMessage(topicId, msg)
}
```

绑定 `topicId`。上游产出的 chunk/done/error 通过 topicId 路由回对应的 ActiveStream。

## ActiveStream: 一次生成的完整状态

```typescript
interface ActiveStream {
  topicId: string
  abortController: AbortController
  listeners: Map<string, StreamListener>
  pendingMessages: PendingMessageQueue
  buffer: UIMessageChunk[]
  status: 'streaming' | 'done' | 'error' | 'aborted'
  finalMessage?: CherryUIMessage
  error?: SerializedError
  reapAt?: number
  reapTimer?: ReturnType<typeof setTimeout>
  sourceSessionId?: string       // Claude Agent SDK resume token
}
```

## 完整数据流

### 发送消息(标准路径)

```
Renderer                           Main
────────                           ────
1. 用户点击发送
2. transport.sendMessages()
3. streamOpen(IPC) ────────────→  handleStreamRequest(sender, req)
                                    │
                                    ├─ 4. 在事务中写入 user message:
                                    │     messageService.create(topicId, {
                                    │       role: 'user',
                                    │       parentId: req.parentAnchorId,
                                    │       data: req.userMessage.data
                                    │     })
                                    │
                                    ├─ 5. 构造 listeners:
                                    │     WebContentsListener(sender, topicId)
                                    │     PersistenceListener({ topicId, ... })
                                    │
                                    └─ 6. send() → startStream()
                                          │
                                          ├─ 创建 ActiveStream
                                          ├─ activeStreams.set(topicId, stream)
                                          ├─ target = InternalStreamTarget(manager, topicId)
                                          └─ AiService.executeStream(target, req, { signal })
                                                    │
7. ←── Ai_StreamChunk ──── WebContentsListener ←── onChunk(广播)
8. ←── Ai_StreamChunk ──── ...
                                                    │
                                               (流执行完成)
                                                    │
9. ←── Ai_StreamDone ──── WebContentsListener ←── onDone(广播)
                            PersistenceListener.onDone → SQLite
                                                    │
                                               scheduleReap(30s)
```

### Steering(用户在生成期间继续发送消息)

```
Renderer                           Main
────────                           ────
流正在执行...

1. 用户输入第二条消息
2. streamOpen(IPC) ────────────→  handleStreamRequest(sender, req)
                                    │
                                    ├─ 在事务中写入 user msg2
                                    │
                                    └─ send() 检测到 topicId 存在活跃流
                                         → 进入 steer 流程, 不创建新流
                                         │
                                         ├─ pendingMessages.push(msg2)
                                         └─ addListener: upsert 替换旧 listener
```

### Reconnect(返回之前的对话)

```
Renderer                           Main
────────                           ────
1. 用户离开对话, WebContentsListener 被移除
   流在 Main 中继续执行...

2. 用户返回该对话
   useChat mount → transport.reconnectToStream()
3. streamAttach(IPC) ──────────→ handleAttach(sender, { topicId })
                                    │
                                    ├─ streaming: 注册新 listener + 回放缓存
                                    ├─ done: 返回 finalMessage
                                    └─ error: 返回 error
```

### Abort(用户主动停止)

```
Renderer                           Main
────────                           ────
1. 用户点击停止
2. streamAbort(IPC) ───────────→ abort(topicId, 'user-requested')
                                    │
                                    ├─ stream.status = 'aborted'
                                    └─ abortController.abort()
                                         → AbortSignal 传播至 executeStream
                                         → onDone(topicId, 'paused')
```

### 多窗口观察

```
窗口 A                              窗口 B
──────                              ──────
streamOpen(topicA)
  → WebContentsListener(A) + PersistenceListener
                                     打开 topicA
                                     streamAttach({ topicId: 'topicA' })
                                       → 注册 WebContentsListener(B, topicA)
                                       → 回放缓存

chunk 到达 → 广播:
  WebContentsListener(A) → A         WebContentsListener(B) → B
```

### Channel / Agent 集成

Channel 和 Agent scheduler 在 Main 内部直接调用 AiStreamManager:

```typescript
const userMessage = await messageService.create(topicId, { ... })
streamManager.startStream({
  topicId,
  request: buildStreamRequest(msg),
  listeners: [
    new ChannelAdapterListener(adapter, msg.chatId),
    new PersistenceListener({ topicId, parentUserMessageId: userMessage.id, ... })
  ]
})
```

AiStreamManager 不区分发起来源。不同场景的差异完全通过注册的 listeners 组合来表达:

| 场景 | 注册的 Listeners | 效果 |
|---|---|---|
| Renderer 用户发送消息 | WebContentsListener + PersistenceListener | 实时显示 + 持久化 |
| Channel bot 回复 | ChannelAdapterListener + PersistenceListener | IM 平台发送 + 持久化 |
| Channel + 用户同时查看 | ChannelAdapterListener + PersistenceListener + WebContentsListener | IM + 持久化 + 实时显示 |
| Agent 后台任务 | PersistenceListener (+ 可选 WebContentsListener) | 持久化(若 debug 面板打开则同时分发到 UI) |

## IPC 契约

### Request channels (Renderer → Main)

| Channel | Payload | 返回值 | 语义 |
|---|---|---|---|
| `Ai_Stream_Open` | `{ topicId, parentAnchorId, userMessage, assistantId, ... }` | `{ mode: 'started' \| 'steered' }` | 发送消息(自动判断创建新流或 steer) |
| `Ai_Stream_Attach` | `{ topicId }` | `{ status, ... }` | 订阅 topic 的流状态 |
| `Ai_Stream_Detach` | `{ topicId }` | void | 取消订阅(流继续执行) |
| `Ai_Stream_Abort` | `{ topicId }` | void | 终止当前生成 |

### Push channels (Main → Renderer)

| Channel | Payload | 说明 |
|---|---|---|
| `Ai_StreamChunk` | `{ topicId, chunk }` | 按 topicId 过滤 |
| `Ai_StreamDone` | `{ topicId, status }` | status 区分正常完成与被中止 |
| `Ai_StreamError` | `{ topicId, error }` | SerializedError |

**所有通信均以 topicId 为唯一 key。**

## AiService 集成

AiStreamManager 对 AiService 的修改极少:

1. **`executeStream` target 类型拓宽**: `Electron.WebContents` → `StreamTarget`
2. **新增 `options.signal`**: AiStreamManager 传入自身持有的 AbortSignal

AiService 的职责收敛为纯粹的 AI 执行函数 —— 接收 target、request 和 signal,执行模型调用,将 chunks 写入 target。流的控制、路由、持久化全部由 AiStreamManager 负责。

## 持久化设计

### User message 在 Main 端事务写入

Renderer 在 `Ai_Stream_Open` 请求中传递 `userMessage`(仅包含内容, 不含 id)和 `parentAnchorId`(显式父节点)。Main 端 `handleStreamRequest` 调用 `messageService.create` 写入 user message,获得真实 SQLite id。该 id 作为 `PersistenceListener.parentUserMessageId`。

### PersistenceListener

流结束时调用 `messageService.create` 写入 assistant 消息,显式指定 `parentId`,不依赖 `activeNodeId`。支持 `afterPersist` 钩子用于 UI 增强类副作用(重命名、标题生成),采用 best-effort 策略。

## Grace Period 与 Reconnect 机制

流结束后 ActiveStream 在内存中保留 30 秒(grace period)。期间用户返回该对话可直接获取 finalMessage,无需查询数据库。过期后 ActiveStream 被清除,延迟到达的 attach 返回 `not-found`,Renderer 通过 `useQuery` 从数据库读取(PersistenceListener 已完成持久化,数据不会丢失)。

停止后立即重试时,`startStream` 驱逐 grace period 内的旧流,为新流让出位置。

## 边界情况速查

| 情况 | 处理策略 |
|---|---|
| 流执行期间用户再次发送消息 | `send()` 路由到 steer,消息加入 pendingMessages |
| 流结束后立即重试 | 驱逐 grace period 内的旧流,创建新流 |
| 窗口关闭但流未结束 | WebContentsListener 被自动清理,PersistenceListener 不受影响 |
| 所有窗口关闭 + `backgroundMode='continue'` | 流继续执行,完成后持久化 |
| 所有窗口关闭 + `backgroundMode='abort'` | `shouldStopStream()` 返回 true,流被中止 |
| 多窗口查看同一 topic | 各窗口独立的 WebContentsListener,同时接收 chunks |
| 同一窗口重复 Attach | listener id 稳定,addListener 执行 upsert |
| Buffer 溢出 | 超过 maxBufferChunks 后停止缓存(不停止流) |
| Main 进程重启 | activeStreams 清空,Renderer 通过数据库读取 |

## 待确认的产品决策

1. **`parentAnchorId` 并发语义**: 多窗口同时向同一 topic 发送消息时,第二个请求的 `parentAnchorId` 可能已过时。Main 会创建兄弟分支。这是缺陷还是符合预期?待产品侧确认。
2. **`afterPersist` best-effort 边界**: 当前所有 post-persist 副作用均采用 fire-and-forget 模式。若某项副作用的丢失构成业务问题,需升级为 outbox + worker 机制。
