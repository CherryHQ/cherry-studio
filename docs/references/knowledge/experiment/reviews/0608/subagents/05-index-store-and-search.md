# Agent 05 Review: Index Store and Search

## 1. Conclusion

Add a knowledge-specific `KnowledgeIndexStore`; do not rewrite `packages/vectorstores/libsql` as the primary migration path.

The existing `LibSQLVectorStore` is a generic `BaseVectorStore` implementation around one table:

```text
libsql_vectorstores_embedding(id, external_id, collection, document, metadata, embeddings)
```

The target knowledge index is not that shape. It is a material/content/search graph:

```text
index_meta
material
material_relation
content
search_unit
content_index_entry
search_text
embedding
search_text_fts
```

Trying to turn the generic package into this graph would either pollute `@vectorstores/libsql` with Cherry knowledge semantics or force the knowledge layer to keep awkward `Document`/`BaseVectorStore` shims. The current v2 plan already says to replace `replaceByExternalId(itemId, nodes)` with `rebuildMaterial(materialId, input)`, and the schema doc says `search_unit.material_id = knowledge_item.id = material.material_id` replaces the old `external_id` abstraction.

The POC must prove four things before the broader migration starts:

- `rebuildMaterial()` can atomically replace all rows for one material across `content`, `search_unit`, `search_text`, FTS, and `embedding`.
- The chunker can produce stable offsets where `content.text.slice(charStart, charEnd) === body search_text.text`, including repeated paragraphs.
- `search()` can implement vector, BM25, and hybrid retrieval from the new tables while still returning the current chunk-oriented `KnowledgeSearchResult`.
- `listItemChunks()` can be preserved via `listMaterialUnits()`, while `deleteItemChunk()` is removed or returns an explicit unsupported error.

## 2. Codebase Survey

Required broad search was run before narrowing:

```bash
rg -n "replaceByExternalId|deleteByIdAndExternalId|listByExternalId|KnowledgeSearchResult|deleteItemChunk|listItemChunks|embedding|hybrid|BM25|chunk|FTS" src/main/services/knowledge packages/vectorstores docs/references/knowledge
```

Additional searches used:

```bash
rg --files src/main/services/knowledge/vectorstore packages/vectorstores/libsql src/main/services/knowledge/utils/indexing src/main/services/knowledge
rg -n "search|listItemChunks|deleteItemChunk|KnowledgeSearchResult|chunk" src/main/services/knowledge packages/vectorstores/libsql packages/vectorstores
rg -n "index|search|FTS|BM25|hybrid|vector|chunk|embedding" docs/references/knowledge/index-sqlite-schema-design.md docs/references/knowledge/current-v2-knowledge-index-migration-plan.md
rg -n "KnowledgeVectorStoreService|KnowledgeIndexStore|LibSqlVectorStoreProvider|BaseVectorStoreProvider|KnowledgeVectorStore" src/main src/shared packages docs/references/knowledge
```

Core files inspected:

- `docs/references/knowledge/index-sqlite-schema-design.md`
- `docs/references/knowledge/current-v2-knowledge-index-migration-plan.md`
- `src/main/services/knowledge/vectorstore/KnowledgeVectorStoreService.ts`
- `src/main/services/knowledge/vectorstore/types.ts`
- `src/main/services/knowledge/vectorstore/providers/BaseVectorStoreProvider.ts`
- `src/main/services/knowledge/vectorstore/providers/LibSqlVectorStoreProvider.ts`
- `packages/vectorstores/libsql/src/LibSQLVectorStore.ts`
- `packages/vectorstores/libsql/src/index.ts`
- `packages/vectorstores/libsql/src/utils.ts`
- `src/main/services/knowledge/utils/indexing/chunk.ts`
- `src/main/services/knowledge/utils/indexing/embed.ts`
- `src/main/services/knowledge/utils/indexing/rerank.ts`
- `src/main/services/knowledge/utils/search.ts`
- `src/main/services/knowledge/utils/cleanup/vectorCleanup.ts`
- `src/main/services/knowledge/KnowledgeService.ts`
- `src/main/services/knowledge/jobs/indexDocumentsJobHandler.ts`
- `src/main/services/knowledge/jobs/deleteSubtreeJobHandler.ts`
- `src/main/services/knowledge/jobs/reindexSubtreeJobHandler.ts`
- `src/main/services/knowledge/KnowledgeWorkflowService.ts`
- `src/shared/data/types/knowledge.ts`
- `src/main/services/knowledge/types/ipc.ts`
- `src/preload/index.ts`
- `src/main/apiServer/routes/knowledge/handlers.ts`
- `src/main/ai/tools/adapters/aiSdk/builtin/KnowledgeSearchTool.ts`
- relevant tests under `src/main/services/knowledge/**/__tests__` and `packages/vectorstores/libsql/tests/LibSQLVectorStore.test.ts`

Cross-module call chain found:

- Create base: `KnowledgeService.createBase()` -> `KnowledgeVectorStoreService.createStore()` -> `LibSqlVectorStoreProvider.create()` -> `new LibSQLVectorStore(...)`.
- Index item: `indexDocumentsJobHandler` -> `chunkDocuments()` -> `embedKnowledgeDocuments()` -> `vectorStore.replaceByExternalId(itemId, nodes)` -> item status `completed`.
- Search: `KnowledgeService.search()` -> `embedKnowledgeQuery()` -> `vectorStore.query({ queryStr, queryEmbedding, mode, similarityTopK, alpha })` -> map returned `Document` nodes into `KnowledgeSearchResult` -> visibility filter -> optional rerank -> threshold/rank.
- List chunks: `KnowledgeService.listItemChunks()` -> leaf subtree discovery -> `vectorStore.listByExternalId(item.id)` -> `mapChunkDocument()`.
- Delete chunk: `KnowledgeService.deleteItemChunk()` -> `vectorStore.deleteByIdAndExternalId(chunkId, itemId)`.
- Delete/reindex cleanup: `deleteKnowledgeItemVectors()` -> `vectorStore.replaceByExternalId(itemId, [])`.

Important current-code observations:

- `KnowledgeVectorStore` extends `BaseVectorStore`, so search is coupled to generic vectorstore query/results.
- `LibSqlVectorStoreProvider` stores one SQLite file at `application.getPath('feature.knowledgebase.data', sanitizeFilename(baseId, '_'))`, not `KnowledgeBase/{baseId}/index.sqlite`.
- `LibSQLVectorStore` already has useful implementation pieces: libSQL client lifecycle, `F32_BLOB(dimensions)`, `vector32(?)`, `vector_distance_cos`, FTS5 external-content table, triggers, BM25 search, hybrid RRF with `combineResults()`, and collection-scoped delete/list.
- `chunkDocuments()` currently calls `SentenceSplitter.splitText()` and returns text-only `Document` chunks. It does not preserve `charStart` or `charEnd`.
- `embedKnowledgeDocuments()` embeds chunk text and wraps chunks as `TextNode`s with `NodeRelationship.SOURCE = item.id`. This exists to feed `external_id`; the new store should not depend on this relationship.
- `KnowledgeSearchResult` remains chunk-shaped: `pageContent`, `score`, `scoreKind`, `rank`, `metadata`, optional `itemId`, and `chunkId`.
- `KnowledgeChunkMetadataSchema` currently contains `itemId`, `itemType`, `source`, `chunkIndex`, and `tokenCount`; no offset or locator fields are exposed in the current runtime shape.
- The plan and schema docs explicitly say current v2 keeps chunk-oriented search output, uses `chunkId = search_unit.unit_id`, and does not support single chunk deletion.

Uncovered areas:

- I did not inspect renderer implementation deeply except to identify the chunk delete/list callers; Agent 08 owns UI/preload/IPC.
- I did not inspect v1 migrator implementation beyond search hits; Agent 07 owns migration/delete/restore.
- I did not validate libSQL runtime behavior with a live POC; this report is review/planning only.

## 3. Code Volume Estimate

Size: large for this scope, and very large when combined with path-based material import and migration.

Current touched surface for index/search alone is already about 1,900 production lines across the active vectorstore, indexing utilities, service methods, job handler, and cleanup helper. Existing directly related tests are about 3,800 lines.

Heaviest production modules:

- `src/main/services/knowledge/vectorstore/*`: replace `BaseVectorStore`/provider concepts with `KnowledgeIndexStore` service/provider, schema initializer, SQL helpers, and handle lifecycle.
- `packages/vectorstores/libsql/src/LibSQLVectorStore.ts`: should mostly stay generic; only low-level logic should be copied or extracted if needed. Rewriting it directly would touch an 838-line package plus 1,596 lines of package tests.
- `src/main/services/knowledge/KnowledgeService.ts` and `src/main/services/knowledge/jobs/indexDocumentsJobHandler.ts`: must switch search/list/delete/rebuild call sites to material/index-store semantics.

Expected index/search code volume:

- New/changed production files: roughly 8-14 files.
- Core production code changed or added: roughly 900-1,500 lines.
- Test code changed or added: roughly 1,200-2,000 lines.

Expected shape:

- Add `KnowledgeIndexStore` types, libSQL implementation, schema initializer, search mappers, and store service/provider replacement.
- Replace `KnowledgeVectorStoreService` or rename it carefully to `KnowledgeIndexStoreService`.
- Keep `packages/vectorstores/libsql` mostly intact unless a tiny reusable utility extraction is clearly justified.
- Update tests for `KnowledgeService`, index job, cleanup, vector/index store service, chunking, embedding, and search.

## 4. Required Code Changes With Files/Functions

`src/main/services/knowledge/vectorstore/types.ts`

- Replace `KnowledgeVectorStore extends BaseVectorStore` with a knowledge-owned interface.
- Suggested shape:

```ts
interface KnowledgeIndexStore {
  rebuildMaterial(materialId: string, input: RebuildMaterialInput): Promise<void>
  deleteMaterial(materialId: string): Promise<void>
  listMaterialUnits(materialId: string): Promise<KnowledgeSearchUnit[]>
  search(input: KnowledgeIndexSearchInput): Promise<KnowledgeIndexSearchResult[]>
  close(): Promise<void>
}
```

`src/main/services/knowledge/vectorstore/KnowledgeVectorStoreService.ts`

- Convert to `KnowledgeIndexStoreService` or keep the service name temporarily with new semantics.
- Cache stores by `base.id`, but open `KnowledgeBase/{baseId}/index.sqlite`.
- Validate `index_meta.base_id === base.id` on open.
- Validate embedding snapshot against `knowledge_base.embeddingModelId` and `knowledge_base.dimensions`.
- Close via `store.close()`, not `instanceof LibSQLVectorStore`.
- Delete whole base directory only after closing the store handle.

`src/main/services/knowledge/vectorstore/providers/LibSqlVectorStoreProvider.ts`

- Replace with a knowledge-specific provider/initializer.
- Path must become `path.join(application.getPath('feature.knowledgebase.data'), sanitizeFilename(baseId, '_'), 'index.sqlite')`.
- Do not pass nested `baseId/index.sqlite` as `application.getPath(..., filename)`.
- Initialize all nine tables from the schema doc.

New store implementation, likely under `src/main/services/knowledge/vectorstore/`

- Implement `LibSqlKnowledgeIndexStore`.
- Use schema tables from `index-sqlite-schema-design.md`.
- `rebuildMaterial()` must do one write transaction:
  - upsert `material`
  - upsert `content`
  - delete old `search_unit`/`search_text` for the material
  - insert new `search_unit`
  - insert body `search_text`
  - maintain FTS by trigger or same-transaction writes
  - insert missing `embedding`
  - update `material.current_content_hash`, `last_indexed_at`, and error fields
- `deleteMaterial()` replaces `replaceByExternalId(itemId, [])`.
- `listMaterialUnits()` replaces `listByExternalId(itemId)`.
- `search()` must support:
  - vector: `search_text` join `embedding`, ordered by vector distance
  - BM25: `search_text_fts` join back through `search_text.rowid`
  - hybrid: RRF/weighted fusion equivalent to current user-visible behavior
  - filtering `material.status = active` and `material.index_policy = index`
  - body-only result content for current v2, or body lookup when non-body kinds are introduced

`packages/vectorstores/libsql/src/LibSQLVectorStore.ts`

- Do not make this the knowledge store.
- Reuse concepts only: FTS tokenization, vector blob handling, transaction style, BM25 query pattern, and hybrid RRF.
- Leave generic `add/query/delete/listByExternalId` package semantics alone unless future work decides to extract shared helpers.
- Replace `console.warn` usage only if this package remains inside product logging scope in a later implementation task; this review did not modify it.

`src/main/services/knowledge/utils/indexing/chunk.ts`

- Change chunking output from text-only `Document` to a DTO with offsets:

```ts
type ChunkWithOffset = {
  text: string
  charStart: number
  charEnd: number
  unitIndex: number
  title?: string
  locator?: unknown
  metadata: KnowledgeChunkMetadata
}
```

- Prove repeated text does not produce wrong offsets. A cursor-based matcher is acceptable; a naive `text.indexOf(chunkText)` from the beginning is not.
- `mapChunkDocument()` should be replaced or supplemented by a mapper from `KnowledgeSearchUnit` to `KnowledgeItemChunk`.

`src/main/services/knowledge/utils/indexing/embed.ts`

- Stop building `TextNode` objects only to satisfy `BaseVectorStore`.
- Add a function that embeds `search_text.text` and returns `{ embeddingTextHash, text, vector }`.
- Keep existing model-id and dimension validation.
- Preserve current v2 requirement that completed bases have embedding model and dimensions; no FTS-only base in this phase.

`src/main/services/knowledge/jobs/indexDocumentsJobHandler.ts`

- Replace `vectorStore.replaceByExternalId(itemId, nodes)` with `indexStore.rebuildMaterial(itemId, input)`.
- Input must include material path/provenance, whole normalized content text, chunks with offsets, body search text rows, and embedding rows.
- Remove the `rebuildFileRefsForItems()` call when the path-based material phase lands.
- Reindex flow must avoid the current completed-item fast path for user-triggered rebuilds, as the plan notes.

`src/main/services/knowledge/utils/cleanup/vectorCleanup.ts`

- Replace with material cleanup, probably `deleteKnowledgeItemIndexes()`.
- It should call `indexStore.deleteMaterial(itemId)` for each leaf id.
- Empty rebuild as delete should disappear from the domain API.

`src/main/services/knowledge/KnowledgeService.ts`

- `search()` should call `KnowledgeIndexStore.search()` and map to current `KnowledgeSearchResult`.
- `filterVisibleSearchResults()` can stay as the final current-v2 guard against deleted/failed `knowledge_item` rows.
- `listItemChunks()` should call `listMaterialUnits()` and map units to `KnowledgeItemChunk`.
- `deleteItemChunk()` should be removed from IPC/preload/UI or return a clear unsupported `DataApiErrorFactory.invalidOperation(...)`. It must not delete one derived `search_unit`.
- `deleteBase()` must close the index store before deleting the base directory.

`src/main/services/knowledge/types/ipc.ts`, `src/preload/index.ts`

- Keep search and list chunks payloads compatible.
- Remove `DeleteItemChunk` or keep a temporary unsupported stub. Agent 08 should decide the UI/API removal shape.

`src/main/apiServer/routes/knowledge/handlers.ts` and `src/main/ai/tools/adapters/aiSdk/builtin/KnowledgeSearchTool.ts`

- These can remain compatible if `KnowledgeService.search()` preserves the current `KnowledgeSearchResult` shape.
- They are useful acceptance checks for result compatibility.

## 5. Blockers/Open Decisions

- Store location and naming: confirm whether the class/service is renamed to `KnowledgeIndexStoreService` immediately or whether `KnowledgeVectorStoreService` is retained as a transitional service name.
- FTS maintenance: choose triggers vs explicit same-transaction writes. The schema doc allows either; the POC should pick one and prove deletes/updates do not leave stale FTS rows.
- FTS tokenizer/CJK behavior: current libSQL token query extracts `[\p{L}\p{N}_]+` and quotes tokens. This is probably acceptable for POC parity, but CJK quality remains a product/search decision.
- Chunk offset source of truth: decide whether to fork/wrap `SentenceSplitter` with cursor tracking or replace it with a local splitter that returns offsets natively.
- Stable IDs and hashes: define exact hash algorithm/prefix for `content_hash`, `embedding_text_hash`, `search_text_id`, and `unit_id`.
- Embedding GC: immediate cleanup of unreachable embeddings vs deferred GC. POC can defer GC, but `rebuildMaterial()` must not delete shared embeddings blindly.
- Score compatibility: current vector search returns `1 - distance`, BM25 uses absolute `bm25()` score, and hybrid uses `combineResults()`. The POC must decide what score values and `scoreKind` mean for current v2 threshold behavior.
- Single chunk delete: plan says remove or unsupported. Leaving it functional would contradict the derived-index model.
- Per-base libSQL concurrency: current base mutation lock serializes knowledge mutations, but the POC must still prove libSQL batch/write behavior under retries and concurrent job scheduling.

## 6. Phase Split Advice

Phase 1: narrow POC for `KnowledgeIndexStore`

- Add the store in isolation with an in-memory or temp-file libSQL DB.
- Create schema, `index_meta`, one material, one content row, body chunks, FTS, embeddings.
- Prove `rebuildMaterial`, `search`, `listMaterialUnits`, `deleteMaterial`, and `close`.
- Keep product call sites unchanged during this POC if possible.

Phase 2: chunk/embedding adapter

- Change `chunkDocuments()` or add a new chunker that returns offsets.
- Change embedding helper to return vectors keyed by `embedding_text_hash`.
- Add repeated-text offset tests.

Phase 3: write path integration

- Update `indexDocumentsJobHandler` and cleanup to call `rebuildMaterial()`/`deleteMaterial()`.
- Keep current `KnowledgeSearchResult` and `KnowledgeItemChunk` outward shapes.

Phase 4: read/search integration

- Update `KnowledgeService.search()` and `listItemChunks()`.
- Keep API server, AI tool, recall test panel, and preload consumers compatible.
- Make `deleteItemChunk()` unsupported or remove the path with Agent 08.

Phase 5: base lifecycle and path alignment

- Switch store path to `KnowledgeBase/{baseId}/index.sqlite`.
- Ensure create/delete/restore/reindex close and reopen handles correctly.
- Coordinate with path/file agents before deleting whole base directories.

Phase 6: migration and cleanup

- Stop migrating old chunks into `libsql_vectorstores_embedding`.
- Rebuild current v2/v1 materials into the new schema.
- Add any deferred GC once correctness is stable.

## 7. Test Recommendations

POC-level tests:

- Schema initialization creates all nine tables and validates `index_meta.base_id`.
- Store open fails or enters explicit repair path when `index_meta.base_id` mismatches.
- Embedding snapshot mismatch is detected and does not mix old vectors with new dimensions.
- `rebuildMaterial()` inserts material/content/search_unit/search_text/embedding rows.
- `rebuildMaterial()` is atomic: simulated insert failure leaves the old visible units intact.
- Empty material rebuild is not used as delete; `deleteMaterial()` handles deletion explicitly.
- FTS insert/update/delete behavior has no stale hits after rebuild and delete.
- Vector, BM25, and hybrid search each return expected unit ids.
- Hybrid search ranking remains deterministic for overlapping vector and BM25 hits.
- Search filters out `material.status != active` and `index_policy != index`.
- Current v2 mapping returns `pageContent = body chunk`, `itemId = material_id`, `chunkId = unit_id`, `metadata.chunkIndex = unit_index`.
- If a non-body `search_text.kind` is later indexed, result content still resolves to the body chunk.
- `listMaterialUnits()` returns chunks in `unit_index` order and without requiring embeddings.
- `deleteItemChunk()` returns unsupported if kept.

Chunk/embedding tests:

- Repeated paragraphs produce correct `charStart`/`charEnd`.
- `content.text.slice(charStart, charEnd)` equals body search text for every generated chunk.
- `unit_id` is stable across identical rebuilds.
- Changing chunk size/overlap changes units predictably and does not corrupt old rows during failed rebuild.
- Embedding dimension validation still rejects empty or wrong-width vectors.
- Duplicate chunk text reuses `embedding_text_hash` safely.

Integration tests:

- `KnowledgeService.search()` still works for API server and built-in AI knowledge search tool.
- `KnowledgeService.listItemChunks()` works for leaf items and container subtrees.
- Delete subtree removes material indexes before global `knowledge_item` rows disappear.
- Reindex completed item really rebuilds when explicitly requested.
- Base delete closes store handles before directory deletion.

Do not rely only on `packages/vectorstores/libsql/tests/LibSQLVectorStore.test.ts`; those tests prove the old generic table, not the new knowledge schema.

## 8. Dependencies on Other Agents

- Agent 02, data model/schema: needs to confirm final `knowledge_item.id = material.material_id`, persisted item data shape, and exact `index.sqlite` DDL.
- Agent 03, file storage/paths: needs to provide the base directory/path service and path safety rules for `KnowledgeBase/{baseId}/index.sqlite`.
- Agent 04, file processing/MinerU: needs to provide `indexedRelativePath` and path-based Markdown output so `rebuildMaterial()` indexes the right material text.
- Agent 06, workflow/jobs/recovery: needs to align reindex/delete job semantics with `rebuildMaterial()` and `deleteMaterial()` idempotency.
- Agent 07, migration/delete/restore: needs to stop old vector migration into `libsql_vectorstores_embedding` and rebuild the new index from material files.
- Agent 08, UI/preload/IPC: needs to remove the single chunk delete UI/API or convert it to unsupported, while preserving search/list chunk compatibility.
- Agent 09, testing/rollout: should turn the POC proof points above into acceptance gates and PR split criteria.

## 9. Cross Review Notes

Reviewed against Agent 02, Agent 06, and Agent 09 reports.

- Agent 02 matches this store interface: current v2 leaf `knowledge_item.id` is the `material.material_id`, `search_unit.material_id` points back to that id, `KnowledgeSearchResult.itemId = material_id`, and `chunkId = search_unit.unit_id`. Directories and sitemap containers must not create material rows.
- Agent 02 adds one store-input constraint: `material.relative_path` should be the indexed text source, meaning `indexedRelativePath` when present, otherwise `relativePath`. `rebuildMaterial(materialId, input)` should receive that resolved path from the workflow/reader layer, not infer it from old `FileEntry` metadata.
- Required Agent 10 clarification: migration must decide whether legacy item ids are preserved, relaxed, or remapped. The store can support any stable string material id, but current v2 compatibility is simplest only if the global `knowledge_item.id` and index `material.material_id` remain identical.
- Agent 06 makes idempotency a hard API requirement, not just a POC nicety. `rebuildMaterial(materialId, sameInput)` must be retry-safe and atomic; a failed rebuild must leave either the old visible units or the new visible units, never a mixed set.
- `deleteMaterial(materialId)` must be explicit, idempotent, and safe when the material is already missing. Delete/reindex recovery depends on repeated calls after crashes, and global `knowledge_item` row deletion must remain last so retry can still resolve source paths.
- Empty rebuild should not be used as delete. Reindex should preserve the material/file identity and let the follow-up index job replace derived rows; delete should remove material/search rows and coordinate with file cleanup.
- Agent 09's POC gates cover the highest-risk store proof points: per-base `index.sqlite`, atomic rebuild rollback, FTS rowid mapping, current chunk-shaped result mapping, `listMaterialUnits`, `deleteMaterial`, and handle close before directory deletion.
- Add one Agent 10 gate: the POC should explicitly exercise retry-shaped duplicate calls for `rebuildMaterial`, `deleteMaterial`, and close/delete-base ordering, plus stale/missing material filtering after failed path reads. Those are the workflow recovery risks Agent 06 depends on.
- No conflict found with keeping `packages/vectorstores/libsql` generic. Agent 09's rollout should place new tests under the knowledge index-store module unless Agent 10 intentionally changes that ownership.
