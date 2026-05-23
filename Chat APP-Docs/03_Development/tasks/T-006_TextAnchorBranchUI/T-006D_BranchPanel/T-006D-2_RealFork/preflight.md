# T-006D-2B Preflight — 四块承重墙验证 + 架构修正

> 写于 2026-05-21。本轮**只读代码 + 改方案 + 改文档，不改业务代码**。
>
> 两条贯穿全文的硬产品约束：
> 1. **branch topic 不能污染左侧 topic 侧边栏**
> 2. **buildBranchPrompt 包装后的模板对用户不可见**（团队成员离线调优，不进 i18n）

## 0. TL;DR — 关键结论

| 承重墙 | 关键发现 | 决策 |
|---|---|---|
| **W1** 流式数据流 | 写读同源 = Redux `messages` slice，按 topicId 索引；与 active topic 无关 | side panel 用 `useTopicMessages(branchTopicId)` 实时跟流；**复用 MessageGroup**，不复用 `Messages.tsx`（事件监听器会重复触发） |
| **W2** LLM 上下文是否含祖先 | **不含**。`fetchAndProcessAssistantResponseImpl:865-883` 只读 `selectMessagesForTopic(state, topicId)`，即新 topic 内仅有 1 条 user 消息 | buildBranchPrompt 是**强制刚需**（无之模型完全瞎）；主目标可注入（源 topic 首 user message 可读） |
| **W3** prompt 隐藏 | `messageThunk.ts:855-857` 把 `topic.prompt` 拼到 `assistant.prompt` 系统提示，不进 user message body | **模式 A 通过 `topic.prompt` 槽位**，零 core 修改。user message body = 干净 followUp；selectedText + 指令走 system prompt |
| **W4** 侧边栏暴露 | 侧边栏读 `assistant.topics`(Redux)；DELETE /topics 存在；v1 NEW_BRANCH 走同一 addTopic 路径且无任何区分字段 | **路径 Y**：关闭 BranchPane → `DELETE /topics/:id` + `dispatch(removeTopic(...))`；MVP 只在 stream 完成后允许关闭 |

→ **架构方案 v2（架构方案.md）的"复用 Messages.tsx"和"selectedText 内联到 user message"两条都要改**。新方案在 §5。

---

## 1. 承重墙一：流式数据流向 + side panel 读源

### 1.1 流式写入目标

`StreamingService.ts:322` 把每个 block 增量 `store.dispatch(upsertOneBlock(block))` 写入 Redux。`messageThunk.ts:233/438` 用 `newMessagesActions.updateMessage(...)` 更新 message 元数据。两者都通过 dispatch 进入 Redux，**目标 store = `state.messages`**。

证据：

- `StreamingService.ts:322` `store.dispatch(upsertOneBlock(block))`
- `messageThunk.ts:233-237` `newMessagesActions.updateMessage({ topicId, messageId, updates })`
- 索引键：`state.messages.messageIdsByTopic[topicId]`（`newMessage.ts:319`）

→ **流式写入按 topicId 分桶；与全局 active topic 无关。**

### 1.2 side panel 读源

`useTopicMessages(topicId)`（`useMessageOperations.ts:467`）→ `selectMessagesForTopic(state, topicId)`（`newMessage.ts:316`）→ 同一个 `state.messages` slice。

→ **写读同源 = Redux `state.messages` 按 topicId 索引**。branch panel 用 `useTopicMessages(branchTopic.id)` 拿到的就是流式增量，实时可见。

### 1.3 sendMessage 是否依赖 active topic

`messageThunk.ts:990`(sendMessage) 接收 `topicId: Topic['id']` 参数；内部 `selectMessagesForTopic(getState(), topicId)`（line 865）按入参 topicId 读。**唯一隐式依赖**是 line 854：

```ts
const topic = origAssistant.topics.find((t) => t.id === topicId)
```

→ topic 必须在 Redux `assistant.topics[]` 里（否则 `topic.prompt` 拼接段拿不到，但发送本身仍能进行）。**D-2A 已通过 `addTopic` 注册，这条满足。**

→ **sendMessage 不读 active topic。** branchTopic ≠ activeTopic 时流式正常。

### 1.4 复用 Messages.tsx 不可行 — 改用 MessageGroup

`Messages.tsx:138-217` 注册了一坨 EventEmitter 监听器：

- SEND_MESSAGE / CLEAR_MESSAGES / COPY_TOPIC_IMAGE / EXPORT_TOPIC_IMAGE / NEW_CONTEXT / **NEW_BRANCH** / EDIT_CODE_BLOCK

两个 `<Messages>` 同时挂载意味着 **每个事件触发两次** —— NEW_BRANCH 一次会创建 2 个新 topic（破坏性）；CLEAR_MESSAGES 会弹 2 个确认 modal。

**最小渲染方案**：复用 `MessageGroup`（`MessageGroup.tsx:29`）+ `getGroupedMessages`（`MessagesService.ts`）。MessageGroup 单独可挂载，依赖只有：

- `useChatContext(topic)` — topic 范围
- `useMessageOperations(topic)` — topic 范围
- 不注册全局 EventEmitter

→ side panel 用 ~30 行壳子做：`useTopicMessages(branchTopicId)` → `getGroupedMessages(...)` → `<MessageGroup .../>` 。无需 InfiniteScroll / NarrowLayout / ChatNavbar / 等 Messages.tsx 的外围。

### W1 结论

| 问题 | 答案 |
|---|---|
| branch panel 读哪条数据源？ | Redux `state.messages` via `useTopicMessages(branchTopic.id)` |
| 能否实时显示流？ | 能。写读同源，流式 dispatch 即时反映 |
| 是否避免 useTopicMessages？ | **不避免**。useTopicMessages 就是正确入口；要避免的是 `Messages.tsx` 壳子 |
| 最小渲染方案 | 用 `MessageGroup` 复用渲染链路；新写 `BranchMessageStream` 约 30 行壳子（拿 messages + group + map） |

---

## 2. 承重墙二：sourceNodeId 是否进入 LLM 上下文

### 2.1 发送链路追溯

```text
sendMessage(thunk)                       ← messageThunk.ts:982
  └ fetchAndProcessAssistantResponseImpl ← :846
      └ selectMessagesForTopic(state, topicId).slice(0, userIndex+1)  ← :865-882
      └ transformMessagesAndFetch({ messages, ... })  ← :940
          └ ConversationService.prepareMessagesForModel(messages, assistant)  ← ApiService.ts:168
              └ filterMessagesPipeline + convertMessagesToSdkMessages   ← ConversationService.ts:53
          └ fetchChatCompletion({ messages: modelMessages, ... })  ← ApiService.ts:194
```

**全链路只读 Redux 中该 topic 的消息**。`sourceNodeId` / `activeNodeId` / message.parentId 在这条路径里**没有任何引用**（grep 验证）。

### 2.2 fresh branch 实际给模型看到什么

新 branch topic 刚被 `addTopic` 注入 Redux，`state.messages.messageIdsByTopic[branchTopicId]` 仅有刚发的 1 条 user message。

→ **模型收到的 messages 数组里只有 1 条：用户的 followUp**。源 topic 的 assistant message、selectedText、源对话全貌——一个都没有。

D-2A 架构方案里"通过 lineage 让模型知道上文"是**错的**。`sourceNodeId` 只决定 DB 层的 message.parentId 串起来便于将来 view-side lineage walk，**不会被发送链路消费**。

### 2.3 主目标注入可行性

主目标 = 源 topic 的首条 user message（"用户最初问的问题"）。

可获取性：`selectMessagesForTopic(store.getState(), sourceTopicId)` 在 branch fork 时 sourceTopicId 已知（= 当前 activeTopic.id）。第一条 role=user 的 message 取 mainTextContent 即可。

→ **可以注入。**

### W2 结论

| 问题 | 答案 |
|---|---|
| 第一轮发给模型的 messages 含原对话上下文？ | **否**。仅含新 user message |
| buildBranchPrompt 是否必须？ | **必须**。否则模型完全瞎 |
| 最小但够用的模板输入项 | ① 指令"围绕选区作答" ② **主目标**（源 topic 首 user message，截断 200 字） ③ 选区 selectedText ④ 用户追问 followUp |

注：「主目标」可选；先做 ①③④，验证模型够不够聚焦；不够再加 ②。**保留接口预留位**。

---

## 3. 承重墙三：prompt 隐藏 — 模式 A 通过 `topic.prompt`

### 3.1 发现 hook 点

`messageThunk.ts:855-857`：

```ts
const topic = origAssistant.topics.find((t) => t.id === topicId)
const assistant = topic?.prompt
  ? { ...origAssistant, prompt: `${origAssistant.prompt}\n${topic.prompt}` }
  : origAssistant
```

→ Redux 中 topic 上的 `prompt: string` 字段会被**拼到 assistant.prompt 系统提示尾部**，进系统消息，**不进 user message body**。

→ **天然就是"prompt 注入"槽位**。我们设置 `branchTopic.prompt = buildBranchSystemPrompt(...)`：

- ✅ 模型看到：system prompt 包含选区 + 指令 + 主目标
- ✅ 用户看到的 user message body：仅 followUp（干净）
- ✅ DB 持久化的 user message content：仅 followUp（干净）
- ✅ Redux 的 user message content：仅 followUp（干净）

### 3.2 与模式 B 的对比

| 维度 | 模式 A（topic.prompt 系统提示） | 模式 B（包装写入 user message + 视图替换） |
|---|---|---|
| 模型看到 selectedText | ✅ 通过 system prompt | ✅ 通过 user message body |
| 用户看到 user message | ✅ 干净 followUp | ❌ 包装模板（必须在视图层替换） |
| DB 持久化 | ✅ 干净 | ❌ 包装模板（"Open as full chat" 时泄漏） |
| Redux 状态 | ✅ 干净 | ❌ 包装模板 |
| 是否能复用 MessageGroup | ✅ 直接复用 | ❌ 必须对第一条 anchor message 做替换 |
| 改 core 文件 | 0 改 | 0 改（只改视图） |
| 后续多轮追问 | system prompt 持续生效（topic.prompt 是 Redux 持久态） | 每轮都要决定是否再次包装 |

→ **模式 A 全面优于 B**。

### 3.3 topic.prompt 的生命周期与已知限制

- topic.prompt 在 **Redux 内存里**（v1 holdover；v2 schema 还没这个字段）
- branch topic 是 v2，POST /topics 不会持久化 prompt
- **后果**：若 user 关闭 + 重开 app（且分支已"graduate"保留），prompt 丢失，后续追问失去系统指令
- MVP 影响：分支按 W4 设计是关闭即 DELETE → prompt 寿命就是这一次会话，不存在跨 reload 场景
- 已知限制：**"graduate to full chat" 功能（如果将来加）需要把 prompt 写进某个 v2 字段或转成首条 system message**

### 3.4 模板文案落地位置

新建 **`src/renderer/src/utils/branchAnchor/buildBranchSystemPrompt.ts`**（纯函数 + 常量）：

```ts
// 团队成员可直接编辑下方 BRANCH_PROMPT_TEMPLATE 文案做离线调优；
// 不走 i18n（不是用户可见 UI 文本）；不走 cacheService / preference。

const BRANCH_PROMPT_TEMPLATE = `这是从一段已有对话中"展开的分支讨论"。
用户在主对话的某条助手回复中选中了下面这段内容，针对它进一步追问。
请围绕这段选区作答，不要泛泛展开。

【主对话主目标】
{mainGoal}

【选中内容】
{selectedText}`

export function buildBranchSystemPrompt(args: {
  selectedText: string
  mainGoal?: string  // 可选，没有则跳过该段
}): string { /* render template */ }
```

特点：

- 单文件、纯函数、零依赖（除字符串拼接）
- 模板字面量在文件顶部，**显眼**便于非开发的团队成员编辑
- 不进 i18n locale 文件（CLAUDE.md "All user-visible strings must use i18next" — 系统提示**非用户可见**，不在 i18n 范围）
- 不进 cacheService / preference / DB（不需要 runtime 调整）

### W3 结论

| 问题 | 答案 |
|---|---|
| 推荐模式 | **A**：用 `topic.prompt` 槽位注入系统提示 |
| 证据 | `messageThunk.ts:855-857` 天然 hook 点 |
| 是否破坏 W1 的 MessageGroup 复用方案 | **不破坏**。user message body 干净，可直接渲染 |
| 模板落地 | `utils/branchAnchor/buildBranchSystemPrompt.ts`，非 i18n |
| 已知限制 | topic.prompt 仅在 Redux 内存里；不跨 reload；若做 "graduate to full chat" 要规划持久化 |

---

## 4. 承重墙四：侧边栏暴露 + 持久化

### 4.1 侧边栏读源

`pages/home/Tabs/components/Topics.tsx:87` 用 `useAssistant(id).assistant.topics` —— 纯 Redux `state.assistants[].topics[]` 数组。

→ 任何写进 `assistant.topics` 的 topic 都会出现在侧边栏，**包括 v2 通过 addTopic 注入的 branch**。

### 4.2 是否有现成的 branch 区分字段

| 字段 | 现状 | 能否做 branch 判别 |
|---|---|---|
| `type?: TopicType`（`'chat' | 'session'`）| 现有枚举无 `'branch'` 值 | 可扩，但触 enum 改动 |
| `sourceNodeId` | DTO 字段，**仅请求时传**，不在 Topic entity / renderer Topic 上 | ❌ |
| `parentId` | shared Topic schema 无此字段 | ❌ |
| `pinned` / `prompt` / `isNameManuallyEdited` | 与 branch 语义无关 | ❌ |

→ **没有现成判别字段**。

### 4.3 v1 NEW_BRANCH 是否需要保护

`Messages.tsx:189-217`：v1 NEW_BRANCH 路径也调 `addTopic(getDefaultTopic(...))`。

`getDefaultTopic` 不设 `type` 字段。`getDefaultTopic(...)` 创建出来的 v1 branch topic 与普通 topic shape 完全相同。

→ **如果以"`assistant.topics` 里 v2-fresh-fork-的 entry 全部隐藏"为规则，可以做（用我们自加的 renderer-only flag），v1 NEW_BRANCH 不受影响。** 因为 v1 NEW_BRANCH 的 topic 由 `getDefaultTopic` 产生，不带新 flag。

### 4.4 路径 X vs Y 对比

| 维度 | 路径 X（隐藏并保留）| 路径 Y（关闭即删 DELETE /topics） |
|---|---|---|
| 实现 | 加 renderer-only `__branchAnchor: true` 标记 + 侧边栏 filter | 关闭时 `await dataApiService.delete('/topics/:id', ...)` + `dispatch(removeTopic(...))` |
| 一致性"关闭即丢" | ❌ 实际保留在 DB | ✅ 真的丢 |
| 失败模式 | 标记泄漏到其他读 `assistant.topics` 的地方（export / shortcut）| DELETE 网络失败 → Redux 已 remove，DB 残留 → 孤儿 |
| 与现有事件交互 | 标记被 `addTopic` reducer 当普通字段传递；其他代码可能忽略 | abort streaming + dispatch removeTopic + 服务端 cascade delete |
| 跨 reload | branch 仍在 DB；下次启动不在 Redux assistant.topics（v1 不读 v2 user 写的 topic），下下次某天 v2 全面迁移后会回来 | branch 已删；后台无残留 |
| Graduate 升级 | 简单：清 flag + setActiveTopic | 升级时跳过 DELETE，加 "Save" 按钮翻转语义 |
| 验证成本 | 需要审计所有 `assistant.topics` 读点，确认全都尊重 filter | 需要审计 close path 在 streaming/abort/失败时表现 |
| **MVP 推荐？** | ❌ 缺点：DB 累积、潜在 UI 泄漏 | ✅ **推荐**：符合 "关闭即丢" 语义；冷启动干净 |

### 4.5 路径 Y 实施约束

- **streaming 期间不允许关闭**：BranchPane 顶部 X 按钮在 `branchTopic.loading === true` 时 disabled
- **DELETE 失败处理**：toast 错误，Redux remove 仍执行（用户视觉关闭了），DB 残留进 cleanup task
- **Cascade**：`DELETE /topics/:id` 服务端会级联删除该 topic 下所有 messages（shared schema 文档已声明）
- **Redux**：同时 `dispatch(removeTopic({ assistantId, topic: { id, ... } }))` 让 `assistant.topics` 同步
- **Abort streaming**：当前 abortController 注册的是 userMessageId（`messageThunk.ts:925-926`）。关闭前要先 abort，再 DELETE

### 4.6 Cleanup tasks（后续）

| ID | 内容 | 触发条件 |
|---|---|---|
| **T-006D-2C-1** | DELETE 失败时的 retry 队列 / 启动时 sweep 孤儿 anchor branch topic | 用户报告 DB 累积 |
| **T-006D-2C-2** | streaming 期间关闭的 graceful abort + delete | UX 需求出现 |
| **T-006D-2C-3** | "Graduate this branch to full chat" 按钮 | 用户要求多轮分支 |
| **T-006D-2C-4** | 服务端 branch kind 字段（让 GET /topics 默认过滤） | sidebar 迁 v2 |

本轮全部**只记录**，不实施。

### W4 结论

| 问题 | 答案 |
|---|---|
| "关闭即丢" 准确表述？ | "**关闭即从 DB 与 Redux 双向删除**"，不只是隐藏 |
| 推荐路径 | **Y**：DELETE /topics + dispatch removeTopic |
| 是否误伤 v1 NEW_BRANCH | 不会。删除仅作用于我们自己 fork 出来的 branchTopic.id |
| 是否需要新字段或新端点 | 端点已有（DELETE /topics）；renderer 内存里仍可加一个 `__branchAnchor: true` flag 防止误删（如果未来出现"批量删除"逻辑）— MVP 不强求 |
| 若现有机制不支持 | 现有机制完全够用 |

---

## 5. 修正后的最小实施步骤（替代原 S1–S7）

| # | 步骤 | 可独立 demo | go/no-go 闸门 |
|---|---|---|---|
| **S1'** | 改造 `useBranchFork`：删 `setActiveTopic`，改成 `onCreated(newTopic)` callback；**首条 user message 用 clean followUp**（删 buildBranchPrompt 内联）；**同时给 newTopic 注入 `prompt` = buildBranchSystemPrompt(selectedText)**；buildBranchSystemPrompt 新建为纯函数 | 单测断言：`getUserMessage` 收到 content=clean followUp；`addTopic` 收到 topic.prompt 含 selectedText；sendMessage 收到 newTopic.id | hook 单测 4/4 过 |
| **S2'** | 上提 `branchAnchor + branchTopic` 到 Chat.tsx；删旧 BranchPanel Dialog；Messages.tsx 只 forward setBranchAnchor；占位空 div 作为 BranchPane stub | `pnpm dev`：选文本 → 右键 → Chat.tsx state 看到 anchor，**主对话不跳转**；旧 Dialog 不再弹 | 主对话视图保持稳定，不发生 setActiveTopic |
| **S3'** | 写 `BranchPane` 撰写态（`BranchComposer`）+ 接入 RowFlex sibling；点 Create → useBranchFork.fork → branchTopic 进 state | `pnpm dev`：右侧 panel 滑入（撰写态）；输入 → Create → 见 SWR cache 出新 topic + Redux state 多一个 branchTopic（侧边栏暂时会看到，下一步删）| POST /topics 真的命中；branchTopic 在 Redux |
| **S4'** | 加 `BranchMessageStream`（复用 MessageGroup + getGroupedMessages + useTopicMessages）；撰写态切对话态 | `pnpm dev`：Create 后右侧 panel 切到对话态，**branch 内模型回复流式可见**；同时检查模型回复是否聚焦 selectedText（W2 验证项）| **产品 go/no-go 闸门** — 模型聚焦才继续 |
| **S5'** | **侧边栏隐藏 + 关闭即删（路径 Y）**：BranchPane 关闭按钮：abort（若 streaming 已完，跳过）→ DELETE /topics/:id → dispatch removeTopic + 清 branchTopic state；侧边栏在 branchTopic 存在期间额外 filter 出该 id（双保险） | `pnpm dev`：创建后**侧边栏不出现新 topic**；关闭后 panel 收起，DB 里没残留 | 侧边栏全程不被污染（核心约束 #1）|
| **S6'** | 轻量高亮：BranchAnchorContext + MainTextBlock 加 `bg-accent` ring 高亮 | `pnpm dev`：源 assistant 整块 message tint；关闭后消失 | 视觉关联存在 |
| **S7'** | 测试 + 文档收口 + 提交 | `pnpm build:check` | 全过 |

**关键 go/no-go 闸门 = S4'**：如果模型不围绕 selectedText 回答，需要先调模板（W2 主目标注入 / W3 模板措辞）再继续。其他步骤都是纯工程。

---

## 6. 与架构方案 v2 的差异

| 项 | 架构方案 v2（之前）| Preflight 修正 |
|---|---|---|
| user message 内容 | `buildBranchPrompt(selectedText, followUp)` 包装后写入 user message body | **clean followUp**；模板走 `topic.prompt` 系统提示 |
| 模型上下文 | 假设 lineage 自动带原文 | **必须**显式经 topic.prompt 注入；不依赖 lineage |
| side panel 渲染 | "可能复用 Messages 或写小组件" | **复用 MessageGroup**（确认 Messages.tsx 不可复用 — 事件监听器冲突） |
| branch topic 持久化 | 模糊"关闭即丢" | 明确**路径 Y**：关闭 = DELETE /topics + Redux removeTopic |
| 侧边栏暴露 | 未充分讨论 | branchTopic 寿命内**额外侧边栏 filter**作为双保险 |
| 模板文案位置 | 散落在 useBranchFork 内字符串 | 独立模块 `utils/branchAnchor/buildBranchSystemPrompt.ts`；显式标注"非开发可改" |
| i18n | 模板曾考虑 i18n | **不进 i18n**（非用户可见） |

---

## 7. 已知限制与 cleanup tasks

| ID | 内容 | 触发条件 |
|---|---|---|
| L1 | branch topic.prompt 仅在 Redux 内存里，跨 reload 丢失 | "graduate to full chat" 功能要做时 |
| L2 | DELETE /topics 失败时 Redux 已 remove，DB 留孤儿 | 用户报告或冷启动 sweep |
| L3 | streaming 期间关闭被禁用（X disabled） | 用户希望"中途丢弃" |
| L4 | "主目标"是否注入还未验证（先做 ①③④ 三段） | S4' 模型回复不够聚焦 |
| L5 | renderer Topic 类型缺 `__branchAnchor` flag，全靠 branchTopic.id 本地 state 过滤 | 出现非"当前页面"侧边栏读取点 |

→ 全部记录到下方 §8 cleanup task list 而非 MVP 范围。

---

## 8. 后续 task 登记（不在 D-2B 范围）

| ID | 主题 |
|---|---|
| T-006D-2C-1 | DELETE retry / 孤儿 sweep |
| T-006D-2C-2 | streaming 期间关闭的 graceful abort + delete |
| T-006D-2C-3 | "Graduate this branch to full chat" 按钮 + topic.prompt 持久化策略 |
| T-006D-2C-4 | 服务端 branch kind 字段（让 GET /topics 默认过滤）|
| T-006D-2C-5 | **分支侧 `db.topics.update(branchTopicId, ...)` silently 0-rows**：`resendMessageThunk:1340` 和 `regenerateAssistantResponseThunk:1461` 在分支 topic 上写 Dexie，分支 topic 仅 v2 SQLite 不存在于 Dexie，update 0 rows 不抛错也不写入；产生静默状态不一致（不影响功能 gate）。最小修：thunks 内部 skip-Dexie when topic is a branch（需要识别机制）；或长期 = 分支 thunks 走纯 v2 路径 |
| T-006D-2D | 主目标注入开关（W2 第 ② 段；先做 ①③④ 验证后再加）|
| ~~T-006D-2E~~ | ~~精确子串 `<mark>` 高亮~~ — **2026-05-22 并入 S6' 完成**：D-011 修复时直接用 CSS Custom Highlight API 画选区精确 char range（`sourceHighlight.ts`），无需 `<mark>` DOM mutation |

streaming-disable Ask/Open（之前的 D-2B 含义）→ 改为 **T-006D-2C-0**（与本 D-2B 完全正交，可平行）。

---

## 9. 文档更新计划

- [x] 本文 `preflight.md` — 新建
- [ ] `T-006D-2_RealFork/README.md` — 把 D-2B 范围改为本 preflight 修正后版本；指 preflight 为新设计源头
- [ ] `T-006D-2_RealFork/架构方案.md` — 顶部加 deprecation 注，指向 preflight 为准（保留作 history 参考）
- [ ] `T-006D_BranchPanel/README.md` — D-2A 状态降级（"技术通但产品错位"）；D-2B 状态 = "preflight 完成，等批准实施"
- [ ] `T-006_TextAnchorBranchUI/README.md` — 顶部状态行同步
- [ ] `当前状态.md` — D-2A 重新打开；D-2B preflight 完成
- [ ] `下一步.md` — 优先级排到 D-2B S1' 实施
- [ ] `会话日志.md` — 加 preflight 轮

---

## 10. 一句话总结

> **D-2A 的实现路径正确但产品形态错（跳转 vs 并列）**；preflight 发现：(W1) 渲染层可清洁复用 MessageGroup；(W2) 模型不自动读祖先，buildBranchPrompt 是刚需；(W3) `topic.prompt` 是天然系统提示槽位，**模式 A 零侵入达成 prompt 隐藏**；(W4) `DELETE /topics` 存在，**关闭即 DELETE + Redux remove** 是最干净的"关闭即丢"。下一步按修正后的 S1'–S7' 执行，S4' 是产品闸门（模型聚焦验证）。
