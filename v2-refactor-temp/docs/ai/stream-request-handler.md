# StreamRequestHandler 重构方案

## 问题

`AiStreamManager` 从纯粹的流注册表逐渐退化为业务逻辑集散地：

```
AiStreamManager（当前）
├── Registry + Multicast + Lifecycle     ← 正确职责
├── handleNormalChatStream               ← 业务：topic → assistant → model 解析
├── handleAgentSessionStream             ← 业务：session → agent → model 解析
├── mentionedModelIds 解析 + 循环展开    ← 业务：多模型展开
├── isRegenerate + 跳过 user message    ← 业务：regenerate 判断
├── getChildrenByParentId + siblingsGroupId ← 业务：siblings 继承
├── buildAiStreamRequest                 ← 业务：构建 AI 请求
└── agentMessageRepository 调用          ← 业务：agent 持久化
```

**后果**：
- 每加一个功能（多模型、regenerate、agent），AiStreamManager 膨胀
- 业务逻辑和流管理混在一起，难以测试
- 两个开发者同时改 AiStreamManager → 频繁冲突

## 方案

### 职责分离

```
IPC (Ai_Stream_Open)
  ↓
AiStreamManager.onInit()          ← IPC 注册 + 创建 subscriber
  ↓
StreamRequestHandler.handle()     ← 所有业务逻辑
  ↓
AiStreamManager.startExecution()  ← 纯 registry API
```

### AiStreamManager — 只保留 registry + multicast + lifecycle

```typescript
class AiStreamManager extends BaseService {
  // ── IPC (thin delegation) ──
  onInit() {
    this.ipcHandle(Ai_Stream_Open, (event, req) => {
      const subscriber = new WebContentsListener(event.sender, req.topicId)
      return this.requestHandler.handle(this, subscriber, req)
    })
    this.ipcHandle(Ai_Stream_Attach, (event, req) => this.handleAttach(event.sender, req))
    this.ipcHandle(Ai_Stream_Detach, (event, req) => this.handleDetach(event.sender, req))
    this.ipcHandle(Ai_Stream_Abort, (_, req) => this.abort(req.topicId, 'user-requested'))
  }

  // ── Registry ──
  startExecution(input): ActiveStream
  send(input): { mode: 'started' | 'steered' }
  steer(topicId, message): boolean

  // ── Listener management ──
  addListener(topicId, listener): boolean
  removeListener(topicId, listenerId): void

  // ── Lifecycle ──
  abort(topicId, reason): void
  onStop(): Promise<void>  // graceful shutdown

  // ── Multicast (InternalStreamTarget callbacks) ──
  onChunk(topicId, modelId, chunk): void     // 广播，带 sourceModelId
  onExecutionDone(topicId, modelId): void
  onExecutionError(topicId, modelId, error): void

  // ── Query ──
  shouldStopExecution(topicId, modelId): boolean
  setExecutionFinalMessage(topicId, modelId, message): void

  // ── Attach/Detach (简单，留在这里) ──
  handleAttach(sender, req): AiStreamAttachResponse
  handleDetach(sender, req): void
}
```

**删除的方法**：
- ~~`handleStreamRequest`~~
- ~~`handleNormalChatStream`~~
- ~~`handleAgentSessionStream`~~
- ~~`buildAiStreamRequest`~~

### StreamRequestHandler — 所有业务逻辑

```typescript
class StreamRequestHandler {
  /**
   * Entry point — resolve context, persist messages, build listeners, dispatch executions.
   * 
   * @param manager  Registry API (startExecution/send)
   * @param subscriber  Topic-level subscriber (WebContentsListener created by IPC handler)
   * @param req  IPC request payload
   */
  async handle(
    manager: AiStreamManager,
    subscriber: StreamListener,
    req: AiStreamOpenRequest
  ): Promise<AiStreamOpenResponse> {
    if (isAgentSessionTopic(req.topicId)) {
      return this.handleAgentSession(manager, subscriber, req)
    }
    return this.handleNormalChat(manager, subscriber, req)
  }
}
```

## 多模型设计

### 核心原则：1 个 subscriber，N 次 dispatch

多模型不需要 N 个 WebContentsListener。只需要 1 个 topic 级别的 subscriber，它收到所有 chunks 并标记来源。

#### ActiveStream.isMultiModel 静态标记

多模型判断必须是**创建时确定的静态标记**，不能用 `executions.size > 1` 动态判断。
原因：第一个 execution 的 chunks 到达时第二个可能还没 start → `size === 1` →
误判为单模型 → chunks 不带 modelId → 混入主 useChat。

```typescript
interface ActiveStream {
  // ... existing fields ...
  /** 创建时由 handler 设置，不可变。决定 onChunk 是否带 sourceModelId。 */
  isMultiModel: boolean
}
```

handler 创建时设置：
```typescript
// StreamRequestHandler
manager.startExecution({
  topicId,
  modelId: models[0].uniqueModelId,
  request: requests[0],
  listeners,
  siblingsGroupId,
  isMultiModel: models.length > 1  // 静态，不变
})
```

#### 后端：onChunk 传 sourceModelId

```typescript
// StreamListener 接口
interface StreamListener {
  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void
  onDone(result: StreamDoneResult): void | Promise<void>
  onError(error, partialMessage?, modelId?, isTopicDone?): void | Promise<void>
  isAlive(): boolean
}

// AiStreamManager.onChunk — 纯广播 + 按 isMultiModel 决定是否带 source 标签
onChunk(topicId: string, modelId: UniqueModelId, chunk: UIMessageChunk): void {
  for (const listener of stream.listeners.values()) {
    listener.onChunk(chunk, stream.isMultiModel ? modelId : undefined)
  }
}

// WebContentsListener — 纯转发，标记 executionId
onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void {
  wc.send(Ai_StreamChunk, {
    topicId: this.topicId,
    executionId: sourceModelId,  // 单模型: undefined, 多模型: modelId
    chunk
  })
}
```

**不需要**：
- ~~`listener.executionId` 字段~~ — listener 不做过滤
- ~~后端 `onChunk` 的 executionId 判断~~ — 全量广播
- ~~N 个 WebContentsListener~~ — 1 个就够
- ~~SubscriberFactory~~ — 不需要动态创建
- ~~`executions.size` 动态判断~~ — 用静态 `isMultiModel` 标记

#### 前端：transport 按 executionId 分流

```typescript
// IpcChatTransport.buildListenerStream(topicId, executionId?)
//
// executionId 规则：
// - undefined (主 useChat): 只接受无 executionId 的事件（单模型）
//                           或 isTopicDone 的事件（多模型结束）
// - 'model-a' (ExecutionStreamCollector): 只接受 executionId='model-a' 的事件
const matchesStream = (data) => {
  if (data.topicId !== topicId) return false
  if (executionId) return data.executionId === executionId || data.isTopicDone
  return !data.executionId || !!data.isTopicDone
}
```

#### 前端：ExecutionStreamCollector

```typescript
// 每个 @mentioned model 一个 headless 组件
// 各自有独立 useChat + ExecutionTransport（过滤自己的 chunks）
<ExecutionStreamCollector
  topicId={topicId}
  executionId="dashscope::glm-5"
  onMessages={handleExecutionMessages}
/>
```

#### StreamRequestHandler 里的多模型展开

```typescript
private async handleNormalChat(manager, subscriber, req) {
  const context = await this.resolveTopicContext(req.topicId)
  const userMessage = await this.resolveUserMessage(req, context)
  const models = this.resolveModels(req.mentionedModelIds, context.modelId)
  const siblingsGroupId = await this.resolveSiblingsGroupId(models, req.trigger, userMessage.id)

  // 构建 listeners：1 个 subscriber + N 个 PersistenceListener
  const listeners: StreamListener[] = [subscriber]
  for (const model of models) {
    listeners.push(new PersistenceListener({
      topicId: req.topicId,
      parentUserMessageId: userMessage.id,
      modelId: model.uniqueModelId,
      modelSnapshot: { id: model.rawModelId, name: model.rawModelId, provider: model.providerId },
      siblingsGroupId
    }))
  }

  // 并行构建请求
  const requests = await Promise.all(
    models.map(model => this.buildStreamRequest(req.topicId, context.assistantId, model.uniqueModelId, userMessage.id))
  )

  // 第一个创建 ActiveStream，后续添加 execution
  const isMultiModel = models.length > 1
  manager.startExecution({ topicId: req.topicId, modelId: models[0].uniqueModelId, request: requests[0], listeners, siblingsGroupId, isMultiModel })
  for (let i = 1; i < models.length; i++) {
    manager.startExecution({ topicId: req.topicId, modelId: models[i].uniqueModelId, request: requests[i], listeners: [], siblingsGroupId, isMultiModel })
  }

  return { mode: 'started', executionIds: models.length > 1 ? models.map(m => m.uniqueModelId) : undefined }
}
```

## Regenerate 设计

### 前端

```typescript
// V2ChatContent
regenerate: async (messageId) => {
  // 不删除旧 assistant — 新版本作为 sibling 创建
  await regenerateWithCapabilities(messageId)
}
```

AI SDK `regenerate()` → 截断 messages 到 user → `sendMessages({ trigger: 'regenerate-message' })`

### Transport

```typescript
// IpcChatTransport.sendMessages
trigger: trigger,  // 传给后端
parentAnchorId: trigger === 'regenerate-message' ? lastMessage?.id : body.parentAnchorId
```

### StreamRequestHandler

```typescript
private async resolveUserMessage(req, context) {
  if (req.trigger === 'regenerate-message') {
    // Regenerate: 复用已有 user message
    return messageService.getById(req.parentAnchorId)
  }
  // Submit: 创建新 user message
  return messageService.create(req.topicId, {
    role: 'user', parentId: req.parentAnchorId, data: { parts: req.userMessageParts }, ...
  })
}

private async resolveSiblingsGroupId(models, trigger, userMessageId) {
  if (models.length > 1) return Date.now()  // 多模型：新 group
  if (trigger === 'regenerate-message') {
    // Regenerate：继承或创建 siblings group
    const children = await messageService.getChildrenByParentId(userMessageId)
    const existingGroup = children.find(m => m.siblingsGroupId > 0)?.siblingsGroupId
    const groupId = existingGroup ?? Date.now()
    // 更新 siblingsGroupId=0 的旧 sibling
    for (const child of children) {
      if (child.siblingsGroupId === 0) {
        await messageService.updateSiblingsGroupId(child.id, groupId)
      }
    }
    return groupId
  }
  return undefined  // 单模型提交：无 group
}
```

## IPC 契约变更

### AiStreamOpenRequest

```typescript
interface AiStreamOpenRequest {
  topicId: string
  trigger?: 'submit-message' | 'regenerate-message'
  parentAnchorId?: string
  userMessageParts: CherryMessagePart[]
  mentionedModelIds?: UniqueModelId[]
}
```

### StreamChunkPayload

```typescript
interface StreamChunkPayload {
  topicId: string
  executionId?: string    // sourceModelId — 前端据此分流
  chunk: UIMessageChunk
}
```

### StreamDonePayload

```typescript
interface StreamDonePayload {
  topicId: string
  executionId?: string
  status: 'success' | 'paused'
  isTopicDone?: boolean   // true = 所有 execution 结束
}
```

### StreamErrorPayload

```typescript
interface StreamErrorPayload {
  topicId: string
  executionId?: string
  isTopicDone?: boolean
  error: SerializedError
}
```

## 文件结构

```
src/main/ai/stream-manager/
├── AiStreamManager.ts            registry + multicast + lifecycle（~250 行）
├── StreamRequestHandler.ts       业务逻辑：解析、持久化、展开（~200 行）
├── InternalStreamTarget.ts       不变
├── types.ts                      接口定义
├── index.ts                      barrel export
└── listeners/
    ├── WebContentsListener.ts    纯转发，1 个/topic
    ├── PersistenceListener.ts    per-model 持久化
    └── AgentPersistenceListener.ts  agent DB 持久化
```

## StreamListener 接口变更

```typescript
interface StreamListener {
  readonly id: string
  // 不再有 executionId 字段 — listener 不做过滤

  /** chunk + 来源 model（多模型时有值，单模型时 undefined） */
  onChunk(chunk: UIMessageChunk, sourceModelId?: UniqueModelId): void

  /** 流结束 */
  onDone(result: StreamDoneResult): void | Promise<void>

  /** 流报错 */
  onError(
    error: SerializedError,
    partialMessage?: UIMessage,
    modelId?: UniqueModelId,
    isTopicDone?: boolean
  ): void | Promise<void>

  isAlive(): boolean
}
```

## PersistenceListener 多模型过滤

`PersistenceListener` 需要知道自己负责哪个 model：

```typescript
class PersistenceListener {
  // 多模型：只在 result.modelId === this.ctx.modelId 时持久化
  onDone(result: StreamDoneResult) {
    if (result.modelId && this.ctx.modelId && result.modelId !== this.ctx.modelId) return
    // 持久化
  }
}
```

`WebContentsListener` 不需要过滤 — 它收到所有事件，全部转发，前端分流。

## 数据流全景

### 单模型

```
sendMessage → IPC → StreamRequestHandler
  → resolveContext → createUserMessage → buildListeners([WCL, PL])
  → manager.startExecution(1 execution)
  → stream chunks → onChunk(topicId, modelId, chunk) → WCL.onChunk(chunk, modelId) → IPC
  → stream done → onExecutionDone → broadcastDone → WCL.onDone + PL.onDone → 持久化
```

### 多模型 (@3 models)

```
sendMessage → IPC → StreamRequestHandler
  → resolveContext → createUserMessage
  → resolveModels([m1, m2, m3])
  → buildListeners([WCL, PL(m1), PL(m2), PL(m3)])
  → manager.startExecution(m1, listeners=[WCL, PL(m1), PL(m2), PL(m3)])
  → manager.startExecution(m2, listeners=[])
  → manager.startExecution(m3, listeners=[])
  
  → m1 chunk → onChunk(topicId, m1, chunk) → WCL.onChunk(chunk, m1) → IPC {executionId: m1}
  → m2 chunk → onChunk(topicId, m2, chunk) → WCL.onChunk(chunk, m2) → IPC {executionId: m2}
  
  → m1 done → broadcastDone(isTopicDone=false)
    → WCL.onDone({modelId: m1, isTopicDone: false}) → IPC (前端 per-execution stream 关闭)
    → PL(m1).onDone → 持久化 m1 的 assistant
    → PL(m2).onDone → modelId 不匹配，跳过
    → PL(m3).onDone → modelId 不匹配，跳过
  
  → m3 done → broadcastDone(isTopicDone=true)
    → WCL.onDone({modelId: m3, isTopicDone: true}) → IPC (前端主 stream 关闭 → refreshAndReplace)
    → PL(m3).onDone → 持久化 m3 的 assistant
```

### Regenerate

```
regenerate(messageId) → AI SDK 截断 → sendMessages({trigger: 'regenerate-message'})
  → IPC → StreamRequestHandler
    → resolveUserMessage: getById(parentAnchorId)  // 不创建新 user
    → resolveSiblingsGroupId: 继承或创建
    → startExecution → 新 assistant 作为 sibling 持久化
```

## 迁移步骤

1. 创建 `StreamRequestHandler.ts`，从 `AiStreamManager` 提取业务方法
2. `StreamListener.onChunk` 加 `sourceModelId` 参数
3. 删除 `listener.executionId` 字段
4. `AiStreamManager.onChunk` 改为纯广播 + 传 sourceModelId
5. `WebContentsListener` 简化为纯转发
6. `AiStreamManager` 的 IPC handler 委托给 `StreamRequestHandler`
7. 更新测试
8. 验证单模型、多模型、regenerate、agent session
