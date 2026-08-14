# Concurrency & Locks (Four-Layer Model)

JobManager uses four orthogonal lock layers under concurrent dispatch.

| Layer | Owner | Scope | Held for | Purpose |
| --- | --- | --- | --- | --- |
| **0** Synchronous write transaction | `DbService.withWriteTx` | All write transactions across the app (every `withWriteTx` transaction; single writes ride the same connection without a tx) | µs — one tx | Runs each write as one synchronous `BEGIN IMMEDIATE` transaction on the single better-sqlite3 connection (behind the isReady guard). Synchronous execution on one persistent connection serializes all writes inherently — no mutex or retry needed. Reusable by any service. |
| **1** Per-queue dispatch mutex | `DispatchQueue.mutex` | One queue's (count → claim) section | µs | Serializes ticks against the same queue to avoid wasted Layer 0 traffic. Concurrency cap is enforced by SQL `countRunningByQueueTx`, not by this mutex. |
| **2** Queue concurrency limit | `DispatchQueue.concurrency` | How many handlers run per queue | full handler runtime | Per-queue parallelism throttle. Counts only `running` rows (`pending`/`delayed` occupy no worker slot), so the cap bounds concurrent handlers regardless of backlog depth — a queue can hold an unbounded pending backlog at any `concurrency`. |
| **3** Business mutex | Handler-owned | Resource-specific (vector store write, file IO, …) | handler-decided | Serializes critical sections across process restarts (Layer 2 alone does not survive restart). |

## Acquisition order

Layer 1 (the per-queue dispatch mutex) is acquired first; the count→claim section then enters Layer 0 via `withWriteTx` and releases Layer 1 afterward. Because `withWriteTx` now runs as a synchronous `BEGIN IMMEDIATE` transaction that holds no async lock, Layer 1 is the only mutex in the dispatch path, so there is no cross-layer lock-ordering deadlock to guard against.

Non-dispatch writes (`scheduleRetry`, `finalizeJob`, `patchMetadata`, `cancel`, `cancelMany`, recovery, GC, schedule CRUD) run outside the dispatch path — no queue tick semantics, so Layer 1 is not involved. The multi-statement ones (e.g. `cancelMany`) use `withWriteTx`; the single-statement ones write through `getDb()` directly. Both still serialize on the one synchronous connection.

Layers 2 and 3 are counters / resource locks, not mutexes — outside this ordering rule.

## Common trap

**`queue=base.${baseId}` with `concurrency=1` does NOT replace a business mutex.** After crash + restart, recovery='retry' spawns a new handler instance for the same job. Layer 2 sees the new running row, but the old in-flight write may still be observed at OS level. **Always pair Layer 2 with Layer 3 for resource serialization across restarts.**

## Failure recovery

A row stuck in `running` (e.g. the `spawnExecute` fallback chain swallowed a DB error) is reclaimed on the next process restart by `runStartupRecovery`. Mid-session recovery is not implemented — the case requires persistent DB-level failure (`SQLITE_CORRUPT`/`FULL`), which would also break any in-process reclaim attempt.

## Other services using `withWriteTx`

`DbService.withWriteTx` is the conventional wrapper for multi-statement / read-then-write mutations (a direct `db.transaction()` is equivalent under the single synchronous connection); single writes go through `getDb()` directly (see [Write Serialization](../data/database-patterns.md#write-serialization-dbservicewithwritetx)). JobService / JobScheduleService follow this split across their hot write paths.

Reads do NOT need `withWriteTx` — WAL gives readers snapshot isolation, never blocked by writers.

## Summary diagram

```
┌─ Layer 0: Sync write tx (DbService.withWriteTx) ──────┐  Serializes ALL writes
│ ┌─ Layer 1: Per-queue dispatch mutex ────────────────┐ │  Serializes same-queue ticks
│ │ ┌─ Layer 2: Queue concurrency limit ─────────────┐ │ │  N handlers per queue
│ │ │ ┌─ Layer 3: Business mutex ──────────────────┐ │ │ │  Resource serialization across restart
│ │ │ │ handler.execute() runs                     │ │ │ │
│ │ │ └────────────────────────────────────────────┘ │ │ │
│ │ └────────────────────────────────────────────────┘ │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
       ↑ outside the orchestrator's lock — long
       ↑ inside the orchestrator's lock — microseconds
```
