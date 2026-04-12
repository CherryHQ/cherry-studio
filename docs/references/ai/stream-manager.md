# AiStreamManager 架构

## 概述

AiStreamManager 是 Main 进程的**活跃流注册表与控制平面**。它接管 AI 流式回复的完整生命周期 —— 从用户点击发送到 assistant 消息持久化至 SQLite,中间经过的所有环节(多播分发、reconnect、abort、steering、持久化)都由 AiStreamManager 统一管理。

Renderer 不再直接持有流的引用。窗口关闭不等于流终止 —— 流在 Main 中继续执行并完成持久化。用户返回该对话时,AiStreamManager 提供 reconnect 能力(缓存回放 + 恢复实时订阅)。

## 解决什么问题

v1 的流是"一次性管线":Renderer 发起 IPC → AiService 直接耦合于 `event.sender`(WebContents)→ 逐个 chunk 通过 `wc.send` 发送 → 流结束后立即释放。这条管线存在三个结构性缺陷:

### 1. 流的生命周期耦合于窗口

AI SDK `useChat` 内部通过 `useRef` 持有 `Chat` 实例。组件 unmount → Chat 被回收 → Transport 的 ReadableStream 被 cancel → Main 端收到 abort 信号 → 流被终止。

**用户感知**:切换 topic、关闭窗口、甚至路由跳转,正在生成的回复会静默消失。

### 2. 不支持 reconnect

`IpcChatTransport.reconnectToStream()` 返回 `null`。AI SDK 的 `useChat` 在组件 mount 时会调用此方法检查是否有进行中的流可以恢复,收到 `null` 则认为不存在。

**用户感知**:切换到其他 topic 后返回,无法看到正在生成的回复,只能等待完成后从数据库读取。

### 3. 持久化在 Renderer 侧执行

`ChatSessionManager.handleFinish`(440 行)在 Renderer 中执行持久化。整条 persistence 路径的可靠性取决于窗口是否存活 —— 如果在写入数据库前 Renderer 崩溃、窗口关闭或页面刷新,数据将丢失。

**核心设计目标**:将流的生命周期管理、多播分发、持久化全部下沉到 Main 进程,Renderer 仅负责显示 chunk 内容。

## 架构全景

```
┌──────────────── Renderer ────────────────────────────────┐
│                                                          │
│  useChat({ id: topicId, transport: IpcChatTransport })   │
│    ├─ sendMessages   → Ai_Stream_Open  (requestId, topicId, userMessage, parentAnchorId)
│    ├─ reconnect      → Ai_Stream_Attach (byRequestId 或 byTopicId)
│    └─ cancel         → Ai_Stream_Detach (requestId)     │
│                                                          │
│  历史消息: useQuery('/topics/:id/messages') → DataApi    │
│  活跃流 chunks: onStreamChunk listener, 按 topicId 过滤 │
└──────────────────────────────────────────────────────────┘
                  ↕ IPC
                  ↕ request/response 携带 requestId (控制平面)
                  ↕ push 携带 topicId (数据平面)
┌──────────────── Main ────────────────────────────────────┐
│                                                          │
│  AiStreamManager (lifecycle 服务)                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ activeStreams: Map<requestId, ActiveStream>         │  │
│  │   requestId / topicId / abortController / status   │  │
│  │   listeners: Map<listenerId, StreamListener>                   │  │
│  │   buffer: UIMessageChunk[]                         │  │
│  │   pendingMessages: PendingMessageQueue             │  │
│  │   finalMessage? (由上游通过 setFinalMessage 传入)  │  │
│  │                                                    │  │
│  │ topicToActiveRequest: Map<topicId, requestId>      │  │
│  │   (反查索引: steering / byTopicId attach 使用)     │  │
│  └────────────────────────────────────────────────────┘  │
│         ↓ 通过 InternalStreamTarget 委托                    │
│  AiService.executeStream(target, request, { signal })    │
│         ↓                                                │
│  AiCompletionService.streamText / runAgentLoop           │
│                                                          │
│  流结束后:                                               │
│    PersistenceListener.onDone → messageService.create(SQLite)│
│    WebContentsListener.onDone → wc.send(Ai_StreamDone)       │
│    ChannelAdapterListener.onDone → adapter.sendMessage(IM)   │
└──────────────────────────────────────────────────────────┘
```

## 核心概念: 两 id 模型

整个 AiStreamManager 架构围绕**两个 id** 构建,分别管理两个平面,职责不重叠:

| | `requestId` | `topicId` |
|---|---|---|
| **语义** | 一次生成尝试的唯一标识 | 一个会话(对话)的唯一标识 |
| **生成方** | Renderer `crypto.randomUUID()` | SQLite `topics` 表主键 |
| **生命周期** | start → done/error/aborted + grace period | 永久(与 topic 生命周期一致) |
| **用途** | AiStreamManager 主表 key、abort/detach 精确路由、内存去重 | Listener id 构造、push payload 过滤键、useChat 状态复用、steering 聚合 |
| **所属平面** | **控制平面** | **数据平面** |

### 为什么必须两个

**仅使用 topicId 的问题**: 一个 topic 生命周期内会发生多次生成尝试(首次发送、重新生成、停止后重发)。如果 abort/attach/done 均按 topicId 路由:

- 用户点击停止(abort 上一轮)→ 立即重发(新一轮开始)→ 上一轮的延迟 abort 到达 Main → **误终止新一轮**
- reconnect 返回的 attach 绑定到了下一轮而非原始那一轮的流,获取到错误的 finalMessage

**仅使用 requestId 的问题**: 用户在流执行期间连续发送消息(steering)不应创建新流 —— 这些消息属于同一次 AI 对话的追加输入。如果仅有 requestId:

- 每次发送生成新 requestId → AiStreamManager 创建新流 → 前一条流被废弃
- 多窗口观察者(打开同一 topic 的第二个窗口)不知道原始 requestId,无法 attach

**两个 id 的协作**: requestId 使控制平面能精确定位到"哪一次生成尝试",topicId 使数据平面能聚合到"哪个对话"。AiStreamManager 内部通过 `topicToActiveRequest: Map<topicId, requestId>` 桥接两者。

## 文件结构

```
src/main/ai/stream-manager/
├── types.ts                    所有接口和 IPC payload 定义
├── InternalStreamTarget.ts       AiService 的 StreamTarget 适配器
├── AiStreamManager.ts           lifecycle 服务(控制平面 + 多播 + 生命周期管理)
├── listeners/
│   ├── WebContentsListener.ts      将 chunks 分发到 Renderer 窗口
│   ├── PersistenceListener.ts      流结束时将 assistant 消息写入 SQLite
│   └── ChannelAdapterListener.ts   将回复文本发送到 Discord / Slack / 飞书
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
| **PersistenceListener** | 流结束时写入 SQLite | `persistence:${topicId}` | 始终为 `true` | 不处理 | `messageService.create(assistant msg)` + `afterPersist` 钩子 |
| **ChannelAdapterListener** | 将文本发送到 IM 平台 | `channel:${channelId}:${chatId}` | `adapter.connected` | 累积文本(多数 IM 不支持逐字编辑) | `adapter.sendMessage(text)` |

### 为什么 Listener id 按 topicId 而不是 requestId 构造

这是一个关键设计决策,原因在于 **steering 场景下的 upsert 语义**:

1. 用户发送 msg1(requestId=R1)→ AiStreamManager 创建 ActiveStream,listeners Map 包含 `[wc:1:topicA, persistence:topicA]`
2. 流正在执行,用户继续发送 msg2(requestId=R2)→ AiStreamManager 路由到 steer(不创建新流)
3. AiStreamManager 将 msg2 的 listeners **追加到 R1 的 ActiveStream.listeners Map**

**如果 id 使用 requestId**: Map 变为 `[wc:1:R1, persistence:R1, wc:1:R2, persistence:R2]` → 4 个 listener → onDone 触发两次 PersistenceListener → 数据库中写入两条重复的 assistant 消息;WebContentsListener 也会对每个 chunk 重复分发

**如果 id 使用 topicId**: Map 保持为 `[wc:1:topicA, persistence:topicA]` → addListener 的 upsert 机制用 R2 的新 listener 替换 R1 的旧 listener → onDone 仅触发一次,parent 指向最后一条 steered user message → 行为正确

跨轮次的隔离不依赖 listener id —— 两轮生成对应两个独立的 ActiveStream 实例(各自拥有独立的 Map),不会同时出现在同一个 Map 中。

## StreamTarget: AiService 解耦接口

```typescript
interface StreamTarget {
  send(channel: string, payload: { chunk?; error?; [key: string]: unknown }): void
  isDestroyed(): boolean
  setFinalMessage?(message: CherryUIMessage): void
}
```

这是 AiStreamManager 与 AiService 之间的分层接口。`AiService.executeStream` 的 target 参数从 `Electron.WebContents` 拓宽为 `StreamTarget`:

- **真实 WebContents**: 兼容路径(Ai_StreamRequest IPC handler)直接传入 `event.sender`,完全向后兼容
- **InternalStreamTarget**: AiStreamManager 路径传入一个实现了 StreamTarget 接口的适配器,将 chunks 路由回 AiStreamManager 的 `onChunk/onDone/onError` 方法

AiService 不感知对端的具体类型。这也是单元测试中注入 MockStreamTarget 的切入点。

### InternalStreamTarget

```typescript
class InternalStreamTarget implements StreamTarget {
  constructor(manager: ManagerCallbacks, requestId: string)

  send(channel, payload) → 根据 channel 类型分发到 manager.onChunk / onDone / onError
  isDestroyed()          → manager.shouldStopStream(requestId)
  setFinalMessage(msg)   → manager.setStreamFinalMessage(requestId, msg)
}
```

**绑定 requestId**: target 代表一次具体的生成尝试。上游产出的每一个 chunk/done/error 都通过 requestId 精确路由回对应的 ActiveStream,不会在轮次间产生错位。

## ActiveStream: 一次生成尝试的完整状态

```typescript
interface ActiveStream {
  requestId: string             // 控制平面 key
  topicId: string               // 数据平面 key
  abortController: AbortController  // AiStreamManager 持有, signal 传递给 executeStream
  listeners: Map<string, StreamListener>    // 所有订阅者
  pendingMessages: PendingMessageQueue  // steering 队列
  buffer: UIMessageChunk[]       // reconnect 回放缓存
  status: 'streaming' | 'done' | 'error' | 'aborted'
  finalMessage?: CherryUIMessage // 上游通过 setFinalMessage 传入
  error?: SerializedError
  reapAt?: number                // grace period 过期时间戳
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
   requestId = crypto.randomUUID()
3. streamOpen(IPC) ────────────→  handleStreamRequest(sender, req)
                                    │
                                    ├─ 4. 去重检查: activeStreams.has(requestId)?
                                    │     → 命中: 注册 listener 并返回 'deduped'
                                    │
                                    ├─ 5. 在事务中写入 user message:
                                    │     messageService.create(topicId, {
                                    │       role: 'user',
                                    │       parentId: req.parentAnchorId,  // 显式指定
                                    │       data: req.userMessage.data
                                    │     })
                                    │     → 返回 userMessage(包含真实 SQLite id)
                                    │
                                    ├─ 6. 构造 listeners:
                                    │     WebContentsListener(sender, topicId)
                                    │     PersistenceListener({
                                    │       topicId, assistantId,
                                    │       parentUserMessageId: userMessage.id,
                                    │       afterPersist: renameHook?
                                    │     })
                                    │
                                    └─ 7. send() → startStream()
                                          │
                                          ├─ 创建 ActiveStream(requestId, topicId, ...)
                                          ├─ activeStreams.set(requestId, stream)
                                          ├─ topicToActiveRequest.set(topicId, requestId)
                                          ├─ target = InternalStreamTarget(manager, requestId)
                                          └─ AiService.executeStream(target, req, { signal })
                                               └─ streamText → ReadableStream<UIMessageChunk>
                                                    │
8. ←── Ai_StreamChunk ──── WebContentsListener ←── onChunk(广播至所有 listeners)
9. ←── Ai_StreamChunk ──── ...
                                                    │
                                               (流执行完成)
                                                    │
10. ←── Ai_StreamDone ──── WebContentsListener ←── onDone(广播至所有 listeners)
                             PersistenceListener.onDone:
                               messageService.create(assistant msg, status='success')
                               afterPersist?.(finalMessage)
                                                    │
                                               scheduleReap(gracePeriodMs)
```

### Steering(用户在生成期间连续发送消息)

```
Renderer                           Main
────────                           ────
流正在执行...

1. 用户输入第二条消息
2. transport.sendMessages()
   requestId2 = crypto.randomUUID()
3. streamOpen(IPC) ────────────→  handleStreamRequest(sender, req)
                                    │
                                    ├─ 去重: requestId2 不在 activeStreams → 继续
                                    ├─ 在事务中写入 user msg2(parentId = msg1.id)
                                    │
                                    └─ send() 检测到 topicToActiveRequest 存在活跃流(R1)
                                         → 进入 steer 流程, 不创建新流
                                         │
                                         ├─ pendingMessages.push(msg2)
                                         │   (agentLoop.prepareStep 在下次迭代时消费)
                                         │
                                         └─ addListener: 新的 WebContentsListener/PersistenceListener
                                              通过 topicId 执行 upsert 替换 → Map 大小不变
                                              PersistenceListener 的 parentUserMessageId
                                              更新为 msg2.id
```

### Reconnect(返回之前的对话)

```
Renderer                           Main
────────                           ────
1. 用户离开当前对话, WebContentsListener 被移除
   (或窗口关闭, 由 onWebContentsDestroyed 触发清理)
   流在 Main 中继续执行...

2. 用户重新打开该对话(或新建窗口)
   useChat mount → transport.reconnectToStream()
3. streamAttach(IPC) ──────────→ handleAttach(sender, req)
                                    │
                                    ├─ 查找: byRequestId(精确匹配) 或 byTopicId(观察者模式)
                                    │
                                    ├─ status == 'streaming':
                                    │   注册新的 WebContentsListener(sender, topicId)
                                    │   回放缓存: 将已有的所有 chunks 重新分发给新 listener
                                    │   → 返回 { status: 'attached', replayedChunks }
                                    │
                                    ├─ status == 'done':
                                    │   → 返回 { status: 'done', finalMessage }
                                    │   (Renderer 直接渲染完整结果, 无需流式传输)
                                    │
                                    └─ status == 'error':
                                        → 返回 { status: 'error', error }
```

### Abort(用户主动停止)

```
Renderer                           Main
────────                           ────
1. 用户点击停止
2. streamAbort(IPC) ───────────→ abort(requestId, 'user-requested')
                                    │
                                    ├─ stream.status = 'aborted'
                                    ├─ abortController.abort()
                                    │   → AbortSignal 传播至 executeStream
                                    └─ topicToActiveRequest.delete(topicId)

                                 (executeStream 捕获 AbortError)
                                    │
                                    └─ onDone(requestId, 'paused')
                                         PersistenceListener:
                                           存在 finalMessage → 写入数据库, status='paused'
                                           无 finalMessage → 跳过(与 v1 行为一致)
```

### 多窗口观察

```
窗口 A (发起者)                    窗口 B (观察者)
───────────────                    ───────────────
streamOpen(R1, topicA)
  → WebContentsListener(A) + PersistenceListener
                                   打开 topicA
                                   streamAttach({ mode: 'byTopicId', topicId: 'topicA' })
                                     → AiStreamManager 通过 topicToActiveRequest 查找 → R1
                                     → 注册 WebContentsListener(B, topicA)
                                     → 回放已有缓存

chunk 到达 → 广播:
  WebContentsListener(A).onChunk → A   WebContentsListener(B).onChunk → B
  同一个 chunk 同时到达两个窗口
```

### Channel / Agent 集成

Channel(Discord / Slack / 飞书)和 Agent scheduler 不经过 IPC —— 它们在 Main 内部直接调用 AiStreamManager:

```typescript
// ChannelMessageHandler
const requestId = crypto.randomUUID()
const userMessage = await messageService.create(topicId, { ... })
streamManager.startStream({
  requestId, topicId,
  request: buildStreamRequest(msg),
  listeners: [
    new ChannelAdapterListener(adapter, msg.chatId),
    new PersistenceListener({ topicId, parentUserMessageId: userMessage.id, ... })
  ]
})
```

**AiStreamManager 不区分发起来源**。不同场景的差异完全通过注册的 listeners 组合来表达:

| 场景 | 注册的 Listeners | 效果 |
|---|---|---|
| Renderer 用户发送消息 | WebContentsListener + PersistenceListener | 实时显示 + 持久化 |
| Channel bot 回复 | ChannelAdapterListener + PersistenceListener | IM 平台发送 + 持久化 |
| Channel 回复 + 用户同时查看 | ChannelAdapterListener + PersistenceListener + WebContentsListener | IM 发送 + 持久化 + 实时显示 |
| Agent 后台任务 | PersistenceListener(+ 可选 WebContentsListener) | 持久化(若 debug 面板打开则同时分发到 UI) |

## IPC 契约

### Request channels (Renderer → Main)

| Channel | Payload | 返回值 | 语义 |
|---|---|---|---|
| `Ai_Stream_Open` | `{ requestId, topicId, parentAnchorId, userMessage, assistantId, ... }` | `{ requestId, mode: 'started' \| 'steered' \| 'deduped' }` | 发送消息(AiStreamManager 自动判断是创建新流还是进入 steer 流程) |
| `Ai_Stream_Attach` | `{ mode: 'byRequestId', requestId }` 或 `{ mode: 'byTopicId', topicId }` | `{ status, requestId?, ... }` | reconnect(精确匹配 / 观察者模式) |
| `Ai_Stream_Detach` | `{ requestId }` | void | 取消订阅(流继续执行) |
| `Ai_Stream_Abort` | `{ requestId }` | void | 终止一次生成尝试 |

### Push channels (Main → Renderer)

| Channel | Payload | 说明 |
|---|---|---|
| `Ai_StreamChunk` | `{ topicId, chunk }` | 按 topicId 过滤 |
| `Ai_StreamDone` | `{ topicId, status: 'success' \| 'paused' }` | status 区分正常完成与被中止 |
| `Ai_StreamError` | `{ topicId, error }` | SerializedError |

**Request 使用 requestId, Push 使用 topicId** —— 控制平面与数据平面各自独立, 互不交叉。

## AiService 集成

AiStreamManager 对 AiService 的修改极少, 仅涉及三点:

1. **`executeStream` target 类型拓宽**: `Electron.WebContents` → `StreamTarget`。真实 WebContents 和 InternalStreamTarget 均满足该接口, 兼容路径完全不受影响
2. **新增 `options.signal`**: AiStreamManager 传入自身持有的 AbortSignal, executeStream 不再自行创建 AbortController。未提供 signal 时仍走兼容路径的 `registerRequest/removeRequest` 逻辑
3. **移除旧 IPC handler**(最终阶段): `Ai_StreamRequest` / `Ai_Abort` 在 AiStreamManager 完全就位后移除, Renderer 统一通过 `Ai_Stream_*` 通信

AiService 的职责收敛为: **纯粹的 AI 执行函数** —— 接收 target、request 和 signal, 执行模型调用, 将 chunks 写入 target。流的控制、路由、持久化全部由 AiStreamManager 负责。

## 持久化设计

### PersistenceListener

```
流结束
  → AiStreamManager.onDone(requestId, 'success')
    → 广播至所有 listeners
      → PersistenceListener.onDone({ finalMessage, status })
        │
        ├─ 无 finalMessage → 跳过(与 v1 handleFinish 行为一致)
        ├─ 存在 finalMessage:
        │   messageService.create(topicId, {
        │     role: 'assistant',
        │     parentId: parentUserMessageId,  // 显式指定, 不依赖 activeNodeId
        │     data: { parts: finalMessage.parts },
        │     status: 'success' 或 'paused'
        │   })
        │
        └─ status == 'success' && afterPersist 已定义?
             try { await afterPersist(finalMessage) } catch { logger.warn }
```

### afterPersist 钩子

流完成后的业务副作用通过 `afterPersist` 可选参数注入, 不直接编码在 PersistenceListener 内部:

```typescript
const persistenceSink = new PersistenceListener({
  topicId, assistantId, parentUserMessageId: userMessage.id,
  afterPersist: isAgentSession(topicId)
    ? async (finalMessage) => {
        await Promise.allSettled([
          maybeRenameAgentSession(req, finalMessage),
          maybeReportUsage(req, finalMessage),
        ])
      }
    : undefined
})
```

**约束**: `afterPersist` 采用 best-effort 策略 —— 执行失败仅记录警告, 不会重试。仅允许 UI 增强类副作用(自动重命名、标题生成)。若将来存在"必须保证执行"的副作用(计费、审计), 则需要引入 outbox + worker 机制。

### User message 在 Main 端事务写入

Renderer 不再自行持久化 user message(原有的 `streamingService.createUserMessage` 被移除)。流程:

1. Renderer 在 `Ai_Stream_Open` 请求中传递 `userMessage`(仅包含内容, 不含 id)和 `parentAnchorId`(显式父节点)
2. Main 端 `handleStreamRequest` 调用 `messageService.create` 在事务中写入 user message, 获得真实 SQLite id
3. 该 id 作为 `PersistenceListener.parentUserMessageId`, 确保 assistant 消息关联到正确的父节点

**为什么不在 Renderer 端写入**: 原有的 `streamingService.createUserMessage` 不传递 `parentId`, 依赖 `topic.activeNodeId` 自动解析 —— 多窗口同时操作同一 topic 时容易关联到错误的分支。Main 端使用 `parentAnchorId` 显式指定, 从根源上避免竞态条件。

## Grace Period 与 Reconnect 机制

```
流结束(done / error / aborted)
  → topicToActiveRequest.delete(topicId)
  → scheduleReap(gracePeriodMs = 30s)

grace period 期间:
  ActiveStream 仍保留在 activeStreams 中(包含 finalMessage + buffer)
  └─ 用户返回该对话 → streamAttach → 直接获取 finalMessage / error(无需查询数据库)

grace period 过期:
  activeStreams.delete(requestId)
  └─ 延迟到达的 attach → 返回 'not-found' → Renderer 通过 useQuery 从数据库读取
     (PersistenceListener 已完成持久化, 数据不会丢失)

停止后立即重试:
  startStream 检测到 topic 存在 done/aborted 状态的旧流(grace period 内)
  → evictStream(提前驱逐旧流) → 为新流让出位置
  → 用户体验: 响应迅速, 无阻塞
```

## 边界情况速查

| 情况 | 处理策略 |
|---|---|
| 流执行期间用户再次发送消息 | `send()` 路由到 steer —— 消息加入 `pendingMessages`, agentLoop 在下次迭代时消费 |
| 流结束后立即重试 | `startStream` 驱逐 grace period 内的旧流, 为新流让出位置 |
| 窗口关闭但流未结束 | `onWebContentsDestroyed` 自动清理 WebContentsListener; PersistenceListener 不受影响, 流执行完成后正常持久化 |
| 所有窗口关闭 + `backgroundMode='continue'` | 流继续执行, 完成后 PersistenceListener 持久化, 下次启动时从数据库读取 |
| 所有窗口关闭 + `backgroundMode='abort'` | `shouldStopStream()` 返回 true → executeStream 退出 → 流被中止 |
| 同一请求的网络重发 | requestId 命中 activeStreams → 注册 listener 并返回 deduped, 不重复执行 |
| 多窗口查看同一 topic | 各窗口拥有独立的 WebContentsListener(不同 wc.id, 相同 topicId), 同时接收实时 chunks |
| 同一窗口重复 Attach | listener id 稳定(`wc:X:topicId`), addListener 执行 upsert, 不会重复分发 |
| Buffer 溢出(超长流) | 超过 `maxBufferChunks` 后停止缓存(不停止流); 延迟 reconnect 仅能获取部分回放 |
| Main 进程重启 | activeStreams 被清空, Renderer attach 返回 'not-found', 通过数据库读取 |

## 待确认的产品决策

1. **`parentAnchorId` 并发语义**: 多窗口同时向同一 topic 发送消息时, 第二个请求的 `parentAnchorId` 可能已过时(第一个请求已在原 tip 下添加了新节点)。Main 会在原 tip 下创建兄弟分支。这属于缺陷(需要冲突检测)还是符合预期的行为(类似 git 的分叉语义)?待产品侧确认。
2. **`afterPersist` best-effort 边界**: 当前所有 post-persist 副作用(重命名、用量统计、索引)均采用 fire-and-forget 模式。若某项副作用的丢失构成业务问题(如计费), 则需升级为 outbox + worker 机制。当前阶段尚无此需求, 保留扩展点。
