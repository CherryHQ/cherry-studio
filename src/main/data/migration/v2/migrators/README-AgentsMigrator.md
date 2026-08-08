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
| `.claude` | `Data/Agents/.claude` |
| `.claude/projects/*/{agent_session_id}.jsonl` | Migrated Session workspace's Claude project cache |
| `Data/Agents/{legacyAgentId suffix}` | `Data/Agents/{agentId}` and `Data/Agents/system/YYYY-MM-DD/{sessionId}` |

`MigrationPaths` supplies every source and destination root. The migrator never
resolves migration storage through the live application path registry.

## Database transformations

- Legacy prefix IDs and built-in sentinel IDs become deterministic UUIDs;
  Agent and Session foreign keys are remapped in the same operation. Immutable
  session-message author snapshots are rewritten to the same final Agent ID so
  migrated usage and new usage group under one source identity.
- Session workspaces come from the first valid Session-level accessible path,
  then the Agent-level path, then the v1 managed default.
- A managed default becomes a Session-specific system workspace. External user
  workspaces remain in place.
- Legacy `session_messages` are read through a stable SQLite cursor in batches
  and normalized into a temporary SQLite staging table. Legacy message blocks
  become v2 message parts, and inline base64 images are materialized before the
  synchronous Agent import transaction begins. The transaction then drains the
  staging table in batches, so source JSON and transformed parts are never all
  retained in the V8 heap at once.
- Agent and per-Agent Session ordering is converted to fractional order keys.
- Scheduled-task trigger fields become JobManager trigger objects. Legacy task
  run logs are intentionally not migrated.
- MCP IDs are mapped through `McpServerMigrator`; dangling relationships are
  dropped and logged.

The main `BEGIN`/`COMMIT` region contains only synchronous better-sqlite3 work.
Filesystem probing and message-file materialization complete before `BEGIN`.
Messages are normalized into a file-backed SQLite TEMP table in 100-row pages,
then read and inserted in 100-row pages inside the transaction. This keeps
message payload memory bounded while preserving atomic import and one final FTS
rebuild. The temporary tables are dropped before workspace copying.

## Filesystem split

Before importing `agents.db`, the migrator copies ordinary files and directories
from the v1 `{userData}/.claude` tree to
`{userData}/Data/Agents/.claude`. Symlinks are skipped so Windows migration does
not require permission to create them. The copy uses a private staging
directory, verifies the copied source and destination content, and atomically
publishes the result. If the destination directory already exists, migration
leaves it untouched and skips the legacy Claude config copy. This copy also
runs when `agents.db` is absent. Large config trees report throttled scan, copy,
and verification progress by file count and bytes without logging file content.

For each migrated Agent:

- `SOUL.md`, `USER.md`, and `memory/` are materialized as real files and
  directories under `Data/Agents/{finalAgentId}`.
- Each valid `session_messages.agent_session_id` is treated as an opaque Claude
  runtime resume UUID. Migration first checks the old cwd project key and scans
  the other project directories once for unresolved IDs. Only matching
  `{id}.jsonl` transcripts are copied under the final runtime cwd project key.
- Ordinary files from the v1 managed workspace are copied into every migrated
  managed Session workspace without an age limit, independently of Claude
  transcript availability. External user workspaces continue using their
  original path without an ordinary workspace-file copy.
- Imported resume tokens remain unchanged. If the latest Claude transcript
  cannot be made available, the normal runtime resume attempt surfaces the
  failure to the user.
- A symlinked v1 Agent root is skipped without following or removing it.
- Identity and ordinary workspace symlinks are skipped. Migration copies only
  regular files and directories so link permissions or unsupported link targets
  cannot block the rest of the migration.
- Ordinary workspace content is scanned once. The first verified private
  staging copy is reused as the regular-content source for later Sessions, so
  migration does not need an additional full-size template.

Before reading or copying Agent identity and workspace content, migration
validates every exact v2 target against every v1 source, then clears the final
`Data/Agents/{agentId}` directories and planned managed Session workspaces that
are not themselves legacy sources. A target already used as the same Agent's
exact legacy workspace is retained, including case-only path variants on
Windows and macOS; a cross-Agent or ancestor/descendant overlap still aborts.
Validation completes for the whole cleanup plan before any target is removed.
This avoids hashing or copying data only to fail on stale retry output, while
leaving legacy short-ID and external user workspaces unchanged. A target
recreated after cleanup is accepted only when it is identical to the verified
staging copy.

Claude project keys mirror the SDK's cwd sanitizer, including its 200-character
limit and hash suffix for long paths. The atomically published v2 `.claude`
configuration directory is retained across retries to avoid copying the whole
tree again. After resolving and snapshotting a Claude Session transcript,
migration replaces only its exact destination JSONL unless that destination is
also the sole source. Concurrently recreated entries still use the same
verified staging and conflict rules; the old cwd cache is retained for
downgrade compatibility.

## Copy-only and downgrade contract

The filesystem migration is copy-only with respect to v1. It never removes or
rewrites the v1 `.claude`, `agents.db`, `Data/Agents/{legacyAgentId suffix}`, or
external user workspace because those paths remain the source of truth when a
user downgrades to v1. Retry cleanup removes only the exact v2 Agent and managed
Session targets owned by the current migration plan.

Filesystem copies use content fingerprints rather than source metadata. Each
source is fingerprinted before copying, and the complete private staging entry
must match that fingerprint before atomic publication. Once that verified
snapshot exists, later inode or timestamp changes do not invalidate it. This
tolerates cloud-storage hydration and preserves a deterministic source snapshot
without requiring a user-owned directory to remain quiescent. After planned
targets are cleared, a concurrently created destination is fingerprinted and
reused only when it is identical. UUID staging paths keep partial copies out of
the final workspace and only the current run's staging path is removed; the
migration never sweeps other prefix-matching entries.

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
- `agentsFilesystemMigration.ts` — v2 target reset, copy-only v1 reads, and verified publication.
- `remapAgentPrefixIds.ts` — deterministic ID and foreign-key remapping.
