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

Filesystem staging is copy-only. Each entry records its source content and
metadata before copying, verifies that the source metadata is unchanged after
the copy, and requires the staging entry and published destination to match the
same copied-content fingerprint. A source that changes inside that window
aborts the migration instead of producing a cleanup candidate.

`AgentsMigrator` keeps the cleanup plan in run-local state. After every
migrator validates and the global foreign-key check succeeds, the engine calls
each migrator's `finalize()` hook. Only after finalization succeeds does it
write `app_state.key = 'migration_v2_status'` as completed. A finalization
failure marks the migration failed, so retry reruns the idempotent migration;
there is no second durable migration marker.

Cleanup removes only entry names that the same run copied or verified as
identical. Every managed root is checked with `lstat` and physical containment
before removal; links are removed as link objects and never followed. It checks
the destination first and the source second. Unchanged metadata takes the fast
path; metadata changes fall back to content fingerprints, and any content
change preserves the source.

## Deferred Agent directory GC

This migrator removes only copy-verified v1 entries. General orphan cleanup for
`Data/Agents` is intentionally deferred until the File GC lifecycle in #16727
is available. The database already provides lossless ownership:

- `agent.id` owns `Data/Agents/{agentId}`.
- `agent_workspace` rows own managed system-workspace paths.

That means the later GC can derive live roots from committed rows and remove
only unowned directories through the shared scan/retry/idle lifecycle.
Deferring it retains possible residue but does not discard owned data; adding a
second migration-specific scanner now would duplicate lifecycle and retry
semantics.

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
- `remapAgentPrefixIds.ts` — deterministic ID and foreign-key remapping.
