# Concurrency & Locks (Four-Layer Model)

JobManager uses four orthogonal lock layers to keep correctness under concurrent dispatch and protect business resources from cross-handler interference.

## Layer 0: Global dispatch mutex (held by JobManager singleton)

**Scope**: All dispatch transactions across all queues.
**Held for**: Microseconds — the duration of one (count → fetch → claim) transaction.
**Purpose**: libsql async client issue [#288](https://github.com/tursodatabase/libsql-client-ts/issues/288): default `busy_timeout` is not honored, multiple concurrent `db.transaction()` interlock each other into `SQLITE_BUSY`. Layer 0 serializes all dispatch transactions through a single Mutex so libsql never sees concurrent BEGIN.

**Without this layer**: 1000+ queues triggering dispatch simultaneously hit SQLITE_BUSY immediately under high load.

## Layer 1: Per-queue dispatch mutex (per DispatchQueue instance)

**Scope**: Single queue's (count → fetch → claim) section.
**Held for**: Microseconds.
**Purpose**: Two concurrent dispatchers on the same queue must not both see "queueActive < concurrency" and both claim the next pending row.

**Why both Layer 0 + Layer 1?** Layer 0 only serializes the tx-begin; Layer 1 ensures the count → claim sequence is atomic for the queue. Acquisition order is fixed (per-queue first, then global) to avoid deadlock between the two layers.

## Layer 2: Queue concurrency limit (`DispatchQueue.concurrency`)

**Scope**: How many handlers in this queue run simultaneously.
**Held for**: The full handler execution period.
**Purpose**: Throttle parallelism per queue — e.g., per-base indexing at concurrency=5.

**Critical**: Layer 2 alone does NOT protect against same-resource concurrent writes after restart. If a process crashes mid-write to a vector store, the new handler instance (recovery='retry') starts before the old write is fully observed by the OS. Layer 2 only counts active *jobs*, not in-flight *writes*.

## Layer 3: Business-level mutex (handler-owned)

**Scope**: Resource-specific (vector store write, file IO, external API rate limit).
**Held for**: Decided by handler.
**Purpose**: Serialize critical sections that survive process restart.

**Example**: `KnowledgeRuntimeService.runWithBaseWriteLockForBase(baseId, fn)` — singleton-owned mutex keyed by baseId, so even if recovery spawns a new handler instance, both old and new code paths acquire the same lock and write atomically.

## Lock acquisition order

Layer 0 (global) and Layer 1 (per-queue) are both `async-mutex` instances. Every call site that needs to hold both takes them in a **fixed order**:

1. Layer 1 — per-queue mutex (specific to the queue being dispatched)
2. Layer 0 — global dispatch mutex

Release order is reverse: Layer 0 first, Layer 1 second. This invariant is what makes deadlock between the two layers impossible — if any path inverted the order (took global first, then per-queue), two dispatchers operating on different queues could each be waiting for the lock the other holds.

Layers 2 and 3 are not mutexes in the same sense (a counter and a handler-owned resource lock respectively), so they fall outside this ordering rule. When you add a new dispatch site or refactor existing claim paths, mirror the existing pattern in `JobManager.dispatch` to keep this invariant intact — there is no runtime detection of misordering.

## Common trap

**"Setting `queue=base.${baseId}` with `concurrency=1` replaces business-level locks."** WRONG.

Why: After crash + restart, recovery='retry' starts a *new* handler instance for the same job. The new instance enters Layer 2 (queue active count from DB reflects the new running row), but the *old* in-flight write may still be observed by the filesystem / vector store at OS level. Without Layer 3, you have two writers to the same resource.

**Always combine Layer 2 (parallelism cap) with Layer 3 (resource serialization).**

## Summary diagram

```
┌─ Layer 0: Global dispatch mutex ─────────────┐  Serializes all libsql txs
│ ┌─ Layer 1: Per-queue dispatch mutex ──────┐ │  Serializes same-queue claim
│ │ ┌─ Layer 2: Queue concurrency limit ───┐ │ │  N handlers per queue
│ │ │ ┌─ Layer 3: Business mutex ────────┐ │ │ │  Resource-level serialization
│ │ │ │ handler.execute() runs           │ │ │ │  (handler-owned, survives restart)
│ │ │ └──────────────────────────────────┘ │ │ │
│ │ └──────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
       ↑ outside the orchestrator's lock — long
       ↑ inside the orchestrator's lock — microseconds
```
