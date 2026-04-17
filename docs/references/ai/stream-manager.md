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
├── types.ts                        所有接口和 IPC payload 定义
├── InternalStreamTarget.ts         AiService 的 StreamTarget 适配器
├── AiStreamManager.ts              lifecycle 服务(多播 + 生命周期管理)
├── context/                        按 topicId 命名空间分发的 Provider
│   ├── ChatContextProvider.ts          Provider 接口定义
│   ├── dispatch.ts                     Ai_Stream_Open → canHandle 命中的 Provider
│   ├── PersistentChatContextProvider.ts  裸 uuid → SQLite (MessageService)
│   ├── TemporaryChatContextProvider.ts   内存 (TemporaryChatService)
│   ├── AgentChatContextProvider.ts       `agent-session:` → agents DB
│   └── modelResolution.ts              resolveModels / resolveSiblingsGroupId 共享
├── listeners/
│   ├── WebContentsListener.ts      将 chunks 分发到 Renderer 窗口
│   ├── PersistenceListener.ts      流结束时将 assistant 消息写入 SQLite
│   ├── TemporaryPersistenceListener.ts   流结束时将 assistant 消息 append 到 TemporaryChatService
│   ├── AgentPersistenceListener.ts       流结束时写入 agents DB
│   ├── ChannelAdapterListener.ts   将回复文本发送到 Discord / Slack / 飞书
│   └── SSEListener.ts              API Server 的 SSE transport
└── index.ts                        barrel export
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

### 内置实现

| Listener | 职责 | id | isAlive | onChunk | onDone |
|---|---|---|---|---|---|
| **WebContentsListener** | 将 chunks 分发到 Renderer | `wc:${wc.id}:${topicId}` | `!wc.isDestroyed()` | `wc.send(Ai_StreamChunk)` | `wc.send(Ai_StreamDone)` |
| **PersistenceListener** | 流结束时写入 SQLite（update pending placeholder） | `persistence:${topicId}:${modelId}` | 始终为 `true` | 不处理 | `messageService.update` + `afterPersist` 钩子 |
| **TemporaryPersistenceListener** | 流结束时 append 到内存（简化模式） | `temp-persistence:${topicId}:${modelId}` | 始终为 `true` | 不处理 | `temporaryChatService.appendMessageWithId` |
| **AgentPersistenceListener** | 流结束时写入 agents DB | `agent-persistence:${sessionId}` | 始终为 `true` | 不处理 | `agentMessageRepository.persistAssistantMessage` |
| **ChannelAdapterListener** | 将文本发送到 IM 平台 | `channel:${channelId}:${chatId}` | `adapter.connected` | 累积文本 + `onTextUpdate` | `onStreamComplete` / `sendMessage` |
| **SSEListener** | API Server SSE 透传 | `sse:${uuid}` | `!res.writableEnded` | `res.write` | `res.write [DONE]` |

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
  constructor(manager: ManagerCallbacks, topicId: string, modelId: UniqueModelId)

  send(channel, payload) → onChunk (topic-level), onExecutionDone / onExecutionError (per-execution)
  isDestroyed()          → manager.shouldStopExecution(topicId, modelId)
  setFinalMessage(msg)   → manager.setExecutionFinalMessage(topicId, modelId, msg)
}
```

绑定 `topicId` + `modelId`。chunks 是 topic 级别广播(所有 listener 都收到);done/error/stop 是 per-execution 级别(精确到哪个模型)。

## StreamExecution: 单个模型的执行状态

```typescript
interface StreamExecution {
  modelId: UniqueModelId           // "providerId::modelId"
  abortController: AbortController // 独立 abort — 多模型时互不影响
  status: 'streaming' | 'done' | 'error' | 'aborted'
  finalMessage?: CherryUIMessage
  error?: SerializedError
  siblingsGroupId?: number         // 多模型: 共享的组 id
  sourceSessionId?: string         // Claude Agent SDK resume token
}
```

## ActiveStream: topic 级别的流状态

```typescript
interface ActiveStream {
  topicId: string
  executions: Map<UniqueModelId, StreamExecution>  // 单模型: 1 条; 多模型: N 条
  listeners: Map<string, StreamListener>           // 所有 execution 共享
  pendingMessages: PendingMessageQueue             // 所有 execution 共享
  buffer: UIMessageChunk[]                         // 所有 execution 的 chunks 混合缓存
  status: 'streaming' | 'done' | 'error' | 'aborted'  // 从 executions 派生
  reapAt?: number
  reapTimer?: ReturnType<typeof setTimeout>
}
```

Topic 状态从 executions 派生:
- 任一 execution 仍在 streaming → topic 状态 = `'streaming'`
- 全部 done → `'done'`
- 全部 aborted → `'aborted'`
- 有 error 且无 streaming → `'error'`

## 多模型问答

用户通过 @mentions 触发多个模型并行回复同一条消息:

```
用户: "解释量子力学" @gpt-4o @claude-sonnet

handleStreamRequest:
  1. 持久化 user message
  2. 检测 mentionedModels = [openai::gpt-4o, anthropic::claude-sonnet]
  3. siblingsGroupId = 生成共享组 id
  4. 对每个模型调 startExecution:
     startExecution({ topicId, modelId: 'openai::gpt-4o', siblingsGroupId, ... })
     startExecution({ topicId, modelId: 'anthropic::claude-sonnet', siblingsGroupId, ... })
  5. 两个 execution 在同一个 ActiveStream 里并行运行
  6. chunks 混合广播给所有 listener (UI 通过 part id 区分)
  7. PersistenceListener 为每个 execution 的 onDone 各持久化一条 assistant 消息
     (共享 siblingsGroupId,UI 渲染为并列回复)
```

单模型场景下只有 1 个 execution,零额外开销。

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
                                    └─ 6. send() → startExecution()
                                          │
                                          ├─ 创建 ActiveStream + StreamExecution
                                          ├─ activeStreams.set(topicId, stream)
                                          ├─ target = InternalStreamTarget(manager, topicId, modelId)
                                          └─ AiService.executeStream(target, req, signal)
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
                                    ├─ streaming: 注册新 listener + 回放压缩后的缓存 chunks
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
                                       → 回放压缩后的缓存 chunks

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
| API Server SSE | inline listener + PersistenceListener | SSE 推送 + 持久化 |

### API Server 订阅

API Server 的 SSE endpoint 不需要专门的 listener 类 — 用 inline `StreamListener` 直接写 SSE response：

```typescript
// API handler 内联 listener — SSE 只是一种 transport
const sseListener: StreamListener = {
  id: `sse:${requestId}`,
  onChunk(chunk) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  },
  onDone() {
    res.write('data: [DONE]\n\n')
    res.end()
  },
  onError(error) {
    res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`)
    res.end()
  },
  isAlive() {
    return !res.writableEnded
  }
}

aiStreamManager.startExecution({
  topicId, modelId, request,
  listeners: [sseListener, persistenceListener]
})
```

设计原则：
- **API Server 不直接调 AI SDK**。所有 AI 调用通过 AiStreamManager（流式）或 AiCompletionService（非流式）
- **API Server 不管流生命周期**。它是 listener，不是 controller
- **同一 topic 的所有消费者共享同一个流**。API Client + Renderer + Channel 可同时订阅
- **旧 `POST /v1/chat/completions` 待迁移**。`chatCompletionService` 应退化为 OpenAI ↔ Cherry 格式转换层，底层调 AiStreamManager

## IPC 契约

### Request channels (Renderer → Main)

| Channel | Payload | 返回值 | 语义 |
|---|---|---|---|
| `Ai_Stream_Open` | `{ topicId, parentAnchorId, userMessageParts }` | `{ mode: 'started' \| 'steered' }` | 发送消息(自动判断创建新流或 steer)。Main 从 topicId 推导 assistantId/provider/model |
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

## ChatContextProvider: 按 topicId 命名空间分发

`Ai_Stream_Open` 请求进入 Main 后,由 `dispatchStreamRequest`（`context/dispatch.ts`，内联的模块级函数）转交给对应的 `ChatContextProvider`:

```typescript
interface ChatContextProvider {
  readonly name: string
  canHandle(topicId: string): boolean
  handle(manager, subscriber, req): Promise<AiStreamOpenResponse>
}
```

所有"解析 topic → 写 user message → 组装 listeners → 调用 `startExecution`"的业务逻辑都收敛在各自的 Provider 里。`AiStreamManager` 完全不感知 topic 类型,它只是一个按 `topicId` 管理 ActiveStream 的注册表。

### 内置 Provider

| Provider | canHandle | 数据层 | User 消息 | Assistant 消息 | 备注 |
|---|---|---|---|---|---|
| **AgentChatContextProvider** | `topicId.startsWith('agent-session:')` | `agentMessageRepository` | 预先写入 | `AgentPersistenceListener` onDone 写入 | 用 `manager.send` 触发(支持 steering) |
| **TemporaryChatContextProvider** | `temporaryChatService.hasTopic(topicId)` | `TemporaryChatService` 内存 Map | append (status=success) | `TemporaryPersistenceListener` onDone `appendMessageWithId` | 单模型,不支持 regenerate / 多模型 |
| **PersistentChatContextProvider** | `true` (默认兜底) | `messageService` + SQLite | 事务写入（`create`） | `PersistenceListener` onDone `update` pending placeholder | 支持多模型、regenerate、自动重命名 |

路由顺序固定（见 `context/dispatch.ts` 中的 `providers` 数组）:Agent → Temporary → Persistent。临时 Provider 的 `canHandle` **不用前缀判断**而用 `hasTopic()` —— persist 后 `temp:` 前缀的 id 仍留在 SQLite,但不再属于临时 Provider,这种"归属权"的交接只能通过 service 状态准确表达。

### 简化 vs 完整持久化路径

| | Persistent | Temporary |
|---|---|---|
| user message | 流开始前事务写入 SQLite | 流开始前 `appendMessageWithId` (内存) |
| assistant placeholder | 流开始前写入 `status: pending` | **不创建** |
| 流进行中 | Renderer 直接订阅 chunks,placeholder 已可见 | Renderer 直接订阅 chunks,尚无 DB 行 |
| 流结束 | `PersistenceListener.onDone` → `messageService.update` | `TemporaryPersistenceListener.onDone` → `temporaryChatService.appendMessageWithId` |
| 预分配 id | placeholder 的 SQLite 主键 | Provider 在 `handle` 中用 `crypto.randomUUID()` 预分配,传给 `AiStreamRequest.messageId` |

Temp 选择"流结束一把 append"是因为临时话题天然不可变、不支持分支、不需要让用户在生成期间看到一条 pending DB 行。这简化了 service:不必新增 `update` 方法,`appendMessage` 既是唯一的写路径也是唯一的状态迁移。

### Renderer 侧接入

前端通过 `useTemporaryTopic(assistantId)` 租用临时 topic:

```typescript
const { topicId, ready, reset } = useTemporaryTopic(assistant.id)

useChat({ id: topicId ?? 'pending-temp', transport: ipcChatTransport, ... })

// 发送消息时检查 ready, ready 为 true 前不发送。
// 组件 unmount 或 reset() 时自动 DELETE /temporary/topics/:id。
```

典型场景:划词助手(ActionGeneral / ActionTranslate)、迷你窗快速提问(HomeWindow)。这些场景**不应**出现在用户的正式聊天历史里。

## AiService 集成

AiStreamManager 对 AiService 的修改极少:

1. **`executeStream` target 类型拓宽**: `Electron.WebContents` → `StreamTarget`
2. **新增 `options.signal`**: AiStreamManager 传入自身持有的 AbortSignal

AiService 的职责收敛为纯粹的 AI 执行函数 —— 接收 target、request 和 signal,执行模型调用,将 chunks 写入 target。流的控制、路由、持久化全部由 AiStreamManager 负责。

## 持久化设计

### User message 在 Main 端事务写入

Renderer 不再自行持久化 user message。流程:

1. Renderer 在 `Ai_Stream_Open` 请求中传递 `userMessage`(仅包含内容, 不含 id)和 `parentAnchorId`(显式父节点)
2. Main 端 `handleStreamRequest` 调用 `messageService.create` 在事务中写入 user message, 获得真实 SQLite id
3. 该 id 作为 `PersistenceListener.parentUserMessageId`, 确保 assistant 消息关联到正确的父节点

为什么不在 Renderer 端写入: 原有的 `streamingService.createUserMessage` 不传递 `parentId`, 依赖 `topic.activeNodeId` 自动解析 —— 多窗口同时操作同一 topic 时容易关联到错误的分支。Main 端使用 `parentAnchorId` 显式指定, 从根源上避免竞态条件。

### PersistenceListener

```
流结束
  → AiStreamManager.onDone(topicId, 'success')
    → 广播至所有 listeners
      → PersistenceListener.onDone({ finalMessage, status })
        │
        ├─ 无 finalMessage → 跳过(与 v1 handleFinish 行为一致)
        ├─ 存在 finalMessage:
        │   messageService.create(topicId, {
        │     role: 'assistant',
        │     parentId: parentUserMessageId,
        │     data: finalMessage,
        │     status: 'success' 或 'paused'
        │   })
        │
        └─ status == 'success' && afterPersist 已定义?
             try { await afterPersist(finalMessage) } catch { logger.warn }
```

### afterPersist 钩子

流完成后的业务副作用通过 `afterPersist` 可选参数注入, 不直接编码在 PersistenceListener 内部:

```typescript
const persistenceListener = new PersistenceListener({
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
| 中途订阅 | attach 返回压缩后的 bufferedChunks，随后继续接 live tail |
| Main 进程重启 | activeStreams 清空,Renderer 通过数据库读取 |

## 设计备注

**`afterPersist` best-effort 边界**: 当前所有 post-persist 副作用(重命名、用量统计)均采用 fire-and-forget 模式。若将来某项副作用的丢失构成业务问题(如计费), 需升级为 outbox + worker 机制。当前阶段尚无此需求, 保留扩展点。
