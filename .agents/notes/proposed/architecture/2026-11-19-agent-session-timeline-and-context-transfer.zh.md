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

### 1. run 就是 assistant 行，steer 并入其中

一个 assistant 行记录一次 run：从触发它的输入到原生终态的一次智能体循环执行。run 进行中被接受的 steer 输入通过已有的 `replyId` 挂到这个 run 上。Main 在原生放置时不再预留续写行，run 只结束一次。排队和 follow-up 输入各自开始新的 run。

run 行新增 `context_id`，即执行它的上下文，与已有的状态、统计和 `modelId` 并列。不新增 run、attempt 或 turn 表。

### 2. 有序条目：一个计数器，`pos` 与 `rev`

每个会话维护一个单调计数器。每个消息行和 part 行都从它取两个值：

| 字段 | 分配时机 | 用途 |
| --- | --- | --- |
| `pos` | Main 接受输入或首次创建 part 时分配一次 | 时间线顺序，之后不再改变 |
| `rev` | 该行每次提交变更时 | 变更游标 |

即使 part 行要等到 part 完成时才写入，Main 也用一次同步的计数器递增来分配 `pos`，所以崩溃可能留下空号。计数器写入不改动 `updatedAt` 或 `lastActivityAt`。每个子存档维护自己的计数器。

时间线按 `pos` 排列输入和 part，遵循 [T3 的位置规则](https://github.com/pingdotgg/t3code/blob/13aa882c22d584de5388dfce3b3ca413387ba059/apps/server/src/orchestration-v2/TurnItemPositionStore.ts)：在 steer 之前创建的 part 留在它上方，包括仍在流式输出的 part；之后创建的 part 渲染在下方。不按字符切分，不轮转成新段，也不重新分组。后续条目到达时仍未结束的 reasoning part 按已结束渲染。遗留行按现有的 `(createdAt, id)` 顺序和已存储的 part 顺序一次性获得 `pos`。

### 3. 由原生身份派生 part 身份

part ID 由它的上下文、原生消息 ID 和块键派生；块键是 `toolCallId`、data part ID，或该块在这条原生消息中的位置。`native_ref` 存储原生消息 ID 和块键，供 fork 点和诊断使用。产品侧的数组下标从不参与派生。

因此，同一个原生块在重连、快照替换和重启后都解析到同一个 part，不需要存储映射。新的写入不再添加 `checkpointMapping.root` 和 `child.composition` 条目；遗留的 offset/count 映射保持可读，不回填。无法报告稳定原生消息身份和块顺序的 harness 需要修正它的 adapter。

### 4. 变更游标与增量投递

历史读取先取 `rev` 为 N 时的快照，之后只读 `rev` 大于 N 的行。删除和切换分支返回新快照，而不是写 tombstone。

实时投影保留它的发布 revision，用于检测重复和缺口，这是工具结果 note 的要求；但它按 part ID 寻址变更：在 `pos` 处插入、向打开的 text 或 reasoning part 追加 delta、替换某个 part、或移除某个 part。追加文字时既不发送无关的 part，也不发送完整顺序。渲染端按 part ID 设 key 并订阅，沿用 message-list subscriptions 的按 key 订阅。

Markdown 保留 Streamdown 及其 memo 的块。每个 part 缓存自己的块切分，追加时从最后一个不稳定块的起点重新切分。会让不稳定起点后移的结构（例如链接引用定义）会使该 part 整体重新切分。

### 5. 经由会话消息的上下文传递

一个会话可以先后拥有多个根上下文，每个对应一个原生线程。某个上下文的覆盖范围，是 `context_id` 指向它的那些 run，加上投递进它的传递。

- 在同一个 harness 内换模型时保留上下文。原生历史和 pi-ai 的适配不变。
- 换 harness，或显式开一个新上下文时，会在目标 backend 中打开一个上下文。它的第一个 run 接收由会话消息构建的可移植历史，也就是 DeepSeek 导入已在使用的中枢。回到之前用过的上下文时，只投递它没有覆盖的那些 run。

`readSessionHistory` 成为这个构建器：

- 只有当目标上下文已经有模型输入时才跳过。前缀其他位置的原生身份不再使它失效。
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
| `RootMessageProjection`、`ChildThreadProjection` | 派生 part ID、分配 `pos`、停止写 composition |
| `AgentSessionMessageService` 与 schema | 计数器、`pos` 和 `rev`、变更读取、会话级 part 位置 |
| `AgentSessionContextService` | 每个会话多个根上下文，以及传递记录 |
| `sessionHistory.ts` | 触发条件、范围、预算和排除规则 |
| `MessageProjection` 与渲染端 `aiTransport` | 按 part 寻址的 patch |
| 渲染端列表与 Markdown | `pos` 顺序、part key 与增量块切分 |

### 7. 交付顺序

1. 本 Spec 放在栈底，连同 runtime 契约的修订。
2. 存储：在 #24051 和 #24100 的 part 表上加入计数器、`pos`、`rev`、派生 ID 和 `context_id`，并重新生成迁移。
3. run 与 steer：把 steer 挂到 run 上、移除续写行、按 `pos` 渲染。
4. 增量投递与 Markdown。
5. 上下文传递与多个根上下文，session runtime binding 在它自己的分支里修订。
6. Electron 验收。只有这一层把 note 移到 implemented。

#23873 和 #23909 保持它们的工具结果范围。message-list subscriptions 在它自己的那一层修订，在 steer 放置、part 身份和游标上以本 note 为准。

## 考虑过的替代方案

- run、attempt 或 turn 表，或每条原生 assistant 消息一行：要么重复已经带有状态、统计和模型的 assistant 行，要么增加本可由条目级身份关联的行数。
- steer 时按字符切分、把打开的 part 轮转成新段、或把进行中的工具重新分组到边界之后：每一种都会增加切分或移动状态，并带来重载时的重建义务。现在的 T3 改为在首次写入时固定位置。
- 用传输 revision 作为存储游标，或采用 T3 的完整事件日志：传输 revision 只在一个发布者和订阅内有效，而 T3 自己也会压缩删除被取代的事件，所以行上的 `rev` 不需要日志就能提供同样的游标。
- 一次性分配 part ID 并持久化来源映射：派生方式省掉了映射存储及其恢复。
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

## 风险

- 计数器写入会让每个被接受的输入、新建的 part 和提交的变更多一次小的同步写入。需要在长会话上测量写入量。
- 在 steer 上方流式输出的 part 增长时会把 steer 往下推。这是接受的 T3 行为，只有在 Electron 中有证据时才重新考虑。
- 派生身份依赖每个 adapter 都有稳定的原生消息 ID 和块顺序。
- 预算可能省略相关历史。本 Spec 不包含读历史的工具，且可移植历史是参考文本：历史上的工具调用不会恢复为原生工具状态。
- #24051 和 #24100 的迁移必须在这个基础上重新生成，并能迁移已有数据的数据库。
- 一个会话有多个根上下文，会改变那些假设只有一个绑定的恢复、fork 和删除路径。
