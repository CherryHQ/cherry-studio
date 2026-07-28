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
attempt are accepted recursively; different files keep both the existing v2
target and the v1 source in place.

## Copy-only and downgrade contract

The filesystem migration is additive. It never removes or rewrites the v1
`agents.db` or `Data/Agents/{legacyAgentId suffix}` workspace because those
paths remain the source of truth when a user downgrades to v1.

Each entry records its source metadata before copying, verifies that the source
metadata is unchanged after the copy, and requires the private staging entry
and published destination to match the same copied-content fingerprint. A
source that changes inside that window aborts the migration. UUID staging paths
keep partial copies out of the final workspace and only the current run's
staging path is removed; the migration never sweeps other prefix-matching
entries.

`app_state.key = 'migration_v2_status'` records that the v2 database and file
copies are ready. It does not mean the v1-compatible source layout was removed,
and there is no cleanup plan or filesystem finalization state.

## Deferred Agent directory GC

General orphan cleanup for v2-owned `Data/Agents` paths is intentionally
deferred until the File GC lifecycle in #16727 is available. The database
provides ownership for the v2 layout:

- `agent.id` owns `Data/Agents/{agentId}`.
- `agent_workspace` rows own managed system-workspace paths.

The later GC can derive live v2 roots from committed rows and remove only
unowned v2 directories through the shared scan/retry/idle lifecycle. Legacy
short-ID workspaces are downgrade-compatibility data, not v2 orphans, and must
remain excluded for as long as v1 downgrade support exists.

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
- `agentsFilesystemMigration.ts` — copy-only identity/workspace staging and verified publication.
- `remapAgentPrefixIds.ts` — deterministic ID and foreign-key remapping.
