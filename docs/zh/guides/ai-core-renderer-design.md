# aiCore 迁移 — Renderer 侧详细设计方案

> **对应后端文档**: [ai-core-migration.md](./ai-core-migration.md)（Person A: Main 侧）
>
> **本文档范围**: Person B 负责的 Renderer Transport + useChat 全部工作
>
> **分支**: `DeJeune/aicore-to-backend` (基于 v2)
>
> **IPC 通道 / Preload API / 共享 Schema**: 见后端文档 Step 2.1-2.2、Step 1.16

---

## 一、Renderer 侧现状问题

### V1 调用链路

```
Inputbar.sendMessage()
  → getUserMessage() 纯函数
  → dispatch(sendMessage thunk)
    → streamingService.createUserMessage()          ← Data API POST
    → dispatch(addMessage + upsertManyBlocks)       ← Redux
    → streamingService.createAssistantMessage()     ← Data API POST
    → topicQueue.add(fetchAndProcessAssistantResponseImpl)
        → AiProvider.completions()                  ← ⚠️ Renderer 直接发 HTTP
        → AiSdkToChunkAdapter → 30+ ChunkType       ← 自研流式协议
        → BlockManager.smartBlockUpdate (150ms + rAF)
        → StreamingService.updateBlock              ← 内存 cache + Redux 双写
        → [完成] streamingService.finalize()        ← Data API PATCH
```

### 问题清单

| 问题 | 影响 | V2 解决方案 |
|------|------|------------|
| AI 执行在 Renderer 进程 | API Key 暴露在 DevTools；长连接阻塞 UI 主线程 | 迁移到 Main 进程，Renderer 只做 IPC 通信 |
| 自研 Chunk 管线 (30+ ChunkType) | AiSdkToChunkAdapter + StreamProcessor + BlockManager + callbacks 共 50+ 文件 | 替换为 AI SDK 标准 UIMessageChunk |
| Redux 为唯一数据源 | 消息+block 规范化存储，streaming 期间高频 dispatch | useChat 管理实时状态，Redux 逐步退出消息渲染 |
| 双写持久化 | StreamingService 内存 cache + CacheService TTL + 完成时 Data API PATCH | onFinish 一次性持久化到 SQLite |
| 渲染耦合 block ID 查找 | Message.blocks 存 string[]，组件通过 selector 查 blockEntities | UIMessage.parts[] 内联数据，无需查找 |

---

## 二、目标架构

### V2 调用链路

```
Renderer                              Main
─────────                             ─────
Inputbar.sendMessage()
  → useAiChat.sendMessage()
    → IpcChatTransport.sendMessages()
      → ipcRenderer.invoke(Ai_StreamRequest)  ──→  AiService.ipcHandle()
      ← ipcRenderer.on(Ai_StreamChunk)        ←──    → AiCompletionService.streamText()
      → ReadableStream<UIMessageChunk>                  → executor.streamText()
    → useChat 内部状态更新                                ← UIMessageChunk stream
    → 组件直读 UIMessage.parts[]
    → [完成] onFinish → DataApi 持久化
```

### 架构对比

| 维度 | V1 (当前) | V2 (目标) |
|------|-----------|-----------|
| **AI 执行** | Renderer 进程 (HTTP 直连) | Main 进程 (IPC 通信) |
| **流式协议** | 30+ ChunkType + AiSdkToChunkAdapter | UIMessageChunk (AI SDK 标准) |
| **状态管理** | Redux (单一 Source of Truth) | useChat state (单一 Source of Truth) |
| **消息存储** | EntityAdapter\<Message\> + EntityAdapter\<MessageBlock\> | UIMessage\<METADATA, DATA_PARTS, TOOLS\>[] |
| **Block 存储** | 规范化 ID 引用 (Message.blocks → messageBlocks slice) | parts[] 内联 (无独立存储) |
| **渲染路径** | message.blocks.map(id → selector → Block组件) | message.parts.map(part → Part组件) |
| **节流** | BlockManager throttle 150ms + rAF per block | useChat experimental_throttle 50ms |
| **并发控制** | PQueue per topic (串行) | ChatSessionManager per topic + Main 侧管理 |
| **流实例生命周期** | 纯 JS 队列，不随 React 组件卸载销毁 | ChatSessionManager 服务层管理，组件卸载仅 release() |
| **持久化** | StreamingService.finalize() → Data API PATCH | onFinish → DataApi.messages.upsert() |
| **Renderer 文件数** | 50+ (aiCore/ + streaming/ + chunk/) | ~5 (transport + hook + 共享类型) |

### 渐进式策略

**为什么用适配层过渡，而非直接改渲染组件？**

V1 的渲染组件（MessageBlockRenderer, MessageOutline, MessageMenubar 等）深度依赖 Redux 的 `Message + MessageBlock` 数据模型。如果一步到位改为直读 `UIMessage.parts[]`，需要同时改动 ~15 个组件的 props/selector，且无法在改动过程中验证——必须全部改完才能跑起来。

适配层（`useV2MessageAdapter`）的价值在于：将 `UIMessage.parts[]` 转为旧的 `Message + MessageBlock[]` 格式，让现有组件零修改就能渲染 V2 数据。这样可以分步验证：先跑通管道（P0-P1），再接入现有页面（P1.5），再逐步替换数据来源（P3.2），最后删除适配层（P3.4）。

**为什么用 `useChat` 而非手动消费 `ReadableStream`？**

| 方案 | 优势 | 劣势 |
|------|------|------|
| 手动消费 stream | 完全控制状态更新逻辑 | 需要自己实现：消息拼装、节流、abort、error 恢复、乐观更新、部分渲染 |
| AI SDK `useChat` | 以上全部内置；`ChatTransport` 接口只需实现 stream 桥接 | 状态管理在 hook 内部，需要包装才能注入自定义逻辑 |

AI SDK `useChat` 是标准声明式方案，`ChatTransport` 接口将"如何获取 stream"与"如何管理 UI 状态"解耦。`IpcChatTransport` 只负责 IPC→ReadableStream 的桥接，其余交给 `useChat` 处理。这也是后端文档选择 UIMessageChunk 作为统一流式协议的原因。

**为什么用 React Context 而非 props drilling 做双轨切换？**

V2 的 `regenerate`/`resend` 操作需要路由到 `useAiChat`，但调用点在组件树深处（`MessageMenubar` → `useMessageOperations`），中间隔了 `Messages` → `MessageGroup` → `MessageItem` 三层。Props drilling 需要在每一层添加 prop 转发。Context 只需在 `V2ChatContent` 包一层 Provider，深层组件通过 `useContext` 直接消费，中间组件不感知。

---

## 三、核心文件设计

### 3.1 IpcChatTransport

**文件**: `src/renderer/src/transport/IpcChatTransport.ts`

**职责**: 实现 AI SDK `ChatTransport<UIMessage>` 接口，将 Electron IPC 消息桥接为 `ReadableStream<UIMessageChunk>`。

```typescript
export class IpcChatTransport implements ChatTransport<UIMessage> {
  sendMessages(options): Promise<ReadableStream<UIMessageChunk>>
  reconnectToStream(): Promise<null>  // Electron IPC 不支持重连
}
```

**核心机制**:

| 机制 | 实现 |
|------|------|
| 请求隔离 | 每次调用生成 `requestId = crypto.randomUUID()`，IPC listener 按 requestId 过滤 |
| Listener 注册时序 | 先注册 chunk/done/error listener，再 invoke streamText，防丢早期 chunk |
| Abort | `abortSignal` 触发时调用 `window.api.ai.abort(requestId)` + `controller.close()` |
| 清理 | `cleanup()` 函数移除所有 IPC listener，done/error/abort/cancel 四条路径均调用 |
| 防重入 | `isCleaned` + `isStreamClosed` 双标志位 |
| Body 透传 | `...body` 展开到 IPC 请求，preload 接受 `[key: string]: unknown` |

**生命周期**:

```
sendMessages() 调用
  ├─ 生成 requestId
  ├─ 注册 3 个 IPC listener (chunk/done/error) + abort handler
  ├─ invoke streamText (异步，不 await)
  ├─ ReadableStream 开始消费 chunk
  │
  ├─ [正常完成] onStreamDone → closeStream() → cleanup()
  ├─ [错误] onStreamError → errorStream() → cleanup()
  ├─ [用户中止] abortSignal → abort IPC + closeStream() → cleanup()
  └─ [Stream 取消] cancel() → abort IPC + cleanup()
```

**Singleton 设计**: Module-level 单例，stateless。多个 `useAiChat` 实例共享同一个 transport，通过 `requestId` 隔离互不干扰。

### 3.2 useAiChat Hook

**文件**: `src/renderer/src/hooks/useAiChat.ts`

**职责**: 封装 AI SDK `useChat`，注入 Cherry Studio 特有逻辑。

```typescript
export function useAiChat(options: UseAiChatOptions): UseAiChatReturn
```

**封装内容**:

| 关注点 | 实现 |
|--------|------|
| Transport | 共享 module-level `IpcChatTransport` singleton |
| 自定义类型 | `CherryUIMessage = UIMessage<{ totalTokens?: number }, CherryDataUIParts>` |
| 节流 | `experimental_throttle: 50` (ms)，平衡 streaming 流畅度与 React 渲染压力 |
| Body 注入 | `sendMessage` / `regenerate` 包装函数自动注入 `topicId` + `assistantId` |
| 持久化 | `onFinish` 回调 → V2ChatContent.handleFinish 持久化到 DataApi ✅ |
| 错误处理 | `onError` 回调 → V2ChatContent 通过 `window.toast.error()` 通知用户 ✅ |

**Body 合并策略**（低 → 高优先级）:

```
Transport 默认参数                      ← IpcChatTransport 构造函数（最低优先级）
  ↓ 被 Context 参数覆盖
Context 参数 (topicId, assistantId)    ← useAiChat 注入，每次请求都带
  ↓ 被 per-call body 覆盖
Per-call 参数 (files, mentionedModels) ← sendMessage 调用方传入（最高优先级）
```

即 Transport 中 `{ ...defaultBody, ...useChatBody }`，useAiChat 中 `{ topicId, assistantId, ...perCallBody }`。

### 3.3 useV2MessageAdapter（过渡层）

**文件**: `src/renderer/src/hooks/useV2MessageAdapter.ts`

**职责**: 将 AI SDK 的 `UIMessage.parts[]` 转换为旧的 `Message + MessageBlock[]` 格式，供未迁移的组件使用。

**生命周期**: P1.5 引入，P3.2 后逐步废弃，P3.4 删除。

```typescript
export function useV2MessageAdapter(
  uiMessages: CherryUIMessage[],
  chatStatus: ChatStatus,
  topicId: string,
  assistantId: string,
): { messages: Message[]; blockMap: Record<string, MessageBlock> }
```

**Part → Block 逐项映射**（与后端文档 Block→Part 方向互逆）:

#### TextUIPart → MainTextMessageBlock

```json
// 源 (AI SDK UIMessage.parts[])
{ "type": "text", "text": "Hello, world!", "state": "done" }

// 目标 (适配层输出)
{ "id": "msg-1-block-0", "messageId": "msg-1", "type": "main_text",
  "content": "Hello, world!", "status": "success" }
```

| 源字段 | 目标字段 | 说明 |
|--------|----------|------|
| `text` | `content` | 直接映射 |
| `state` | `status` | `streaming` → `STREAMING`，`done` → `SUCCESS` |

#### ReasoningUIPart → ThinkingMessageBlock

```json
// 源
{ "type": "reasoning", "text": "Let me think...", "state": "done" }

// 目标
{ "id": "msg-1-block-1", "type": "thinking",
  "content": "Let me think...", "thinking_millsec": 0, "status": "success" }
```

| 源字段 | 目标字段 | 说明 |
|--------|----------|------|
| `text` | `content` | 直接映射 |
| (无) | `thinking_millsec` | 固定为 0，streaming 期间无法获取 |

#### ToolUIPart → ToolMessageBlock

```json
// 源
{ "type": "tool-web_search", "toolCallId": "call_abc123",
  "state": "output-available", "toolName": "web_search",
  "input": { "query": "Cherry Studio" },
  "output": { "results": [...] } }

// 目标
{ "id": "msg-1-block-2", "type": "tool",
  "toolId": "call_abc123", "toolName": "web_search",
  "arguments": { "query": "Cherry Studio" },
  "content": { "results": [...] }, "status": "success" }
```

| 源字段 | 目标字段 | 说明 |
|--------|----------|------|
| `toolCallId` | `toolId` | 直接映射 |
| `toolName` 或 `type.replace('tool-','')` | `toolName` | `toolName` 仅存在于 `DynamicToolUIPart`；`ToolUIPart` 的工具名从 `type` 字段解析 |
| `input` | `arguments` | 直接映射 |
| `output` | `content` | 仅 `state === 'output-available'` 时 |
| `state` | `status` | `output-available` → SUCCESS, `input-available` → PROCESSING, `output-error`/`output-denied` → ERROR, 其他 → STREAMING |

#### FileUIPart → ImageMessageBlock / FileMessageBlock

```json
// 源 (图片)
{ "type": "file", "mediaType": "image/png", "url": "file:///path/to/image.png" }

// 目标
{ "id": "msg-1-block-3", "type": "image", "url": "file:///path/to/image.png" }
```

```json
// 源 (非图片文件)
{ "type": "file", "mediaType": "application/pdf", "url": "file:///path/to/doc.pdf", "filename": "doc.pdf" }

// 目标
{ "id": "msg-1-block-4", "type": "file",
  "file": { "id": "msg-1-block-4", "name": "doc.pdf", "origin_name": "doc.pdf",
            "path": "file:///path/to/doc.pdf", "type": "other", "size": 0, "ext": "", "count": 0 } }
```

| 源字段 | 目标字段 | 说明 |
|--------|----------|------|
| `mediaType` | (判断依据) | `startsWith('image/')` → IMAGE，否则 → FILE |
| `url` | IMAGE: `url`; FILE: `file.path` | 直接映射 |
| `filename` | `file.name`, `file.origin_name` | 默认 `'file'` |
| (无) | `file.type` | 固定为 `FILE_TYPE.OTHER`（适配层不做 MIME → FileType 推断） |

#### DataUIPart → 各自定义 Block

```json
// data-error
{ "type": "data-error", "data": { "name": "RateLimitError", "message": "Too many requests" } }
→ { "type": "error", "error": { "name": "RateLimitError", "message": "Too many requests", "stack": "" } }

// data-translation
{ "type": "data-translation", "data": { "content": "翻译内容", "targetLanguage": "chinese" } }
→ { "type": "translation", "content": "翻译内容", "targetLanguage": "chinese" }

// data-video
{ "type": "data-video", "data": { "url": "https://example.com/video.mp4" } }
→ { "type": "video", "url": "https://example.com/video.mp4" }

// data-compact
{ "type": "data-compact", "data": { "summary": "摘要内容", "removedCount": 5 } }
→ { "type": "compact", "content": "摘要内容", "compactedContent": "" }

// data-code
{ "type": "data-code", "data": { "language": "python", "code": "print('hello')" } }
→ { "type": "code", "content": "print('hello')", "language": "python" }
```

**Block ID 生成**: `{messageId}-block-{index}` — 确定性 ID，streaming 期间 block 增长时已有 block 的 ID 不变。

**时间戳缓存**: `useRef(new Map<string, string>())` 缓存每个 messageId 首次出现时的时间戳，避免 `useMemo` 重算时时间戳变化导致不必要的 re-render。

### 3.4 ChatSessionManager（流实例生命周期管理）

**文件**: `src/renderer/src/services/ChatSessionManager.ts`

**职责**: 在 React 组件之外管理 Chat 实例的生命周期，解决 topic 切换时流被中断的问题。

**设计背景**: V1 的流运行在纯 JS 队列（PQueue per topic）+ Redux，不依赖 React 组件挂载。V2 使用 AI SDK `useChat` hook，Chat 实例存在 `useRef` 中，组件卸载即销毁。最初的 keep-alive 方案（`display: none` + 同步 ref + reap timer）引入竞态条件，根基不稳。

**核心发现**: AI SDK 的 `AbstractChat` 是**纯 JS 类**，`@ai-sdk/react` 的 `Chat` 类公开导出，可在组件外实例化。`~registerMessagesCallback` 等方法兼容 `useSyncExternalStore`。

**架构**:

```
┌────── Service 层（React 之外）──────────────────────────┐
│  ChatSessionManager (单例)                               │
│    └── Map<topicId, ChatSession>                         │
│          ├── Chat 实例 (AI SDK)                          │
│          │     ├── messages[], status, error              │
│          │     └── IpcChatTransport → Main Process        │
│          ├── refCount (引用计数)                          │
│          ├── onFinish → DataApi 持久化                    │
│          └── isFulfilled (后台完成标记)                    │
├────── React 层（纯消费者）──────────────────────────────┤
│  V2ChatContent → useChatSession(topicId)                 │
│    ├── useSyncExternalStore 订阅 messages/status          │
│    ├── retain/release 管理引用计数                         │
│    └── 组件卸载 ≠ session 销毁                            │
└──────────────────────────────────────────────────────────┘
```

**核心类**:

| 类 | 职责 |
|---|---|
| `ChatSession` | 封装单个 `Chat` 实例 + 持久化逻辑 + 引用计数 + 完成标记 |
| `ChatSessionManager` | 全局注册表：`getOrCreate` / `retain` / `release` / `destroy`，含缓存 snapshot 和 LRU 驱逐 |

**生命周期**:
- 组件挂载 → `getOrCreate(topicId)` + `retain()` → refCount++
- 组件卸载 → `release()` → refCount-- → 若流还在跑，session 继续存活
- 流完成 + refCount=0 → 30 秒后 reap（LRU 上限 10 个空闲 session）
- 用户切回 → `getOrCreate` 返回同一个 session → 立即拿到最新 messages

**useSyncExternalStore 注意事项**:
- `subscribe` 和 `getSnapshot` 必须是箭头函数属性（稳定引用）
- `getSnapshot` 必须返回缓存对象（同一引用），在 `notify()` 时失效重建
- 违反以上任一条件会触发 "Maximum update depth exceeded" 无限循环

**V1 ↔ V2 对应关系**:

| V1 | V2 |
|---|---|
| PQueue per topic | ChatSession per topic |
| Redux `loadingByTopic` | `chatSessionManager.getStreamingTopicIds()` |
| Redux `fulfilledByTopic` | `chatSessionManager.getFulfilledTopicIds()` |
| `abortController.ts` | Chat 内置 AbortController |
| StreamingService 内存中间态 | Chat 实例原生管理 |
| 组件卸载无影响 | 组件卸载仅 `release()`，session 存活 |

### 3.5 useChatSession Hook

**文件**: `src/renderer/src/hooks/useChatSession.ts`

**职责**: React 消费 hook，通过 `useSyncExternalStore` 订阅 ChatSession。

```typescript
export function useChatSession(topicId: string, options: ChatSessionOptions): UseChatSessionReturn
```

| 关注点 | 实现 |
|--------|------|
| Session 获取 | `useMemo(() => chatSessionManager.getOrCreate(options), [topicId])` |
| 引用计数 | `useEffect` 中 `retain()` / `release()` |
| 消息订阅 | `useSyncExternalStore` + `~registerMessagesCallback(cb, 50ms)` |
| 状态订阅 | `useSyncExternalStore` + `~registerStatusCallback` |
| Body 注入 | `sendMessage` / `regenerate` 自动注入 `topicId` + `assistantId` |
| setMessages | 通过 `chat.messages = ...` setter |

### 3.6 CherryDataUIParts

**文件**: `packages/shared/ai-transport/dataUIParts.ts`

**职责**: 定义 Cherry Studio 自定义 DataUIPart 类型，作为 `CherryUIMessage` 的泛型参数。

与后端文档 Step 3.2 的 Zod schema 字段完全一致。Zod 在 Main 做运行时校验，interface 在 Renderer 做编译时类型检查。

```typescript
export interface CherryDataUIParts extends Record<string, unknown> {
  citation: { type: 'web' | 'knowledge' | 'memory'; sources: Array<...> }
  translation: { content: string; targetLanguage: string; sourceLanguage?: string }
  error: { name?: string; message: string; code?: string }
  video: { url: string; mimeType?: string }
  compact: { summary: string; removedCount: number }
  code: { language: string; code: string; filename?: string }
}
```

---

## 四、V2 渲染数据流设计

### 4.1 当前实现

```
ChatSessionManager (Service 层)
  └── ChatSession per topic
        └── Chat 实例 (AI SDK)
              ├─ messages: UIMessage[]     (Source of Truth)
              ├─ status: ChatStatus
              ├─ sendMessage / regenerate / stop
              └─ onFinish → DataApi 持久化 (脱离 React)

React 层:
  useChatSession(topicId)             (订阅 Chat 实例)
    ├─ messages → 区分 history vs live
    ├─ liveAdapted: Message[]        → 合并 historyMessages
    └─ partsMap → PartsContext       → 渲染组件直读 parts
```

**关键设计决策**:
- Chat 实例在 Service 层管理，组件卸载不销毁流
- Messages 组件通过 props 接收 `messages`，而非 Redux selector
- 持久化逻辑在 ChatSession 内运行，不依赖 React 组件状态

### 4.2 最终态（适配层删除后）

```
useAiChat
  ├─ messages: UIMessage[]
  │
  ↓
Messages 组件 (接收 UIMessage[])
  ↓
MessageGroup → MessageItem
  ↓
PartsRenderer (message.parts.map)
  ├─ type: 'text'       → TextPart
  ├─ type: 'reasoning'  → ReasoningPart
  ├─ type: 'tool-*'     → ToolPart
  ├─ type: 'file'       → FilePart
  ├─ type: 'data-*'     → DataPart (citation/translation/error/video/compact/code)
  └─ type: 'step-start' → StepDivider
```

**删除清单**:
- `useV2MessageAdapter.ts` — 适配层
- `V2BlockContext` — block 查找 context
- Redux `newMessages` slice 的消息渲染依赖（保留持久化通路）
- Redux `messageBlocks` slice（block 不再独立存储）

### 4.3 V2ChatContent 渲染组件

**文件**: `src/renderer/src/pages/home/V2ChatContent.tsx`

**职责**: V2 模式的渲染壳。通过 `useChatSession` 消费 ChatSession，组装 Messages + Inputbar。

**不再负责**: 流实例管理、keep-alive、持久化逻辑（已搬至 ChatSessionManager）。

**结构**:
- Outer shell: 加载历史（`useTopicMessagesV2`），等完成后 mount inner
- Inner: `useChatSession` 消费 ChatSession，合并 history + live，提供 PartsContext

**提供的 Context**:

| Context | Provider | 用途 |
|---------|----------|------|
| V2ChatOverridesContext | V2ChatOverridesProvider | 覆盖 regenerate/resend/delete/edit 操作路由 |
| PartsContext | PartsProvider | 提供 parts 数据给渲染组件 |

**数据传递**:
```typescript
<V2ChatOverridesProvider value={v2ChatOverrides}>
  <PartsProvider value={partsMap}>
    <Messages messages={adaptedMessages} ... />
    <Inputbar onSendV2={handleSendV2} ... />
  </PartsProvider>
</V2ChatOverridesProvider>
```

**Chat.tsx 渲染** (简化后):
```tsx
{USE_V2_CHAT ? (
  <V2ChatContent
    key={activeTopic.id}    // 正常卸载/挂载，流由 ChatSessionManager 管理
    assistant={assistant}
    topic={activeTopic}
    setActiveTopic={setActiveTopic}
    mainHeight={mainHeight}
  />
) : ( /* V1 路径不变 */ )}
```

---

## 五、V1/V2 双轨机制

### 5.1 开关控制

```typescript
// Chat.tsx — 唯一总开关
const USE_V2_CHAT = isDev && true
```

V2 行为完全封闭在 `V2ChatContent` 组件子树内。总开关为 false 时，整条 V1 链路不受任何影响。

### 5.2 隐式传播（非散落的 feature flag）

| 检测点 | 文件 | 方式 | 触发条件 |
|--------|------|------|----------|
| V2 发送 | Inputbar.tsx | `onSendV2` prop 存在性 | V2ChatContent 传入 |
| V2 操作覆盖 | useMessageOperations.ts | `useContext(V2ChatOverridesContext)` | V2ChatOverridesProvider 存在 |
| V2 block 读取 | Blocks/index.tsx | `useContext(V2BlockContext)` | V2BlockProvider 存在 |
| V2 消息来源 | Messages.tsx | `messages` prop 存在性 | V2ChatContent 传入 |

**所有检测点均通过 Context/props 隐式传播**，不需要组件自己检查 feature flag。当 `USE_V2_CHAT = false` 时，V2ChatContent 不渲染，以上所有 Context 均为 null/undefined，自动 fallback 到 V1 逻辑。

### 5.3 操作路由矩阵

| 操作 | V1 路径 | V2 路径 | 状态 |
|------|---------|---------|------|
| sendMessage | dispatch(sendMessage thunk) | useAiChat.sendMessage | ✅ |
| regenerate | dispatch(regenerateAssistantResponseThunk) | useAiChat.regenerate | ✅ |
| resend | dispatch(resendMessageThunk) | useAiChat.regenerate | ✅ |
| resendWithEdit | dispatch(resendUserMessageWithEditThunk) | v2.editMessage + v2.resend | ✅ |
| delete | dispatch(deleteSingleMessageThunk) | DataApi DELETE + setMessages | ✅ |
| clear | dispatch(clearTopicMessagesThunk) | DataApi cascade delete root + setMessages([]) | ✅ |
| pause | abortCompletion(askId) | useChat.stop() | ✅ |
| edit | dispatch(updateMessageAndBlocksThunk) | blocksToParts + DataApi PATCH + refresh | ✅ |
| translate | StreamingService + Redux | 待迁移（需 Main 翻译 IPC） | ⬜ |
| appendResponse | dispatch(appendAssistantResponseThunk) | 待迁移（需 Main 多模型并行） | ⬜ |

> ※ translate 和 appendResponse 需要后端新增 IPC 通道后才能迁移。

---

## 六、文件变动总览

### 新增文件

| 文件 | 说明 | 最终保留 |
|------|------|----------|
| `src/renderer/src/transport/IpcChatTransport.ts` | ChatTransport over IPC | ✅ |
| `packages/shared/ai-transport/schemas.ts` | Zod schema | ✅ |
| `packages/shared/ai-transport/dataUIParts.ts` | DataUIPart 类型 | ✅ |
| `packages/shared/ai-transport/index.ts` | barrel export | ✅ |
| `src/renderer/src/hooks/useAiChat.ts` | useChat 封装 | ✅ |
| `src/renderer/src/services/ChatSessionManager.ts` | 流实例生命周期管理（Service 层） | ✅ |
| `src/renderer/src/hooks/useChatSession.ts` | ChatSession React 消费 hook | ✅ |
| `src/renderer/src/hooks/useV2MessageAdapter.ts` | 过渡适配层 | ❌ 已删除 |
| `src/renderer/src/pages/home/V2ChatContent.tsx` | V2 渲染组件 | ✅ 演化 |
| `src/renderer/src/utils/blocksToparts.ts` | blocks→parts 反向转换（编辑用） | ❌ 删除（随 block 模型一起移除） |
| `src/renderer/src/pages/home/Messages/Blocks/V2Contexts.ts` | Parts Context 定义 | ✅ 演化 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `Chat.tsx` | V2 双轨开关 + V2ChatContent 条件渲染 |
| `Messages.tsx` | 新增可选 `messages` prop，V2 props 直传；移除 V2 clearTopic 守卫 |
| `Blocks/index.tsx` | V2BlockContext + PartsContext + 双轨 block 解析（context 定义提取到 V2Contexts.ts） |
| `CitationBlock.tsx` | V2 模式下从 block prop 直接格式化 citation，不走 Redux |
| `MainTextBlock.tsx` | 纯视图 props `{ id, content, isStreaming, citations, citationReferences, role, mentions }`，移除 Redux/useResolveBlock |
| `ImageBlock.tsx` | 纯视图 props `{ images, isPending, isSingle }`，移除 block 类型依赖 |
| `Markdown.tsx` | 新增 `MarkdownBlockContext` + `useMarkdownBlockContext()`，提供 content/isStreaming 给子组件 |
| `CodeBlock.tsx` | 消费 `useMarkdownBlockContext()` 替代 `useResolveBlock(blockId)` |
| `Table.tsx` | 消费 `useMarkdownBlockContext()`，`extractTableMarkdown` 接收 content 字符串 |
| `PartsRenderer.tsx` | text/image/data-code 直接路由；新增 `convertReferencesToCitations` 支持 V2 citation |
| `partsToBlocks.ts` | 导出 `convertReferencesToLegacyCitations`；新增 `convertReferencesToCitations` |
| `MessageOutline.tsx` | useV2BlockMap fallback |
| `MessageMenubar.tsx` | useV2BlockMap fallback |
| `Inputbar.tsx` | onSendV2 prop + V2 双轨发送 |
| `useMessageOperations.ts` | V2ChatOverridesProvider + pause/clearTopicMessages/editMessage/resend/regenerate/delete V2 分支 |
| `useAiChat.ts` | 新增 onError 回调选项 |

### 最终删除文件

| 目录/文件 | 说明 |
|----------|------|
| `src/renderer/src/aiCore/` | 整个目录（50+ 文件）|
| `src/renderer/src/services/messageStreaming/` | BlockManager, StreamingService, callbacks/ |
| `src/renderer/src/types/chunk.ts` | ChunkType 枚举 |
| `src/renderer/src/hooks/useV2MessageAdapter.ts` | 过渡适配层 |

---

## 七、实施计划

对应后端文档 Phase 2-3（Person B 职责部分）。

### Phase 0-1: 管道搭建 + Mock 验证 ✅

> 前置: Person A 完成 IPC Channel 定义 + Preload API (Step 2.1-2.2) ✅

**Step 0.3: IpcChatTransport** ✅

**文件**: `src/renderer/src/transport/IpcChatTransport.ts`

实现 `ChatTransport<UIMessage>` 接口。`sendMessages` 生成 requestId → 注册 IPC listener → invoke streamText → 返回 ReadableStream。详见第三章 3.1。

**Step 0.4: 共享 Schema** ✅

**实际路径**: `packages/shared/aiCore/transport/index.ts`（非文档中的 `packages/shared/ai-transport/`）

> ⚠️ 注：实际位置与原设计有偏差。仅有 `AiChatRequestBody` interface，`CherryDataUIParts` interface 和 Zod schema 尚未建立。

**Step 1.1: useAiChat hook** ✅

**文件**: `src/renderer/src/hooks/useAiChat.ts`

封装 `useChat` + IpcChatTransport singleton + body 自动注入。详见第三章 3.2。

**Step 1.2: TestChat 验证页面** ✅

**文件**: `src/renderer/src/pages/test-chat/TestChat.tsx` + route

临时页面，验证 IPC 管道端到端跑通。Phase 3.4 时删除。

**Step 1.3: 单元测试** ✅

- `src/renderer/src/transport/__tests__/IpcChatTransport.test.ts` ✅
- `src/renderer/src/hooks/__tests__/useAiChat.test.ts` ✅

### Phase 1.5: 适配层 + 现有页面接入 ✅

**Step 1.5.1: useV2MessageAdapter** ✅

**文件**: `src/renderer/src/hooks/useV2MessageAdapter.ts`

**Step 1.5.2: V2ChatContent 桥接组件** ✅

**文件**: `src/renderer/src/pages/home/V2ChatContent.tsx`

组装 `useAiChat` + `useV2MessageAdapter` + 现有 `Messages` + `Inputbar`。提供 `V2ChatOverridesProvider` 和 `V2BlockProvider` 两层 Context。详见第四章 4.3。

**Step 1.5.3: Chat.tsx 双轨开关** ✅

**文件**: `src/renderer/src/pages/home/Chat.tsx`

`const USE_V2_CHAT = isDev && true` 已添加，条件渲染 `V2ChatContent`。

### Phase 2: 联调 ✅

端到端验证通过（Grok provider 确认）。Main 侧 Mock 已移除，真实 streamText 输出工作。

### Phase 3.1: Inputbar 桥接 ✅

**Step 3.1.1-3.1.2**: useAiChat body 注入 + V2ChatContent 接入真实 Inputbar ✅

**Step 3.1.3**: Inputbar 双轨发送 ✅

`onSendV2?: (text, options) => void` prop 已实现。有 `onSendV2` 时走 V2 路径。

**Step 3.1.4**: Regenerate/Resend Context override ✅

`V2ChatOverrides` interface + `V2ChatOverridesContext` + `V2ChatOverridesProvider` 已实现于 `useMessageOperations.ts`。

### Phase 3.1b: 消息持久化 + 操作全链路 ✅

> 前置: P2 联调 ✅ + Data API 接口形态确定

**Step 3.1b.1: onFinish 持久化** ✅

`V2ChatContent.handleFinish` 在 assistant 流结束后将 user + assistant 消息持久化到 DataApi。区分新对话 vs regenerate/resend（已持久化 user 不重复创建），abort → paused 状态，error → 跳过持久化。

**Step 3.1b.2: 消息树语义对齐** ✅

parentId 链接、regenerate 不重复创建 user 节点、单条删除 vs 级联删除、setMessages 同步。

**Step 3.1b.3: initialMessages 加载** ✅

`useTopicMessagesV2` 从 DataApi 加载历史，`toUIMessage()` 转为 `CherryUIMessage[]`，V2ChatContent outer shell 等加载完成后才 mount inner（解决 useChat initialMessages 只读一次的问题）。

**Step 3.1b.4: 消息操作全链路** ✅

- `pause`: V2ChatOverrides → `useChat.stop()`
- `clearTopicMessages`: cascade delete root message + `setMessages([])` + refresh
- `editMessageBlocks`: `blocksToParts()` 反向转换 + DataApi PATCH + refresh（不用无效的 setMessages）
- `resendUserMessageWithEdit`: editMessage + resend 组合
- `onError`: `useAiChat` 新增 `onError` 回调，V2ChatContent 通过 `window.toast.error()` 通知用户

### Phase 3.2: 组件直读 + 去 Redux ✅

**Step 3.2.1: V2BlockContext** ✅

`V2BlockContext` + `V2BlockProvider` + `useV2BlockMap` 已实现于 `Blocks/index.tsx`。

**Step 3.2.2: MessageOutline / MessageMenubar 适配** ✅

`useV2BlockMap()` fallback 已实现。

**Step 3.2.3: Messages props 直传** ✅

`messages?: Message[]` prop 已添加，有值用 prop，无值 fallback Redux。

**Step 3.2.4: CitationBlock 去 Redux** ✅

- `CitationBlock.tsx`: V2 模式下直接用 block prop 调 `formatCitationsFromBlock(block)`，不走 Redux selector；`userMessageId` 用 `block.messageId` 替代 Redux message 查询
- `MainTextBlock.tsx`: V2 模式下从 V2BlockContext 按 `citationBlockId` 查找 citation block 并格式化
- 提取 `V2Contexts.ts` 消除 Blocks 子组件 → index.tsx 的循环依赖

### Phase 3.2b: Parts 直渲染（废弃 Block 类型系统）

> 前置: P3.2 ✅ — V2 渲染已完全绕过 Redux，但仍通过 partToBlock() 将 parts 转回 blocks 再渲染。
> 本阶段目标：Block 组件原地重构为纯视图 props 消费者，PartsRenderer 负责数据提取和路由。

**架构变化**:
```
当前（过渡态）:
  PartsContext[msgId] → partToBlock() → MessageBlock[] → Block 组件（依赖 block 类型）

目标态:
  PartsContext[msgId] → PartsRenderer（数据提取）→ 叶子组件（纯视图 props）
```

**实施策略**: 不使用双模式 `part?` prop，而是将组件重构为纯视图 props 接口。数据提取由 caller（PartsRenderer 或 MessageBlockRenderer 包装器）负责。V1 路径通过包装器（如 `MainTextBlockWithCitations`）适配新接口。

**Step 3.2b.1: PartsRenderer 组件** ✅

新建 `PartsRenderer.tsx`，从 PartsContext 读 parts，按 type 路由 + 连续同类分组（IMAGE、TOOL、VIDEO）。`MessageContent.tsx` 条件渲染：`isV2 ? <PartsRenderer> : <MessageBlockRenderer>`。未迁移类型 fallback 到 `partToBlock()` → `LegacyBlockSwitch`。

**Step 3.2b.2: Batch 1 — 稳定组件** ✅

| 组件 | 新 props | 说明 |
|------|----------|------|
| ThinkingBlock | `{ id, content, isStreaming, thinkingMs }` | 纯视图 |
| CompactBlock | `{ id, content, compactedContent }` | 纯视图 |
| TranslationBlock | `{ id, content, isStreaming }` | 纯视图 |

同时定义 `MarkdownSource { id, content, status }` 轻量接口，解耦 Markdown.tsx 对 Block 类型的依赖。

**Step 3.2b.3: Batch 2 — 需小幅适配** ✅

| 组件 | 新 props | 说明 |
|------|----------|------|
| MainTextBlock | `{ id, content, isStreaming, citations, citationReferences, role, mentions }` | 移除 Redux/useResolveBlock，citation 由 caller 解析 |
| ImageBlock | `{ images, isPending, isSingle }` | 图片 URL 由 caller 从 block/part 提取 |
| CodeBlock | 消费 `useMarkdownBlockContext()` | 替代 `useResolveBlock(blockId)`，Redux fallback 保留 |
| Table | 消费 `useMarkdownBlockContext()` | `extractTableMarkdown` 接收 content 字符串 |

新增 `MarkdownBlockContext`（在 Markdown.tsx 中），提供 `{ content, isStreaming }` 给子组件。
新增 `convertReferencesToCitations()`（在 partsToBlocks.ts 中），支持 web/knowledge/memory 三种 citation 类型解析。
V1 路径通过 `MainTextBlockWithCitations` 包装器（在 index.tsx 中）适配。
修复 `data-code` part 在 V2 渲染链中被 LegacyBlockSwitch 静默丢弃的问题。

**Step 3.2b.4: Batch 3 — 需 Main 侧协调** ⬜

阻塞于 Main 侧 Part 元数据补全。详见 dev-plan 中 Batch 3 可行性分析表。

| 组件 | 阻塞项 |
|------|--------|
| ToolBlock + MessageTools | `serverName/serverId/type` 需写入 `providerMetadata.cherry` |
| ErrorBlock | `statusCode/stack` 需写入 Part |
| CitationBlock | `DataUIPart<'citation'>` 类型不存在，需设计 |
| FileBlock | `size/created_at` 需写入 `providerMetadata.cherry` |
| VideoBlock | `startTime` 需加入 `VideoPartData` |

建议执行顺序: VideoBlock → ErrorBlock → FileBlock → ToolBlock → CitationBlock

**Step 3.2b.5: 清理（Batch 3 完成后）** ⬜

- MessageBlockRenderer 标记 deprecated（仅保留 V1 路径）
- V2Contexts.ts 清理 deprecated hooks（useResolveBlock 等）
- V2ChatContent 简化（移除 blocksToparts 依赖）
- Messages.tsx 事件处理器直读 partsMap

### Phase 3.3: Agent 统一

> 前置: Person A 完成 Phase 4（AgentStrategy 集成到 AiCompletionService）

**Step 3.3.1: useAiChat Agent 模式**

**修改文件**: `src/renderer/src/hooks/useAiChat.ts`

通过 body 传递 `agentConfig`，Agent 会话的 `chatId` 使用 `agent-session:{sessionId}` 前缀区分。

**Step 3.3.2: Agent DataUIPart 渲染**

**新建组件**: Agent 专属 DataUIPart 渲染组件

- `agent-permission` → 权限审批卡片（pending/approved/denied 三态）
- `agent-tool-use` → 工具执行详情（展开/折叠）
- `agent-session` → 会话信息头

**Step 3.3.3: 权限审批 UI**

**修改文件**: `src/renderer/src/hooks/useAiChat.ts`

使用 `useChat` 的 `addToolApprovalResponse` API，拦截 `agent-permission` part（state: pending），弹出审批 UI，用户操作后通过 API 回传结果。

### Phase 3.4: 旧代码清理

> 前置: P3.2 + P3.3 完成，所有功能在 V2 路径下验证通过

**Step 3.4.1: 删除 Renderer aiCore**

**删除**: `src/renderer/src/aiCore/` 整个目录（50+ 文件）

**Step 3.4.2: 删除 Streaming 管线**

**删除**: `src/renderer/src/services/messageStreaming/`（BlockManager, StreamingService, callbacks/）
**删除**: `src/renderer/src/types/chunk.ts`（ChunkType 枚举）

**Step 3.4.3: 删除过渡层**

**删除**: `src/renderer/src/hooks/useV2MessageAdapter.ts`
**删除**: `V2BlockContext` 相关代码（Blocks/index.tsx 中的 Context 定义和 fallback 逻辑）
**修改**: `Messages.tsx` 移除 `messages` prop 的 fallback 逻辑，直接接收 `UIMessage[]`

**Step 3.4.4: 清理引用**

**修改**: `src/renderer/src/services/ApiService.ts` — 移除 `fetchChatCompletion()` 及相关方法
**修改**: `electron.vite.config.ts` — 移除 renderer 的 `@cherrystudio/ai-core` alias
**操作**: 全局搜索 `from.*aiCore`、`ChunkType`、`BlockManager`、`AiSdkToChunkAdapter`，确认全部移除
**删除**: TestChat 页面 + test-chat 路由

---

## 八、测试策略

### 已有测试 (42 个)

| 测试文件 | 覆盖范围 | 数量 |
|----------|---------|------|
| `transport/__tests__/IpcChatTransport.test.ts` | chunk 过滤、done 关闭、error 传播、abort、listener 清理、body 透传、reconnect | 9 |
| `hooks/__tests__/useAiChat.test.ts` | config 传递、transport 注入、body 注入 (send/regenerate)、throttle、onError/onFinish 回调 | 14 |
| `utils/__tests__/blocksToparts.test.ts` | 全部 11 种 block→part 类型映射（含 TOOL/CITATION）、批量转换、round-trip 保留 | 19 |

### 待补充

| 测试 | 优先级 | 阻塞者 |
|------|--------|--------|
| 端到端持久化验证（发送 → 回复 → SQLite → 重新加载 → 编辑 → 删除） | P1 | 手动 dev 验证 |
| PartsRenderer 单元测试（10 tests ✅） | P2 | ✅ |
| Agent 模式端到端测试 | P3 | Phase 3.3 |

### 手动验证 Checklist

- V2 开关 off → V1 行为完全不受影响
- V2 开关 on → 真实模型通过 Inputbar 发送，回复正确渲染
- V2 regenerate/resend 通过 Context override 正确路由
- V2 pause 停止流式生成，assistant 以 paused 状态持久化
- V2 edit 编辑消息后 DataApi PATCH，refresh 后 UI 更新
- V2 resendWithEdit 编辑 + 重发组合
- V2 clear 清空对话（cascade 删根消息）
- V2 delete 单条/级联删除
- V2 onError stream 错误时显示 toast
- V2 Messages 通过 props 接收数据，不依赖 Redux dispatch
- V2 CitationBlock 通过 block prop 直接格式化 citation，不走 Redux selector
- V2 MainTextBlock 通过纯视图 props 接收 citations/content，不依赖 Redux 或 useResolveBlock
- renderer tests 全部通过
