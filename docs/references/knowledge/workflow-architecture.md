---
description: 'Knowledge workflow architecture: scheduling model, durable JobManager jobs, per-base mutation lock, crash semantics'
sources:
  - src/main/features/knowledge/ingestion
  - src/main/features/knowledge/ingestion/indexKnowledgeItem.ts
  - src/main/features/knowledge/external
  - src/main/features/knowledge/tasks
  - src/main/features/knowledge/KnowledgeService.ts
---

# Knowledge Workflow Architecture

This document records the implemented Knowledge workflow architecture.

## Goals

Knowledge operations are modelled as a lightweight workflow rather than a single indexing pipeline:

```text
API / user action
  -> KnowledgeIngestionService
     -> JobManager
        -> Knowledge job handlers
           -> KeyedMutex.runExclusive
              -> SQLite / index store / knowledge-owned files (raw/)
```

The design keeps three owners:

- `KnowledgeIngestionService` decides the next workflow step.
- The per-base mutation lock (`KeyedMutex.runExclusive`) serializes same-base mutations and cleanup.
- Knowledge job handlers execute one durable stage and call the workflow service for the next step.

Helpers may own source planning, lifecycle writes, knowledge-owned raw files, and FileProcessing adaptation. They should stay as modules until they need lifecycle-managed resources, IPC, timers, or long-lived state.

## Workflow Entry Points

`addItems`, `deleteItems`, and `reindexItems` are async workflow entry points. API resolution means the durable workflow has been accepted, not that every physical side effect has finished.

- `addItems` resolves after root rows are created and first Knowledge jobs are queued.
- `deleteItems` resolves after top-level target subtrees are atomically confirmed not to contain active document-owned external items, marked `deleting`, and queued for `knowledge.delete-subtree`.
- `reindexItems` resolves after each top-level target subtree is confirmed terminal (`completed` or `failed`) and `knowledge.reindex-subtree` is queued.
- External Source creation resolves after trusted URL resolution and one
  transaction rechecks the current base, connection, authorization state,
  resolved tenant, and provider-scope uniqueness, creates the Source, enqueues
  `knowledge.sync-external-source`, and binds its active Job fence. Manual
  synchronization resolves after that same per-Source Job is enqueued or
  coalesced.

Default item list, search, and RAG hydration exclude `deleting` items. `deleting` is a durable cleanup marker, not a tombstone or terminal success state.

`addItems` supports three root-name conflict strategies: `rename` allocates a
collision-free `_N` name, `detect` reports conflicts without writing, and
`replace` cancels/purges conflicting roots before importing the replacements.

## Scheduling Model

The workflow service owns all branching:

```text
scheduleItem(baseId, itemId)
  directory         -> enqueue knowledge.prepare-root
  external          -> enqueue knowledge.index-documents for its pinned snapshot
  file / note / url -> source planning
       direct         -> enqueue knowledge.index-documents
       invalid        -> mark item failed
       needs processing -> Round 2 FileProcessing path
```

Job handlers do not decide whether an item is a root, nested container, direct leaf, or FileProcessing candidate. They perform their current stage and re-enter the workflow service.

## Recursive Container Expansion

`knowledge.prepare-root` expands a `directory` item and creates or replaces its child rows. Expansion results must not assume every child is a leaf:

```text
prepare-root(container)
  -> create/replace child rows
  -> for each child:
       workflowService.scheduleItem(baseId, childId)
```

If a child is another `directory`, `scheduleItem` queues another `knowledge.prepare-root`. If a child is `file`, `note`, `url`, or `external`, `scheduleItem` routes it to indexing. Recursive processing therefore lives in the workflow service loop, not inside a reader-specific branch.

## Indexing Operation

The reusable indexing layer is `prepareKnowledgeMaterial`. Given a completed
base, an explicit `IndexableKnowledgeItem` descriptor, an abort signal, and
progress callbacks, it reads the descriptor's local input, chunks it, performs
the narrow existing-embedding hash lookup supplied by its caller, embeds only
missing chunk bodies, and returns `RebuildMaterialInput`. It validates base
readiness, the item's material path, abort state, and non-empty output, but it
does not open or publish an index store, mutate a `knowledge_item` row, capture
or move a snapshot, or mark anything completed.

`createIndexKnowledgeItem` composes that preparation kernel into the existing
Job operation with this call shape:

```ts
indexKnowledgeItem({ baseId, itemId, signal, reportProgress })
```

`indexKnowledgeItem` remains the owner of live base/item lookup, lifecycle and
status handling, URL/note capture, base-lock acquisition, the final live-item
recheck, vector-store `rebuildMaterial`, and the `completed` transition. The
current `knowledge.index-documents` handler only adapts JobManager context to
this operation and retains the job's existing retry, timeout, recovery, and
settled semantics. External items use their already-pinned local snapshot; this
layer does not perform provider I/O.

`ExternalKnowledgeSyncService` reuses `prepareKnowledgeMaterial` with an
explicit descriptor for a staged snapshot. It does not reuse
`indexKnowledgeItem` as a publication operation: the external workflow owns
its Source/Document fences, index-store publication, and row visibility.

### External Publication Protocol

The implemented external writer preserves this visibility protocol:

1. Create an external `knowledge_item` with status `deleting` before any snapshot,
   material, or vector side effect. The row is invisible to normal reads and is
   the durable locator for the distinct versioned snapshot path and new item id.
2. Stage the provider-normalized snapshot and run slow preparation outside the
   base mutation lock.
3. Acquire the base lock, then recheck the source revision, current document
   owner, and exact deleting external staging row before rebuilding vectors.
4. Write the prepared material under the new item id while its `deleting` row
   keeps the staged snapshot and material invisible.
5. In one main-database transaction, CAS-promote that exact external staging row
   to `completed`, switch the document's owner, content hash, and remote revision,
   mark any old owner subtree `deleting`, and enqueue `knowledge.delete-subtree`.
   A successful sync guarantees the old content is hidden and cleanup is durably
   accepted, not that its physical bytes have already been removed.

Snapshot staging, material preparation, vector rebuilding, or publication failure
leaves the new `deleting` row intact and attempts cleanup admission in a separate
short transaction. Failure to admit cleanup is logged without replacing the
original error; startup recovery and the beginning of later Source syncs rescan
committed deleting roots, excluding staging ids active in this process, and retry
admission. Missing and permission-denied
reconciliation similarly withdraw ownership, mark the old owner deleting, and
enqueue cleanup atomically.

One `knowledge.sync-external-source` Job owns the complete scan, incremental
document synchronization, and missing-document reconciliation. Reconciliation
runs only after a complete scan; fatal and cancelled runs retain documents not
observed by that run. Only the Job's `AbortSignal` is cancellation authority—a
dependency `AbortError` while that signal remains active follows the stable
scan/document/reconciliation failure policy.

The main database and per-base index store cannot participate in one distributed
transaction. Cross-store consistency therefore depends on the durable invisible
staging/deleting row, idempotent cleanup admission, and reconciliation, not
distributed atomicity.

## Job Types

Registered job types:

- `knowledge.prepare-root`: expand a container and schedule each child.
- `knowledge.index-documents`: call `indexKnowledgeItem` to read/chunk/embed/rebuild a concrete document source. Empty reader results or zero chunks fail the item without replacing the existing material.
- `knowledge.delete-subtree`: cancel active non-cleanup subtree jobs, then under the base lock re-read deleting rows, delete vectors, strictly delete external snapshots, best-effort delete ordinary base-directory files, and delete resolved item ids with `deleteItemsByIds`. Sibling delete-subtree jobs are not cancelled; overlapping cleanup converges through the locked re-read and becomes an idempotent no-op after another job wins. A strict external deletion failure preserves every target row, including its `deleting` locator, so recovery can retry. The create/index path does not register FileManager refs, so there is no separate file-ref detach step; any historical `FileEntry` rows are left to the file module's no-reference policy.
- `knowledge.reindex-subtree`: for terminal subtrees only, delete vectors, remove stale container descendants, reset selected root state, then call `scheduleItem`. Selected leaf roots keep their source files on disk and are repaired by `index-documents` from `knowledge_item.data`.
- `knowledge.check-file-processing-result`: poll or inspect the FileProcessing job, record the converted markdown's location on the item (via `updateIndexedRelativePath`) on success, then schedule indexing.
- `knowledge.sync-external-source`: scan one persisted Source, publish supported
  documents incrementally, reconcile missing or permission-denied documents,
  and settle the Source through revision plus active-Job fences. Initial and
  manual requests share this handler and a per-Source idempotency key. Settled
  projection classifies timeout only from JobManager's structured
  `JOB_HANDLER_TIMEOUT` error code, ahead of handler metadata.

`knowledge_base.fileProcessorId` controls source planning for supported file items. When a source needs conversion, the workflow starts FileProcessing, schedules `knowledge.check-file-processing-result`, records the converted markdown's location on the item via `updateIndexedRelativePath` (the `indexedRelativePath` leaf field, not a separate file-ref artifact row), then indexes that markdown.

`check-file-processing-result` is a polling job:
`scheduleFileProcessingCheck` reschedules it at
`FILE_PROCESSING_CHECK_DELAY_MS = 5_000` intervals until the FileProcessing job
reaches a terminal state. After `FILE_PROCESSING_MAX_WAIT_MS = 30 * 60 * 1000`,
the remote job is cancelled and the item is marked `failed`. On success the
output's relative path is recorded via `updateIndexedRelativePath`, then
`index-documents` is scheduled.

## Mutation And Crash Semantics

Same-base Knowledge mutations must go through the per-base mutation lock (`KeyedMutex.runExclusive`). Main SQLite writes still use a synchronous write transaction (`DbService.withWriteTx`, or an equivalent `db.transaction()`); the mutation lock is not a replacement for that write transaction.

Crash safety comes from durable jobs, durable item states, JobManager recovery, and idempotent cleanup. The in-memory mutation lock only serializes concurrent work in the current process.

Delete and reindex span two stores: the main SQLite database and the per-base vector store. They cannot be one cross-store transaction. Consistency relies on durable re-entry and idempotent vector/artifact/row cleanup.

Delete admission is still a single-main-database transaction: recursive
`deleting` status writes, active external-document ownership enforcement, and
job enqueueing commit or roll back together. The renderer's subtree-aware
`canDelete` field is only a read projection and cannot bypass this check.

The same subtree-deletion primitive admits external replacement, reconciliation,
and staging cleanup. Recovery groups committed deleting roots by base, chunks
each group into at most 500 roots per transaction and Job after excluding external
staging ids active in this process, and logs one failed scan or admission without
preventing other groups from being attempted. Process failure drops the in-memory
exclusion, leaving the committed deleting row available to later recovery.

User-triggered reindex is not a cancellation primitive. The service admits reindex only when the entire selected subtree is already `completed` or `failed`. Active states (`idle`, `preparing`, `processing`, `reading`, `embedding`) and `deleting` are rejected; delete remains the operation that can be requested at any time.
