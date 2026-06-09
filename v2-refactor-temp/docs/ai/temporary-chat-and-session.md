# Temporary Chat / Temporary Session 架构设计

## 1. 范围

本文记录 temporary-chat 后端设计，用于对齐临时 topic、临时 agent session、workspace source，以及配置变更时 update 还是 recreate 的取舍。

它依赖 `CherryHQ/cherry-studio#15736` 中的 session/workspace 规范：

- session create/delete 只维护数据库记录和 workspace 绑定关系。
- user-owned workspace 的真实目录只校验，不自动创建，也不删除。
- system-owned workspace 的真实目录由 runtime 启动前按需创建，并且必须位于应用管理的 system workspace root 下。
- session create/delete 不处理真实文件目录。
- 创建 session 必须显式声明 workspace 来源，不能再隐式继承 latest session workspace。

temporary-chat 这里补齐的是临时资源层：

- 临时 chat topic 如何存在、发消息、持久化。
- 临时 agent session 如何存在、绑定 workspace source、切换 workspace / agent、持久化。
- 临时资源何时 update，何时 delete + create。
- 当前分支哪些实现需要按上述规范调整。

当前 PR 的范围只包含 temporary topic / temporary session 的 backend/shared contract/main-side memory service 设计与实现对齐。

当前 PR 不包含：

- 正式 agent session create/delete 重构。
- workspace row type / workspace source schema 的基础定义。
- user/system workspace 真实目录准备、校验、清理策略。
- task/channel 创建 session 时的 workspace 传递。
- renderer 页面、hook、交互按钮和 chat-page 集成。

这些内容由 #15736 或后续 chat-page PR 负责。当前 PR 在 #15736 合入后只消费它提供的正式 session/workspace contract，不重复实现 workspace/session 基础架构。

本文中出现的 renderer 描述只用于说明调用方期望，不作为当前 PR 的实现清单。

本文用 `POST /temporary/...` 这样的路径描述当前 PR 的 DataApi/shared contract。这里不再引入窄 IPC 设计；需要对齐的是 service ownership：

- `POST /temporary/...` contract 可以保留在 DataApi/shared schema。
- temporary draft create/update/delete 只维护 main-owned memory state，不隐藏 runtime/filesystem side effect。
- 正式 topic/message/session 表写入应由对应 owning service 承担，temporary service 不应跨 domain 直接写表。

## 2. 核心概念

### 2.1 Temporary Topic

Temporary topic 是 chat 域的临时对话容器。

它的职责是保存一个还没有落库的 topic 和 message 列表：

- 生命周期短，只存在于 main 进程内存。
- 不写 SQLite，直到用户选择 persist。
- 保存 chat topic 元数据，例如 `id`、`assistantId`、`createdAt`、`updatedAt`。
- 保存该 topic 下的临时 messages。
- 支持普通 chat dispatch。
- 不支持普通 topic 的完整树结构能力，例如 branch tree、active node、分页、全文搜索。
- 不绑定 workspace。
- 不出现在左侧正式 topic 列表，因此没有用户可编辑 title。

Temporary topic 解决的是“临时对话不要污染正式会话列表和消息库”的问题。

### 2.2 Temporary Session

Temporary session 是 agent 域的临时 session draft。

它的职责是保存一个还没有落库的 agent session 草稿：

- 生命周期短，只存在于 main 进程内存。
- 不创建 `agent_session` row，直到用户选择 persist。
- 不创建 workspace row，直到 persist 需要创建正式 session。
- 不创建真实 workspace 目录。
- 保存 agent session draft 元数据，例如 `id`、`agentId`、`workspaceSource`、`createdAt`、`updatedAt`。
- 允许用户在正式创建前切换 agent 或 workspace。
- persist 成功后晋升为正式 `AgentSessionEntity`。
- 不出现在正式 session 列表，因此没有用户可编辑 title / description。

Temporary session 解决的是“agent session 创建流程中，用户可以先调整智能体和 workspace，不立即产生正式 session 数据”的问题。

### 2.3 两者不是父子关系

Temporary topic 和 temporary session 都属于 temporary-chat 这组临时能力，但它们不是父子关系：

- temporary topic 属于 chat message 流。
- temporary session 属于 agent session draft。
- temporary topic 不需要 workspace。
- temporary session 只保存 workspace source，不直接保证真实目录可用。
- 两者可以在同一个页面体验里配合使用，但数据模型和 ownership 应保持分离。

## 3. Workspace Source 设计

temporary session 不应该把两种 workspace 情况都压成 `workspaceId`。

它应该保存用户意图，也就是 workspace source：

```ts
type AgentSessionWorkspaceSource =
  | { type: 'user'; workspaceId: string }
  | { type: 'system' }
```

### 3.1 用户选择已有 workspace

当用户选择已有 workspace：

```ts
{ type: 'user', workspaceId: 'workspace-id' }
```

draft 阶段：

- temporary session 记录 `workspaceSource`。
- 可以读取 workspace row 返回给 renderer 展示。
- 不检查真实目录是否存在。
- 不创建真实目录。
- 不修改 workspace row。

persist 阶段：

- 创建正式 session，并绑定这个 `workspaceId`。
- 不创建 system workspace row。
- 不创建真实目录。

runtime 阶段：

- 加载正式 session。
- 对 user-owned workspace 执行目录校验。
- 目录不存在、不可访问、不是 directory 时直接报错。
- 不自动创建用户目录。

### 3.2 用户选择 No project

当用户选择不绑定用户 workspace：

```ts
{ type: 'system' }
```

draft 阶段：

- temporary session 记录 `workspaceSource`。
- 不生成 `workspaceId`。
- 不创建 workspace row。
- 不创建真实目录。
- 返回给 renderer 的 `workspace` 可以是 `null`。

persist 阶段：

- 创建正式 session。
- 同时创建一条 system-owned workspace row。
- 生成并保存该 system workspace 的 `path`。
- `path` 必须位于应用管理的 system workspace root 下。
- 正式 session 绑定新 workspace row。
- 不创建真实目录。

runtime 阶段：

- 加载正式 session。
- 对 system-owned workspace 执行 runtime preparation。
- 如果目录缺失，runtime 启动前创建目录。
- 创建前必须校验 path 位于 system workspace root 下。
- 目录存在但不是 directory，或创建/访问失败时，暴露 runtime 错误。

### 3.3 是否需要 workspaceId 绑定

temporary session draft 不应该强制绑定 `workspaceId`。

正确模型是：

- temporary session 绑定 `workspaceSource`。
- user source 携带 `workspaceId`。
- system source 不携带 `workspaceId`。
- persist 后，正式 `AgentSessionEntity` 必须绑定一个真实 workspace row。

也就是说：

- draft 层绑定用户意图。
- DB 层绑定 workspace row。
- runtime 层处理真实目录。

## 4. 完整功能描述

### 4.1 Temporary Topic 功能

temporary topic 支持以下能力：

1. 创建临时 topic。
2. 更新临时 topic 的 assistant 绑定。
3. 删除临时 topic。
4. 追加临时 message。
5. 读取临时 messages。
6. 在 full chat 场景下，于首条真实用户消息发送前 promote 成正式 topic。
7. 在 scratch 场景下，通过 temporary topic 发起临时 chat dispatch。
8. scratch dispatch 过程中把 assistant 响应追加回临时 message list。
9. 将临时 topic 和 messages persist 到正式 topic/message 表。

temporary topic 的核心限制：

- 不进入正式 topic list，直到 persist。
- 不写 message 表，直到 persist。
- 不参与 FTS，直到 persist。
- 不支持 branch tree。
- 不支持 active node。
- 不支持普通 topic 的分页/树查询 API。
- 不绑定 workspace。

### 4.2 Temporary Session 功能

temporary session 支持以下能力：

1. 创建临时 agent session draft。
2. 保存 agentId、workspaceSource。
3. 用户切换 workspace 时更新同一个 draft。
4. 用户切换 agent 时更新同一个 draft。
5. 用户取消时删除 draft。
6. 用户确认或发起真实 agent run 前 persist 成正式 agent session。
7. persist 成功后从内存移除 draft。
8. persist 失败时恢复 draft，避免用户丢失当前草稿。

temporary session 的核心限制：

- draft 阶段不写 `agent_session` 表。
- draft 阶段不创建 workspace row。
- draft 阶段不创建真实目录。
- draft 阶段不继承 latest session workspace。
- persist 之后不再允许作为 temporary session 修改。
- temporary session 本身不是消息容器，不直接承载 agent runtime。

## 5. 完整逻辑路径

### 5.1 Temporary Topic 创建和释放

renderer 侧通过临时 topic hook 创建 draft topic：

1. 页面进入临时对话场景。
2. renderer 调用 `POST /temporary/topics`。
3. main 侧 `TemporaryChatService.createTopic` 创建内存 topic。
4. renderer 持有 `topicId`。
5. 页面卸载或用户取消时调用 `DELETE /temporary/topics/:id`。
6. main 侧删除内存 topic 和 messages。

如果用户已经 persist，cleanup 不再删除该 topic。

### 5.2 Temporary Topic 发消息

temporary topic 的发送路径分两类，不能混成一个规则。

#### 5.2.1 Full chat：首条真实消息发送前 promote

在正式 chat-page / HomePage 场景里，用户真正发送第一条消息时，temporary topic 应先转成正式 topic，再继续发送消息：

1. renderer 持有 temporary `topicId`。
2. 用户输入第一条真实消息并点击发送。
3. renderer 在调用 stream send 前先调用 `persist temporary topic`。
4. main 侧把 temporary topic promote 成正式 topic。
5. temporary topic 从 main 内存移除。
6. 后续 stream 使用同一个 topic id 走正式 topic/message backend。
7. 用户消息和 assistant 响应写入正式 message 表。

这个场景下，真实用户消息不应该先写入 temporary message list 再转正。promotion 是首条真实发送前的边界。

#### 5.2.2 Scratch window：发送后仍保持 temporary

在 quick assistant、selection action 等 scratch 场景里，发送消息不代表用户要把对话保留进正式历史：

1. renderer 用 temporary `topicId` 发起 chat dispatch。
2. stream manager routing 发现该 `topicId` 属于 temporary topic。
3. `TemporaryChatContextProvider` 接管 dispatch preparation。
4. provider 拒绝 regenerate / continue 等依赖正式 message tree 的请求。
5. provider 解析当前 assistant 和 model。
6. provider 把用户消息 append 到 `TemporaryChatService`。
7. provider 读取完整临时 messages 作为上下文。
8. stream manager 正常执行模型请求。
9. `PersistenceListener` 使用 `TemporaryChatBackend`。
10. assistant 输出完成后 append 到 `TemporaryChatService`。

这个场景下，temporary topic 的 dispatch 只复用 stream manager，不复用正式 message persistence backend。关闭窗口或放弃时删除临时资源，不污染正式 topic/message 表。

因此 backend 不应把“append user message”硬编码成自动 promote。是否在首条消息前 promote，是调用方根据场景决定的策略。

### 5.3 Temporary Topic 持久化

用户选择保留临时对话时：

1. renderer 调用 `POST /temporary/topics/:id/persist`。
2. main 侧读取内存 topic 和 messages snapshot。
3. main 侧通过 topic/message owning service 在 DB transaction 中创建正式 topic 和 messages。
4. 成功后删除内存 topic 和 messages。
5. 返回正式 topic id。

失败处理：

- persist 前应先 snapshot。
- DB 写入失败时恢复内存状态。
- 失败不能让用户的临时对话丢失。

### 5.4 Temporary Session 创建

temporary session 创建时：

1. renderer 根据用户选择生成 `workspaceSource`。
2. renderer 调用 `POST /temporary/sessions`。
3. main 侧校验 `agentId` 存在。
4. main 侧解析 workspace source：
   - `type: 'user'` 时读取并校验 workspace row 存在。
   - `type: 'system'` 时不读取 workspace row。
5. main 侧创建内存 draft。
6. 返回 temporary session entity。

draft 返回结构应能表达两件事：

- 用户选择的 `workspaceSource`。
- 如果是 user workspace，返回可展示的 `workspace` row。

### 5.5 Temporary Session 更新

temporary session 更新用于“继续编辑同一个草稿”：

1. 用户切换 workspace。
2. 用户切换 agent。
3. renderer 调用 `PATCH /temporary/sessions/:id`。
4. main 侧校验变更字段。
5. main 侧更新同一个内存 draft。
6. main 侧刷新 `updatedAt`。
7. 返回更新后的 temporary session entity。

更新不会创建正式 session，不会创建 workspace row，也不会触碰真实目录。

temporary session 不提供 title / description 编辑。它不出现在正式 session 列表里，用户没有编辑入口；正式 session 名称应在 persist 时使用默认策略或后续正式 session API 处理。

### 5.6 Temporary Session 删除

temporary session 删除用于“放弃这个草稿”：

1. renderer 调用 `DELETE /temporary/sessions/:id`。
2. main 侧删除内存 draft。
3. 不写 DB。
4. 不删除 workspace row。
5. 不删除真实目录。

### 5.7 Temporary Session 持久化

用户确认创建正式 session，或准备发起真实 agent run 时：

1. renderer 调用 `POST /temporary/sessions/:id/persist`。
2. main 侧读取 draft snapshot。
3. main 侧重新校验 agent、model、workspace source。
4. main 侧调用纯数据层 session create。
5. 如果 source 是 user workspace，绑定已有 `workspaceId`。
6. 如果 source 是 system workspace，创建 system workspace row 后绑定。
7. 成功后删除内存 draft。
8. 返回正式 `AgentSessionEntity`。

真实 agent run 应发生在 persist 之后。temporary session 只表达 draft 配置，不负责 runtime workspace preparation，也不应直接承载 agent message/task execution。

persist 应尽量保留 draft id 作为正式 session id，避免 renderer 在确认后还要做 id remap。若底层 `AgentSessionService.create` 不支持传入 id，应补一个内部 create-from-draft 能力，而不是改回 workflow side effect。

失败处理：

- persist 前 snapshot draft。
- 创建正式 session 失败时恢复 draft。
- 不能先删除 draft 再让失败路径丢失用户输入。

### 5.8 正式 Session Runtime 准备

temporary session persist 后，后续运行 agent task 时走正式 session runtime：

1. runtime 加载正式 `AgentSessionEntity`。
2. runtime 读取 session 绑定的 workspace row。
3. runtime 调用类似 `prepareClaudeCodeWorkspaceDirectory(session)` 的准备函数。
4. user-owned workspace 只 assert。
5. system-owned workspace 先 ensure，再 assert。
6. 目录错误作为 runtime 错误返回。

temporary session 本身不做 runtime preparation。

## 6. Update vs Delete + Create 策略

统一原则：

- 用户是在编辑同一个 draft 时，走 update。
- 用户想重开一个全新的临时资源时，走 delete + create。
- update 不清空已有上下文。
- delete + create 表示 reset，会丢弃旧 draft 的内存状态。

### 6.1 切换 workspace

temporary session 切换 workspace 应走 update。

原因：

- draft 阶段没有 DB row。
- draft 阶段没有真实目录。
- workspace source 只是用户意图。
- 保留同一个 session id 可以避免 renderer 状态和路由抖动。
- 删除再创建会制造额外 cleanup 和竞态，但没有收益。

目标行为：

```http
PATCH /temporary/sessions/:id
```

body:

```ts
{
  workspace?: AgentSessionWorkspaceSource
}
```

如果用户切到已有 workspace：

```ts
{ workspace: { type: 'user', workspaceId } }
```

如果用户切到 No project：

```ts
{ workspace: { type: 'system' } }
```

### 6.2 切换 agent

temporary session 切换 agent 应走 update。

原因：

- 这是 draft 配置变化。
- 不需要丢弃 workspace source。
- 不需要重新创建 id。
- persist 时会用最新 agentId。

目标行为：

```ts
{
  agentId?: string
}
```

agentId 更新时：

- 校验 agent 存在。
- 保留当前 workspace source，除非请求同时传入 workspace。
- 刷新 `updatedAt`。

### 6.3 切换 chat assistant

temporary topic 切换 assistant 应走 update。

目标行为：

```http
PATCH /temporary/topics/:id
```

body:

```ts
{
  assistantId?: string
}
```

含义：

- 更新 topic metadata。
- 影响后续 dispatch 使用的 assistant/model。
- 不重写已经存在的临时 messages。
- 不清空上下文。

如果产品希望“换 assistant 后从空白上下文重新开始”，那是 reset 行为，应 delete 当前 topic，再 create 新 topic。

### 6.4 Discard / Fresh Draft

delete + create 只表示“丢弃当前临时状态，并开启一个新的空白 draft”。

以下情况可以走 delete + create：

- 当前 temporary topic 已经有 messages，用户明确要开启新的空白临时对话。
- 当前 temporary session 已经有用户选择过的 agent/workspace draft 状态，用户明确放弃并重开。
- UI 需要清空 temporary topic messages。
- UI 需要清空 temporary session draft 的 agent/workspace 选择状态。
- persist 成功后再次进入新的临时体验。

以下情况不应该 delete + create：

- 用户只是切换 assistant / agent / workspace。
- 用户在同一个空白临时资源上重复点击“新建”。
- 当前 draft 没有 messages，也没有用户选择过的 agent/workspace 状态。

单窗口场景下，重复点击“新建”如果没有可丢弃状态，应是 no-op 或 UI 层 debounce，不应该不断创建新的 main 内存资源。

多窗口场景下，temporary topic/session 可以同时存在多个，因为 main 侧用 id-indexed memory map 保存临时资源。每个窗口或流程应只持有自己的 id，并在放弃、卸载或 persist 后清理自己的临时资源。

delete + create 是显式 discard/reset，不是普通配置更新。

### 6.5 Active Run 期间的更新

update 只保证影响后续操作，不应该重写已经开始的 runtime：

- temporary topic 已经发起的 stream 使用 dispatch start 时解析到的 assistant/model。
- stream 期间更新 assistantId，不应该影响该 stream 的 listener/backend。
- UI 可以在 active stream 期间禁用 assistant 切换，减少体验歧义。
- temporary session 正在 persist 时不应允许并发 update/delete。

## 7. API Contract 目标形态

### 7.1 Temporary Topic API

保留当前 temporary topic API 形态：

```http
POST   /temporary/topics
PATCH  /temporary/topics/:id
DELETE /temporary/topics/:id
POST   /temporary/topics/:topicId/messages
GET    /temporary/topics/:topicId/messages
POST   /temporary/topics/:id/persist
```

非目标 API：

```http
GET /temporary/topics/:id
GET /temporary/topics
PUT /temporary/topics/:id/active-node
GET /temporary/topics/:topicId/tree
```

temporary topic 是短生命周期内存资源，不做完整 topic 查询面。

### 7.2 Temporary Session API

目标 API：

```http
POST   /temporary/sessions
PATCH  /temporary/sessions/:id
DELETE /temporary/sessions/:id
POST   /temporary/sessions/:id/persist
```

非目标 API：

```http
GET /temporary/sessions/:id
GET /temporary/sessions
```

temporary session 是 renderer 当前流程持有的 draft，不提供跨流程 list/read。

### 7.3 Shared Schema

temporary session 请求体应复用 agent session workspace source 语义：

```ts
type CreateTemporarySessionDto = {
  agentId: string
  workspace: AgentSessionWorkspaceSource
}

type UpdateTemporarySessionDto = {
  agentId?: string
  workspace?: AgentSessionWorkspaceSource
}

type TemporarySessionEntity = {
  id: string
  agentId: string
  workspaceSource: AgentSessionWorkspaceSource
  workspace: AgentWorkspaceEntity | null
  createdAt: string
  updatedAt: string
}
```

请求字段建议使用 `workspace`，与正式 `CreateAgentSessionDto` 保持一致。

响应字段建议使用 `workspaceSource`，避免和已解析出来的 `workspace` row 混淆。

不要继续使用：

```ts
workspaceId?: string
workspaceMode?: 'user' | 'system'
```

原因：

- `workspaceMode: 'system'` 加 `workspaceId` 的组合需要额外 refine 才能排除非法状态。
- `workspaceMode: 'user'` 但缺失 `workspaceId` 也是非法状态。
- `{ type: 'user'; workspaceId } | { type: 'system' }` 能在类型层表达互斥关系。
- 与 #15736 的正式 agent session 创建规范一致。

## 8. Code Ownership 目标设计

### 8.1 TemporaryChatService

`TemporaryChatService` 拥有 temporary topic 的内存状态：

- `topics`
- `messages`
- create/update/delete topic
- append/list messages
- 为 persist 提供 snapshot 和内存清理

它不应该知道 agent session workspace。

它也不应该直接跨 domain 写正式 topic/message 表。promotion 阶段应委托 topic/message owning service，或放到一个明确的 promotion/orchestration 层里，但写表 ownership 仍然要清楚。

调整前旧实现文件在 `src/main/data/services/TemporaryChatService.ts`。它不是 DB table owner，不应该继续放在 `data/services`。

### 8.2 TemporaryChatContextProvider

`src/main/ai/streamManager/context/TemporaryChatContextProvider.ts` 继续负责 temporary topic dispatch：

- 判断 topicId 是否属于 temporary topic。
- 拒绝不支持的 tree/branch 操作。
- 解析 assistant/model。
- append 用户消息。
- 读取临时 messages。
- 组装 `TemporaryChatBackend` persistence listener。

它不应该创建 agent session，也不应该准备 workspace 目录。

### 8.3 TemporaryChatBackend

`src/main/ai/streamManager/persistence/backends/TemporaryChatBackend.ts` 继续负责把 assistant 输出写回临时 message list。

它只写 `TemporaryChatService`，不写正式 message 表。

### 8.4 TemporaryAgentSessionDraftService

`TemporaryAgentSessionDraftService` 应拥有 temporary session draft 的内存状态：

- `sessions: Map<string, TemporarySessionRow>`
- create/update/delete draft
- persist draft
- persist 失败恢复 draft

目标 row：

```ts
type TemporarySessionRow = {
  id: string
  agentId: string
  workspaceSource: AgentSessionWorkspaceSource
  createdAt: string
  updatedAt: string
}
```

它可以依赖：

- `agentService`：校验 agent。
- `agentWorkspaceService`：解析 user workspace row。
- `agentSessionService`：persist 时创建正式 session。

它不应该依赖：

- `AgentSessionWorkflowService`
- workspace directory service
- runtime settings builder
- 任何真实 filesystem 操作

调整前旧实现文件在 `src/main/services/agentWorkspace/TemporarySessionService.ts`。它不是 workspace filesystem workflow，也不应该继续挂在 `agentWorkspace` 目录下。

### 8.5 上游 AgentSessionService 依赖

#15736 负责把正式 session create/delete 调整为纯数据层语义：

- 显式接收 `workspace: AgentSessionWorkspaceSource`。
- user source 绑定已有 workspace row。
- system source 创建 system workspace row 并绑定。
- 不创建真实目录。
- 不删除真实目录。
- 不隐式继承 latest workspace。

当前 PR 不要求 temporary session persist 保留 draft id；为了最少代码，persist 可以调用上游已经对齐后的正式 `AgentSessionService.create`，由正式 session create 生成正式 id。

如果后续产品或 renderer 状态机需要保留 draft id，应该在纯数据层补内部能力，例如：

```ts
createFromTemporaryDraft(draft)
```

或让 create 支持内部可选 id。不要为了保留 id 重新走 workflow side effect。

这不是当前 PR 要重新设计的正式 session/workspace 基础架构。当前 PR 只需要在 temporary session persist 时调用上游已经对齐后的正式 `AgentSessionService`，并接受 persist response 返回的正式 `AgentSessionEntity`。

### 8.6 目录 / 命名规划

调整前 temporary topic / session 涉及的目录比较分散：

| 当前路径 | 当前内容 | 判断 |
| --- | --- | --- |
| `src/main/data/services/TemporaryChatService.ts` | temporary topic/message 的 main 内存状态 | 位置不对；不是 SQLite-backed data service |
| `src/main/data/api/handlers/temporaryChats.ts` | temporary topic/session 的 DataApi handler | 位置可保留；它是当前 PR 的 route contract 入口 |
| `src/shared/data/api/schemas/temporaryChats.ts` | temporary topic/session 的 shared route schema | 位置可保留；它定义当前 DataApi contract |
| `src/main/ai/streamManager/context/TemporaryChatContextProvider.ts` | temporary topic 的 stream dispatch context | 位置正确；属于 stream manager 接入 |
| `src/main/ai/streamManager/persistence/backends/TemporaryChatBackend.ts` | temporary topic 的 stream persistence backend | 位置正确；属于 stream manager persistence backend |
| `src/main/services/agentWorkspace/TemporarySessionService.ts` | temporary agent session draft 的 main 内存状态 | 位置不对；不是 workspace directory workflow |
| `src/main/services/agentWorkspace/AgentSessionWorkflowService.ts` | session/workspace 创建 workflow | 上游 #15736 会移除/取代这类 workflow；当前 PR 不应继续依赖它 |

#15736 合入后，目录建议重新收束为：

| 目标路径 | 放什么 | 理由 |
| --- | --- | --- |
| `src/main/ai/temporaryChat/TemporaryChatService.ts` | temporary topic/message 的内存状态、lease/update/delete、snapshot/promotion orchestration | temporary chat 是 AI runtime 临时资源，不是 DB table owner |
| `src/main/ai/temporaryChat/__tests__/TemporaryChatService.test.ts` | temporary topic service tests | 测试跟随 domain module |
| `src/main/ai/agentSession/TemporaryAgentSessionDraftService.ts` | temporary agent session draft 的内存状态、agent/workspace source update、persist orchestration | temporary session 属于 agent session draft，不属于 workspace filesystem |
| `src/main/ai/agentSession/__tests__/TemporaryAgentSessionDraftService.test.ts` | temporary session draft tests | 复用现有 `agentSession` domain |
| `src/main/ai/streamManager/context/TemporaryChatContextProvider.ts` | scratch temporary topic dispatch context | 保持在 stream manager；它是 dispatch routing 接入点 |
| `src/main/ai/streamManager/persistence/backends/TemporaryChatBackend.ts` | scratch temporary topic stream persistence backend | 保持在 stream manager persistence backend |
| `src/main/data/services/AgentSessionService.ts` | 正式 agent session DB create/delete/update | 保持 data service；这是 DB table owner |
| `src/main/data/services/AgentWorkspaceService.ts` | 正式 workspace DB row 管理 | 保持 data service；这是 DB table owner |
| `src/main/data/services/AgentSessionMessageService.ts` | 正式 agent session message DB 写入 | 保持 data service；这是 DB table owner |
| `src/main/data/services/MessageService.ts` / topic owning service | 正式 chat topic/message 写入 | 保持 data service；temporary promotion 只能委托它们 |

命名规则：

- domain directory 用 camelCase，例如 `temporaryChat`、`agentSession`、`streamManager`。
- service class 文件用 PascalCase，并与 class 名称一致。
- `TemporaryChatService` 可以保留这个名字，因为它只管理 temporary chat topic/message。
- `TemporarySessionService` 应改名为 `TemporaryAgentSessionDraftService`，避免和 chat session、正式 session runtime 混淆。
- `temporaryChats.ts` shared schema 和 DataApi handler 可以保留；不要把它们描述成过渡到 IPC 的中间态。

## 9. 当前分支对齐清单

### 9.1 消费 #15736 workspace source contract

旧实现的 temporary session 使用 `workspaceId` / `workspaceMode` 的组合。#15736 合入后，temporary session contract 需要消费上游的 `AgentSessionWorkspaceSource`，不要在本 PR 里重复定义正式 session/workspace 基础 schema。

需要调整：

- `src/shared/data/api/schemas/temporaryChats.ts`
- `src/shared/data/api/schemas/__tests__/temporaryChats.test.ts`
- 当前 backend/shared contract 中 temporary session 的请求体

目标是统一使用：

```ts
workspace: { type: 'user', workspaceId }
workspace: { type: 'system' }
```

### 9.2 TemporarySessionEntity 改成 workspaceSource

旧实现的 temporary session response 用 union 表达：

- user draft 带 `workspace`
- system draft 带 `workspaceMode`

需要改成稳定结构：

```ts
workspaceSource: AgentSessionWorkspaceSource
workspace: AgentWorkspaceEntity | null
```

这样 renderer 不需要从多个字段推断用户选择。

### 9.3 增加 PATCH /temporary/sessions/:id

旧实现的 temporary session 只有 create/delete/persist。

需要补：

```http
PATCH /temporary/sessions/:id
```

用于：

- 切换 workspace。
- 切换 agent。

不要用 delete + create 表达普通配置变化。

当前 PR 不需要为 temporary topic/session 增加 title / description 编辑能力；临时资源不出现在左侧正式列表，用户没有编辑入口。

### 9.4 TemporaryAgentSessionDraftService persist 去掉 workflow dependency

旧实现的 `TemporarySessionService.persist` 调用 agent session workflow。

需要改成调用纯数据层 create：

- 不创建真实目录。
- 不删除真实目录。
- 不把 temporary session persist 变成 filesystem orchestration。
- 成功后删除 draft。
- 不要求正式 session id 沿用 draft id。
- 失败时恢复 draft。

这也是和 #15736 的核心对齐点。

### 9.5 更新 temporaryChats handler 注释和 ownership

旧实现的 handler 注释表达“persist drafts runs workflow side effects”。

需要更新为：

- temporary topic 逻辑在 `TemporaryChatService`。
- temporary session draft 逻辑在 `TemporaryAgentSessionDraftService`。
- persist 只晋升为正式数据。
- runtime/filesystem side effect 不属于 temporary-chat handler。

### 9.6 目录和文件命名对齐

当前分支需要按 ownership 调整目录：

- `src/main/data/services/TemporaryChatService.ts` 移到 `src/main/ai/temporaryChat/TemporaryChatService.ts`。
- `src/main/data/services/__tests__/TemporaryChatService.test.ts` 移到 `src/main/ai/temporaryChat/__tests__/TemporaryChatService.test.ts`。
- `src/main/services/agentWorkspace/TemporarySessionService.ts` 改为 `src/main/ai/agentSession/TemporaryAgentSessionDraftService.ts`。
- `src/main/services/agentWorkspace/__tests__/TemporarySessionService.test.ts` 改为 `src/main/ai/agentSession/__tests__/TemporaryAgentSessionDraftService.test.ts`。
- 所有 import 和 test mock 跟随新路径更新。
- 如果 `src/main/services/temporaryChat/` 没有实际文件，应删除这个空目录，不作为目标路径。

命名上不要继续使用过泛的 `TemporarySessionService`。这里的 session 是 agent session draft，推荐 `TemporaryAgentSessionDraftService`。

### 9.7 TemporaryChatService.persist 写表 ownership

当前 `TemporaryChatService.persist` 如果直接写正式 topic/message 表，需要调整 ownership：

- temporary service 负责内存 snapshot。
- 正式 topic row 由 topic owning service 创建。
- 正式 message rows 由 message owning service 创建。
- transaction 可以由 orchestration 层包住，但不要让 temporary service 成为 topic/message 表 owner。

这和 temporary session persist 调用 `AgentSessionService` 是同一原则。

### 9.8 后续 chat-page PR 的 renderer 状态策略

当前 PR 不包含 renderer 页面和 hook 接入；以下内容留给后续 chat-page PR。

后续 renderer 侧需要统一为：

- 创建临时资源：POST。
- 编辑当前临时资源：PATCH。
- 放弃/重开：DELETE + POST。
- 确认保留：persist。
- 重复点击新建但当前 draft 为空：no-op 或 debounce。

如果还没有 dedicated `useTemporarySession` hook，建议补一个对应 hook，避免页面里手写 create/update/delete/persist 状态机。

### 9.9 测试需要同步

需要更新或新增 targeted tests：

- `src/shared/data/api/schemas/__tests__/temporaryChats.test.ts`
- `src/main/data/api/handlers/__tests__/temporaryChats.test.ts`
- `src/main/ai/temporaryChat/__tests__/TemporaryChatService.test.ts`
- `src/main/ai/agentSession/__tests__/TemporaryAgentSessionDraftService.test.ts`
- agent session workspace source 相关 tests

renderer hook / page tests 不属于当前 PR，后续 chat-page 接入时再补。

重点覆盖：

- user workspace source parse。
- system workspace source parse。
- 禁止旧的 `workspaceMode` contract。
- PATCH temporary session 更新 agent。
- PATCH temporary session 更新 workspace。
- persist 成功清理 draft。
- persist 失败恢复 draft。
- persist 不调用 workflow/directory side effect。
- temporary topic persist 不跨过 topic/message owning service 直接写表。
- temporary service imports 不再指向 `data/services` 或 `services/agentWorkspace` 的旧路径。

### 9.10 Rebase / migration 注意事项

#15736 和本分支都涉及 agent session / workspace schema 变更，rebase 后如果 migration 冲突：

- 删除本分支冲突的本地 migration SQL 和对应 snapshot。
- 重新生成 migration。
- 不要重命名 migration 文件。
- 不要手改 snapshot 规避链路冲突。

## 10. 最终结论

temporary-chat 的完整设计是：

- temporary topic 管临时 chat topic/messages。
- temporary session 管临时 agent session draft。
- temporary topic 不绑定 workspace。
- temporary session 绑定 workspace source，而不是强制绑定 workspaceId。
- 用户切换 workspace/agent/assistant 时，默认 update 当前临时资源。
- 只有 reset / 放弃 / 新建时才 delete + create。
- full chat 的首条真实消息发送前，应先把 temporary topic promote 成正式 topic。
- scratch 场景的 temporary topic 发送后仍保持临时，除非调用方显式 persist。
- 真实 agent run 前，应先把 temporary session persist 成正式 session。
- persist 是临时资源晋升正式数据的边界，但不是 backend append message 时自动触发的隐式副作用。
- create/update/delete draft 不做 filesystem side effect。
- 正式 session 的真实目录准备属于 runtime。
- system workspace 的真实目录按需创建，user workspace 的真实目录只校验。
- temporary in-memory 服务应从 `data/services`、`services/agentWorkspace` 收束到 `main/ai` domain。
- 本分支主要需要从 `workspaceMode`、workflow persist、缺少 PATCH session、目录/命名 ownership 四个方向对齐。
