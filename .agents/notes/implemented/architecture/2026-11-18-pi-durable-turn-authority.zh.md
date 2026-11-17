# Agent Note: 由 Pi Durable 拥有桌面端轮次生命周期

Status: implemented

[English](2026-11-18-pi-durable-turn-authority.md) | 中文

## 问题

Pi Durable 持久记录每条输入的生命周期，包括准入、放置、原生输入队列、结局（`completed`、`aborted`、`failed`，或带原因的 `unanswered`）、用户停止记录以及重新打开后的恢复。[运行时契约](../../proposed/architecture/2026-10-17-agent-runtime-contract.md)已经把终局结局视为由宿主消费的原生证据，[Durable 适配器](../../../../packages/agent-runtime-pi-durable/README.md)也没有实现第二套调度器或队列。

桌面宿主过去没有遵循这一职责划分。`pi-durable` 与 Claude Code、非 durable 的 Pi 走同一个 `AgentRuntimeConnection` 和每轮一条的流，而后两者的执行会随 Main 一起结束。对这些运行时来说，[AgentSessionRuntimeService](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) 里的内存状态机是一轮对话唯一的记录。对 `pi-durable` 来说，同一个状态机压在一个持久的权威之上，并在易失的内存里重新决定以下事项：

- **一轮如何结束。** [PiDurableRuntimeConnection](../../../../src/main/ai/runtime/piDurable/PiDurableRuntimeConnection.ts) 把 `completed` 以外的所有结局都报告为失败，除非本地的 `closing` 标志恰好已经置位。随后 `closeEntry` 让这个错误优先于已经落库的状态。
- **输入能否开始。** 本地 `sending` 标志置位期间，`send()` 会拒绝输入，宿主还另外维护了自己的队列。
- **执行何时停止。** Stop 会关闭连接；当这个连接是后端的最后一个使用者时，关闭会顺带关停后端。任何观察错误也会关闭连接。
- **恢复的工作属于哪一轮。** 重启后，恢复执行的输入会被当作一轮自主轮次。

来自一个 `pi-durable` 会话的证据：

- 所有 5 条状态为 `error` 的助手消息行，对应的输入在 Durable 里都记录为 `unanswered` / `aborted`。
- 其中 2 条消息行没有任何 parts，而 Durable 为它们保存了已提交的 entry。

一次本地实测中：

- Stop 在关停期间一直等待卡住的图片读取。
- 子会话归档的 flush 因 closed 被拒绝。
- 关闭在 20 秒后失败。

跟踪 issue 是 [#24748](https://github.com/CherryHQ/cherry-studio/issues/24748)；已报告的症状见 [#24732](https://github.com/CherryHQ/cherry-studio/issues/24732) 和 [#24469](https://github.com/CherryHQ/cherry-studio/issues/24469)。

## 决策

### 权责划分

| 事实 | `pi-durable` 的所有者 | 宿主的角色 |
| --- | --- | --- |
| 输入准入、放置与队列 | Durable submission | 以原生忙碌策略提交；为展示镜像放置结果 |
| 轮次结局 | Durable 输入结局 | 只映射一次为产品状态 |
| Stop | Durable 用户停止记录 | 发起请求；不靠关闭连接来实现 |
| 执行生命周期 | Durable 后端 owner | 只在原生关闭、显式退役或应用退出时释放 |
| 回复内容 | Durable 已提交的 entry | 投影为可重建的产品消息行 |
| 向 Renderer 的流式投递 | 宿主内存 | 持有流控制器、缓冲区和连接句柄 |

对 `pi-durable`，内存状态机只保留易失的投递状态。Claude Code 和非 durable 的 Pi 仍以该状态机为权威。

### 结局

连接把 Durable 的输入结局映射为产品的终局状态：

- `completed` → `success`
- `aborted` → `paused`
- `failed` → `error`，携带原生错误
- `unanswered` → `error`，携带其原因；`output-truncated` 保留输出上限分类

这个映射不取决于宿主是否正在关闭。对没有存活轮次来结算的回复，Main 使用同一映射：被停止的回复，以及重新打开时重建的回复。回复一旦以终局状态落库，之后任何宿主清理路径都不会再为它写入另一个终局状态。

### Stop

Stop 调用连接的 `interrupt()`。Durable 先写入停止记录，再中止前台作用域；正在运行的后台子任务通过子任务停止操作停止。Stop 还会撤回排队中的 follow-up，它们以 `aborted` 结束。连接和后端保持打开；Stop 之后发送的输入会等待 `stop-confirmed`，然后复用同一个访问。未被确认的停止在 20 秒后回退为关闭。

如果 Durable 在停止生效前已经完成或失败了这条输入，Main 用该结局替换 paused 回复。Main 从结局事件取得它；若事件在 Stop 登记之前就已到达，则从 Durable 的输入记录读取。

### 连接故障

观察出现缺口后，Durable 会发送恢复快照，连接继续应用它。子会话投影写入失败时，从新的原生快照重新挂载该子会话。后端错误钩子只承载诊断信息：它只记录日志，既不结束轮次，也不关闭任何根会话。配置重建仍会等待连接空闲。

### 准入

轮次运行期间发送的消息会提交给 Durable 并立即持久化：

- 忙碌时按 Enter 发送原生 follow-up（`whenBusy: 'follow-up'`）。运行时能力 `nativeFollowUp` 让输入框立即发送，而不是放进 follow-up 停靠区。
- steer 快捷键发送 steer（`whenBusy: 'steer'`），由 Durable 在下一次模型调用前放置。

原生工作运行期间，连接接受这些发送；只有在压缩期间才拒绝输入。Durable 放置排队输入时，Main 为它打开回复，因此每条排队输入都有自己的回复。Main 自己的队列只保存被 Durable 拒绝的输入，或在没有原生工作运行时到达的输入。

### 恢复

产品消息行是 Durable 记录的投影。重新打开时：

- 恢复执行的输入，通过原始用户消息上的原生输入 ID 挂回该消息，其输出继续写入这条消息的回复。
- 从未完成终局落库的回复，从 Durable 已提交的 entry 获取 parts，从 Durable 结局获取状态。

启动恢复在没有 Durable 结局时，不会把 `pi-durable` 的回复标记为 `error`；已被准入的投递轮次保持 pending，留给运行时恢复。

### 交付

该决策以 Spec 优先的栈交付：

1. 结局映射（AC1）：[#24760](https://github.com/CherryHQ/cherry-studio/pull/24760)。
2. Stop 不关闭连接，子会话故障后重新同步（AC2、AC3）：[#24766](https://github.com/CherryHQ/cherry-studio/pull/24766)。
3. 恢复与重建（AC5、AC6）：[#24774](https://github.com/CherryHQ/cherry-studio/pull/24774)。
4. 原生准入（AC4）：[#24777](https://github.com/CherryHQ/cherry-studio/pull/24777)。
5. AC1 与 AC3 的剩余路径、Electron 验收以及本次转换（AC7）。

## 已考虑的替代方案

- **修正标志的时序。** 在 interrupt 之前置位 `closing`，并让 `closeEntry` 不再覆盖已结算的状态。这能修复 #24732，但仍保留两个权威：每新增一个标志都可能重现同类 bug，重启后这一轮依然丢失。
- **为所有运行时持久化宿主轮次表。** 一条包含状态、失败原因和原生引用的逐轮记录，对 Claude Code 和 Pi 也有帮助。但对 `pi-durable`，Durable 的 submission 已经就是这份记录，再存一份会重新引入双写。该表仍可作为非 durable 运行时的候选方案。
- **Stop 时仍然关闭，但在关停前 flush。** 这能消除归档丢失，但消除不了未完成任务导致的卡住，也消除不了每次 Stop 之后的历史重新加载。
- **Stop 时让后台子任务继续运行。** 这与 Durable 原生的中止作用域一致，也能让委派的工作完成，但改变了 Stop 对用户的效果。每个后台任务仍可单独停止。可作为产品决策再议。

## 影响

- 轮次运行期间发给 `pi-durable` 的消息在运行前就已保存，崩溃后仍然保留，并有自己的回复。`pi-durable` 不使用 follow-up 停靠区；Claude Code 和 Pi 继续使用。
- Stop 后后端及其历史保持加载，下一条消息不会重新打开后端。Stop 后后端保持常驻，与此前空闲时一样。
- 重新打开会按 Durable 的记录，改写本次改动之前被错误存储的消息行的状态和 parts。没有 Durable 结局的行保持不变。
- 原生 `submit` 和 `interrupt` 可能恢复整个共享 Harness，而 Stop 不再与关停配对。
- 停止后台子任务仍是宿主规则。如果 Durable 提供带作用域的停止，宿主应改用它。
- 应用根会话观察批次时抛出的异常仍会让本轮失败并关闭访问；这条路径没有重新同步。
- 在模型请求或审批仍在等待时，Electron 应用在退出 30 秒后仍未退出，本次改动前后都是如此。本决策不涉及应用退出。
- 没有自动化测试覆盖非 Cherry 发起的中止，真实模型提供商也未验证；Electron 验收使用本地模拟提供商。

## 验证

- AC1 — `PiDurableRuntimeConnection.test.ts` › "reports a stop that Durable records before close as a paused turn, not a failure"、"preserves output truncation through the desktop error boundary" 与 "keeps the turn and the access when the Durable backend reports a diagnostic"；`AgentSessionRuntimeService.projection.test.ts` › "keeps a stopped reply paused when the runtime reports the abort before closing"、"replaces a paused reply with the Durable outcome reported before/after Stop registers" 与 "settles an unfinished reply from its Durable $outcome outcome on reopen"。
- AC2 — `PiDurableRuntimeConnection.test.ts` › "keeps the access open after Stop, ends running background children and answers the next message"；`AgentSessionRuntimeService.projection.test.ts` › "keeps a retained connection open on Stop and starts later input only after native confirmation"；Electron 的 Stop 场景会回答下一条消息。
- AC3 — 基于真实运行时的 `PiDurableRuntimeConnection.test.ts`："resynchronizes a failed child projection without closing the root access" 注入一次子会话写入故障，"resynchronizes the root projection after an observation overflow without ending the turn" 通过阻塞消费者产生 Durable 的溢出缺口，"keeps the turn and the access when the Durable backend reports a diagnostic" 在轮次中途触发后端错误钩子。
- AC4 — `PiDurableRuntimeConnection.test.ts` 中的原生 follow-up 测试（排在前一条回答之后放置、原生工作运行时发送、Stop 撤回、重新打开后回答）；`agentSessionRuntimeState.test.ts` 的放置转换；`AgentSessionRuntimeService.projection.test.ts` › "gives a Durable input $label its own reply when placed"；`AgentComposer.test.tsx` 的忙碌时 Enter；Electron 的排队 follow-up 与杀进程场景。
- AC5 — `PiDurableRuntimeConnection.test.ts` › "names the placed input that reopening resumes"；`AgentSessionRuntimeService.projection.test.ts` › "continues a resumed Durable input in its original reply"；在 Electron 杀进程场景中，被中断的输入在其原始回复中完成。
- AC6 — `AgentSessionRuntimeService.projection.test.ts` › "settles an unfinished reply from its Durable $outcome outcome on reopen"；`recoverSessionDeliveries.test.ts` › "leaves an admitted Durable delivery turn for the runtime to resume"；Electron 杀进程场景结束时没有 error 消息行。
- AC7 — `tests/e2e/smoke/piDurableTurnAuthority.test.ts` 使用本地模拟提供商：排队 follow-up、steer、Stop 后发送新消息，以及在一轮中途对 Main 执行 SIGKILL，每种情况都落库 Durable 结局，没有 error 消息行或 error part；Stop 与杀进程场景会在子任务面板中显示子会话记录。在栈的基线上，排队、Stop 与杀进程场景会失败。
