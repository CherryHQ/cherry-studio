# 聊天模块的事件总线 + IPC

> 调查日期：2026-05-20
> 范围：renderer EventEmitter（`emittery`）+ main↔renderer IPC channel（聊天相关）

## 1. EventEmitter（renderer 内）

### 1.1 定义

`src/renderer/src/services/EventService.ts`（30 行）：
```ts
import Emittery from 'emittery'
export const EventEmitter = new Emittery()
export const EVENT_NAMES = {
  PLUGINS_UPDATED: 'PLUGINS_UPDATED',
  SEND_MESSAGE: 'SEND_MESSAGE',
  MESSAGE_COMPLETE: 'MESSAGE_COMPLETE',
  AI_AUTO_RENAME: 'AI_AUTO_RENAME',
  CLEAR_MESSAGES: 'CLEAR_MESSAGES',
  ADD_ASSISTANT: 'ADD_ASSISTANT',
  EDIT_MESSAGE: 'EDIT_MESSAGE',
  REGENERATE_MESSAGE: 'REGENERATE_MESSAGE',
  CHAT_COMPLETION_PAUSED: 'CHAT_COMPLETION_PAUSED',
  ESTIMATED_TOKEN_COUNT: 'ESTIMATED_TOKEN_COUNT',
  SHOW_ASSISTANTS: 'SHOW_ASSISTANTS',
  SHOW_TOPIC_SIDEBAR: 'SHOW_TOPIC_SIDEBAR',
  SWITCH_TOPIC_SIDEBAR: 'SWITCH_TOPIC_SIDEBAR',
  NEW_CONTEXT: 'NEW_CONTEXT',
  NEW_BRANCH: 'NEW_BRANCH',
  COPY_TOPIC_IMAGE: 'COPY_TOPIC_IMAGE',
  EXPORT_TOPIC_IMAGE: 'EXPORT_TOPIC_IMAGE',
  LOCATE_MESSAGE: 'LOCATE_MESSAGE',
  LOCATE_NOTE_LINE: 'LOCATE_NOTE_LINE',
  ADD_NEW_TOPIC: 'ADD_NEW_TOPIC',
  RESEND_MESSAGE: 'RESEND_MESSAGE',
  SHOW_MODEL_SELECTOR: 'SHOW_MODEL_SELECTOR',
  EDIT_CODE_BLOCK: 'EDIT_CODE_BLOCK',
  CHANGE_TOPIC: 'CHANGE_TOPIC'
}
```

底层是 [`emittery`](https://github.com/sindresorhus/emittery)（Promise-based EventEmitter）。

### 1.2 聊天相关事件清单（emit / listen 对照）

> 行号锚点来自 Explore agent 抽样，未逐一手工校验；引用前请 `grep` 当前真实位置。

| 事件 | 主 emit 点 | 主 listen 点 | payload | 用途 |
|---|---|---|---|---|
| `SEND_MESSAGE` | `Inputbar.tsx:246`、`AgentSessionInputbar.tsx:431` | `Messages.tsx:123`、`AgentSessionMessages.tsx:236`、`SpanManagerService.ts:379` | `{ topicId, traceId? }` | 用户发出消息后滚到底部 + trace span 关联 |
| `MESSAGE_COMPLETE` | `messageStreaming/callbacks/baseCallbacks.ts:278, 382` | （多处） | 消息元数据 | 流式或一次性响应完成 |
| `CLEAR_MESSAGES` | `Inputbar.tsx:312`、`Topics.tsx:164` | `Messages.tsx:124`、`SpanManagerService.ts:382` | `Topic` | 清空会话 |
| `NEW_CONTEXT` | `useMessageOperations.ts:129`、`Inputbar.tsx:321`、`Message.tsx:186` | `Messages.tsx:145` | 无 | 新建上下文（在当前 topic 内）|
| `NEW_BRANCH` | `MessageMenubar.tsx:234` | `Messages.tsx:173` | `number`（分支索引） | 创建话题分支 — 注意：这是 **v1 的 NEW_BRANCH**，不是 v2 的 fork |
| `EDIT_MESSAGE` | `Messages.tsx:282` | `Message.tsx:171` | `messageId: string` | 进入编辑态 |
| `REGENERATE_MESSAGE` | （MessageMenubar） | （Message 内部） | `messageId` | 重新生成 |
| `RESEND_MESSAGE` | （MessageMenubar） | thunk | `messageId` | 重发用户消息 |
| `EDIT_CODE_BLOCK` | `CodeBlock.tsx:44` | `Messages.tsx:203` | `{ language, content, ... }` | 代码块进入编辑 |
| `LOCATE_MESSAGE` | `ChatFlowHistory.tsx:144`、`MessageTokens.tsx:16`、`MessagesService.ts:99`（延迟 300ms） | `Message.tsx:160`、`MessageGroup.tsx:124` | `messageId` + 标志位 | 滚动定位并高亮 |
| `CHANGE_TOPIC` | `useTopic.ts:37` | `useChatContext.ts:37` | `Topic` | 切换 topic 后重新初始化聊天 |
| `ADD_NEW_TOPIC` | （Topics） | （Tabs / shortcut） | 无 | 新建空 topic |
| `AI_AUTO_RENAME` | 流结束后 | （Topic 列表） | `{ topicId, name }` | AI 自动给 topic 起名 |
| `CHAT_COMPLETION_PAUSED` | StreamingService | UI | `messageId` | 流被用户暂停 |
| `ESTIMATED_TOKEN_COUNT` | 输入框 token 估算 | TokenCount 组件 | `number` | 输入区 token 实时显示 |
| `SHOW_ASSISTANTS` / `SHOW_TOPIC_SIDEBAR` / `SWITCH_TOPIC_SIDEBAR` | 快捷键 / Navbar | HomePage / Tabs | 无 | 侧栏可见性切换 |
| `SHOW_MODEL_SELECTOR` | 快捷键 | Inputbar | 无 | 弹模型选择器 |
| `COPY_TOPIC_IMAGE` / `EXPORT_TOPIC_IMAGE` | MessageMenubar | Messages | `Topic` | 截图 |

### 1.3 注意事项

- 部分事件用**命名空间分隔的动态名**：如 `LOCATE_MESSAGE:${messageId}` —— grep 时要带正则
- 事件总线**绕过 TypeScript 检查**：payload 没有强类型保证，是脆弱点；新人改 emit 时容易漏改 listen
- 一些 v1 概念遗留：`NEW_BRANCH` 在 v2 里应该改为「PUT `/topics/:id/active-node`」+「POST `/topics?sourceNodeId=...`」组合，不再需要事件总线

## 2. main ↔ renderer IPC（聊天相关）

> 完整 IPC 表见 main 进程 `serviceRegistry.ts` + `IpcChannel` 枚举。本表只列与聊天直接相关的。

### 2.1 通用 DataApi 通道（v2 主干）

| Channel | 方向 | Main | Preload | Renderer | 说明 |
|---|---|---|---|---|---|
| `DataApi_Request` | invoke | `IpcAdapter.ts:49–75` | `preload/index.ts:908–909` | `dataApiService.{get,post,patch,put,delete}` | **聊天 v2 数据写入/读取的唯一通道**；所有 `/topics`、`/messages`、`/assistants`、`/temporary/topics` 请求都从这里走 |
| `DataApi_Subscribe` | invoke | `IpcAdapter.ts:78–82` | `preload:910–915` | （计划） | 实时订阅 — 端点已声明、消费端 TODO |
| `DataApi_Unsubscribe` | invoke | `IpcAdapter.ts:84–88` | `preload` | （计划） | 配对 unsubscribe |

注意：**`DataApi_Request` 一根通道承载几十种业务路径**，路由在 main 端 `apiHandlers` 完成。这是「IPC channel 总数少、但单 channel 流量大」的设计。

### 2.2 Agent 会话专用（未迁 DataApi）

| Channel | 方向 | Main 端 | Renderer 调用 | 说明 |
|---|---|---|---|---|
| `AgentMessage_PersistExchange` | invoke | `ipc.ts:118–125` | `AgentMessageDataSource.ts`（多处） | Agent 会话消息持久化 |
| `AgentMessage_GetHistory` | invoke | `ipc.ts:127–137` | `AgentMessageDataSource.ts`、`messageThunk.ts:1099` | Agent 会话历史 |
| `AgentSessionStream_Subscribe` | invoke | AgentStream service | `preload:632–635` | 订阅 Agent 流 |
| `AgentSessionStream_Unsubscribe` | invoke | AgentStream service | `preload:636–639` | 取消订阅 |
| `AgentSessionStream_Chunk` | push (`on`) | AgentStream service | `preload:641–684` | 实时块推送 |
| `AgentSession_Changed` | push (`on`) | AgentStream service | `preload:685–697` | 会话状态变更 |

注：`/agents/:agentId/sessions/:sessionId/messages*` 端点在 DataApi schema 中**已声明**，但 `StreamingService.finalize` 仍走 `dbService` 进而落到这些 IPC channel。迁移到 DataApi 是独立分支的工作。

### 2.3 周边但相关

| Channel | 说明 |
|---|---|
| `KnowledgeBase_*` | 聊天发送时若挂载知识库，会走这一组拉 RAG |
| `File_*` | 附件上传 / 读取 |
| `MCP_*` | 工具调用（Block 类型 TOOL 渲染时） |
| `TRACE_*` | 追踪（与 `SpanManagerService` 联动） |

这些不是聊天主链路，但聊天 UI 会消费。

## 3. 通信通道的实际分工

不写虚的占比数字，按职责分：

| 通道 | 在聊天里做什么 | 状态 |
|---|---|---|
| **DataApi（IPC，`DataApi_Request`）** | 一切聊天数据 CRUD（topic、message、assistant、临时会话） | ✅ 主干；v2 标准路径 |
| **EventEmitter（renderer 内）** | UI 信号（滚动、定位、清空、新建、token 估算）+ trace span 关联 | ✅ 工作正常；payload 无 TS 类型保护 |
| **Redux dispatch + selector** | UI 当前状态的「显示缓存」（消息列表、块） | ⚠️ v1 残留；待 UI 切到 `useQuery`/`useInfiniteQuery` 后删 |
| **dbService + 旧 IPC**（Agent session） | Agent 会话写持久 + 流式订阅 | ⚠️ 未迁 DataApi；独立切换计划 |
| **CacheService**（renderer 内存） | 流式 in-flight 状态（chunk → block 增量） | ✅ 设计选择；finalize 时一次性 PATCH 到 DataApi |
| **Dexie / IndexedDB** | v1 残留持久化 | ❌ 标 `@deprecated v2.0.0`；启动时被 `DataApiMessageDataSource` 覆盖 |

## 4. 已知脆弱点 / 改进空间

1. **`SpanManagerService` 重度依赖 EventEmitter** —— 若 emit 落在错误时机或 listen 顺序变了，trace 会断；EventEmitter 没有强类型 payload 防护
2. **`NEW_BRANCH` 事件是 v1 概念**，与 v2 的 `siblingsGroupId` / `activeNodeId` 不是一回事；UI 迁到 v2 后这个事件应被「`PUT /topics/:id/active-node`」+「`POST /topics?sourceNodeId=...`」替代
3. **`CHANGE_TOPIC` 与 `setCurrentTopicId` Redux action 双轨**：事件 + Redux 都在做"切 topic"的事，监听方需要兼容两侧
4. **DataApi 没有真正的"事件订阅"** —— `DataApi_Subscribe` 端点存在但 renderer 未消费；意味着多窗口下「另一个窗口改了 topic 名」当前不会自动同步，需要刷新或重新 fetch

## 5. 一句话总结

聊天通信现在的"主动脉"是 **`DataApi_Request` 这一根 IPC channel**（承载所有业务数据 CRUD）+ **renderer 内 EventEmitter**（处理 UI 信号）；Agent 会话独立走旧的 `AgentMessage_*` / `AgentSessionStream_*` 一组 IPC，是已知的迁移残留。
