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
| **并发控制** | PQueue per topic (串行) | useChat 单请求 + Main 侧管理 |
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
| 持久化 | `onFinish` 回调 (TODO P3.1b，等 Data API 接口确定) |
| 错误处理 | `onError` 记录日志 (TODO P3.1b，接入统一通知) |

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

### 3.4 CherryDataUIParts

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

### 4.1 当前实现（过渡态）

```
useAiChat
  ├─ messages: UIMessage[]      (Source of Truth)
  ├─ status: ChatStatus
  ├─ sendMessage / regenerate / stop
  │
  ↓
useV2MessageAdapter             (过渡转换层)
  ├─ messages: Message[]         → Messages 组件 props 直传
  └─ blockMap: Record<string, MessageBlock>
       ↓
       V2BlockContext            → MessageBlockRenderer / MessageOutline / MessageMenubar
```

**关键设计决策**: Messages 组件通过 props 接收 `messages`，而非 Redux selector。这消除了双状态源——useChat 是唯一 Source of Truth，适配层是纯转换函数。

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

### 4.3 V2ChatContent 桥接组件

**文件**: `src/renderer/src/pages/home/V2ChatContent.tsx`

**职责**: V2 模式的顶层容器，组装 useAiChat + adapter + Messages + Inputbar。

**提供的 Context**:

| Context | Provider | 用途 |
|---------|----------|------|
| V2ChatOverridesContext | V2ChatOverridesProvider | 覆盖 regenerate/resend 操作路由 |
| V2BlockContext | V2BlockProvider | 提供 block 数据给渲染组件 |

**数据传递**:
```typescript
<V2ChatOverridesProvider value={{ regenerate, resend }}>
  <V2BlockProvider value={blockMap}>
    <Messages messages={adaptedMessages} ... />  // props 直传
    <Inputbar onSendV2={handleSendV2} ... />
  </V2BlockProvider>
</V2ChatOverridesProvider>
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
| resendWithEdit | dispatch(resendUserMessageWithEditThunk) | editBlocks + useAiChat.regenerate | ✅ |
| delete | dispatch(deleteSingleMessageThunk) | 待迁移 → useChat.setMessages | ⬜ ※ |
| clear | dispatch(clearTopicMessagesThunk) | 待迁移 → useChat.setMessages([]) | ⬜ ※ |
| pause | abortCompletion(askId) | 待迁移 → useChat.stop() | ⬜ |
| edit | dispatch(updateMessageAndBlocksThunk) | 待迁移 → useChat.setMessages | ⬜ ※ |
| translate | StreamingService + Redux | 待迁移 | ⬜ |
| appendResponse | dispatch(appendAssistantResponseThunk) | 待迁移 (多模型) | ⬜ |

> ※ V2 模式下 Messages 通过 props 接收数据（来源 useChat），不读 Redux 消息 slice。当前 delete/clear/edit 仅操作 Redux，对 V2 渲染无效果。最终态下这些操作将直接操作 `useChat.setMessages`。

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
| `src/renderer/src/hooks/useV2MessageAdapter.ts` | 过渡适配层 | ❌ 删除 |
| `src/renderer/src/pages/home/V2ChatContent.tsx` | V2 桥接组件 | 演化（合入 Chat.tsx） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `Chat.tsx` | V2 双轨开关 + V2ChatContent 条件渲染 |
| `Messages.tsx` | 新增可选 `messages` prop，V2 props 直传 |
| `Blocks/index.tsx` | V2BlockContext + 双轨 block 解析 |
| `MessageOutline.tsx` | useV2BlockMap fallback |
| `MessageMenubar.tsx` | useV2BlockMap fallback |
| `Inputbar.tsx` | onSendV2 prop + V2 双轨发送 |
| `useMessageOperations.ts` | V2ChatOverridesProvider + regenerate/resend V2 分支 |

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

### Phase 0-1: 管道搭建 + Mock 验证

> 前置: Person A 完成 IPC Channel 定义 + Preload API (Step 2.1-2.2)

**Step 0.3: IpcChatTransport**

**新建文件**: `src/renderer/src/transport/IpcChatTransport.ts`

实现 `ChatTransport<UIMessage>` 接口。`sendMessages` 生成 requestId → 注册 IPC listener → invoke streamText → 返回 ReadableStream。详见第三章 3.1。

**Step 0.4: 共享 Schema + DataUIPart**

**新建目录**: `packages/shared/ai-transport/`

- `schemas.ts` — AiStreamRequest Zod schema（与后端文档 Step 1.16 同步）
- `dataUIParts.ts` — CherryDataUIParts interface（6 种自定义类型）
- `index.ts` — barrel export

**Step 1.1: useAiChat hook**

**新建文件**: `src/renderer/src/hooks/useAiChat.ts`

封装 `useChat` + IpcChatTransport singleton + body 自动注入。详见第三章 3.2。

**Step 1.2: TestChat 验证页面**

**新建文件**: `src/renderer/src/pages/test-chat/TestChat.tsx` + route

临时页面，直接使用 `useAiChat` 渲染 `UIMessage.parts[]`，验证 IPC 管道端到端跑通。Phase 3.4 时删除。

**Step 1.3: 单元测试**

**新建文件**:
- `src/renderer/src/transport/__tests__/IpcChatTransport.test.ts` — Mock `window.api.ai`，验证 stream 消费、requestId 隔离、abort、listener 清理
- `src/renderer/src/hooks/__tests__/useAiChat.test.ts` — Mock useChat + transport，验证 body 注入、config 传递

### Phase 1.5: 适配层 + 现有页面接入

**Step 1.5.1: useV2MessageAdapter**

**新建文件**: `src/renderer/src/hooks/useV2MessageAdapter.ts`

纯函数 + `useMemo`，将 `UIMessage.parts[]` 转为 `Message[] + blockMap`。Part→Block 逐项映射详见第三章 3.3。

**Step 1.5.2: V2ChatContent 桥接组件**

**新建文件**: `src/renderer/src/pages/home/V2ChatContent.tsx`

组装 `useAiChat` + `useV2MessageAdapter` + 现有 `Messages` + `Inputbar`。提供 `V2ChatOverridesProvider` 和 `V2BlockProvider` 两层 Context。详见第四章 4.3。

**Step 1.5.3: Chat.tsx 双轨开关**

**修改文件**: `src/renderer/src/pages/home/Chat.tsx`

添加 `const USE_V2_CHAT = isDev && true`，条件渲染 `V2ChatContent` 或原有 V1 内容区。详见第五章 5.1。

### Phase 2: 联调

> 前置: Person A 完成 Phase 1（AiService + AiCompletionService 接真实 aiCore）

**操作**: 移除 Main 侧 AiService 中的 Mock handler，`IpcChatTransport` 无需修改——IPC 协议不变，只是 Main 侧从 mock 输出变为真实 streamText 输出。端到端验证：Inputbar 发送 → 真实模型回复 → 现有组件正确渲染。

### Phase 3.1: Inputbar 桥接

**Step 3.1.1: useAiChat body 注入**

**修改文件**: `src/renderer/src/hooks/useAiChat.ts`

`sendMessage` / `regenerate` 包装函数自动将 `topicId` + `assistantId` 注入 body，per-call 参数（files, mentionedModels）shallow merge 在上层。

**Step 3.1.2: V2ChatContent 接入真实 Inputbar**

**修改文件**: `src/renderer/src/pages/home/V2ChatContent.tsx`

替换 stub input 为真实 `Inputbar` 组件，`handleSendV2` 桥接 `useAiChat.sendMessage`。

**Step 3.1.3: Inputbar 双轨发送**

**修改文件**: `src/renderer/src/pages/home/Inputbar/Inputbar.tsx`

新增 `onSendV2?: (text, options) => void` prop。`sendMessage` 函数内部：有 `onSendV2` 时走 V2 路径（调回调 + 清空输入 + 恢复焦点），否则走原有 Redux thunk 路径。

**Step 3.1.4: Regenerate/Resend Context override**

**修改文件**: `src/renderer/src/hooks/useMessageOperations.ts`

新增 `V2ChatOverrides` interface + `V2ChatOverridesContext` + `V2ChatOverridesProvider`。`useMessageOperations` 内部通过 `useContext` 检测 V2 模式：`resendMessage`、`regenerateAssistantMessage`、`resendUserMessageWithEdit` 三个函数在 V2 模式下调用 override 而非 dispatch thunk。

### Phase 3.1b: 消息持久化

> 前置: P2 联调 + Data API 接口形态确定

**Step 3.1b.1: onFinish 持久化**

**修改文件**: `src/renderer/src/hooks/useAiChat.ts`

`onFinish` 回调中将完成的 `UIMessage` 通过 DataApi 持久化到 SQLite。需要确定：消息 ID 是 Renderer 生成还是 Main 生成？`UIMessage.id` 是否可直接作为 DB 主键？

**Step 3.1b.2: 消息树语义对齐**

**修改文件**: `src/renderer/src/hooks/useAiChat.ts`

V1 的消息树用 `askId`（用户消息 ID）关联一组助手回复。V2 的 `UIMessage` 无此字段。需要与 Data API 设计对齐：
- user 消息与 assistant 消息的 parentId 关系
- user/assistant 消息的创建时机（V1 先创建再填充 vs V2 streaming 完成后一次写入）
- abort/error 状态下是否持久化、持久化什么状态

**Step 3.1b.3: initialMessages 加载**

**修改文件**: `src/renderer/src/pages/home/V2ChatContent.tsx`

Topic 切换时从 DataApi 加载历史消息，转为 `CherryUIMessage[]` 传入 `useAiChat({ initialMessages })`（hook 内部映射为 AI SDK `useChat` 的 `messages` 参数，即受控初始状态）。需要实现 DB parts → UIMessage 的反向转换（与 adapter 方向相反）。

### Phase 3.2: 组件直读 + 去 Redux

**Step 3.2.1: V2BlockContext**

**修改文件**: `src/renderer/src/pages/home/Messages/Blocks/index.tsx`

新增 `V2BlockContext` (React Context) + `V2BlockProvider` (export Provider) + `useV2BlockMap` (export hook)。`MessageBlockRenderer` 内部：`const blockEntities = v2Blocks ?? reduxBlockEntities`，有 Context 时用 Context，否则 fallback Redux。

**Step 3.2.2: MessageOutline / MessageMenubar 适配**

**修改文件**: `MessageOutline.tsx`, `MessageMenubar.tsx`

同样模式：`useV2BlockMap()` 获取 Context，`v2Blocks ?? reduxBlockEntities` 替代直接 `useSelector`。下游 `blockEntities` 变量名不变，所有叶子组件透明兼容。

**Step 3.2.3: Messages props 直传**

**修改文件**: `src/renderer/src/pages/home/Messages/Messages.tsx`

新增可选 `messages?: Message[]` prop。有值时直接使用，无值时 fallback 到 `useTopicMessages(topic.id)` 读 Redux。

**修改文件**: `src/renderer/src/pages/home/V2ChatContent.tsx`

`<Messages messages={adaptedMessages} />` 传入，删除原有 `useEffect` Redux dispatch 同步逻辑。

**Step 3.2.4: CitationBlock 去 Redux**

**修改文件**: `CitationBlock.tsx`, `MainTextBlock.tsx`

Citation 数据通过 props 传递而非 Redux 查找。需要真实数据验证 citation part 的结构，确认映射正确后再实施。

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

### 已有测试 (18 个)

| 测试文件 | 覆盖范围 | 数量 |
|----------|---------|------|
| `transport/__tests__/IpcChatTransport.test.ts` | chunk 过滤、done 关闭、error 传播、abort、listener 清理、body 透传、reconnect | 9 |
| `hooks/__tests__/useAiChat.test.ts` | config 传递、transport 注入、body 注入 (send/regenerate)、throttle 配置 | 9 |

### 待补充

| 测试 | 优先级 | 阻塞者 |
|------|--------|--------|
| `useV2MessageAdapter` 单元测试 — 每种 part type 的映射正确性 | P1 | 无 |
| `V2ChatContent` 集成测试 — props 直传 + Context 注入 | P2 | 无 |
| 端到端持久化测试 (发送 → 回复 → SQLite → 重新加载) | P3 | P2 联调 + P3.1b |
| Agent 模式端到端测试 | P4 | Phase 4 |

### 手动验证 Checklist

- V2 开关 off → V1 行为完全不受影响
- V2 开关 on → Mock 数据通过 Inputbar 发送，mock 回复正确渲染
- V2 regenerate/resend 通过 Context override 正确路由
- V2 Messages 通过 props 接收数据，不依赖 Redux dispatch
- V2 block 渲染通过 V2BlockContext 提供数据
- renderer tests 全部通过
