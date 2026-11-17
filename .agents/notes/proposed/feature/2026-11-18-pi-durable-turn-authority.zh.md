# Agent Note: 由 Pi Durable 统一拥有 turn 生命周期与结果

Status: proposed

[English](2026-11-18-pi-durable-turn-authority.md) | 中文

## Problem

Issue #24748 延续 #23565 的归属工作。Pi Durable 持久化 submission、task 和回答，Main 却独立判断接纳、运行状态和终态。因此，投递失败或 Stop 可能覆盖原生执行事实，原生任务完成后产品回复也可能继续显示加载状态。

证据来自 HEAD `29d15009d47a70ee76c81ee7a148b83986e94293`。相关源码的 tree/blob 与指定 base `442ccc59195cc4cc070da9770c79b9ed65ceddb3` 一致；当前检出多了一个版本发布提交。以下是现状核查，不代表拟议行为已经通过验证：

- `submissionState` 已把 native record 归一化为 `InputState.outcome` 和原因，包括独立的 `unanswered` record 分支（`packages/agent-runtime-pi-durable/src/projection.ts:221–283`）。连接却把所有非 `completed` outcome 当成错误，用 `sending` 控制结算，并选取 batch 中第一个非成功输入（`src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts:276–290`）。其 `finishTurn()` 根据本地 `failure` 选择 `error` 或 `turn-complete`；`fail()` 发出错误并关闭连接（同文件：315–338、562–565）。
- Main 将 `turn-complete` 转为 success，将 runtime error 转为 error，再把 stream listener 回调写回终态（`src/main/ai/agentSession/AgentSessionRuntimeService.ts:343–357, 2547–2558, 3051–3077`）。reducer 保留 `terminal`、settled delivery status 和 `lastTerminal`，并可能让先前非成功结果优先于后来事件（`src/main/ai/agentSession/agentSessionRuntimeState.ts:50–81, 421–425, 480–487`）。这些是额外的结果裁决，而非单纯的投递确认。
- `sending` 拒绝发送，`autonomous` 包围 runtime 主动发起的投递（`src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts:154–157, 294–299, 335–337`）。native submission 已支持 `reject`、`steer` 和 `follow-up`，接纳操作已串行化，`follow-up` 会转换为 native `followUp`（`packages/agent-runtime-pi-durable/src/runtime.ts:744–750, 799–804, 840–847`）。native `pi.live.run` 提供投影 activity，submission record 提供 accepted/queued/placed facts（`packages/agent-runtime-pi-durable/src/projection.ts:135–175, 210–217, 273–282`）。`background-work-state` 单独投影 behavior results，不是 foreground Task 的权威状态。没有 input 的 native run settlement 也已从 `GenerationTask.state.outcome` 推导到 `facts.live.runEnd`（`packages/agent-runtime-pi-durable/src/behavior/history.ts:255–280`）。
- 真实 Stop 链为 renderer `stop()` → `ai.stream.abort` → `AiStreamManager.abortAndDrain()` → stream abort 和 `closeSession(..., true)` → `closeRuntimeConnection()` → connection `interrupt()` → native handle `interrupt()` → shared `userStop` → 普通 native abort，随后执行 connection `close()`。证据：`src/renderer/hooks/useStreamCommands.ts:118–120`；`src/main/ipc/handlers/ai.ts:184–185`；`src/main/ai/streamManager/AiStreamManager.ts:1385–1421`；`src/main/ai/agentSession/AgentSessionRuntimeService.ts:1167–1174, 3649–3662`；`src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts:523–525`；`packages/agent-runtime-pi-durable/src/runtime.ts:851–861`；`packages/agent-runtime-pi-durable/src/behavior/harness.ts:153–168, 479–482`。不存在直接的 Stop → `fail()` 跳转；observation error 才走另一个关闭路径。
- 最后一个 backend 使用者释放时，当前先 shutdown owner，**再**执行 connection flush 回调（`src/main/ai/runtime/piDurable/PiDurableRuntimeDriver.ts:88–97`）。native storage 关闭时捕获最终 archive，connection 随后 drain observer 并停止 child projection（`packages/agent-runtime-pi-durable/src/runtime.ts:199–227`；`src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts:592–607`）。`durableDesktop.close()` 关闭宿主资源；`durableFork.ts` 执行 native fork 事务，不负责 backend shutdown。当前 `retainWhileIdle` 会跳过 idle TTL release（connection:61；Main service:3504–3507）。
- Resume 身份已保存在消息上：TypeScript 字段为 `inputContextId`、`nativeInputId`，SQL 列为 `input_context_id`、`native_input_id`，两列组合有唯一约束（`src/main/data/db/schemas/agentSessionMessage.ts:32–33, 52`；`migrations/sqlite-drizzle/0040_agent_session_tree_constraints.sql:14–15, 40`）。`nativeSubmission.ts` 在 dispatch 前绑定 context，在取得证据后绑定 native identity，lookup 同时接受 logical 或 native input identity（同仓库的 `src/main/ai/agentSession/nativeSubmission.ts:28–71, 85–103`）。位置不是 `state/`。native entry metadata 的 `cherryInputId` 是另一个关联字段（`packages/agent-runtime-pi-durable/src/runtime.ts:799–808`）。Main 替换连接时的对账遍历内存 `pendingInputs`，仅凭这一点不能证明冷启动恢复完整（Main service:2304–2327）。
- 重开已经会发 baseline，但 baseline batch 有意省略 `completion`，historical message 也不属于 live（`packages/agent-runtime-pi-durable/src/projection.ts:69–90`）。`ThreadProjection.accept()` 将内容转交 `RootMessageProjection.accept()`；后者跳过没有已保存 owner 的 historical source，构造函数也只恢复保存过的 source range（`src/main/ai/agentSession/ThreadProjection.ts:21–39`；`src/main/ai/agentSession/RootMessageProjection.ts:31–44, 128–136`）。未完成 terminal persistence 的回复需要明确的重建契约。
- Renderer pending state 读取 `topic.stream.statuses.<topicId>.status` 和 `activeExecutions`；消息占位读取 `isActiveTurnProcessing`。空的 stopped 回复来自 `message.status === 'paused'`，经 `message.chat.completion.paused` 渲染（`src/renderer/hooks/useTopicStreamStatus.ts:39–50`；`src/renderer/components/chat/messages/blocks/MessagePartsRenderer.tsx:1822–1841`；`src/renderer/components/chat/messages/markdown/ChatMarkdownRuntime.tsx:37–39`）。这些消费者并不直接读取 reducer 的 `lastTerminal`；Main 另外通过 `inspect().lastTerminalStatus` 暴露它（Main service:1598–1611）。占位 activity 还结合 message processing 与 topic status（`src/renderer/components/chat/messages/hooks/useMessageActivityState.ts:40–53`）。

本文件是针对 Pi Durable desktop 路径的新 `feature` Spec。它拟在 `pi-durable` 范围内部分替代 [boundary-ownership note](../simplification/2026-11-05-agent-runtime-boundary-ownership.md)：该路径上 reducer 对生命周期及 queued、steer、autonomous 或 deferred successor 的裁决权移交给 native；其余 runtime 继续由旧 note 拥有。它细化而不替代 [runtime-contract note](../architecture/2026-10-17-agent-runtime-contract.md)。其中 native identity 和 ownership 的决策依据在拟替代范围之外继续适用。

## Proposal

### Scope and authority

Pi Durable 拥有 turn 接纳、排队、执行和终态结果。Main 拥有产品消息关联和投递；renderer state 是可以丢弃并重建的 native observation 展示。此契约只适用于 `pi-durable`。legacy `process` runtime 的 Stop、排队、生命周期和结果行为保持不变；共用消费者必须保留其他 driver 的既有行为。

本次交付只有 proposed 双语 Spec。仓库治理允许在 Spec PR 存在后开始实现，无须预先取得人工 Approval；本任务不授权实现。中间层始终保持 proposed；只有最后一层为全部 AC 提供证据后，才可移动并改写为 implemented。下文尚未解决的 Stop 范围仍需人工裁决。

Out of scope：

- Children ownership hierarchy（#24231）。
- Append-only queue 与 conversation branches，需要产品决策。
- 内存压力下的 cache eviction，需要先决定目标行为。
- legacy `process` runtime。

### One product-result boundary

保留 `submissionState` 的 native 归一化职责。唯一的 Pi Durable 产品结果边界接收 context 范围内的 `InputState`，包含 logical/native identity、`outcome`、可选 `RuntimeError` 以及 native response/run 关联。输出要么没有终态结果，要么为一份有类型的产品结果，包含关联 input/reply identity、`success | paused | error`，以及存在时的原始 reason code/message。live observation、恢复后的 baseline 和 archive recovery 共用这一边界；Main listener 和 renderer transport 不再另行推断结果。

| Native input outcome | Product result | Reason contract |
| --- | --- | --- |
| `completed` | `success` | 不合成错误。 |
| `aborted` | `paused` | 保留取消原因；仅在 native 证据出现后显示 stopped。 |
| `unanswered` | `paused` | 保留没有最终回答的原因，包括 `output-truncated` 和 `no-final-answer`；不得悄悄显示 success。 |
| `failed` | `error` | 保留 native error code/message，包括 native `faulted`、`model_error` 或归一化后的 `model-error`。 |
| 缺失 | 没有终态结果 | 接纳确认、idle activity 和 observation error 都不能代替 outcome。 |

每个 outcome 必须关联真实 input 和 native answer/run。一个 batch 可以含多个 input，不能由数组顺序决定无关回复的结果。steering 行边界仍是展示边界，不是额外 native terminal outcome。对于没有 submitted user input 的工作，同一边界接受带判别标记的 native Task settlement，包含 task/run identity 和 native outcome/reason；不伪造 InputState，也不另设 success/error 选择器。native background continuation 使用这一已提交的 run settlement 和既有 response attribution；缺少用户 submission 不代表成功。manual compaction 仍是命令，其完成归 native task/summary 的已提交结果所有；单凭 idle snapshot 不能产生成功回答或 compaction card。

native projection 的结果驱动产品行 status、topic execution status 和 terminal notification。persistence/stream 回调只确认投递。投影写入失败仍是 delivery error，不得把 native success 改成 error。重复消费同一 input outcome 只更新既有投影，不再发送第二次完成通知。

### Native activity and admission

foreground running state 来自观察到的 native `ConversationView.docs['pi.live'].run` 及其 `taskId`，通过 `snapshot.activity` / `activity.changed` 传给消费者。这是本 Spec 要求新增或扩展的投影能力：当前 `Activity` 只有 `state`，传递 `taskId` 需实现时按 native 层能力补齐，若 native 能力边界不支持则向上游提 issue。需要 Task phase 细节时仍读取 native Task facts。native compaction task 提供自身 busy 区间。`InputState.facts` 提供接纳/queued/placed 状态，`outcome` 提供终态；queued input 表示等待进入执行，不能证明已有 running Task。只有 child 的 `background-work-state.active` 保留资源并显示 child activity，不使 Main 进入 busy。observation 失败报告 activity unknown，不默认变成 idle。

移除 `sending`、生命周期 `active` 镜像和 `autonomous` 对接纳或结算的裁决权。本地 `compacting` 和 `failure` 可以描述命令投递，但不能阻止 native settlement 或选择其结果。autonomous delivery attachment 可以存在，但不拥有执行。普通 follow-up 使用 native `whenBusy: 'follow-up'`，steering 使用 `'steer'`，明确要求拒绝的语义使用 `'reject'`；保留提交内容和 native 顺序。不再排空第二份 Main execution queue，也不用本地“already active”标志拒绝输入。native refusal 是接纳结果，不是已完成 turn。可以直接展示 native queue state，但本地 queue 不成为执行调度器。

### Stop and backend lifetime

Pi Durable 的 renderer Stop 通过既有命令路径仅调用 connection `interrupt()`。不得先 abort transport 来制造 `paused`，不得调用 `fail()`、清空 delivery state、close/release backend 或 reset session。interrupt 确认成功本身也不是 terminal outcome。如果完成先于 Stop 赢得竞态，native completed result 保持 success。

`interrupt()` 后继续 observation。按实际情况发布 native input-state/outcome 更新、message projection、foreground activity/settlement、background result 和 child task 更新。唯一结果边界提供最终 terminal notification；native idle 更新清除 foreground running indicator。保留 observation access、input binding、reply/controller 关联、缓冲内容和 stream position、usage attribution、child handle、projection source mapping 及 pending persistence，直到投递提交。Stop 失败是瞬时命令错误，不销毁资源，也不编造 turn result。background children 的 Stop 范围见下文尚未裁决的产品选项。

已建立的 live backend 只允许在明确的 idle release 或应用退出时 shutdown。idle release 要求没有普通 native work，没有仍需要 owner 的 active background work，并且 delivery barrier 已完成；它不是强制内存压力驱逐。除非请求 idle release，否则保留现有 retention policy。单个 root/access 脱离、配置重建或 fork handle 结束，都不能关闭仍拥有工作或服务其他使用者的 backend。初始化回滚和未启用 scheduler 的 cold fork Session 关闭属于资源清理，不是 turn Stop。

关闭契约为：阻挡新接纳；建立不会按用户 Stop 取消工作的 native quiescence/final-observation barrier；drain 已接纳回调；捕获最终 native entries，flush child archives 和 root projection writes；随后才关闭 native storage 与 desktop host、detach observation 并 release handle。flush 失败保留 writer，关闭保持未完成、可重试。现有 final archive capture 仍然有用，但不能证明产品 archive 在 storage shutdown 前已 flush。若 SDK 无法暴露所需的 pre-storage-close barrier，应提交给维护者裁决上游生命周期能力；不得用 idle polling、sleep 或新的本地 turn state machine 近似替代。

### Observation recovery

diagnostic、disconnected gap、consumer error 或非预期 observation closure 使投递失效，而非使 native turn 终止。停止旧 observation，隔离其 generation，重开/重新挂接同一 backend/conversation 的 observation。等 fresh baseline 和 `drain()` 完成后才宣告投递健康，并从 baseline 对账 input identity、content、activity 和 outcome。observation recovery 不提交 input，也不关闭 backend。overflow 和 mapping-reset 已有 snapshot recovery 语义，应消费替换 baseline，而非把它们视为 terminal failure。

通过连接现有 reconciliation owner 串行化 recovery 与配置对账。在失败回调之外调度 recovery，避免等待 `drain()` 时等待自身。只能有一个 generation 发布；忽略超时或被替换 observation 的迟到回调。

拟议 recovery budget 为最多三次 observe/baseline 尝试，每次最多五秒，两次间隔分别为 250 ms 和一秒，总 deadline 为 20 秒。完整 baseline 成功后重置预算；新错误事件不重置。应用退出、owner release，或确认 native identity 缺失/损坏时立即停止尝试。耗尽后保留 binding 和已投影内容，发布瞬时 delivery-unavailable error 和 unknown activity，等待明确的 reopen/retry；不把 turn 标为 stopped/failed，也不进入自动无限重试。永久关闭的 native source 可以保持不可用；重开缓存中的 dead access 不能证明已恢复。缺失的 native refresh 能力必须在所属层解决，不能藏进产品状态。

当前 `DurableObservation` 不暴露稳定 batch identifier 或公开 committed revision。不得按 object identity 或文本去重。可以重复读取 baseline，但副作用必须幂等：按 context 加 committed native message ID upsert 消息，应用 preview alias 替换，每个 native input/run outcome 只结算/通知一次。product parts 与 source checkpoint 在同一产品事务中持久化。中断的部分投影可安全重放；recovery 不得重复消费同一 batch 的内容、usage attribution 或 terminal side effect。若一致发布需要额外 revision，应归入 native projection contract，而不是第二份 Main journal。

### Restart attachment and reply reconstruction

dispatch 前把 `inputContextId` 保存到 retained user message。仅从携带 `nativeInput.id` 的 native acknowledgement 或 observation，在已捕获 context 中绑定 `nativeInputId`。SQL 使用 `native_input_id`；native entry 的 `data.cherryInputId` 在 placed 时记录产品 message ID。这些都不是独立的 execution Task ID：native submission 拥有既有 Task 关系，其中 queued input 可能尚无 execution Task。

冷启动时同时发现 retained message/context binding 和 live native input，不能依赖进程内的 `pendingInputs`。严格重开同一 native conversation，按 logical input ID 或 context 范围内的 `nativeInputId` 匹配，并将 delivery 挂接到已有 submission/task 及原产品 turn/reply。已有 native input identity 的 resumed input 必须挂回原产品 turn/reply，不得为其新建产品 turn/reply，也不得改称 autonomous turn。若 placed entry metadata 存在，可恢复丢失的 acknowledgement。queued snapshot 可以只有 native ref；在 scheduler resume 前解析其产品归属，前提是存在已持久化的 `nativeInputId` binding 或可恢复的 placed entry metadata。

若 `nativeInputId` 尚未持久化且 placed entry metadata 不存在，该输入保持明确的 `unknown`：不猜测归属、不自动重发、不据此新建回复，其恢复继续阻塞。评估 native conversation 范围内的 `requestId` 作为新提交的关联能力，以弥补这一缺口；这是拟议能力，不代表恢复时已有这份证据。缺少此类关联的旧数据仍需显式人工对账，或由后续对账步骤取得权威证据后，才能解除阻塞。

只提交真正全新/尚未尝试的 input，或者在明确非接纳证据（`rejected` / `unsupported`）、没有 confirmed native identity 且已释放尝试 binding 后重试。lookup 缺失、`unknown`、timeout、queued input 缺少 logical metadata 或 store 缺失，都不是这种证据。不得自动重发已接纳、已终结或结果不明的 input。用户有意 resend/edit 时使用既有产品 new-input 操作与 identity；branch 行为不在本 Spec 范围内。

Main root-observation attachment 是重建入口，发生在恢复工作 resume 前、展示宣告已同步前。复用 native entries/archive → `ThreadProjection` / `ThreadMessageProjection` → `RootMessageProjection` → product persistence 路径。扩展这一路径，使用 native submission answer、input metadata 和既有 response attribution，将先前无 owner 的 historical assistant source 关联到 retained product input/reply。读取对账所需的 retained native entries，而不仅读取 selected compacted context。不得将全部 historical message 标成 live，也不得投递给当前随意选中的 turn。

committed native message identity 为 `entry:<entryId>:<modelIndex>`，范围限定在 backend/conversation 内；消费者不解析其内部结构。将 source identity、既有 preview alias、context 的 root source-to-product-message checkpoint 与 input binding 结合。对同一 product reply ID 执行 upsert 并替换 parts，原子提交 parts 和 checkpoint，尊重 removed-source tombstone。恢复缺失 reply 时使用稳定 source association，保证重试不会再建一行。多个 assistant source 可以归属同一 reply。缺失/含糊的 attribution 保持为明确、可恢复的 delivery error，不猜测并创建重复项。即使新 baseline 没有 `completion` edge，terminal native outcome 也走同一结果边界。

### Permitted in-memory delivery state

对于 Pi Durable，`agentSessionRuntimeState` 只保留下列临时数据。名称描述允许的字段职责，不要求新增公开 API：

| Permitted field responsibility | Why native Durable cannot supply it |
| --- | --- |
| Delivery attachment 与 reply/stream handle | 当前 consumer/controller 的关联，以及 delivery 正在 opening、open、等待 write acknowledgement 或 detached，只存在于 Main；这里不保存 native running/terminal status。 |
| `buffer` 与 streaming position | 未投递 frame、文本播放 offset、consumer 最后应用的 source 描述投递进度，不是 native task 进度。 |
| Typing/presentation indicator | consumer 在 frame 之间的动画或占位区间属于本地展示，不能断言 native execution，也不能抵抗相反的 native baseline。 |
| 瞬时 command/observation/persistence error 与 retry generation | 它们描述 access/delivery 尝试，不是 native turn outcome。 |
| Delivery queue position 与 pending handoff reference | 哪些 consumer frame 或 product write 等待投递属于本地状态。native input 顺序从 Durable 读取，不复制为可执行的 Main queue。 |

移除 Pi Durable 对 `execution.kind` 的 idle/turn/steer/autonomous 生命周期含义、`ownership`、`deferred` native-work ownership、reply `admission`、`terminal`、`pendingResultToolCallIds`、settled delivery `status`、`lastTerminal`、execution `queue` 及 execution `launch` 调度的使用。替代来源分别为 native activity/run identity、input facts/outcome、behavior result facts、直接 native admission 与 native queue order。将仍需要的纯投递 attachment/reservation 职责从这些含义中拆出。移除 connection occupancy 对 native background work 和 compaction 的镜像，读取其 native projection。resource handle、configuration 和 shutdown coordination 留在 delivery reducer 之外的既有 service/backend owner。不增加第二份 receipt、Task、outcome 或 recovery journal。

## Alternatives considered

- 保留 reducer 的裁决权并同步更多 flag：否决，因为 delivery timing 仍会与 native 持久事实竞争。
- observation failure 或 Stop 时关闭并重开整个 backend：否决，因为仅为修复投递就改变执行并影响其他使用者。
- 重开时只复用 live completion edge：否决，因为 baseline 有意省略该 edge，historical source 也可能没有 product owner。
- 只停止 Main 的普通 native scope，包括 foreground descendant，并尊重 background boundary：保留独立运行的 background children，以及它们的 resource/approval/result delivery 需求。这与当前 native `abort(context)` 调用一致，不包括随后 backend-close 的附带影响。**推荐，但需人裁决**：保留既有 native boundary 和明确的逐 child Stop 操作。此选项不代表忽略 foreground children。native 默认值证据为 `packages/agent-runtime-pi-durable/src/behavior/harness.ts:153–168` 与已安装 SDK `node_modules/@earendil-works/pi-durable/README.md:727, 765`（版本 1.5.2）。
- 同时停止 Main 与 background children：提供一键停止已观察工作树的能力，但会中断独立工作，且必须定义 captured scope、queued-input withdrawal 以及并发创建 child 的处理。native `abort(context, { background: true })` 已提供 scope option；选定策略应由 shared behavior 拥有。**需人裁决**，本 Spec 不授权启用。当前 backend closure 和 reopen policy 可独立于普通 Stop 中断 children，因此不能把现有 UI 效果误当成有意确定的全 children Stop 契约。两个选项均不重新展开 #24231 的 ownership hierarchy。

## Acceptance criteria

- AC1 — completed、aborted、unanswered、failed 的 native input 在 live 和 restored baseline 中分别产生 success、paused、paused、error，保留原因；没有 outcome 时不产生终态，后续投递、持久化失败或重复回放不得改写该结果。 (verification: unit)
- AC2 — Renderer 收到 native foreground activity 再收到 native settlement 后，即使 delivery attachment 仍打开，也会移除运行占位并显示映射结果；只有 background activity 时不显示 Main 正在运行。 (verification: renderer)
- AC3 — native task 运行时，follow-up 与 steer submission 使用 native 顺序，每个已接纳 input 只执行一次；明确 reject 返回 native busy，不发生本地 sending rejection。 (verification: unit)
- AC4 — Pi Durable 回复期间 Stop 后，backend 和 conversation 保持挂接至 native settlement；native aborted 使原回复保持 paused，随后重发新消息也不改变原回复状态；保留部分输出和 input identity，先完成的竞态仍保持 success。 (verification: Electron)
- AC5 — idle release 和应用退出在 storage 与 host 关闭前 flush 已接纳的 root/child projection write；注入 flush failure 会阻止 release 完成，释放一个 root 不会 shutdown 另一个使用者的工作。 (verification: unit)
- AC6 — 回复期间发生 disconnected gap 或 observation error 时，若尚无 native outcome，原回合不结束且 backend 不关闭；随后从同一 native conversation 的 fresh drained baseline 同步，不重复 input、正文或终态通知。 (verification: unit)
- AC7 — 三次 observation 失败或超时后，在 20 秒 recovery budget 内停止重试，保留 native identity/content，呈现 delivery unavailable 与 activity unknown，不 shutdown backend，也不合成 turn outcome。 (verification: unit)
- AC8 — 应用进程异常退出后重开，已接纳的 resumed run 按保存的 native input identity 挂回原 context、submission 和产品 turn/reply，不新建 autonomous turn；仅有 native identity 的 queued input 也能挂回原 submission，attachment 不新增 submission 或额外触发 provider call。 (verification: unit)
- AC9 — admission unknown、lookup 缺失和 acknowledgement 丢失都不重发 input；明确非接纳且无 confirmed native identity 时，可通过正常 submission 路径有意重试。 (verification: unit)
- AC10 — native terminal commit 已完成而 product terminal persistence 尚未执行时，重开可从 retained entries 重建 reply 和映射 status；再次重开保留相同 product message ID、source ownership 和 body，不复活已删除 source。 (verification: unit)
- AC11 — Pi Durable 消费者采用新契约后，既有 legacy process-runtime fixture 的 submit、queue、Stop 和 terminal outcome 保持一致。 (verification: unit)
- AC12 — proposed feature 双语 note 的 AC1–AC12 一致，明确记载 Stop-to-children 尚需人工裁决；Pi Durable 字段/消费者审计只保留允许的 delivery state，并为删除的 lifecycle fact 列明 native 替代来源。 (verification: docs gate)

## Risks

- Product archive 与 native storage 属于不同事务。测试必须在 native settlement、reply write 和 checkpoint write 之间注入故障；有序 close/reopen fixture 不能证明任意 process kill 恢复或外部 tool side effect 的 exactly-once。
- 当前 shutdown API 在 desktop flush 回调前关闭 native storage，更强的 barrier 可能需要上游生命周期扩展。`settled()` 等待全部工作，不能作为无限期运行任务的有界应用退出 barrier。final native archive capture 必须保留到 product flush 成功。
- 当前 native activity 只投影 `pi.live.run`，completion 还考虑 admission、compaction 和 unfinished input。必须区分这些区间，直接删除 flag 会丢失 compaction 和 queued-input 展示。
- 缓存 dead native view 的 recovery 可能需要 native observation refresh 支持。retry limit 只约束投递，不能制造 native termination。observe/drain deadline 必须隔离迟到副作用，不能留下第二个发布 observer。
- 被删除的 historical source、background attribution 和 steer alias 使重建不只是复制文本。必须保留既有 input-context 与 checkpoint 约束。shared stream/reducer 变更必须限定在 Pi Durable 路径，保护 legacy process 行为。
- Stop-to-children 尚未裁决。移除附带 shutdown 后，原本看似已停止的独立 children 可能继续运行；最终实现验收前必须有人工作出产品裁决并提供对应证据。本草稿不声称已获 Approval、已完成实现或已通过 runtime regression。
