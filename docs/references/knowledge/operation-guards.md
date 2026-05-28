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

### `KnowledgeItemService.getOutermostSelectedItemIds`

Used by subtree id-based operations: `deleteItems` and `reindexItems`.

- De-duplicates input item ids.
- Loads each selected item.
- Rejects items that do not belong to the requested `baseId`.
- Removes selected descendants when their selected ancestor is already present.
- Prevents the same subtree from being deleted or reindexed more than once in a single request.

This helper is not used by `addItems` because `addItems` receives new item payloads, not persisted item ids.

### `KnowledgeOrchestrationService.getRootItemsInBase`

Private helper used only by single-item chunk operations.

- De-duplicates input item ids.
- Loads each selected item.
- Rejects items that do not belong to the requested `baseId`.

Subtree operations do not use this helper; they use `KnowledgeItemService.getOutermostSelectedItemIds` instead.

### Subtree Status Reconciliation

Any non-delete subtree status update must reconcile parent containers outside the updated subtree. For example, if a child subtree is marked `failed` after a scheduling failure, the parent directory must also be recalculated so it does not remain `processing` without active work.

Subtree membership must be resolved in the same serialized write transaction as the status write. Do not precompute subtree ids before entering `DbService.withWriteTx`; a concurrent create/delete between the read and update can leave descendants visible or reconcile containers against stale membership.

### Hard Delete FileRef Cleanup

Final hard deletes must clear Knowledge `file_ref` rows for the full deletion subtree in the same `DbService.withWriteTx` before deleting `knowledge_item` rows. `file_ref.sourceId` is polymorphic and has no FK to `knowledge_item`; deleting a container cascades child `knowledge_item` rows through `knowledge_item.groupId`, but the database cannot cascade their file refs.

`deleteItemsByIds` must therefore expand explicit ids to the full subtree with a recursive CTE for ref cleanup. Row deletion may still target the explicit ids and rely on the `groupId` cascade, but ref cleanup must use the complete subtree id set.

### `assertSubtreesCanReindex`

Used only by `reindexItems`.

- Runs after selected item ids have been collapsed to top-level roots.
- Loads each selected root subtree with roots included.
- Allows reindex only when every item in every selected subtree is terminal: `completed` or `failed`.
- Rejects active or deleting subtree state: `idle`, `preparing`, `processing`, `reading`, `embedding`, or `deleting`.

This is the backend authority for user-triggered reindex. UI may hide the reindex action for non-terminal rows, but the service guard must still reject stale or direct calls.

### Chunk Operations

Used by `listItemChunks` and `deleteItemChunk`.

- Rejects failed bases through `assertBaseCanRunRuntimeOperation`.
- Loads the requested item and rejects items outside the requested `baseId`.
- Allows chunk list/delete only when the requested item itself is `completed`.
- For completed `directory` / `sitemap` list requests, also rejects if any descendant is `deleting`.

The UI should only expose chunk viewing for completed rows, but the service guard remains the backend authority for stale or direct IPC calls. The extra container descendant check exists because container reconciliation ignores `deleting` children, so a container can stay `completed` while cleanup is still pending below it.

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
       idempotency key = knowledge:${baseId}:${sorted root ids}:delete
  -> if enqueue throws:
       keep rows deleting
       log and rethrow
```

### Why Enqueue Failure Keeps `deleting`

`deleting` is a recoverable intermediate state, not a terminal error. Once a subtree is marked `deleting`, other runtime paths can stop treating it as normal searchable/indexable content.

If enqueue fails, the rows remain `deleting`. The service does not run an in-session retry loop. Startup recovery scans deleting roots once and re-enqueues cleanup jobs best-effort:

```text
deleteItems enqueue failure
  -> keep rows deleting
  -> throw the enqueue error to the caller

onAllReady
  -> scan deleting root groups
  -> enqueue knowledge.delete-subtree in bounded chunks
  -> log scan or enqueue failures without retrying in-session
```

This keeps delete cleanup durable across process restart without maintaining a runtime recovery scheduler for the small enqueue-failure window.

### Why Delete Cleanup Failure Does Not Mark Items `failed`

`knowledge.delete-subtree` is responsible for removing vector artifacts, detaching Knowledge file references, and deleting the resolved `knowledge_item` rows. If that job fails or is cancelled after rows were already marked `deleting`, the rows must stay `deleting`.

Do not convert these rows to ordinary `failed` items as a terminal fallback:

- `deleting` is the state that hides requested-deletion content from default list, search, and RAG reads;
- `failed` means an indexing or preparation workflow failed, so list and search paths may treat the item as visible user data;
- if vector cleanup failed before all chunks were removed, `deleting -> failed` can make stale chunks searchable again;
- delete-base may cancel delete-subtree jobs because base deletion has taken ownership of cleanup, so cancellation is not always an item-level failure.

The recovery path for failed delete cleanup is to keep `deleting`, then let JobManager retry an existing `knowledge.delete-subtree` job or startup recovery enqueue another cleanup job for orphan deleting roots. If the product needs a user-visible terminal delete failure later, add an explicit delete-failure state or job-level UI, and keep that state excluded from default list, search, and RAG reads.

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
  -> reject unless every selected root subtree is completed or failed
  -> enqueue knowledge.reindex-subtree
       idempotency key = knowledge:${baseId}:${sorted root ids}:reindex
```

### Why Reindex Requires Terminal Subtrees

User-triggered reindex is intentionally an offline rebuild of an existing subtree, not a cancellation or preemption primitive.

Allowing reindex while a subtree is still `preparing`, `processing`, `reading`, or `embedding` would force `reindex-subtree` to coordinate with active indexing and expansion jobs. That reintroduces cancellation races: old jobs may still be reading, writing vectors, attaching refs, or expanding children while the reindex job is deleting vectors and resetting rows.

The simpler rule is:

- active work must finish as `completed` or `failed` before the user can reindex;
- failed work can be retried by reindexing because it is already terminal;
- deleting work cannot be reindexed because delete owns cleanup once the durable `deleting` intent is written;
- delete remains available at any time and is the only user action allowed to preempt active work.

### Why Reindex Does Not Pre-Mark Items Active

The reindex entrypoint only accepts the durable job. It does not set roots to `preparing` or `processing` before enqueueing.

The reindex job owns the destructive and stateful work:

- clear vectors for resolved leaf items;
- delete previous container descendants when selected roots are containers;
- keep selected leaf root file refs because those root items still own their source files;
- skip if the target subtree became `deleting` after the entrypoint guard;
- reset subtree item state;
- call `scheduleItem` for each selected root.

Because the entrypoint does not write an active status before enqueueing, enqueue failure can be reported directly without leaving stuck active rows.

### Delete Wins Reindex Races

`reindexItems` rejects `deleting` before enqueue, and `reindex-subtree` treats `deleting` as a higher-priority state if delete wins the race after enqueue:

- at job entry, it checks the target subtree and completes as skipped if any item is `deleting`;
- under the same-base mutation lock, it checks again before clearing vectors or resetting statuses;
- it does not cancel active jobs. Reindex is only admitted for terminal subtrees, so there should be no active indexing or expansion work to cancel.

This prevents a later reindex request from cancelling delete cleanup or turning a deleting row back into `preparing` / `processing`.

These two `deleting` checks are intentional, even though the entrypoint already rejects deleting subtrees. They cover the window between enqueue and job execution while preserving the rule that delete is always available.

### Why Reindex Keeps Schedule-Failure Compensation

After the reset mutation, selected roots are deliberately visible as `preparing` or `processing` before their follow-up jobs are scheduled. This keeps the UI honest: a user-triggered reindex immediately appears as active work.

Because those active statuses are written before `scheduleItem`, the handler must compensate if scheduling fails. The failing roots are marked `failed` so the UI does not show stuck active work without a durable job. Do not remove this compensation unless reindex introduces a separate non-active pending state, such as a dedicated `reindexing` or `pending_reindex` lifecycle state.

### Reindex FileRef Ownership

Knowledge source `file_ref` rows are business ownership refs, not vector artifacts. Reindex must not detach refs for selected leaf roots because the root `knowledge_item` rows remain alive and still read `data.fileEntryId`.

Leaf indexing repairs this relationship instead: `knowledge.index-documents` rebuilds Knowledge source refs from the current `knowledge_item.data` before reading the source. For file items, that creates the canonical `knowledge_item` / `source` ref to `data.fileEntryId`; for note and URL items, it clears stale Knowledge file refs.

File ref detach during reindex is valid only when rows are actually being removed, such as stale descendants from a container expansion. Those descendants are deleted through `deleteItemsByIds`, which performs full subtree ref cleanup in the delete transaction.

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
       delete removable descendants by resolved id
  -> under same-base mutation lock:
       re-read root and skip if it is now missing or deleting
       expand source into new child rows
       set root status processing
  -> schedule each recreated leaf
       if scheduling fails:
         mark leaves that did not finish scheduling failed
         leave already scheduled leaves alone
         rethrow
```

The stale expansion cleanup clears vectors and file refs before deleting resolved descendant rows so a retry does not leave stale vectors or file refs from a previous partial expansion.

The second root read closes the race where `prepare-root` loads an active root, then a delete request marks that root `deleting` before expansion starts. Once a root is deleting, no new children may be created under it.

The child scheduling compensation mirrors `addItems`: once a child job was accepted, the row is left alone; the failing child and later children are marked `failed` so no `processing` leaf remains without a job.

## Shutdown

`KnowledgeOrchestrationService` does not cancel knowledge jobs during service shutdown. Knowledge job handlers use JobManager `recovery: 'retry'`, so unfinished pending, delayed, or running rows are left for JobManager startup recovery instead of being terminal-cancelled while their knowledge items still show active statuses.

## Review Checklist

When changing these operations, check the operation-specific failure behavior before extracting shared code.

| Operation | Failed base | Root collapse | Extra status guard | State before enqueue | Enqueue failure |
| --- | --- | --- | --- | --- | --- |
| `addItems` | Reject | N/A | N/A | `preparing` / `processing` | Mark unscheduled accepted rows `failed` |
| `deleteItems` | Allow | Yes | N/A | `deleting` | Keep `deleting`; startup recovery best-effort re-enqueues |
| `reindexItems` | Reject | Yes | Entire selected subtree must be `completed` or `failed` | None | Throw; no active state was written |
| `listItemChunks` / `deleteItemChunk` | Reject | N/A | Requested item must be `completed`; container list rejects deleting descendants | N/A | N/A |

Prefer shared helpers for exact common behavior, such as base-state guards, base ownership checks, root collapse, queue names, and idempotency key builders. Keep operation flows explicit when the state or recovery semantics differ.
