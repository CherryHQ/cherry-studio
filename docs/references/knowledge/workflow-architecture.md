# Knowledge Workflow Architecture

This document records the intended v2 Knowledge workflow architecture. It is the canonical reference for the runtime workflow; temporary RFC copies under `v2-refactor-temp/` may be removed before release.

## Goals

Knowledge operations are modelled as a lightweight workflow rather than a single indexing pipeline:

```text
API / user action
  -> KnowledgeWorkflowService
     -> JobManager
        -> Knowledge job handlers
           -> KnowledgeLockManager
              -> SQLite / vector store / FileManager
```

The design keeps three owners:

- `KnowledgeWorkflowService` decides the next workflow step.
- `KnowledgeLockManager` serializes same-base mutations and cleanup.
- Knowledge job handlers execute one durable stage and call the workflow service for the next step.

Helpers may own source planning, lifecycle writes, artifact refs, and FileProcessing adaptation. They should stay as modules until they need lifecycle-managed resources, IPC, timers, or long-lived state.

## Workflow Entry Points

`addItems`, `deleteItems`, and `reindexItems` are async workflow entry points. API resolution means the durable workflow has been accepted, not that every physical side effect has finished.

- `addItems` resolves after root rows are created and first Knowledge jobs are queued.
- `deleteItems` resolves after top-level target subtrees are marked `deleting` and `knowledge.delete-subtree` is queued.
- `reindexItems` resolves after each top-level target subtree is confirmed terminal (`completed` or `failed`) and `knowledge.reindex-subtree` is queued.

Default item list, search, and RAG hydration exclude `deleting` items. `deleting` is a durable cleanup marker, not a tombstone or terminal success state.

## Scheduling Model

The workflow service owns all branching:

```text
scheduleItem(baseId, itemId)
  directory         -> enqueue knowledge.prepare-root
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

If a child is another `directory`, `scheduleItem` queues another `knowledge.prepare-root`. If a child is `file`, `note`, or `url`, `scheduleItem` routes it to source planning and indexing. Recursive processing therefore lives in the workflow service loop, not inside a reader-specific branch.

## Future Rename

After the legacy v1 `src/main/services/KnowledgeService.ts` is removed, rename `KnowledgeOrchestrationService` to `KnowledgeService`. Update the `@Injectable('KnowledgeOrchestrationService')` key, service registry entry, and downstream callers in the same change.

## Job Types

Round 1 job types:

- `knowledge.prepare-root`: expand a container and schedule each child.
- `knowledge.index-documents`: read/chunk/embed/write vectors for a concrete document source. Empty reader results or zero chunks still write an empty vector set and complete the item.
- `knowledge.delete-subtree`: cancel active subtree jobs, delete vectors, detach Knowledge file refs, then delete resolved item ids with `deleteItemsByIds`. Detached `FileEntry` rows are preserved by the file module's no-reference policy.
- `knowledge.reindex-subtree`: for terminal subtrees only, delete vectors, remove stale container descendants, reset selected root state, then call `scheduleItem`. Selected leaf root source refs remain attached and are repaired by `index-documents` from `knowledge_item.data`.

- `knowledge.check-file-processing-result`: poll or inspect the FileProcessing job, attach the markdown artifact on success, then schedule indexing.

`knowledge_base.fileProcessorId` controls source planning for supported file items. When a source needs conversion, the workflow starts FileProcessing, schedules `knowledge.check-file-processing-result`, attaches the converted markdown as a `processed_artifact` ref, then indexes that artifact.

## Mutation And Crash Semantics

Same-base Knowledge mutations must go through `KnowledgeLockManager`. Main SQLite writes must still go through `DbService.withWriteTx`; the lock manager is not a replacement for the process-wide SQLite write mutex.

Crash safety comes from durable jobs, durable item states, JobManager recovery, and idempotent cleanup. The in-memory mutation lock only serializes concurrent work in the current process.

Delete and reindex span two stores: the main SQLite database and the per-base vector store. They cannot be one cross-store transaction. Consistency relies on durable re-entry and idempotent vector/artifact/row cleanup.

User-triggered reindex is not a cancellation primitive. The service admits reindex only when the entire selected subtree is already `completed` or `failed`. Active states (`idle`, `preparing`, `processing`, `reading`, `embedding`) and `deleting` are rejected; delete remains the operation that can be requested at any time.
