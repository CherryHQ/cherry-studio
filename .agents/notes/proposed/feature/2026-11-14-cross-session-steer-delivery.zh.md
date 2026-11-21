# Agent Note: 跨会话 steer 投递

Status: proposed

[English](2026-11-14-cross-session-steer-delivery.md) | 中文

## Problem

#24522 要求在不中断活跃目标的情况下跨会话纠正任务。当前 `session_send` 仅接受 `target_session_id`、`message` 和可选 `reply: 'none' | 'completion'`，没有投递模式（`src/main/ai/mcp/servers/cherryAutonomyTools.ts:320`）。处理器直接调用 `AgentSessionDeliveryService.accept()` 并同步返回 `accepted`（`src/main/ai/mcp/servers/cherryAutonomyTools.ts:565`、`src/main/ai/mcp/servers/cherryAutonomyTools.ts:582`）。

接收请求会在收件方会话中持久化一条 durable user 消息和投递 envelope（`src/main/ai/agentSession/AgentSessionDeliveryService.ts:86`、`src/main/data/services/AgentSessionMessageService.ts:1879`）。派发会启动新轮：busy gate、`validateDispatch` 且 `headless: true`、持久化新 assistant、claim 绑定，然后派发。busy gate 位于 `src/main/ai/agentSession/AgentSessionDeliveryService.ts:256`，并在 `src/main/ai/agentSession/AgentSessionDeliveryService.ts:301` 和 `src/main/ai/agentSession/AgentSessionDeliveryService.ts:322` 复核；headless 校验从 `src/main/ai/agentSession/AgentSessionDeliveryService.ts:272` 开始，事务内持久化与 claim 绑定从 `src/main/ai/agentSession/AgentSessionDeliveryService.ts:329` 开始。收件方忙时一律返回 `blocked`，通过 runtime idle kick 和 60 秒 sweep 重试（`src/main/ai/agentSession/AgentSessionDeliveryService.ts:75`、`src/main/ai/agentSession/AgentSessionDeliveryService.ts:77`、`src/main/ai/agentSession/AgentSessionDeliveryService.ts:18`）。

人类消息已经支持 mid-turn steer。`AgentSessionRuntimeService.enqueueUserMessage()` 检查当前轮 open、live、非 headless，且 model / reasoningEffort / serviceTier / fastMode / 有效 knowledge 作用域一致（`src/main/ai/agentSession/AgentSessionRuntimeService.ts:1162`、`src/main/ai/agentSession/AgentSessionRuntimeService.ts:1171`）。它登记 pending input 并调用 `currentConnection(entry)?.redirect?.(...)`，否则以 `steer: true` 排队（`src/main/ai/agentSession/AgentSessionRuntimeService.ts:1186`、`src/main/ai/agentSession/AgentSessionRuntimeService.ts:1195`）。下一轮使用 reminder 起轮（`src/main/ai/agentSession/AgentSessionRuntimeService.ts:3165`）。跨会话投递不走这条路径。

`redirect?` 是可选运行时能力（`src/main/ai/runtime/types.ts:242`），当前由 pi（`src/main/ai/runtime/pi/PiRuntimeConnection.ts:415`）、piDurable（`src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts:194`）和 claudeCode（`src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts:320`）实现。另一个 Agent 目前无法通过 `session_send` 直接 steer 运行中的目标；用户已经可以通过现有人工 steer 路径纠正符合条件的交互轮（`src/renderer/components/composer/variants/AgentComposer.tsx:1468`）。对 Agent 而言，当前办法是停止再重发，这会中断在途工具调用并可能重跑非幂等操作；这是 Issue 的动机，不是既有排队契约的缺陷。

Issue 中定时/后台 Agent 的场景仍受上游门限制：交互授权（`src/main/ai/mcp/servers/cherryAutonomyTools.ts:336`）、headless 交互判定（`src/main/ai/agentSession/AgentSessionRuntimeService.ts:3290`）和无人值守 delegation 拒绝（`src/main/ai/toolApproval/builtinToolPolicy.ts:20`）。这些门归 #21359。UI 已有跨会话发送方标注（`src/renderer/components/chat/messages/frame/MessageHeader.tsx:50`），缺少实际 steer/queue 准入及其可见状态。

## Proposal

1. **工具契约。** `session_send` 新增可选 `mode: 'queue' | 'steer'`，默认 `queue`。省略与显式 `queue` 完全原样走现有路径，包括 headless 派发、忙时等待、模型选择、重试和 completion。工具结果在既有结构中仍只确认 `accepted`、`requestId` 和 `delivery`：准入是异步的，绝不能把请求模式报告为实际准入。投递记录和 `session_deliveries` 暴露最终准入。

2. **收件方持有准入。** 投递服务持有请求、顺序、重试和投递终态；运行时服务持有唯一准入判定与原生注入；数据服务只持有事务、条件更新和唯一性。有结果的原子尝试接口形如 `trySteerDelivery({message, expectedTarget, scope}) → {kind:'submitted'} | {kind:'queue', reason}`，与 `enqueueUserMessage` 复用准入谓词和 redirect 过程。单独查询 `canSteer()` 不足以保证正确：workspace 校验、轮次结束、连接替换都可能让查询过期。这里的原子性指受保护的一次运行时尝试，不是跨 SQLite 和原生提交的事务。

3. **Fail closed 的可注入条件。** steer 要求当前轮 open、live，连接暴露 `redirect`，且有效 model / reasoningEffort / serviceTier / fastMode / knowledge 作用域一致。headless 目标轮可以被 steer，因为准入只注入输入，不新建审批；输入触发的工具调用沿用收件方既有的 headless 拒绝与权限规则。共享谓词带 `allowHeadless` 形参：人工路径仍传 `false`，保持行为不变，投递路径传 `true`；测试必须区分这两条路径。所有配置按收件方会话覆盖与 Agent 默认解析，绝不读发送方；headless 目标轮按 Agent 默认解析模型、忽略会话 model 覆盖（`src/main/ai/runtime/types.ts:77`），所以「有效配置一致」的判定要按该轮的解析来源做。异步校验后复核预期执行和连接 generation。任何条件不满足都回落排队并记录原因。

4. **持久化与兼容性。** envelope 新增不可变的请求 `mode` 和 `admission: pending | queued | steered`，排队时可带原因。历史记录缺失 `mode` 时按 `queue` 解释。生命周期仍为 `accepted | delivering | consumed | failed`；`steered` 是准入形态，绝不是生命周期状态。准入与生命周期/outcome 分别可观察。写入新字段后不支持降级到旧版本：旧读端使用 `z.strictObject` 和 `literal(1)`（`src/shared/ai/agentSessionDelivery.ts:31`）。明确接受这一兼容性代价。

5. **逻辑执行终态。** 实际 steer 时，`reply='completion'` 指接纳输入的逻辑执行的终态，而非某条展示行。跳过 `row-roll` 等展示边界（`src/main/ai/agentSession/AgentSessionRuntimeService.ts:1223`、`src/main/ai/agentSession/AgentSessionDeliveryService.ts:70`）。同一执行可绑定多条投递，必须逐条幂等终结，借助 `deliveryInReplyTo` 唯一性保证每个 `requestId` 至多一条结果（`src/main/data/db/schemas/agentSessionMessage.ts:64`）。结果不得宣称 steer 意图被独立完成。

6. **崩溃与未知准入。** SQLite 与原生提交没有原子事务。在 native submit 之前持久化原 input/context 关联，沿用 `src/main/ai/agentSession/nativeSubmission.ts:28` 的预绑定方向；重启后区分「尚未尝试」与「可能已提交」。只有 runtime 能证明输入未注入任何执行（包括没有由自己启动的后续 run）时才允许重试：同一请求原子退回 `accepted/queued`，清掉旧执行归属，按原节奏重试。不能证明未注入时（当前 piDurable 属于此类）绝不重试；将请求与接纳它的后续 run 对账，把该 run 视为接纳执行，并如实记录 `admission: steered`。明确已注入时，跟踪接纳它的逻辑执行终态，不产生第二次派发。准入未知时保留原 input/context 关联，只做 reconciliation，不猜着重放。runtime 能证明绑定到预期 run 或证明未注入，是按 runtime 开启 steer 的前置能力，不是本 Spec 自己实现的能力。这与既有运行时契约提案一致（`.agents/notes/proposed/architecture/2026-10-17-agent-runtime-contract.md:508`、`.agents/notes/proposed/architecture/2026-10-17-agent-runtime-contract.md:518`）。「不丢消息」指请求/结果可追踪、没有静默丢弃，不承诺崩溃后恰好执行一次。

7. **信任归属。** 人类 steer reminder 将输入描述为用户发送、用户的新指令，冲突时用户优先（`src/main/ai/steerReminder.ts:19`、`src/main/ai/steerReminder.ts:21`、`src/main/ai/steerReminder.ts:24`）。跨 Agent 消息绝不能复用这套文案，否则会把另一个 Agent 的文本提升成人类指令。复用注入与 defang 机制，以可信来源表达说明消息来自另一个 Agent/Session。不继承发送方审批、permission mode、trusted notify channels、工具授权或 workspace。steer 到 headless 目标不得产生新审批；输入触发的工具调用按收件方既有 headless 拒绝规则处理（`src/main/ai/toolApproval/toolGuards.ts:154`），既有的权限模式与运行中更新继续生效。

8. **顺序与公平。** `queue` 请求彼此保持 FIFO。满足条件的 `steer` 可以加入当前正在执行的轮，即使更早的 `queue` 仍在等待下一轮；steer 之间保持相对顺序。steer 绝不删除、重排或吞并任何一个等待中的 queue 项。目标转为空闲后，等待中的 queue 按原派发节奏执行。steer 可能延长当前执行、从而推迟等待中 queue 的派发；本 Spec 只保证 queue 之间 FIFO、steer 不删除/重排/吞并 queue 项；若要额外保证排空公平性，需要另立机制，本 Spec 不做。回落决定只记录一次；60 秒 sweep 不得反复将同一请求升级成 steer。

9. **UI。** 复用包含 Agent 名、会话名和跳转的发送方标注，新增实际 `queued` / `steered` 状态。steered 消息显示在正在执行的时间线中，不另做一次投递派发；runtime 自行启动的晚到准入后续 run 按 Proposal 6 处理。这不要求零新增展示行：continuation 行仍可能出现，turn/timeline 投影归 #23933。

10. **范围与前置条件。** #24522 拥有本期跨会话投递模式。不改 `assertSessionToolsAuthorized`（#21359），不修 steer 冻结/replay 缺口/stale resume（#23421 和在途 PR #23519），不新增跨会话 stop/cancel，不建立第二套 turn/timeline 投影（#23933），不定义 ACP 类运行时的 steer 语义；运行时范围为 pi / piDurable / claudeCode，分别受其准入前置能力约束。实现前必须已有 #23519 或等价修复进入基线，并具备 steer 不冻结的验证证据。此外，piDurable 需先具备「绑定到预期 run」或「可证明未注入」的能力，才对其启用 steer。发送方门（#21359）不变；目标侧 headless 语义沿用收件方既有规则，本 Spec 不新增目标侧豁免。

## Alternatives considered

- 只保留排队并提供停下再重发助手：入口更少，但仍中断在途工具，保留了促成本 Issue 的运维代价。
- 第一步只允许同一父会话或定时轮次：缩小入口，却没有解开运维场景，还提前固化了半截授权模型。
- 生命周期枚举新增 `steered`：虽能在其中表达准入，却混淆准入形态与生命周期，给恢复扫描和 UI 增加另一套状态。
- 接收方开关或 Agent 对级授权：控制更细，但需要额外产品模型，本期没有可复用的接收策略。
- 先发布容忍新字段的读端再写新字段：兼容性最佳，但需要两个发行版本，本身不解决用户问题。本期选择写新格式并明确不支持降级。
- 原样复用人类 steer reminder：省去新来源文案，却把跨 Agent 文本伪装成用户指令，因此不选。
- 只允许非 headless 目标：不选，因为被委派/后台目标正是主要场景，且注入本身不需要审批应答；目标既有的 headless 拒绝规则已能约束工具调用。

## Acceptance criteria

- AC1 — 省略 mode 与显式 `queue` 都保持现有持久化、忙时等待、headless 派发、模型选择、重试与 completion 行为，历史无 `mode` 的记录按 `queue` 解释。 (verification: unit)
- AC2 — 请求 `steer` 且目标存在配置匹配、支持 `redirect` 的 open+live 轮时，仅在受控保持原执行 open、且该执行实际接纳该输入的场景下，消息才在该执行的下一个受支持边界被接纳；若原执行在提交与消费之间结束、且 runtime 把输入绑定到后续 run，则按 AC5 的晚到准入处理（不重试，归属实际接纳的那个 run）。存在更早的、仍在等待的 `queue` 投递时，后来的 `steer` 在目标仍运行时进入当前执行，该 `queue` 在目标空闲后照常作为自己的一轮派发；两者都不丢、不重复。发送方按 `request_id` 查 `session_deliveries` 时，在执行被受控保持运行期间能观察到生命周期 `delivering` 且 `admission: steered`，之后能观察到终态 `consumed`/`failed`，并与最初的 `accepted` 区分。 (verification: unit)
- AC3 — 跨会话 steer 不触发目标任务的 stop / abort / cancel / 重启，已发出的工具调用按原契约继续执行并保留结果。覆盖 pi / piDurable / claudeCode，分别满足前置能力后才启用 steer，并使用真实的、正在进行的工具调用验证；不能只靠模拟 `redirect` 返回值作为证据。 (verification: Electron)
- AC4 — 目标空闲、连接不支持 `redirect`，或 model / reasoningEffort / serviceTier / fastMode / 有效 knowledge 作用域不一致时，请求明确回落 `queued` 并按原派发节奏执行，不误注入其它执行；发送方按 `request_id` 进行的同一 `session_deliveries` 查询返回 `admission: queued` 及回落原因。 (verification: unit)
- AC5 — 同一请求只回落排队一次，且必须有 runtime 证明未注入任何执行，目标执行先结束本身不足以回落。晚到 steer 被 runtime 绑定到后续 run 时不得重试：准入与 completion 归属该后续 run，同一请求不出现第二次派发。使用真实持久化/原生运行时测试覆盖提交与目标终态竞争及重启恢复，区分尚未尝试与可能已提交的请求；提交前后崩溃、重复事件与未知准入不产生盲目重放或静默遗失，恢复结果可查询。 (verification: unit)
- AC6 — `completion` 在实际 steered 时关联接纳消息的逻辑执行终态（忽略展示行 row-roll）；发送会话仍存在时，`reply='completion'` 为该执行终态按每条请求产生恰好一条关联结果，同一执行接纳多条请求时也如此。重复终态事件不产生第二条，`reply='none'` 不产生结果；结果不宣称 steer 意图被独立完成。 (verification: unit)
- AC7 — 发送方既有身份与 delegation 门、目标的工具审批与权限更新规则保持有效；steer 到 headless 目标不产生新审批，其既有 headless 拒绝与权限模式保持有效。共享 `allowHeadless` 谓词在人工路径传 `false` 时仍拒绝 headless，在投递路径传 `true` 时允许符合条件的 headless 目标。即使伪造 human reminder 标签，模型输入仍把跨 Agent 消息标为真实来源而不是用户的新指令；发送方 workspace、工具授权与 trusted notify channels 不流入收件方。 (verification: unit)
- AC8 — 接收方将 `steered` 跨会话消息显示在其所属运行执行的时间线内，将 `queued` 消息及其状态显示为等待下次派发；「等待下次派发」只描述仍在等待的 queued 投递，一旦派发仍要显示实际的 `delivering` 或终态（`admission: queued` 与生命周期是两件事）。发送方来源与跳转在刷新后保持一致，且 steer 不启动独立执行，Proposal 6 中 runtime 自行启动并经对账的晚到准入后续 run 除外。 (verification: renderer)
- AC9 — Spec 明确 `accepted` 与最终准入的回执时序、生命周期与 outcome、崩溃不确定性、历史记录默认值与降级边界；中英文与 sidecar 通过文档门禁。 (verification: docs gate)

## Risks

- **冻结触发面。** 复用 steer/投影链会扩大 #23421 类冻结的触发面。实现以基线已有 #23519 或等价修复及 steer 不冻结证据为前置条件。
- **无人值守目标面扩大。** steer 可以在无人介入时改变一个无人值守目标的走向。约束为同一本机用户信任边界、模型输入标明真实来源、既有 headless 拒绝规则及 envelope 留痕。这是显式接受的风险，不是已被消除的风险。
- **native 晚到准入 / 后续 run。** piDurable 可能为晚到 steer 启动后续 run（`packages/agent-runtime-pi-durable/README.md:45`、`packages/agent-runtime-pi-durable/README.md:154`）；提交时尚无 run 绑定（`packages/agent-runtime-pi-durable/tests/runMetadata.test.ts:71`）。`redirect` 返回 `true` 时 native submit 已发起，但不等待其确认（`src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts:194`），因此无法消除这一竞争。未满足绑定到预期 run 或可证明未注入的前置能力时，不对该 runtime 开启 steer；若发生晚到准入，对账实际接纳 run，不重试。
- **恢复期重复或遗失。** 未知准入不得自动重放。`consumed` 不代表业务成功：现有终结可存储 `consumed` 并带 outcome `failed` 或 `interrupted`（`src/main/data/services/AgentSessionMessageService.ts:2182`）。恢复与 outcome 必须可查询。
- **多投递与 row-roll。** 单 assistant/单条 `.limit(1)` 假设不足（`src/main/data/services/AgentSessionMessageService.ts:1923`、`src/main/ai/agentSession/AgentSessionDeliveryService.ts:442`）。终结必须跟随逻辑执行归属，逐请求幂等结清。
- **Envelope 前滚与回滚。** 旧 `strictObject` 加 `literal(1)` 读端会拒绝新字段。写新格式后降级是明确不受支持的操作，版本号不变不能证明兼容。
- **与 #21359 的顺序。** 本期不兑现定时 Agent 自主纠正另一会话的完整场景；该场景仍有独立的上游授权前置条件。
- **跨 Agent 控制与再委派。** 被 steer 的交互收件方可能在 auto/bypass 模式下继续跨会话调用。本期保留既有交互授权语义，显式接受新增的这一控制风险。
- **配置竞争。** 模型、档位和 knowledge 变化可能导致误注入。按收件方当前有效配置判定，异步校验后复核执行及连接 generation。
- **维护屏障。** pause、backup、shutdown 和 write quiesce 同样约束新 steer handoff。必须纳入既有屏障与 drain 跟踪，不得绕开。
