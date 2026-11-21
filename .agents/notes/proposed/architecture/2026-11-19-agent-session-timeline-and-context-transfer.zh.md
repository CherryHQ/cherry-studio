# Agent Note: 智能体会话的 run、有序条目、变更游标与上下文传递

Status: proposed

[English](2026-11-19-agent-session-timeline-and-context-transfer.md) | 中文

## 问题

智能体会话需要三样东西，现有模型无法同时表达：能把对话转到另一个 harness 或模型的编排层；只读取、只渲染变化部分的历史读取与渲染；以及 steer 能形成稳定边界的 run 时间线。

在 Cherry `a83cd16c826bbd01b28ebe968e0015f5edd7b8ee`：

- 一个 assistant 行就是一次产品回复，横跨多条原生消息。[RootMessageProjection](../../../../src/main/ai/agentSession/RootMessageProjection.ts) 通过 `checkpointMapping.root` 中 `{ messageId, offset, count }` 形式的条目把原生来源映射到行；[ChildThreadProjection](../../../../src/main/ai/agentSession/ChildThreadProjection.ts) 维护基于下标的 `composition`。
- steer 会让回复换行。原生放置 steer 时，[AgentSessionRuntimeService](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) 中的 `reserveSteerContinuation` 结束当前回复，并在 steer 下面打开一个续写行。渲染端按数组下标给 part 设 key（[MessagePartsRenderer](../../../../src/renderer/components/chat/messages/blocks/MessagePartsRenderer.tsx) 中的 `${message.id}-part-${index}`）。
- [MessageProjection](../../../../src/main/ai/messages/MessageProjection.ts) 每 80 ms 合并一次，对整条消息做深比较，并发送完整的顺序。智能体历史页在每次数据变更后重新拉取（[useAgentSessionParts](../../../../src/renderer/hooks/useAgentSessionParts.ts)）。Markdown 每次更新都重新切分整段文字，按内容 memo 各个块（[parseLatexMarkdownBlocks](../../../../src/renderer/components/markdown/parseLatexMarkdownBlocks.ts)）。
- 在同一个 harness 内换模型会保留原生历史：pi-ai 的 `transformMessages` 适配 Pi 和 Pi Durable 的消息，Durable 连接在同一个 conversation 上重建。换 harness 不受支持：driver 会拒绝绑定在其他 runtime 上的分支（[durableContext](../../../../src/main/ai/runtime/piDurable/durableContext.ts)），而提议中的 [session runtime binding](https://github.com/CherryHQ/cherry-studio/blob/a74bb2dd95182cc9f063cac9798b4bdbb2590a8b/.agents/notes/proposed/architecture/2026-11-12-session-runtime-binding.md) 把绑定定为不可变。
- 产品历史只能经由 [readSessionHistory](../../../../src/main/ai/agentSession/sessionHistory.ts) 进入 harness，DeepSeek 导入依赖的就是它。它只在前缀中没有任何一行带原生身份时才运行，发送整条路径而没有总预算，也不记录投递了什么。

本 note 是 [runtime 契约](2026-10-17-agent-runtime-contract.md) 的细化。它部分取代 [message-list subscriptions](https://github.com/CherryHQ/cherry-studio/blob/f65c54cd6069caf5b1efa3c99ea1fe08ce543645/.agents/notes/proposed/architecture/2026-11-09-message-list-subscriptions.md) 中关于 steer、part 身份和游标的部分、[native steer](https://github.com/CherryHQ/cherry-studio/blob/ab83909a7c637c81c6d59221f76d1aad919d2add/.agents/notes/proposed/bug-fix/2026-11-09-agent-native-steer.md) 的渲染端切分模型，以及 session runtime binding 的不可变规则。[工具结果边界](../../implemented/architecture/2026-11-09-tool-result-projection-boundaries.md) 不变：它的发布 revision 仍是投递序号，与下文的存储游标相互独立。

## 提议

### 1. Run 负责执行，Timeline 负责内容

harness 放置触发输入时开始一次 run，在原生终态时结算。用现有 assistant 行作为 run 的物理记录，行 ID 即 run ID，上下文、状态、统计、模型和分支祖先关系都留在行上。排队时保留已持久化的输入 ID 和排队状态，放置时才作为 steer 加入活跃 run，或开启自己的 run。`replyId` 记录执行归属，`parentId` 记录祖先关系。steer 不预留续写行。迟到事实归原 run。后台唤醒若在原 run 结算后开启新的原生执行，则分配新 run ID。

时间线包含输入引用和输出 part。输入条目引用已有输入行。#24051 的 part 表是输出正文的唯一持久化来源。每个新增输出 part 恰好属于一个 run，有一个固定位置。导出、模型上下文等历史读取者可由适配器按需组装 `parts[]`。渲染分组独立于持久化归属。

根和子会话沿用同一契约，各子存档维护自己的顺序和版本。迁移保留消息 ID、分支和 fork 锚点、附件引用和已保存的 part ID。用已有的回复和 composition 事实确定历史 run 归属，证据不足时保留既有边界。在一个 run 的中间切分支或 fork 时，读取所选祖先路径及其条目截止位置，只共享 run 的前缀。将旧存档引用对应到 part ID 时，保留原始工具结果的归属。

### 2. 条目顺序与持久化提交

| 字段 | 分配时机 | 用途 |
| --- | --- | --- |
| `pos` | 放置输入或首次接纳 part 时分配一次 | 存档内的时间线顺序 |
| `rev` | 每个写事务分配一次，由该事务改变的行共享 | 持久历史游标 |

一个存档由一个 Main 所有者分配位置。将 part ID 和位置作为放置元数据一起保存。首次接纳时写入一次，或在首次提交一个依赖这个位置的后续条目时一起写入，例如 steer。这样即使前面的活跃 part 正文还没提交，恢复也能还原顺序。token 追加不写 SQLite。part 完成时原子写入变化的 part 及相关工具结果或附件引用。终态和 Stop 仅保存剩余已收到的 parts 并结算 run，保留已有 ID 和位置。保存成功后才发布相应事实。失败时保留可读的实时内容，供既有重试或终态路径处理。

时间线顺序在放置时固定。一个已经打开的 part 持续增长时仍留在后续 steer 的上方，新 part 按自己的位置出现。旧行依据既有证据按原来的展示顺序分配位置。切分支或改变界面分组时不重新分配位置。

### 3. 稳定的 part 身份和工具结果归属

首次接纳 part 时分配一个 ID，后续实时及持久化更新沿用这个 ID。原生键由上下文、规范化后的原生来源和块键共同确定。有 tool-call ID 或显式 data ID 时优先使用，原生下标只在块顺序稳定的原生来源内部使用。临时来源被提交后的来源替换时，由 adapter 报告明确的别名。接纳替换之前，别名必须解析到已接纳的 ID 和位置。无法证明对应关系时，在 adapter 边界校对该来源，或请求新基线。产品消息下标和展示分组 ID 都不承载存储身份。

Main、SQLite 和 Renderer 失效通知沿用同一 part ID 寻址当前工具结果。从原有的消息和 tool-call 归属迁移最新结果的关联，载荷留在现有 sidecar。提交前读取已接纳的实时结果，原子交接后读取持久化结果。结果替换只使对应 part 的结果缓存失效。新增写入用稳定的来源关联，旧 offset/count composition 仍可供既有历史和恢复读取。

### 4. 增量接纳、投递和恢复

Main 的 timeline 所有者接纳规范化的来源变化。一次应用直接产出变化的条目或文字后缀以及待持久化的内容。仍提供累积原生消息的 adapter 在入口处只校对变化的来源及其报告变化的块。持久化和发布按变化执行，无需重新扫描整条回复来推断变化。

```ts
type TimelineItem =
  | { kind: 'input'; inputId: InputId; runId: RunId; pos: Position }
  | { kind: 'part'; partId: PartId; runId: RunId; pos: Position; payload: CherryMessagePart }

type TimelineChange =
  | { type: 'insert'; item: TimelineItem }
  | { type: 'append'; partId: PartId; text: string }
  | { type: 'replace'; partId: PartId; payload: CherryMessagePart }
  | { type: 'remove'; itemId: InputId | PartId }
  | { type: 'settle'; runId: RunId; outcome: RunOutcome }
  | { type: 'result-changed'; partId: PartId }
```

Renderer 完整应用一个有序批次后，按条目或 run ID 通知订阅者。文字追加只通知受影响的 part。插入和移除同时通知顺序的消费者。Main 可按 part 合并待投递操作，无需重算当前视图。attach 和恢复用有作用域的完整基线。实时批次带独立的发布 revision 和发布身份，断档、未知目标或失效发布沿用现有基线恢复。

历史读取取得一致快照和它的提交游标。随后只返回游标之后变化的行，并在完整提交的边界推进游标。游标含视图作用域和存档重置版本。删除在同一事务中推进重置版本，切分支会改变视图作用域。即使读取方错过了失效通知，也会用旧游标拿到新基线。

Markdown 在每个文字 part 内处理。可以从最后一个不稳定块开始重新切分，链接引用定义等结构仍可能使更早的块失效。按 part 投递的性能验证独立于 Markdown 解析修改。

### 5. 经由会话消息的上下文传递

一个会话可以先后拥有多个根上下文，每个对应一个原生线程。某个上下文的覆盖范围，是 `context_id` 指向它的那些 run，加上投递进它的传递。

- 在同一个 harness 内换模型时保留上下文。原生历史和 pi-ai 的适配不变。
- 换 harness，或显式开一个新上下文时，会在目标 backend 中打开一个上下文。它的第一个 run 接收由会话消息构建的可移植历史，也就是 DeepSeek 导入已在使用的中枢。回到之前用过的上下文时，只投递它没有覆盖的那些 run。

`readSessionHistory` 成为这个构建器：

- 首次输入的初始化只在目标尚未有模型输入时执行。回到旧上下文时，只要目标还有未覆盖的 run 就要传递，包括目标已有模型输入的情况。[DeepSeek 导入](../../implemented/feature/2026-11-17-deepseek-agent-import.md) 记录当前首次输入路径。
- 它覆盖目标上下文未覆盖的范围；对新上下文则覆盖整条选中路径。
- 它满足一个由目标模型上下文窗口推出的总预算。按 [T3 的优先级](https://github.com/pingdotgg/t3code/blob/13aa882c22d584de5388dfce3b3ca413387ba059/packages/provider-core/src/server/handoffBudget.ts) 保留整条消息：最后一条用户消息、最后一条 assistant 消息、第一条用户消息，然后从新到旧。前言说明被省略的数量和 `pos` 范围。
- 它排除 reasoning 和隐藏的 data part。工具调用保留输入以及输出的首尾部分。
- 各 driver 保持各自的投递方式：Durable 写入它的 `cherry.reference-context` 条目，Pi 和 Claude Code 拼在第一条消息前面。

新增的 `agent_session_context_transfer` 记录存储 `kind`（`handoff` 或 `fork`）、来源会话、目标上下文、目标 run、`resolution`（`native` 或 `history`）、覆盖的 `pos` 范围、被省略的 ID、投递状态（`pending`、`delivered` 或 `failed`）以及创建时间。载荷由行重新生成，不存储。Main 在投递前写入 `pending`，在原生接纳后写入 `delivered`。重启后无法确认投递结果时，Main 打开一个新的目标上下文，而不是冒险重复投递历史，与 [T3 的投递](https://github.com/pingdotgg/t3code/blob/13aa882c22d584de5388dfce3b3ca413387ba059/apps/server/src/orchestration-v2/ContextHandoffDelivery.ts) 做法一致。同一 harness 内的 fork 走原生解析；跨 harness 的 fork 使用 `history`。

子任务不变：新建的子任务只接收任务 prompt，fork 的子任务在父的 backend 中原生 fork。跨 harness 的子任务以后再新增一种传递类型。

### 6. 归属与位置

| 位置 | 变更 |
| --- | --- |
| `AgentSessionRuntimeService` | 把 steer 挂到当前 run、移除续写预留、编排传递 |
| `RootMessageProjection`、`ChildThreadProjection` | 将原生键解析成稳定 part 并接纳 timeline 变化 |
| `AgentSessionMessageService` 与 schema | Run 和 part 存储、原子完成写入、游标读取 |
| `AgentSessionContextService` | 每个会话多个根上下文，以及传递记录 |
| `sessionHistory.ts` | 触发条件、范围、预算和排除规则 |
| `MessageProjection` 与渲染端 `aiTransport` | 按 part 寻址的 patch、有作用域的基线和按键订阅 |
| 渲染端列表与 Markdown | `pos` 顺序、part key 与增量块切分 |

### 7. 交付顺序

1. 本 Spec 放在栈底，连同 runtime 契约的修订。
2. 存储：复用 #24051 的 part 表，加入稳定的放置信息及 run 归属，迁移 sidecar 关联，遵循已发布迁移的追加规则。
3. 同次交付切换 Agent timeline：根和子会话接纳条目操作，复用 #24100 的完成写入，迁移按键投递与订阅，移除 Agent 的整消息热路径。
4. 验证迁移后的消费者，独立测量 Markdown。
5. 上下文传递与多个根上下文，session runtime binding 在它自己的分支里修订。
6. Electron 验收。只有这一层把 note 移到 implemented。

#23873 和 #23909 保持它们的工具结果范围。在切换时让 Agent 调用者使用工具 part 地址。message-list subscriptions 在它自己的那一层修订，在 steer 放置、part 身份和游标上以本 note 为准。

## 考虑过的替代方案

- run、attempt 或 turn 表，或每条原生 assistant 消息一行：要么重复已经带有状态、统计和模型的 assistant 行，要么增加本可由条目级身份关联的行数。
- steer 时按字符切分、把打开的 part 轮转成新段、或把进行中的工具重新分组到边界之后：每一种都会增加切分或移动状态，并带来重载时的重建义务。现在的 T3 改为在首次写入时固定位置。
- 用传输 revision 作为存储游标，或采用 T3 的完整事件日志：传输 revision 只在一个发布者和订阅内有效，而 T3 自己也会压缩删除被取代的事件，所以行上的 `rev` 不需要日志就能提供同样的游标。
- 从原生消息 ID 直接派生公开 ID：临时来源提交时可能被替换，直接派生会导致挂载中的 part 变更 key。沿用已接纳的身份，在入口处校对替换。
- 把产品历史转换成原生 Durable 条目，或做原生到原生的转换器：会话消息已经通过同一个构建器到达每个 harness。
- 默认使用 LLM 撰写的摘要，如 [#24704](https://github.com/CherryHQ/cherry-studio/pull/24704)：需要一次模型调用，质量也不稳定。它保留为兼容的可选策略。
- 回到某个 harness 时总是打开新上下文：会丢掉增量传递所保留的原生连续性。

## 验收标准

- AC1 — run 进行中被接受的 steer 通过 `replyId` 挂到该 run 上；不创建续写行，run 在原生终态时只结束一次（verification: unit；Main runtime 负责人）
- AC2 — 输入和 part 按 `pos` 顺序渲染：steer 之前创建的 part 在流式输出时仍留在它上方，之后的 part 渲染在下方，重载、第二个窗口和重连都重现同样的顺序（verification: unit 与 Electron；投影和渲染负责人）
- AC3 — 在 Claude Code、Pi 和 Pi Durable 上，同一个原生块在重连、快照替换和重启后解析到同一个 part ID；新写入不再添加 offset/count composition，遗留行保持可读（verification: harness 契约与 setupTestDatabase unit；runtime 负责人）
- AC4 — 每次提交的行变更都会增大 `rev`；游标为 N 的读取方恰好收到 N 之后变更的行，删除或切换分支返回新快照（verification: setupTestDatabase unit；Main 数据负责人）
- AC5 — 向打开的 text part 追加内容时只发布一个按 part 寻址的 append，不带其他 part 和顺序，并且只有该 part 的订阅者重新渲染（verification: unit 与 renderer；传输和渲染负责人）
- AC6 — part 流式输出期间，Markdown 只从它最后一个不稳定块开始重新切分，已完成的块保留 DOM（verification: renderer；Markdown 负责人）
- AC7 — 在同一个 harness 内换模型保留同一个上下文和原生历史（verification: unit 回归；runtime 负责人）
- AC8 — 换 harness 会打开一个上下文，其第一个 run 经由已有的 driver 投递接收会话消息历史；回到之前用过的上下文时只投递它没有覆盖的 run（verification: unit；Main runtime 负责人）
- AC9 — 可移植历史不超过目标预算，按所述优先级保留整条消息，排除 reasoning 和隐藏的 data part，并说明被省略的数量和范围（verification: unit；Main runtime 负责人）
- AC10 — 每次传递都记录覆盖范围和投递状态，中断的投递不会向同一个上下文重复发送历史（verification: 带故障注入的 unit；Main 数据和 runtime 负责人）
- AC11 — 在 Electron 中，Claude Code 和 Pi Durable 上流式文字期间和工具运行期间的 steer 都让之前的 part 保持挂载，一个 Claude Code 到 Pi Durable 再回到 Claude Code 的会话能基于传递过来的上下文作答（verification: Electron；实现负责人）

- AC12 — 子会话单次回复跨两个原生消息时，attach、替换及重载后仍能按 part ID 读取后一条消息的大工具结果。无关追加或存档重读不影响该结果的订阅（verification: Main 与 Renderer 集成；工具结果和子会话负责人）
- AC13 — steer 提交后发生崩溃，重放它之前仍打开的 part 会保留原位置和 ID。在 run 中间 fork 不会看到 fork 点之后的条目（verification: 已填充 SQLite 和原生重放测试；存储和 runtime 负责人）
- AC14 — 纯追加只访问相应来源块，零同步 SQLite 读写。保存、Stop 或原生终态纠正都沿用已提交 part 的 ID（verification: runtime 集成测试，统计查询和通知次数；runtime 和存储负责人）

## 风险

- 后继依赖提交前，需要持久化未完成 part 的位置。用长会话测量放置和完成事务的次数。
- 在 steer 上方流式输出的 part 增长时会把 steer 往下推。这是接受的 T3 行为，只有在 Electron 中有证据时才重新考虑。
- 部分 adapter 在提交后会改变原生 ID。要求稳定键或已证实的别名，并对每个 adapter 验证重放。
- 预算可能省略相关历史。本 Spec 不包含读历史的工具，且可移植历史是参考文本：历史上的工具调用不会恢复为原生工具状态。
- #24051 和 #24100 的迁移必须在这个基础上重新生成，并能迁移已有数据的数据库。
- 一个会话有多个根上下文，会改变那些假设只有一个绑定的恢复、fork 和删除路径。
