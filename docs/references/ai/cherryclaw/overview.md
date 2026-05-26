# CherryClaw Architecture

<p align="center">
  <img src="../../../assets/images/cherryclaw.png" width="200" alt="CherryClaw" />
</p>

CherryClaw is **not a separate agent type**. It is the autonomous-agent feature surface of the regular Claude Agent SDK runtime, enabled per agent by the `soul_enabled` configuration flag. When that flag is on, the Claude Code settings builder injects the in-process `claw` MCP server, swaps a small set of SDK built-in tools for safer autonomous alternatives, and the generic `JobManager` schedules `agent.task` jobs for the agent.

There is no `CherryClawService`, no `AgentServiceRegistry`, and no service-level routing by agent type — everything is configuration on the same code path that runs every other claude-agent session.

## Where the code lives

```
src/main/ai/
  runtime/claudeCode/settingsBuilder.ts   — soul_enabled branch (MCP, allowedTools, disallowedTools, prompt)
  agents/
    AgentJobsService.ts                   — lifecycle service: registers 'agent.task' handler + Ai_Agent_RunTask IPC
    AgentTaskJobHandler.ts                — JobManager handler (queue, retry policy, circuit breaker)
    runAgentTask.ts                       — business logic for one task fire (session, stream, heartbeat)
    cherryclaw/
      prompt.ts                           — system-prompt builder (Soul / User / memory / skills sections)
      heartbeat.ts                        — workspace heartbeat.md reader (path-traversal guarded)
      seedWorkspace.ts                    — SOUL.md / USER.md templates + bootstrap instructions
  mcp/servers/
    claw.ts                               — built-in MCP server (cron / notify / config)
    skills.ts                             — standalone MCP server (search / install / list / author skills)
    workspaceMemory.ts                    — standalone MCP server (memory: update / append / search)
  channels/                               — IM adapter layer (separate concern, see channels.md)
```

`src/main/services/agents/` does not exist; references to it predate the JobManager-based refactor.

## Configuration flags

CherryClaw behavior is gated by fields on `agent.configuration` (`AgentConfiguration`):

| Field | Effect |
|---|---|
| `soul_enabled: true` | Inject `claw` MCP, apply `SOUL_MODE_DISALLOWED_TOOLS`, append `mcp__claw__*` to `allowedTools`, switch system prompt to Soul Mode |
| `heartbeat_enabled` | Gate the scheduled heartbeat task at run time |
| `bootstrap_completed` | When falsy, insert bootstrap instructions into the system prompt for first-time onboarding |
| `builtin_role` | Orthogonal — `'assistant'` is the Cherry Assistant variant and uses a different MCP server (`assistant`) |
| `permission_mode` | Scheduled tasks also accept `bypassPermissions` as the "autonomous" criterion (see `AgentTaskService.assertAutonomous`) |

## What `soul_enabled` actually changes

Inside `buildClaudeCodeSessionSettings` (`src/main/ai/runtime/claudeCode/settingsBuilder.ts`):

1. **MCP servers** (`buildMcpServers`) — inject `claw` as `{ type: 'sdk', name: 'claw', instance: clawServer.mcpServer }`. SDK auto-discovers `mcp__claw__cron`, `mcp__claw__notify`, `mcp__claw__config`.
2. **Disallowed tools** (`buildToolPermissions`) — union of `GLOBALLY_DISALLOWED_TOOLS` (`WebSearch`, `WebFetch`) and `SOUL_MODE_DISALLOWED_TOOLS`:

   | Disabled SDK tool | Why |
   |---|---|
   | `CronCreate` / `CronDelete` / `CronList` | Replaced by `mcp__claw__cron` (persisted via JobManager) |
   | `TodoWrite` | Not useful for unattended runs |
   | `AskUserQuestion` | Autonomous loop cannot block on user input |
   | `EnterPlanMode` / `ExitPlanMode` | Plan mode requires interactive turn |
   | `EnterWorktree` | Workspace lifecycle is owned by Cherry, not the agent |
   | `NotebookEdit` | Not part of the supported workspace surface |
3. **Allowed tools** (`adjustAllowedToolsForMcp`) — append `mcp__claw__*` wildcard so `canUseTool` accepts the injected claw tools.
4. **System prompt** (`buildSystemPrompt` → `PromptBuilder`) — assemble from workspace `SOUL.md` + `USER.md`, append CherryClaw tool guidance, skills guidance, memory guidance, and (when `bootstrap_completed` is falsy) the bootstrap instructions.

Standard claude-agent infrastructure (canUseTool / hooks / approval emitter / channel security prompt / etc.) is unchanged.

## Skills and memory MCPs

`skills` and `memory` are **separate** MCP servers, **not** part of the claw server:

- `src/main/ai/mcp/servers/skills.ts` — server name `skills`, single tool `skills` (search / install / remove / list / init / register). Tool surface: `mcp__skills__skills`.
- `src/main/ai/mcp/servers/workspaceMemory.ts` — server name `agent-memory`, single tool `memory` (update / append / search). Tool surface: `mcp__agent-memory__memory`.

They are surfaced via the agent's `mcps` list (per-agent MCP configuration), not auto-injected by `soul_enabled`. The PromptBuilder's `SKILLS_GUIDANCE` and `MEMORY_GUIDANCE` sections instruct the agent on how and when to use them.

## Memory model

CherryClaw uses a workspace-file memory layout (filenames are case-insensitive):

```
{workspace}/
  SOUL.md              — Who you are: personality, tone, principles, boundaries
  USER.md              — Who the user is: name, preferences, timezone, context
  memory/
    FACT.md            — Durable knowledge (6+ months horizon)
    JOURNAL.jsonl      — Append-only event log
  heartbeat.md         — (Optional) instructions injected by the periodic heartbeat task
```

- `SOUL.md` / `USER.md` — edited directly with the SDK Read / Edit tools.
- `FACT.md` / `JOURNAL.jsonl` — written through `mcp__agent-memory__memory` (atomic temp-file rename for FACT; JSONL append for journal).
- `heartbeat.md` — read by `readHeartbeat` (`src/main/ai/agents/cherryclaw/heartbeat.ts`) before each heartbeat fire; path-traversal guard prevents escaping the workspace directory.

`PromptBuilder` mtime-caches all workspace reads — each lookup runs a single `fs.stat`, returning cached content when unchanged, with no file watchers.

## Task scheduling (overview)

Scheduled prompts run on the generic `JobManager`:

- `AgentJobsService.onInit` registers the `agent.task` handler with `JobManager` and exposes `Ai_Agent_RunTask` as an IPC for manual triggers.
- `AgentTaskJobHandler` configures per-agent serialization (`agent:${agentId}` queue, concurrency 1), no in-handler retries, and a circuit breaker that pauses the schedule after three consecutive failed terminal jobs (reading `jobTable` directly — no in-memory counter).
- `runAgentTask` builds a fresh session per fire and streams through `startAgentSessionRun`.

The `mcp__claw__cron` tool is the agent-facing creator; it calls `agentTaskService` which delegates to `jobScheduleService` + `JobManager`. See [scheduler.md](./scheduler.md) for details.

## IM channels

The optional channels layer lives under `src/main/ai/channels/`. `ChannelManager` (a lifecycle service) maintains active adapter connections; `ChannelMessageHandler` (singleton) routes inbound IM messages into agent sessions. See [channels.md](./channels.md) and [mcp-claw.md](./mcp-claw.md) (the `config` tool action set covers channel CRUD).

## Database tables

CherryClaw does not have a dedicated table set. It reuses:

| Table | Purpose |
|---|---|
| `agent` (`agent_table`) | `configuration` JSON carries `soul_enabled`, `heartbeat_enabled`, `bootstrap_completed`, `permission_mode`, `builtin_role` |
| `agent_session` | One row per session (chat or scheduled task fire) |
| `agent_channel` | IM channel rows (type / config / agentId / sessionId / activeChatIds / permissionMode) |
| `agent_channel_task` | Many-to-many join: which channels receive a scheduled task's output |
| `job_schedule` | Trigger + jobInputTemplate for every scheduled task |
| `job` | Per-fire lifecycle row (pending → running → completed/failed/cancelled) |

Earlier drafts shipped dedicated `agent_task` and `agent_task_run_log` tables; both were removed in `migrations/sqlite-drizzle/0027_mean_orphan.sql` once the JobManager backend covered the use case.

## Triggering and inspecting tasks

- **Agent-side**: `mcp__claw__cron` actions `add` / `list` / `remove`.
- **Renderer-side**: DataApi handlers in `src/main/data/api/handlers/agents.ts` (CRUD for tasks; thin facade over `jobScheduleService` + `jobService` via `AgentTaskService`).
- **Manual fire**: `Ai_Agent_RunTask` IPC channel — invokes `JobManager.triggerJobScheduleNowById(scheduleId)`.

There are no `/v1/agents/:agentId/tasks` REST endpoints; the renderer goes through DataApi, the agent goes through the claw MCP, and external IPC clients use `Ai_Agent_RunTask`.
