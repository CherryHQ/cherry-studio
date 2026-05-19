# Cherry Studio DataApi 聊天端点现状

> 调查日期：2026-05-20
> 调查方法：直接读 `packages/shared/data/api/schemas/`、`src/main/data/api/handlers/`、`src/main/data/services/`，并 grep 出 renderer 端的实际消费点。
> **本文档修正了 2026-05-19 的初步判断** —— 当时说「聊天 UI 100% 仍走 Redux」，是错的。准确说法见下文「真实分工」。

## 0. 三句话现状

1. **schema 完整、handler 完整、service 完整**：4 个聊天相关 schema（topics / messages / temporaryChats / assistants）共声明 **13 个端点**，handler 与 service 全部已实现并接 SQLite。
2. **写路径已部分落地 DataApi**：创建 topic、创建用户/助手消息、流式结束的最终落库 —— 都已经走 `dataApiService.post/patch`。
3. **读路径有一层桥**：`DataApiMessageDataSource` 自己声明是「临时兼容层」，从 DataApi 拉数据后转成 renderer 老类型，再喂给 Redux；UI 仍订阅 Redux，但**真源已经是 SQLite**。

## 1. 端点清单（schema 声明 + handler 注册 + service 落地）

> 编译期由 `ApiSchemas` 强约束（`apiHandlers` 必须穷尽所有 schema 声明的路径，否则 ts 报错）—— 所以下表中每一行都同时存在 schema、handler、service 三层。

### 1.1 Topics（`topics.ts`）

| Method | Path | 说明 | Service |
|---|---|---|---|
| GET | `/topics` | cursor 分页 + `q` 模糊搜索；pinned 在前 | `topicService.listByCursor` |
| POST | `/topics` | 创建；可选 `sourceNodeId` 触发 fork（从某节点起复制路径） | `topicService.create` |
| GET | `/topics/:id` | 单个 topic | `topicService.getById` |
| PATCH | `/topics/:id` | 部分更新（name / isNameManuallyEdited / assistantId / groupId） | `topicService.update` |
| DELETE | `/topics/:id` | 删除 topic 及其所有消息（级联） | `topicService.delete` |
| PUT | `/topics/:id/active-node` | **高频** 分支切换（设置 activeNodeId） | `topicService.setActiveNode` |
| PATCH | `/topics/:id/order` | 单条重排（`OrderRequest`） | `topicService.reorder` |
| PATCH | `/topics/order:batch` | 批量重排 | `topicService.reorderBatch` |

### 1.2 Messages（`messages.ts`）

| Method | Path | 说明 | Service |
|---|---|---|---|
| GET | `/topics/:topicId/tree` | 树形可视化；`depth=-1` 全展开、`0` 只活动路径、`n` 活动路径 + n 层 | `messageService.getTree` |
| GET | `/topics/:topicId/messages` | 沿活动分支取消息；**cursor "before" 语义**（不含 cursor 本身），可选 `includeSiblings` 一起返回 siblingsGroup | `messageService.getBranchMessages` |
| POST | `/topics/:topicId/messages` | 创建消息；`parentId` 三态语义（omit=自动接 activeNode / null=作为根 / string=显式挂载） | `messageService.create` |
| GET | `/messages/:id` | 单条 | `messageService.getById` |
| PATCH | `/messages/:id` | 改 data / parentId / siblingsGroupId / status / traceId / stats | `messageService.update` |
| DELETE | `/messages/:id` | `cascade` + `activeNodeStrategy=parent\|clear`；非级联时把子节点 reparent 到祖父 | `messageService.delete` |

辅助方法（仅 service 层，无 HTTP 端点暴露）：`messageService.getPathToNode` —— 从节点回溯到根的完整路径。

### 1.3 Temporary Chat（`temporaryChats.ts`）

| Method | Path | 说明 | Service |
|---|---|---|---|
| POST | `/temporary/topics` | 创建内存态临时会话 | `temporaryChatService.createTopic` |
| DELETE | `/temporary/topics/:id` | 删除 | `temporaryChatService.deleteTopic` |
| POST | `/temporary/topics/:topicId/messages` | 追加消息 | `temporaryChatService.appendMessage` |
| GET | `/temporary/topics/:topicId/messages` | 拉历史 | `temporaryChatService.listMessages` |
| POST | `/temporary/topics/:id/persist` | 把内存会话固化到 SQLite | `temporaryChatService.persist` |

**注意**：临时会话**不持久化**到 SQLite，全部在内存里跑；只有 `persist` 调用后才转正。

### 1.4 Assistants（`assistants.ts`）

| Method | Path | 说明 | Service |
|---|---|---|---|
| GET | `/assistants` | offset 分页（page/limit）+ `search` 名称/描述 | `assistantDataService.list` |
| POST | `/assistants` | 创建（`name` 必填，`tagIds`/`mcpServerIds`/`knowledgeBaseIds` 同步关联表） | `assistantDataService.create` |
| GET | `/assistants/:id` | 单个 | `assistantDataService.getById` |
| PATCH | `/assistants/:id` | 部分更新 —— **handler 显式过滤未在 body 中出现的 key**，避免 zod `.partial()` 把 `.default()` 注入到未传字段（见 `assistants.ts:42-46` 的解释注释） | `assistantDataService.update` |
| DELETE | `/assistants/:id` | 删除 | `assistantDataService.delete` |

### 1.5 Agent Sessions（旁支，但相关）

Agent 会话有平行的端点（在 `agents.ts` schema）：
- `POST /agents/:agentId/sessions/:sessionId/messages`
- `DELETE /agents/:agentId/sessions/:sessionId/messages/:messageId`
- 加上 sessions 本身的 CRUD（`/agents/:agentId/sessions/:sessionId`）

**但 StreamingService 当前对 agent session 走 `dbService`，对普通 topic 才走 DataApi**（见 `StreamingService.ts:216` 的 `isAgentSessionTopicId` 分支）。两套写路径并存。

## 2. 真实分工：谁读、谁写、走哪条路

### 2.1 写路径（renderer → DataApi → SQLite）—— **已落地**

| 触发点 | 文件:行 | 端点 |
|---|---|---|
| 新建 topic | `src/renderer/src/pages/home/Inputbar/Inputbar.tsx:328` | `POST /topics` |
| 创建用户消息 | `StreamingService.ts:547`（`createUserMessage`） | `POST /topics/:topicId/messages` |
| 创建助手占位消息 | `StreamingService.ts:584`（`createAssistantMessage`） | `POST /topics/:topicId/messages` |
| 流式结束、消息最终落库 | `StreamingService.ts:222`（`finalize`） | `PATCH /messages/:id` |
| Agent 会话历史 | `messageThunk.ts:197`、`messageThunk.ts:933` | `GET /agents/:id/sessions/...`（混合） |

### 2.2 读路径（DataApi → 类型转换 → Redux → UI）

唯一入口：`src/renderer/src/services/db/DataApiMessageDataSource.ts`
```
GET /topics/:id                                  ← 拿 assistantId
GET /topics/:id/messages?limit=999&includeSiblings=true   ← 拿一整条分支
   ↓
convertSharedMessage()  ← v2 SharedMessage → v1 renderer Message + MessageBlock[]
   ↓
Redux: messagesAdapter / messageBlocksAdapter
   ↓
UI 订阅
```

**文件头第 1 行**直接写着：
> `TODO: Temporary compatibility layer — remove after message type migration.`

也就是说：当 renderer 直接 `useQuery('/topics/:topicId/messages')`、并停止用 Redux + `MessageBlock` slice 之后，整个 `DataApiMessageDataSource` 文件就可以删。

### 2.3 流式增量（in-flight）—— **不走 DataApi**

流式 chunk → block delta **不实时写 SQLite**：
- 全部存在 `cacheService`（renderer 内存）+ Redux throttled dispatch
- 只在 `finalize()`（流结束）时**一次性** `PATCH /messages/:id`

这是设计上的取舍 —— DataApi 用于**已提交状态**，不是 streaming buffer。

### 2.4 现在 UI 用 `useQuery`/`useMutation` 消费聊天端点了吗？

**几乎没有**。grep 出来：

| 文件 | 端点 |
|---|---|
| `src/renderer/src/components/ResourceSelector/AssistantSelector.tsx` | `/assistants` |
| `src/renderer/src/pages/settings/ComponentLabSettings/ComponentLabAssistantSelectorSettings.tsx` | `/assistants` |
| `src/renderer/src/pages/library/adapters/assistantAdapter.ts` | `/assistants` |
| `src/renderer/src/data/hooks/useDataApi.ts`（JSDoc 示例） | `/topics`、`/messages` |

聊天主流 UI（`pages/home/Messages/*`、`Tabs/components/Topics.tsx`）**没有一行** `useQuery('/topics')` 或 `useInfiniteQuery('/topics/:topicId/messages')`，全部仍订阅 Redux。

## 3. 当前的缺口 / 已知 TODO

### 3.1 已经有标注的

| 文件 | 标注 | 含义 |
|---|---|---|
| `services/db/DataApiMessageDataSource.ts:1` | "Temporary compatibility layer — remove after message type migration" | 整个 v1 → v2 类型转换层 |
| `services/messageStreaming/StreamingService.ts:215` | "TEMPORARY: Agent sessions use dbService until migration to Data API is complete" | agent session 写路径未迁 |
| `services/messageStreaming/StreamingService.ts`（`createUserMessage` 注释，约 L532） | "TRADEOFF: Not passing parentId — Data API will use topic.activeNodeId as parent. In multi-window/multi-branch scenarios, this may cause incorrect associations" | 多窗口下 parentId 竞态风险 |
| `store/thunk/messageThunk.ts:1332` | "TODO: Migrate block deletion to Data API when block endpoints are available" | 块级删除缺端点 |
| `packages/shared/data/api/schemas/topics.ts:67-73`（`SetActiveNodeSchema` 注释） | `descend` 标志在另一条分支（`DeJeune/ai-service`）上，等 renderer 消费者一起落地 | 当前分支语义只能"pin 到精确 nodeId" |

### 3.2 自查发现的（未有显式 TODO）

1. **没有块级端点**。Block 的增删改通过 `PATCH /messages/:id` 整体替换 `data.blocks` 完成。
   - **后果**：删一个块要往返整条消息的 JSON；流式中途想原子地"追加 block / 改某块状态"必须自己在 cacheService 暂存后等 finalize。
   - **建议**：要么补 `PATCH /messages/:id/blocks/:blockId`（细粒度），要么明确"DataApi 不暴露块级 RPC，块 ops 走 message data 整体替换"作为契约写入文档。

2. **`POST /topics/:topicId/messages` 的 `parentId` 三态语义和多窗口竞态**。当 omit 时服务端读 `topic.activeNodeId` 来挂父；如果另一个窗口刚改了 activeNodeId，会挂错。`StreamingService.createUserMessage` 已经写了 TRADEOFF 注释。
   - **建议**：renderer 拿到完整 message tree 后总是显式传 `parentId`，把这条 omit 路径标记为"未来移除"。

3. **没有 streaming "append-only" 端点**。当前流式中途不写库（cacheService 缓冲），结束后一次性 PATCH 整条消息。这是设计选择，但若未来要做"刷新页面后流式继续可见"，需要补 streaming-aware 端点（例如 chunked PATCH 或 SSE/WebSocket 通道）。
   - **建议**：保持现状，但把"streaming 落库语义 = finalize once"明确写入 [模块说明.md](./模块说明.md)。

4. **临时会话与正式会话的 schema 不对称**。`/temporary/topics/:topicId/messages` 没有 `:id` 子路径（不能拿单条），没有 tree / branch / pagination；persist 后才转成正常 topic。如果产品上需要"临时会话也支持分支"，要扩 schema。
   - **建议**：先确认产品是否需要 —— 极可能不需要，临时会话本来就是线性闪用即弃。

5. **Agent session 消息端点存在但 StreamingService 未消费**。`/agents/:agentId/sessions/:sessionId/messages` 已声明，但 `StreamingService.finalize` 还在调 `dbService.updateMessageAndBlocks`。
   - **建议**：单独一个 ticket 切换；agent 消息表结构可能与普通消息有差异，需要先核对。

6. **没有 search / 全文检索 RPC**。SQLite 侧 `message_fts` 虚拟表已就位（trigram 分词），但 schema 层没有 `/messages/search` 或 `/topics/:id/messages/search` 端点。renderer 当前的"消息内搜索"（`ContentSearch` 组件）走客户端遍历 Redux。
   - **建议**：若数据量增长，需要补搜索端点；目前不阻塞。

7. **`assistantDataService.update` 的 zod 雷区已有补丁**，但同模式可能在其它 PATCH handler 复现。`assistants.ts:42-46` 的 hack（手动过滤 body keys 避免 `.partial()` 注入 default）值得抽成 helper。
   - **建议**：写一个 `partialUpdate(body, schema)` helper，逐步替换。

## 4. 切换路线建议

按依赖顺序（每一步独立可发版）：

1. **renderer 直接消费 shared 类型**
   - 让 `Messages/*` 组件读 `BranchMessagesResponse` 原始形状（含 `siblingsGroup`），不再走 `convertSharedMessage`
   - 删除 `DataApiMessageDataSource`
   - 影响：Redux selector 改读 shared 类型，Block 渲染分发器（`Blocks/index.tsx`）要兼容 `MessageDataBlock` 而非 `MessageBlock`
2. **Topic 列表换 `useInfiniteQuery('/topics')`** —— 替代 `assistant.topics[]` 内联数组
   - 影响：`Tabs/components/Topics.tsx` 重写数据源；`assistants` slice 不再带 `topics[]`
3. **消息列表换 `useInfiniteQuery('/topics/:topicId/messages')`**
   - 影响：`Messages.tsx` 的无限滚动从客户端实现切到 SWR cursor
   - 注意：`useDataApi.ts` 的 JSDoc 已有这条示例
4. **删除 Redux `newMessage` + `messageBlock` slice + `messageThunk`** —— 真正的「v1 删除」时刻
5. **agent session 写路径迁到 DataApi**（独立分支，不与上述四步交织）
6. **块级端点 / search 端点 / 临时会话扩展** —— 按需补充

## 5. 哪些"看起来缺"其实不缺

- ❌ "没有 `POST /messages`（全局）" —— 故意的。消息总是绑 topic，所以走 `POST /topics/:topicId/messages`。
- ❌ "没有 `GET /assistants/:id/topics`" —— 故意的。Topic 列表走 `GET /topics?q=...`，靠 `Topic.assistantId` filter 在 service 内做。
- ❌ "没有 `POST /topics/:id/fork`" —— 故意的。fork 复用 `POST /topics` + `sourceNodeId` 字段。
- ❌ "没有 `PUT /topics/:id/pin`" —— 故意的。pin 是独立资源：`POST /pins` / `DELETE /pins/:id`（见 `topics.ts:39-43` 的 UpdateTopicSchema 注释）。

## 6. 引用

- 端点 schema：`packages/shared/data/api/schemas/{topics,messages,temporaryChats,assistants,agents,agentChannels}.ts`
- handler 实现：`src/main/data/api/handlers/{topics,messages,temporaryChats,assistants}.ts`
- handler 索引：`src/main/data/api/handlers/index.ts`
- service：`src/main/data/services/{TopicService,MessageService,AssistantService,TemporaryChatService}.ts`
- renderer 桥：`src/renderer/src/services/db/DataApiMessageDataSource.ts`
- renderer 写入点：`src/renderer/src/services/messageStreaming/StreamingService.ts`、`src/renderer/src/pages/home/Inputbar/Inputbar.tsx:328`
- renderer hook 入口：`src/renderer/src/data/hooks/useDataApi.ts`
