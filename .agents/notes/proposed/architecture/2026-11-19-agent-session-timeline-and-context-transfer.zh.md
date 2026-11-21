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

本 note 是 [runtime 契约](2026-10-17-agent-runtime-contract.md) 的细化。它部分取代 [message-list subscriptions](https://github.com/CherryHQ/cherry-studio/blob/f65c54cd6069caf5b1efa3c99ea1fe08ce543645/.agents/notes/proposed/architecture/2026-11-09-message-list-subscriptions.md) 中关于 steer、part 身份和游标的部分、[native steer](https://github.com/CherryHQ/cherry-studio/blob/ab83909a7c637c81c6d59221f76d1aad919d2add/.agents/notes/proposed/bug-fix/2026-11-09-agent-native-steer.md) 的渲染端切分模型，以及 session runtime binding 的不可变规则。[工具结果边界](2026-11-09-tool-result-projection-boundaries.md) 不变：它的发布 revision 仍是投递序号，与下文的存储游标相互独立。

## 提议

### 1. Run 负责执行，Timeline 负责内容

harness 放置触发输入时开始一次 run，在原生终态时结算。用现有 assistant 行作为 run 的物理记录，行 ID 即 run ID，状态、统计、模型和分支祖先关系都留在行上。排队时保留已持久化的输入 ID 和排队状态，放置时才作为 steer 加入活跃 run，或开启自己的 run。`replyId` 记录执行归属，`parentId` 记录祖先关系。steer 不预留续写行。迟到事实归原 run。后台唤醒若在原 run 结算后开启新的原生执行，则分配新 run ID。

时间线包含输入引用和输出 part。输入条目引用已有输入行。#24051 的 part 表是输出正文的唯一持久化来源。每个新增输出 part 恰好属于一个 run，有一个固定位置。导出、模型上下文等历史读取者可由适配器按需组装 `parts[]`。渲染分组独立于持久化归属。

根和子会话沿用同一契约，各子存档维护自己的顺序和版本。迁移保留消息 ID、分支和 fork 锚点、附件引用和已保存的 part ID。用已有的回复和 composition 事实确定历史 run 归属，证据不足时保留既有边界。读取既有分支时沿用其选中祖先路径和已记录的边界。将旧存档引用对应到 part ID 时，保留原始工具结果的归属。

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
| `agent_session` | 切换：`lastPos`。历史：`committedRev`、`resetVersion` | Main 在放置事务中推进 `lastPos`。每次可见历史变更提交时推进 `committedRev`，该事务变化的行共用它。删除在同一事务内推进 `resetVersion`，让旧游标重新读取基线。 |
| `agent_session_context` | 现有：`id`、`sessionId`、`backendId`、`nativeThreadId`、`bindingState` | 将存档绑定到一个后端上的原生线程。原生线程身份尚未确认时允许待绑定。 |
| `agent_session_context` | 现有：`parentContextId`、`spawnToolCallId`、`anchorMessageId`、`checkpointMapping` | 上下文祖先和创建工具调用定位子上下文，锚点指出产品分支起点。恢复沿用已有 checkpoint。 |
| `agent_session_message` | 现有：`id`、`sessionId`、`role`、`parentId`、`replyId` | user 行是输入，assistant 行承载 Run。`parentId` 构成分支树。user 的 `replyId` 指向同存档 assistant 行，触发输入和 steer 可以关联同一 Run。现有重新生成路径可以改写这个关联。 |
| `agent_session_message` | 现有：`inputContextId`、`nativeInputId`。切换：user 行的 `pos`。历史：`rev` | Main 在原生提交前绑定 user 行与上下文，随后用原生输入 ID 完成关联。只有原生放置会分配输入位置。历史版本标记可见输入或 Run 的提交变更。 |
| `agent_session_message` | 现有：`status`、`modelId`、`stats`、`searchableText` | assistant 行承载执行状态、模型、用量和派生的搜索索引值。终态结算写状态和统计。搜索文本从内容 parts 生成。 |
| `agent_session_message_part` | 现有：`id`、`messageId`、`sessionId`、`seq`、`type`、`payload` | `id` 是稳定的 part ID。外键 `messageId` 指向拥有内容的行：用户正文指向 user 行，新增 assistant 输出指向 Run 行。`seq` 为输入及旧读取者保留行内顺序。`type` 区分载荷类型。 |
| `agent_session_message_part` | 新 Run 输出切换：`pos` 和原生来源关联。历史：`rev` | 接纳时持久化含 ID、归属、位置、来源的放置记录；首次提交正文前，放置记录的 `payload = NULL`。历史正文读取跳过此类记录，恢复仍可读取其 ID 和位置。user 正文 parts 共享所属输入的时间线位置，各自的 `seq` 决定该输入内部顺序。 |
| `agent_session_tool_output` | 现有键：`(messageId, toolCallId)`。切换键：`partId`，沿用 `output` | `partId` 同时是主键和指向工具 part 的外键，删除时级联清理。完成或替换时原子写 part 及其当前结果。迁移从旧键定位归属，启用新主键前，在已有数据上验证每个可读旧结果都有唯一归属。未确认的结果在迁移期间保留旧读取路径。 |

`inputContextId` 记录输入的原生绑定，排队的输入也可能已有绑定。Main 从原生放置得到实时 Run 的执行上下文。历史读取只有在触发输入关联唯一且不可变时才能沿它推导上下文。现有的 `replyId` 反查无法保证唯一或不变。证据不足时保留未知归属。Timeline 切换和新上下文初始化均无需给 assistant 行添加上下文字段。

Main 验证输入到 Run、part 归属和锚点都位于同一存档。输入行与输出 part 行共用一个位置分配器，单表索引无法保证跨表唯一。通过 part 的所有者可以确定工具结果所属存档。结果变化若对历史可见，在同一事务内推进所属 part 的历史版本。

### 2. 条目顺序与持久化提交

| 字段 | 分配时机 | 用途 |
| --- | --- | --- |
| `pos` | 放置输入或首次接纳 part 时分配一次 | 存档内的时间线顺序 |
| `rev` | 每个可见历史变更事务分配一次，由该事务改变的行共享 | 持久历史游标 |

一个存档由一个 Main 所有者分配位置。将 part ID 和位置作为放置元数据一起保存。接纳时持久化一次放置记录，然后发布该身份。这样即使前面的活跃 part 正文还没提交，恢复也能还原顺序。token 追加不写 SQLite。part 完成时原子写入变化的 part 及相关工具结果或附件引用。终态和 Stop 仅保存剩余已收到的 parts 并结算 run，保留已有 ID 和位置。保存成功后才发布相应事实。失败时保留可读的实时内容，供既有重试或终态路径处理。

时间线顺序在放置时固定。一个已经打开的 part 持续增长时仍留在后续 steer 的上方，新 part 按自己的位置出现。旧行依据既有证据按原来的展示顺序分配位置。切分支或改变界面分组时不重新分配位置。

### 3. 稳定的 part 身份和工具结果归属

首次接纳 part 时分配一个 ID，后续实时及持久化更新沿用这个 ID。原生键由上下文、规范化后的原生来源和块键共同确定。有 tool-call ID 或显式 data ID 时优先使用，原生下标只在块顺序稳定的原生来源内部使用。临时来源被提交后的来源替换时，由 adapter 报告明确的别名。接纳替换之前，别名必须解析到已接纳的 ID 和位置。无法证明对应关系时，在 adapter 边界校对该来源，或请求新基线。产品消息下标和展示分组 ID 都不承载存储身份。

Main、SQLite 和 Renderer 失效通知沿用同一 part ID 寻址当前工具结果。从原有的消息和 tool-call 归属迁移最新结果的关联，载荷留在现有 sidecar。提交前读取已接纳的实时结果，原子交接后读取持久化结果。结果替换只使对应 part 的结果缓存失效。新增写入用稳定的来源关联，旧 offset/count composition 仍可供既有历史和恢复读取。

#### Context 绑定与投影归属

`agent_session_context` 负责原生线程绑定和原生 fork 恢复。Timeline 所有者维护来源到 part 的关联、条目位置和删除状态。Timeline 的新增写入使用这些关联，取代根会话的数组范围和子会话的组合映射。旧 `checkpointMapping.root` 和 `checkpointMapping.child` 继续供历史恢复读取。发布 fork 时只更新 `checkpointMapping.fork`，同一事务中保留其他恢复区段。当前 [fork 发布](../../../../src/main/data/services/AgentSessionContextService.ts) 会替换整个映射，因此要补保留区段的回归用例。

新增 fork 只允许从成功结束的 Run 的受支持边界发起。同一 harness 的原生 fork 要求该边界有对应的原生 checkpoint。Renderer 仅在符合条件的边界提供 Fork，Main 在准备 fork 前拒绝 steer 消息及 Run 内部位置。

原生来源明确替换时，将别名解析到原 `partId` 和位置。用户删除时，在删除事务中记录规范来源的重放抑制状态，避免该内容在恢复时复活。只有确认该来源无法再被重放时才清理这条记录。历史游标重置用于刷新读取视图，重放抑制用于约束 Timeline 写入。

删除提交后，Main 通知实时 Timeline 所有者受影响的 part ID。所有者释放其正文引用、已接纳结果和索引，再向订阅端发布移除。当前投影靠[读取整行上下文](../../../../src/main/ai/agentSession/RootMessageProjection.ts)同步删除，还留存已完成正文用于比较。Timeline 切换时移除这两条路径。在 Electron 复现中用 heap retainers 验证引用已释放。

### 4. 增量接纳、投递和恢复

Main 的 timeline 所有者接纳规范化的来源变化。一次应用直接产出变化的条目或文字后缀以及待持久化的内容。仍提供累积原生消息的 adapter 在入口处只校对变化的来源及其报告变化的块。持久化和发布按变化执行，无需重新扫描整条回复来推断变化。

纯文本追加时，原生预览生产者在构建任何累积视图前直接给出变化的来源块身份和后缀。Main 将来源块解析为稳定的 part ID。实时追加处理只接收后缀及对应的 part 或其键。初始化、附着或恢复时构建有作用域的快照。在 `.oxlintrc.json` 中，用 `no-restricted-imports` 的文件级规则约束追加生产和处理模块，禁止导入全量视图类型、快照构建器、历史读取器及整消息 diff，包括其转导出。

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

1. 本 Spec 放在栈底，连同 runtime 契约的修订。
2. 存储：复用 #24051 的 part 表，加入稳定的放置信息及 run 归属，迁移 sidecar 关联，遵循已发布迁移的追加规则。
3. 同次交付切换 Agent timeline：根和子会话接纳条目操作，复用 #24100 的完成写入，迁移按键投递与订阅，移除 Agent 的整消息热路径。
4. 验证迁移后的消费者，独立测量 Markdown。
5. 新上下文初始化、绑定和旧运行时释放，session runtime binding 在它自己的分支里修订。
6. Electron 验收。只有这一层把 note 移到 implemented。

#23873 和 #23909 保持它们的工具结果范围。在切换时让 Agent 调用者使用工具 part 地址。message-list subscriptions 在它自己的那一层修订，在 steer 放置、part 身份和游标上以本 note 为准。

#### 旧存档迁移

1. **确定正文来源。** 已有数据沿支持的迁移链升级。内联 `data.parts` 由 #24051 的 `0043_agent_session_message_part.sql` 按原数组顺序写成 part 行，并在同一迁移内移除数组。已经拆成 part 行的数据沿用 ID 和载荷。保留原消息 ID、时间戳和角色。在已发布迁移之后追加新迁移。
2. **回填 Run 归属与位置。** 保留被祖先关系、附件或原生 fork 锚点引用的原消息行。用已有的输入放置、checkpoint 和来源归属来确认哪些输出属于同一 Run，证据不足时保留原边界。在每个存档内先放置祖先再放置后代，保留消息内的旧 part 顺序和已验证的子会话组合片段顺序。互不依赖的行用 `(createdAt, id)` 打破平局。分支读取沿用保留的祖先路径和分支边界，避免把兄弟分支混成同一段可见历史。
3. **转换原生来源。** 在变更归属前，用旧 part 顺序解析根会话的 offset/count 和子会话的来源及组合映射。旧证据唯一指向一个 part 时才写来源关联。保留原有 fork checkpoint。旧移除记录无法区分来源别名和用户删除时，保留其重放抑制语义，继续用旧恢复读取处理这类记录。
4. **按原归属迁工具结果。** 以旧 sidecar 键在原归档行中查找工具 part，并验证一一匹配。存储的结果或 blob envelope 原样保留。未确认归属的行继续支持旧地址读取，全部确定后再启用新主键。
5. **验证并切换。** 存档的位置高水位设为回填后最大的位置。启用历史游标时写入初始值。回填与约束在迁移事务内完成，升级检查通过后切换 Timeline 读写。旧引用通过兼容读取定位同一份正文。回填失败时回滚。按现有 seeder 和 FTS 规则验证附件引用和搜索索引。

## 考虑过的替代方案

- run、attempt 或 turn 表，或每条原生 assistant 消息一行：要么重复已经带有状态、统计和模型的 assistant 行，要么增加本可由条目级身份关联的行数。
- steer 时按字符切分、把打开的 part 轮转成新段、或把进行中的工具重新分组到边界之后：每一种都会增加切分或移动状态，并带来重载时的重建义务。现在的 T3 改为在首次写入时固定位置。
- 用传输 revision 作为存储游标，或采用 T3 的完整事件日志：传输 revision 只在一个发布者和订阅内有效，而 T3 自己也会压缩删除被取代的事件，所以行上的 `rev` 不需要日志就能提供同样的游标。
- 从原生消息 ID 直接派生公开 ID：临时来源提交时可能被替换，直接派生会导致挂载中的 part 变更 key。沿用已接纳的身份，在入口处校对替换。
- 把产品历史转换成原生 Durable 条目，或做原生到原生的转换器：会话消息已经通过同一个构建器到达每个 harness。
- 默认使用 LLM 撰写的摘要，如 [#24704](https://github.com/CherryHQ/cherry-studio/pull/24704)：需要一次模型调用，质量也不稳定。它保留为兼容的可选策略。
- 复用旧上下文并补投增量可保留原生线程的连续性，但需要追踪 Run 覆盖范围和核对投递结果。初版只需支持新上下文初始化。

## 验收标准

- AC1 — run 进行中被接受的 steer 通过 `replyId` 挂到该 run 上；不创建续写行，run 在原生终态时只结束一次（verification: unit；Main runtime 负责人）
- AC2 — 输入和 part 按 `pos` 顺序渲染：steer 之前创建的 part 在流式输出时仍留在它上方，之后的 part 渲染在下方，重载、第二个窗口和重连都重现同样的顺序（verification: unit 与 Electron；投影和渲染负责人）
- AC3 — 在 Claude Code、Pi 和 Pi Durable 上，同一个原生块在重连、快照替换和重启后解析到同一个 part ID；新写入不再添加 offset/count composition，遗留行保持可读（verification: harness 契约与 setupTestDatabase unit；runtime 负责人）
- AC4 — 每次提交的行变更都会增大 `rev`；游标为 N 的读取方恰好收到 N 之后变更的行，删除或切换分支返回新快照（verification: setupTestDatabase unit；Main 数据负责人）
- AC5 — 向打开的 text part 追加内容时只发布一个按 part 寻址的 append，不带其他 part 和顺序，并且只有该 part 的订阅者重新渲染（verification: unit 与 renderer；传输和渲染负责人）
- AC6 — part 流式输出期间，Markdown 只从它最后一个不稳定块开始重新切分，已完成的块保留 DOM（verification: renderer；Markdown 负责人）
- AC7 — 在同一个 harness 内换模型保留同一个上下文和原生历史（verification: unit 回归；runtime 负责人）
- AC8 — 换 harness 或显式切换上下文时创建新的原生线程。A → B → A 创建三个线程绑定，每个新线程在生成首次响应前都收到选中分支截止位置之前的参考历史（verification: unit；Main runtime 负责人）
- AC9 — 参考历史满足 token 和字节预算，按所述优先级选择已完成的可见对话内容并报告省略项。构建过程不加载超大 sidecar 输出（verification: 存储与 runtime unit；Main 数据和 runtime 负责人）
- AC10 — 有活跃 Run、后台任务、待处理交互或未消费输入时不执行切换。原生接纳前失败，旧绑定仍可用。接纳过程被打断时，按输入身份核对，避免重复投递历史或提交输入（verification: 带故障注入的 unit；Main 数据和 runtime 负责人）
- AC11 — 在 Electron 中，Claude Code 和 Pi Durable 上流式文字期间和工具运行期间的 steer 都让之前的 part 保持挂载，一个 Claude Code 到 Pi Durable 再回到 Claude Code 的会话能在每次切换后基于参考历史作答（verification: Electron；实现负责人）

- AC12 — 子会话单次回复跨两个原生消息时，attach、替换及重载后仍能按 part ID 读取后一条消息的大工具结果。无关追加或存档重读不影响该结果的订阅（verification: Main 与 Renderer 集成；工具结果和子会话负责人）
- AC13 — steer 提交后发生崩溃，重放它之前仍打开的 part 会保留原位置和 ID。Renderer 在 steer 消息和 Run 内部位置不提供 Fork，Main 拒绝从这些位置发起 fork。受支持的已完成 Run 边界仍可 fork 并继承对应的历史（verification: 已填充 SQLite、原生重放和 fork 能力测试；存储、runtime 和 Renderer 负责人）
- AC14 — 固定当前文本 part 和后缀大小后，增加已完成历史不会增加单次纯追加从原生预览生产到 Renderer 访问的消息或 part 数量。路径不构建快照，零同步 SQLite 读写。Oxlint 拒绝追加模块导入全量视图依赖，恢复模块可以导入。保存、Stop 和原生终态纠正沿用已提交的 part ID（verification: 本地 Oxlint 与端到端集成测试，统计访问和查询次数；runtime、存储与 Renderer 负责人）
- AC15 — 发布 fork checkpoint 保留已有根、子恢复区段。原生别名替换保留 part ID 和位置。用户删除提交后，无论通过哪个别名重放，内容都不会复活，受影响的实时载荷引用会释放（verification: SQLite 和 runtime 回归测试；Context 和 Timeline 负责人）
- AC16 — 已填充的内联历史和 part 表历史升级后，保留选中分支及各分支顺序、已有 ID、子存档、fork checkpoint、工具结果归属、附件和搜索读取。来源或结果映射不确定时保留可读性，回填失败时回滚（verification: 用 setupTestDatabase 执行生产迁移；Main 数据与恢复负责人）
- AC17 — 切换成功后，旧上下文释放连接、订阅和投影引用。早期分支的历史仍可读取，原生 fork 检查点仍可用，共享 backend 仍可为保留的上下文服务（verification: runtime 集成与 Electron heap retainers；runtime 和恢复负责人）

## 风险

- 后继依赖提交前，需要持久化未完成 part 的位置。用长会话测量放置和完成事务的次数。
- 在 steer 上方流式输出的 part 增长时会把 steer 往下推。这是接受的 T3 行为，只有在 Electron 中有证据时才重新考虑。
- 部分 adapter 在提交后会改变原生 ID。要求稳定键或已证实的别名，并对每个 adapter 验证重放。
- 预算可能省略相关历史。新线程从选中的参考事实开始，建立自己的执行状态。早期分支的原生恢复和检查点操作仍依赖原线程。
- 存储切换前覆盖真实已有数据的升级。未发布的迁移改动按当前基线重新生成，已发布的迁移链继续保留。
- 一个会话有多个根上下文，会改变那些假设只有一个绑定的恢复、fork 和删除路径。
