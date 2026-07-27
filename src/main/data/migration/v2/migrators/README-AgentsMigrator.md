# AgentsMigrator

`AgentsMigrator` imports the v1 `Data/agents.db` Agent domain into the v2
SQLite schema and separates Agent-owned identity/memory from Session workspace
files.

## Data sources and targets

| v1 source | v2 target |
|---|---|
| `agents.db.agents` | `agent` |
| `agents.db.sessions` | `agent_session` plus one `agent_workspace` binding per Session |
| `agents.db.session_messages` | `agent_session_message` |
| `agents.db.skills`, `agent_skills` | `agent_global_skill`, `agent_skill` |
| `agents.db.channels` | `agent_channel` |
| `agents.db.scheduled_tasks`, `channel_task_subscriptions` | `job_schedule`, `agent_channel_task` |
| `agents.db.agents.mcps` | `agent_mcp_server` |
| `Data/Agents/{legacyAgentId suffix}` | `Data/Agents/{agentId}` and `Data/Agents/system/YYYY-MM-DD/{sessionId}` |

`MigrationPaths` supplies every source and destination root. The migrator never
resolves migration storage through the live application path registry.

## Database transformations

- Legacy prefix IDs and built-in sentinel IDs become deterministic UUIDs;
  Agent and Session foreign keys are remapped in the same operation.
- Session workspaces come from the first valid Session-level accessible path,
  then the Agent-level path, then the v1 managed default.
- A managed default becomes a Session-specific system workspace. External user
  workspaces remain in place.
- Legacy message blocks become v2 message parts. Inline base64 images are
  materialized before the synchronous Agent import transaction begins.
- Agent and per-Agent Session ordering is converted to fractional order keys.
- Scheduled-task trigger fields become JobManager trigger objects. Legacy task
  run logs are intentionally not migrated.
- MCP IDs are mapped through `McpServerMigrator`; dangling relationships are
  dropped and logged.

The main `BEGIN`/`COMMIT` region contains only synchronous better-sqlite3 work.
Filesystem probing and message-file materialization complete before `BEGIN`.

## Filesystem split

For each migrated Agent:

- `SOUL.md`, `USER.md`, and `memory/` are materialized as real files and
  directories under `Data/Agents/{finalAgentId}`.
- Ordinary files from the v1 managed workspace are copied to the most recently
  used managed Session workspace. Other historical managed Sessions receive
  independent empty system workspaces.
- The most recent Session is selected by `updated_at DESC`, then
  `created_at DESC`, then Session ID.
- A symlinked v1 Agent root is treated as an external user workspace: identity
  may be read from its resolved directory, but the target is never removed.
- Identity symlinks are followed only when they resolve inside the source
  workspace and are materialized as ordinary files/directories.
- Ordinary workspace symlinks remain links. Targets under identity entries are
  rewritten to Agent data; other internal targets are rewritten to the new
  Session workspace; external and dangling targets retain their meaning.

Existing identity targets are never overwritten. Identical files from a prior
attempt are accepted recursively and remain eligible for source cleanup;
different files keep the v1 source in place.

## Finalization and retry contract

Filesystem staging is copy-only. After staging, the exact cleanup plan is
stored in `app_state` under `migration_v2_agent_files_finalization`, replacing
any plan from an earlier attempt.

The engine writes the normal migration completion marker only after every
migrator, validation, and foreign-key check succeeds. It then executes the
stored cleanup plan. If cleanup fails, the plan remains durable and
`needsMigration()` retries it on later launches without rerunning migration.
Choosing **Skip Migration** deletes the pending plan without deleting v1
sources.

Cleanup removes only entry names that the same run copied or verified as
identical. Every managed root is checked with `lstat` and physical containment
before removal; links are removed as link objects and never followed.

## Important field mappings

| v1 field | v2 field | Notes |
|---|---|---|
| `agents.id` | `agent.id` | Deterministic UUID remap for legacy IDs |
| `sessions.agent_id` | `agent_session.agent_id` | Updated with Agent remap |
| `sessions.accessible_paths[0]` | `agent_workspace.path` | Falls back to Agent path, then managed default |
| `agents.allowed_tools` | `agent.disabled_tools` | Starts empty; the concepts are not equivalent |
| `agents.mcps[]` | `agent_mcp_server` | IDs remapped through the MCP migrator |
| `session_messages.agent_session_id` | `agent_session_message.runtime_resume_token` | Preserves runtime resume state |
| `scheduled_tasks.schedule_*` | `job_schedule.trigger` | Converted to cron, interval, or once |

## Intentionally dropped data

- v1 scheduled-task run logs.
- Dangling Agent/MCP, Agent/skill, channel/task, and other relationship rows
  that cannot satisfy v2 foreign keys.
- Additional legacy accessible paths after the primary workspace.
- Per-Session configuration that moved to the parent Agent.

Related user-visible behavior is recorded under
`v2-refactor-temp/docs/breaking-changes/`.

## Implementation files

- `AgentsMigrator.ts` — database preparation, import, validation, and ID remap orchestration.
- `mappings/AgentsDbMappings.ts` — v1 schema inspection and SQL mapping definitions.
- `agentsFilesystemMigration.ts` — copy-only identity/workspace staging and safe cleanup.
- `agentFilesFinalization.ts` — durable cleanup journal and restart finalization.
- `remapAgentPrefixIds.ts` — deterministic ID and foreign-key remapping.

