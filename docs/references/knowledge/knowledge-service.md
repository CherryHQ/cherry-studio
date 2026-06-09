# Knowledge Service

This document records the current v2 knowledge backend shape in the main process.

It covers the `src/main/services/knowledge` workflow path and the SQLite-backed data services. It does not describe the legacy `src/main/knowledge` service or the old `knowledge-base:*` IPC channels.

For workflow guard details, see [Knowledge Operation Guards](./operation-guards.md). For the workflow architecture overview, see [Knowledge Workflow Architecture](./workflow-architecture.md).

## Overview

The current implementation is split into four responsibility areas:

1. `KnowledgeBaseService` / `KnowledgeItemService`
   - Persist SQLite-backed knowledge base and knowledge item data.
   - Persist `knowledge_base.status` and `error`; migrated bases with missing embedding models remain as recoverable `failed` bases.
   - Persist `knowledge_base.groupId` and `dimensions`; `dimensions` is nullable only for failed bases whose embedding contract is unknown.
   - Validate item `type` / `data` consistency.
   - Persist `knowledge_item.status` and `error`.
   - Reconcile container item status from child item state.
2. Data API knowledge handlers
   - Expose database-backed list/get operations and base metadata/config patch.
   - Do not perform vector-store mutations.
3. `KnowledgeService`
   - Owns caller-facing runtime IPC workflow.
   - Creates/deletes/restores bases through data services and vector store services.
   - Registers Knowledge JobManager handlers.
   - Holds the `KnowledgeWorkflowService` and `KnowledgeLockManager`.
   - Collapses delete/reindex item inputs to top-level roots and enforces runtime guards.
4. Knowledge job handlers
   - Execute durable workflow stages through JobManager.
   - Use `KnowledgeWorkflowService` for next-step scheduling.
   - Use `KnowledgeLockManager` for same-base mutations and vector cleanup.

```text
caller
  -> Data API reads / base patch
     -> KnowledgeBaseService / KnowledgeItemService

caller
  -> preload knowledge IPC
     -> KnowledgeService
        -> KnowledgeWorkflowService
        -> JobManager
           -> knowledge.prepare-root / knowledge.index-documents
           -> knowledge.delete-subtree / knowledge.reindex-subtree
              -> KnowledgeLockManager
                 -> KnowledgeBaseService / KnowledgeItemService
                 -> KnowledgeVectorStoreService / FileManager
```

There is no current `KnowledgeRuntimeService` and no in-memory Knowledge queue. Durable work is owned by `JobManager`.

## Caller Contract

Current Data API knowledge endpoints are read/update-only for database state that has no vector-store side effect:

- `GET /knowledge-bases`
- `GET /knowledge-bases/:id`
- `PATCH /knowledge-bases/:id`
- `GET /knowledge-bases/:id/items`
- `GET /knowledge-items/:id`

Caller-facing create/delete/index/search operations go through `KnowledgeService` IPC.

The caller-facing add model is payload-based:

1. Call runtime IPC once with item payloads.
2. The workflow creates the `knowledge_item` rows.
3. The workflow queues either preparation or indexing work.

For leaf items (`file`, `url`, `note`):

```text
caller
 -> preload IPC add-items(leaf item payloads)
    -> create leaf items
    -> mark roots processing
    -> enqueue knowledge.index-documents
```

For container items (`directory`):

```text
caller
 -> preload IPC add-items(owner item payloads)
    -> create root items
    -> mark roots preparing
    -> enqueue knowledge.prepare-root
    -> prepare-root expands owner
    -> prepare-root creates child items
    -> workflow service schedules each child
```

Callers should not create item records through Data API and then call runtime IPC with item ids. `add-items` accepts `KnowledgeAddItemInput[]` and returns after root items are accepted and first jobs are queued, not after indexing completes.

Delete and reindex remain id-based because they operate on existing persisted items:

```text
delete-items(baseId, itemIds)
reindex-items(baseId, itemIds)
```

`KnowledgeService` collapses nested selected ids to top-level roots before calling the workflow service.

## IPC Surface

`KnowledgeService` currently owns these public IPC entrypoints:

- `knowledge:create-base`
- `knowledge:restore-base`
- `knowledge:delete-base`
- `knowledge:add-items`
- `knowledge:delete-items`
- `knowledge:reindex-items`
- `knowledge:search`
- `knowledge:list-item-chunks`
- `knowledge:delete-item-chunk`

These IPC handlers are workflow-oriented. They validate payloads, call data services, and enqueue or execute runtime work internally.

`KnowledgeService` also owns one v1 bridge entrypoint, `knowledge-base:delete`, still invoked by the legacy Redux `store/knowledge` slice until that slice is removed in the unified step. It routes to the same `delete-base` path.

Chunk IPC entrypoints are runtime inspection/mutation helpers:

- `list-item-chunks` and `delete-item-chunk` reject failed bases.
- Both require the requested item to be `completed`.
- Listing chunks for a completed `directory` also rejects when the subtree still contains `deleting` descendants, because container status reconciliation ignores deleting children.

## Runtime Behavior

Knowledge runtime work is persisted in JobManager. `KnowledgeService.onInit` registers:

- `knowledge.prepare-root`
- `knowledge.index-documents`
- `knowledge.delete-subtree`
- `knowledge.reindex-subtree`

Each base uses queue `base.${baseId}`. JobManager owns queue persistence, dispatch, retry, cancellation, timeout, and startup recovery. Knowledge code uses `KnowledgeLockManager` to serialize same-base vector and item mutations inside the current process.

Current item statuses are:

- `idle`
- `preparing`
- `processing`
- `reading`
- `embedding`
- `completed`
- `failed`
- `deleting`

There is no separate persisted `phase` field. `preparing`, `reading`, and `embedding` are first-class item statuses.

Current status writes are:

- `preparing` for active `directory` preparation.
- `processing` for accepted leaf roots before indexing starts, and for containers that still have active children.
- `reading` while a leaf item reads source documents.
- `embedding` while a leaf item embeds chunks.
- `completed` after successful leaf indexing, including leaf indexing that writes zero chunks, or when a container has no active children.
- `failed` on indexing/preparation failure or scheduling compensation.
- `deleting` after user-visible delete intent is written and before physical cleanup completes.

`status` is the durable business state. JobManager progress is diagnostic execution state and is not the source of truth for item lifecycle. Container status is reconciled from immediate child statuses.

Current persisted `knowledge_base` columns include:

- `groupId`: nullable group assignment; `null` means ungrouped.
- `dimensions`: positive embedding vector width for completed bases; nullable for failed migrated bases with unknown dimensions.
- `status`: `completed` for runnable bases, `failed` for recoverable base-level migration failures.
- `error`: nullable `KnowledgeBaseErrorCode`; currently `missing_embedding_model` for recoverable failed bases.

## Delete And Reindex

`delete-items` currently runs:

1. Orchestration loads requested items and collapses descendants to top-level roots.
2. Workflow service marks selected root subtrees `deleting` under the base mutation lock.
3. Workflow service enqueues `knowledge.delete-subtree`.
4. The delete job cancels active jobs touching the subtree.
5. Under the base mutation lock, the delete job deletes leaf vectors, clears Knowledge file refs, and hard-deletes item rows.

The item row delete path clears Knowledge `file_ref` rows for the full deletion subtree before deleting rows. This is required because `file_ref.sourceId` is polymorphic and cannot cascade from `knowledge_item`.

If enqueueing `knowledge.delete-subtree` fails after rows are marked `deleting`, rows remain `deleting`. Startup recovery scans deleting roots and re-enqueues cleanup jobs best-effort.

`reindex-items` currently runs:

1. Orchestration loads requested items and collapses descendants to top-level roots.
2. Orchestration rejects the request unless every selected subtree item is terminal: `completed` or `failed`.
3. Workflow service enqueues `knowledge.reindex-subtree`.
4. The reindex job skips if delete won the race and any subtree item is now `deleting`.
5. Under the base mutation lock, the reindex job deletes old vectors, removes expanded descendants for selected container roots, resets selected roots to `preparing` or `processing`, and schedules each selected root through the workflow service.

Reindex is not a cancellation primitive. Delete is the operation that can preempt active work.

Base deletion currently runs:

```text
delete-base(baseId)
 -> cancel active Knowledge jobs in base queue
 -> under base mutation lock:
      delete vector store artifacts
      delete SQLite base row
```

If vector artifact deletion fails, the SQLite base row is preserved so the user can retry deletion. If SQLite deletion fails after vector artifacts were deleted, orchestration throws an `invalidOperation` because the cross-store cleanup cannot be rolled back.

Knowledge delete/reindex workflows detach Knowledge-owned `FileRef` rows but do not actively remove detached `FileEntry` rows. Unreferenced file entries are left to the file module's orphan handling policy.

## Base Restore

Base restore creates a new knowledge base from an existing base:

```text
restore-base(sourceBaseId, embeddingModelId, dimensions)
 -> data service loads the source base
 -> data service loads source root items
 -> orchestration creates a new base with source config plus the requested embedding model/dimensions
 -> orchestration adds each root item to the new base
```

`dimensions` must already be resolved for the selected `embeddingModelId` before calling `restore-base`. Automatic flows should fill it from AI Core dimension detection; manual flows accept the user-provided value and rely on the caller to confirm it matches the model. The restore backend only validates that `dimensions` is a positive integer and uses it to create the new vector store; it does not perform a second model probe. If the value does not match the model's actual embedding output size, the mismatch is expected to surface during the subsequent indexing/write-vector phase.

The source base is preserved. Restore is allowed for failed bases and completed bases, including completed bases whose `embeddingModelId` and `dimensions` are unchanged. Same-config restore is a valid clone/rebuild workflow, not rejected as a no-op.

If one or more root items cannot be accepted into the restored base, orchestration best-effort deletes the new base and rethrows an `invalidOperation`. Later background indexing failures are recorded on item status instead of this synchronous restore error.

### Migrated Bases With Missing Embedding Models

During v1-to-v2 migration, a legacy knowledge base may reference an embedding model that does not exist in the migrated `user_model` table. For example, a legacy model id such as `ollama::dengcao/Qwen3-Embedding-0.6B:Q8_0` can be present in Redux knowledge data while no matching V2 user model row exists.

In that case, migration must preserve the user-created knowledge data instead of dropping the base:

- `knowledge_base.embeddingModelId = null`
- `knowledge_base.dimensions = valid legacy dimensions, or null when unknown`
- `knowledge_base.status = failed`
- `knowledge_base.error = missing_embedding_model`
- `knowledge_item` rows under that base continue to migrate
- legacy vectors for that base are skipped because there is no confirmed embedding model contract

`knowledge_base.error` is a shared `KnowledgeBaseErrorCode` value, not a free-form string. The current recoverable base-level error code is `missing_embedding_model`.

This means the migrated base is visible as recoverable data, but it is not usable for search/index operations until the user chooses a valid embedding model.

The failed-base recovery path is `knowledge:restore-base`, not an in-place rebuild:

```text
user selects a valid embedding model for the failed base
 -> restore-base(sourceBaseId, embeddingModelId, dimensions)
 -> orchestration creates a new completed base using the source base config
 -> orchestration copies only source root items into the new base
 -> add-items triggers the normal workflow indexing flow for the new base
```

Only root items (`groupId = null`) are copied. Expanded directory children are intentionally not copied because they belong to the old base hierarchy and can be regenerated by the normal container preparation flow. The old failed base is left intact; product/UI code can decide whether to keep it for confirmation or delete it after a successful restore.

## Search

Search is executed by `KnowledgeService.search(baseId, query)`:

1. Reject failed bases.
2. Reject queries without searchable tokens.
3. Resolve and run the embedding model for the query.
4. Query the libSQL vector store.
5. Filter results whose source items are missing, outside the base, or `deleting`.
6. Rerank when `base.rerankModelId` is configured.
7. Apply relevance threshold and assign ranks.

Current `KnowledgeSearchResult` includes:

- `pageContent`
- `score`
- `scoreKind`
- `rank`
- `metadata`
- optional `itemId`
- required `chunkId`

`chunkId` is the vector row identity used for result-level attribution. `itemId` is populated from stored metadata when available.

### Current Retrieval Cost Assumption

The current v2 implementation intentionally does not create a libSQL vector index and does not use `vector_top_k`.
Similarity search currently queries the base table directly and sorts by `vector_distance_cos(...)`.

This means retrieval cost scales roughly linearly with the number of vector rows in a single knowledge base.
That tradeoff is currently accepted because it keeps the runtime path simpler for expected near-term corpus sizes.

Current guidance:

1. Treat the no-index design as the default for now, not as an unlimited scaling guarantee.
2. Re-evaluate indexed search if real single-base corpora grow toward `100k+` rows or retrieval latency budgets can no longer tolerate a few hundred milliseconds per query.
3. If future product requirements change, adding a vector index remains a valid follow-up optimization rather than a blocked prerequisite for the current design.
