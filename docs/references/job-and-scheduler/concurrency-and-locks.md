# Concurrency & Locks (Four-Layer Model)

JobManager uses four orthogonal lock layers under concurrent dispatch.

| Layer | Owner | Scope | Held for | Purpose |
| --- | --- | --- | --- | --- |
| **0** Global write mutex | `DbService.writeMutex` | All write transactions across the app (every `withWriteTx` callsite) | µs — one tx | Serializes writes around libsql client-ts issue [#288](https://github.com/tursodatabase/libsql-client-ts/issues/288) (`busy_timeout` ineffective for async tx). Reusable by any service. |
| **1** Per-queue dispatch mutex | `DispatchQueue.mutex` | One queue's (count → claim) section | µs | Serializes ticks against the same queue to avoid wasted Layer 0 traffic. Concurrency cap is enforced by SQL `countRunningByQueueTx`, not by this mutex. |
| **2** Queue concurrency limit | `DispatchQueue.concurrency` | How many handlers run per queue | full handler runtime | Per-queue parallelism throttle. Counts only `running` rows (`pending`/`delayed` occupy no worker slot), so the cap bounds concurrent handlers regardless of backlog depth — a queue can hold an unbounded pending backlog at any `concurrency`. |
| **3** Business mutex | Handler-owned | Resource-specific (vector store write, file IO, …) | handler-decided | Serializes critical sections across process restarts (Layer 2 alone does not survive restart). |

## Acquisition order

Layer 1 first, then Layer 0 (entered via `withWriteTx`). Release reverses. Inverting the order deadlocks two dispatchers on different queues.

Non-dispatch writes (`scheduleRetry`, `finalizeJob`, `patchMetadata`, `cancel`, `cancelMany`, recovery, GC, schedule CRUD) call `withWriteTx` directly — no queue tick semantics, so Layer 1 is not involved.

Layers 2 and 3 are counters / resource locks, not mutexes — outside this ordering rule.

## Common trap

**`queue=base.${baseId}` with `concurrency=1` does NOT replace a business mutex.** After crash + restart, recovery='retry' spawns a new handler instance for the same job. Layer 2 sees the new running row, but the old in-flight write may still be observed at OS level. **Always pair Layer 2 with Layer 3 for resource serialization across restarts.**

## Failure recovery

A row stuck in `running` (e.g. the `spawnExecute` fallback chain swallowed a non-BUSY DB error) is reclaimed on the next process restart by `runStartupRecovery`. Mid-session recovery is not implemented — the case requires persistent DB-level failure (`SQLITE_CORRUPT`/`FULL`), which would also break any in-process reclaim attempt.

## Other services using `withWriteTx`

`DbService.withWriteTx` is opt-in. Migrated today: JobService + JobScheduleService (covers all hot write paths). High-frequency writes elsewhere (e.g. `AgentSessionMessageService` streaming inserts) should migrate when convenient.

Reads do NOT need `withWriteTx` — WAL gives readers snapshot isolation, never blocked by writers.

## Summary diagram

```
┌─ Layer 0: Global write mutex (DbService.writeMutex) ──┐  Serializes ALL writes
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
