# AiUsageRecordMigrator

## Sources

- SQLite `message` rows produced by `ChatMigrator`
- SQLite `agent_session_message` rows produced by `AgentsMigrator`
- SQLite provider and model tables for display-name and pricing snapshots

Only assistant messages with a model identity, `stats`, and at least one usage or
cost signal are candidates.

## Target

- SQLite `ai_usage_record`
- One record per source message, keyed by the source message id as `requestId`

The table is a best-effort analytical read model. It is not an immutable billing
ledger and is not a payment-system source of truth.

## Key Transformations

- Resolves the canonical `providerId::modelId` from the migrated model id or its
  message snapshot.
- Snapshots assistant or agent identity and presentation metadata.
- Copies token, latency, and existing cost fields.
- Computes a historical cost snapshot when the source has usage and a compatible
  model-pricing snapshot but no stored cost.
- Marks all historical key attribution as `none`; it never infers a serving key
  from the provider's current rotation state.
- Reads candidates with an ascending id keyset cursor. Each batch starts after
  the last processed id, avoiding offset scans on large message tables.

## Field Mapping

| Source | Target |
| --- | --- |
| message id | `requestId` |
| topic id | `topicId` |
| canonical model identity | `providerId`, `modelId` |
| provider row / message snapshot | `providerName` |
| topic assistant or agent session owner | `sourceType`, `sourceId`, `sourceName`, `sourceIcon` |
| message stats | token, latency, and cost columns |
| message timestamps | `createdAt`, `updatedAt` |

## Dropped Data

- Messages without a resolvable model identity
- Messages without usage or cost signals
- Historical API-key attribution, because the serving key was not captured when
  the request ran
- Partial cost annotations without an amount or compatible pricing snapshot

Skipped candidates are counted during validation. Insert failures are retried
row by row so one malformed derived record does not abort the user-data
migration.

## Progress and Validation

- `prepare()` counts candidate chat and agent-session messages.
- `execute()` reports progress after each keyset batch.
- Inserts are idempotent through the unique `requestId` conflict target.
- `validate()` checks that the target count covers all non-skipped candidates.
- `execute()` runs the owned-table foreign-key self-check even though the current
  table has no foreign keys, preserving the migrator contract if the schema
  evolves.
