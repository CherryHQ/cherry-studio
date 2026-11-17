# Agent Note: 每次任务写提交成功后都广播任务读模型变更

Status: implemented

[English](2026-10-28-agent-task-update-notify.md) | 中文

## Problem

`AgentJobsService.updateTask` 只在会话复用配置、粘性会话绑定被清除或工作区变化时发布 DataApi 读模型通知。纯改名、改提示词、改触发器、改超时或改渠道订阅都会改变持久化行及其投影（`name`、`prompt`、`trigger`、`nextRun` 都在 `ScheduledTaskEntity` 里），却不产生任何广播，违反了"漏发信号即收敛 bug"的发布不变量。Renderer 发起的编辑掩盖了这个缺口，因为 `useUpdateTask` 会在命令成功后显式失效读键；但 IM/MCP 的 manage-jobs 工具在主进程直接调用 `updateTask`，没有这层补偿，任何开着任务总览的窗口都会一直显示旧值，直到无关变更或重挂载。`pauseTask` 和 `resumeTask` 则从不广播，而 `enabled`/`status`/`nextRun` 都在投影里。

## Decision

`updateTask` 在写事务提交后无条件通知——`updateTx` 总是更新 `updatedAt`，不存在可证明的 no-op 写，多余通知的代价只是一次 refetch。`pauseTask` 在真实状态变更后通知；既有的守卫已保证重复暂停保持静默。`resumeTask` 在真实恢复后通知，且由于 `resumeJobScheduleById` 会先提交 `enabled=true` 再装定时器，arm 失败时按行状态分类：已提交的启用仍然广播，写入失败保持静默，原错误始终原样传播不被掩盖——分类读取是 best-effort，其失败只记日志。定时器重装语义、启动恢复和 JobManager 契约均不变。

## Alternatives considered

- 保留条件门控、改为字段级 diff（name/prompt/trigger/channelIds 是否变化）——纸面上更精确，但未来新增可编辑字段时容易重新引入同样的漂移，且发布契约本就把冗余 refetch 定价得低于漏发信号。
- 对 resume 调用套一层朴素的 `finally`——写入本身失败、什么都没提交时也会广播。
- 让 `JobManager.resumeJobScheduleById` 返回提交结果、调用方无需重读——属于 `core/job` 契约变更，按项目规则需单独 issue 和 PR；服务内分类在不触碰基础设施的前提下满足不变量。

## Consequences

每次成功的任务写入多一条读模型通知；失败的写入保持静默。若 enable 已提交且分类读取也失败（数据库不可用），该次通知漏发并记日志——该双层故障场景下与修复前的收敛能力相同，由下一次变更或重挂载自愈。arm 失败后行已启用但定时器未安装，等启动恢复或下次同步重建——JobManager 既有语义，未改变。

## Verification

- Regression — `src/main/ai/agents/__tests__/AgentJobsService.test.ts`：纯改名与真实暂停/恢复广播完整 effect 集；状态感知 no-op 保持静默；enable 已提交后的 arm 失败在传播原错误前广播，写入失败保持静默；分类读取失败保留原异常对象且不通知。
