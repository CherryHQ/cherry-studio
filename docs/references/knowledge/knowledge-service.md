---
description: Current Knowledge backend - persistence, IPC, ingestion, retrieval, Concept IDs, and agent tools
sources:
  - src/main/features/knowledge
  - src/main/data/db/schemas/externalKnowledgeSource.ts
  - src/main/data/db/schemas/externalKnowledgeDocument.ts
  - src/main/data/db/schemas/knowledge.ts
  - src/main/data/services/ExternalKnowledgeSourceService.ts
  - src/main/data/services/ExternalKnowledgeDocumentService.ts
  - src/main/data/services/KnowledgeBaseService.ts
  - src/main/data/services/KnowledgeItemService.ts
  - src/shared/data/types/externalKnowledge.ts
  - src/shared/ipc/schemas/knowledge.ts
  - src/main/ipc/handlers/knowledge.ts
  - src/main/ai/tools/knowledgeLookup.ts
---

# Knowledge Service

This document records the current Knowledge backend in the main process. It
covers the SQLite business state, Knowledge-owned files and index stores,
workflow IPC, retrieval, and the agent-facing Concept ID surface.

For workflow guard details, see [Knowledge Operation Guards](./operation-guards.md). For the workflow architecture overview, see [Knowledge Workflow Architecture](./workflow-architecture.md).

## Overview

The current implementation is split into four responsibility areas:

1. Knowledge data services
   - `KnowledgeBaseService` / `KnowledgeItemService` persist SQLite-backed
     knowledge base and knowledge item data.
   - `ExternalKnowledgeSourceService` / `ExternalKnowledgeDocumentService`
     expose the persisted provider-neutral source, document, and ownership read
     model.
   - Persist `knowledge_base.status` and `error`; migrated bases with an
     unresolved embedding model or vector store remain recoverable `failed`
     bases.
   - Persist `knowledge_base.groupId` and `dimensions`; `dimensions` is `null` for BM25-only completed bases (no embedding model) and for failed bases whose embedding contract is unknown.
   - Validate item `type` / `data` consistency.
   - Persist `knowledge_item.status` and `error`.
   - Reconcile container item status from child item state.
2. Data API knowledge handlers
   - Expose database-backed list/get operations and base metadata/config patch.
   - Expose external source/document reads and project subtree-aware
     `canDelete` onto knowledge item list rows.
   - Do not perform vector-store mutations.
3. `KnowledgeService`
   - Thin lifecycle facade: registers Knowledge JobManager handlers, runs boot recovery, and delegates every public method to `base/`, `ingestion/`, and `query/`.
   - `base/` (`KnowledgeBaseAdminService`) creates/deletes/restores bases through data services and vector store services. The per-base mutation lock (a core `KeyedMutex`) is created by the `KnowledgeService` facade and shared with `base/`, `ingestion/`, and the job handlers.
   - `ingestion/` (`KnowledgeIngestionService`) collapses delete/reindex item inputs to top-level roots, enforces runtime guards, and schedules the next workflow step.
   - `query/` (`KnowledgeQueryService` / `KnowledgeConceptService`) serves
     search, source preview, document read/grep, tree browsing, and Concept
     ID-addressed delete/reindex.
4. Knowledge job handlers
   - Execute durable workflow stages through JobManager.
   - Use `KnowledgeIngestionService` for next-step scheduling.
   - Use the per-base mutation lock (`KeyedMutex.runExclusive`) for same-base mutations and vector cleanup.
   - Adapt `knowledge.index-documents` to the feature-local
     `indexKnowledgeItem({ baseId, itemId, signal, reportProgress })` operation.

```text
caller
  -> Data API reads / base patch
     -> KnowledgeBaseService / KnowledgeItemService

caller
  -> preload knowledge IPC
     -> KnowledgeService
        -> KnowledgeIngestionService
        -> JobManager
           -> knowledge.prepare-root / knowledge.index-documents
           -> knowledge.check-file-processing-result
           -> knowledge.delete-subtree / knowledge.reindex-subtree
              -> KeyedMutex.runExclusive
                 -> KnowledgeBaseService / KnowledgeItemService
                 -> KnowledgeVectorStoreService
```

There is no current `KnowledgeRuntimeService` and no in-memory Knowledge queue. Durable work is owned by `JobManager`.

## Storage Boundaries

The main SQLite database owns `knowledge_base`, `knowledge_item`,
`external_knowledge_source`, and `external_knowledge_document`. These rows are
the business authority for base configuration, item identity, hierarchy,
status, external ownership, and errors. The renderer never derives the item
list from a filesystem scan.

Each base also owns a directory under
`application.getPath('feature.knowledgebase.data', baseId)`:

```text
{baseId}/
  raw/                   # copied files and captured URL/note snapshots
  .cherry/index.sqlite   # derived retrieval index
```

Item `relativePath` values are POSIX-style paths relative to `raw/`; main-process
path guards reject absolute, escaping, and `.cherry/**` paths. Directory imports
retain their subtree below one reserved top-level prefix. URL and note snapshots
are Markdown with Cherry OKF frontmatter, which readers strip before indexing.
An external item points at provider-normalized Markdown in a pinned local
snapshot below `raw/`. Its reader decodes the file as UTF-8 text and supplies it
verbatim to the chunker, including any provider-authored leading frontmatter;
the document `contentHash` must describe that exact text. Layer 2 indexing never
fetches a provider.

The per-base index is a rebuildable seven-table SQLite projection (`meta`,
`material`, `content`, `search_unit`, `search_text`, `embedding`, and
`search_text_fts`). `knowledge_item` remains authoritative for visibility and
lifecycle; index rows are never the renderer's business-data source.

## External Knowledge Domain

Layer 2 establishes this persisted ownership chain:

```text
ExternalKnowledgeConnection
  -> ExternalKnowledgeSource
     -> ExternalKnowledgeDocument
        -> zero or one KnowledgeItem(type = external)
```

An external item contains only the local indexing contract:

```ts
{
  source: string
  title: string
  relativePath: string
}
```

Provider credentials, tenant/connection identity, remote hierarchy and
revision, normalized-content hashes, authorization state, document warnings,
and availability stay in their owning connection/source/document records.
They are not copied into `knowledge_item.data` or vector metadata.

`ExternalKnowledgeSource.state` is only `active` or `paused`.
`ExternalKnowledgeDocument.availability` is only `active` or `unavailable`:
an active document owns exactly one external item, while an unavailable
document owns none. A completed external item with no document owner is a
static external item; this is an ownership condition, not another global
Knowledge status.

The schema enforces one document per `(sourceId, remoteObjectId)` and at most
one document owner per knowledge item. Sources belong to one base and one
connection; deleting a base cascades through the complete ownership graph,
while deleting an independently owned item is rejected. Layer 2 does not add a
sync-run entity, provider traversal, synchronization jobs, scheduling, or UI.
Public `KnowledgeAddItemInput` also remains limited to user-owned source types;
only trusted internal domain paths may create an external item after its local
snapshot is pinned.

Connection removal has a durable-delete-first contract. The runtime first runs
a no-side-effect Source-reference preflight, closes admission for that
credential generation, aborts and drains its authorization/request/refresh
work, then calls `removeUnreferenced`, which rechecks Source references and
deletes the Connection in one main-DB transaction. Only after that commit does
the runtime best-effort revoke the provider token and remove the credential;
startup reconciliation retires credential residue. The reference checks do not
filter on Source state, so both active and paused Sources block removal.

Layer 2 does not implement a Document publication writer. A future writer that
binds or replaces `ExternalKnowledgeDocument.knowledgeItemId` must, in the same
owner transaction, verify that the candidate item belongs to the Source's base,
has type `external`, and is `completed` rather than deleting or otherwise
active. It must also publish the content hash and remote revision that match the
prepared snapshot. These are deferred writer requirements, not current Layer 2
behavior.

## Caller Contract

Current Data API knowledge endpoints are read/update-only for database state that has no vector-store side effect:

- `GET /knowledge-bases`
- `GET /knowledge-bases/:id`
- `PATCH /knowledge-bases/:id`
- `GET /knowledge-bases/:id/items`
- `GET /knowledge-items/:id`
- `GET /knowledge-bases/:id/external-knowledge-sources`
- `GET /external-knowledge-sources/:id`
- `GET /external-knowledge-sources/:id/documents`
- `GET /external-knowledge-documents/:id`

Each row returned by `GET /knowledge-bases/:id/items` includes `canDelete`.
The projection is false for an active document-owned external item and for a
listed directory whose subtree contains one. It is advisory only; the workflow
service remains the enforcement boundary.

Base lifecycle, item workflow, source preview, chunk inspection, and direct
search operations go through `KnowledgeService` IPC. Agent read/list/manage
operations call the same service from the AI tool layer rather than adding a
second renderer IPC surface.

The caller-facing add model is payload-based:

1. Call runtime IPC once with item payloads.
2. The workflow creates the `knowledge_item` rows.
3. The workflow queues either preparation or indexing work.

For public leaf inputs (`file`, `url`, `note`):

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

`KnowledgeService` currently owns these public IpcApi routes, defined in `src/shared/ipc/schemas/knowledge.ts` and handled in `src/main/ipc/handlers/knowledge.ts`:

- `knowledge.create_base`
- `knowledge.restore_base`
- `knowledge.delete_base`
- `knowledge.add_items`
- `knowledge.delete_items`
- `knowledge.reindex_items`
- `knowledge.enable_embedding_model`
- `knowledge.search`
- `knowledge.get_file_path`
- `knowledge.list_item_chunks`

These IPC handlers are workflow-oriented. They validate payloads, call data services, and enqueue or execute runtime work internally. Chunks are derived index rows and are replaced wholesale by reindexing; there is no chunk-delete mutation.

The chunk IPC entrypoint is a runtime inspection helper:

- `list-item-chunks` rejects failed bases.
- It requires the requested item to be `completed`.
- Listing chunks for a completed `directory` also rejects when the subtree still contains `deleting` descendants, because container status reconciliation ignores deleting children.

## Runtime Behavior

Knowledge runtime work is persisted in JobManager. `KnowledgeService.onInit` registers:

- `knowledge.prepare-root`
- `knowledge.index-documents`
- `knowledge.check-file-processing-result`
- `knowledge.delete-subtree`
- `knowledge.reindex-subtree`

Each base uses queue `base.${baseId}`. JobManager owns queue persistence, dispatch, retry, cancellation, timeout, and startup recovery. Knowledge code uses the per-base mutation lock (`KeyedMutex.runExclusive`) to serialize same-base vector and item mutations inside the current process.

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
- `completed` after successful leaf indexing with at least one chunk, or when a container has no active children.
- `failed` on indexing/preparation failure or scheduling compensation.
- `deleting` after user-visible delete intent is written and before physical cleanup completes.

`status` is the durable business state. JobManager progress is diagnostic execution state and is not the source of truth for item lifecycle. Container status is reconciled from immediate child statuses.

The reusable `prepareKnowledgeMaterial` kernel reads an explicit indexable item
descriptor, chunks it, looks up only the embedding-text hashes supplied by that
preparation, embeds missing bodies, and returns `RebuildMaterialInput`. It
validates a completed base, material path, abort state, and non-empty output,
but does not open/publish the store or mutate item rows. The feature-local
`indexKnowledgeItem` Job composition owns live lookup and lifecycle checks,
URL/note snapshot capture, status transitions, preparation, the base-locked
live-row recheck, atomic material rebuild, and completion. The durable indexing
job remains a thin adapter preserving recovery, retry, timeout, queue, and
settled-failure behavior. Layer 2 introduces no synchronizer or alternate
publication path. Missing, deleting, and already-completed items are safe
no-ops; an indexable item that produces no chunks fails instead of replacing an
existing material with an empty one.

Current persisted `knowledge_base` columns include:

- `groupId`: nullable group assignment; `null` means ungrouped.
- `embeddingModelId`: the embedding model; `null` for BM25-only bases.
- `dimensions`: positive embedding vector width for vector-capable bases; `null` for BM25-only completed bases (no embedding model) and for failed migrated bases with unknown dimensions. On a completed base it is paired with `embeddingModelId` — both set, or both `null` for BM25-only retrieval (enforced by the DB CHECK and the entity schema).
- `status`: `completed` for runnable bases, `failed` for recoverable base-level migration failures.
- `error`: nullable `KnowledgeBaseErrorCode`; recoverable failed bases use
  `missing_embedding_model` or `missing_vector_store`.

For a completed BM25-only base, `knowledge.enable_embedding_model` sets the
first embedding model and dimensions in place, then reindexes all non-deleting
roots to backfill vectors. Changing a base that already has an embedding model
is rejected by this path; that operation uses `restore_base` because the
existing vector contract must be rebuilt in a new base.

## Delete And Reindex

`delete-items` currently runs:

1. Orchestration loads requested items and collapses descendants to top-level roots.
2. Under the base mutation lock, one DB transaction rejects the whole request if any selected root's recursive subtree has an active `ExternalKnowledgeDocument` owner, marks the accepted subtrees `deleting`, and enqueues `knowledge.delete-subtree`.
3. The delete job cancels active jobs touching the subtree.
4. Under the base mutation lock, the delete job deletes leaf vectors, deletes Knowledge-owned raw files, and hard-deletes item rows.

The ownership check is based on document availability, not source state, so
pausing a source does not make its active documents independently deletable.
The same check covers a selected directory's descendants and a mixed batch;
because enforcement, status writes, and enqueueing share one synchronous
transaction, a rejection changes no selected item state. Ownerless
completed external items are static external content and use the normal delete
path. Reindex may also target a directly selected active-owned external leaf:
the item and pinned snapshot remain in place while only its derived index is
rebuilt. Ownership blocks reindex when selected container cleanup would delete
an active-owned descendant.

Knowledge files are managed by the Knowledge workflow under the base `raw/` directory. The create/index path does not register FileManager refs, so delete has no separate FileManager ref cleanup step.

If enqueueing `knowledge.delete-subtree` fails, the shared transaction rolls back the `deleting` status write and the items retain their previous visible state. Startup recovery still scans committed `deleting` roots and re-enqueues cleanup jobs best-effort when already-durable cleanup was interrupted or failed.

`reindex-items` currently runs:

1. Orchestration loads requested items and collapses descendants to top-level roots.
2. Orchestration rejects active document ownership among descendants that a selected container rebuild would delete, then requires every selected subtree item to be terminal (`completed` or `failed`) and every selected root source to be available. A directly selected active-owned external leaf remains eligible and rebuilds from its pinned snapshot.
3. Workflow service enqueues `knowledge.reindex-subtree`.
4. The reindex job skips if delete won the race and any subtree item is now `deleting`.
5. Under the base mutation lock, the reindex job rechecks abort state, delete state, source availability, and active ownership for the container descendants it would delete before resetting statuses or touching artifacts; it then replaces source bytes, deletes old vectors and expanded descendants, and schedules each selected root through the workflow service.

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

Knowledge files are owned by the Knowledge workflow under its raw/vector storage and are not registered as FileManager `FileRef` rows. Delete/reindex cleanup stays within Knowledge-owned storage and metadata.

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

Before creating the replacement base, restore probes each source root. Roots
whose source is confirmed missing are skipped and counted in
`skippedMissingSourceCount`; sources that are merely unverifiable remain in the
restore attempt. If an accepted root cannot be added, orchestration best-effort
deletes the new base and rethrows an `invalidOperation`. Later background
indexing failures are recorded on item status.

### Recoverable Migrated Bases

During v1-to-v2 migration, a legacy knowledge base may reference an embedding model that does not exist in the migrated `user_model` table. For example, a legacy model id such as `ollama::dengcao/Qwen3-Embedding-0.6B:Q8_0` can be present in Redux knowledge data while no matching V2 user model row exists.

In that case, migration must preserve the user-created knowledge data instead of dropping the base:

- `knowledge_base.embeddingModelId = null`
- `knowledge_base.dimensions = valid legacy dimensions, or null when unknown`
- `knowledge_base.status = failed`
- `knowledge_base.error = missing_embedding_model`
- `knowledge_item` rows under that base continue to migrate
- legacy vectors for that base are skipped because there is no confirmed embedding model contract

If the embedding model resolves but the legacy vector store is missing, empty,
locked, or invalid, migration instead preserves the resolved
`embeddingModelId`, stores `dimensions = null`, and marks the base
`failed`/`missing_vector_store`. The same restore flow rebuilds either failure
kind into a new completed base.

`knowledge_base.error` is a shared `KnowledgeBaseErrorCode` value, not a
free-form string. Migration uses `missing_embedding_model` when the model cannot
be resolved and `missing_vector_store` when the model is known but the legacy
store cannot provide a usable vector contract.

This means the migrated base is visible as recoverable data, but it is not usable for search/index operations until the user chooses a valid embedding model.

The failed-base recovery path is `knowledge.restore_base`, not an in-place rebuild:

```text
user selects a valid embedding model for the failed base
 -> restore-base(sourceBaseId, embeddingModelId, dimensions)
 -> orchestration creates a new completed base using the source base config
 -> orchestration copies only source root items into the new base
 -> add-items triggers the normal workflow indexing flow for the new base
```

Only root items (`groupId = null`) are copied. Expanded directory children are intentionally not copied because they belong to the old base hierarchy and can be regenerated by the normal container preparation flow. The old failed base is left intact; product/UI code can decide whether to keep it for confirmation or delete it after a successful restore.

External roots copy their pinned snapshot into the new base and become
ownerless static external items there. Source/document ownership is not cloned
by base restore.

## Search

Search is executed by `KnowledgeService.search(baseId, query)`:

1. Reject failed bases.
2. Reject queries without searchable tokens.
3. Derive the retrieval mode from the base config and embed the query only for embedding-backed bases. Bases without an embedding model search BM25 only; embedding-backed bases use hybrid retrieval.
4. Call `KnowledgeIndexStore.search` on the base's per-base index store with an over-fetched candidate limit (`topK × overfetch`, capped). The store runs the BM25 lane (`search_text_fts`, with a LIKE fallback for short CJK tokens) or fuses BM25 and brute-force vector results with RRF.
5. Filter results whose source items are missing, outside the base, or `deleting`, then trim to `documentCount ?? 10`.
6. Rerank when `base.rerankModelId` is configured.
7. Apply `threshold` only to results whose `scoreKind` is `relevance`; BM25/hybrid `ranking` scores pass through.
8. Assign ranks.

Current `KnowledgeSearchResult` includes:

- `pageContent`
- `score`
- `scoreKind`
- `rank`
- `metadata`
- optional `itemId`
- required `chunkId`
- optional `conceptId`
- optional `title`

`chunkId` is the search unit identity (`search_unit.unit_id`) used for result-level attribution. `itemId` equals the unit's `material_id` (= `knowledge_item.id`).

`conceptId` is the material's relative path inside the base index, not an
absolute filesystem path. Search exposes it so an agent can address the same
completed document through `kb_read` or `kb_manage`.

## Agent Tool Surface

`src/main/ai/tools/knowledgeLookup.ts` is shared by the AI SDK builtins and the
Claude Code in-process MCP bridge.

| Tool | Current operation |
|---|---|
| `kb_list` | Page through in-scope bases, or return one base's logical item tree |
| `kb_search` | Search explicit in-scope base IDs and return cited chunks plus Concept IDs |
| `kb_read` | Read a bounded document slice, or grep one document with a regular expression |
| `kb_manage` | Add a source, delete Concept IDs, or refresh/reindex Concept IDs behind user approval |

The assistant or agent's configured Knowledge bindings form the scope ceiling;
a per-turn composer selection may narrow that scope but cannot widen it. The
tool layer enforces scope before delegating to `KnowledgeService`.

### Current Retrieval Cost Assumption

The implementation does not create a vector index and does not use an indexed approximate-nearest-neighbor lookup.
Similarity search scans the `embedding` rows directly and sorts by the engine's scalar cosine distance (`vec_distance_cosine` on sqlite-vec, with the query vector bound as a raw little-endian float32 BLOB).

This means retrieval cost scales roughly linearly with the number of vector rows in a single knowledge base.
This is an exact implementation boundary, not an indexed-ANN scaling
guarantee. No second vector index exists in the current contract.
