# CherryClaw Architecture

<p align="center">
  <img src="../../assets/images/cherryclaw.png" width="200" alt="CherryClaw" />
</p>

CherryClaw is an autonomous agent type in Cherry Studio, built on the Claude Agent SDK. Unlike standard claude-code agents, CherryClaw has an independent personality system, task-based scheduler, IM channel integration, and a set of self-management tools provided through an internal MCP server.

## Architecture Overview

```
CherryClawService
  ├── PromptBuilder        — Assembles full system prompt from workspace files
  ├── HeartbeatReader      — Reads heartbeat file content (for pre-task prompt context)
  ├── ClawServer (MCP)     — Built-in MCP server providing cron / notify / skills / memory tools
  ├── SchedulerService     — 60s polling scheduler, queries DB for due tasks and executes
  ├── TaskService          — Task CRUD + next run time calculation
  └── ChannelManager       — Channel adapter lifecycle management (Telegram, etc.)
```

## Core Design Decisions

### AgentServiceRegistry Pattern

`SessionMessageService` no longer hard-codes `ClaudeCodeService`. Instead, it uses `AgentServiceRegistry` to look up the corresponding service implementation by `AgentType`. CherryClaw delegates to claude-code for execution at runtime through the registry.

```typescript
// src/main/services/agents/services/AgentServiceRegistry.ts
agentServiceRegistry.register('claude-code', new ClaudeCodeService())
agentServiceRegistry.register('cherry-claw', new CherryClawService())
```

### Custom System Prompt (Replacing Claude Code Presets)

CherryClaw does not use Claude Code's preset system prompts. `PromptBuilder` assembles a complete custom prompt from workspace files, passed via the `_systemPrompt` field to `ClaudeCodeService`. When this field is present, it serves as the complete system prompt rather than the preset + append mode.

### Disabling Inapplicable Built-in Tools

CherryClaw disables a set of SDK built-in tools unsuitable for autonomous operation via `_disallowedTools`:

| Disabled Tool | Reason |
|---|---|
| `CronCreate` / `CronDelete` / `CronList` | Replaced by internal MCP cron tools |
| `TodoWrite` | Not suitable for autonomous agents |
| `AskUserQuestion` | Autonomous agents should not ask users |
| `EnterPlanMode` / `ExitPlanMode` | Not suitable for autonomous agents |
| `EnterWorktree` / `NotebookEdit` | Not suitable for autonomous agents |

## Invocation Flow

```
CherryClawService.invoke()
  1. PromptBuilder.buildSystemPrompt(workspacePath)
     → Load system.md (optional override) + soul.md + user.md + memory/FACT.md
     → Assemble into complete system prompt
  2. Create ClawServer instance (in-memory MCP server)
     → Inject as _internalMcpServers = { claw: { type: 'inmem', instance } }
  3. Set _disallowedTools (disable inapplicable tools)
  4. If agent has allowed_tools whitelist, append mcp__claw__* wildcard
  5. Delegate to ClaudeCodeService.invoke()
     → Use _systemPrompt as complete replacement
     → Merge _internalMcpServers into SDK options.mcpServers
     → Claude SDK auto-discovers cron / notify / skills / memory tools
```

## Memory System

CherryClaw uses an Anna-inspired three-file memory model, each file with an independent scope:

```
{workspace}/
  system.md              — Optional system prompt override (replaces default CherryClaw identity)
  soul.md                — Who you are: personality, tone, communication style
  user.md                — Who the user is: name, preferences, personal context
  memory/
    FACT.md              — What you know: persistent project knowledge, technical decisions (6+ months)
    JOURNAL.jsonl        — Event log: one-off events, completed tasks, session notes (append-only)
```

Key rules:
- Each file has independent scope; no cross-file duplication
- `soul.md` and `user.md` are edited directly via Read/Edit tools
- `FACT.md` and `JOURNAL.jsonl` are managed via `memory` MCP tools
- Agent updates autonomously without requesting user approval
- Filenames are case-insensitive

### PromptBuilder Caching

`PromptBuilder` uses mtime-based caching for all file reads. Each read performs a single `fs.stat` check — if the file modification time hasn't changed, cached content is returned directly, without persistent file watchers.

## Database

CherryClaw uses Drizzle ORM + LibSQL (SQLite) for task data storage:

| Table | Purpose |
|---|---|
| `scheduled_tasks` | Scheduled tasks (name, prompt, schedule type, next run time, status) |
| `task_run_logs` | Task run logs (run time, duration, status, result/error) |

Both tables are associated with the agents table via foreign key cascades.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/agents/:agentId/tasks` | List tasks |
| `POST` | `/v1/agents/:agentId/tasks` | Create task |
| `GET` | `/v1/agents/:agentId/tasks/:taskId` | Get task details |
| `PATCH` | `/v1/agents/:agentId/tasks/:taskId` | Update task |
| `DELETE` | `/v1/agents/:agentId/tasks/:taskId` | Delete task |
| `POST` | `/v1/agents/:agentId/tasks/:taskId/run` | Manually trigger run |
| `GET` | `/v1/agents/:agentId/tasks/:taskId/logs` | Get run logs |

## Key Files

| File | Description |
|---|---|
| `src/main/services/agents/services/cherryclaw/index.ts` | CherryClawService entry point |
| `src/main/services/agents/services/cherryclaw/prompt.ts` | PromptBuilder system prompt assembly |
| `src/main/services/agents/services/cherryclaw/heartbeat.ts` | HeartbeatReader heartbeat file reading |
| `src/main/services/agents/services/AgentServiceRegistry.ts` | Agent service registry |
| `src/main/services/agents/services/TaskService.ts` | Task CRUD + scheduling calculation |
| `src/main/services/agents/services/SchedulerService.ts` | Polling scheduler |
| `src/main/mcpServers/claw.ts` | Claw MCP server |
| `src/main/services/agents/services/channels/` | Channel abstraction layer |
| `src/main/services/agents/database/schema/tasks.schema.ts` | Task table schema |
