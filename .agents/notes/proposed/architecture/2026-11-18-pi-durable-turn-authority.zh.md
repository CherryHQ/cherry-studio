# Agent Note: 由 Pi Durable 拥有桌面端轮次生命周期

Status: proposed

[English](2026-11-18-pi-durable-turn-authority.md) | 中文

## 问题

Pi Durable 持久记录每条输入的生命周期，包括准入、放置、原生输入队列、结局（`completed`、`aborted`、`failed`，或带原因的 `unanswered`）、用户停止记录以及重新打开后的恢复。[运行时契约](2026-10-17-agent-runtime-contract.md)已经把终局结局视为由宿主消费的原生证据，[Durable 适配器](../../../../packages/agent-runtime-pi-durable/README.md)也没有实现第二套调度器或队列。

桌面宿主没有遵循这一职责划分。`pi-durable` 与 Claude Code、非 durable 的 Pi 走同一个 `AgentRuntimeConnection` 和每轮一条的流，而后两者的执行会随 Main 一起结束。对这些运行时来说，[AgentSessionRuntimeService](../../../../src/main/ai/agentSession/AgentSessionRuntimeService.ts) 里的内存状态机是一轮对话唯一的记录。对 `pi-durable` 来说，同一个状态机压在一个持久的权威之上，并在易失的内存里重新决定以下事项：

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

## 提案

### 权责划分

| 事实 | `pi-durable` 的所有者 | 宿主的角色 |
| --- | --- | --- |
| 输入准入、放置与队列 | Durable submission | 以原生忙碌策略提交；为展示镜像放置结果 |
| 轮次结局 | Durable 输入结局 | 只映射一次为产品状态 |
| Stop | Durable 用户停止记录 | 发起请求；不靠关闭连接来实现 |
| 执行生命周期 | Durable 后端 owner | 只在显式退役或应用退出时释放 |
| 回复内容 | Durable 已提交的 entry | 投影为可重建的产品消息行 |
| 向 Renderer 的流式投递 | 宿主内存 | 持有流控制器、缓冲区和连接句柄 |

对 `pi-durable`，内存状态机只保留易失的投递状态。Claude Code 和非 durable 的 Pi 仍以现有状态机为权威，本 note 不改变它们。

### 结局

连接中只有一个映射，把 Durable 的输入结局转换为产品的终局状态：

- `completed` → `success`
- `aborted` → `paused`
- `failed` → `error`，携带原生错误
- `unanswered` → `error`，携带其原因；`output-truncated` 保留输出上限分类

这个映射不取决于宿主是否正在关闭。回复一旦以终局状态落库，之后任何宿主清理路径都不会再为它写入另一个终局状态。

### Stop

Stop 只请求 Durable 的用户停止，不再对执行做其他操作。Durable 会先写入停止记录，再中止前台作用域；这条记录在重启后仍然有效，重复请求也不会产生副作用。为保持当前的产品行为，Stop 还会通过子任务停止操作，停止每个正在运行的后台子任务。让后台子任务继续运行的方案列在替代方案中。

连接和后端保持打开，因此下一条消息既不需要重新打开后端，也不需要重新加载历史。

### 连接故障

观察出现缺口，或子会话观察失败时，从新的原生快照重新同步投影，而不是关闭访问。只有以下情况才会释放访问：

- 原生关闭；
- 显式退役，例如删除会话、归档，或需要新原生上下文的编辑；
- 应用退出。

配置重建仍和现在一样，等待连接空闲后再进行。

### 准入

轮次运行期间发送的消息，以 `steer` 或 `follow-up` 提交给 Durable，由 Durable 立即持久化。对 `pi-durable`，宿主移除本地的 `sending` 闸门和自己的队列。排队输入的回复行，在 Durable 放置该输入时，通过输入的回答关联来绑定。

### 恢复

产品消息行是 Durable 记录的投影。重新打开时，宿主读取已绑定上下文的 Durable submission：

- 恢复执行的输入，通过原始用户消息上的原生输入 ID 挂回该消息，其输出继续写入这条消息的回复。
- 从未完成终局落库的回复，从 Durable 已提交的 entry 获取 parts，从 Durable 结局获取状态。

启动恢复在没有 Durable 结局时，不会把 `pi-durable` 的回复标记为 `error`。

### 交付

实现遵循 Spec 优先的栈：

1. 结局映射（AC1）。
2. Stop 不关闭连接，故障时重新同步（AC2、AC3）。
3. 恢复与重建（AC5、AC6）。
4. 原生准入（AC4）。
5. Electron 验收并转为 implemented（AC7）。

## 已考虑的替代方案

- **修正标志的时序。** 在 interrupt 之前置位 `closing`，并让 `closeEntry` 不再覆盖已结算的状态。这能修复 #24732，但仍保留两个权威：每新增一个标志都可能重现同类 bug，重启后这一轮依然丢失。
- **为所有运行时持久化宿主轮次表。** 一条包含状态、失败原因和原生引用的逐轮记录，对 Claude Code 和 Pi 也有帮助。但对 `pi-durable`，Durable 的 submission 已经就是这份记录，再存一份会重新引入双写。该表仍可作为非 durable 运行时的候选方案。
- **Stop 时仍然关闭，但在关停前 flush。** 这能消除归档丢失，但消除不了未完成任务导致的卡住，也消除不了每次 Stop 之后的历史重新加载。
- **Stop 时让后台子任务继续运行。** 这与 Durable 原生的中止作用域一致，也能让委派的工作完成，但改变了 Stop 目前对用户的效果。每个后台任务仍可单独停止。本 note 不采用该方案，可作为产品决策再议。

## 验收标准

- AC1 — `pi-durable` 回复落库的状态始终等于 Durable 输入结局的映射（completed→success，aborted→paused，failed 或 unanswered→带原因的 error）；Durable 在连接关闭之前报告的停止保持为 `paused`，且没有任何宿主清理路径会替换已落库的终局状态。 (verification: unit — 基于真实 Durable 运行时与 SQLite 的连接测试，以及宿主状态机测试)
- AC2 — Stop 记录 Durable 的用户停止，结束前台轮次和正在运行的后台子任务，同时保持连接和后端打开；下一条消息无需重新打开后端即可开始。 (verification: unit — 真实运行时连接测试)
- AC3 — 观察缺口或子会话观察失败既不会关闭 Durable 访问，也不会结束本轮；投影会重新同步，本轮的状态仍来自 Durable。 (verification: unit — 注入观察故障的真实运行时测试)
- AC4 — 轮次运行期间发送的消息按原生忙碌策略被 Durable 接受，并且在崩溃后仍然保留；不可能再出现 "Durable already has an active submission" 错误，每条排队输入都有自己的回复。 (verification: unit — 真实运行时；Electron)
- AC5 — 非正常退出后重新打开时，恢复执行的 Durable 输入挂回其原始用户消息，输出继续写入这条消息的回复，而不是新的自主回复。 (verification: unit — 真实运行时重新打开测试)
- AC6 — 重新打开时，从未完成终局落库的回复会从 Durable 已提交的 entry 重建，并带上 Durable 结局；启动恢复不会给没有 Durable 结局的 `pi-durable` 回复设置 `error`。 (verification: unit — 数据库与运行时)
- AC7 — 在 Electron 中，对真实的 `pi-durable` 会话执行 Stop 后重发、steer、排队 follow-up，以及在一轮中途杀掉 Main，每种情况都显示 Durable 结局并保留子任务内容，不出现合成的未知错误卡片。 (verification: Electron)

## 风险

- **常驻内存。** Stop 后保持后端打开会让其内存常驻。后端在空闲时本来就会保留，因此这项改动消除的是重新打开的成本，并没有增加常驻。
- **共享调度器。** 原生 `submit` 和 `interrupt` 可能恢复整个 Harness，包括其他会话。Stop 不再与关停配对，因此需要在共享后端上测试隐藏的调度器副作用。
- **改写消息行。** 重新打开时重建回复，会改写本次改动之前被错误存储的产品消息行的状态和 parts。改写以 Durable 的记录为准，没有 Durable 结局的行保持不变。
- **回复出现时机。** 把准入移到原生队列后，排队消息的回复行出现的时机会变化，Renderer 必须能容忍一条暂时还没有回复行的用户消息。
- **宿主侧停止子任务。** 停止后台子任务是由宿主实现的产品规则。如果 Durable 以后提供带作用域的停止，宿主应改用它。
