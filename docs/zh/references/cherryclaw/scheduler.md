# CherryClaw 调度器

CherryClaw 的调度器采用受 nanoclaw 启发的基于任务的轮询设计。数据库是唯一的状态源——无需在内存中维护定时器状态，应用重启后自动恢复。

## 架构

```
SchedulerService (单例, 轮询循环)
  startLoop()
    → 每 60s 执行一次 tick()
      → taskService.getDueTasks()
        → SELECT * FROM scheduled_tasks WHERE status='active' AND next_run <= now()
      → 对每个到期任务调用 runTask(task)  (fire-and-forget)

  runTask(task)
    1. 加载 agent 配置
    2. 读取心跳文件，拼接到任务提示词前面（可选）
    3. 根据 context_mode 查找或创建 session
    4. sessionMessageService.createSessionMessage({ persist: true })
    5. 排空 stream 等待 completion
    6. 记录运行日志到 task_run_logs
    7. computeNextRun() 计算下次运行时间
    8. 通过频道发送任务完成/失败通知（可选）

  stopLoop()
    → 清除定时器，abort 所有运行中的任务
```

## 调度类型

| 类型 | `schedule_value` 格式 | 说明 |
|---|---|---|
| `cron` | cron 表达式，如 `0 9 * * 1-5` | 标准 cron 调度（使用 cron-parser v5） |
| `interval` | 分钟数，如 `30` | 固定间隔执行 |
| `once` | ISO 8601 时间戳 | 一次性任务，执行后自动标记为 completed |

## 防漂移间隔计算

`computeNextRun()` 锚定到上一次的 `next_run` 时间戳，而非当前时间。如果错过了多个间隔（例如应用关闭期间），它会跳过已过期的间隔，直接计算下一个未来时间点：

```typescript
// 锚定到计划时间，防止累积漂移
let next = new Date(task.next_run).getTime() + intervalMs
while (next <= now) {
  next += intervalMs
}
```

这种方式确保了间隔调度不会因任务执行耗时或轮询延迟产生累积偏差。

## 上下文模式

每个任务可以配置 `context_mode`：

| 模式 | 行为 |
|---|---|
| `session` | 复用已有 session，保持多轮对话上下文 |
| `isolated` | 每次执行创建新 session，无历史上下文 |

当使用 `session` 模式时，`SessionMessageService` 会捕获 SDK 的 `session_id`（来自 `system/init` 消息）并持久化为 `agent_session_id`，下次运行时作为 `options.resume` 传入，实现跨执行的对话连续性。

## 心跳文件

如果 agent 配置了 `heartbeat_enabled: true`，调度器会在执行任务前读取心跳文件（默认路径由 `heartbeat_file` 配置指定）并作为前置上下文拼接到任务提示词中：

```
[Heartbeat]
{心跳文件内容}

[Task]
{任务提示词}
```

`HeartbeatReader` 内置路径遍历保护，确保心跳文件路径不会逃逸出工作区目录。

## 连续错误处理

调度器跟踪每个任务的连续错误次数。连续失败 3 次后，任务自动暂停（`status: 'paused'`）。错误计数在下一次成功运行时重置。此状态在内存中跟踪，不持久化。

## 任务完成通知

每次任务运行后，`notifyTaskResult()` 向所有启用了 `is_notify_receiver` 的频道发送状态消息：

```
[Task completed] 任务名称
Duration: 12s
```

或失败时：

```
[Task failed] 任务名称
Duration: 5s
Error: 错误信息
```

通知以 fire-and-forget 方式发送，不阻塞调度循环。

## 手动触发

除了自动调度，每个任务也可以通过 API 或 UI 手动触发：

- API: `POST /v1/agents/:agentId/tasks/:taskId/run`
- UI: 任务设置列表中的「运行」按钮

`runTaskNow()` 会验证任务是否存在、是否正在运行（重复运行返回 409），然后在后台触发执行。

## 向后兼容

`startScheduler(agent)` 和 `stopScheduler(agentId)` 保留为空操作（no-op）以兼容现有的 agent handler 代码。所有调度逻辑由轮询循环通过数据库状态驱动。

## 关键文件

| 文件 | 说明 |
|---|---|
| `src/main/services/agents/services/SchedulerService.ts` | 轮询调度器主逻辑 |
| `src/main/services/agents/services/TaskService.ts` | 任务 CRUD、getDueTasks、computeNextRun |
| `src/main/services/agents/database/schema/tasks.schema.ts` | scheduled_tasks + task_run_logs 表定义 |
| `resources/database/drizzle/0003_wise_meltdown.sql` | 数据库迁移脚本 |
