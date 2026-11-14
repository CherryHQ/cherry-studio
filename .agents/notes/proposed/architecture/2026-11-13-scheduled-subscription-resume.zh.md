# Agent Note: 定时订阅恢复与延后

Status: proposed

[English](2026-11-13-scheduled-subscription-resume.md) | 中文

## Problem

Issue #23914 要求额度恢复后的续发由显式注册的定时任务触发，而不是由待发队列持有恢复计时器或读取额度快照，也不能把本地缓存中的"额度已恢复"当作提交授权。`resume` 与 `snooze` 的业务语义尚未定义。`SchedulerService.resume/pause` 只对 cron 生效，无法恢复 once 触发器。

## Proposal

- 归属：主进程的 `CherryCloudService` 持有待恢复意图、目标操作与定时任务。渲染进程只发送命令。`useFollowupQueue.ts` 与 `useConversationTurnController.ts` 不感知额度、计时器或 `snooze`。
- 持久化：无。恢复计时器使用 `SchedulerService.registerSchedule(id, { kind: 'once', at }, callback)`。待恢复意图只在内存中，重启后不恢复。错过的触发（到期时应用已关闭）直接丢弃，由用户手动恢复。
- 调度 ID：带命名空间，`cherryCloud.quotaResume:<operationId>`，避免与 `docs/dev/references/job-and-scheduler/scheduler-usage.md` 中保留的 `schedule:`、`job:`、`retry:` 前缀冲突。
- `snooze`：先 `unregister(id)`，再 `registerSchedule(id, { kind: 'once', at: newAt })`。once 触发器不使用 `pause`/`resume`。
- 取消：`unregister(id)`，且幂等。
- 到期校验：回调重新检查注册时捕获的账号代际、会话与目标操作，不一致则丢弃。条件尚未满足时由归属方决定 `snooze` 或结束，不做无界轮询。
- 并发：操作令牌门控提交，定时触发与手动恢复不会同时提交。迟到的回调或结果不能覆盖更新的 `snooze` 或取消。
- 生命周期：注册与清理归属 Cloud 服务的生命周期。登出、切换账号、取消或会话失效时注销该 ID。`SchedulerService` 停止时也会自动清理。
- 提交：未被接收的提交保留为草稿；已接收的提交走现有会话重试流程。任何输入都不会被重复提交。

## Alternatives considered

- JobManager 持久化任务：本范围内否决。它需要持久化调度行与补偿规则，而"丢弃错过触发、不持久化"的决定并不需要这些。
- 对 once 触发器使用 `pause`/`resume`：否决。`SchedulerService` 对 once 与 interval 调度均为 no-op。
- 由队列持有计时器并读取额度快照：否决。它会把提交耦合到缓存的建议上，并与生态收敛说明中已否决的方案重复。
- 轮询直到额度恢复：否决，因为它是无界的。

## Acceptance criteria

- AC1 — 定时恢复在到期时只触发一次，且仅当捕获的账号代际、会话与操作仍一致时才提交。(verification: unit; owner: main Cloud)
- AC2 — `snooze` 替换待触发的 once 任务；被取代或迟到的回调不会提交，也不会覆盖更新的决定。(verification: unit; owner: main Cloud)
- AC3 — 取消、登出、切换账号和会话失效都会注销该 ID，使过期账号或会话不会被恢复。(verification: unit; owner: main Cloud)
- AC4 — 手动恢复与定时触发竞争时，最多提交一次。(verification: unit; owner: main Cloud)
- AC5 — 待发队列与提交控制器中不包含额度、计时器或 `snooze` 逻辑。(verification: docs gate and dependency scan; owner: renderer conversation)
- AC6 — 重启后错过的触发被丢弃，不恢复任何计时器。(verification: unit; owner: main Cloud)

## Risks

- 若应用在到期时关闭，恢复提示将不会触发，用户需要手动恢复。
- 两个未合并的 PR（#18684 与 #21146）修改 `SchedulerService.ts`，多个 PR 修改队列与控制器。实现应等待它们合并或被放弃。
- 当前没有可用的线上后端环境。额度的服务端判定在请求时仍具有决定权。
