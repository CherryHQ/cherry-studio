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

### 发布层的职责

- [TopicMessageProjection](../../../../src/main/ai/streamManager/TopicMessageProjection.ts) 和 [ChildThreadProjection](../../../../src/main/ai/agentSession/ChildThreadProjection.ts) 调用 `MessageProjection.updateAccepted()` 提交发生结构变化的消息视图。两者在接收时捕获可变的原生值，保留未修改 part 的对象引用。
- [ThreadMessageProjection](../../../../src/main/ai/agentSession/ThreadMessageProjection.ts) 按顺序应用子会话观察事件。`accept()` 表示处理完成。同批修改两条已有消息时，不能为了返回变更行而遍历历史。运行时连接负责发现子会话关系。仅有关系变化时，消息视图保持有效，也无需调度归档对账。
- [MessageProjection](../../../../src/main/ai/messages/MessageProjection.ts) 将带地址的编辑合批，按 revision 发布。Renderer 按 part ID 应用实时编辑，交给结构更新函数处理的变化包括消息增减、排序和对账。
- 根会话页面直接读取 topic 投影。历史读取成功后，仅交接这次读取覆盖的终态尝试。尝试仍在运行、历史行还是占位符或写入失败时，继续展示实时正文。临时对话自行保留已完成的回复，只有朗读消费者订阅文本编辑。

Pi 和 Pi Durable 已按 part 转发纯文字编辑。当 `message.parts` 批次含有 `put` 时，公共 feed 会回读来源消息，发出 `message.reconcile`，Main 随后复制这条消息的 parts。渠道侧已经通过 `sink.part(change)` 接收 Agent 的 part 变化并更新自己的文本视图。修复 feed 时沿用这条下游路径。[ThreadFeed.projectionEvents](../../../../packages/agent-runtime/src/observation.ts) · [ThreadProjection.accept](../../../../src/main/ai/agentSession/ThreadProjection.ts) · [AiStreamManager](../../../../src/main/ai/streamManager/AiStreamManager.ts) · [ChannelAdapterListener](../../../../src/main/ai/streamManager/listeners/ChannelAdapterListener.ts)

Pi Durable 在原生存储关闭前捕获已提交的归档，供仍持有句柄的调用方完成读取。此后每次通过句柄调用 `archive()` 都会深拷贝整份缓存。关闭后即使最后一个句柄已经释放，运行时仍引用这份归档。[Pi Durable runtime](../../../../packages/agent-runtime-pi-durable/src/runtime.ts)

## 提议

### 1. Run 负责执行，Timeline 负责内容

harness 放置触发输入时开始一次 run，在原生终态时结算。用现有 assistant 行作为 run 的物理记录，行 ID 即 run ID，状态、统计、模型和分支祖先关系都留在行上。排队时保留已持久化的输入 ID 和排队状态，放置时才作为 steer 加入活跃 run，或开启自己的 run。`replyId` 记录执行归属，`parentId` 记录祖先关系。steer 不预留续写行。迟到事实归原 run。后台唤醒若在原 run 结算后开启新的原生执行，则分配新 run ID。

时间线包含输入引用和输出 part。输入条目引用已有输入行。#24051 的 part 表是输出正文的唯一持久化来源。每个新增输出 part 恰好属于一个 run，有一个固定位置。导出、模型上下文等历史读取者可由适配器按需组装 `parts[]`。渲染分组独立于持久化归属。

根和子会话沿用同一契约，各子存档维护自己的顺序和版本。迁移保留消息 ID、分支和 fork 锚点、附件引用和已保存的 part ID。用已有的回复和 composition 事实确定历史 run 归属，证据不足时保留既有边界。读取既有分支时沿用其选中祖先路径和已记录的边界。将旧存档引用对应到 part ID 时，保留原始工具结果的归属。

#### 执行、内容和展示拥有不同寿命

在 `931d854cb87d30bc45d99fcfeba488ac2eb05b27`，#24051、#24100 和 #25406 已提供独立 part 存储、完成写入、按地址投递及按键订阅。这些没有完成 Run 切换：`AgentSessionTurn` 仍混合执行和回复投递，`reserveSteerContinuation()` 仍预留另一条助手行。应视其为已交付的前置能力，而非 AC1 的完成证据。

| 单位 | 身份和寿命 | 通知它的变化 |
| --- | --- | --- |
| Run | 既有助手行 ID，从触发输入被原生放置持续到原生执行终态 | 执行状态、待处理交互和用量 |
| Input | 持久化用户行 ID；接纳、排队、放置和结果是不同事实 | 自身投递／放置／结果 |
| Part | 既有持久化 part ID 及所属 Run；接纳时固定位置 | 按地址更新自身正文／状态 |
| 展示段 | 从连续 timeline 条目派生；一个 Run 可以显示在输入两侧 | 段内成员和展示分类 |
| 投递 attempt | 既有 `turnId`／attempt guards，用于流挂载和回调 | 传输挂载和过期回调处理 |

`runId` 是助手记录既有 ID 的领域名称，不另生成 ID，不新增表或服务。既有 `turnId` 不得定义持久执行归属；仅在真实投递 attempt 需要关联时保留，迁移调用者时删除多余别名。既有准入路径需要时，可以在 dispatch 前预留 pending 助手记录，但不能把预留描述为原生执行已开始。接纳结果未知时通过既有 input／context 身份恢复，而非再分配 Run。

一次原生执行可以接纳多个输入、产生多条原生助手消息。单个输入结果、模型消息结束、part 完成及历史读取成功都不能结束它的 Run。Adapter 报告一次放置是加入活跃执行还是开始新执行；不能根据输入框模式、`followUp` 命名或会话整体 busy 来决定边界。只有原生证据表明前一个 Run 已结束、后台唤醒开始了新执行时，才新建 Run。压缩和审批等待保留当前 Run。

#### 放置与结束的迁移契约

| 既有事实 | Run 必须执行的操作 | Timeline 与持久化 |
| --- | --- | --- |
| 输入被接纳或排队 | 保留输入 ID，不推断其与活跃 Run 的关联 | 保存既有接纳／队列状态，不伪造已放置 `pos` |
| 触发输入被放入新执行 | 激活其预留 Run，或在既有恢复路径下创建 | 发布放置前绑定输入 `replyId` 和位置 |
| Steer 被放入当前执行 | 将输入关联到同一 Run，不预留续写 | 保留所有既有 part 的所有者／ID／位置；后续新 part 分配新位置 |
| 排队 follow-up 在原生终态后被放置 | 开始新 Run | 保留排队输入 ID，分配实际放置位置 |
| Part 完成或收到单个输入结果 | 只更新该 part／input | 复用 part 完成写入，不结束 Run 状态或重复结算用量 |
| 压缩、审批等待或观察者 detach | 保留正在执行的 Run | 更新既有控件／标记，detach 不取消执行 |
| 请求 Stop | 对活跃执行调用既有原生 Stop 路径 | 保留已收到的 parts，不伪造成功的原生终态 |
| 原生终态，或既有确认的连接故障结果 | 必要写入成功后，只结束对应 Run 一次 | 保存尚未完成但已收到的 parts 并结算统计；过期／重复回调不能结束另一个 Run |

放置时的输入关联、位置及必要 checkpoint 关联使用既有同步事务，提交后发布。不增加事件归档或第二套准入状态机。Adapter 的放置／终态契约需要标识执行 context 及既有执行所有者；原生证据有歧义时走当前恢复／错误路径，不根据最新用户行猜测。

Runtime 切换需要删除同一执行 steer 路径上的 `reserveSteerContinuation`、`reserve-steer` 及 `steer-transition` 的 source／reply 对。`AgentSessionRuntimeService` 继续拥有生命周期。Run 的原生寿命与既有流投递状态分开；视图交接关闭或替换观察，不结束执行。Steer 前注册的来源继续把迟到更新路由到同一 Run 和 part。输出归属、用量、审批和工具结果寻址不能跟随最新展示段。

Renderer 从输入和 part 位置派生展示段。段 key 来自稳定首条目，不使用传输 revision 或数组下标。追加后续输入时，既有 part 保留兼容父节点；后续新输出在输入后形成展示段。已经打开的文本 part 或工具在更新时仍保留原位置。这项决策不承诺点击后到达的每个字节都显示在点击位置下面。若启用本地输入立即展示，需要预分配输入身份及明确的未放置状态，最终以原生放置为准。不伪造续写助手记录，也不为模拟立即接续而移动运行中的工具。

#### 表关系与字段

字段名采用 TypeScript schema 的命名。**现有**表示当前栈已有，**切换**表示 Agent Timeline 切换需要，**历史**表示随历史增量读取交付。

```text
agent_session.id
  ├─ 1:N agent_session_context.sessionId
  └─ 1:N agent_session_message.sessionId
             user.replyId ──────────────► assistant.id (Run)
             user.inputContextId ───────► agent_session_context.id
             message.parentId ─────────► message.id (branch ancestry)

agent_session_message.id
  └─ 1:N agent_session_message_part.messageId
             agent_session_message_part.id
               └─ 1:0..1 agent_session_tool_output.partId (proposed)
```

| 表 | 字段与阶段 | 含义与写入时机 |
| --- | --- | --- |
| `agent_session` | 现有：`id`、`ownerSessionId`、`activeNodeId` | `id` 限定一个存档，子会话各有独立存档。`ownerSessionId` 将子存档关联到所属会话。`activeNodeId` 选择该存档消息树中的节点。 |
| `agent_session` | 切换：`lastPos`。历史：`committedRev`、`resetVersion` | `lastPos` 是已提交的最大位置。Main 在写入输入或 part 的同一事务中推进它。每次可见历史变更提交时推进 `committedRev`，该事务变化的行共用它。删除在同一事务内推进 `resetVersion`，让旧游标重新读取基线。 |
| `agent_session_context` | 现有：`id`、`sessionId`、`backendId`、`nativeThreadId`、`bindingState` | 将存档绑定到一个后端上的原生线程。原生线程身份尚未确认时允许待绑定。 |
| `agent_session_context` | 现有：`parentContextId`、`spawnToolCallId`、`anchorMessageId`、`checkpointMapping` | 上下文祖先和创建工具调用定位子上下文，锚点指出产品分支起点。恢复沿用已有 checkpoint。 |
| `agent_session_message` | 现有：`id`、`sessionId`、`role`、`parentId`、`replyId` | user 行是输入，assistant 行承载 Run。`parentId` 构成分支树。user 的 `replyId` 指向同存档 assistant 行，触发输入和 steer 可以关联同一 Run。现有重新生成路径可以改写这个关联。 |
| `agent_session_message` | 现有：`inputContextId`、`nativeInputId`。切换：user 行的 `pos`。历史：`rev` | 产品消息 ID 和捕获的上下文在派发前确定输入身份。旧原生 ID 供旧数据恢复使用。只有原生放置会分配输入位置。历史版本标记可见输入或 Run 的提交变更。 |
| `agent_session_message` | 现有：`status`、`modelId`、`stats`、`searchableText` | assistant 行承载执行状态、模型、用量和派生的搜索索引值。终态结算写状态和统计。搜索文本从内容 parts 生成。 |
| `agent_session_message_part` | 现有：`id`、`messageId`、`sessionId`、`seq`、`type`、`payload` | `id` 是稳定的 part ID。外键 `messageId` 指向拥有内容的行：用户正文指向 user 行，新增 assistant 输出指向 Run 行。`seq` 为输入及旧读取者保留行内顺序。`type` 区分载荷类型。 |
| `agent_session_message_part` | 新 Run 输出切换：`pos` 和可确认的原生来源关联。历史：`rev` | 首次提交时把 ID、归属和位置与正文一起保存。user 正文 parts 共享所属输入的时间线位置，各自的 `seq` 决定该输入内部顺序。 |
| `agent_session_tool_output` | 现有键：`(messageId, toolCallId)`。切换键：`partId`，沿用 `output` | `partId` 同时是主键和指向工具 part 的外键，删除时级联清理。完成或替换时原子写 part 及其当前结果。迁移从旧键定位归属，启用新主键前，在已有数据上验证每个可读旧结果都有唯一归属。未确认的结果在迁移期间保留旧读取路径。 |

`inputContextId` 记录输入的原生绑定，排队的输入也可能已有绑定。Main 从原生放置得到实时 Run 的执行上下文。历史读取只有在触发输入关联唯一且不可变时才能沿它推导上下文。现有的 `replyId` 反查无法保证唯一或不变。证据不足时保留未知归属。Timeline 切换和新上下文初始化均无需给 assistant 行添加上下文字段。恢复按会话索引取出未结算的 assistant 行，再按 `(sessionId, replyId)` 找到关联输入。旧回复可以按父行主键查找，已被其他输入认领的回复保留该归属。

Main 验证输入到 Run、part 归属和锚点都位于同一存档。输入行与输出 part 行共用一个位置分配器，单表索引无法保证跨表唯一。通过 part 的所有者可以确定工具结果所属存档。结果变化若对历史可见，在同一事务内推进所属 part 的历史版本。

### 2. 条目顺序与持久化提交

| 字段 | 分配时机 | 用途 |
| --- | --- | --- |
| `pos` | 放置输入或首次接纳 part 时分配一次 | 存档内的时间线顺序 |
| `rev` | 每个可见历史变更事务分配一次，由该事务改变的行共享 | 持久历史游标 |

一个存档由一个 Main 所有者分配位置，从已提交的最大位置继续递增。新 part 的 ID、位置和正文由实时 Timeline 持有。创建 part 和追加文字都只操作内存。Run 进行中，part 完成时在同一事务写入变更的 part、位置及相关工具结果或附件引用。终态和 Stop 沿用这些 ID 和位置，保存剩余已收到的 parts 并结算 Run。事务成功后发布已提交的历史变更。写入失败时保留可读的实时内容，供既有重试或终态路径处理。

时间线顺序在接纳时确定。即使后来的 steer 先提交，仍在生成的 part 也留在它上方，保存时沿用已分配的位置。窗口挂载和重连到同一个 Main 进程时读取实时 Timeline。Main 重启后，已保存的条目保留 ID 和顺序，未提交的 part 允许丢失。原生恢复若提供这部分内容，按正常接纳路径进入 Timeline，可以分配新的 ID 和位置。旧行依据既有证据按原来的展示顺序分配位置。

根会话发布新块时，`part-open`（文字或思考）和 `part-add`（工具或数据）必须携带存档位置。后续编辑只能通过 ID 更新已有 part，类型禁止指定位置。例如，依次接纳文字 A、压缩标记 C、文字 B 后，即使 A 收到后缀，顺序仍为 `[A, C, B]`。根会话 checkpoint 按原生来源记录 part ID，允许同一来源的块在界面上不相邻。旧 offset/count checkpoint 按保存时的行顺序解释。现有子会话投影在组合原生片段时自行指定前驱。

### 3. 稳定的 part 身份和工具结果归属

首次接纳 part 时分配一个 ID，后续实时及持久化更新沿用这个 ID。原生键由上下文、规范化后的原生来源和块键共同确定。有 tool-call ID 或显式 data ID 时优先使用，原生下标只在块顺序稳定的原生来源内部使用。adapter 能证明临时来源被已提交来源替换时，沿用原 ID 和位置。无法证明对应关系时，在 adapter 边界校对该来源，或请求新基线。跨 Main 重启的身份保证只覆盖已提交的 part。产品消息下标和展示分组 ID 都不承载存储身份。

Main、SQLite 和 Renderer 失效通知沿用同一 part ID 寻址当前工具结果。从原有的消息和 tool-call 归属迁移最新结果的关联，载荷留在现有 sidecar。提交前读取已接纳的实时结果，原子交接后读取持久化结果。结果替换只使对应 part 的结果缓存失效。新增写入用稳定的来源关联，旧 offset/count composition 仍可供既有历史和恢复读取。

#### Context 绑定与投影归属

`agent_session_context` 负责原生线程绑定和原生 fork 恢复。Timeline 所有者维护来源到 part 的关联、条目位置和删除状态。Timeline 的新增写入使用这些关联，取代根会话的数组范围和子会话的组合映射。旧 `checkpointMapping.root` 和 `checkpointMapping.child` 继续供历史恢复读取。发布 fork 时只更新 `checkpointMapping.fork`，同一事务中保留其他恢复区段。当前 [fork 发布](../../../../src/main/data/services/AgentSessionContextService.ts) 会替换整个映射，因此要补保留区段的回归用例。

新增 fork 只允许从成功结束的 Run 的受支持边界发起。同一 harness 的原生 fork 要求该边界有对应的原生 checkpoint。Renderer 仅在符合条件的边界提供 Fork，Main 在准备 fork 前拒绝 steer 消息及 Run 内部位置。

Fork 和 edit 共用所选分支的 Run 历史投影，复用现有助手 ID、输入的 `replyId` 关联及已接纳的 `pos`。每个 Run 归拢原始输入和已投递的 steer，再按首条已接纳输入排列 Run。消息树选择分支，但不定义执行顺序或原生截止点。Fork 复制至选中边界的完整 Run，并排除已绑定但未投递的输入；没有接纳证据、也没有位置的旧历史仍可读取。Edit 拒绝 Run 内的 steer，使用前一个 Run 的 checkpoint，在同一事务中先按 Run 顺序重接当前路径，再替换目标 Run 及后续子树。保留更早 Run 的 ID、关联输入、checkpoint 和兄弟分支。

Main 的历史解析模块统一负责接纳状态分类、前驱选择和截止范围。公共接口返回已解析的目标和只读、不透明的 fork/edit 计划，不返回排序后的行数组。编辑能力校验与原生准备消费同一解析结果。产品提交只接受读取阶段生成、绑定了历史版本的编辑计划；应用计划中的父链接变更和替换边界前，先拒绝已变化的历史。已知未投递或已撤回的输入保留在产品历史中，但不能成为原生前驱，也不进入 fork 前缀；已接纳的 steer 不能生成编辑计划。对非活动分支中的指定目标，按该目标自己的路径解析。Fork 先通过元数据确定保留 ID，再加载 part 和归档工具结果。原生恢复独立于 Run 是否成功来保存已确认的接纳事实，避免把 error 或 paused Run 的已接纳输入误判为未投递队列。不新增 Run 表或并行事件存储。


原生来源明确替换时，将别名解析到原 `partId` 和位置。用户删除时，在删除事务中记录规范来源的重放抑制状态，避免该内容在恢复时复活。只有确认该来源无法再被重放时才清理这条记录。历史游标重置用于刷新读取视图，重放抑制用于约束 Timeline 写入。

删除提交后，Main 通知实时 Timeline 所有者受影响的 part ID。所有者释放其正文引用、已接纳结果和索引，再向订阅端发布移除。当前根投影在成功提交后释放实时正文，会轮询上下文行以发现删除，也可能重读已存 part 做比较。切换后直接投递移除操作。在 Electron 中通过堆引用链验证释放结果。[RootMessageProjection](../../../../src/main/ai/agentSession/RootMessageProjection.ts)

### 4. 增量接纳、投递和恢复

Main 的 timeline 所有者接纳规范化的来源变化。一次应用直接产出变化的条目或文字后缀以及待持久化的内容。接收累积原生消息的 adapter 在入口为受影响的来源生成有序的 `message.parts` 操作。首次安装、权威修正、元数据变化或确认来源别名时，`message.reconcile` 携带单个原生来源。持久化和发布按变化执行，无需重新扫描整条回复来推断变化。

实时接纳入口按单个 part ID 更新。文本和 reasoning 使用 `open`、`append` 和 `finish`。`put` 只接收其他类型的 part。`open` 只创建一次空块，`append` 只添加后缀，`finish` 保留已累计的正文。已有 part 的类型固定。SDK 能指明目标块时，权威修正通过 `correct` 写回原地址。需要重新确定来源或顺序时才进入恢复。

纯文本追加时，原生预览生产者在构建任何累积视图前直接给出变化的来源块身份和后缀。Main 将来源块解析为稳定的 part ID。实时追加处理只接收后缀及对应的 part 或其键。初始化、附着或恢复时构建有作用域的快照。在 `.oxlintrc.json` 中，用 `no-restricted-imports` 的文件级规则约束追加生产和处理模块，禁止导入全量视图类型、快照构建器、历史读取器及整消息 diff，包括其转导出。

下面是 Pi、Main 和 Renderer 各自的调用签名。输入由调度器放置。Timeline 所有者在首次接纳时记录 `runId` 和 `pos`，正文写入沿用已有的 part 操作。通用的 `insert(item: TimelineItem)` 会允许调用方直接塞入整块文字或工具载荷，绕过实时写入约束。

```ts
declare function restoreCommitted(entry: PiContext[number]): void
declare function publishParts(patches: readonly PublishedPartPatch[]): void
declare const reader: ProjectionPartReader

restoreCommitted({ id: sourceEntry.id, message })
publishParts([{ type: 'part-append', partId, text: suffix }])
const part = reader.read(partId)
```

Renderer 完整应用一个有序批次后，按条目或 run ID 通知订阅者。文字追加只通知受影响的 part。插入和移除同时通知顺序的消费者。Main 可按 part 合并待投递操作，无需重算当前视图。attach 和恢复用有作用域的完整基线。实时批次带独立的发布 revision 和发布身份，断档、未知目标或失效发布沿用现有基线恢复。

历史读取取得一致快照和它的提交游标。随后只返回游标之后变化的行，并在完整提交的边界推进游标。游标含视图作用域和存档重置版本。删除在同一事务中推进重置版本，切分支会改变视图作用域。即使读取方错过了失效通知，也会用旧游标拿到新基线。

#### 从三个原生入口到同一条 part 操作

适配器给出原生来源、块和变化。Main 确认来源所属的 Run，分配或复用产品的 `partId` 和 `pos`。发布第一个可见块前登记新来源。块一开始就有文字时，先发 `open`，再用一次 `append` 交付初始文字。空块也有可寻址的身份。实时内容写入函数和观察批次都可以复用现有事件类型。[Runtime 契约](../../../../packages/agent-runtime/src/contracts.ts)

```ts
type LivePartInput = NativePartUpdate | Extract<MessageObservation, { type: 'message.parts' }>
type ProjectionEvents = readonly LivePartInput[] | readonly Exclude<ObservationPayload, LivePartInput>[]
```

原生后缀可以直接用 `message.text-append` 传递。生产者已持有同一来源的有序编辑时，传递已有批次。`RuntimePartEdit` 已将 `put` 的值限定为文本和思考以外的 part。写入函数只持有处理这些操作所需的接口。历史读取和快照构建归挂载与恢复流程负责。安装来源和替换来源别名使用独立入口。SDK 能指出目标块时，权威修正只作用于该块，只有一条完整来源消息可用时才协调这条来源。控制事件保持其与内容事件的先后顺序。

| 原生入口 | 实时路径具体怎么改 | 适配器要保留的原生语义 |
| --- | --- | --- |
| Claude Code · [ClaudeProjection.partial](../../../../packages/agent-runtime-claude-code/src/projection.ts) | 在 `content_block_start` 把 SDK 块下标与该来源的块关联。`text_delta`、`thinking_delta` 直接送到该块。纯追加移除 `RuntimeMessageStream.append → preview → updateSource`。工具参数的 JSON 只在对应调用内拼接，结果按 tool-use ID 找回该调用。 | 保留引用、思考签名、归档消息 UUID 的替换和撤回。`content_block_stop` 结束对应块。消息被中断时，未收完的工具参数仍未就绪。[ClaudeFeed.publish](../../../../packages/agent-runtime-claude-code/src/observation.ts) 要为已接纳的直接 part 更新标明对应的实时来源。 |
| Pi · [PiProjection.bind、delta 和 result](../../../../packages/agent-runtime-pi/src/runtimeProjection.ts) | 在会话回调入队前捕获来源、`contentIndex` 和不可变的操作参数。能确认是新后缀时直接追加。可变的 `partial` 已经包含后续内容时，只核对目标块及其已接纳值，避免同一段文字追加两次。移除实时路径中的 `message.parts.slice()` 和对 `stream.texts` 的遍历。在已有工具调用索引中记录块地址，让 `result()` 直接更新该块。 | 开块时已有的文字在结束前可见。权威的 `text_end` 或 `thinking_end` 缩短正文时，纠正同一个 part，后续块不能覆盖纠正。临时进度、失败和最终结果沿用工具调用所在的 part。 |
| Pi Durable · [视图和提交观察器](../../../../packages/agent-runtime-pi-durable/src/runtime.ts) 与 [DurableProjection](../../../../packages/agent-runtime-pi-durable/src/projection.ts) | 原生后缀沿用 `previewTextAppends → appendPreview`，工具进度沿用按 slot 定位的 `previewTools`。从文档变更路径和插入值解析新块。更新已有块时只读该块。地址已知的变化移除 `reconcilePreview` 的整轮生成内容比较，以及 `messageChanges` 的整段历史差分。 | 预览归属于原生任务及其生成尝试。已存储的提交和延后送达的预览只应用同一变化一次。只有唯一匹配的提交记录才能替换预览，有歧义时沿用已有的映射断点与基线恢复。单凭预览不能结算 Run。 |

#### 各层实时函数的入参与返回值

| 所有者 | 入参与返回值 | 从实时路径移出的能力 |
| --- | --- | --- |
| [Pi 恢复](../../../../packages/agent-runtime-pi/src/runtimeProjection.ts) | `restoreCommitted` 必须同时接收原生投影给出的 ID 和消息。保留子会话的来源过滤、同一来源内的顺序，以及完整归档读取压缩前记录的范围。 | 移除 `currentMessages()` 和逐消息 `entryId()` 回查。构建基线时按键替换已有条目，避免逐条查找前面的元素。实时预览保留临时身份，直到原生持久化给出对应关系。锁定版本的 SDK 发出 `message_end` 时还没有已提交 ID。需要时由原生 append 提供对应关系，或在恢复时核对。[Pi 持久化](../../../../patches/@earendil-works__pi-coding-agent@1.5.2.patch) |
| [Claude 发布](../../../../packages/agent-runtime-claude-code/src/observation.ts)和 [Durable 预览](../../../../packages/agent-runtime-pi-durable/src/projection.ts) | Claude 接纳正文编辑，观察器将其与本次回调产生的控制事实和调用事实一起投递。需要 `aborted` 时单独读取这个布尔值。Durable 的 SDK 观察器先提取任务、尝试以及变化的块或工具 slot，再调用写入函数。 | 从 Claude 的实时 `publish` 删除控制快照参数和 feed 持有的副本。挂载或恢复时按对应 revision 捕获控制基线。`ConversationView` 和整条分支的核对由 Durable 原生所有者使用。一次投递若启动 Run，先建立 Run 再交付首块。已接纳的编辑送达后再通知终态。 |
| [Main 发布](../../../../src/main/ai/messages/MessageProjection.ts) | 根或子存档所有者只应用一次批次，持有待提交的值。发布函数绑定目标，只接收 `readonly PublishedPartPatch[]`，返回 `void`。Agent 正文帧携带路由身份、revision 和操作实际需要的参数。 | Run 控制变化在同一有序流中单独表达。移除正文帧展开执行状态的写法，以及发布器对已接纳 part 的第二次应用或回读。挂载和终态持久化分别向所有者读取所需范围。普通 Chat 沿用自己的流。 |
| [Renderer 更新](../../../../src/renderer/services/aiTransport/applyLiveParts.ts) | `applyParts(revision, patches)` 暂存被寻址槽位的变更，同批后续编辑可以看到前面的写入。整批通过后提交一次，按键通知，再返回 `applied`。后续 revision 不连续或编辑无效时返回 `needs-baseline`，整批都不改动。已过期的 revision 由连接忽略。单块正文变更沿用 `updatedPartValue(before, patch)`。文字块开始时向朗读服务提供前一个文字块的 ID，追加时提供后缀的起始偏移。 | 从编辑函数移除可枚举的 map 和返回整行的 `rowAt()`。每个槽位指向所属的顺序索引页。根会话开块时追加到尾页，子会话开块时更新前驱所在的页，两者都只更新受影响的索引路径。结束时若分组类别变化，则更新受影响的分组边界。已挂载的列表按组或可见范围读取布局 ID，叶组件用 `ProjectionPartReader`。移除这条路径上重新组装正文数组和并排 ID 数组的逻辑。[实际渲染分组](../../../../src/renderer/components/chat/messages/blocks/MessagePartsRenderer.tsx) |
| [远程 journal](../../../../src/main/services/remoteAccess/agentJournal.ts) | `SessionJournal.append(pending)` 分配序号。校验器按键读取事件涉及的实体，返回拒绝原因，或本批要写的键值和新游标。part 槽记录所属 `messageId`，可直接核对归属。提交受影响的键、游标和重放记录后再通知。 | 移除 journal 追加时索取整份 `AgentProjection` 的调用。生成 checkpoint 时可以枚举其所有者。公开的 `applyAgentEvents()` 共享序号、基准版本、UTF-8 偏移和内容完整性校验，继续返回由普通对象字典构成的不可变结果。重放时跳过重复前缀，调用方持有的旧快照保持可读。仅改变桌面 journal，仍使用公开快照接口的客户端不会自动获得这项收益。[公开 reducer](../../../../packages/remote-protocol/src/agent/reducer.ts) |

入队前实际构造紧凑值。给完整消息标注 `Pick`、展开整个 SDK 事件，或把捕获视图的回调放进队列，都可能让正文继续驻留。`ThreadFeed.publishPart()` 向 `stagePartUpdate()` 提供按位置读取单个槽位的函数。feed 一次提交返回的槽位并发布已接纳的事件。只给它按键读目标与插入锚点、提交受影响槽位和通知已接纳事件的能力，单块转换复用 `applyRuntimePartEdit(old, edit)`。它调用的 helper 也无法通过 `this`、闭包或导入拿到 feed、session、可枚举的历史或兄弟块集合、恢复读取器。连接负责基线恢复。[单块转换](../../../../packages/agent-runtime/src/stagePartUpdate.ts)

`onPart` 向实时写入函数交付 `AgentPartChange`，`onMessageReconciled` 向恢复处理函数交付一个来源。基线和终态消费者通过所有者的 `readParts()` 读取正文。[流来源与监听器](../../../../src/main/ai/streamManager/types.ts) · [流转发](../../../../src/main/ai/streamManager/pipeMessageStream.ts)

#### 实时与归档正文的所有权

每个存档由一个 Main Timeline 所有者管理未落盘和待写入的 part。根和子存档采用同一套所有权规则。原生上下文保存执行所需状态，并提供变化的来源事实。Main 将来源解析为稳定的 `partId`，接纳一次变化，同时产出发布操作与待提交内容。流转发和发布层持有待发送的操作及 revision 元数据。操作只携带执行所需的参数。挂载时同时捕获所有者快照和对应的发布 revision，再应用此后的操作。终态消费者等已接纳操作送达后读取所有者状态。

part 事务成功后，SQLite 持有已提交的正文和结果。Main 保留路由后续变化需要的身份、位置和提交事实。能从存档读到提交值时，释放实时正文和过期结果。仍在生成或写入失败的 part 保留当前值，直到提交成功。后续权威修正仍寻址同一 ID，并更新其提交版本。

挂载和重启把一页有界的已提交布局和紧凑结果引用与当前实时 part 合并。先选定页，再加载载荷。需要完整历史的导出、模型上下文等消费者按需读取。原生恢复利用记录的身份和提交证据跳过已接纳的正文。旧的来源范围和 composition 在这个边界读取。需要完整原生归档和活动上下文的读路径可以复用重叠条目的解码结果。

成功和失败的大工具结果沿用按 part 寻址的详情契约。发布的 part 携带有界摘要和引用。提交前由实时所有者提供结果，写入成功后沿用同一 part ID 读取持久化 sidecar。展示分组独立于归档键。实际读取或写入时才分配序列化内容，并随操作释放。

Agent 结果投影函数要求 `DeferredToolResultRef & { partId: string }`，引用由实际归档行构造，同时返回给失效通知使用。成功和失败分别构造可发布值。结果发生变化时，按已有的 `DEFER_TOOL_OUTPUT_BYTES` 预算计算结果字段的 UTF-8 大小，包括 `errorText` 和携带原始结果的 provider metadata。大结果保留成功或失败状态、有界展示值和详情引用。移除兜底的 `as ProjectedToolResult` 断言，私有构造函数完成预算检查后才可标记为可发布。实时和已保存的结果沿用同一转换。[结果投影函数](../../../../src/main/utils/messageOutputProjection.ts)

切换时删除 Agent 在 `pipeMessageStream` 中的正文累积、持有完整正文的落盘比较缓存、Main 延迟原生事件重放，以及普通变化的整消息投影与差分。非 Agent 聊天沿用自身的流契约。工具转换和嵌套声明处理作用于受影响的来源块。Renderer 每个 part 只更新对应单元，排序单独更新，包括 part 进入终态时。

Markdown 在每个文字 part 内处理。可以从最后一个不稳定块开始重新切分，链接引用定义等结构仍可能使更早的块失效。按 part 投递的性能验证独立于 Markdown 解析修改。

#### Renderer hook 的订阅范围

根会话和子会话的列表 hook 订阅本页或当前 Run 的有序 ID 和分组所需字段，把投影目标和稳定的 `partId` 传给对应的 part 行。文本、思考和工具 hook 用同一个 `(target, partId)` 订阅和读取快照。Run 控件订阅执行状态。输入框的审批控件订阅待处理交互，只读取当前请求所需字段。复制和导出在用户执行操作时读取选中的正文。

Renderer 按变化的键通知对应的监听器，这些本地订阅共用该投影目标的 IPC 连接。新挂载的 hook 读取当前值。选中值未变时，`useSyncExternalStore` 返回的快照保持 `Object.is` 相等。追加文字或更新同一分组内的工具进度时，布局快照保持原引用。开块、移除或完成时，只有顺序或分组确实发生变化的布局订阅者收到通知。虚拟列表复用或卸载行时解除旧订阅。切换投影目标后，旧目标的迟到更新不能唤醒新视图。持久化历史接手后，行沿用同一 `partId`，即使正文对象已更换，也能读到已提交的值。

现有 `ProjectionPartReader` 提供 `read(partId)` 和 `subscribe(partId, listener)`。实时叶组件只接收这个 reader 和稳定的 part ID。静态历史行可以直接提供当前页中的值。实时列表按布局信息分组，移除为每个叶组件保留旧正文的备用 props。整页组装由分页和基线消费入口负责。[按键订阅的 hook](../../../../src/renderer/hooks/agent/useProjectionPart.ts) · [Part 读取接口](../../../../src/renderer/types/message.ts)

#### 用 Oxlint 约束实时路径

现有 [Oxlint 配置](../../../../.oxlintrc.json)对部分写入方法和导入路径有检查。把真正执行实时更新的函数及其能调用的 helper 都放进受约束的模块。覆盖三个原生解码入口、feed 发布、Main 的 part 写入、Renderer 更新存储的函数，以及根和子会话的实时 hook。`applyLiveParts()` 接收按键查询 part 和插入位置的两个函数，分别返回本次编辑所需的字段。行内顺序由连接持有，批次被拒绝或 revision 断档时也由连接负责恢复。

下面以只依赖本地契约的写入模块为例。每层列出它需要的模块和导出名，hook 可导入 `react` 和按键读取的接口。未列入的 barrel 即使为全量读取函数改名也无法导入。获准使用的混合 barrel 只开放列出的导出名。[Oxlint 导入规则](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports.html)

```json
{
  "no-restricted-imports": ["error", {
    "patterns": [{ "group": ["**", "!./contracts"] }],
    "paths": [{ "name": "./contracts", "allowImportNames": ["LivePartInput", "RuntimePartEdit"] }]
  }],
  "no-restricted-properties": ["error",
    { "property": "message" }, { "property": "readMessage" },
    { "property": "snapshot" }, { "property": "materialize" }
  ]
}
```

成员访问规则只作用于无需访问这些成员、负责写入规范化操作的模块。它能拦住同文件内直接调用 `this.message()` 和解构取得 `readMessage`。原生 SDK 回调仍能读取 `event.message`，按键订阅的 React hook 可以调用自己的 `getSnapshot()`，恢复读取函数可以加载一页数据。hook 能看到哪一份快照，由传入的读取接口类型限定。

沿用[仓库的 Oxlint 用例](../../../../scripts/lint/__tests__/structured-clone.test.ts)，让测试路径命中生产配置。直接导入恢复模块、从混合 barrel 改名或以命名空间导入全量接口、在发布函数中回读消息，均要收到指定规则的诊断。按键订阅的 hook、按地址写入 part、恢复时读取一页这三个正例应通过。本地运行 `pnpm exec oxlint --deny-warnings <files>` 即可检查。类型检查须拒绝将快照或整条来源的纠正事件传入实时写入函数，也须拒绝用 `put` 写文本或思考块。合法代码发生的重复计算由 AC14 的实际访问计数检出。

类型负例覆盖 Pi 已提交记录漏传 ID、给 Claude 正文写入函数传控制快照、向发布器传入原始失败工具结果，以及 Renderer 编辑函数读取整行正文或取得集合迭代器。该路径调用的 helper 模块也受同一导入边界约束。Oxlint 用例覆盖通过 helper 间接导入恢复模块，以及恢复入口正常读取基线。

#### 各业务读取哪些数据

读取接口绑定所属存档，按业务进一步限定到分支或 Run。先选行和字段，再解码正文。根和子会话的 adapter 都保留有序的原生编辑。实时发布函数接收已经接纳的操作，挂载和恢复代码通过独立接口读取基线。

文字操作从 Main 到 Renderer 可以复用同一组参数类型。工具结果在发布时需要转换。写入方接收原生输出，只有输出投影函数能生成发布端接受的传输类型。该函数检查内联字节上限，超出时返回以 `partId` 寻址的紧凑引用。把未投影的原生工具结果直接传给发布端应产生类型错误。

| 消费者 | 需要的数据 | 持有到什么时候 |
| --- | --- | --- |
| Run 控制、位置查询和选择 | 控制只读状态及待处理交互 ID，排序只读条目 ID、所属 Run 和位置。选择只需要所选分支在截止位置以内的条目标识。 | 保留活动控制状态和当前选择。查询位置和选取 ID 都不读 part 正文。 |
| 消息列表 | 当前可见的一页布局和紧凑 part，以及随后按 ID 发来的操作。打开或完成一个 part 会影响展示分组时，只更新相关分组。 | 已挂载的行读取对应 part 的当前值。可见的终态 overlay 保留到已保存历史接手。已脱离订阅的视图在交接完成后释放正文引用，再次挂载时读取新基线。 |
| 渠道投递、自动朗读、诊断和远程订阅 | 渠道和朗读消费可见文本的变化，诊断还需要工具名，远程重放需要变化的公开 part 及其身份。中途接入的订阅者先收到自身范围的基线，再依序收到后续变化。 | 只保留该消费者所需的文字或重放窗口。渠道仍在发送前清理文本。接入任一监听器都不能让普通发布重建整条回复。 |
| 工具详情 | 工具所属的 `partId` 及请求的 `preview`、`text-range` 或 `full` 结果。详情直接定位实时 part 或其持久化结果。 | 一次只读选中的 part。完整输出在显式请求时读取，列表和位置查询只用紧凑信息。 |
| 原生归档的最后一次交接 | 已取得的句柄可以在原生存储关闭后读完本会话已提交的条目，包括压缩前的条目。读取方已知上次的截止位置时，只请求缺少的范围和对应的来源映射。 | 同一会话的句柄共享不可变归档数据，只隔离本次读取范围里调用方可修改的值。最后一个句柄释放时一并释放归档。 |
| 导出和模型上下文 | 所选范围、截止位置，以及导出格式或上下文预算要求的字段。 | 在操作期间分批读取。导出读取较早条目时，列表可以停留在当前页。 |

#### 打开归档与启动执行

会话 ID 标识产品归档。调用方要做的事决定它能接触哪个所有者。下表描述现有模块需要暴露的能力。

| 调用者 | 操作 | 所有者及允许的工作 |
| --- | --- | --- |
| 打开根或子会话、切分支、窗口重连 | 按分支锚点读一页，并订阅该 Timeline | 归档先选页再读 part。Main 提供已提交的布局和该归档已有的实时 part。空闲时建立的订阅也能收到下一轮 Run 的首次变化。关闭窗口释放这份订阅。 |
| 用户打开命令菜单，包括首次发送前 | 读当前会话可用的命令目录 | Pi 和 Pi Durable 返回内置命令。Claude Code 可以在首次发送前通过就绪的 SDK Query 读取项目命令，查询所需的 SDK 资源由驱动持有。 |
| 用户发送或 steer | 向输入已捕获的分支和 context 提交 | 执行所有者接收原始输入 ID，打开模型需要的上下文，并发布后续的放置、part 变化和终态。新 Run 只持有本次执行的未提交 part 及所需身份。仅为重建界面而读取的已结算输入回执和旧 part 正文均为零。 |
| 宿主恢复工作 | 核对原始投递或原生未完成工作 | 产品中待结算的回复给出需要核对的输入和绑定。Durable 还可能有尚无产品回复的原生任务。在已知 backend 内，从未完成的任务和投递追溯所属根，先接好各根的宿主与接收方，再允许能唤醒共享调度器的提交、中断或恢复操作。投递结果不明时，只按原始身份核对。 |

先注册订阅，一起取得发布者的基线和版本，再投递这个版本之后连续的变化。出现缺口或更换发布者时刷新该订阅的基线。存储游标用于已提交的变化。缺模型、缺原生文件或运行时不可用时，归档仍可读。

根与子会话复用现有历史 DataApi 和 Main 的 Timeline 订阅。读取方只拿分页和订阅两项能力。驱动解析、SDK 连接和调度器分别留给执行、恢复或命令目录的所有者。用 Oxlint 限制导入方向，覆盖 IPC 后真正提供读取的 Main 模块。在实际执行读取的函数内计数，发现 TypeScript 无法约束的扫描。

全部服务初始化后，Main 按原 session、context、Run 和输入 ID 查询未结算回复，从原生库读取已提交的正文与终态，在同一产品事务中补写原 Run 的 parts。输入归属有歧义时保留待核对状态。Durable 驱动在每次开放写入前设置 `agent_runtime_backend.needs_recovery_check`。升级后的首次启动盘点已登记的旧库，子归档写入完成后按原生历史位置清除待交付引用，库排空且确认没有剩余工作后清除候选标记。同库的各个根先装好自己的执行环境与归档接收方，再开放调度。浏览会话只读取产品归档页和订阅，发布者更换时重新取得基线。向子会话发送时按其原根执行。输入框和渠道帮助按需请求命令目录。[根会话视图](../../../../src/renderer/pages/agents/components/AgentSessionMessages.tsx) · [子归档订阅](../../../../src/main/ai/agentSession/childTimelines.ts) · [原生库恢复](../../../../src/main/ai/runtime/piDurable/PiDurableRuntimeDriver.ts)

### 5. 用会话消息初始化新上下文

更换 harness 或显式请求新上下文时，在目标 backend 中创建一条新的原生线程。A → B → A 对应 A₁ → B₁ → A₂。同一 harness 内换模型沿用当前上下文。一个会话可以为历史分支保留多个根上下文。

1. **确定截止位置。** Main 将切换与输入接纳、分支变更串行处理。在旧上下文的 Run 已结束，且没有后台任务、未解决的审批或提问、未消费输入时开始切换。记录新输入之前的选中祖先路径及截止位置。
2. **构建有界参考历史。** 读取截止位置之前选中路径的 `agent_session_message` 和关联 parts，包括早期原生上下文留下的已完成消息。复用现有 [DeepSeek 导入](../../implemented/feature/2026-11-17-deepseek-agent-import.md) 路径的格式化逻辑。只纳入已完成的对话内容，排除 reasoning 和隐藏 data，用有界摘录表示已完成的工具结果，保留必要的托管附件引用。在加载正文前，按目标模型的总参考预算和字节预算选择条目。优先保留最后一条用户消息、最后一条助手消息和第一条用户消息，再从新到旧选择。无法有界摘录的超大结果予以省略，并说明省略数量和 `pos` 范围。读取过程中避免加载整条分支或完整 sidecar 结果后再截断。
3. **初始化一次并提交绑定。** Pi Durable 在首次提交前单独写入 `cherry.reference-context`。Pi 和 Claude Code 把参考历史放在首条输入之前。Main 在提交前记录首条输入的目标绑定，以便恢复时确认原生接纳。初始化及首条输入接纳均已确认后，在首条输入的分支锚点发布新的根绑定，保留旧锚点和 checkpoint mapping。接纳前失败，旧绑定继续可用。接纳结果不确定时，先按已记录的输入和目标核对，再决定是否重试。新上下文的后续输入使用其原生历史。
4. **释放旧运行时。** 新绑定提交后，处理完旧上下文已接纳的更新，关闭它的连接，释放订阅和实时投影引用。只释放该上下文拥有的资源。切换保留旧原生历史和 checkpoint mapping，供旧分支续聊、恢复、原生 fork 或编辑重发。保留子线程的祖先关系和共享 backend。物理清理是独立操作，需要 backend 支持，并确认所有保留的上下文、任务和检查点均已解除对该 backend 的依赖。

参考历史只用于模型上下文，不生成产品消息行，也不重建原生工具状态、任务或检查点。目标每次都是新线程，初始化沿用绑定和输入身份，初版无需 `agent_session_context_transfer` 表、Run 覆盖记录或 Cherry SQLite 中的另一份历史副本。在符合条件的 Run 边界，同一 harness 的 fork 使用对应的原生 checkpoint。跨 harness 的 fork 用选中分支截至该边界的前缀初始化新线程。新的子任务仍然只接收任务 prompt，子线程 fork 仍在父线程的 backend 内执行。

### 6. 归属与位置

| 位置 | 变更 |
| --- | --- |
| `AgentSessionRuntimeService` | 把 steer 挂到当前 Run、移除续写预留、编排上下文切换和释放 |
| `RootMessageProjection`、`ChildThreadProjection` | 将原生键解析成稳定 part 并接纳 timeline 变化 |
| `AgentSessionMessageService` 与 schema | Run 和 part 存储、原子完成写入、游标读取 |
| `AgentSessionContextService` | 每个会话的多个根上下文、原生绑定和分支锚点 |
| `sessionHistory.ts` | 选中分支、截止位置、参考历史预算和排除规则 |
| `MessageProjection` 与渲染端 `aiTransport` | 按 part 寻址的 patch、有作用域的基线和按键订阅 |
| 渲染端列表与 Markdown | `pos` 顺序、part key 与增量块切分 |

### 7. 交付顺序

Part 存储和按地址更新的前置能力已经在 `main`，不要重新实现，也不要把它们的完成描述成 Run 验收。剩余工作按以下可评审单元交付。Runtime 和 renderer 单元互相依赖，对用户同时生效；不要永久保留新旧执行双模式。

| 单元 | 具体修改和删除边界 | 进入下一单元前的验证 |
| --- | --- | --- |
| 1. 执行事实和身份 | 逐 adapter 追踪触发输入、steer、排队 follow-up、Stop 和终态；将既有助手 ID 明确为 Run 所有者，只保留必要的投递 attempt ID。 | Adapter 轨迹标明 steer 前后是同次执行，并区分下一次排队执行，不从 UI 时序推断（AC1、AC3） |
| 2. Main Run 生命周期 | 已放置 steer 输入共用 `replyId`；删除续写分配及同次执行的 source／reply 迁移。Parts、用量、审批和终态回调路由到稳定 Run。 | 确定性 runtime 与 SQLite 测试断言只有一个助手记录、归属 ID 稳定、输入放置原子写入且只结束一次（AC1、AC3、AC13） |
| 3. Timeline 展示 | 依据已接纳位置独立派生展示段，与 Run 所有权分离。保留 part key 和兼容父节点，Run 控件与正文分开订阅。 | 挂载 input／ack／steer 测试统计挂载及通知，保留工具展开／审批／焦点，重连后重现顺序（AC2、AC5、AC11） |
| 4. 恢复和消费者 | 核对投递恢复、后台唤醒、子存档、用量、fork、复制／导出、搜索和工具结果读取。歧义历史保留旧边界，不按时间合并。 | 已有数据迁移／重启及来源重放覆盖迟到事件、重复终态、Stop／保存失败、受支持的 Run 边界 fork（AC12、AC13、AC15、AC16、AC18） |
| 5. 真实 steer 验收 | 在 Claude Code、Pi、Pi Durable 上执行下述矩阵，把 SDK 放置／终态事实与 DOM key 和视口移动一起记录。 | Electron 证据区分模型响应延迟、自然增长、重挂载和意外滚动，不从单测推断流畅度（AC11、AC14、AC19） |
| 6. 独立的剩余能力 | 增量历史游标、新上下文初始化和旧 runtime 释放保留各自有范围的实现与证据。 | AC4、AC7–AC10、AC17、AC20 独立验证；只有累计覆盖完整时才将 note 移到 implemented |

Steer 矩阵包括：文本打开；工具运行和审批等待；连续 steer 后再排队输入；压缩期间输入；外部会话投递；输入未放置和已放置时 Stop；观察者 detach／重连；原生终态后的排队放置；原生后台唤醒。每条轨迹记录 input ID、Run ID、part ID／位置及原生执行边界。Run 结束和用量只计一次。排队输入不伪造已放置 timeline 条目；既有打开的 part 保留较早位置。真实失败时保留可读输出，不重放输入或工具。

#23873 和 #23909 保持它们的工具结果范围。复用 #24051、#24100 和 #25406，不增加另一份正文 accumulator 或 publisher。下方已有增量链路细项继续作为回归要求；性能检查通过不等于 Run 生命周期契约通过。

#### 增量链路的修改与验证顺序

1. **先收窄公共发布函数并迁移调用方。** 给实时生产者绑定 `ThreadFeed.publishPart`。只解码后缀的函数拿到的回调只接收 `Extract<NativePartUpdate, { type: 'message.text-append' }>`，无法交付 `correct` 或快照。通用 `publish` 只接收 `Exclude<ObservationPayload, LivePartInput>`，`ThreadProjection.accept()` 继续只接收这一分支的批次。同一来源的 `message.parts` 继续支持不同种类的有序编辑。从文字 `a` 开始验证 `append("b"), put(tool), append("b")`。已挂载的观察者和后来读取基线的观察者都应得到 `abb` 和更新后的工具。最后一项无效时，整批都不可见。[Feed 发布函数](../../../../packages/agent-runtime/src/observation.ts) · [观察用例](../../../../packages/agent-runtime/tests/observation.test.ts)
2. **接入 Claude 的实际 SDK 观察器。** `observeRoot()` 和 `observeChild()` 按原生顺序投递已接纳的编辑和控制事件。移除根会话普通更新经过的 `ThreadMessageProjection.accept → message-projection`。`ClaudeFeed.publish()` 回退到原事件的逻辑不能转发已被拒绝的内容编辑。展示元数据只作用于目标块。提醒过滤器跟随打开的文本块，逐段接收后缀，块结束时输出剩余可见文字。验证跨片段的提醒、被中断的工具，以及终态控制事件之前交付的最后一段可见正文。[Claude 连接](../../../../src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts) · [展示元数据](../../../../src/main/ai/runtime/claudeCode/ClaudeMessageMetadata.ts) · [SDK 观察用例](../../../../packages/agent-runtime-claude-code/tests/observation.test.ts)
3. **沿 Claude 的一次更新走到 Main 和已挂载的行。** `RootMessageProjection.changePart()` 和子会话所有者一次接纳即产出发布操作及需要提交的值。批次中的非文本 `put` 更新其地址对应的 part，大工具结果发布前经过结果投影。删除子会话的 `delivery.applyLivePart → partValue` 回读。`MessageProjectionService.connect()` 先应用同一有效 revision 内的全部定点更新，再按键通知 hook。一个有效 revision 含有多条编辑时无需重新挂载。块结束时只更新受影响的分组。在实际挂载的根、子视图验证 AC5。[根会话所有者](../../../../src/main/ai/agentSession/RootMessageProjection.ts) · [子会话所有者](../../../../src/main/ai/agentSession/ChildThreadProjection.ts) · [Renderer 存储](../../../../src/renderer/services/aiTransport/MessageProjectionService.ts)
4. **让 Pi 和 Pi Durable 接入同一写入函数。** 通过 `PiRuntimeConnection.handleObservation()` 和 `PiDurableRuntimeConnection.onObservation()` 转发有明确块地址的编辑。对 Pi 分别模拟有间隔和连续到达的更新，再用终态纠正。对 Durable 的视图与提交回调交错投递工具进度、能确认归属的提交和有歧义的替换。重新挂载后核对可见结果和顺序，确认映射的来源应沿用原 ID。三个 harness 的 AC14 都从各自的生产回调开始，先比较 20 条和 20,000 条旧消息，再单独增加当前 Run 中已结束的兄弟块。统计发布前和已挂载 selector 的访问数，包括 React 跳过提交的更新。用 AC19 的堆引用链检查持有者，分别采样 Main 和 Renderer 的 CPU。[Pi 连接](../../../../src/main/ai/runtime/pi/PiRuntimeConnection.ts) · [Pi 会话用例](../../../../packages/agent-runtime-pi/tests/streamObservation.test.ts) · [Durable 连接](../../../../src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts) · [Durable 预览与提交用例](../../../../packages/agent-runtime-pi-durable/tests/projection.test.ts)

分别在实际执行操作的位置验收。Pi 用 20 和 1,000 条历史恢复，读取整条分支的次数保持有界，包括基线构建在内的来源总访问量至多线性增长。Claude 在 20 和 1,000 个后台任务下追加相同后缀，两种情况都读取零个任务条目。桌面远程投递分别把旧消息数和兄弟 ID 数增至 20,000，单次追加读取零个无关条目，也不枚举归属行的顺序。批次末项无效时，先前编辑不可见，批次游标保持原值。通过已挂载的分组验证开块和结束 reasoning。成功和失败结果各用 64 KiB，在提交前后展开和复制均可取得原文，并覆盖 provider metadata 中重复携带失败正文的情况。成功结果的原生元数据单独超出预算时，复制和分段读取仍返回原始输出。执行和导出读取完整数据时也会还原原生元数据。

已挂载的根会话在含 20 或 20,000 个已结束兄弟块的回复中，于 reasoning 后新开文字块。已挂载的子会话在两个原生来源之间插入文字，并在含 20 或 20,000 个已结束工具的分组旁新增工具。两种规模下，这些操作对无关已结束块正文的读取次数均为零。复制和重新挂载保留插入后的顺序。测试从 Renderer 存储入口一直计数到已挂载组件。[Renderer 存储](../../../../src/renderer/services/aiTransport/MessageProjectionService.ts) · [已挂载布局](../../../../src/renderer/components/chat/messages/blocks/MessagePartsRenderer.tsx)

#### 旧存档迁移

1. **确定正文来源。** 已有数据沿支持的迁移链升级。内联 `data.parts` 由 `0042_agent_history_artifacts_and_mcp.sql` 按原数组顺序写成 part 行，并在同一迁移内移除数组。已经拆成 part 行的数据沿用 ID 和载荷。保留原消息 ID、时间戳和角色。在已发布迁移之后追加新迁移。
2. **回填 Run 归属与位置。** 保留被祖先关系、附件或原生 fork 锚点引用的原消息行。用已有的输入放置、checkpoint 和来源归属来确认哪些输出属于同一 Run，证据不足时保留原边界。在每个存档内先放置祖先再放置后代，保留消息内的旧 part 顺序和已验证的子会话组合片段顺序。互不依赖的行用 `(createdAt, id)` 打破平局。分支读取沿用保留的祖先路径和分支边界，避免把兄弟分支混成同一段可见历史。
3. **转换原生来源。** 在变更归属前，用旧 part 顺序解析根会话的 offset/count 和子会话的来源及组合映射。旧证据唯一指向一个 part 时才写来源关联。保留原有 fork checkpoint。旧移除记录无法区分来源别名和用户删除时，保留其重放抑制语义，继续用旧恢复读取处理这类记录。
4. **按原归属迁工具结果。** 以旧 sidecar 键在原归档行中查找工具 part，并验证一一匹配。存储的结果或 blob envelope 原样保留。未确认归属的行继续支持旧地址读取，全部确定后再启用新主键。
5. **验证并切换。** 存档的位置高水位设为回填后最大的位置。启用历史游标时写入初始值。回填与约束在迁移事务内完成，升级检查通过后切换 Timeline 读写。旧引用通过兼容读取定位同一份正文。回填失败时回滚。按现有 seeder 和 FTS 规则验证附件引用和搜索索引。

## 考虑过的替代方案

- run、attempt 或 turn 表，或每条原生 assistant 消息一行：要么重复已经带有状态、统计和模型的 assistant 行，要么增加本可由条目级身份关联的行数。
- steer 时按字符切分、把打开的 part 轮转成新段、或把进行中的工具重新分组到边界之后：每一种都会增加切分或移动状态，并带来重载时的重建义务。现在的 T3 改为在首次写入时固定位置。
- 用传输 revision 作为存储游标，或采用 T3 的完整事件日志：传输 revision 只在一个发布者和订阅内有效，而 T3 自己也会压缩删除被取代的事件，所以行上的 `rev` 不需要日志就能提供同样的游标。
- part 完成前持久化空行：能在 Main 崩溃后保住未提交 part 的身份，但每个 part 要额外做一次同步写入，并处理空行恢复。恢复以已提交的正文为准，新 part 在首次保存正文前只驻留内存。
- 从原生消息 ID 直接派生公开 ID：临时来源提交时可能被替换，直接派生会导致挂载中的 part 变更 key。沿用已接纳的身份，在入口处校对替换。
- 把产品历史转换成原生 Durable 条目，或做原生到原生的转换器：会话消息已经通过同一个构建器到达每个 harness。
- 默认使用 LLM 撰写的摘要，如 [#24704](https://github.com/CherryHQ/cherry-studio/pull/24704)：需要一次模型调用，质量也不稳定。它保留为兼容的可选策略。
- 复用旧上下文并补投增量可保留原生线程的连续性，但需要追踪 Run 覆盖范围和核对投递结果。初版只需支持新上下文初始化。
- 给各消费者传完整投影再收窄类型，队列仍可能持有完整对象，实现也仍可重建快照。现有所有者接收操作实际需要的值，完整视图保留给明确请求它的调用方。

## 验收标准

- AC1 — 已放置的 steer 通过同一个助手行 Run ID 和 `replyId` 加入活跃原生执行，不分配另一条助手记录，也不由投递定义执行。连续 steer、压缩及审批等待保留该所有者；单个输入结果不结束 Run。对应原生终态只结束 Run 并结算用量一次，随后排队的新执行获得新 Run（verification: adapter 契约、runtime 状态及 SQLite 测试；Main runtime 负责人）
- AC2 — 输入和 part 按 `pos` 顺序渲染。即使后来的 steer 先提交，先接纳的 part 在流式输出和保存后都留在它上方。第二个窗口挂载、窗口刷新和重连到同一个 Main 进程都重现实时顺序（verification: unit 与 Electron；投影和渲染负责人）
- AC3 — 在同一个 Main 进程内，已接纳的 part 在重连和快照替换后保持 ID。已提交的 part 在重启后保持 ID，在 Claude Code、Pi 和 Pi Durable 依据已知原生来源重放时复用该 ID。新写入不再添加 offset/count composition，遗留行保持可读（verification: harness 契约与 setupTestDatabase unit；runtime 负责人）
- AC4 — 每次提交的行变更都会增大 `rev`；游标为 N 的读取方恰好收到 N 之后变更的行，删除或切换分支返回新快照（verification: setupTestDatabase unit；Main 数据负责人）
- AC5 — 向打开的文本或思考 part 追加内容时只发布一个按 part 寻址的 append，不带其他 part 和顺序。在已挂载的根、子会话视图中，目标块显示追加后的文字。布局未变的工具进度更新对应的工具卡。对于这两类更新，无关行、列表顺序、Run 控件和审批的监听器收到零次通知，快照引用稳定，对应组件自身的渲染提交为零。完成 part 改变分组时，受影响的分组随之更新。行复用或切换目标后显示当前键的值。持久化历史接手后，同一键可以读到已提交的值（verification: 传输单测与挂载真实组件的 Renderer 集成，挂载后按键统计通知及各组件自身的渲染提交；传输和渲染负责人）
- AC6 — part 流式输出期间，Markdown 只从它最后一个不稳定块开始重新切分，已完成的块保留 DOM（verification: renderer；Markdown 负责人）
- AC7 — 在同一个 harness 内换模型保留同一个上下文和原生历史（verification: unit 回归；runtime 负责人）
- AC8 — 换 harness 或显式切换上下文时创建新的原生线程。A → B → A 创建三个线程绑定，每个新线程在生成首次响应前都收到选中分支截止位置之前的参考历史（verification: unit；Main runtime 负责人）
- AC9 — 参考历史满足 token 和字节预算，按所述优先级选择已完成的可见对话内容并报告省略项。构建过程不加载超大 sidecar 输出（verification: 存储与 runtime unit；Main 数据和 runtime 负责人）
- AC10 — 有活跃 Run、后台任务、待处理交互或未消费输入时不执行切换。原生接纳前失败，旧绑定仍可用。接纳过程被打断时，按输入身份核对，避免重复投递历史或提交输入（verification: 带故障注入的 unit；Main 数据和 runtime 负责人）
- AC11 — 在 Electron 中，Claude Code 和 Pi Durable 上流式文字期间和工具运行期间的 steer 都让之前的 part 保持挂载，一个 Claude Code 到 Pi Durable 再回到 Claude Code 的会话能在每次切换后基于参考历史作答（verification: Electron；实现负责人）

- AC12 — 子会话单次回复跨两个原生消息时，attach、替换及重载后仍能按 part ID 读取后一条消息的大工具结果。无关追加或存档重读不影响该结果的订阅（verification: Main 与 Renderer 集成；工具结果和子会话负责人）
- AC13 — Main 意外重启后，已提交的输入和 part 保持 ID 和相对顺序，包括前面还有未提交 part 的情况。Renderer 在 steer 消息和 Run 内部位置不提供 Fork，Main 拒绝从这些位置发起 fork。受支持的已完成 Run 边界仍可 fork 并继承对应的历史（verification: 已填充 SQLite 和 fork 能力测试；存储、runtime 和 Renderer 负责人）
- AC14 — 固定当前文本 part 和后缀大小，分别增加旧消息数和当前回复中已完成的 part 数。两种情况下，单次纯追加从三个 harness 各自的原生回调到已挂载的 Renderer hook，访问的消息和 part 数量均保持不变。即使 React 跳过渲染，也统计 selector 的读取。无关 hook 为这次追加读取的 part 正文数和重建整页 parts 映射的次数均为零。覆盖专用后缀事件和等价的 `message.parts` 编辑，并在各自支持的场景中接入渠道、自动朗读、诊断和远程消费者。路径不构建快照，零同步 SQLite 读写。本地 Oxlint 须拦住实时生产模块直接或经 barrel 导入全量读取接口，以及发布函数在同文件内回读消息。按键订阅的 React hook 和恢复分页读取应通过。保存、Stop 和原生终态纠正沿用已提交的 part ID（verification: 类型检查、本地 Oxlint 用例与端到端集成测试，统计访问和查询次数；runtime、存储与 Renderer 负责人）
- AC15 — 发布 fork checkpoint 保留已有根、子恢复区段。原生别名替换保留 part ID 和位置。用户删除提交后，无论通过哪个别名重放，内容都不会复活，受影响的实时载荷引用会释放（verification: SQLite 和 runtime 回归测试；Context 和 Timeline 负责人）
- AC16 — 已填充的内联历史和 part 表历史升级后，保留选中分支及各分支顺序、已有 ID、子存档、fork checkpoint、工具结果归属、附件和搜索读取。来源或结果映射不确定时保留可读性，回填失败时回滚（verification: 用 setupTestDatabase 执行生产迁移；Main 数据与恢复负责人）
- AC17 — 切换成功后，旧上下文释放连接、订阅和投影引用。早期分支的历史仍可读取，原生 fork 检查点仍可用，共享 backend 仍可为保留的上下文服务（verification: runtime 集成与 Electron heap retainers；runtime 和恢复负责人）
- AC18 — 有真实历史的根和子会话重启时只加载请求的紧凑历史页和待提交 part，挂载时不读取 sidecar 正文。将原始工具结果直接传给 Agent 发布端时，类型检查失败。同一个工具详情在提交前后通过 part ID 查找，覆盖失败工具及归档行和展示回复不同的子会话。显式导出和模型上下文读取保持既有语义（verification: 类型检查、已填充的 SQLite 与 Main 到 Renderer 集成；存储和传输负责人）
- AC19 — Main 每次实时追加只更新一份活动正文。打开、追加、更新工具进度和进入终态只访问操作所需的受影响 part 和顺序条目。打开或完成 part 时，统计对其他已加载行的访问。查询位置和选取 ID 时读取的 part 正文数为零。提交、删除或所有者释放后，通过引用链确认 Agent 发布端和流转发不再持有已完成正文、过期结果或整份序列化结果。检查历史接手后已脱离订阅的 Renderer overlay，以及最后一个句柄释放后的原生归档。固定活动内容，在不同历史规模下比较 Electron 堆和外部 Buffer 内存（verification: 原生生产到 Renderer 全链路访问计数、本地 Oxlint 与 Electron 堆保留分析；runtime 和 Renderer 负责人）
- AC20 — 分别用 20 条和 20,000 条历史打开空闲根会话及已归档子会话。在驱动与存储入口统计原生打开、调度器恢复和已结算回执读取次数，浏览时三项均为零。在注册订阅和交付基线之间从第二个窗口启动 Run，首个 part 恰好交付一次。验证分支锚点与游标、首次发送前的命令发现，以及没有打开标签页时对待结算回复和已知 backend 中仅原生持有任务的恢复。分别测应用启动、打开到可见、发送到正文首帧。将模型上下文读取归给执行，并在执行入口统计无关历史读取（verification: Main 与 Renderer 负责人通过集成测试、Oxlint 边界用例与 Electron 进程采样验证）

## 风险

- Main 意外退出可能丢失尚未提交的 part。原生恢复可以提供新条目，这些条目可以使用新的 ID 和位置。
- 在 steer 上方流式输出的 part 增长时会把 steer 往下推。这是接受的 T3 行为，只有在 Electron 中有证据时才重新考虑。
- 部分 adapter 在提交后会改变原生 ID。要求稳定键或已证实的别名，并对每个 adapter 验证重放。
- 预算可能省略相关历史。新线程从选中的参考事实开始，建立自己的执行状态。早期分支的原生恢复和检查点操作仍依赖原线程。
- 存储切换前覆盖真实已有数据的升级。未发布的迁移改动按当前基线重新生成，已发布的迁移链继续保留。
- 一个会话有多个根上下文，会改变那些假设只有一个绑定的恢复、fork 和删除路径。
