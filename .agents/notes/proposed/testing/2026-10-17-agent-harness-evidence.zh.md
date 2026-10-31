# Agent Note: Harness 样本与运行时验证

Status: proposed

[English](2026-10-17-agent-harness-evidence.md) | 中文

## Problem

不同 harness 的方法都叫 `prompt`、对象都叫 `session`，或者 Promise 都成功返回，并不表示行为相同。通用契约需要身份、接纳、观察、中断、所有权和恢复方面的证据。某个适配器没有暴露一项操作，也不能证明原生 harness 没有该能力。

本文保留 Runtime 栈中五类样本的研究与验证记录，区分固定源码调研、历史已执行探针、当前测试覆盖与应用验收。[Harness 边界](../architecture/2026-10-17-agent-harness-boundaries.md)和[运行时契约](../architecture/2026-10-17-agent-runtime-contract.md)维护设计，本文维护证据与验收缺口。[子智能体控制提案](https://github.com/CherryHQ/cherry-studio/pull/21578)维护超出已实现 v0 契约的变更。本次迁移不把这些工作标为已实现，也不产生新的测试通过记录。

本文的实现事实以累计 Runtime 栈 `bd6509eb5f71a9c6bbb57453f0a7ced25e92c766` 的检查结果为依据。由上层提供的行为在本层仍属于目标，不表示这些功能已存在于本层。源码链接指向该固定快照，尚未引入的文档链接到其所属 PR。

## Proposal

### 源码基线与证据层级

每项公共保证都应回到这五类样本验证。下方流程图根据接口表达关系，不是采集到的运行日志。阅读源码或上游测试，不等于这些测试已在本地通过。

| 样本 | 研究边界 | 固定源码基线 |
| --- | --- | --- |
| Pi | `pi-coding-agent` SDK，辅以 RPC 与官方子智能体扩展示例 | `earendil-works/pi@8efd314fa3d3232ce197d8d7a6a5660530b9d83e` |
| DSH | `dsh-agent`、`dsh-agent-loop`、`dsh-session` 与子智能体插件 | `deepseek-ai/deepseek-harness@1600d8a1e140dcde43a1a0941940a0480712c011` |
| Pi Durable | `pi-durable` 的 Harness、Conversation、Submission 与 Task | 与 Pi 相同源码基线，独立包及执行系统 |
| Codex | App Server v2 对宿主暴露的协议与对应实现 | `openai/codex@ce0323f2f2d3b25e82806cd555237da3db4e1897` |
| ACP | 连接到 ACP 智能体时的协议契约；区分 v1、v2 基线与实验扩展 | `agentclientprotocol/agent-client-protocol@e7dac67ac64ec7cf69079b3bb6eff46a21e026b3` |

Pi 和 Codex 基线来自用户提供的仓库；DSH 和 ACP 来自上游固定提交。这些基线不是 Cherry 当前安装依赖的兼容性结论。尤其 DSH 调研描述的是对应上游基线，不能反推已经退役的 Cherry DSH 集成行为。

ACP 是接入协议，不是执行引擎。该样本研究协议可表达的 harness 行为，具体智能体仍决定执行、存储和扩展能力。固定基线将 v2 整体标为 draft；`schema/v2/schema.json` 与叠加实验特性的 unstable schema 也需区分。[ACP 版本与迁移说明](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/migration.mdx)

| 证据 | 版本与限制 |
| --- | --- |
| 本次迁移时核对的依赖与源码 | Cherry 桌面和 Pi 适配器使用 `pi-coding-agent` / `pi-ai` **1.3.0**；Durable 适配器使用 `pi-durable` / `pi-ai` / `chord` **1.3.0**。已安装包的 manifest 与此一致。关联 Pi 仓库仍处于上述固定提交，其 coding-agent 与 durable 包均为 **1.3.0**。 |
| 历史 Pi 离线探针 | 直接调用当时安装的 **1.2.0**，没有经过 Cherry runtime 包装，也没有模型请求或外部工具。结果仍属于 1.2.0；本次迁移没有在 1.3.0 重跑。 |
| 最初的 Pi Durable 调研 | 当时 Cherry 尚未引入 Durable，关联源码仓库也未安装依赖，上游测试引用属于静态证据。目前适配器和离线测试已经存在，但不能倒推最初调研执行过上游测试套件。 |
| OAR 对照 | 本地基线 `141921ea5a818bd8b0a1c0c1e17a2593898dbefe`。其产品选择可作对照，不是原生保证。 |

当前依赖归属见[根 manifest](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/package.json)、[Pi manifest](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/package.json)、[Durable manifest](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi-durable/package.json)和[工作区补丁配置](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/pnpm-workspace.yaml)。Pi AI 的 ultra 与 Google fetch 补丁已针对 1.3.0。版本核对只能确认适配目标，不能证明提供商或桌面验收通过。

### 先比较身份，不先统一类型名

这里的执行指一段模型与工具协作的工作，不等于一次模型请求。子任务先作为委派关系研究，不预设每家都有独立 Task 实体。

| 样本 | 会话 / 执行上下文 | 输入身份 | 执行边界与身份 | 子智能体 / 委派 |
| --- | --- | --- | --- | --- |
| Pi | `sessionId`；SessionManager 保存 entry tree 与 active leaf | SDK 输入不统一返回持久化 Submission ID；RPC `id` 关联命令响应；落入历史后有 entry ID | `turn_*` 是较小的模型与工具轮次；`agent_end` 后仍可能继续；`agent_settled` 是外层收尾边界，但通知期间的新输入仍可安排后续工作。订阅事件没有统一持久化 run ID。 | 官方示例另启 Pi 子进程，其约定不是核心 SDK 的通用子任务协议。 |
| DSH | `ThreadId`；Session 是带 `seq` 的事件日志 | identified message / `MessageId`；inbox、claim、进入历史分开表达 | `turn` 包含多个 `step`；以 session + turn 定位执行，以 step 定位内部轮次 | 本地 child 有稳定 ThreadId，可有后续 activation；外部 execution 不保证可继续发消息。 |
| Pi Durable | storage 内的 `ConversationId` | `SubmissionId`；可选 conversation-scoped `requestId` 去重 | run 包含多次 turn；实验事件以 `inputs: SubmissionId[]` 表达 run，未提供独立 runId；持久化 Task 是另一维度 | Task 可拥有 child conversation；生成、工具等也使用 Task，所以 Task 不等于子智能体。 |
| Codex | `Thread.id`；此基线 `sessionId` 可由整个父子 thread tree 共享 | `clientUserMessageId`、队列 `QueuedSubmission.id`、最终 user item 等各有用途 | 原生 `Turn.id`；start 返回 Turn，steer 可指定 `expectedTurnId` | child 是 Thread；`parentThreadId` 表达父子关系；collab tool item 有自身 ID 和 receiver thread IDs。 |
| ACP v1 | `sessionId` | JSON-RPC request ID 关联 prompt 请求 | prompt 响应以 `stopReason` 表达本次完成，不是独立持久化 execution ID | 核心 prompt / tool-call 协议不能证明存在通用 child 关系。 |
| ACP v2 基线 | `sessionId` | prompt 响应返回已插入的 user `messageId` | `state_update` 报告前台状态，没有因此承诺可寻址的独立 execution 实体 | 子 session 见实验 subagent 协议，不作为 v2 基线保证。 |

各样本的源码依据与限制见下文。身份的作用域也属于契约：相同字符串可能只在一个 session 或某种实体类型内唯一。

### Pi coding-agent

#### 原生行为

`AgentSession` 管理当前对话、模型、工具、队列及扩展。SessionManager 的 entry tree 是模型上下文的来源；切换 active leaf、应用压缩，与 UI 展示全部历史是不同操作。[SDK](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/docs/sdk.md)、[Session 格式](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/docs/session-format.md)

`prompt()` 可能被扩展命令处理，未必启动模型。`steer()` 在当前 assistant turn 和工具完成后进入工作；`followUp()` 在当前 run 的待处理工作完成后进入。`queued` 不能证明模型已经消费。RPC 命令响应也不表示执行成功结束。[RPC](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/docs/rpc.md)

`message_end` 给出完成消息。`agent_end` 是底层循环边界，恢复或排队工作仍可能继续。`agent_settled` 是外层通知，但通知期间提交的新 prompt 可以延后执行，不能据此判断永久空闲。这些事件均不提供通用持久化 run ID。一次 settled 事件不能同时证明某个输入完成、某次模型请求完成和整个目标达成。[Session 事件](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/src/core/agent-session.ts)、[AgentEvent](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/agent/src/types.ts)

官方子智能体示例通过 `--mode json -p --no-session` 启动子进程，并把进度送到父工具的 `onUpdate`。这一组合本身不提供稳定 child session、重启后继续对话或独立子流订阅的核心契约。[官方子智能体示例](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/examples/extensions/subagent/index.ts)

Cherry 适配器使用自研的进程内[子智能体扩展](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/src/subagent.ts)，复用 Pi 原生会话。扩展已有消息和停止控制，而公共 child 访问仍以 `managed-child` 拒绝 `submit`。当前选择和公共控制桥接提案由[子智能体控制记录](https://github.com/CherryHQ/cherry-studio/pull/21578)维护。官方示例和适配缺口都不能证明 Pi 不支持子会话对话。

#### 关系示例

字母编号只表达关系，不是原生字段。

```text
Session S
  prompt A -> model turn -> tools -> model turn -> answer
                      ^ steer B
  followUp C ----------------------------------> later work
  allowed recovery, extension continuation, queued work finish -> agent_settled
```

InputId 需要实际接纳证据。Pi 缺乏通用持久化 ExecutionId，适配器不能补造；RPC request ID 不是可恢复 run ID，最终 session entry ID 也不一定在输入接纳时已经存在。

#### 接纳与控制证据

| 原生行为 | 对公共契约的影响 |
| --- | --- |
| `prompt` 的 `preflightResult` 区分 `started / queued / handled`；注释将其描述为 RPC 内部 hook | 可作为固定 SDK 版本的适配证据，但需兼容性测试。Prompt Promise 完成不能证明接纳时点。 |
| Pi 捕获扩展命令错误，发出 extension error，仍返回 `handled` | `handled` 标识处理路径，不是成功结果。单独保留错误，不能补造成功执行。 |
| `started` 在准备完成后、调用底层 `agent.prompt` 前通知 | 只能证明向执行路径派发，不能证明模型消费或完成。 |
| 异步命令或 input handler 运行时，`isIdle` 仍可能为 true | idle 快照不是原子接纳条件，也不能证明没有在途提交。 |
| 直接 `steer()` 可在 idle 时入队；经过异步 input handler 后不重新检查目标执行 | 不保证“只影响 E1”；先读 busy 再调用无法修复这个竞态。 |
| 原生 `abort()` 等待原生 idle，但不清空 steer/follow-up 队列；仍在 preflight 的输入也可能稍后完成处理 | 回执不能声称所有已提交输入均已取消。阻止后续工作需要宿主接纳屏障和明确的队列策略。 |
| `agent_settled` 通知期间提交的 prompt 被延后处理，调用可能先于延后动作返回 | settled 不是永久 idle，也不是该 prompt 的回执。应等待对应 preflight 证据或报告不确定。 |
| 原生 `dispose()` 同步触发取消与解绑，不等待全部执行收尾 | 返回不代表完成停机；拥有的资源需要独立的关闭协调。 |

依据：[AgentSession](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/src/core/agent-session.ts) 中的 `prompt`、`_startRun`、`_tryExecuteExtensionCommand`、`_queueUserInput`、`_emitAgentSettled`、`abort` 与 `dispose`。这些是原生行为；Cherry 的[会话所有者](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/src/session.ts)还协调用户停止与扩展清理。[运行时适配器](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/src/runtime.ts)通过该所有者中断受管理子会话，不能绕过所有权，把子会话原生 `abort()` 当成完整控制契约。

`SessionManager.open(path)` 会为缺失路径创建新上下文，也可能初始化空文件。公共 `open(existingRef)` 不能直接映射到它。应核对加载后的原生身份与预期一致，不匹配时拒绝打开。单独使用 `existsSync` 仍存在检查和加载之间的竞态。严格只读打开还涉及空文件初始化；若需要这项保证，应推动原生 strict-open，而非复制会话解析器。[SessionManager](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/src/core/session-manager.ts)

### DSH

#### 原生行为

Session 保存 append-only 事件，`seq` 是 session 内位置。`turn/start` / `turn/end` 围住一次模型循环执行，`step/start` / `step/end` 围住一次模型调用及工具执行；插件事件也可出现在 turn 之外。日志位置、执行编号和工具 `callId` 是不同身份。[Session](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/docs/subsystems/session.md)

Agent 的 `followup()` 投递 next-turn，`steer()` 投递 next-step，`inject()` 加入后续上下文但不唤醒 driver。Inbox 变动保存在日志事件中，并保留 MessageId。Claim 将条目移出队列，不等于进入模型历史。`cancel()` 默认还清理 pending 输入，保留队列需要明确选项。[Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/README.md)、[Agent loop](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/README.md)

SubagentManager 区分本地可继续会话与外部单次执行。本地 child 有持久化 ThreadId，同一时刻最多一个 live activation，后续 activation 可以冷恢复。`SubagentActivation` 返回 childId、可选 messageId、result 与 dispose，不保证独立持久化 activationId。Dispose 针对本次 activation，不应误停后续恢复的工作。外部执行不继承本地 child 的消息能力。[Subagent](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/docs/subsystems/subagent.md)

#### 关系示例

```text
parent Session P / turn 7 / tool call K
  -> child Session C / activation A / inbox message M
       -> turn 1 -> step 1, step 2 -> turn/end
       -> activation cleanup and result delivery
  -> later message N to C -> new activation B -> later turn
```

子会话、activation、turn 与启动工具不能合并成同一身份。父结果通知也需要区分子智能体自己发来的消息和管理器报告的子执行结束，否则历史会错误归属发言者。

DSH 挂载 persistence 后可以恢复日志和 inbox；未挂载时可纯内存运行。Loop 恢复会闭合崩溃遗留的 turn，不能据此认为可以从任意外部工具副作用处精确续跑。[持久化集成](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/README.md#persistence-integration)

### Pi Durable

#### 原生行为

Harness 打开 storage 并调度其工作。Conversation 是 transcript；Submission 表示接纳的一次输入或 passive write；Task 是带 checkpoint 的执行状态机。ConversationId、SubmissionId、EntryId、TaskId 是有类型区分的数字身份，跨 storage 使用必须带命名空间。[概念与生命周期](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/README.md)、[存储类型](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/types.ts)

Input Submission 的 `queued → placed → done / unanswered` 区分排队、进入 transcript、回答完成与未回答终结。`placed` 不能证明模型消费。`requestId` 在 conversation 内去重；当记录仍被保留且可访问时，重启后也能用它找回原 Submission。Passive write 也有 Submission，但不一定启动模型。

Run 可以包含多次模型 turn 和 steer 输入。实验 `watchEvents()` 的 run snapshot、`run_start`、`run_end` 带有 `inputs`，没有独立 runId。生成和工具另有 TaskId，不能把任意 generation TaskId 当作整个 run 的身份。[事件定义](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/events.ts)

Task 可拥有 child conversation 或 child tasks；生成、工具、压缩等也使用 Task。前台子智能体示例由工具 task 拥有 child。后台示例用 background anchor task 拥有 child，再由 reporter task 将回答作为 follow-up 投回父会话。后台属性改变等待和取消传播关系，不改变 child conversation 身份。[前台示例](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/test/examples/22-subagent-foreground.ts)、[后台示例](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/test/examples/23-subagent-background.ts)

#### 关系示例

```text
Conversation C
  Submission A -> run { inputs: [A, B] } <- steer Submission B
                    generation Task G1 -> tool Task T -> generation Task G2
  follow-up Submission D -> next run

background anchor Task H -> child Conversation C2
reporter Task R waits for C2's Submission -> delivers result to C
```

`watch()` / `watchEvents()` 将当前快照与后续已提交更新衔接。慢消费者可能收到替换快照；重连不等于按旧 token 游标重放。Child 需要独立的 Conversation 订阅；父会话 watch 不会自动包含所有后代。持久化调度恢复仍受工具 replay-safe 等约束。[观察、任务与恢复](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/README.md#watching-a-conversation)

#### 事务与调度证据

| 原生行为 | 对公共契约的影响 |
| --- | --- |
| `submit` 在同一次 commit 中检查 requestId 和 busy，创建 Submission 并入队或放置 | 接纳和原生输入身份有可查询证据；能否跨进程保留仍取决于 Storage。 |
| requestId 在 Conversation 内去重；同类型重复键返回原 Submission，即使 content 不同 | 重试必须保留原 payload；不能承诺自动检测内容冲突，也不能把复用键的新文本视作已接纳。 |
| `whenBusy: reject` 检查 `live.run`，不是所有未完成工作；idle 时的 `steer` 可启动 run | 明确 busy 的范围。严格 idle-only、active-only 和指定 execution 前置条件是不同保证。 |
| `submit` 在 commit 前调用 scheduler.resume；Submission.wait、Conversation.waitForIdle、Conversation.abort 也会 resume | 等待不一定只观察；被拒绝的提交也可能唤醒共享 Harness 调度器中的既有工作。 |
| Submission.status、Conversation 查询及 watch 不经过上述 resume 路径 | 观察优先采用这些路径；基础接口不提供语义含混的 `waitForIdle()`。 |
| Submission.abort 原子地区分 queued、placed 与 settled | 精确撤回可以作为附加能力；撤回 placed 输入不等于中断整个 conversation。 |
| View attach 将初始快照和 observer 注册串行化；watch 待发更新可被新快照替换 | 支持快照与更新衔接，不承诺完整日志重放。公共事件必须表达替换范围。 |
| watch.stop 解绑并丢弃待发帧，但已经进入的异步 listener 仍可结束 | 停止观察不意味着消费者的异步持久化已经 flush。 |
| Harness.open 会协调遗留 Task 状态，但尚不执行任务；Harness.close 停止并 join 调用，不记录任务取消结果 | 打开不是纯只读；关闭属于 backend 资源行为，原生恢复以后仍可继续未终结任务。 |

依据：[Submissions](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/submissions.ts)、[Harness](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/harness.ts)、[Conversation view](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/view.ts)、[观察队列](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/session/observation.ts)、[Session close](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/session/session.ts)。上游 [Submission 测试](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/test/harness-submissions.test.ts)覆盖重复 requestId 不比较内容、撤回阶段及等待取消；测试存在属于源码证据，不表示已在此执行。

### Codex App Server

#### 原生行为

Thread 是应映射的独立执行上下文。此基线还包含共享 `sessionId`、子智能体 `parentThreadId` 和 fork `forkedFromId`；共享会话树、委派关系与历史分支关系不能混用。Turn 有自身 ID、status、items 和错误信息。[Thread 与 Turn 类型](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs)

`turn/start` 返回 Turn，但此基线也允许向 active turn 加入输入，不能仅凭名称认定新建执行。`turn/steer` 要求 `expectedTurnId` 匹配，返回实际 turnId。`turn/interrupt` 同时携带 threadId 和 turnId。输入可携带 `clientUserMessageId`，字段存在本身不能证明重试幂等。[Turn API](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/turn.rs)

队列 API 另有 `QueuedSubmission.id`、`clientUserMessageId`，支持 list、update、delete、reorder 和 start。队列条目、用户消息、执行仍需区分；队列服务是否启用、去重及崩溃保证需要单独验证。[Queue 类型](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)、[Queue processor](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server/src/request_processors/thread_queue_processor.rs)

流式 item 通知用 threadId、turnId、itemId 定位内容。`CollabAgentToolCall` 标识一次委派工具操作，senderThreadId 和 receiverThreadIds 标识参与者；它不等于 child Thread，也不代表所有后续 child Turns。知道 child 身份不等于宿主当前订阅能收到其全部输出，需要独立验证投递路径。[Item 与协作类型](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/item.rs)

#### 关系示例

```text
Thread P / Turn T1 / collab item K -> child Thread C
                                       parentThreadId = P
                                       Turn T2 -> items / deltas
later collab operation K2 -> same Thread C -> later Turn T3
```

公共 Thread 应映射原生 Thread，而非机械选择名为 `sessionId` 的字段。公共输入、原生 user item 与 Turn 之间需要关联记录；一个输入不一定独占一个 Turn。这是潜在适配器的研究，不表示本栈已经实现 Codex 适配器。

### 按协议版本研究 ACP 智能体

#### v1

`session/prompt` 在处理期间保持 pending，智能体经 `session/update` 推送消息和工具更新，最终响应返回 stopReason。JSON-RPC request ID 关联本次调用，不因此建立可查询、持久化的执行对象。`session/cancel` 后仍可能有收尾更新，由 prompt 响应确认完成。[v1 Prompt turn](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v1/prompt-turn.mdx)

```text
session S / prompt request Q
  -> session/update ... -> prompt response { stopReason }
```

#### v2 基线，整体仍为 draft

成功 prompt 响应确认用户消息已经插入，返回智能体生成的 messageId；仅收到、排队或分配 ID 不满足该条件。插入不承诺持久化或模型消费；响应丢失后重试可能再次插入消息。[v2 Prompt lifecycle](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/prompt-lifecycle.mdx)

前台执行由 `state_update` 的 running、requires_action 和 idle 表达，独立于 prompt 请求。后台活动可以在 idle 时继续，也可以触发新的前台工作。这个状态不是具有独立身份的 Run，重连快照也不是一次新的执行开始或结束。

内容 ID 按 session 和实体类型划分作用域：相同 messageId 可以分别标识 agent message 和 agent thought。投影不能只按字符串合并。恢复仅重放保留的历史，不保证每条已插入消息都仍被保留。[v2 身份规则](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/prompt-lifecycle.mdx#entity-ids)、[v2 Session setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/session-setup.mdx)

```text
session S / prompt request Q -> insert user message M -> response { messageId: M }
foreground state and output update separately: running / requires_action -> idle
background child or task may continue; later foreground work may start
```

图中表达语义关系，不要求 running 状态、消息更新和 prompt 响应严格按该顺序到达。

#### 实验子智能体表达

Subagent RFD 通过父 session 的 `subagent_update` 宣告 child session；child 输出按自身 sessionId 自动投递到同一连接。Child 可以反复接收委派，因此关系不等于某一次任务或工具调用。控制能力另行声明。这与 lane 所需来源身份相容，但不是所有 ACP 实现都具备的保证。[Subagent Sessions RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/rfds/subagents.mdx)

### Cherry 与 OAR 接入对照

宿主协调仍然必要。结构问题在于执行和展示共享了过多身份与生命周期，不只是服务体积大或有两份历史。

| 现有桌面接缝 | 源码结构 | 设计约束 |
| --- | --- | --- |
| 原生会话藏在连接后面 | 公共操作围绕 connect、send、redirect 和 close；Pi 连接内部调用 SessionManager.open/create | 区分原生上下文身份、访问句柄、传输连接与运行资源；恢复语义不能只由 opaque token 隐含定义。 |
| 展示回合与原生执行混用 | startContinuationTurn 在 steer 后创建新的 assistant 行和 turnId，但不向 harness 发新请求 | 展示分段可以变化，执行身份只随真实执行边界变化。 |
| 输入调度跨越所有者 | 宿主队列决定何时 send；redirect 回执与事件决定后续回合；harness 也在安排输入 | 接收、投递、排队、进入上下文分别确认；每项调度决策只有一个所有者。 |
| 子输出依赖父消息 | Background flow 用 rootToolCallId 查父消息锚点，再选择当前流或后台累积器；没有锚点时忽略输出 | 子内容按自身来源组织；父工具与父消息只保留关联关系。 |

依据：[桌面连接与事件](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/types.ts)、[Pi 创建与恢复](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/pi/PiRuntimeConnection.ts)、[宿主回合与后台输出](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/agentSession/AgentSessionRuntimeService.ts)。这些是静态结构结论，不表示每个潜在竞态均已复现。[桌面 Pi README](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/pi/README.md)明确现有连接尚未使用新包。

Opaque resume token、宿主输入队列和展示历史都可以存在。问题不是它们存在，而是证据、所有权不清晰，以及它们可能与原生状态竞争。产品会话之间的消息投递也不建立子智能体所有权；[子智能体控制记录](https://github.com/CherryHQ/cherry-studio/pull/21578)维护这一区别。

OAR 基线 `141921ea5a818bd8b0a1c0c1e17a2593898dbefe` 的 `packages/oar/src/runtimes/pi-durable/session.ts` 在 open 时 resume，并把部分 Submission 结果折叠为 turn_ended。Cherry 当前适配器将访问与显式 resume 分开，不强制通用 Turn。OAR 的 steer 状态预检查本身不能证明接纳时仍针对同一执行。这是保证边界分析，不是已经复现的用户故障。

### 验证记录与剩余验收

#### 历史执行：Pi 1.2.0 离线探针

原调研记录 `node .context/harness-research/pi-probe.mjs` 退出码为 0。脚本和 JSON 仍保留在本工作区 `.context/harness-research/`，属于研究附件，不是随仓库分发的回归测试。保留的 JSON 明确标注 `packageVersion: "1.2.0"`。本次迁移读取它，不代表重新执行。

| Pi 1.2.0 探针 | 原始记录结果 |
| --- | --- |
| 抛错的本地命令会不会看起来成功 | Prompt resolve，preflight 为 handled，同时出现 extension error，没有消息；处理路径与结果必须分开。 |
| idle steer 是否启动执行，abort 是否撤回它 | idle 保持 true，abort 后队列仍保留同一文本。 |
| input hook 等待期间，idle / abort 是否构成接纳屏障 | idle 为 true，abort 先返回，释放 hook 后才收到 handled。 |
| 打开缺失路径是否严格失败 | 返回带新 sessionId 的空上下文；不能用原生 open 直接实现公共 open。 |

这些探针没有覆盖模型流、扩展子智能体、网络故障、崩溃或真实工具副作用，不能证明适配器完整兼容。

#### 现有适配器测试与历史验证范围

前身文档记录首版适配器验证通过，使用原生 Pi、离线 AI SDK 模型，以及 Durable 的 faux provider、MemoryStorage 和 Node SQLite。但该记录没有整个验证过程的完整命令日志或精确提交对应关系，因此属于历史证据，不是迁移后 HEAD 的新通过记录。以下当前文件保留可执行的回归覆盖；本次仅文档迁移没有重跑 runtime 测试。

| 当前回归源码 | 测试覆盖的行为 |
| --- | --- |
| [公共观察](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime/tests/observation.test.ts) | 慢消费者隔离；有界溢出后 gap 与快照；首帧快照；停止不等待已进入的消费者；异常及对象修改隔离；替换顺序；异步派发与重入顺序。 |
| [Pi 适配器](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/tests/runtime.test.ts) | 多访问者共享内容身份；流式输出与 release 隔离；原生忙时拒绝；命令 preflight 与 follow-up 入队；错误原生身份拒绝；原生文件正常关闭和重开。 |
| [Pi 原生会话](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi/tests/nativeSession.test.ts) | 原生提供商执行，以及调用方保有借入 model runtime 的所有权，不依赖 Cherry AI SDK 桥接。 |
| [Pi Durable 适配器](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/packages/agent-runtime-pi-durable/tests/runtime.test.ts) | 当前视图与输入完成；忙时拒绝、去重、按会话撤回；后续状态读取失败不丢失接纳回执；owned child 独立观察；SQLite 正常关闭重开；被动观察查询后显式 resume。 |
| `src/main/ai/runtime/pi/gateway*.test.ts` 中的 Cherry 桥接测试 | 模型桥、原生历史、工具、压缩、goal、前后台子智能体、续接与结果交付。[子智能体停止测试](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/pi/aiSdkSubagentStop.test.ts)也覆盖通过所有者控制器中断 child thread。仅原生测试保留在 `packages/agent-runtime-pi/tests/`。 |
| [校验范围选择](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/scripts/__tests__/validationPlan.test.ts)、[校验工作流](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/scripts/__tests__/validationWorkflow.test.ts) | 新包纳入影响范围选择；公共包变化包含两个适配器的消费者检查。 |

客户端工具参数由执行它的 harness 校验。即使 schema 校验失败，网关也保留对象参数和调用身份，让 harness 返回错误并由模型纠正。拒绝所有校验错误会截断这个循环；把 null 或无法解析的参数替换成 `{}` 则可能执行另一个调用。因此网关拒绝非对象的错误输入。`toolInputRecovery.test.ts` 通过真实协议转换器和原生 Pi 循环覆盖两类结果；共享夹具位于 `tests/helpers/piGateway.ts`，不放在生产 runtime 代码中。

[Pi 桥接 README](https://github.com/CherryHQ/cherry-studio/blob/bd6509eb5f71a9c6bbb57453f0a7ced25e92c766/src/main/ai/runtime/pi/README.md)说明测试使用真实 AI SDK 流式处理和本地 HTTP 提供商。这不等于真实外部提供商验收、完整上游 SDK 测试套件或 Electron 验收。测试文件和历史通过记录不能替代这些边界。

#### 剩余缺口

- **产品接入：** AgentSessionRuntimeService、lane、展示投影存储、IPC 和多窗口消费者尚未迁移到新适配器；父消息结束后的 UI 行为仍需应用验收。
- **身份与覆盖：** Pi 内容身份属于当前来源，rebind 和压缩会重置映射。Durable 历史使用原生 entry ID；实时预览到历史项的关联不保证无缝 `replaces`，采用 gap 与替换快照。展示归档不是可重新导入的原生上下文。
- **恢复：** SQLite 覆盖正常关闭重开，不覆盖进程崩溃、外部工具副作用或多个 Conversation 同时恢复的真实负载；不保证 exactly-once 工具执行。
- **控制范围：** Pi 扩展拥有 child 输入和结果交付，公共 managed-child submit 仍不支持。Child interrupt 通过所有者控制，不是通用 delegation cancel API。Durable 使用原生 ordinary abort 范围；后台子树、queued write、任务孤立和恢复失败仍需专项验收。其 child 测试证明发现和独立观察，不能证明完整的子会话连续对话流程。
- **协议范围：** 公共文本/推理协议不包含图像。Pi 工具执行中间输出和 Durable nested-tool 进度尚未投影；Durable 已投影保留的实时工具输出。历史分页、精确 Execution 控制、Interaction 和统一 spawn/cancel 均不属于已实现 v0。
- **输入边界：** 完整 SDK 升级探针、存储故障矩阵，以及调用方停止等待后的宿主持久投递记录仍有缺口。Pi 桥接已有 settle 期间的协调测试，但不能替代每条公共句柄接纳/重入路径的专项覆盖。不能根据 Promise 或 idle 快照推断缺失事实。

Unsupported 或 unknown 可以是合法结果，但都不能算作更强保证的验收通过。各包 README 和运行时契约保留这些限制，不能以测试数量替代说明。

## Alternatives considered

- 根据 session、turn、task 等名称统一：不采用，因为样本中这些名称的身份作用域、执行边界和持久化保证不同。
- 将源码阅读或历史通过记录视为当前兼容性：不采用，因为版本、适配路径、存储和环境决定实际验证了哪项保证。
- 增加公共队列或调度器来填补所有原生缺口：不采用，因为会形成竞争的所有权并掩盖不支持的控制；应保留原生证据与明确限制。
- 要求所有 harness 提供最丰富的子会话对话和取消行为：不采用，因为单次任务和仅可观察的子智能体也有效；独立的控制提案定义可选能力。
- 离线测试通过就认定适配完成：不采用，因为生产接入、UI 投影、真实提供商、崩溃行为与副作用都需要独立验收。

## Acceptance criteria

- AC1 — 每项公共保证均可追溯到具名样本、固定源码或已执行测试，并有明确证据层级；历史版本仍可辨认。(verification: docs gate — 运行时契约与证据记录维护者)
- AC2 — 现有 Pi 与 Durable 适配路径在不增加第二套调度器的前提下，验证输入回执、观察衔接与缺口、访问释放隔离以及原生身份检查。(verification: unit — 公共运行时与适配器测试负责人，使用明确的受影响测试路径)
- AC3 — 控制验证区分 managed-child 输入限制、经所有者执行的 Pi 中断、Durable 调度启用与原生取消范围，不宣称统一 spawn/cancel 已实现。(verification: unit — Pi 与 Durable 适配器负责人)
- AC4 — 持久化证据区分正常重开、崩溃恢复和外部副作用；更强恢复保证必须附带实际覆盖该场景的专项验证。(verification: unit — 适配器存储与恢复测试负责人)
- AC5 — 宣布桌面接入完成前，真实应用能展示父任务完成后的独立子输出、预期的输入/控制路径，以及消费者重连，且不混淆宿主展示与原生执行。(verification: Electron — 桌面运行时与投影负责人)

AC1 是文档约束；AC2–AC4 需要被验收实现版本上的证据。新适配器尚未接入桌面，所以 AC5 仍待完成。本 proposed 记录不表示整个栈已经满足这些条件。

## Risks

- 固定源码调研可能落后于后续上游发布。应保留原始结论与版本，再为新版本补证据，不能改写旧结果的版本标签。
- Pi 内部 preflight hook 及 Durable/ACP 实验观察接口可能变化；兼容性覆盖必须保护适配器实际使用的路径。
- 正常重开测试可能掩盖崩溃、重放和工具副作用风险；验证相应场景前应明确限制结论。
- 可发现 child 或存在输入方法，可能被误认为拥有控制权或会向父会话交付结果；这些行为应由对应原生系统或编排层负责。
- Current-view 替换和映射重置可能被误认为完整历史或 token 重放；消费者必须遵守 coverage 与 gap 语义。
