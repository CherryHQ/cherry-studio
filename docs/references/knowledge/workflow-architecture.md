# Knowledge Workflow Architecture

This document records the intended v2 Knowledge workflow architecture. It is the canonical reference for the runtime workflow; temporary RFC copies under `v2-refactor-temp/` may be removed before release.

## Goals

Knowledge operations are modelled as a lightweight workflow rather than a single indexing pipeline:

```text
API / user action
  -> KnowledgeWorkflowCoordinator
     -> JobManager
        -> Knowledge job handlers
           -> KnowledgeMutationCoordinator
              -> SQLite / vector store / FileManager
```

The design keeps three owners:

- `KnowledgeWorkflowCoordinator` decides the next workflow step.
- `KnowledgeMutationCoordinator` serializes same-base mutations and cleanup.
- Knowledge job handlers execute one durable stage and call the coordinator for the next step.

Helpers may own source planning, lifecycle writes, artifact refs, and FileProcessing adaptation. They should stay as modules until they need lifecycle-managed resources, IPC, timers, or long-lived state.

## Workflow Entry Points

`addItems`, `deleteItem`, and `reindexItem` are async workflow entry points. API resolution means the durable workflow has been accepted, not that every physical side effect has finished.

- `addItems` resolves after root rows are created and first Knowledge jobs are queued.
- `deleteItem` resolves after the target subtree is marked `deleting` and `knowledge.delete-subtree` is queued.
- `reindexItem` resolves after `knowledge.reindex-subtree` is queued.

Default item list, search, and RAG hydration exclude `deleting` items. `deleting` is a durable cleanup marker, not a tombstone or terminal success state.

## Scheduling Model

The coordinator owns all branching:

```text
scheduleItem(baseId, itemId)
  directory / sitemap -> enqueue knowledge.prepare-root
  file / note / url   -> source planning
       direct         -> enqueue knowledge.index-documents
       invalid        -> mark item failed
       needs processing -> Round 2 FileProcessing path
```

Job handlers do not decide whether an item is a root, nested container, direct leaf, or FileProcessing candidate. They perform their current stage and re-enter the coordinator.

## Recursive Container Expansion

`knowledge.prepare-root` expands a `directory` or `sitemap` item and creates or replaces its child rows. Expansion results must not assume every child is a leaf:

```text
prepare-root(container)
  -> create/replace child rows
  -> for each child:
       coordinator.scheduleItem(baseId, childId)
```

If a child is another `directory` or `sitemap`, `scheduleItem` queues another `knowledge.prepare-root`. If a child is `file`, `note`, or `url`, `scheduleItem` routes it to source planning and indexing. Recursive processing therefore lives in the coordinator loop, not inside a reader-specific branch.

## Job Types

Round 1 job types:

- `knowledge.prepare-root`: expand a container and schedule each child.
- `knowledge.index-documents`: read/chunk/embed/write vectors for a concrete document source.
- `knowledge.delete-subtree`: cancel active subtree jobs, delete vectors, detach processed artifact refs, cleanup internal artifacts by ref count, then hard-delete rows.
- `knowledge.reindex-subtree`: run the shared cleanup prefix, reset subtree item state, then call `scheduleItem`.

Round 2 adds FileProcessing:

- `knowledge.check-file-processing-result`: poll or inspect the FileProcessing job, attach the markdown artifact on success, then schedule indexing.

`knowledge_base.fileProcessorId` is persisted today but indexing does not consume it in Round 1. Round 2 wires source planning to FileProcessing.

## Mutation And Crash Semantics

Same-base Knowledge mutations must go through `KnowledgeMutationCoordinator`. Main SQLite writes must still go through `DbService.withWriteTx`; the mutation coordinator is not a replacement for the process-wide SQLite write mutex.

Crash safety comes from durable jobs, durable item states, JobManager recovery, and idempotent cleanup. The in-memory mutation lock only serializes concurrent work in the current process.

Delete and reindex span two stores: the main SQLite database and the per-base vector store. They cannot be one cross-store transaction. Consistency relies on durable re-entry and idempotent vector/artifact/row cleanup.

