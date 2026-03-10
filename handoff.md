# Handoff

## Goal

Implement CherryClaw — a new autonomous agent type for Cherry Studio with soul-driven personality, scheduler-based autonomous operation, heartbeat-driven task execution, and IM channel integration. Full implementation across all 4 phases from `.agents/sessions/2026-03-10-cherry-claw/plan.md`, plus a task-based scheduler redesign inspired by nanoclaw, plus an internal claw MCP server so the agent can autonomously manage its own scheduled tasks, plus a channel abstraction layer with Telegram as the first adapter.

## Progress

All 4 phases are complete, plus the scheduler redesign and claw MCP tool:

- **Phase 1**: Type system, config defaults, i18n keys — DONE
- **Phase 2**: Backend services (registry, soul, heartbeat, claw service, scheduler, lifecycle hooks) — DONE
- **Phase 3**: Frontend UI (creation modal, settings tabs, list differentiation) — DONE
- **Phase 4**: Unit tests (22 tests across 4 files) — DONE
- **Phase 5**: Scheduler redesign — tasks as first-class DB entities, poll-loop scheduler, task management UI — DONE
- **Phase 6**: Claw MCP server — internal `cron` tool auto-injected into CherryClaw sessions — DONE
- **Phase 7**: Channel abstraction layer + Telegram adapter + channel settings UI — DONE
- **Phase 8**: Channel streaming — `sendMessageDraft` for real-time response streaming, multi-turn accumulation, typing indicators — DONE
- **Phase 9**: Headless message persistence — channel and scheduler messages now persist to DB — DONE
- **Validation**: `pnpm lint`, `pnpm test`, `pnpm format` all pass (198 test files, 3588 tests)

## Key Decisions

- **AgentServiceRegistry pattern** — replaced hardcoded `ClaudeCodeService` in `SessionMessageService` with a registry mapping `AgentType` → `AgentServiceInterface`. CherryClaw delegates to claude-code at runtime via registry lookup.
- **Task-based scheduler (nanoclaw-inspired)** — replaced per-agent setTimeout chains with a single 60s poll loop that queries `scheduled_tasks WHERE status='active' AND next_run <= now()`. DB is the source of truth; no timer state to restore on restart.
- **Drift-resistant interval computation** — `computeNextRun()` anchors to the previous `next_run` timestamp and skips past missed intervals, preventing cumulative drift (ported from nanoclaw).
- **Tasks as first-class entities** — new `scheduled_tasks` and `task_run_logs` Drizzle tables with FK cascades to agents. Users can create/edit/pause/delete multiple tasks per agent via the UI.
- **cron-parser v5** — uses `CronExpressionParser.parse()` API (not the older `parseExpression`).
- **mtime-based cache for soul** — single `fs.stat` check per read, no persistent file watchers. Heartbeat reads fresh each tick.
- **Default emoji 🦞** — CherryClaw agents get lobster claw emoji as default avatar in the agent list.
- **Placeholder cherry-claw.png** — copied from claude.png; needs a proper distinct avatar image.
- **i18n strict nesting** — task keys use proper nested objects (e.g., `tasks.contextMode.session` not `tasks.contextMode.session` + `tasks.contextMode.session.desc`) to pass the i18n checker.
- **Internal claw MCP server (anna-inspired)** — single `cron` tool with `add`/`list`/`remove` actions, auto-injected into every CherryClaw session via `_internalMcpServers`. Uses the `@modelcontextprotocol/sdk` Server class, served over Streamable HTTP at `/v1/claw/:agentId/claw-mcp`. The tool maps anna-style inputs (`cron`, `every`, `at`, `session_mode`) to TaskService's schema (`schedule_type`, `schedule_value`, `context_mode`).
- **Disallowed builtin tools** — CherryClaw disables SDK builtin tools not suited for autonomous operation via `_disallowedTools`: `CronCreate`/`CronDelete`/`CronList` (replaced by claw MCP cron tool), `TodoWrite`, `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`, `EnterWorktree`, `NotebookEdit`. Mapped to `options.disallowedTools` in the SDK. Note: `disallowedTools` only affects tools, not skills — skills are invoked via the `Skill` tool and cannot be blocked this way.
- **Channel abstraction layer** — `ChannelAdapter` (abstract EventEmitter), `ChannelManager` (singleton lifecycle), `ChannelMessageHandler` (stateless message routing + stream collection). Adapters are registered via `registerAdapterFactory(type, factory)` and auto-created from agent config on startup. Future channels (Discord, Slack) plug in by implementing `ChannelAdapter` and registering a factory.
- **Stream response collection** — `text-delta` events from the transform layer are cumulative within a text block. `ChannelMessageHandler` tracks per-block text (`text = value.text`) and commits on `text-end` to accumulate across multi-turn agent responses. Drafts are streamed to the chat via `sendMessageDraft` (throttled at 500ms) while `sendTypingIndicator` runs every 4s throughout the request.
- **Channel config in agent settings** — stored in `CherryClawConfiguration.channels[]`. UI is a catalog of available channel types with inline config (enable switch, bot token, allowed chat IDs). No DB migration needed.
- **grammY library** — Telegram Bot API client, long polling only (desktop app behind NAT). `sendMessageDraft` is Telegram's native streaming draft API.

## Scheduler Architecture

```
SchedulerService (singleton, poll loop)
  startLoop() → polls every 60s
    tick() → taskService.getDueTasks() → for each due task:
      runTask(task)
        1. Load agent config (soul, heartbeat)
        2. Build prompt (optionally prepend heartbeat content)
        3. Find/create session based on context_mode
        4. sessionMessageService.createSessionMessage()
        5. Log run to task_run_logs
        6. computeNextRun() → updateTaskAfterRun()
  stopLoop() → clears timer, aborts active tasks

TaskService (CRUD + scheduling logic)
  createTask / getTask / listTasks / updateTask / deleteTask
  getDueTasks() → SELECT WHERE status='active' AND next_run <= now()
  computeNextRun(task) → drift-resistant next run calculation
  updateTaskAfterRun() → updates next_run, last_run, last_result
  logTaskRun() → inserts into task_run_logs
```

API: `GET/POST /v1/agents/:agentId/tasks`, `GET/PATCH/DELETE /v1/agents/:agentId/tasks/:taskId`, `GET /v1/agents/:agentId/tasks/:taskId/logs`

## Claw MCP Architecture

```
CherryClawService.invoke()
  → injects _internalMcpServers = { 'cherry-claw': { url: /v1/claw/:agentId/claw-mcp } }
  → delegates to ClaudeCodeService.invoke()
    → merges _internalMcpServers into options.mcpServers
    → Claude SDK auto-discovers the "cron" tool

ClawServer (per-agent instance, src/main/mcpServers/claw.ts)
  cron tool:
    add → validates schedule (cron/every/at), maps to TaskService.createTask()
    list → TaskService.listTasks()
    remove → TaskService.deleteTask()

Route: /v1/claw/:agentId/claw-mcp (Streamable HTTP MCP transport)
  Per-agent ClawServer instances cached in memory
  Per-MCP-session transports managed with cleanup on close
```

## Channel Architecture

```
ChannelManager (singleton, lifecycle)
  start() → loads all CherryClaw agents, creates adapters for enabled channels
  stop() → disconnects all adapters
  syncAgent(agentId) → disconnect old adapters, re-create from current config

ChannelAdapter (abstract EventEmitter)
  connect() / disconnect()
  sendMessage(chatId, text, opts?)
  sendMessageDraft(chatId, draftId, text) → stream partial response
  sendTypingIndicator(chatId)
  Events: 'message' → ChannelMessageEvent, 'command' → ChannelCommandEvent

ChannelMessageHandler (singleton, stateless routing)
  handleIncoming(adapter, message):
    1. resolveSession(agentId) → get/create session (tracked per agent)
    2. Start typing indicator interval (every 4s)
    3. Generate random draftId
    4. collectStreamResponse(session, text, abort, onDraft):
       - Read stream, track completedText + currentBlockText
       - text-delta → update currentBlockText (cumulative within block)
       - text-end → commit block to completedText, reset for next turn
       - Throttled onDraft(fullText) via sendMessageDraft every 500ms
    5. sendMessage(chatId, finalText) with chunking for >4096 chars

  handleCommand(adapter, command):
    /new → create new session, update tracker
    /compact → send '/compact' to session, collect response
    /help → static help text

  Session tracking: Map<agentId, sessionId>
    resolveSession: tracker → first existing session → create new
```

Adapter registration: adapters self-register via `registerAdapterFactory(type, factory)` as a side effect of importing their module. `ChannelManager` imports all adapter modules from the index.

Wiring: `channelManager.start()` called alongside scheduler on app ready; `channelManager.stop()` on quit. `channelManager.syncAgent()` called on agent update/delete.

## Files Changed

### Type System & Config
- `src/renderer/src/types/agent.ts` — added `cherry-claw` to `AgentTypeSchema`, `CherryClawConfiguration`, `SchedulerType`, `CherryClawChannel` types; added `ScheduledTaskEntity`, `TaskRunLogEntity`, `CreateTaskRequest`, `UpdateTaskRequest`, `ListTasksResponse`, `ListTaskLogsResponse`, `TaskIdParamSchema`
- `src/renderer/src/config/agent.ts` — added `DEFAULT_CHERRY_CLAW_CONFIG`, `CherryClawAvatar`, updated `getAgentTypeAvatar`
- `src/main/apiServer/generated/openapi-spec.json` — added `cherry-claw` to AgentType enum
- `src/main/apiServer/routes/agents/index.ts` — updated Swagger enum, mounted task routes

### Database Schema
- `src/main/services/agents/database/schema/tasks.schema.ts` — NEW: `scheduledTasksTable` + `taskRunLogsTable` with FK cascades, indexes
- `src/main/services/agents/database/schema/index.ts` — added tasks schema export
- `resources/database/drizzle/0003_wise_meltdown.sql` — NEW: migration for scheduled_tasks + task_run_logs tables

### Backend Services
- `src/main/services/agents/services/AgentServiceRegistry.ts` — NEW: maps AgentType → AgentServiceInterface
- `src/main/services/agents/services/SessionMessageService.ts` — refactored to use registry; added `CreateMessageOptions.persist`, `TextStreamAccumulator.getText()`, `persistHeadlessExchange()` for headless message persistence; fixed cumulative text-delta `+=` → `=`
- `src/main/services/agents/services/cherryclaw/index.ts` — CherryClawService (soul-enhanced claude-code delegation + claw MCP injection + disallowed builtin tools)
- `src/main/services/agents/services/cherryclaw/soul.ts` — NEW: SoulReader with mtime cache
- `src/main/services/agents/services/cherryclaw/heartbeat.ts` — NEW: HeartbeatReader with path traversal protection
- `src/main/services/agents/services/TaskService.ts` — NEW: task CRUD, getDueTasks, computeNextRun (drift-resistant), run logging
- `src/main/services/agents/services/SchedulerService.ts` — REWRITTEN: poll-loop based, queries DB for due tasks, backward-compatible stopScheduler/startScheduler stubs; passes `{ persist: true }` and drains stream for completion
- `src/main/services/agents/services/index.ts` — registers claude-code + cherry-claw services, exports TaskService
- `src/main/services/agents/BaseService.ts` — added `cherry-claw` to tool/command dispatch
- `src/main/services/agents/services/SessionService.ts` — added `cherry-claw` to command dispatch
- `src/main/index.ts` — wired scheduler restore on startup, stopAll on quit
- `src/main/apiServer/routes/agents/handlers/agents.ts` — stop/restart scheduler on agent delete/update

### Claw MCP Server
- `src/main/mcpServers/claw.ts` — NEW: ClawServer with `cron` tool (add/list/remove actions), duration parsing, TaskService delegation
- `src/main/apiServer/routes/claw-mcp.ts` — NEW: Express route for Streamable HTTP MCP protocol, per-agent server caching, per-session transport management
- `src/main/apiServer/app.ts` — mounted claw MCP route at `/v1/claw`
- `src/main/services/agents/services/claudecode/internal-mcp.ts` — NEW: `InternalMcpServerConfig` type for injecting internal MCP servers
- `src/main/services/agents/services/claudecode/index.ts` — merges `_internalMcpServers` from session into SDK `options.mcpServers`

### Channel Layer
- `src/main/services/agents/services/channels/ChannelAdapter.ts` — abstract interface + event types + `sendMessageDraft`
- `src/main/services/agents/services/channels/ChannelMessageHandler.ts` — message routing, multi-turn stream collection, draft streaming, typing indicators; passes `{ persist: true }` for headless persistence
- `src/main/services/agents/services/channels/ChannelManager.ts` — singleton lifecycle, adapter factory registry, agent sync
- `src/main/services/agents/services/channels/index.ts` — public exports + adapter module imports
- `src/main/services/agents/services/channels/adapters/TelegramAdapter.ts` — grammY-based adapter (long polling, auth guard, `sendMessageDraft`, message chunking)

### Channel UI
- `src/renderer/src/pages/settings/AgentSettings/components/ChannelsSettings.tsx` — catalog-based card layout with inline config (blur-to-save)
- `src/renderer/src/pages/settings/AgentSettings/AgentSettingsPopup.tsx` — channels tab for CherryClaw
- `src/renderer/src/types/agent.ts` — `TelegramChannelConfigSchema`, `CherryClawChannelSchema` with typed config + enabled flag

### API Routes (Tasks)
- `src/main/apiServer/routes/agents/handlers/tasks.ts` — NEW: createTask, listTasks, getTask, updateTask, deleteTask, getTaskLogs
- `src/main/apiServer/routes/agents/validators/tasks.ts` — NEW: Zod validators for task routes
- `src/main/apiServer/routes/agents/handlers/index.ts` — added taskHandlers export
- `src/main/apiServer/routes/agents/validators/index.ts` — added tasks validators export

### Frontend API Client & Hooks
- `src/renderer/src/api/agent.ts` — added task path helpers, listTasks, createTask, getTask, updateTask, deleteTask, getTaskLogs methods
- `src/renderer/src/hooks/agents/useTasks.ts` — NEW: useTasks, useCreateTask, useUpdateTask, useDeleteTask, useTaskLogs SWR hooks

### Frontend UI
- `src/renderer/src/components/Popups/agent/AgentModal.tsx` — agent type selector, CherryClaw defaults, bypass warning
- `src/renderer/src/pages/settings/AgentSettings/AgentSettingsPopup.tsx` — replaced Channels tab with Tasks tab for CherryClaw agents
- `src/renderer/src/pages/settings/AgentSettings/BaseSettingsPopup.tsx` — added `'tasks'` to SettingsPopupTab union
- `src/renderer/src/pages/settings/AgentSettings/components/TasksSettings.tsx` — NEW: task list with add/edit/pause/delete/logs
- `src/renderer/src/pages/settings/AgentSettings/components/TaskListItem.tsx` — NEW: task row with status badge, schedule info, action buttons
- `src/renderer/src/pages/settings/AgentSettings/components/TaskFormModal.tsx` — NEW: add/edit modal (name, prompt, schedule type/value, context mode)
- `src/renderer/src/pages/settings/AgentSettings/components/TaskLogsModal.tsx` — NEW: run history table (run_at, duration, status, result/error)
- `src/renderer/src/pages/settings/AgentSettings/components/SoulSettings.tsx` — NEW
- `src/renderer/src/pages/settings/AgentSettings/components/ChannelsSettings.tsx` — placeholder (no longer in CherryClaw tab menu)
- `src/renderer/src/pages/settings/AgentSettings/shared.tsx` — CherryClaw default emoji
- `src/renderer/src/i18n/label.ts` — added CherryClaw label

### i18n
- `src/renderer/src/i18n/locales/en-us.json` + 10 other locale files — CherryClaw + task UI strings (properly nested)

### Tests
- `src/main/services/agents/services/__tests__/AgentServiceRegistry.test.ts` — 4 tests
- `src/main/services/agents/services/__tests__/SchedulerService.test.ts` — 7 tests (rewritten for poll-loop API)
- `src/main/services/agents/services/cherryclaw/__tests__/soul.test.ts` — 4 tests
- `src/main/services/agents/services/cherryclaw/__tests__/heartbeat.test.ts` — 5 tests
- `src/main/mcpServers/__tests__/claw.test.ts` — 12 tests (cron tool add/list/remove, duration parsing, validation)
- `src/main/services/agents/services/channels/__tests__/ChannelMessageHandler.test.ts` — 7 tests (multi-turn accumulation, chunking, commands, session tracking)
- `src/main/services/agents/services/channels/__tests__/ChannelManager.test.ts` — 6 tests (lifecycle, sync, adapter management)
- `src/main/services/agents/services/channels/adapters/__tests__/TelegramAdapter.test.ts` — 8 tests (connect, auth guard, message handling, chunking)

### Dependencies
- `package.json` / `pnpm-lock.yaml` — added `cron-parser` ^5.5.0, `grammy` ^1.41

## Current State

- Branch: `feat/cherry-claw-agent`
- All lint/test/format checks pass (198 test files, 3588 tests)
- Feature is code-complete including task-based scheduler, claw MCP tool, and channel layer with Telegram streaming
- Pushed to remote

## Blockers / Gotchas

- **Placeholder avatar** — `cherry-claw.png` is a copy of `claude.png`. Needs a proper distinct image.
- **Channel streaming behavior** — `text-delta` events from the transform layer are cumulative within a text block (each contains full text so far, not just the new portion). The UI relies on this. `ChannelMessageHandler` uses `text = value.text` (replace) within a block, and commits on `text-end` across turns. Do not change the transform layer's cumulative behavior.
- **Headless message persistence (FIXED)** — `SessionMessageService.createSessionMessage()` does NOT persist messages itself; persistence was entirely UI-driven via IPC (`AgentMessage_PersistExchange`). Channel and scheduler callers had no UI, so messages were lost. Fix: added `{ persist: true }` option to `createSessionMessage()` that triggers `persistHeadlessExchange()` on stream complete. Two bugs were found and fixed:
  1. **Missing persistence** — headless callers never saved user/assistant messages to `sessionMessagesTable`. Fixed by calling `agentMessageRepository.persistExchange()` when `persist: true`.
  2. **Cumulative delta corruption** — `TextStreamAccumulator` used `+=` for text-delta, but deltas are cumulative (full text so far). This caused persisted text to contain all intermediate states concatenated. Fixed by using `=` (replace). The `ChannelMessageHandler` already used `=` correctly.
  3. **topicId prefix** — `Message.topicId` must use `agent-session:<sessionId>` prefix, not raw session ID. Without the prefix, the UI's `DbService.getDataSource()` routes to Dexie instead of the agent SQLite data source, breaking message updates and rendering.
- **Telegram rate limits** — `sendMessageDraft` has no documented rate limit, but `sendMessage` is 30/s globally, 1/s per chat. Draft throttle is 500ms; typing indicator is 4s.
- **Telegram MarkdownV2** — agent responses sent as plain text (no `parse_mode`) to avoid escaping issues. Proper GFM→MarkdownV2 conversion is a follow-up.
- **Memory system** — not implemented, deferred per plan.
- **Non-Anthropic models** — CherryClaw only supports Anthropic provider models (inherits from Claude Agent SDK).
- **Session settings** — `SessionSettingsPopup.tsx` was NOT updated with CherryClaw tabs (only `AgentSettingsPopup` was). May want to add soul/task tabs there too if sessions need per-session overrides.
- **Scheduler backward compat** — `startScheduler(agent)` and `stopScheduler(agentId)` are now no-ops (the poll loop handles everything via DB state). Agent handler code in `agents.ts` still calls them but they just ensure the loop is running.
- **Task consecutive errors** — after 3 consecutive errors, a task is auto-paused. The error count resets on the next successful run. This is tracked per-task in the running task state (not persisted).
- **Claw MCP server lifecycle** — per-agent ClawServer instances are cached in memory; `cleanupClawServer(agentId)` exported from `claw-mcp.ts` but not yet called on agent deletion. Should be wired into agent delete handler.
- **Claw MCP tool allowlist** — the `cron` tool appears as `mcp__cherry-claw__cron` in the SDK's tool namespace. It may need to be auto-added to the session's `allowed_tools` if the agent uses a restrictive permission mode.

## Next Steps

1. **Create PR** — use `gh-create-pr` skill to create a pull request from `feat/cherry-claw-agent` → `main`
2. **Replace avatar** — design/source a proper CherryClaw avatar image to replace the placeholder
3. **E2E testing** — manually test the full flow: create CherryClaw agent → verify cron tool is available → agent creates a scheduled task → verify task execution and run logging
4. **Wire cleanup** — call `cleanupClawServer(agentId)` in the agent delete handler to free per-agent MCP server instances
5. **Tool allowlist** — ensure `mcp__cherry-claw__cron` is auto-allowed for CherryClaw agents
6. **TaskService tests** — add unit tests for TaskService CRUD and computeNextRun
7. **SessionSettingsPopup** — consider adding CherryClaw tabs to session-level settings if per-session overrides are needed
8. **Scheduler notifications** — when `is_notify_receiver: true` on a channel, route task completion summaries to it (Phase 7 in `handoff-tg-channel.md`)
9. **GFM→MarkdownV2 conversion** — proper markdown formatting for Telegram responses
10. **Additional channel adapters** — Discord, Slack using the same `ChannelAdapter` + `registerAdapterFactory` pattern
