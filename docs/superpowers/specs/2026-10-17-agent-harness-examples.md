# Agent Harness 样本与验证证据

2026-10-17 · 研究证据。本文集中维护固定源码基线、原生行为、已执行探针和验收缺口。定义见 [Harness 定义与边界](2026-10-17-agent-harness-definition.md)，唯一的接口方案见 [接口与行为契约](2026-10-17-agent-runtime-ownership-and-behavior.md)。以下流程示意不等于运行日志；源码与原生测试的阅读不等于本地测试通过。

## 1. 样本范围

后续每项公共契约都应回到这五类样本验证。不能因为方法都叫 `prompt`、对象都叫 `session`，就认为行为相同；也不能用某个现有适配器未暴露能力，证明原生 harness 没有该能力。

| 样本 | 本文研究的边界 | 源码基线 |
| --- | --- | --- |
| Pi | `pi-coding-agent` SDK，辅以 RPC 与官方 subagent 扩展示例 | `earendil-works/pi@8efd314fa3d3232ce197d8d7a6a5660530b9d83e` |
| DSH | `dsh-agent`、`dsh-agent-loop`、`dsh-session` 与 subagent 插件体系 | `deepseek-ai/deepseek-harness@1600d8a1e140dcde43a1a0941940a0480712c011` |
| Pi Durable | `pi-durable` 的 Harness、Conversation、Submission 与 Task | 与 Pi 相同源码基线，独立包及执行系统 |
| Codex | App Server v2 对宿主暴露的协议与对应实现 | `openai/codex@ce0323f2f2d3b25e82806cd555237da3db4e1897` |
| ACP | 连接到 ACP agent 时的协议契约；区分 v1、v2 基线与实验扩展 | `agentclientprotocol/agent-client-protocol@e7dac67ac64ec7cf69079b3bb6eff46a21e026b3` |

Pi 和 Codex 基线来自用户提供的本地仓库；DSH 和 ACP 来自上游固定提交。它们不是 Cherry 当前依赖版本的兼容性结论。尤其 DSH 样本研究当前上游，不用它反推已退役的 Cherry DSH 集成行为。

ACP 是接入协议，不是另一套执行引擎。“ACP 样本”指协议可表达的 harness 行为，具体 agent 仍决定执行、存储和扩展能力。该基线明确将 v2 整体标为 draft；`schema/v2/schema.json` 与叠加实验特性的 unstable schema 也需区分。[ACP 版本与迁移说明](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/migration.mdx)

### 验证版本与范围

- 调研时 Cherry 安装的 `pi-coding-agent` / `pi-ai` 为 **1.2.0**；探针直接调用安装的 SDK，没有经过 Cherry 的 runtime 包装，也没有调用模型或外部工具。
- 用户提供的 Pi 源码为 `8efd314fa3d3232ce197d8d7a6a5660530b9d83e`，coding-agent 与 durable 包均为 **1.3.0**。以下原生链接固定到这个提交；不能将 1.2.0 探针结果写成 1.3.0 已通过。
- 调研时 Pi Durable 未被 Cherry 引入，关联源码仓库未安装依赖。证据来自实现与原生测试的静态阅读，**不代表原生测试已运行或通过**。
- OAR 对照为本地 `141921ea5a818bd8b0a1c0c1e17a2593898dbefe`。其产品选择可借鉴，不作为原生保证。

## 2. 先比较身份，不先统一类型名

下表的“执行”指一段模型与工具协作的工作，不等于一次模型请求；“子任务”先作为委派关系研究，不预设每家都有独立 Task 实体。

| 样本 | 会话 / 执行上下文 | 输入身份 | 执行边界与身份 | 子 agent / 委派 |
| --- | --- | --- | --- | --- |
| Pi | `sessionId`；SessionManager 保存 entry tree 与 active leaf | SDK 输入不统一返回持久化 Submission ID；RPC `id` 关联命令响应；落入历史后有 entry ID | `turn_*` 是较小的模型与工具轮次；`agent_end` 后仍可能继续；`agent_settled` 是较外层的收尾边界，通知期间的新输入仍可触发后续工作。订阅事件没有统一持久化 run ID | 官方扩展示例另启 Pi 子进程；不能把示例约定当作核心 SDK 的通用子任务协议 |
| DSH | `ThreadId`；Session 是带 `seq` 的事件日志 | identified message / `MessageId`；inbox、claim、进入历史分开表达 | `turn` 包含多个 `step`；以 session + turn 定位执行，以 step 定位内部轮次 | 本地 child 有稳定 ThreadId，可有后续 activation；外部 execution 不保证可继续发消息 |
| Pi Durable | storage 内的 `ConversationId` | `SubmissionId`；可选 conversation-scoped `requestId` 去重 | run 包含多次 turn；实验事件以 `inputs: SubmissionId[]` 表达 run，未提供独立 runId；持久化 Task 是另一维度 | Task 可拥有 child conversation；Task 也用于生成、工具等，并非“子 agent”的同义词 |
| Codex | `Thread.id`；此基线 `sessionId` 可由整个父子 thread tree 共享 | `clientUserMessageId`、队列 `QueuedSubmission.id`、最终 user item 等各有用途 | 原生 `Turn.id`；start 返回 Turn，steer 可指定 `expectedTurnId` | child 是 Thread；`parentThreadId` 表示父子关系；collab tool item 另有自身 ID 和 receiver thread IDs |
| ACP v1 | `sessionId` | JSON-RPC request ID 关联 prompt 请求 | prompt 响应以 `stopReason` 表达本次完成；不是独立持久化 execution ID | 不能从核心 prompt / tool-call 协议推导通用 child 关系 |
| ACP v2 基线 | `sessionId` | prompt 响应返回已插入的 user `messageId` | `state_update` 报告前台状态；没有据此承诺可寻址的独立 execution 实体 | 子 session 暴露另见实验 subagent 协议，不作为 v2 基线保证 |

各行的源码依据与具体限制见下面的独立样本。ID 的作用域也属于契约：同一个字符串可能只在一个 session 或某种实体类型内唯一。

## 3. Pi coding-agent

### 原生事实

`AgentSession` 管理当前对话、模型、工具、队列及扩展。SessionManager 的 entry tree 是最终模型上下文的来源；切换 active leaf、应用压缩，与 UI 展示全部历史是不同操作。[SDK](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/docs/sdk.md)、[Session 格式](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/docs/session-format.md)

`prompt()` 可能被扩展命令处理，未必启动模型。`steer()` 在当前 assistant turn 和工具完成后进入工作；`followUp()` 在当前 run 的待处理工作完成后进入。返回 `queued` 不能证明模型已经消费。RPC 的命令响应也不表示执行成功结束。[RPC](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/docs/rpc.md)

`message_end` 给出完成消息；`agent_end` 是底层循环边界，恢复或排队工作仍可能继续；`agent_settled` 是较外层的收尾通知，但通知期间提交的新 prompt 可以延后执行，不能把事件出现理解为永久空闲。这些事件本身不带通用持久化 run ID。不能把 `agent_settled` 同时解释成某一输入完成、某次模型请求完成和整个目标达成。[Session 事件类型](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/src/core/agent-session.ts)、[底层 AgentEvent](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/agent/src/types.ts)

官方 subagent 扩展示例通过 `--mode json -p --no-session` 启动子进程，并把进度送到父工具的 `onUpdate`。这是一个具体组合方式，并不自动提供稳定 child session、跨重启继续交谈或独立子流订阅的核心契约。[Subagent 示例](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/examples/extensions/subagent/index.ts)

### 关系示例

以下及后续流程均是根据接口编写的示意，不是采集到的运行日志；字母编号不表示原生字段。

```text
Session S
  prompt A → 模型轮次 → 工具 → 模型轮次 → 回答
                   ↑ steer B
  followUp C ──────────────────────────→ 后续工作
  允许的自动恢复、扩展续跑、排队工作处理结束 → agent_settled
```

映射问题：InputId 需关联实际接纳证据；Pi 缺乏通用持久化 ExecutionId，不能由适配器补造；不能用 RPC request ID 冒充后端可恢复的 run ID，也不能把最终 session entry ID 当作输入接纳阶段就已存在的 ID。

### 接纳与控制证据

| 原生事实 | 对公共契约的影响 |
| --- | --- |
| `prompt` 的 `preflightResult` 区分 `started / queued / handled`；该 hook 注释为 RPC 内部用途 | 可作为固定 SDK 版本的适配证据；需版本兼容测试，不能靠 `prompt` Promise 的完成推断接纳时间 |
| 扩展命令抛错时，Pi 捕获错误并发出 extension error，仍返回 `handled` | `handled` 是处理路径，不是成功结果；错误单独保留，不能产生成功 Execution |
| `started` 在准备完成后、调用底层 `agent.prompt` 前通知 | 只能确认向执行路径派发，不能确认模型消费或完成 |
| 异步命令 / input handler 运行时，`isIdle` 仍可能为 true | idle 快照不是原子接纳条件，也不能证明没有在途提交 |
| 直接 `steer()` 在 idle 时也可入队；经过异步 input handler 后不重新检查目标执行 | 不提供“只影响当前 E1”的保证；不能用先读 busy 再调用修补这个竞态 |
| `abort()` 等待原生 idle，但不清空 steer / follow-up 队列；尚在 preflight 的输入也可能稍后完成处理 | 中断回执不能宣称“所有已提交输入均已取消”；停止并禁止新工作需要额外的宿主接纳屏障和明确的队列策略 |
| `agent_settled` 通知期间的新 prompt 会被延后处理；调用可能先返回，再执行延后动作 | settled 不是永久空闲，也不是该 prompt 的回执；必须等待对应 preflight 证据或明确的未确认结果 |
| `dispose()` 同步触发取消及解绑，不等待全部执行收尾 | 不能直接把其返回视为完成停机；活跃资源关闭需要独立编排 |

依据：[AgentSession 实现](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/src/core/agent-session.ts) 中 `prompt`、`_startRun`、`_tryExecuteExtensionCommand`、`_queueUserInput`、`_emitAgentSettled`、`abort` 与 `dispose`。

此外，`SessionManager.open(path)` 对缺失路径创建新上下文，空文件也可初始化新会话。公共 `open(existingRef)` 不能直接等同于这个方法。适配器需要验证加载后的原生身份与预期身份一致，错误时不暴露为成功打开；只做 `existsSync` 前置检查不足以解决检查与加载之间的变化。严格无写入打开涉及空文件初始化等问题，若产品需要该保证，应推动原生提供 strict-open，而非复制会话文件解析器。[SessionManager](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/coding-agent/src/core/session-manager.ts)

## 4. DSH

### 原生事实

Session 保存 append-only 事件，`seq` 是 session 内位置。`turn/start` / `turn/end` 围住一次模型循环执行，`step/start` / `step/end` 围住一次模型调用及工具执行；日志也允许 turn 之外的插件事件。日志位置、执行编号、工具 `callId` 是不同身份。[Session](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/docs/subsystems/session.md)

Agent 的 `followup()` 投递 next-turn，`steer()` 投递 next-step，`inject()` 加入后续上下文但不唤醒 driver。inbox 以日志事件保存结构变动并保留 MessageId；claim 移出队列不等于进入模型历史。`cancel()` 默认还清理 pending 输入，保留队列需要明确选项。[Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent/README.md)、[Agent loop](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/README.md)

SubagentManager 区分本地可继续会话和外部单次 execution。本地 child 有持久化 ThreadId，同一时刻最多一个 live activation；后续可冷恢复。`SubagentActivation` 返回 childId、可选 messageId、result 与 dispose，不能假定它还暴露独立持久化 activationId。dispose 针对这次 activation，不应误停后续恢复的工作。外部执行是否允许继续投递，不能照搬本地 child 能力。[Subagent](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/docs/subsystems/subagent.md)

### 关系示例

```text
父 Session P / turn 7 / tool call K
  → child Session C / activation A / inbox message M
      → turn 1 → step 1、step 2 → turn/end
      → activation 资源清理与结果交付
  → 后续向 C 发消息 N → 新 activation B → 后续 turn
```

子会话、activation、turn 与启动工具不可合并。父结果通知也需区分“子 agent 自己发来的消息”和“管理器报告子执行已结束”，否则历史会错误归属发言者。

DSH 挂载 persistence 后可恢复日志和 inbox；未挂载时可纯内存运行。loop 恢复时会补齐崩溃遗留的未闭合 turn，这不能解释成从任意工具副作用处精确续跑。[Agent loop 的持久化集成](https://github.com/deepseek-ai/deepseek-harness/blob/1600d8a1e140dcde43a1a0941940a0480712c011/packages/core/agent-loop/README.md#persistence-integration)

## 5. Pi Durable

### 原生事实

Harness 打开一份 storage 并调度其工作。Conversation 是 transcript；Submission 表示接纳的一次 input 或 passive write；Task 是带 checkpoint 的执行状态机。ConversationId、SubmissionId、EntryId、TaskId 都是有类型区分的数字身份，跨 storage 使用必须带命名空间。[概念与生命周期](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/README.md)、[存储类型](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/types.ts)

Input Submission 的 `queued → placed → done / unanswered` 区分队列、进入 transcript、回答和未回答终结；`placed` 不是模型消费证明。`requestId` 在 conversation 内去重，在持久存储保留记录且可访问时，同一个 requestId 可在重启后找回原 Submission。Passive write 也有 Submission，但不必启动模型。

Run 含多次模型 turn，也能纳入 steer 输入。实验 `watchEvents()` 的 run snapshot、`run_start`、`run_end` 带 `inputs`，没有独立 runId；生成与工具另有 TaskId。因此不能把任意 generation TaskId 当成贯穿整个 run 的身份。[事件定义](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/events.ts)

Task 可拥有 child conversation 或 child tasks；生成、工具、压缩等也能使用 Task。前台子会话示例由工具 task 拥有；后台示例用 background anchor task 拥有 child，再由 reporter task 将答案作为 follow-up 投回父会话。后台属性改变等待和取消传播关系，不改变 child conversation 的身份。[前台子 agent 示例](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/test/examples/22-subagent-foreground.ts)、[后台子 agent 示例](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/test/examples/23-subagent-background.ts)

### 关系示例

```text
Conversation C
  Submission A → run { inputs: [A, B] } ← steer Submission B
                   generation Task G1 → tool Task T → generation Task G2
  follow-up Submission D → 下一次 run

background anchor Task H → child Conversation C2
reporter Task R 等待 C2 的 Submission → 向 C 投递结果
```

`watch()` / `watchEvents()` 从当前快照衔接提交后的更新；慢消费者可能收到替换快照，重新连接不等于按旧 token 游标重放。观察子会话需要明确订阅其 Conversation，不能假定父会话 watch 自动包含所有后代。持久化 scheduler 的恢复也仍受工具 replay-safe 等约束。[观察、任务与恢复](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/README.md#watching-a-conversation)

### 事务与调度证据

| 原生事实 | 对公共契约的影响 |
| --- | --- |
| `submit` 在同一 commit 内检查 requestId、busy 并创建 Submission / 入队或放置 | 接纳和原生输入身份有可查询事实；是否跨进程保留仍取决于 Storage |
| requestId 在 Conversation 内去重；同类型重复键返回原 Submission，即使 content 不同 | 调用方重试必须保持原 payload；不能承诺后端自动检测内容冲突，更不能把相同键的新文本当成已接纳 |
| `whenBusy: reject` 检查 `live.run`，不是所有未完成工作；`steer` 在 idle 时可以开始新 run | 公共 busy 必须披露判定范围；严格 idle-only、active-only 和指定 Execution 条件不能混为一谈 |
| `submit` 在 commit 前调用 scheduler.resume；Submission.wait、Conversation.waitForIdle、Conversation.abort 也会 resume | “等待”不一定只观察，甚至被拒绝的提交也可能唤醒既有工作；副作用作用于共享 Harness 的调度器 |
| `Submission.status`、Conversation 的查询与 watch 不通过上述 resume 路径 | 观察优先采用这些路径；基础接口不提供语义含混的 `waitForIdle()` |
| `Submission.abort` 原子地区分 queued、placed、settled | 精确撤回可以作为能力；不能把 placed 输入的撤回升级为中断整个会话 |
| view attach 把初始快照与 observer 注册放在同一串行线上；watch 积压时可替换为新快照 | 支持快照加增量的衔接；不承诺完整事件日志重放，替换范围需要进入公共事件 |
| watch.stop 解绑并丢弃待发帧，但已进入的异步 listener 仍可结束 | 停止观察不能默认保证消费者的异步持久化也已 flush |
| Harness.open 会协调遗留 Task 状态，尚不执行任务；Harness.close 停止并 join 调用，不写成任务取消结果 | 打开不等于纯只读；关闭是 backend 级资源行为，后续可以由原生恢复机制继续未终结任务 |

依据：[Submissions](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/submissions.ts)、[Harness](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/harness.ts)、[Conversation view](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/harness/view.ts)、[观察队列](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/session/observation.ts)、[Session close](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/session/session.ts)。原生 [Submission 测试](https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/test/harness-submissions.test.ts) 明确覆盖重复 requestId 不比较内容、撤回阶段及取消等待。

## 6. Codex App Server

### 原生事实

Thread 是应映射为独立执行上下文的对象。此基线还包含共享的 `sessionId`、子 agent 的 `parentThreadId` 和 fork 的 `forkedFromId`；共享会话树、委派父子关系、历史分支关系不能混用。Turn 有自身 ID、status、items 与错误信息。[Thread / Turn 类型](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs)

`turn/start` 返回 Turn，但此基线也允许向 active turn 加入输入，不能只看方法名就认定新建执行。`turn/steer` 要求 `expectedTurnId` 匹配，响应返回实际 turnId；`turn/interrupt` 明确携带 threadId 和 turnId。输入还可携带 `clientUserMessageId`；字段存在本身不能证明跨重试幂等。[Turn API](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/turn.rs)

队列 API 另有 `QueuedSubmission.id`、`clientUserMessageId`，支持 list、update、delete、reorder、start。这里应继续区分队列条目、用户消息和执行；是否启用队列服务、去重和崩溃保证需单独验证。[Queue 类型](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)、[Queue processor](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server/src/request_processors/thread_queue_processor.rs)

流式 item 通知用 threadId、turnId、itemId 定位内容。`CollabAgentToolCall` 的 ID 标识委派工具操作，senderThreadId 与 receiverThreadIds 标识参与者；它不等于 child Thread，也不代表所有后续 child Turns。child 已知身份不自动意味着宿主当前订阅能收到其全部输出，需要另测具体投递路径。[Item 与协作类型](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/app-server-protocol/src/protocol/v2/item.rs)

### 关系示例

```text
Thread P / Turn T1 / collab item K → child Thread C
                                      parentThreadId = P
                                      Turn T2 → items / deltas
后续协作操作 K2 → 同一 Thread C → 后续 Turn T3
```

公共 Session 应优先对齐 Thread，而不是机械选择名字叫 `sessionId` 的字段。公共输入身份、原生 user item 与 Turn 之间需要关联记录；一次输入不保证独占一个 Turn。

## 7. ACP agent：按版本观察

### v1

`session/prompt` 请求在处理过程中保持 pending，Agent 经 `session/update` 推送消息和工具更新，最终 prompt 响应返回 stopReason。JSON-RPC request ID 关联这次调用；核心流程没有因此获得可查询、持久化的执行对象。`session/cancel` 后仍可有收尾更新，完成由 prompt 响应确认。[v1 Prompt turn](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v1/prompt-turn.mdx)

```text
session S / prompt request Q
  → session/update ... → prompt response { stopReason }
```

### v2 基线，整体仍为 draft

成功 prompt 响应确认用户消息已插入，返回 agent 生成的 messageId；仅收到、排队或分配 ID 不满足这一条件。插入不承诺持久化或模型消费，响应丢失后重试可能再次插入。[v2 Prompt lifecycle](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/prompt-lifecycle.mdx)

前台执行由 `state_update` 的 running、requires_action、idle 描述，独立于 prompt 请求；后台活动可在 idle 时继续，也可触发新前台工作。该状态不能直接当作有独立身份的 Run；重连快照也不能算作新一次执行开始或结束。

内容 ID 按 session 和实体类型区分。例如同名 messageId 可分别用于 agent message 和 agent thought，投影不能只按字符串 ID 合并。恢复只重放保留的历史，不承诺保留所有已插入消息。[v2 身份规则](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/prompt-lifecycle.mdx#entity-ids)、[v2 Session setup](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/protocol/v2/session-setup.mdx)

```text
session S / prompt request Q → 插入 user message M → response { messageId: M }
前台状态与输出另行更新：running / requires_action → idle
后台 child 或 task 可能继续；后续又可能出现前台工作
```

此图只展示语义关系，不要求 running、消息更新、prompt 响应严格按图中顺序到达。

### 实验 subagent 表达

Subagent RFD 用父 session 上的 `subagent_update` 宣告 child session；child 输出按自身 sessionId 自动投递到同一连接。child 可被反复委派，关系不等于一次任务或工具调用；控制能力另行声明。这与 lane 的来源需求相容，但不是所有 ACP 实现已经具备的保证。[Subagent Sessions RFD](https://github.com/agentclientprotocol/agent-client-protocol/blob/e7dac67ac64ec7cf69079b3bb6eff46a21e026b3/docs/rfds/subagents.mdx)


## 8. Cherry 与 OAR 的接入对照

现有服务承担宿主协调是必要的。问题在于执行管理与展示管理共享了过多身份和生命周期，而不仅是服务体积大或存在两份历史。

| 当前接缝 | 已观察到的代码结构 | 对应的设计约束 |
| --- | --- | --- |
| 原生会话藏在连接后面 | 公共入口围绕 connect、send、redirect、close；Pi 连接内部调用 SessionManager.open/create | 显式区分会话引用、访问句柄、传输连接与运行资源；恢复语义不能只由 token 隐含表达 |
| 展示回合与原生执行混用 | startContinuationTurn 为 steer 后的展示创建新 assistant 行和 turnId，但不向 harness 发送新请求 | 展示分段可以变化，Execution 身份只随真实执行边界变化 |
| 输入安排跨越多个所有者 | 宿主队列决定何时 send，redirect 回执及后续事件决定是否转下一轮；harness 内仍有输入安排机制 | 接纳、投递、排队、进入上下文分别确认；同一项调度决策只有一个所有者 |
| 子输出依赖父消息 | background flow 用 rootToolCallId 查父消息锚点，再选择当前流或后台累积器；缺少锚点时忽略输出 | 子内容按自身来源组织；父工具和父消息只保留引用关系 |

源码依据：[公共连接与事件契约](../../../src/main/ai/runtime/types.ts)、[Pi 会话创建与恢复](../../../src/main/ai/runtime/pi/PiRuntimeConnection.ts)、[宿主回合与后台输出管理](../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts)。以上是静态结构分析，不表示每个潜在竞态均已复现。

Opaque resume token、宿主输入队列和展示历史都可以存在。错误不在于使用它们，而在于没有明确它们能证明什么、由谁维护，以及是否与原生状态构成了竞争的事实来源。

OAR 对照基线为 `141921ea5a818bd8b0a1c0c1e17a2593898dbefe`，路径 `packages/oar/src/runtimes/pi-durable/session.ts`。该接入在 open 时 resume，并把部分 Submission 结果折叠为 turn_ended。Cherry 的当前方案将访问与恢复分开，不强制通用 Turn。OAR 的 steer 状态预检查本身不证明接纳时仍是同一执行；这里是保证边界分析，不是已复现的用户故障。

## 9. 验证记录与验收清单

### 9.1 已执行：Pi 1.2.0 离线探针

此前调研执行命令：`node .context/harness-research/pi-probe.mjs`，退出码 0。脚本和 JSON 结果保留于本工作区 `.context/harness-research/`，属于研究附件，不是随仓库分发的回归测试。

| Pi 1.2.0 探针 | 结果 |
| --- | --- |
| 抛错的本地命令会不会被误判成功 | prompt resolve，preflight 为 handled，同时收到 extension error，没有消息；证实必须分开处理路径与结果 |
| idle steer 是否开始执行，abort 是否撤回它 | idle 保持 true，队列保留；abort 后仍保留同一文本 |
| 输入钩子等待时 idle / abort 是否构成接纳完成屏障 | idle 为 true，abort 先返回，释放钩子后才收到 handled |
| open 缺失路径是否严格失败 | 返回带新 sessionId 的空上下文；证实不能直接映射公共 open |

这些探针没有覆盖模型流、扩展子 agent、网络断线、崩溃或真实工具副作用。不能据此宣布适配器已实现或完整兼容。

### 9.2 已执行：首版适配器验收

当前代码统一使用 Pi 1.3.0：桌面连接和普通 Pi 适配器使用 coding-agent / pi-ai 1.3.0，Durable 适配器使用 pi-durable / pi-ai / chord 1.3.0。现有 ultra 与 Google fetch 补丁已迁到 1.3.0。以上 1.2.0 原生探针仍保留其原始版本标注；本次 1.3.0 验证使用下面的适配器测试。

| 回归文件 | 已验证的行为 |
| --- | --- |
| [公共观察协议](../../../packages/agent-runtime/tests/observation.test.ts) | 慢消费者隔离、有界溢出后 gap + 快照、首帧快照、停止不等待已进入的消费者、异常及对象修改隔离、替换顺序、同步派发栈与重入顺序 |
| [Pi 基础适配器](../../../packages/agent-runtime-pi/tests/runtime.test.ts) | 多访问者共享内容身份、流式输出与 release 隔离；原生忙时拒绝、命令 preflight 与 follow-up 入队；错误原生身份拒绝；文件正常关闭和重开。子会话、goal 与 Cherry AI SDK 集成在后续功能层验证。 |
| [Pi Durable 适配器](../../../packages/agent-runtime-pi-durable/tests/runtime.test.ts) | 原生实时视图与完成回执；忙时拒绝、原生去重、按会话撤回；接纳后状态读取失败仍保留回执；原生 owned child 独立观察；真实 SQLite 正常关闭和重开，观察/查询不恢复执行，显式 resume 后继续 |
| `src/main/ai/runtime/pi/aiSdk*.test.ts` | Cherry 模型桥、原生文件恢复、工具、压缩、goal、前后台子任务及结果交付；原生包单测保留在 `packages/agent-runtime-pi/tests/` |
| [校验范围选择](../../../scripts/__tests__/validationPlan.test.ts)、[CI 校验工作流](../../../scripts/__tests__/validationWorkflow.test.ts) | 新包纳入选择；公共包变化包含两个适配器的消费者检查 |

本地使用原生 Pi + AI SDK 离线模型，以及 Durable 自带 faux provider、MemoryStorage 和 Node SQLite。这里的“通过”只对应这些具体测试，不等于完整原生 SDK 测试套件、真实 provider 或 Electron 验收。

### 9.3 剩余边界

- **产品接入**：尚未迁移 AgentSessionRuntimeService、Lane、展示投影存储、IPC 或多窗口消费；父消息已结束后的真实 UI 展示需要应用层验收。
- **身份与覆盖**：Pi 使用当前运行来源的内容身份，重建及压缩明确重置映射；Durable 历史 entry 使用原生身份，实时预览到历史项尚不承诺无缝 `replaces`，发送 gap + 替换快照。不能把展示归档当作原生上下文重新导入。
- **恢复**：SQLite 测试是正常关闭与重开，尚未验证进程崩溃、工具外部副作用，以及多个 Conversation 同时恢复的真实工作负载；不保证 exactly-once 工具执行。
- **控制范围**：Pi 子会话目前由父扩展安排输入与结果交付，公共 child access 不直接 submit。Durable 采用原生 ordinary abort 范围，后台子树、queued write、原生任务孤立和恢复失败仍需要专项验收。
- **协议范围**：公共文本/推理协议没有覆盖图像；Pi 工具执行中间输出、Durable nested-tool 进度尚未投影。历史分页、精确 Execution 与 Interaction 均未进入首版。
- **输入边界**：完整的 SDK 升级探针、错误存储故障矩阵、Pi settled 重入的适配器级覆盖，以及宿主取消等待后的持久投递记录仍需后续验收；不根据 Promise 或 idle 猜测缺失事实。

“不支持 / 无法确认”可以是合法结果，但不能算作强保证验收通过。上述边界保留在各包 README 与契约中，不以测试数量替代保证说明。
