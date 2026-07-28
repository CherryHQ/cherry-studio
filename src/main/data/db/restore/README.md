# DB Restore Promotion

Crash-safe, database-only promotion for Lite backup restore. The service stages a sealed portable SQLite database, writes a `prepared` journal, and relaunches; preboot then checkpoint-parks the live DB and promotes the staged DB while no `DbService` connection exists.

## Modules

| File | Role |
| --- | --- |
| `restoreJournal.ts` | Strict final journal schema, durable reader/writer, and GC guard |
| `restorePromotion.ts` | Preboot DB promotion, crash recovery, rollback |
| `restoreRecovery.ts` | Pure `(state, staged, live, aside)` recovery table |
| `checkpoint.ts`, `snapshot.ts`, `appliedChain.ts` | Shared SQLite snapshot and migration primitives |

## Invariants

- Journal and all database asides stay beside `app.database.file`; journal paths are userData-relative and must be derived from its `restoreId`.
- `prepared` is never consent; only `armed` enters promotion.
- The live WAL is checkpointed before its main file is parked.
- Promotion keeps the old DB aside until explicit keep/rollback acknowledgement.
- Unknown, corrupt, or ambiguous journals preserve evidence and block unsafe boot/reclamation.
- POSIX uses temp-file fsync → rename → parent fsync. Windows guarantees process-crash recovery, not power-loss durability.
