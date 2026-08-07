# AiUsageRecordMigrator

## Sources

- SQLite `message` rows produced by `ChatMigrator`
- SQLite `agent_session_message` rows produced by `AgentsMigrator`

Only usage-bearing assistant messages are candidates. The migrator does not
read current provider, model, assistant, agent, API-key, or pricing state.

## Target

- SQLite `ai_usage_record`
- One `legacy-aggregate` record per source message
- Stable idempotency key: `legacy:<message-kind>:<message-id>`

The target row is an immutable, best-effort historical aggregate. Its
`requestCount` may represent multiple estimated provider calls; it is not
presented as a single invocation.

## Key transformations

- Copies token usage from migrated `MessageStats`.
- Uses the request-count estimate persisted by `ChatMigrator` /
  `AgentsMigrator`. The estimate begins at one and adds one for each
  consecutive tool group followed by more model output. Parallel tools are one
  group; citation/file/source blocks do not split it; a terminal tool group
  adds nothing.
- Preserves only explicitly stored v1 cost semantics. Missing historical cost
  is not recomputed from current pricing.
- Migrated model pricing maps only absent/`$` to USD and `¥`/`￥` to CNY.
  Unsupported legacy currency symbols are dropped rather than guessed.
- Copies source identity only from the immutable `messageSnapshot`.
- Retains provider/model identity when the migrated row already carries it;
  either may remain null when history cannot identify it.
- Marks credential attribution as `unknown`.
- Leaves `timeFirstTokenMs`, `timeCompletionMs`, and `timeThinkingMs` null on
  the record because historical timing describes the whole message, not one of
  its estimated provider calls.
- Rebuilds `MessageStats` usage/cost/request fields from the inserted record
  while preserving historical message-level timing.
- Reads candidates using an ascending id keyset cursor rather than `OFFSET`.

## Field mapping

| Source | Target |
| --- | --- |
| message kind + id | `requestId`, `messageKind`, `messageId` |
| persisted estimate | `requestCount` |
| migrated model identity | nullable `providerId`, `modelId` |
| `messageSnapshot` | nullable source snapshot |
| message usage | token/cache fields |
| explicitly stored v1 cost | cost tuple |
| message creation timestamp | `createdAt` |
| unavailable per-call timing | null invocation metric fields |

Messages without a usage/cost signal are skipped. Unknown historical identity
is retained as null instead of being backfilled from mutable configuration.

## Progress, retry, and validation

- `prepare()` counts candidate chat and agent-session messages.
- `execute()` reports progress after each keyset batch.
- Inserts use the unique request id and never update an existing row.
- A failed batch is rolled back and retried row by row so one malformed source
  row does not abort the full user-data migration.
- The request-count estimate lives in migrated `MessageStats`, so a resumed
  migration does not depend on an in-memory handoff.
- `validate()` checks candidate/skipped/target counts and the standard owned
  table integrity contract.
