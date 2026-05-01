# Knowledge Service

This document records the current v2 knowledge backend shape in the main process.

## Overview

The current implementation is split into three layers:

1. `KnowledgeBaseService` / `KnowledgeItemService`
   - Persist SQLite-backed knowledge base and knowledge item data.
   - Validate `type` / `data` consistency.
   - Persist `knowledge_item.status` and `error`.
2. `KnowledgeOrchestrationService`
   - Exposes the caller-facing IPC workflow.
   - Coordinates expand, create, filter, add, delete, and search flows.
3. `KnowledgeRuntimeService`
   - Executes indexing and retrieval work.
   - Owns the in-memory add queue, interruption handling, and vector-store coordination.

```text
caller
  -> Data API
  -> preload IPC
     -> KnowledgeOrchestrationService
        -> KnowledgeBaseService / KnowledgeItemService
        -> KnowledgeRuntimeService
           -> reader / chunk / embed / rerank / vector store
```

## Caller Contract

The caller-facing model is now unified:

1. Create item records through Data API.
2. Call runtime IPC once with item ids.

For leaf items (`file`, `url`, `note`):

```text
caller
 -> Data API create item(s)
 -> preload IPC add-items(item ids)
```

For container items (`directory`, `sitemap`):

```text
caller
 -> Data API create owner item
 -> preload IPC add-items(owner item ids)
    -> orchestration expands owner
    -> orchestration persists child items
    -> orchestration filters indexable leaf items
    -> runtime enqueues leaf items
```

The caller no longer needs to invoke separate `expand*` IPC APIs.

## IPC Surface

`KnowledgeOrchestrationService` currently owns the public IPC entrypoints:

- `knowledge-runtime:create-base`
- `knowledge-runtime:delete-base`
- `knowledge-runtime:add-items`
- `knowledge-runtime:delete-items`
- `knowledge-runtime:search`

These IPC handlers are workflow-oriented. They may call data services and runtime services internally before returning.

## Runtime Behavior

`KnowledgeRuntimeService` keeps a single in-memory add queue with:

- one shared queue across all knowledge bases
- fixed concurrency of `5`
- item-level deduplication for pending/running add work
- interruption support for delete and shutdown

Current status writes are:

- `pending` before enqueue
- `completed` after successful vector write
- `failed` on error or shutdown interruption

Intermediate states such as `file_processing`, `read`, and `embed` remain reserved in schema/types, but are not written by the current runtime.

## Search

Search is executed by `KnowledgeRuntimeService.search(base, query)`:

1. embed query
2. query the libsql vector store
3. map nodes into `KnowledgeSearchResult`
4. rerank only when `base.rerankModelId` is configured

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
That tradeoff is currently accepted because it keeps the runtime path simpler and performs well enough for the expected near-term corpus sizes.

A local benchmark run on April 15, 2026 with 1536-dimension embeddings and `topK=10` measured approximately:

- `20k` rows: `~78ms` warm vector search
- `50k` rows: `~195ms` warm vector search

Current guidance:

1. Treat the no-index design as the default for now, not as an unlimited scaling guarantee.
2. Re-evaluate indexed search if real single-base corpora grow toward `100k+` rows or retrieval latency budgets can no longer tolerate a few hundred milliseconds per query.
3. If future product requirements change, adding a vector index remains a valid follow-up optimization rather than a blocked prerequisite for the current design.

## Deletion

Deletion still requires two concerns to be handled:

1. Runtime deletion
   - interrupt queue work
   - delete vectors
2. Data deletion
   - remove SQLite rows through Data API

The runtime layer does not delete SQLite business data by itself.
