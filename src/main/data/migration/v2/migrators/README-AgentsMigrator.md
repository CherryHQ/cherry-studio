# AgentsMigrator

## Purpose

Migrates the legacy standalone `agents.db` SQLite database into the main `cherrystudio.sqlite` database during the v2 migration flow.

## Source

Legacy source database locations checked in order:

1. `application.getPath('feature.agents.db_file')` → `{userData}/Data/agents.db`
2. `application.getPath('app.userdata', 'agents.db')` → legacy fallback `{userData}/agents.db`

## Target tables

- `agents_agents`
- `agents_sessions`
- `agents_skills`
- `agents_tasks`
- `agents_task_run_logs`
- `agents_channels`
- `agents_channel_task_subscriptions`
- `agents_session_messages`

## Import strategy

The migrator uses SQLite-native copy statements:

1. `ATTACH DATABASE ... AS agents_legacy`
2. `INSERT INTO agents_* (...) SELECT ... FROM agents_legacy.*`
3. `DETACH DATABASE agents_legacy`

This keeps IDs, timestamps, and JSON/text payloads intact while avoiding per-row TypeScript transforms.

## Table mapping

| Legacy table | Main DB table |
| --- | --- |
| `agents` | `agents_agents` |
| `sessions` | `agents_sessions` |
| `skills` | `agents_skills` |
| `scheduled_tasks` | `agents_tasks` |
| `task_run_logs` | `agents_task_run_logs` |
| `channels` | `agents_channels` |
| `channel_task_subscriptions` | `agents_channel_task_subscriptions` |
| `session_messages` | `agents_session_messages` |

## Validation

Validation compares source and target row counts for every migrated table. Any target table with fewer rows than its source table fails the migration.

## Notes

- The v2 migration target version was bumped so installs already marked as `2.0.0` will still rerun migration if legacy `agents.db` data remains.
- The import is intentionally schema-preserving to reduce cutover risk for the later agents-service refactor.
