# Knowledge Operation Guards

This document records the guard and recovery semantics for the three caller-facing knowledge item operations:

- `addItems`
- `deleteItems`
- `reindexItems`

The operations intentionally do not share one generic validation pipeline. They share small guards where the semantics match, but each operation keeps its own explicit flow because their state transitions and enqueue-failure behavior are different.

## Shared Helpers

### `assertBaseCanRunRuntimeOperation`

Used by operations that create or rebuild runtime work on an existing base.

- `addItems`: rejects `failed` bases.
- `reindexItems`: rejects `failed` bases.
- `deleteItems`: does not use this guard. Deleting a failed base's items must remain possible so callers can clean up recoverable or partially migrated data.

### `getRootItemsInBase`

Used by id-based operations.

- De-duplicates input item ids.
- Loads each selected item.
- Rejects items that do not belong to the requested `baseId`.

This guard is not used by `addItems` because `addItems` receives new item payloads, not persisted item ids.

### `getTopLevelItemsInBase`

Used by subtree operations.

- Starts from `getRootItemsInBase`.
- Removes selected descendants when their selected ancestor is already present.
- Prevents the same subtree from being deleted or reindexed more than once in a single request.

## `addItems`

`addItems` accepts new item payloads and creates persisted `knowledge_item` rows before scheduling the first workflow jobs.

```text
addItems(baseId, inputs)
  -> reject failed base
  -> no-op on empty inputs
  -> under same-base mutation lock:
       create each item
       set root status to preparing for containers
       set root status to processing for leaves
       rollback created rows if create/status update fails
  -> schedule each accepted item
       container -> knowledge.prepare-root
       leaf      -> knowledge.index-documents
       invalid   -> mark item failed, no job
       deleting  -> skip
  -> if enqueue throws:
       mark accepted items that did not finish scheduling as failed
       rethrow
```

### Why Enqueue Failure Marks Items Failed

`addItems` writes an active status before enqueueing. If enqueue fails after the mutation block, the row would otherwise stay in `preparing` or `processing` without a durable job to advance it.

The compensating rule is:

- items whose scheduling completed are left alone, because they already have a job or an intentional no-job terminal decision;
- the failing item and any later accepted items are marked `failed`;
- the original enqueue error is rethrown to the caller.

This prevents stuck active rows while avoiding deletion of rows that may already be referenced by a queued job.

## `deleteItems`

`deleteItems` operates on existing item ids and is modeled as a durable cleanup state machine.

```text
deleteItems(baseId, itemIds)
  -> de-duplicate ids
  -> load selected items
  -> reject items outside baseId
  -> collapse nested selections to top-level roots
  -> no-op if no roots remain
  -> under same-base mutation lock:
       mark selected root subtrees deleting
  -> enqueue knowledge.delete-subtree
       idempotency key = sorted root ids
  -> if enqueue throws:
       keep rows deleting
       schedule in-session deleting recovery
       log and rethrow
```

### Why Enqueue Failure Keeps `deleting`

`deleting` is a recoverable intermediate state, not a terminal error. Once a subtree is marked `deleting`, other runtime paths can stop treating it as normal searchable/indexable content.

If enqueue fails, the rows remain `deleting`. The service schedules an in-session deleting recovery pass, and startup recovery also scans deleting roots and re-enqueues cleanup jobs:

```text
deleteItems enqueue failure
  -> schedule deleting recovery once
  -> scan deleting root groups
  -> enqueue knowledge.delete-subtree in bounded chunks
  -> retry with backoff if scan or enqueue fails

onAllReady
  -> scan deleting root groups
  -> enqueue knowledge.delete-subtree in bounded chunks
  -> retry with backoff if scan or enqueue fails
```

Only one deleting recovery run is active at a time. If another delete enqueue fails while recovery is already active, the service records a pending recovery and runs another scan after the active pass completes. This makes delete cleanup durable across enqueue failure, process crash, and restart.

### Why Delete Cleanup Failure Does Not Mark Items `failed`

`knowledge.delete-subtree` is responsible for removing vector artifacts, detaching file references, and hard-deleting the `knowledge_item` rows. If that job fails or is cancelled after rows were already marked `deleting`, the rows must stay `deleting`.

Do not convert these rows to ordinary `failed` items as a terminal fallback:

- `deleting` is the state that hides requested-deletion content from default list, search, and RAG reads;
- `failed` means an indexing or preparation workflow failed, so list and search paths may treat the item as visible user data;
- if vector cleanup failed before all chunks were removed, `deleting -> failed` can make stale chunks searchable again;
- delete-base may cancel delete-subtree jobs because base deletion has taken ownership of cleanup, so cancellation is not always an item-level failure.

The recovery path for failed delete cleanup is to keep `deleting`, then let in-session or startup recovery enqueue another `knowledge.delete-subtree` job. If the product needs a user-visible terminal delete failure later, add an explicit delete-failure state or job-level UI, and keep that state excluded from default list, search, and RAG reads.

## `reindexItems`

`reindexItems` operates on existing item ids but does not change item state in the caller-facing entrypoint.

```text
reindexItems(baseId, itemIds)
  -> reject failed base
  -> de-duplicate ids
  -> load selected items
  -> reject items outside baseId
  -> collapse nested selections to top-level roots
  -> no-op if no roots remain
  -> enqueue knowledge.reindex-subtree
       idempotency key = sorted root ids
```

### Why Reindex Does Not Pre-Mark Items Active

The reindex entrypoint only accepts the durable job. It does not set roots to `preparing` or `processing` before enqueueing.

The reindex job owns the destructive and stateful work:

- run the shared cleanup prefix;
- skip if the target subtree is already `deleting`;
- reset subtree item state;
- call `scheduleItem` for each selected root.

Because the entrypoint does not write an active status before enqueueing, enqueue failure can be reported directly without leaving stuck active rows.

### Delete Wins Reindex Races

`reindex-subtree` treats `deleting` as a higher-priority state:

- before cancelling old work, it checks the target subtree and completes as skipped if any item is `deleting`;
- after cancelling old non-delete work, it checks again under the same-base mutation lock before clearing vectors or resetting statuses;
- it does not cancel active `knowledge.delete-subtree` jobs that touch the same subtree.

This prevents a later reindex request from cancelling delete cleanup or turning a deleting row back into `preparing` / `processing`.

## `prepare-root`

`prepare-root` is an internal job, but it creates child rows and schedules their leaf indexing jobs, so it has its own cleanup and compensation rules.

```text
knowledge.prepare-root(baseId, itemId)
  -> skip missing or deleting roots
  -> under same-base mutation lock:
       find previous descendants
       ignore descendants already deleting
       clear vectors for removable leaf descendants
       detach file refs for removable descendants
       hard-delete removable descendants
  -> under same-base mutation lock:
       expand source into new child rows
       set root status processing
  -> schedule each recreated leaf
       if scheduling fails:
         mark leaves that did not finish scheduling failed
         leave already scheduled leaves alone
         rethrow
```

The stale expansion cleanup clears vectors and file refs before hard-deleting rows so a retry does not leave orphan artifacts from a previous partial expansion.

The child scheduling compensation mirrors `addItems`: once a child job was accepted, the row is left alone; the failing child and later children are marked `failed` so no `processing` leaf remains without a job.

## Shutdown

`KnowledgeOrchestrationService` does not cancel knowledge jobs during service shutdown. Knowledge job handlers use JobManager `recovery: 'retry'`, so unfinished pending, delayed, or running rows are left for JobManager startup recovery instead of being terminal-cancelled while their knowledge items still show active statuses.

## Review Checklist

When changing these operations, check the operation-specific failure behavior before extracting shared code.

| Operation | Failed base | Root collapse | State before enqueue | Enqueue failure |
| --- | --- | --- | --- | --- |
| `addItems` | Reject | N/A | `preparing` / `processing` | Mark unscheduled accepted rows `failed` |
| `deleteItems` | Allow | Yes | `deleting` | Keep `deleting`; in-session and startup recovery retry |
| `reindexItems` | Reject | Yes | None | Throw; no active state was written |

Prefer shared helpers for exact common behavior, such as base-state guards, base ownership checks, root collapse, queue names, and idempotency key builders. Keep operation flows explicit when the state or recovery semantics differ.
