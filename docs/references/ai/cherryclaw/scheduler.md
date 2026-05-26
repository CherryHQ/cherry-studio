# CherryClaw Scheduling

CherryClaw does not have its own scheduler. Scheduled prompts run on the generic `JobManager` infrastructure via the `agent.task` job type. The database is the single source of truth — schedules live in `job_schedule`, fires live in `job`, and the circuit breaker reads jobs back instead of holding in-memory counters.

## Architecture

```
src/main/ai/agents/
  AgentJobsService.ts        — @Injectable lifecycle service (WhenReady)
    onInit:
      jobManager.registerHandler('agent.task', AgentTaskJobHandler)
      ipcHandle(Ai_Agent_RunTask, (taskId) => jobManager.triggerJobScheduleNowById(taskId))

  AgentTaskJobHandler.ts     — thin handler metadata
    recovery:             'retry'                     // non-terminal jobs re-pend on app restart
    defaultQueue:         input => `agent:${input.agentId}`  // per-agent serialization
    defaultConcurrency:   1                            // one task at a time per agent
    defaultRetryPolicy:   { maxAttempts: 1 }           // no in-handler retries
    execute(ctx):         runAgentTask(ctx)
    onSettled(event):     circuit breaker — see below

  runAgentTask.ts            — business logic (fresh session, stream, optional heartbeat composition)
```

`JobManager` (`src/main/core/job/`) owns dispatch, queue ordering, retry/backoff, and schedule advancement. CherryClaw contributes the handler only.

## Schedule storage

| Table | Role |
|---|---|
| `job_schedule` | One row per scheduled task: `type='agent.task'`, `trigger`, `jobInputTemplate`, `enabled`, `nextRun`, `lastRun`, `catchUpPolicy` |
| `job` | One row per fire: `scheduleId`, `status`, `scheduledAt`, `startedAt`, `finishedAt`, `attempt`, `input`, `output`, `error` |
| `agent_channel_task` | Many-to-many join `(channel_id, task_id)` — channels subscribed to a schedule's output (FK → `job_schedule.id`) |

The earlier draft `agent_task` / `agent_task_run_log` tables were dropped in `migrations/sqlite-drizzle/0027_mean_orphan.sql` when the JobManager backend took over. `scheduled_tasks` and `task_run_logs` never landed in v2.

## Trigger types

`Trigger` (from `@shared/data/api/schemas/jobs`) — what the schedule stores:

| Kind | Shape | Source |
|---|---|---|
| `cron` | `{ kind: 'cron', expr: '0 9 * * 1-5' }` | `cron` param of `mcp__claw__cron add` |
| `interval` | `{ kind: 'interval', ms: <minutes> * 60_000 }` | `every: '30m'` etc, parsed by `parseDurationToMinutes` |
| `once` | `{ kind: 'once', at: <epoch-ms> }` | `at: '<RFC3339>'` |

`nextRun` is computed and stored by `JobManager` whenever a fire settles; the handler does not maintain its own next-time calculation.

## One fire — `runAgentTask`

```
runAgentTask(ctx):
  1. jobService.getById(ctx.jobId)
     → resolve scheduleId / scheduleSnapshot / taskName
  2. agentService.getAgent(agentId)            // throws if missing
  3. sessionService.createSession(...)         // fresh per fire (see below)
  4. Heartbeat composition (if taskName='heartbeat' + sentinel prompt):
       readHeartbeat(workspacePath)            // reads workspace/heartbeat.md, path-traversal guarded
       skip if heartbeat_enabled === false or no file/workspace
  5. agentChannelService.getSubscribedChannels(scheduleId)
     → build ChannelAdapterListener[] for live streaming to subscribed channels
  6. AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMinutes * 60_000)])
  7. startAgentSessionRun({ sessionId, userParts, listeners: [sentinel, ...channelListeners] })
     sentinel:
       onChunk(text-delta) → accumulatedText += c.text
       onDone              → resolve(accumulatedText)
       onPaused            → resolve OR reject if aborted
       onError(result)     → reject
       isAlive             → !runSignal.aborted
  8. Return { sessionId, result: accumulatedText.slice(0,200) }
     On failure: notifyTaskError(...) to all subscribed channels then rethrow
```

### Why each fire creates a fresh session

Scheduled tasks are discrete background invocations (heartbeat, periodic summary, polling), not conversations. Carrying session context across fires would stuff the model window with stale state. Persistent state belongs in workspace files (`heartbeat.md`, `memory/FACT.md`, journal). The session id is written to `job.output.sessionId` as an audit trail only — nothing reads it back for continuity.

### Heartbeat tasks

A schedule named `heartbeat` whose `prompt` is the sentinel `__heartbeat__` triggers the heartbeat composition path:

- If `agent.configuration.heartbeat_enabled === false` or no workspace, the fire returns `Skipped (disabled)` / `Skipped (no workspace)` and exits early.
- Otherwise `readHeartbeat(workspacePath)` reads `heartbeat.md` (filename is hard-coded in `src/main/ai/agents/cherryclaw/heartbeat.ts`; there is no `heartbeat_file` configuration). The contents are wrapped in a fixed preamble and used as the effective prompt.
- The heartbeat file path is resolved with `path.resolve` and rejected if it escapes the workspace directory.

## Circuit breaker — persisted, not in-memory

`AgentTaskJobHandler.onSettled` runs after every terminal job:

```ts
onSettled(event):
  if event.status !== 'failed' || !event.scheduleId: return
  recent = jobService.listRecentTerminalByScheduleId(event.scheduleId, 3)
  if recent.length < 3 or some non-failed: return
  jobManager.pauseJobScheduleById(event.scheduleId)
```

The check reads `jobTable` rows for the schedule (covered by the `job_schedule_id_finished_at_idx` index). The single source of truth is the database — there is no in-memory counter. The handler comment notes this explicitly: the legacy in-memory counter reset on every process restart, making the breaker effectively unreachable in practice.

## Recovery semantics

`recovery: 'retry'` re-pends every non-terminal `agent.task` job on app startup. This matches the legacy poll-loop intent: a fire that was missed because the app was closed gets picked up on the next dispatch tick rather than being silently dropped.

## Per-agent serialization

`defaultQueue: agent:${agentId}` + `defaultConcurrency: 1` means a single agent never has two scheduled fires running concurrently (Claude Code subprocess + workspace state would collide). Cross-agent parallelism is unaffected.

## Retry policy

`maxAttempts: 1`, `backoff: 'none'`. Failures escalate directly to `onSettled`; the breaker decides whether to pause. Re-running an LLM call automatically is rarely useful and can stack token spend with no diagnostic value.

## Manual triggering

- **Agent**: `mcp__claw__cron` does not have a "run now" action; the agent waits for the schedule.
- **Renderer / UI**: invokes the `Ai_Agent_RunTask` IPC channel, which calls `JobManager.triggerJobScheduleNowById(scheduleId)`.
- There is no HTTP `/v1/agents/:agentId/tasks/:taskId/run` endpoint.

## Autonomy gate

`AgentTaskService.assertAutonomous(agentId)` blocks task creation unless `configuration.soul_enabled === true` **or** `configuration.permission_mode === 'bypassPermissions'`. Without either, tool calls during the scheduled fire would hit permission prompts that have no one to answer them. The error surfaces as `DataApiErrorFactory.invalidOperation` to renderer callers and as an MCP error to the claw `cron add` tool.

## Key files

| File | Description |
|---|---|
| `src/main/ai/agents/AgentJobsService.ts` | Lifecycle service: handler registration + `Ai_Agent_RunTask` IPC |
| `src/main/ai/agents/AgentTaskJobHandler.ts` | Handler metadata + circuit breaker |
| `src/main/ai/agents/runAgentTask.ts` | One-fire business logic |
| `src/main/data/services/AgentTaskService.ts` | Facade over `jobScheduleService` + `JobManager` (autonomy gate lives here) |
| `src/main/data/db/schemas/job.ts` | `job_schedule` + `job` tables |
| `src/main/data/db/schemas/agentChannel.ts` | `agent_channel_task` join table |
| `src/main/ai/agents/cherryclaw/heartbeat.ts` | `readHeartbeat` (workspace/heartbeat.md, path-traversal guarded) |
| `migrations/sqlite-drizzle/0027_mean_orphan.sql` | Drops legacy `agent_task` / `agent_task_run_log` |
