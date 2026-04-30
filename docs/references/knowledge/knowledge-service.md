# Knowledge Service

This document records the current v2 knowledge backend shape in the main process.

It covers the `src/main/services/knowledge` runtime path and the SQLite-backed data services. It does not describe the legacy `src/main/knowledge` service or the old `knowledge-base:*` IPC channels.

## Overview

The current implementation is split into four responsibility areas:

1. `KnowledgeBaseService` / `KnowledgeItemService`
   - Persist SQLite-backed knowledge base and knowledge item data.
   - Persist `knowledge_base.status` and `error`; migrated bases with missing embedding models remain as recoverable `failed` bases.
   - Validate `type` / `data` consistency.
   - Persist `knowledge_item.status`, `phase`, and `error`.
   - Reconcile container item status from child item state.
2. Data API knowledge handlers
   - Expose database-backed list/get operations and base metadata/config patch.
   - Do not perform vector-store mutations.
3. `KnowledgeOrchestrationService`
   - Owns caller-facing runtime IPC workflow.
   - Creates/deletes bases through data services.
   - Collapses delete/reindex item inputs to top-level roots and coordinates runtime cleanup with SQLite deletion.
4. `KnowledgeRuntimeService`
   - Executes indexing and retrieval work.
   - Creates runtime-added items.
   - Owns the in-memory runtime queue, interruption handling, preparation, indexing, and vector-store coordination.

```text
caller
  -> Data API reads / base patch
     -> KnowledgeBaseService / KnowledgeItemService

caller
  -> preload knowledgeRuntime IPC
     -> KnowledgeOrchestrationService
        -> KnowledgeBaseService / KnowledgeItemService
        -> KnowledgeRuntimeService
           -> reader / chunk / embed / rerank / vector store
```

## Caller Contract

Current Data API knowledge endpoints are read/update-only for database state that has no vector-store side effect:

- `GET /knowledge-bases`
- `GET /knowledge-bases/:id`
- `PATCH /knowledge-bases/:id`
- `GET /knowledge-bases/:id/items`
- `GET /knowledge-items/:id`

Caller-facing create/delete/index/search operations go through `KnowledgeOrchestrationService` IPC.

The caller-facing add model is payload-based:

1. Call runtime IPC once with item payloads.
2. Runtime creates the `knowledge_item` rows.
3. Runtime queues either preparation or indexing work.

For leaf items (`file`, `url`, `note`):

```text
caller
 -> preload IPC add-items(leaf item payloads)
    -> runtime creates leaf items
    -> runtime enqueues index-leaf tasks
```

For container items (`directory`, `sitemap`):

```text
caller
 -> preload IPC add-items(owner item payloads)
    -> runtime creates root items
    -> runtime enqueues prepare-root tasks
    -> prepare-root expands owner inside the queue
    -> prepare-root creates child items
    -> prepare-root enqueues index-leaf tasks for concrete leaf children
```

Callers should not create item records through Data API and then call runtime IPC with item ids. `add-items` accepts `KnowledgeRuntimeAddItemInput[]` and returns after root items are accepted, not after indexing completes.

Delete and reindex remain id-based because they operate on existing persisted items:

```text
delete-items(baseId, itemIds)
reindex-items(baseId, itemIds)
```

`KnowledgeOrchestrationService` collapses nested selected ids to top-level roots before calling runtime.
Current product scope does not allow users to add nested `directory` / `sitemap` items under another item. Nested directory rows may be created internally by directory expansion to preserve hierarchy.

## IPC Surface

`KnowledgeOrchestrationService` currently owns these public IPC entrypoints:

- `knowledge-runtime:create-base`
- `knowledge-runtime:restore-base`
- `knowledge-runtime:delete-base`
- `knowledge-runtime:add-items`
- `knowledge-runtime:delete-items`
- `knowledge-runtime:reindex-items`
- `knowledge-runtime:search`
- `knowledge-runtime:list-item-chunks`
- `knowledge-runtime:delete-item-chunk`

These IPC handlers are workflow-oriented. They validate payloads, call data services, and call runtime services internally.

## Runtime Behavior

`KnowledgeRuntimeService` keeps a single in-memory runtime queue with:

- one shared queue across all knowledge bases
- fixed concurrency of `5`
- task kinds: `prepare-root` and `index-leaf`
- item-level deduplication for pending/running runtime work
- interruption support for delete, reindex, and shutdown
- a per-base vector write lock so concurrent tasks do not write the same base store at the same time

Current status writes are:

- `processing, phase = preparing` for active `directory` / `sitemap` preparation
- `processing, phase = reading` while a leaf item reads source documents
- `processing, phase = embedding` while a leaf item embeds and writes vectors
- `completed, phase = null` after successful leaf indexing or when a container has no active children
- `failed, phase = null` on error, cleanup failure, or shutdown interruption

`status` is the aggregate business state. `phase` is runtime progress. Container status is reconciled from its own phase and child statuses.

## Delete And Reindex

`delete-items` currently runs:

1. Orchestration loads requested items and collapses descendants to top-level roots.
2. Runtime interrupts root tasks and waits for running root work to settle.
3. Runtime fresh-queries descendants.
4. Runtime interrupts root + descendant tasks and waits again.
5. Runtime deletes leaf vectors.
6. Orchestration deletes top-level root SQLite rows; database cascade removes descendants.

`reindex-items` currently runs:

1. Orchestration loads requested items and collapses descendants to top-level roots.
2. Runtime interrupts root + descendants using the same two-stage interrupt flow.
3. Runtime deletes existing leaf vectors.
4. Container roots delete old leaf descendants and enqueue fresh `prepare-root`.
5. Leaf roots write `processing` and enqueue fresh `index-leaf`.

If destructive cleanup fails after interrupt, runtime writes the cleanup error to the affected item state before rethrowing so callers can surface the failure.

Base deletion follows the same ordering:

```text
delete-base(baseId)
 -> runtime interrupts base work and returns interrupted item ids
 -> data service deletes the SQLite base and cascaded items
 -> runtime best-effort deletes base vector artifacts
```

If SQLite deletion fails after runtime work was interrupted, orchestration marks the interrupted items failed and rethrows the SQLite error.
If post-SQLite artifact cleanup fails, orchestration logs the cleanup error and keeps the base deletion successful because the durable SQLite rows are already gone.

Base restore creates a new knowledge base from an existing base when the caller needs a fresh embedding/index setup, such as a migrated base whose legacy embedding model is unavailable or a completed base whose embedding model was changed by the user:

```text
restore-base(sourceBaseId, embeddingModelId, dimensions)
 -> data service loads the source base
 -> orchestration creates a new base with source config plus the new embedding model/dimensions
 -> data service loads source root items
 -> orchestration adds those root items to the new base
```

The source base is preserved. If item restoration fails after the new base is created, orchestration best-effort deletes the new base and rethrows the original item restoration error.

### Migrated Bases With Missing Embedding Models

During v1-to-v2 migration, a legacy knowledge base may reference an embedding model that does not exist in the migrated `user_model` table. For example, a legacy model id such as `ollama::dengcao/Qwen3-Embedding-0.6B:Q8_0` can be present in Redux knowledge data while no matching V2 user model row exists.

In that case, migration must preserve the user-created knowledge data instead of dropping the base:

- `knowledge_base.embeddingModelId = null`
- `knowledge_base.status = failed`
- `knowledge_base.error = missing_embedding_model`
- `knowledge_item` rows under that base continue to migrate
- legacy vectors for that base are skipped because there is no confirmed embedding model contract

This means the migrated base is visible as recoverable data, but it is not usable for search/index operations until the user chooses a valid embedding model.

The recovery path is `knowledge-runtime:restore-base`, not an in-place rebuild:

```text
user selects a valid embedding model for the failed base
 -> restore-base(sourceBaseId, embeddingModelId, dimensions)
 -> orchestration creates a new completed base using the source base config
 -> orchestration copies only source root items into the new base
 -> add-items triggers the normal runtime indexing flow for the new base
```

Only root items (`groupId = null`) are copied. Expanded directory/sitemap children are intentionally not copied because they belong to the old base hierarchy and can be regenerated by the normal container preparation flow. The old failed base is left intact; product/UI code can decide whether to keep it for confirmation or delete it after a successful restore.

## Search

Search is executed by `KnowledgeRuntimeService.search(base, query)`:

1. resolve and run the embedding model for the query
2. query the libsql vector store
3. map nodes into `KnowledgeSearchResult`
4. call rerank only when `base.rerankModelId` is configured

Current `KnowledgeSearchResult` includes:

- `pageContent`
- `score`
- `metadata`
- optional `itemId`
- required `chunkId`

`chunkId` is the vector row identity used for result-level attribution. `itemId` is populated from stored metadata when available.

### Current Retrieval Cost Assumption

The current v2 implementation intentionally does **not** create a libSQL vector index and does **not** use `vector_top_k`.
Similarity search currently queries the base table directly and sorts by `vector_distance_cos(...)`.

This means retrieval cost scales roughly linearly with the number of vector rows in a single knowledge base.
That tradeoff is currently accepted because it keeps the runtime path simpler for expected near-term corpus sizes.

Current guidance:

1. Treat the no-index design as the default for now, not as an unlimited scaling guarantee.
2. Re-evaluate indexed search if real single-base corpora grow toward `100k+` rows or retrieval latency budgets can no longer tolerate a few hundred milliseconds per query.
3. If future product requirements change, adding a vector index remains a valid follow-up optimization rather than a blocked prerequisite for the current design.
