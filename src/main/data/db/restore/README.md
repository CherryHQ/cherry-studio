# DB Restore Promotion

Crash-safe, database-only promotion for Lite backup restore. The service stages a sealed portable SQLite database, writes a `prepared` journal, and relaunches; preboot then checkpoint-parks the live DB and promotes the staged DB while no `DbService` connection exists.

## Modules

| File | Role |
| --- | --- |
| `restoreJournal.ts` | Strict final Lite schema, durable reader/writer, GC guard, and preboot format probe |
| `restorePromotion.ts` | Preboot Lite DB promotion, crash recovery, rollback |
| `restoreJournalV1Compat.ts`, `restorePromotionV1Compat.ts` | Temporary RC1-only executor for active version-1 journals; no new writer may use it |
| `restoreRecovery.ts` | Pure `(state, staged, live, aside)` recovery table |
| `checkpoint.ts`, `snapshot.ts`, `appliedChain.ts` | Shared SQLite snapshot and migration primitives |

## Invariants

- Journal and all database asides stay beside `app.database.file`; journal paths are userData-relative and must be derived from its `restoreId`.
- `prepared` is never consent; only `armed` enters promotion.
- The live WAL is checkpointed before its main file is parked.
- Promotion keeps the old DB aside until explicit keep/rollback acknowledgement.
- Unknown, corrupt, or ambiguous journals preserve evidence and block unsafe boot/reclamation.
- Preboot dispatches version 1 only to the temporary RC1 compatibility executor; it must converge and remove its terminal artifacts before boot. New Lite operations write only version 2.
- POSIX uses temp-file fsync → rename → parent fsync. Windows guarantees process-crash recovery, not power-loss durability.
