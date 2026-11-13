# Agent Note: 定时任务会话选择器

Status: proposed

[English](2026-11-13-scheduled-task-session-picker.md) | 中文

## Problem

开启 `reuseSession` 的定时任务会继续其首次执行时碰巧创建的会话，用户无法选择一个已有会话作为任务目标。要把任务迁移到另一个会话，只能先关闭保存再开启保存，既不易发现，也无法选定目标（issue #21190）。

当前代码：

- `TaskFormDialog.tsx` 把 `TaskSessionReuseField` 渲染为布尔开关，没有会话选择（`src/renderer/components/ScheduledTask/TaskFormDialog.tsx:402-413`、`:665`）。
- 续用的会话通过任务关联查找，而非存储的指针：`loadReusableSession` 调用 `agentSessionService.getByTaskScheduleId`（`src/main/ai/agents/runAgentTask.ts:84-92`）。`reuseSessionId` 由该关联派生（`src/main/data/services/AgentTaskService.ts:611-612`）。
- 已删除或归属变化的会话会被静默替换为新会话（"rebind a fresh one"）（`src/main/ai/agents/runAgentTask.ts:88-92`）。

## Proposal

### Scope

- `reuseSession` 开启时，任务表单显示会话选择器，列出所选 Agent 的已有会话。保存所选会话后，该会话与任务建立关联，下次执行将继续它。
- 选择会话时即显示现有的上下文增长警告，而不只是静态说明。
- 关闭 `reuseSession` 会清除绑定，与当前行为一致。
- 执行时若绑定的会话已不存在，执行直接失败：不创建新会话，运行记录为失败并给出原因，任务标记为降级。任务保持启用，用户可通过选择器重新绑定。
- 编辑任务时若未改动选择器，绑定的会话不会变化。

### Out of scope

- 从会话本身发起"在此会话中运行此任务"的入口。
- 任务行上的"重新绑定到会话…"操作（选择器已覆盖重新绑定）。
- 修改 `reuseSession` 布尔值的存储、调度器或会话生命周期规则。
- 修改定时消息的呈现方式（#15574），或会话与对话模型（#20635）。

### Binding rules

- 一个会话最多绑定到一个任务。选择已绑定到其他任务的会话会被拒绝，错误信息需指出该任务。
- 选择器只列出该任务所属 Agent 的会话。
- 被绑定的会话保留自身的工作区；任务的工作区来源仅在创建新会话时生效。

## Alternatives considered

- **保留布尔开关，并在任务详情行增加"重新绑定"操作。** 改动更小，但用户仍无法在表单中选择目标，重新绑定也不易发现。本 Spec 暂不采用，选择器覆盖相同场景。
- **从会话本身发起入口。** 对"接管已有会话"最自然，但会为同一绑定增加第二条写入路径。待选择器落地后再考虑。
- **绑定失效时静默新建会话（现行行为）。** 会在新位置重现同样的困惑：用户选定的会话被无提示替换。不采用。
- **在任务上存储 `reuseSessionId` 指针作为事实来源。** 会与现有的会话-任务关联重复，形成两个事实来源。不采用。

## Acceptance criteria

- AC1 — 开启续用时，表单列出所选 Agent 的会话；保存所选会话后，下次执行将继续该会话（verification: renderer, unit）
- AC2 — 选择已绑定到其他任务的会话时被拒绝，错误信息指出该任务（verification: unit）
- AC3 — 绑定的会话被删除后，执行失败：不创建会话，运行记录为失败并给出原因，任务标记为降级（verification: unit）
- AC4 — 编辑任务时未改动选择器，绑定的会话保持不变（verification: unit）
- AC5 — 选择会话时显示上下文增长警告（verification: renderer）
- AC6 — 关闭续用会清除绑定，下次执行创建新会话（verification: unit）

## Risks

- 把已删除绑定的行为从"重新绑定新会话"改为"失败"，会改变一条现有且有测试覆盖的路径（`runAgentTask.test.ts` 中的 "rebinds when the constrained relation no longer has a session"）。应有意识地更新这些测试，而不是让它们因偶然而保持通过。
- 对长期会话使用选择器，会增加警告所描述的上下文溢出风险；AC5 是缓解措施，而非对上下文大小的限制。
- "降级"需要具体的 UI 信号。实现层须在验证 AC3 前定义清楚。
