---
description: 'Knowledge workflow architecture: scheduling model, durable JobManager jobs, per-base mutation lock, crash semantics'
sources:
  - src/main/features/knowledge/ingestion
  - src/main/features/knowledge/ingestion/indexKnowledgeItem.ts
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

- `addItems` resolves after root rows are created and first Knowledge jobs are queued. A file (or a url restored with a snapshot) has only its `raw/` name reserved at that point; its bytes land later through `knowledge.copy-sources`. Restore passes `copyInline` to copy inside the call and keep its all-or-nothing rollback.
- `deleteItems` resolves after top-level target subtrees are atomically checked for active external document ownership, marked `deleting` and `knowledge.delete-subtree` is queued.
- `reindexItems` resolves after each top-level target subtree is confirmed terminal (`completed` or `failed`) and one `knowledge.reindex-subtree` job per root is queued.

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

A newly added item that still owes bytes (a file, or a url restored with a snapshot) is not passed to `scheduleItem` by `addItems`. `addItems` enqueues `knowledge.copy-sources` instead, and that job calls `scheduleItem` once the bytes are committed, so source planning and FileProcessing never see a file that has not landed.

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

A future external synchronizer may reuse `prepareKnowledgeMaterial` by passing
an explicit descriptor for a staged snapshot. It must not reuse
`indexKnowledgeItem` as a publication operation: preparation alone neither
opens the store nor changes row visibility.

### Future External Publication Constraint

Layer 2 does not implement the external synchronizer or its writer. That future
writer must preserve this visibility protocol:

1. Stage the provider-normalized snapshot and run slow preparation outside the
   base mutation lock, using a distinct versioned snapshot path and new item id.
2. Acquire the base lock, then recheck the source revision and current document
   owner before publishing anything.
3. Write the prepared material under the new item id while the staged snapshot
   and material remain invisible: neither is reachable from a visible main-DB
   `knowledge_item` row yet.
4. In one main-database transaction, create the new external item already
   `completed`, switch the document's owner, content hash, and remote revision
   to that item, then delete the now-unowned old item row. The transaction must
   not leave the old item visible as ownerless static content.
5. After commit, remove the old snapshot and vector material best-effort. If the
   main-DB transaction fails, compensate by removing the unpublished new
   artifacts; startup reconciliation must collect residue from either cleanup
   direction.

The main database and per-base index store cannot participate in one distributed
transaction. Cross-store consistency therefore depends on invisibility before
the main-DB commit plus compensation and reconciliation, not distributed
atomicity.

## Job Types

Registered job types:

- `knowledge.copy-sources`: stream an added item's source bytes into temp files beside its reserved `raw/` names off the lock, then under the lock confirm the item is live and commit the renames, then call `scheduleItem`. A failed copy fails only that item; a delete that lands mid-copy discards the temp files.
- `knowledge.prepare-root`: pin the container's `raw/` prefix under the lock, scan and copy the tree off it, create the child rows under it, and schedule each child.
- `knowledge.index-documents`: read/chunk/embed/write vectors for a concrete document source. Empty reader results or zero chunks fail the item without replacing its existing material.
- `knowledge.delete-subtree`: cancel active subtree jobs and the FileProcessing jobs its items wait on, delete vectors, delete base-directory files, then delete resolved item ids with `deleteItemsByIds`. The create/index path does not register FileManager refs, so there is no separate file-ref detach step; any historical `FileEntry` rows are left to the file module's no-reference policy.
- `knowledge.reindex-subtree`: for terminal subtrees only, activate the selected roots under the lock, re-acquire their bytes off it (an active root is invisible to search, so its old index is never served against new bytes), then under the lock again delete vectors, remove stale container descendants, reset selected root state, then call `scheduleItem`. Selected leaf roots keep their source files on disk and are repaired by `index-documents` from `knowledge_item.data`.

- `knowledge.check-file-processing-result`: inspect the settled FileProcessing job, record the converted markdown's location on the item (via `updateIndexedRelativePath`) on success, then schedule indexing.

`knowledge_base.fileProcessorId` controls source planning for supported file items. When a source needs conversion, the workflow starts FileProcessing, schedules `knowledge.check-file-processing-result` once that job settles, records the converted markdown's location on the item via `updateIndexedRelativePath` (the `indexedRelativePath` leaf field, not a separate file-ref artifact row), then indexes that markdown.

Nothing polls while the file is processed. `scheduleItem` waits on the FileProcessing
job's `JobHandle.finished` and enqueues one `check-file-processing-result` when it
settles. Until then the item is registered in `FileProcessingWaitManager`, which three
readers use:

- `KnowledgeService` copies each job's progress onto
  `knowledge.item.file_processing_progress.${itemId}` every 5 seconds, writing only
  values that changed, and the entry's removal clears it;
- delete, replace, and base deletion cancel the FileProcessing jobs of the items they
  remove. They read the registry only after their knowledge-job cancels settle,
  because a copy job cancelled after its commit still starts file processing;
- a failed `reindex-subtree` does not fail a root that is still waiting, just as it
  spares a root with an active follow-up job.

Knowledge sets no wait limit of its own: the FileProcessing handlers' timeouts (15
minutes for background jobs, 30 for remote polling) bound a running job, and a queued
job waits as long as the queue ahead of it. The registry lives in memory, like
`finished`; after a restart no item is waiting, and boot recovery fails the items left
in `processing`. On success the output's relative path is recorded via
`updateIndexedRelativePath`, then `index-documents` is scheduled.

Knowledge starts these FileProcessing jobs with `recovery: 'abandon'`. Boot recovery fails an
interrupted item (`recoverInterruptedItems`), so its conversion is cancelled at startup instead of
resuming into a result nothing reads, and cannot later overwrite the markdown of a same-named
replacement.

## Mutation And Crash Semantics

Same-base Knowledge mutations must go through the per-base mutation lock (`KeyedMutex.runExclusive`). Main SQLite writes still use a synchronous write transaction (`DbService.withWriteTx`, or an equivalent `db.transaction()`); the mutation lock is not a replacement for that write transaction.

Crash safety comes from durable jobs, durable item states, JobManager recovery, and idempotent cleanup. The in-memory mutation lock only serializes concurrent work in the current process.

Delete and reindex span two stores: the main SQLite database and the per-base vector store. They cannot be one cross-store transaction. Consistency relies on durable re-entry and idempotent vector/artifact/row cleanup.

Delete admission is still a single-main-database transaction: recursive
`deleting` status writes, active external-document ownership enforcement, and
job enqueueing commit or roll back together. The renderer's subtree-aware
`canDelete` field is only a read projection and cannot bypass this check.

User-triggered reindex is not a cancellation primitive. The service admits reindex only when the entire selected subtree is already `completed` or `failed`. Active states (`idle`, `preparing`, `processing`, `reading`, `embedding`) and `deleting` are rejected; delete remains the operation that can be requested at any time.
