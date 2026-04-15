# aiCore 迁移 — Renderer 侧设计方案（以 migration 文档为准）

> **唯一目标方案**: [ai-core-migration.md](./ai-core-migration.md)
>
> **本文档范围**: 只展开 `ai-core-migration.md` 中 Person B 负责的 Renderer Transport + `useChat` 工作。
>
> **执行原则**: Renderer 侧方案不得新增 migration 文档之外的独立阶段、替代架构或长期过渡目标。当前仓库若存在与本文冲突的实现，以 migration 文档和本文为准。

---

## 一、范围

本文只覆盖 migration 文档中已经定义的 Renderer 主线：

- `Phase 2: IPC 通道 + AiStreamBroker 架构`
- `Phase 3: Renderer useChat 接入（普通聊天）`
- `Phase 4: Agent 功能完善 + 清理`
- `两人分工总览` 中 Person B 的文件边界

本文不单独定义 migration 文档之外的额外 phase。

---

## 二、Renderer 侧总原则

| 领域 | 统一方案 |
|---|---|
| 历史消息 | `useQuery('/topics/:id/messages')`，真源是 DataApi / SQLite |
| 活跃流 | 官方 `useChat({ id: topicId, transport })` |
| 流式协议 | `UIMessageChunk` |
| 消息渲染 | `UIMessage.parts[]` |
| 持久化 | Main 侧 `PersistenceSink` / `MessagePersistenceService` |
| 唯一稳定标识 | `topicId` |
| 普通聊天与 Agent | 同一 AI 执行链，不保留两套前端协议 |

### 2.1 明确禁止的方向

以下方向不再作为 Renderer 目标方案存在：

- `ChatSessionManager`
- `useChatSession`
- Renderer `onFinish` 落库或完成态裁决
- Renderer 保活 `Chat` 实例或维护 session registry
- 用 `requestId` 作为流路由 key
- 把历史消息通过 `initialMessages` 或等价方式重新灌回 `useChat`
- 保留 Agent 独立 SSE client / parser / datasource
- 保留自建 tool approval 状态机或自定义 permission part 作为主链方案

### 2.2 当前必须收敛的偏差（2026-04-14 更新）

| 偏差 | migration 文档要求 | 状态 |
|---|---|---|
| `IpcChatTransport.reconnectToStream()` 返回 `null` | 必须接 Main `Ai_Stream_Attach`，实现真实 reconnect | ✅ 已修复 |
| Chat 生命周期仍在 Renderer | 活跃流生命周期归 Main `AiStreamManager` | ✅ 已完成 |
| 完成态仍依赖 Renderer `onFinish` | 完成态由 Main 持久化，Renderer 不配置 `onFinish` | ✅ 已完成 |
| 普通聊天仍夹带 legacy streaming 逻辑 | 收敛到 `useChat` + `IpcChatTransport` + `UIMessage.parts[]` | ✅ 已完成 |
| Agent 页面仍保留独立 SSE 链路 | Phase 4 统一到同一 `useChat` / `UIMessageChunk` 主链 | ✅ 已完成（`AgentChat` 使用 `useChatWithHistory`，`useAgentSessionParts` 替代旧 datasource） |
| tool approval 仍走自建 Redux + IPC 回路 | 切换到 AI SDK 原生 ToolUIPart approval 语义 | ❌ 未开始（Agent 和 MCP 审批仍走 Redux `toolPermissions` + IPC `respondToPermission`） |

---

## 三、Phase 2：IPC 通道 + AiStreamBroker 架构

### 3.1 IPC 契约

Renderer 侧只对齐 migration 文档定义的 broker 通道：

| Channel | 方向 | 用途 |
|---|---|---|
| `Ai_Stream_Open` | Renderer → Main | 新开流，或向已有流发送新消息 |
| `Ai_Stream_Attach` | Renderer → Main | 按 `topicId` attach / reconnect 到活动流 |
| `Ai_Stream_Detach` | Renderer → Main | 主动退订，不 abort 整条流 |
| `Ai_Stream_Abort` | Renderer → Main | 按 `topicId` abort 整条流 |
| `Ai_StreamChunk` | Main → Renderer | 按 `topicId` 推送 chunk |
| `Ai_StreamDone` | Main → Renderer | 流结束 |
| `Ai_StreamError` | Main → Renderer | 流错误 |

`topicId` 是唯一稳定路由 key。Renderer 侧不再额外生成 `requestId`。

### 3.2 Preload API

`src/preload/index.ts` 和 `src/preload/preload.d.ts` 只暴露 migration 文档定义的 `ai` API：

```typescript
ai: {
  streamOpen: (req) => ipcRenderer.invoke(IpcChannel.Ai_Stream_Open, req),
  streamAttach: (req) => ipcRenderer.invoke(IpcChannel.Ai_Stream_Attach, req),
  streamDetach: (req) => ipcRenderer.invoke(IpcChannel.Ai_Stream_Detach, req),
  streamAbort: (req) => ipcRenderer.invoke(IpcChannel.Ai_Stream_Abort, req),
  onStreamChunk: (cb) => ipcRenderer.on(IpcChannel.Ai_StreamChunk, (_, data) => cb(data)),
  onStreamDone: (cb) => ipcRenderer.on(IpcChannel.Ai_StreamDone, (_, data) => cb(data)),
  onStreamError: (cb) => ipcRenderer.on(IpcChannel.Ai_StreamError, (_, data) => cb(data)),
}
```

Renderer 不再暴露按 `requestId` 操作的旧接口。

### 3.3 `IpcChatTransport`

**文件**: `src/renderer/src/transport/IpcChatTransport.ts`

目标是让 `IpcChatTransport` 成为 migration 文档中的官方 `ChatTransport` 桥接层，而不是状态管理器。

```typescript
export class IpcChatTransport implements ChatTransport<UIMessage> {
  sendMessages(options): Promise<ReadableStream<UIMessageChunk>>
  reconnectToStream(options): Promise<ReadableStream<UIMessageChunk> | null>
}
```

**职责**

- `sendMessages()` 走 `Ai_Stream_Open`
- `reconnectToStream()` 走 `Ai_Stream_Attach`
- `cancel` 走 detach 语义，对齐 `Ai_Stream_Detach`
- 显式 abort 走 `Ai_Stream_Abort`
- 按 `topicId` 过滤 `chunk` / `done` / `error`
- 先注册 listener，再发起 invoke
- 在 `done` / `error` / `abort` / `cancel` 时统一 cleanup

**明确不做**

- 不缓存消息
- 不保活 `Chat`
- 不做完成态持久化
- 不模拟 session registry
- 不再依赖 `requestId`

### 3.4 Phase 2 对 Renderer 的直接结果 ✅ 已全部完成

- ✅ `reconnectToStream()` 是真实实现，通过 `Ai_Stream_Attach` 接入 Main
- ✅ 活跃流与历史消息分离
- ✅ `useChat` 的 resume 能力依赖 Main `AiStreamManager`
- ✅ 普通用户流与 channel push 流共享同一套 Manager 机制

---

## 四、Phase 3：Renderer useChat 接入（普通聊天）

### 4.1 安装依赖

按 migration 文档执行：

```bash
pnpm add @ai-sdk/react
```

### 4.2 自定义 DataUIPart schema

**文件**: `packages/shared/ai-transport/dataUIParts.ts`

按 migration 文档定义以下自定义 DataUIPart：

- `citation`
- `translation`
- `video`
- `compact`
- `code`
- `error`

Renderer 只消费 shared 中定义的 schema，不在页面层重新定义最终语义。

### 4.3 `useChat` 调用约定

普通聊天最终直接使用官方 `useChat`，不再以自定义 hook 作为目标架构。

```typescript
const chat = useChat({
  id: topicId,
  transport,
})
```

调用点要求按 migration 文档对齐：

- 历史消息走 `useQuery('/topics/:id/messages')`
- 活跃流走 `useChat({ id: topicId, transport })`
- `chat.sendMessage(text, { body: { providerId, modelId, assistantConfig } })`
- `chat.regenerate()`
- `chat.stop()`
- `chat.status`
- Renderer 不在 `useChat` 里配置 `onFinish`

### 4.4 `Chat.tsx` 与页面边界

**文件**: `src/renderer/src/pages/home/Chat.tsx`

`Chat.tsx` 按 migration 文档只承担以下职责：

- 加载历史消息
- 挂接 `useChat`
- 发送消息
- 重新生成
- 停止生成
- 消费 `chat.status`
- 组合历史消息与活跃流的展示

`Chat.tsx` 不承担：

- 持久化
- 完成态裁决
- `Chat` 实例保活
- Renderer 自建流管理

### 4.5 消息渲染

**文件**

- `src/renderer/src/pages/home/Messages/Message.tsx`
- `src/renderer/src/pages/home/Messages/MessageGroup.tsx`
- `src/renderer/src/pages/home/Messages/Messages.tsx`

渲染方向按 migration 文档改为直读 `UIMessage.parts[]`：

- `text`
- `reasoning`
- `tool-*`
- `file`
- `data-*`

Renderer 侧不再把 `BlockManager` / `ChunkType` / `AiSdkToChunkAdapter` 作为目标设计的一部分。

### 4.6 Phase 3 需要删除的旧代码（2026-04-15 更新）

普通聊天和 Agent 聊天主链均已完成。V2 聊天链路（`useChat` + `useChatWithHistory` + `IpcChatTransport`）不再依赖以下代码：

| 目录/文件 | 状态 | 说明 |
|---|---|---|
| `src/renderer/src/services/messageStreaming/` (12 files) | ✅ 已删除 | 整目录连同 V1 消费方一并清理：`BlockManager` / `StreamingService` / `callbacks/*` 以及 `StreamProcessingService`、`ConversationService`、`ApiService.transformMessagesAndFetch/fetchChatCompletion/fetchImageGeneration/collectImagesFromMessages/getRotatedApiKey`、`KnowledgeService.injectUserMessageWithKnowledgeSearchPrompt/createKnowledgeReferencesBlock/getKnowledgeReferences`、`messageThunk` 流式部分（`sendMessage`、`resendMessageThunk`、`regenerateAssistantResponseThunk`、`initiateTranslationThunk`、`appendAssistantResponseThunk`、IM channel 流、block 节流器等）、`streamCallback.integration.test.ts`、`types/index.ts` 的 `FetchChatCompletionParams` 相关类型 |
| `src/renderer/src/aiCore/` (55 files) | ❌ 待删 | 仍被非聊天功能引用：`ApiService`（`buildStreamTextParams`、`AiProvider`）、`KnowledgeService`（`AiProvider`）、Paintings 页面（`AiProvider`）、`CodeCliPage`（`AiProvider`）、`ProviderSetting`（`adaptProvider`）、工具渲染组件（tool type imports） |
| `src/renderer/src/types/chunk.ts` | ❌ 待删 | 仍被 `aiCore/chunk/` 与 `aiCore/types/middlewareConfig.ts` 引用，随 `aiCore/` 一起清理 |

**清理策略（剩余）**：`aiCore/` 还被未迁移到 Main IPC 的旧 Renderer AI 调用链引用（Paintings 图片生成、KnowledgeService embedding 构造、CodeCliPage 读 baseURL/apiKey、ProviderSetting `adaptProvider`、工具组件 type imports）。当这些调用切到 `window.api.ai.*` IPC 或 Renderer 本地 util 后，`aiCore/` 和 `types/chunk.ts` 可一并删除。

**工具渲染组件的 type import**：`MessageWebSearch`、`MessageKnowledgeSearch`、`MessageMemorySearch` 从 `aiCore/tools/` import 输入输出类型定义，需先将这些类型提取到 `@shared` 或 `packages/shared/`。

---

## 五、Phase 4：Agent 功能完善 + 清理

### 5.1 Agent 仍走统一主链

migration 文档已明确，chat 和 agent 在 Main 侧已经统一到同一执行路径。Renderer 侧只补 Agent 特有 UI，不再保留第二套聊天系统。

Renderer 侧目标：

- Agent 页面直接使用官方 `useChat`
- `id` 继续使用稳定 `topicId`
- Agent 配置通过 `chat.sendMessage(..., { body: { ...agentConfig } })` 传入
- Agent 消息仍渲染为统一的 `UIMessage.parts[]`

### 5.2 Agent DataUIPart

**文件**: `packages/shared/ai-transport/dataUIParts.ts`

按 migration 文档新增：

```typescript
'agent-session': z.object({
  sessionId: z.string(),
  agentId: z.string(),
})
```

这里要和 migration 文档保持严格一致：

- `agent-session` 是 Phase 4 唯一明确新增的 Agent 专属 DataUIPart
- `needsApproval` 属于 tool 定义，不属于 DataUIPart
- Tool 权限状态由 ToolUIPart 原生 `approval-requested` / `approval-responded` / `output-denied` 表达
- 步骤进度通过 `Ai_AgentStepProgress` 事件推送，不新增 `agent-progress` 之类的自定义 DataUIPart

不再新增自定义 `agent-permission` part。

### 5.3 Tool 权限审批

Tool approval 统一按 migration 文档切到 AI SDK 原生方案：

- Main 侧 tool 在定义时声明 `needsApproval`
- Renderer 在 `useChat` 调用处配置 `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`
- Tool UI 直接消费 ToolUIPart 的原生状态
- 审批按钮调用 `chat.addToolApprovalResponse({ id, approved, reason })`

Renderer 侧不再保留自建 approval FSM。

**需要删除的旧前端审批代码**

```text
src/renderer/src/utils/userConfirmation.ts
src/renderer/src/utils/mcp-tools.ts
src/renderer/src/pages/home/Messages/Tools/hooks/useMcpToolApproval.ts
src/renderer/src/pages/home/Messages/Tools/hooks/useAgentToolApproval.ts
src/renderer/src/pages/home/Messages/Tools/hooks/useToolApproval.ts
src/renderer/src/pages/home/Messages/Tools/ToolApprovalActions.tsx
src/renderer/src/pages/home/Messages/Tools/ToolPermissionRequestCard.tsx
```

### 5.4 Agent 步骤进度

按 migration 文档，步骤进度不是自定义 DataUIPart，而是 Main 侧 `onStepFinish` 通过 `Ai_AgentStepProgress` 推给 Renderer。

Renderer 侧要求：

- 消费 `Ai_AgentStepProgress`
- 在 Agent 页面展示步骤号、toolCalls 等进度信息
- 不额外发明 `agent-progress` / `agent-permission` 这类自定义 parts

### 5.5 Agent 旧前端链路删除

按 migration 文档，Agent 接入统一主链后删除“独立 SSE / parser / datasource”旧链路。当前仓库中对应的前端实现主要位于：

- `src/renderer/src/hooks/agents/useSessionStream.ts`
- `src/renderer/src/pages/agents/components/AgentSessionMessages.tsx`
- `src/renderer/src/services/db/AgentMessageDataSource.ts`

另外：

- `src/renderer/src/api/agent.ts`
  这里当前承载 agent / session / task 的管理 API；后续只保留管理接口，不再承载 Agent 聊天执行链职责。

### 5.6 测试与 benchmark

按 migration 文档新增：

- `tests/e2e/ai-transport.spec.ts`
- `tests/e2e/agent-chat.spec.ts`

覆盖内容：

- 完整聊天流程
- Agent 权限审批链路
- Main Process 与旧 Renderer 模式性能对比
- 多窗口并发

---

## 六、Person B 文件边界

本文档只保留 migration 文档中 Person B 已定义的文件边界。

### 6.1 Phase 2

| 文件 | 动作 |
|---|---|
| `src/preload/index.ts` | 修改 |
| `src/preload/preload.d.ts` | 修改 |
| `src/renderer/src/transport/IpcChatTransport.ts` | 新建 / 改造为 Broker 版本 |

### 6.2 Phase 3

| 文件 | 动作 |
|---|---|
| `package.json` | 修改，加入 `@ai-sdk/react` |
| `packages/shared/ai-transport/dataUIParts.ts` | 新建 |
| `src/renderer/src/pages/home/Messages/Message.tsx` | 修改 |
| `src/renderer/src/pages/home/Chat.tsx` | 修改 |
| `src/renderer/src/aiCore/` | 删除整个目录 |
| `src/renderer/src/services/messageStreaming/` | 删除整个目录 |
| `src/renderer/src/types/chunk.ts` | 删除 |
| `src/renderer/src/services/ApiService.ts` | 修改 |
| `electron.vite.config.ts` | 修改 |

### 6.3 Phase 4

| 文件 | 动作 |
|---|---|
| `src/renderer/src/pages/home/Chat.tsx` | 修改，接入原生 approval 流 + `sendAutomaticallyWhen` |
| `src/renderer/src/pages/home/Messages/Tools/MessageMcpTool.tsx` | 修改 |
| `src/renderer/src/utils/userConfirmation.ts` | 删除 |
| `src/renderer/src/utils/mcp-tools.ts` | 删除 |
| `src/renderer/src/pages/home/Messages/Tools/hooks/useMcpToolApproval.ts` | 删除 |
| `src/renderer/src/pages/home/Messages/Tools/hooks/useAgentToolApproval.ts` | 删除 |
| `src/renderer/src/pages/home/Messages/Tools/hooks/useToolApproval.ts` | 删除 |
| `src/renderer/src/pages/home/Messages/Tools/ToolApprovalActions.tsx` | 删除 |
| `src/renderer/src/pages/home/Messages/Tools/ToolPermissionRequestCard.tsx` | 删除 |
| `src/renderer/src/hooks/agents/useSessionStream.ts` | 删除 |
| `src/renderer/src/pages/agents/components/AgentSessionMessages.tsx` | 修改，删除独立 agent stream 主链 |
| `src/renderer/src/services/db/AgentMessageDataSource.ts` | 删除 |
| `src/renderer/src/api/agent.ts` | 修改，只保留 agent / session / task 管理 API |
| `tests/e2e/ai-transport.spec.ts` | 新建 |
| `tests/e2e/agent-chat.spec.ts` | 新建 |

---

## 七、Renderer 侧工作展开（按模块）

本节不新增 migration 文档之外的 phase，只把现有 Renderer 模块按 migration 文档主线展开。

### 7.1 展开规则

按 migration 文档，Renderer 主线只有两条：

- `Phase 3`：普通聊天统一到官方 `useChat`
- `Phase 4`：Agent 统一到同一 AI 执行链

因此当前仓库中的模块按以下方式归并：

| 模块域 | 归属主线 | 说明 |
|---|---|---|
| 助手侧 / 主聊天 | `Phase 3` | 普通聊天主入口 |
| 快捷助手 | `Phase 3` | 普通聊天轻量入口，不单独维护协议 |
| 划词助手 | `Phase 3` | 普通聊天触发入口，不单独维护协议 |
| Agent 侧 | `Phase 4` | 统一执行链上的 Agent 入口 |

### 7.2 通用基础工作

这部分是所有入口共享的前置工作，先于各模块展开：

| 工作 | 涉及模块 / 文件 |
|---|---|
| Broker IPC 契约对齐 | `packages/shared/IpcChannel.ts`、`src/preload/index.ts`、`src/preload/preload.d.ts` |
| `IpcChatTransport` 改造成 broker 版本 | `src/renderer/src/transport/IpcChatTransport.ts` |
| `useChat` 主调用点落地 | `src/renderer/src/pages/home/Chat.tsx` |
| `UIMessage.parts[]` 渲染主链 | `src/renderer/src/pages/home/Messages/*` |
| DataUIPart schema | `packages/shared/ai-transport/dataUIParts.ts` |
| 清理旧普通聊天流式链路 | `src/renderer/src/aiCore/`、`src/renderer/src/services/messageStreaming/`、`src/renderer/src/types/chunk.ts` |

### 7.3 助手侧 / 主聊天

这是 migration 文档中 `Phase 3` 的主入口。

#### 7.3.1 现在情况（2026-04-14 更新）

> **主聊天 Phase 3 核心链路已完成。** 以下是按实际代码审计后的状态快照。

- `src/renderer/src/pages/home/Chat.tsx`
  ✅ **已完成。** `USE_V2_CHAT` 双轨开关已删除，V1 分支已清理。`Chat.tsx` 无条件渲染 `<V2ChatContent>`。无 Redux 依赖。
- `src/renderer/src/pages/home/V2ChatContent.tsx`
  ✅ **已完成。** 通过 `useChatWithHistory(topic.id, history, { assistantId })` 组合历史与活跃流。`useChatWithHistory` 内部封装官方 `useChat`，外部无需直接操作 `Chat` 实例。历史消息来自 `useTopicMessagesV2(topic.id)`，活跃流来自 `useChat`，两者在 `useChatWithHistory` 内合并。通过 `V2ChatOverridesProvider` 注入 regenerate / resend / capability 等操作。
- `src/renderer/src/services/ChatSessionManager.ts`
  ✅ **已删除。**
- `src/renderer/src/hooks/useChatSession.ts`
  ✅ **已删除。**
- `src/renderer/src/hooks/useAiChat.ts`
  ✅ **已删除。**
- `src/renderer/src/hooks/useLightweightAssistantFlow.ts`
  ✅ **已删除。** 快捷助手和划词助手已直接使用 `useChat`。
- `src/renderer/src/pages/home/Inputbar/Inputbar.tsx`
  ✅ **已完成。** 只保留 `onSendProp` 回调，无 legacy `messageThunk` fallback。发送链：`Inputbar.onSend` → `V2ChatContent.handleSendV2` → `useChatWithHistory.sendMessage()`。
- `src/renderer/src/pages/home/Tabs/components/Topics.tsx`
  ✅ **已完成。** 不再依赖 `chatSessionManager.getSnapshot()`，使用 Redux + DataApi 双写模式。
- `src/renderer/src/hooks/useTopicMessagesV2.ts`
  ✅ **架构正确，双轨输出是设计选择。** 返回 `uiMessages`（AI SDK 格式）、`adaptedMessages`（legacy `Message[]`，`blocks: []` 始终为空）和 `partsMap`（主渲染源）。`partsMap` 是所有消息渲染的唯一数据来源，`adaptedMessages` 仅用于提供 `id`、`role`、`status`、`usage` 等元数据。渲染层通过 `PartsProvider` + `useMessageParts(messageId)` 消费 parts，不读取 `blocks`。
- `src/renderer/src/hooks/useChatWithHistory.ts`
  ✅ **核心编排 hook。** 封装官方 `useChat`，接受可插拔的 `ChatHistory` 接口（主聊天用 `useTopicMessagesV2`，Agent 用 `useAgentSessionParts`）。合并历史 + 活跃流的 `adaptedMessages` 和 `partsMap`。Stream 完成后自动 `history.refresh()` + `setMessages([])`。
- `src/renderer/src/hooks/useAssistant.ts` 与 `src/renderer/src/store/assistants.ts`
  ✅ assistant、topic、model、settings 作为配置来源存在；不再承载消息生命周期、流状态和完成态裁决。

#### 7.3.2 代码位置

- 入口与页面壳
  `src/renderer/src/pages/home/Chat.tsx`
  `src/renderer/src/pages/home/V2ChatContent.tsx`
- 核心编排 hook
  `src/renderer/src/hooks/useChatWithHistory.ts`
- 活跃流 transport
  `src/renderer/src/transport/IpcChatTransport.ts`
- 历史消息与刷新
  `src/renderer/src/hooks/useTopicMessagesV2.ts`
  `@data/DataApiService`
- 发送入口与请求参数装配
  `src/renderer/src/pages/home/Inputbar/Inputbar.tsx`
  `src/renderer/src/utils/assistantRuntimeOverrides.ts`
  `src/renderer/src/utils/assistant.ts`
- 消息渲染
  `src/renderer/src/pages/home/Messages/*`
  `src/renderer/src/pages/home/Messages/Blocks/*`（parts 渲染组件，通过 `PartsProvider` + `PartsRenderer` 驱动）
- V2 上下文
  `src/renderer/src/pages/home/Messages/Blocks/V2Contexts.ts`（`PartsProvider`、`RefreshContext`）
  `src/renderer/src/hooks/useChatContext.ts`（多选、消息定位等 UI 协调）
- topic 列表与状态展示
  `src/renderer/src/pages/home/Tabs/components/Topics.tsx`
- assistant 配置来源
  `src/renderer/src/hooks/useAssistant.ts`
  `src/renderer/src/store/assistants.ts`
- 已删除
  ~~`src/renderer/src/hooks/useAiChat.ts`~~
  ~~`src/renderer/src/hooks/useChatSession.ts`~~
  ~~`src/renderer/src/hooks/useLightweightAssistantFlow.ts`~~
  ~~`src/renderer/src/services/ChatSessionManager.ts`~~

#### 7.3.3 后续任务（2026-04-14 更新）

> 任务 1-6, 8-12, 14 已完成。以下标注实际状态。

- ~~任务 1：把主聊天调用点改成直接使用官方 `useChat`~~ ✅ **已完成**
  `V2ChatContent` 通过 `useChatWithHistory`（内部封装官方 `useChat`）组合历史与活跃流。

- ~~任务 2：去掉把历史消息灌回 `Chat` 的做法~~ ✅ **已完成**
  历史走 `useTopicMessagesV2`，活跃流走 `useChat`，两者在 `useChatWithHistory` 内合并。

- ~~任务 3：删除 `ChatSessionManager` 这条错误补丁链~~ ✅ **已完成**
  `ChatSessionManager.ts` 和 `useChatSession.ts` 均已删除。

- ~~任务 4：把完成态持久化从 Renderer 挪走~~ ✅ **已完成**
  Main 侧 `PersistenceListener` 负责持久化。Renderer 不配置 `onFinish`。

- ~~任务 5：让 `V2ChatContent` 只保留页面壳职责~~ ✅ **已完成**
  只负责加载历史、挂接 `useChatWithHistory`、组合展示、路由 UI 操作。

- ~~任务 6：保留 Inputbar 的 V2 发送入口，删除 legacy fallback~~ ✅ **已完成**
  只保留 `onSendProp` 回调，无 `messageThunk` fallback。

- ~~任务 7：把 assistant 相关请求参数整理为调用点注入~~ ✅ **已完成**
  `V2ChatContent.handleSendV2` 通过 `sendMessage(..., { body: { parentAnchorId, files, mentionedModels, mcpToolIds, ...capabilityBody } })` 注入参数。`mcpToolIds` 通过 `fetchMcpTools` 异步解析。

- ~~任务 8：把 `useAiChat` 从目标架构中移除~~ ✅ **已完成**
  `useAiChat.ts` 已删除。

- ~~任务 9：把 topic 列表状态从 session snapshot 切走~~ ✅ **已完成**
  `Topics.tsx` 使用 Redux + DataApi 双写，不再依赖 `chatSessionManager.getSnapshot()`。

- ~~任务 10：消息渲染收敛到 `UIMessage.parts[]`~~ ✅ **已完成**
  `PartsRenderer` 从 `PartsContext`（`partsMap`）直读 `CherryMessagePart[]`，按 `type` 路由到 `MainTextBlock`、`ThinkingBlock`、`ImageBlock`、`ToolBlock` 等组件。`adaptedMessages.blocks` 始终为空数组，渲染层不读取 blocks。

- ~~任务 11：把主聊天入口的双轨开关清理掉~~ ✅ **已完成**
  `Chat.tsx` 无条件渲染 `V2ChatContent`，无 `USE_V2_CHAT` 开关。

- ~~任务 12：明确 assistant store 的边界~~ ✅ **已完成**
  assistant / topic / model / settings 作为配置来源；不再承载消息生命周期。

- 任务 13：主聊天回归验证补齐
  涉及文件：`src/renderer/src/transport/__tests__/IpcChatTransport.test.ts`、主聊天相关测试文件
  说明：重点补”发送 → 流式回复 → Main 持久化 → DataApi 刷新 → 切 topic / 重挂载后恢复”的链路验证。

- ~~任务 14：删除 `useLightweightAssistantFlow`~~ ✅ **已完成**
  文件已删除。快捷助手和划词助手已直接使用 `useChat`。

- **任务 15：清理 `src/renderer/src/aiCore/` 目录（55 个文件）**
  状态：❌ 待做。V2 聊天链路（主聊天 + 快捷助手 + 划词助手 + Agent）均不再依赖此目录。但仍有非聊天功能引用（`ApiService`、`KnowledgeService`、Paintings 页面、`CodeCliPage`、`ProviderSetting`、工具渲染组件 type imports）。需等 Main 侧 API 迁移完成后统一清理。详见 4.6 节。

- ~~任务 16：清理 `src/renderer/src/services/messageStreaming/` 目录（12 个文件）~~ ✅ **已完成（2026-04-15）**
  连同 V1 消费方一并删除：`StreamProcessingService`、`ConversationService`、`ApiService` 中的 V1 chat 函数、`KnowledgeService` 中的 V1 injection 函数、`messageThunk` 流式部分、`streamCallback.integration.test.ts` 与 `FetchChatCompletionParams` 相关类型。`messageThunk.ts` 保留 `loadTopicMessagesThunk`、`renameAgentSessionIfNeeded`、`removeBlocksThunk` 三个外部仍引用的导出。

#### 7.3.4 助手侧收尾判定（2026-04-14 更新）

| 判定条件 | 状态 |
|---|---|
| `Chat.tsx` / `V2ChatContent.tsx` 使用官方 `useChat`（通过 `useChatWithHistory` 封装） | ✅ 已完成 |
| 助手侧不再依赖 `useChatSession` | ✅ 已删除 |
| `ChatSessionManager` 已删除 | ✅ 已删除 |
| Inputbar 不再回退到旧 `messageThunk` | ✅ 已完成 |
| topic 列表不再依赖 `chatSessionManager.getSnapshot()` | ✅ 已完成 |
| 历史消息与活跃流明确分离 | ✅ 已完成（`useChatWithHistory` 内合并） |
| 消息渲染主链是 `UIMessage.parts[]` | ✅ 已完成（`PartsRenderer` 从 `PartsContext` 直读 parts，`blocks` 始终为空） |
| `src/renderer/src/aiCore/` 已删除 | ❌ 待清理（55 个文件，聊天链路无依赖，非聊天功能仍引用） |

### 7.4 快捷助手

快捷助手属于普通聊天轻量入口，按 migration 文档并入 `Phase 3`，不单独定义新链路。

#### 7.4.1 现在情况（2026-04-14 更新）

> **快捷助手已完成 v2 迁移。** `useLightweightAssistantFlow` 已被删除，`HomeWindow` 直接使用 `useChat`。

- `src/renderer/src/hooks/useLightweightAssistantFlow.ts`
  ✅ **已删除。** 不再存在于代码库中。
- `src/renderer/src/windows/mini/home/HomeWindow.tsx`
  ✅ **已完成。** 直接使用 `useChat<CherryUIMessage>({ id: topic.id, transport: ipcChatTransport, experimental_throttle: 50 })`。通过 `useMemo` 从 `chatMessages` 生成 `partsMap` 和 `adaptedMessages`（`blocks: []` 始终为空）。发送通过 `sendMessage({ text }, { body: { ... } })` 注入参数。`clear()` 仅做 UI 重置（`setMessages([])`）。路由和剪贴板拼接逻辑保持为 UI 入口职责。
- `src/renderer/src/windows/mini/chat/ChatWindow.tsx`
  ✅ **已完成。** 简单 pass-through 组件，接收 `messages: Message[]` 和 `partsMap`，委托给 `Messages` 组件。
- `src/renderer/src/windows/mini/chat/components/Messages.tsx`
  ✅ **已完成。** 使用 `PartsProvider value={partsMap}` 包裹消息列表，与主聊天共享同一套 parts 渲染管线。
- `src/renderer/src/pages/settings/QuickAssistantSettings.tsx`
  ✅ 设置页只处理偏好配置，不介入消息状态。

#### 7.4.2 代码位置

- 轻量运行时
  `src/renderer/src/hooks/useLightweightAssistantFlow.ts`
- mini window 入口与页面壳
  `src/renderer/src/windows/mini/MiniWindowApp.tsx`
  `src/renderer/src/windows/mini/home/HomeWindow.tsx`
- mini window 输入与路由辅助 UI
  `src/renderer/src/windows/mini/home/components/InputBar.tsx`
  `src/renderer/src/windows/mini/home/components/FeatureMenus.tsx`
  `src/renderer/src/windows/mini/home/components/Footer.tsx`
  `src/renderer/src/windows/mini/home/components/ClipboardPreview.tsx`
- mini window 消息渲染
  `src/renderer/src/windows/mini/chat/ChatWindow.tsx`
  `src/renderer/src/windows/mini/chat/components/Messages.tsx`
  `src/renderer/src/windows/mini/chat/components/Message.tsx`
  `src/renderer/src/windows/mini/chat/components/MessageContent.tsx`
- mini window 特殊路由
  `src/renderer/src/windows/mini/translate/TranslateWindow.tsx`
- 快捷助手设置
  `src/renderer/src/pages/settings/QuickAssistantSettings.tsx`

#### 7.4.3 后续任务（2026-04-14 更新）

> 任务 1-7 已全部完成。

- ~~任务 1：让快捷助手运行时直接落到统一 `useChat`~~ ✅ **已完成**
  `useLightweightAssistantFlow` 已删除，`HomeWindow` 直接使用 `useChat<CherryUIMessage>({ id: topic.id, transport: ipcChatTransport })`。

- ~~任务 2：把轻量运行时缩减成”调用点 helper”，不再做消息生命周期主控~~ ✅ **已完成**
  `useLightweightAssistantFlow` 已删除。`HomeWindow` 只在组件内做 prompt 拼接和参数整理，消息生命周期由 `useChat` 管理。

- ~~任务 3：统一 mini window 的发送语义~~ ✅ **已完成**
  所有路由复用 `sendMessage({ text }, { body })` 语义。

- ~~任务 4：把快捷助手的本地”清空会话”缩减为 UI 行为~~ ✅ **已完成**
  `clear()` 仅调用 `setMessages([])`，是 UI 重置行为。

- ~~任务 5：把消息渲染从 `Message[] + partsMap` 收敛到 `UIMessage.parts[]`~~ ✅ **已完成**
  mini chat 使用 `PartsProvider value={partsMap}` 共享主聊天的 parts 渲染管线。`adaptedMessages.blocks` 始终为空。

- ~~任务 6：消除快捷助手对 legacy `adaptedMessages` 的依赖~~ ✅ **已完成**
  `adaptedMessages` 仅提供 `id`、`role`、`status` 等元数据，渲染通过 `partsMap` 驱动。`isOutputted` 从 `chatMessages` 长度判断。

- ~~任务 7：把停止 / 错误 / 重连能力统一到 broker transport~~ ✅ **已完成**
  `stop()` 来自 `useChat`，错误通过 `onError` 回调处理，transport 统一使用 `ipcChatTransport`。

- ~~任务 8：保持设置页纯配置边界~~ ✅ **已完成**
  `QuickAssistantSettings` 只处理偏好配置。

- 任务 9：对齐快捷助手的回归验证
  涉及文件：mini window 相关测试文件
  说明：至少覆盖”打开快捷助手 → 发送 → 流式回复 → 停止 → 关闭重开 → 配置变更后仍走统一 transport”这条主链，确认它只是普通聊天的轻量入口。

#### 7.4.4 快捷助手收尾判定（2026-04-14 更新）

| 判定条件 | 状态 |
|---|---|
| 快捷助手直接使用 `useChat`（`useLightweightAssistantFlow` 已删除） | ✅ 已完成 |
| mini window 发送、停止、恢复与主聊天共用同一条 `useChat + transport` 主链 | ✅ 已完成 |
| mini chat 渲染通过 `PartsProvider` + `partsMap` 驱动（`blocks` 始终为空） | ✅ 已完成 |
| `QuickAssistantSettings` 仍然只是配置页 | ✅ 已完成 |
| 快捷助手没有独立 transport、独立 chunk 协议、独立完成态语义 | ✅ 已完成 |

### 7.5 划词助手

划词助手属于普通聊天触发入口，按 migration 文档并入 `Phase 3`。

#### 7.5.1 现在情况（2026-04-14 更新）

> **划词助手已完成 v2 迁移。** `useLightweightAssistantFlow` 已被删除，`ActionGeneral` 和 `ActionTranslate` 直接使用 `useChat`。

- `src/renderer/src/windows/selection/toolbar/SelectionToolbar.tsx`
  ✅ **纯触发层。** 监听 `Selection_TextSelected` / `Selection_ToolbarVisibilityChange`、读取偏好、展示 action buttons。无聊天功能。
- `src/renderer/src/windows/selection/action/SelectionActionApp.tsx`
  ✅ **容器壳。** 接收 `Selection_UpdateActionData`、管理窗口钉住/自动关闭/透明度/滚动。按 action type 路由到 `ActionGeneral` 或 `ActionTranslate`，自身不包含 AI 执行逻辑。
- `src/renderer/src/windows/selection/action/components/ActionGeneral.tsx`
  ✅ **已完成。** 直接使用 `useChat<CherryUIMessage>({ id: activeTopic.id, transport: ipcChatTransport, experimental_throttle: 50 })`。通过 `useMemo` 从 `chatMessages` 生成 `partsMap` 和 `latestAssistantMessage`。挂载后通过 `useEffect([fetchResult])` 自动执行。渲染使用 `PartsProvider value={partsMap}` + `MessageContent`。
- `src/renderer/src/windows/selection/action/components/ActionTranslate.tsx`
  ✅ **已完成。** 直接使用 `useChat<CherryUIMessage>({ id: activeTopic?.id ?? 'selection-translate', transport: ipcChatTransport })`。保留了语言检测、双向语言偏好、目标语言决策等前处理逻辑（在调用点完成），执行链走统一 `useChat`。渲染使用 `PartsProvider value={partsMap}` + `MessageContent`。
- `src/renderer/src/pages/settings/SelectionAssistantSettings/SelectionAssistantSettings.tsx`
  ✅ 设置页使用 `usePreference()`，只承载偏好配置。
- `src/renderer/src/store/selectionStore.ts`
  ✅ **已 deprecated。** 所有 reducer action 已注释，仅剩 `setPlaceholder`。不承担运行时职责。

#### 7.5.2 代码位置

- toolbar 触发层
  `src/renderer/src/windows/selection/toolbar/SelectionToolbar.tsx`
- action window 页面壳
  `src/renderer/src/windows/selection/action/SelectionActionApp.tsx`
- 划词动作执行与结果展示
  `src/renderer/src/windows/selection/action/components/ActionGeneral.tsx`
  `src/renderer/src/windows/selection/action/components/ActionTranslate.tsx`
  `src/renderer/src/windows/selection/action/components/WindowFooter.tsx`
- 划词设置
  `src/renderer/src/pages/settings/SelectionAssistantSettings/SelectionAssistantSettings.tsx`
  `src/renderer/src/pages/settings/SelectionAssistantSettings/components/*`
  `src/renderer/src/pages/settings/SelectionAssistantSettings/hooks/*`
- legacy store
  `src/renderer/src/store/selectionStore.ts`

#### 7.5.3 后续任务（2026-04-14 更新）

> 任务 1-8 已全部完成。

- ~~任务 1：保持 toolbar 为纯触发层~~ ✅ **已完成**
  toolbar 只负责选中文本、选择动作、调起 action window。

- ~~任务 2：让 action window 的执行链直接并入统一 `useChat`~~ ✅ **已完成**
  `ActionGeneral` 和 `ActionTranslate` 直接使用 `useChat<CherryUIMessage>({ id, transport: ipcChatTransport })`。`useLightweightAssistantFlow` 已删除。

- 任务 3：统一划词动作的 topic / chat 标识
  说明：`ActionGeneral` 使用 `activeTopic.id`，`ActionTranslate` 使用 `activeTopic?.id ?? 'selection-translate'` 作为 fallback。翻译的哨兵 ID 仍存在，后续可考虑统一。**低优先级**——不影响功能正确性。

- ~~任务 4：把翻译前处理留在调用点，把执行链收回统一主链~~ ✅ **已完成**
  语言检测、双向语言偏好在 `ActionTranslate` 调用点完成，执行链走统一 `useChat`。

- ~~任务 5：把结果渲染收敛到统一 parts / DataUIPart~~ ✅ **已完成**
  两个 action 组件都使用 `PartsProvider value={partsMap}` + `MessageContent` 渲染。

- ~~任务 6：把 footer 的暂停 / 重试语义并入统一 transport~~ ✅ **已完成**
  `handlePause()` 调用 `stopChat()`（来自 `useChat`），`handleRegenerate()` 重新调用 `fetchResult()`。

- ~~任务 7：保持设置页只承载偏好和动作配置~~ ✅ **已完成**

- ~~任务 8：明确 `selectionStore` 的退场边界~~ ✅ **已完成**
  所有 reducer action 已注释，仅剩占位。不承担运行时职责。

- 任务 9：对齐划词助手回归验证
  涉及文件：selection 相关测试文件
  说明：至少覆盖”选中文本 → 打开 toolbar → 触发 general / translate → 流式回复 → 暂停 / 重试 → 关闭重开”这条链路。

#### 7.5.4 划词助手收尾判定（2026-04-14 更新）

| 判定条件 | 状态 |
|---|---|
| toolbar 仍然只是触发层 | ✅ 已完成 |
| action window 不再依赖 `useLightweightAssistantFlow` | ✅ 已完成（已删除） |
| general / translate 都走统一 `useChat + transport` | ✅ 已完成 |
| 划词模块不再维护专用消息协议、专用完成态语义 | ✅ 已完成 |
| `ActionTranslate` 的 `'selection-translate'` 哨兵 ID 已统一 | ⚠️ 低优先级（功能正确，仅 fallback ID 存在） |
| `SelectionAssistantSettings` 仍然只是偏好配置页 | ✅ 已完成 |
| `selectionStore` 不再承担任何运行时主链职责 | ✅ 已完成（deprecated，reducer 已清空） |

### 7.6 Agent 侧

Agent 侧按 migration 文档并入 `Phase 4`。

#### 7.6.1 现在情况

- `src/renderer/src/pages/agents/AgentPage.tsx` 与 `src/renderer/src/pages/agents/AgentChat.tsx`
  Agent 目前仍是完全独立的一页：有自己的 navbar、side panel、sessions panel、inputbar、messages 区域；整个页面壳还没有并入普通聊天那条 `useChat` 主线。
- `src/renderer/src/pages/agents/components/AgentSessionMessages.tsx`
  这里当前通过 `buildAgentSessionTopicId(sessionId)` 生成稳定 topicId，再用 `loadTopicMessagesThunk(sessionTopicId)` 取历史消息、`useTopicMessages(sessionTopicId)` 读 Redux / newMessage 状态，并且直接订阅 `window.api.agentSessionStream.subscribe/onChunk/unsubscribe`；这是一条明确独立于 migration 目标的 Agent SSE / chunk 主链。
- `src/renderer/src/pages/agents/components/AgentSessionMessages.tsx`
  它还依赖 `setupChannelStream()`、`addChannelUserMessage()`、`addAbortController()` 来把 Agent stream chunk 重新喂回旧消息块系统，说明 Agent 流式适配目前仍完全是 Renderer 侧自建链路。
- `src/renderer/src/pages/agents/components/AgentSessionInputbar.tsx`
  发送入口当前仍通过 `dispatchSendMessage()` 走 `messageThunk`，并把 `{ agentId, sessionId }` 作为附加参数塞进旧发送链；停止则通过 `abortCompletion()` 和 `pauseTrace()` 处理，说明 Agent 输入栏还没有切到统一 `useChat.sendMessage()` / `stop()`。
- `src/renderer/src/hooks/agents/useSessionStream.ts`
  仓库里仍保留了独立的 `agentSessionStream` 订阅 hook，虽然页面主路径直接在 `AgentSessionMessages.tsx` 里订阅，但这说明 Agent 专用流协议在 Renderer 中仍然存在独立抽象。
- `src/renderer/src/api/agent.ts` 与 `src/renderer/src/hooks/agents/useAgentClient.ts`
  当前 `AgentApiClient` 仍是 `/v1/agents/*` 的独立 HTTP client，主要用于 agent / session / task 管理。管理 API 可以继续保留，但聊天执行链后续不应继续依赖它的专用流式能力。
- `src/renderer/src/services/db/AgentMessageDataSource.ts`
  这里仍保留了独立的 Agent message datasource、streaming cache、throttled persistence 和 `AgentMessage_PersistExchange` IPC；这是 migration 文档明确要删除的“Renderer 侧独立 datasource”。
- `src/renderer/src/pages/home/Messages/Tools/hooks/useAgentToolApproval.ts`
  Agent 工具审批现在已经部分并入共享消息工具 UI，但审批状态仍来自 Renderer `toolPermissions` store，并通过 `window.api.agentTools.respondToPermission()` 回传；它是现阶段兼容层，不是 migration 文档里最终的 AI SDK 原生 ToolUIPart 审批状态。
- `src/renderer/src/pages/home/Messages/Tools/ToolPermissionRequestCard.tsx`、`MessageTool.tsx`、`MessageAgentTools/*`
  Agent 工具卡片、工具结果渲染器、审批按钮已经能在共享消息区域里工作，这是后续统一 UI 的基础；但它们仍然建立在旧 Agent tool response / approval 模型之上，尚未完全切到 `ToolUIPart` 原生状态机。

#### 7.6.2 代码位置

- Agent 页面壳与导航
  `src/renderer/src/pages/agents/AgentPage.tsx`
  `src/renderer/src/pages/agents/AgentChat.tsx`
  `src/renderer/src/pages/agents/components/*`
- Agent session 消息与输入
  `src/renderer/src/pages/agents/components/AgentSessionMessages.tsx`
  `src/renderer/src/pages/agents/components/AgentSessionInputbar.tsx`
  `src/renderer/src/pages/agents/components/Sessions.tsx`
  `src/renderer/src/pages/agents/components/SessionItem.tsx`
- Agent hooks 与 client
  `src/renderer/src/hooks/agents/useAgentClient.ts`
  `src/renderer/src/hooks/agents/useSessionStream.ts`
  `src/renderer/src/hooks/agents/useSession.ts`
  `src/renderer/src/hooks/agents/useSessions.ts`
  `src/renderer/src/hooks/agents/useActiveAgent.ts`
  `src/renderer/src/hooks/agents/useActiveSession.ts`
- Agent 管理 API
  `src/renderer/src/api/agent.ts`
- Agent 旧消息数据源
  `src/renderer/src/services/db/AgentMessageDataSource.ts`
- Agent 工具渲染与审批
  `src/renderer/src/pages/home/Messages/Tools/MessageTool.tsx`
  `src/renderer/src/pages/home/Messages/Tools/ToolPermissionRequestCard.tsx`
  `src/renderer/src/pages/home/Messages/Tools/hooks/useAgentToolApproval.ts`
  `src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/*`

#### 7.6.3 后续任务

- 任务 1：把 Agent 页面调用点切到官方 `useChat`
  涉及文件：`src/renderer/src/pages/agents/AgentChat.tsx`、`src/renderer/src/pages/agents/components/AgentSessionMessages.tsx`、`src/renderer/src/pages/agents/components/AgentSessionInputbar.tsx`
  说明：Agent 页面最终也应与普通聊天一样，以 `useChat({ id: topicId, transport })` 为中心组织活跃流，而不是继续维护 Agent 专用发送和订阅链。

- 任务 2：保留稳定 session topicId，但把它切成统一消息主键
  涉及文件：`src/renderer/src/pages/agents/AgentChat.tsx`、`src/renderer/src/pages/agents/components/AgentSessionMessages.tsx`
  说明：`buildAgentSessionTopicId(sessionId)` 这层稳定标识是正确的，应继续保留；但它以后应成为 `useChat` / DataApi / ToolUIPart 的统一键，而不是继续挂在独立 SSE 管道上。

- 任务 3：删除 Renderer 侧独立 `agentSessionStream` 订阅主链
  涉及文件：`src/renderer/src/pages/agents/components/AgentSessionMessages.tsx`、`src/renderer/src/hooks/agents/useSessionStream.ts`
  说明：把 `subscribe / onChunk / unsubscribe / abort` 从 Renderer 专用通道切到 migration 文档的 broker attach / detach / reconnect 机制，不能继续保留 Agent 自己的一套 stream bus。

- 任务 4：把 Agent 历史消息改成“DataApi 历史 + `useChat` 活跃流”
  涉及文件：`src/renderer/src/pages/agents/components/AgentSessionMessages.tsx`
  说明：删除 `loadTopicMessagesThunk()`、`useTopicMessages()`、`setupChannelStream()` 这条旧消息适配链，改成和普通聊天一样的“历史来自 SQLite / DataApi，活跃流来自统一 transport”。

- 任务 5：把 Agent 输入栏发送切离 `messageThunk`
  涉及文件：`src/renderer/src/pages/agents/components/AgentSessionInputbar.tsx`
  说明：当前 `dispatchSendMessage()` 仍是旧普通聊天发送链；后续应改成 `useChat.sendMessage(..., { body })`，并把 `agentId`、`sessionId`、slash commands、tools、accessible paths、reasoning 等整理到 `body.agentConfig` 或等价统一注入结构。

- 任务 6：把 Agent 停止 / 重试语义并入统一 transport
  涉及文件：`src/renderer/src/pages/agents/components/AgentSessionInputbar.tsx`
  说明：删除 `abortCompletion()`、`pauseTrace()` 对 Agent 执行的主控地位，让停止、恢复、重试都通过统一 `useChat.stop()` 与 broker abort / attach 语义完成。

- 任务 7：收缩 `api/agent.ts` 的执行职责
  涉及文件：`src/renderer/src/api/agent.ts`、`src/renderer/src/hooks/agents/useAgentClient.ts`
  说明：`AgentApiClient` 后续只保留 agent / session / task 的管理接口；聊天执行流、chunk 处理、消息持久化不再经由这套独立 API client 实现。

- 任务 8：删除 Agent 独立 message datasource
  涉及文件：`src/renderer/src/services/db/AgentMessageDataSource.ts`
  说明：移除 streaming cache、节流持久化和 `AgentMessage_PersistExchange` 这类 Renderer 侧数据源职责；消息写入以后端统一持久化为准。

- 任务 9：把 Agent 工具结果统一到 `UIMessage.parts[] / ToolUIPart`
  涉及文件：`src/renderer/src/pages/home/Messages/Tools/MessageTool.tsx`、`src/renderer/src/pages/home/Messages/Tools/MessageAgentTools/*`
  说明：保留已有工具展示组件作为渲染资产，但数据输入应逐步从旧 `toolResponse` 结构收敛到统一消息 parts / ToolUIPart。

- 任务 10：删除旧 approval FSM，切到原生 approval 主链
  涉及文件：`src/renderer/src/pages/home/Chat.tsx`、`src/renderer/src/pages/home/Messages/Tools/MessageMcpTool.tsx`、`src/renderer/src/utils/userConfirmation.ts`、`src/renderer/src/utils/mcp-tools.ts`、`src/renderer/src/pages/home/Messages/Tools/hooks/useMcpToolApproval.ts`、`src/renderer/src/pages/home/Messages/Tools/hooks/useAgentToolApproval.ts`、`src/renderer/src/pages/home/Messages/Tools/hooks/useToolApproval.ts`、`src/renderer/src/pages/home/Messages/Tools/ToolApprovalActions.tsx`、`src/renderer/src/pages/home/Messages/Tools/ToolPermissionRequestCard.tsx`
  说明：按 migration 文档把审批调用点收敛到 `useChat` 的 `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` 和 `chat.addToolApprovalResponse()`；旧的 Redux + IPC 审批状态机整体删除，不再做“兼容改造”。

- 任务 11：补齐 `agent-session` DataUIPart
  涉及文件：`packages/shared/ai-transport/dataUIParts.ts`、Agent 相关消息渲染文件
  说明：按 migration 文档只补 `agent-session`；不新增 `agent-permission` 或 `agent-progress` 之类自定义 part，审批仍走 ToolUIPart，步骤进度仍走事件推送。

- 任务 12：接入 `Ai_AgentStepProgress` 步骤进度事件
  涉及文件：Agent 页面相关文件、preload / shared IPC 定义对应位置
  说明：按 migration 文档把步骤进度展示建立在 `Ai_AgentStepProgress` 事件上，用于显示 stepNumber、toolCalls 等信息；这不是自定义 DataUIPart，也不是旧 SSE 扩展块。

- 任务 13：把 Agent 页面剩余 UI 保留在“页面壳”层
  涉及文件：`src/renderer/src/pages/agents/AgentPage.tsx`、`src/renderer/src/pages/agents/AgentChat.tsx`、`src/renderer/src/pages/agents/components/*`
  说明：sessions 列表、navbar、side panel、pinned todo panel 等页面结构可以继续保留；但它们不再负责解释流状态、chunk 生命周期和最终消息裁决。

- 任务 14：对齐 Agent 回归验证
  涉及文件：`tests/e2e/agent-chat.spec.ts` 及相关测试文件
  说明：至少覆盖“创建 / 切换 session → 发送 → 流式工具调用 → 权限审批 → 停止 / 恢复 → 重挂载恢复”这条链路，确认 Agent 已真正并入统一执行链。

#### 7.6.4 Agent 侧收尾判定

当 Agent 侧完成收尾后，应满足以下状态：

- Agent 页面直接使用官方 `useChat`
- Agent session 继续使用稳定 `topicId`
- Renderer 不再保留独立 `agentSessionStream` 主链
- `messageThunk` 不再承担 Agent 发送主链
- `AgentMessageDataSource` 已删除
- 旧 approval hooks / 组件已删除
- 所有 `useChat` 调用点通过 `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` 接原生审批续跑
- Agent 工具与审批统一消费 `UIMessage.parts[] / ToolUIPart`
- `agent-session` 是唯一新增的 Agent DataUIPart
- Agent 步骤进度通过 `Ai_AgentStepProgress` 推送，而不是自定义 SSE / block / DataUIPart 协议

### 7.7 展开顺序

Renderer 侧工作按以下顺序展开：

1. 先完成通用基础：Broker IPC、preload、transport、主聊天 `useChat`
2. 再完成普通聊天主入口：助手侧 / 主聊天页面
3. 普通聊天主链稳定后，把快捷助手并入同一条 `Phase 3` 主线
4. 再把划词助手并入同一条 `Phase 3` 主线
5. 最后处理 `Phase 4`：Agent 页面、Tool approval、旧 Agent 前端链路删除

## 八、验收标准（2026-04-14 更新）

| 验收条件 | 状态 |
|---|---|
| 普通聊天使用官方 `useChat`（通过 `useChatWithHistory` 封装） | ✅ |
| 快捷助手直接使用 `useChat`（`useLightweightAssistantFlow` 已删除） | ✅ |
| 划词助手直接使用 `useChat`（`ActionGeneral` / `ActionTranslate`） | ✅ |
| Agent 页面使用 `useChatWithHistory`（`useAgentSessionParts` 提供历史） | ✅ |
| `IpcChatTransport.reconnectToStream()` 通过 `Ai_Stream_Attach` 工作 | ✅ |
| 历史消息来自 DataApi / IPC，活跃流来自 `useChat` | ✅ |
| Renderer 调用点不再配置 `onFinish` | ✅ |
| `ChatSessionManager` / `useChatSession` / `useLightweightAssistantFlow` 已删除 | ✅ |
| 消息渲染主链是 `UIMessage.parts[]`（`PartsRenderer` 从 `PartsContext` 直读） | ✅ |
| Agent 页面不再保留独立 SSE / parser / datasource | ✅（`AgentMessageDataSource` 已删除，`useSessionStream` 已废弃） |
| 旧 approval hooks / 组件已删除 | ❌ 未开始（仍走 Redux `toolPermissions` + IPC `respondToPermission`） |
| `useChat` 调用点已接入 `sendAutomaticallyWhen` | ❌ 未开始 |
| tool approval 使用 AI SDK 原生 ToolUIPart | ❌ 未开始 |
| Agent 步骤进度通过 `Ai_AgentStepProgress` 推送 | ❌ 未开始 |
| `src/renderer/src/aiCore/` 已删除 | ❌ 待清理（聊天链路无依赖，非聊天功能仍引用：Paintings / CodeCliPage / ProviderSetting / KnowledgeService / 工具组件 type imports） |
| `src/renderer/src/services/messageStreaming/` 已删除 | ✅ 已删除（整目录 12 文件；`BlockManager` / `StreamingService` / `callbacks/*` 连同 V1 消费方 `ApiService.transformMessagesAndFetch/fetchChatCompletion`、`ConversationService`、`StreamProcessingService`、`messageThunk` 流式部分、`streamCallback.integration.test.ts` 一起清理） |
| `useSessionStream.ts` 已删除 | ✅ 已删除（连同 preload `agentSessionStream.subscribe/unsubscribe/abort/onChunk` 和对应 IpcChannel） |

---
