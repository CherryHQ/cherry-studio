# Agent Note: 从历史读取审批答复

Status: implemented

[English](2026-11-18-behavior-approval-history.md) | 中文

## 问题

带后台子智能体的 Pi Durable 长会话每一轮都比上一轮更慢。在一次回放用户上报会话的 10 轮测试中（每轮四个子智能体，本地模拟模型），每轮耗时从 12.0 秒涨到 18.6 秒；第 9、10 轮主进程忙碌的 34.6 秒里，有 23.8 秒在 agent-behavior 的 `outcomesFor` 之下。

每次决策之前，以及每个涉及子智能体的步骤之后，包都会向宿主要审批结局：会话自己一次，它有过的每个子会话各一次。每次 `Approvals.outcomes` 调用都会执行 `listApprovalMessages`，即对整个会话的消息做一次同步的 `json_each` 扫描。于是每次决策都按线程数阻塞事件循环，耗时随历史长度和子会话数量一起增长。

这次读取之所以存在，是因为一个人的答复有两处存放：会话消息里的审批卡片，以及会话自身历史里该调用被拦下的结果。规则读的是宿主必须去搜索的那一份；读子会话的调用，也只是为了把子会话显示成 `awaiting_approval`。

## 决策

规则只从会话自身的历史读取人的答复。被拒绝或无人可批的审批，本来就以该调用被拦下的结果结束：

- `Approvals` 只保留 `facts` 和 `ask`；删除 `outcomes`、`ApprovalOutcome` 和 `CallInputs.approvals`，`gatherInputs` 只读取时钟和设置。
- 每个适配器都把闸门拦下调用时给出的原因，投影为 `tool-result` 条目上的 `blocked`。Durable 从结果里结构化的 `blocked` 诊断读取；coding-agent 和 fake 从它们自己写下的 `Tool call blocked: ` 前缀读取。
- goal 轮中若有结果因 `deniedReason(...)` 被拦下，该轮以 `approval_denied` 停止；若因 `NOBODY_TO_APPROVE` 被拦下，则以 `awaiting_approval` 停止。
- 父会话不读取子会话调用的任何信息。`SubagentView.status` 只有 `running` 和 `finished`，面向模型的子智能体列表对所有仍在运行的子会话都写 `running`。

会话消息里的审批卡片仍是人看到并作答的记录，只是行为规则不再读取它。工具闸门的 harness 契约用例要求每个适配器都给出 `blocked`，投影漏掉它就会在那里失败。

## 考虑过的替代方案

- 把各子会话的读取合并成一次查询，或加缓存：仍是随历史增长的全会话扫描，也仍然为历史已记录的事实保留第二个来源。
- 单独建审批表，或给消息 part 建索引：为调用结果里已有的事实再加一个存储。
- 通过闸门的 `after` 钩子给结果打标记：coding-agent 不会对被拦下的调用执行 `after`，因为这类结果由 pi-agent-core 自己构造，标记恰好会在最需要的地方缺失。
- 在核心里匹配拦截文本：Durable 把原因包在它的 `<harness>` 诊断里，coding-agent 则原样保存，核心就得解析每个 harness 的格式。

## 后果

- 父模型不再得知某个仍在运行的子会话正在等审批：未知 id 列表和压缩后写入的状态都显示 `running`。人仍会在父会话里看到并回应子会话的请求，无人值守的运行会直接拦下调用而不是等待。本决策取代 [Pi 后台子智能体](../../proposed/feature/2026-10-14-agent-runtime-background-subagent.md) 中的 `awaiting_approval` 状态，以及 [共享 agent 行为包](../../proposed/architecture/2026-10-18-agent-behavior-package.md) 中的审批结局。
- 宿主不再为规则保存审批结局。`listApprovalMessages` 只剩远程访问在请求时读取。
- fake harness 只恢复被崩溃截断的运行；会话重开期间送来的输入会启动它自己的运行。每次决策的 await 点减少后，fake 中的这个竞态才暴露出来。
- 不在本次范围：Durable 空闲上下文的保留时长（`contextRetentionMs`），以及在人作答时、而不是在该轮投影落定时，把流式呈现的答复写入数据库。

## 验证

- Regression — goalHistory.test.ts：结果因拒绝或 `NOBODY_TO_APPROVE` 被拦下时该轮停止；文本相同但没有 `blocked`、或因其他原因被拦下时不停止。
- Regression — idle.test.ts：被拦下的拒绝在 goal 轮内停止 goal，在人发出消息之后不停止。
- Regression — harness 契约用例「tools run under a stable call key; the gate blocks, rewrites and replaces」在 fake、coding-agent 和 Pi Durable 上都要求 `blocked` 等于闸门给出的原因。
- Regression — 加上本改动后同样回放 10 轮：第一轮之后每轮耗时稳定在 4.2–5.0 秒（第一轮 7.2 秒），第 9、10 轮主进程只忙碌 7.9 秒，其中没有 `outcomesFor`。
- Regression — agent-behavior 全部 37 个测试文件、agent-runtime-pi 的行为测试、agent-runtime-pi-durable 的契约/harness/fold 测试，以及 Main 的 Pi 与 Durable 宿主测试均通过。
