# Agent 02 Review: Data Model And Schema

Date: 2026-06-07

## 1. Conclusion

Conditionally feasible.

Moving `knowledge_item.data` from FileEntry/inline-content facts to `relativePath` / `indexedRelativePath` is the right data model for current v2, but it is not a small schema-only change. It is feasible only if the persisted type change lands with the path/import, reader, job payload, and index-store changes that make those relative paths real. A data-only change would break current v2 DataApi reads and runtime indexing immediately because shared zod schemas, `KnowledgeItemService.create`, readers, file-processing jobs, vector cleanup, and renderer item rows still assume `fileEntryId` or inline `content`.

The global DB table shape can mostly remain: `knowledge_base` is already the durable metadata table, and `knowledge_item.data` is JSON, so Drizzle does not need many new global columns. The hard part is contract shape and service semantics:

- `src/shared/data/types/knowledge.ts` currently requires `file.data.fileEntryId`, `note.data.content`, and URL live-fetch semantics.
- `src/main/data/services/KnowledgeItemService.ts` validates `file_entry` and writes knowledge `file_ref` rows for file items.
- `src/main/services/knowledge/*` still schedules and parses `sourceFileEntryId` / `processedFileEntryId`, reads FileManager paths, and writes vectors by old `external_id = itemId`.
- The per-base `index.sqlite` target schema is new and should be introduced as a knowledge-specific `KnowledgeIndexStore`, not by rewriting the generic libSQL vectorstore package, with `knowledge_item.id = material.material_id` for current v2 leaf items.

## 2. Codebase Survey

### Commands And Keywords

Required broad searches were run before narrowing:

- `rg` terms: `knowledge`, `Knowledge`, `knowledge_item`, `knowledge_base`, `fileEntryId`, `file_ref`, `replaceByExternalId`, `processedFileEntryId`, `sourceFileEntryId`, `deleteItemChunk`.
- Follow-up file lists used `rg -l` for the same terms, plus targeted searches for `listByExternalId`, `deleteByIdAndExternalId`, `replaceFileRef`, `rebuildFileRefsForItems`, `relativePath`, `indexedRelativePath`, and `KnowledgeBase/{baseId}`.

Notable search counts from the required pass:

- `knowledge`: 4,753 matching lines.
- `Knowledge`: 283 matching lines in the sampled output set.
- `replaceByExternalId`: 59 matching lines.
- `processedFileEntryId`: 24 matching lines.
- `sourceFileEntryId`: 27 matching lines.
- `deleteItemChunk`: 22 matching lines.

### Files Read

Required docs:

- `docs/references/knowledge/current-v2-knowledge-index-migration-plan.md`
- `docs/references/knowledge/index-sqlite-schema-design.md`

Local conventions and related references:

- `docs/README.md`
- `docs/references/data/README.md`
- `docs/references/naming-conventions.md`
- `src/main/data/README.md`
- `src/main/data/db/README.md`
- `src/main/core/paths/README.md`
- `.agents/skills/gh-pr-review/SKILL.md`
- `.agents/skills/gh-pr-review/references/cherry-review-guidance.md`

Required source files:

- `src/shared/data/types/knowledge.ts`
- `src/main/data/db/schemas/knowledge.ts`
- `src/main/data/services/KnowledgeItemService.ts`
- `src/main/data/services/KnowledgeBaseService.ts`

Additional source files read because they are direct contract consumers:

- `src/shared/data/api/schemas/knowledges.ts`
- `src/main/data/api/handlers/knowledges.ts`
- `src/main/services/knowledge/KnowledgeService.ts`
- `src/main/services/knowledge/KnowledgeWorkflowService.ts`
- `src/main/services/knowledge/jobs/jobTypes.ts`
- `src/main/services/knowledge/jobs/utils/jobInput.ts`
- `src/main/services/knowledge/jobs/indexDocumentsJobHandler.ts`
- `src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts`
- `src/main/services/knowledge/jobs/prepareRootJobHandler.ts`
- `src/main/services/knowledge/jobs/deleteSubtreeJobHandler.ts`
- `src/main/services/knowledge/jobs/reindexSubtreeJobHandler.ts`
- `src/main/services/knowledge/readers/KnowledgeReader.ts`
- `src/main/services/knowledge/readers/KnowledgeFileReader.ts`
- `src/main/services/knowledge/readers/KnowledgeUrlReader.ts`
- `src/main/services/knowledge/readers/KnowledgeNoteReader.ts`
- `src/main/services/knowledge/utils/sources/sourcePlanning.ts`
- `src/main/services/knowledge/utils/sources/directory.ts`
- `src/main/services/knowledge/utils/sources/sitemap.ts`
- `src/main/services/knowledge/utils/sources/url.ts`
- `src/main/services/knowledge/vectorstore/types.ts`
- `src/main/services/knowledge/vectorstore/KnowledgeVectorStoreService.ts`
- `src/main/services/knowledge/vectorstore/providers/LibSqlVectorStoreProvider.ts`
- `src/main/services/knowledge/utils/cleanup/vectorCleanup.ts`
- `packages/vectorstores/libsql/src/LibSQLVectorStore.ts`
- `src/main/core/paths/pathRegistry.ts`
- `src/main/data/migration/v2/migrators/KnowledgeMigrator.ts`
- `src/main/data/migration/v2/migrators/KnowledgeVectorMigrator.ts`
- `src/main/data/migration/v2/migrators/mappings/KnowledgeMappings.ts`
- `src/renderer/pages/knowledge/components/AddKnowledgeItemDialog.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemRow.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemChunkDetailPanel.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/utils/models.ts`

Tests sampled:

- `src/shared/__tests__/knowledge-schemas.test.ts`
- `src/main/data/services/__tests__/KnowledgeItemService.test.ts`
- `src/main/data/services/__tests__/KnowledgeBaseService.test.ts`
- `src/main/data/api/handlers/__tests__/knowledges.test.ts`
- `src/main/services/knowledge/__tests__/KnowledgeService.test.ts`
- `src/main/services/knowledge/__tests__/KnowledgeService.integration.test.ts`
- `src/main/services/knowledge/jobs/__tests__/*`
- `src/main/services/knowledge/vectorstore/__tests__/KnowledgeVectorStoreService.test.ts`
- renderer knowledge panel tests discovered by targeted `rg`.

### Cross-Module Dependencies Found

- Shared type boundary: `KnowledgeItemSchema` parses every DB row returned by `KnowledgeItemService.rowToKnowledgeItem`; changing `data` shape without updating all persisted fixtures and runtime inputs will fail DataApi list/detail reads.
- DataApi boundary: knowledge item CRUD writes are not exposed through DataApi; runtime create/delete/reindex goes through `KnowledgeService` IPC, while DataApi list/detail returns `KnowledgeItem`.
- File identity: `KnowledgeItemService.create` checks `file_entry` for file items and inserts `file_ref` with `sourceType = knowledge_item`; delete paths also clean `file_ref`.
- Job payloads: `knowledge.check-file-processing-result` requires `sourceFileEntryId`; `knowledge.index-documents` optionally carries `processedFileEntryId`; `narrowKnowledgeJobInput` rejects target path-only payloads today.
- Reader behavior: file reads use `FileManager.getPhysicalPath(fileEntryId)`, URL reads fetch via Jina every reindex, and note reads `data.content`.
- Index storage: current provider stores one libSQL file at `KnowledgeBase/{baseId}` and old table `libsql_vectorstores_embedding(external_id, document, metadata, embeddings)`. Target requires `KnowledgeBase/{baseId}/index.sqlite` with 9 knowledge-specific tables.
- Renderer contracts: add-file currently resolves FileEntry before submission; file rows/chunk panels query `/files/entries/:id`; note title derives from inline `data.content`; chunk panel calls `deleteItemChunk`.
- Migration: v1 mapping currently creates new UUIDv7 item ids, file data with `fileEntryId`, and note data with inline `content`. It does not preserve legal old item ids as current-v2 `material_id`.

### Uncovered Areas And Why

- Full file/path helper design, rollback of copied files, keep-both allocation, symlink policy: assigned to Agent 03.
- File-processing path input/output persistence, MinerU `context.dataId`, remote-poll recovery: assigned to Agent 04.
- Full `KnowledgeIndexStore` SQL/query implementation, FTS ranking, embedding GC, chunk offsets: assigned to Agent 05.
- Delete/reindex race and recovery behavior after material-level cleanup: assigned to Agent 06.
- v1 migration, restore/duplicate, base delete filesystem cleanup: assigned to Agent 07.
- UI and preload migration details: assigned to Agent 08.

### Risks Assigned To Other Agents

- Agent 03: path validation is a blocker for any persisted `relativePath`; `application.getPath(..., filename)` only warns on unsafe filename values and is not enough for user-controlled relative paths.
- Agent 04: file-processing result ownership must be proven by `context.dataId` and output path, not `sourceFileEntryId`.
- Agent 05: `replaceByExternalId(itemId, nodes)` must be replaced with `rebuildMaterial(materialId, input)` while preserving atomic replacement.
- Agent 06: current completed fast-path in `indexDocumentsJobHandler` skips already-completed items; reindex must force rebuild under the new model.
- Agent 07: migration must decide whether old v1 item ids are legal enough to preserve, and must build knowledge-owned snapshots/files before global rows claim `relativePath`.
- Agent 08: if `deleteItemChunk` is kept as a stub, UI must remove or gracefully handle it before users can trigger unsupported derived-index deletion.

## 3. Code Volume Estimate

Overall size for data-model/schema plus immediate contract fallout: large.

This is not just `knowledge.ts` and one service. Expect roughly:

- Source files: 18 to 30 files for Agent 02-owned contracts and mandatory adjacent backend changes.
- Core LOC: 1,200 to 2,400 LOC for schemas, services, index-store interface/initializer glue, job payload updates, readers, and migration mapping changes.
- Test LOC: 1,800 to 3,500 LOC for schema, service, job payload, path-data validation, material id, and compatibility tests.

Heaviest 3 files/modules:

- `src/shared/data/types/knowledge.ts`: shared persisted entity schemas, runtime add-item command schema split, relative-path validation, search/chunk compatibility types.
- `src/main/data/services/KnowledgeItemService.ts`: remove knowledge FileEntry/file_ref identity, add path-data mutation helpers such as `updateIndexedRelativePath`, preserve row-to-entity parsing, and adjust delete semantics.
- New or replacement knowledge index store module: likely under `src/main/services/knowledge/vectorstore/*` or a renamed `KnowledgeIndexStore`; it must initialize per-base schema and expose material-level APIs.

Secondary high-volume modules:

- `src/main/services/knowledge/jobs/*`
- `src/main/services/knowledge/readers/*`
- `src/main/data/migration/v2/migrators/*`
- renderer/preload tests that assert current old data shapes.

## 4. Required Code Changes

### Shared Types And Runtime Contracts

`src/shared/data/types/knowledge.ts`

- Add a central relative-path schema for `relativePath` and `indexedRelativePath`: non-empty, POSIX-normalized, not absolute, no `..`, no NUL, and no `.cherry` / `.cherry/**`.
- Change persisted file leaf data from `{ source, fileEntryId }` to `{ source, relativePath, indexedRelativePath? }`.
- Change persisted URL leaf data from `{ source, url }` to `{ source, url, relativePath }`.
- Change persisted note leaf data from `{ source, content, sourceUrl? }` to `{ source, relativePath, sourceUrl? }`.
- Keep directory and sitemap container data as `{ source, path }` and `{ source, url }` for current v2 unless Agent 06 changes container command semantics.
- Split command input from persisted entity shape. Current `KnowledgeRuntimeAddItemInputSchema = CreateKnowledgeItemSchema` means renderer input and stored data are identical. Target semantics require file path, URL, or note content as command input while persisted rows store copied/snapshotted `relativePath`.
- Preserve current v2 search shape: `KnowledgeSearchResult.pageContent`, `metadata.itemId`, `chunkId`, and `KnowledgeItemChunk` can remain, but `chunkId` should map to `search_unit.unit_id`.

`src/shared/data/api/schemas/knowledges.ts`

- Keep `/knowledge-bases/:id/items` and `/knowledge-items/:id` response type as `KnowledgeItem` if current v2 UI remains item-driven.
- Do not add DataApi mutations for material indexing or file commands; runtime operations should stay IPC/service-owned.

### Global DB Schemas

`src/main/data/db/schemas/knowledge.ts`

- Global table shape can remain largely unchanged: `knowledge_base` and `knowledge_item` already match current-v2 retention goals.
- `knowledge_item.data` remains JSON, but schema comments should stop describing chunks/embeddings as generic vector-store artifacts once the new per-base index exists.
- No global `material` table should be added; material belongs in per-base `index.sqlite`.
- Keep `knowledge_item.id` as UUIDv7 for new current-v2 leaf items. For migration, allow explicit insertion of preserved legal old ids only if they pass `KnowledgeItemIdSchema` or the project intentionally relaxes the item id schema.

### Knowledge Item Service

`src/main/data/services/KnowledgeItemService.ts`

- Remove file item validation against `fileEntryTable` from `create`.
- Stop inserting knowledge `file_ref` rows on file item creation.
- Stop deleting knowledge `file_ref` as part of normal knowledge item delete, once no knowledge rows own those refs.
- Remove or deprecate knowledge callers of `replaceFileRef` and `rebuildFileRefsForItems`; if other modules still need them during transition, keep them private to compatibility code and do not call them from new knowledge flows.
- Add `updateIndexedRelativePath(itemId, indexedRelativePath)` or a more general `updateItemData(itemId, updater)` method with type-aware validation.
- Add helpers for leaf item path lookup if useful, but avoid making this service resolve filesystem paths directly; path ownership should stay in the knowledge path/file helper.

`src/main/data/services/KnowledgeBaseService.ts`

- `delete` should no longer know about knowledge `file_ref` rows after FileEntry identity is removed.
- Keep global row CRUD and metadata validation here; per-base index file creation/deletion belongs to `KnowledgeService`/index-store service.

### Per-Base Index Schema And Material ID Rules

New knowledge index store module, likely replacing or wrapping `src/main/services/knowledge/vectorstore/*`

- Initialize the 9 target tables from `index-sqlite-schema-design.md`: `index_meta`, `material`, `material_relation`, `content`, `search_unit`, `content_index_entry`, `search_text`, `embedding`, `search_text_fts`.
- Current v2 should use `KnowledgeBase/{baseId}/index.sqlite`; v2.x later moves this to `.cherry/index.sqlite`.
- On open, verify `index_meta.base_id === baseId`.
- For every current-v2 leaf `knowledge_item`, create/upsert `material.material_id = knowledge_item.id`.
- `material.relative_path` should point to the actual file being indexed: `indexedRelativePath` when present, otherwise `relativePath`.
- Directories and sitemap containers must not create `material`.
- Current v2 should create but not actively maintain `material_relation` and `content_index_entry`.
- Replace old vectorstore operations:
  - `replaceByExternalId(itemId, nodes)` -> `rebuildMaterial(materialId, input)`
  - `listByExternalId(itemId)` -> `listMaterialUnits(materialId)`
  - `deleteByIdAndExternalId(chunkId, itemId)` -> remove from public API or unsupported.
  - `replaceByExternalId(itemId, [])` cleanup -> `deleteMaterial(materialId)` or rebuild with empty units, depending on delete/reindex semantics.

`src/main/services/knowledge/vectorstore/providers/LibSqlVectorStoreProvider.ts`

- Stop treating `application.getPath('feature.knowledgebase.data', sanitizeFilename(baseId, '_'))` as the DB file.
- Use a path helper that returns `path.join(application.getPath('feature.knowledgebase.data'), safeBaseId, 'index.sqlite')`.

`packages/vectorstores/libsql/src/LibSQLVectorStore.ts`

- Either introduce a knowledge-specific store instead of modifying the generic vectorstore package, or heavily refactor this package. Current table and APIs are old `external_id`-based and not compatible with target material/content/search schema.

### Readers, Jobs, And Workflow Contracts

`src/main/services/knowledge/readers/*`

- `KnowledgeReader` should accept `baseId` and resolve `item.data.indexedRelativePath ?? item.data.relativePath` through the knowledge path helper.
- File reader should stop calling `FileManager.getPhysicalPath(fileEntryId)`.
- URL reader should stop fetching network content during ordinary reindex; read Markdown snapshot by `relativePath`.
- Note reader should stop reading `data.content`; read Markdown snapshot by `relativePath`.

`src/main/services/knowledge/utils/sources/sourcePlanning.ts`

- Infer file extension from `indexedRelativePath ?? relativePath`, not from `source`.
- If `indexedRelativePath` exists, normal reindex should index that path and should not retrigger document-to-Markdown processing.

`src/main/services/knowledge/KnowledgeWorkflowService.ts`

- `addItems` should treat renderer input as commands. It must copy/snapshot material into the base directory, create `knowledge_item` with final path data, create/upsert per-base `material`, then schedule processing or indexing.
- `scheduleFileProcessingCheck` should remove `sourceFileEntryId`.
- `scheduleIndexing` should remove `processedFileEntryId`; indexing reads the latest item data.

`src/main/services/knowledge/jobs/jobTypes.ts` and `src/main/services/knowledge/jobs/utils/jobInput.ts`

- Change target payloads to:
  - `knowledge.index-documents`: `{ baseId, itemId, parentJobId }`
  - `knowledge.check-file-processing-result`: `{ baseId, itemId, fileProcessingJobId, pollRound, firstScheduledAt, parentJobId }`
- Update recovery/narrowing so persisted old job snapshots either fail safely or are ignored during development migration.

`src/main/services/knowledge/jobs/indexDocumentsJobHandler.ts`

- Remove `rebuildFileRefsForItems`.
- Remove `processedFileEntryId` override path.
- Read from relative path, generate content/search units/search text/embeddings, and call `rebuildMaterial`.
- Rework the `item.status === 'completed'` fast-path so explicit reindex can still rebuild.

`src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts`

- Validate file-processing job by `context.dataId === itemId` and output target path inside the base directory.
- Write `indexedRelativePath` into `knowledge_item.data`.
- Update `material.relative_path` to the indexed path or do it inside `rebuildMaterial`.
- Stop calling `replaceFileRef`.

`src/main/services/knowledge/jobs/deleteSubtreeJobHandler.ts` and `reindexSubtreeJobHandler.ts`

- Replace vector cleanup with material-level index cleanup.
- Delete leaf files using `relativePath` and `indexedRelativePath` before deleting global rows.
- Preserve "row deleted last" semantics for crash recovery.

`src/main/services/knowledge/KnowledgeService.ts`

- `createBase` must create the base directory, initialize `index.sqlite`, and write `index_meta`.
- `deleteBase` must close the index store handle before deleting the base directory and global rows.
- `listItemChunks` should call `listMaterialUnits` and map back to current `KnowledgeItemChunk`.
- `deleteItemChunk` should be removed from preload/API or return a clear unsupported error.
- `restoreBase` cannot re-add old item data as runtime inputs; it must copy source base-owned files and rebuild with new rows/materials.

### Migration

`src/main/data/migration/v2/migrators/mappings/KnowledgeMappings.ts`

- Stop mapping legacy files to `fileEntryId`.
- Stop mapping notes to persisted `content`.
- Generate material files/snapshots and store `relativePath` in item data.
- Current code generates `id: uuidv7()` for every migrated item. Target docs require preserving old `knowledge_item.id` when legal and non-conflicting, so this needs an explicit decision and implementation.

`src/main/data/migration/v2/migrators/KnowledgeMigrator.ts`

- Stop creating knowledge source `file_ref` rows.
- Copy legacy file material into `KnowledgeBase/{baseId}/`.
- Write URL/note Markdown snapshots.
- Initialize per-base `index.sqlite` and material rows or delegate to the same index-store initializer used at runtime.

`src/main/data/migration/v2/migrators/KnowledgeVectorMigrator.ts`

- Current code rebuilds old `libsql_vectorstores_embedding` rows. Target should either rebuild into new `content/search_unit/search_text/embedding` schema or skip old vector reuse unless exact text/model/dimension compatibility is proven.

### Renderer And Preload Contract Touchpoints

Owned mainly by Agent 08, but required to preserve current v2 UI:

- `src/preload/index.ts`: remove or unsupported `knowledgeRuntime.deleteItemChunk`; update add-item DTO type.
- `src/renderer/pages/knowledge/components/AddKnowledgeItemDialog.tsx`: stop resolving FileEntry before file add; submit source path command input.
- `src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemRow.tsx`: stop querying `/files/entries/:id` for file item title.
- `src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemChunkDetailPanel.tsx`: stop querying FileEntry and remove single chunk delete UI.
- `src/renderer/pages/knowledge/panels/dataSource/utils/models.ts`: derive file title/suffix from `relativePath`/`source`; note title cannot depend on inline `data.content`.

## 5. Blockers / Open Decisions

- Relative path validator and storage normalization must be centralized in the knowledge-owned path/file helper, with shared schemas reusing or exactly mirroring those rules, before new persisted data is accepted.
- Command input vs persisted entity shape must be split. Keeping `KnowledgeRuntimeAddItemInputSchema = CreateKnowledgeItemSchema` is incompatible with "external path/content is command input, relativePath is persisted fact."
- Material id rule needs final handling for v1 migration. Current new rows use UUIDv7; legacy item ids may not be UUIDv7. Decide whether to relax `KnowledgeItemIdSchema`, remap old ids, or preserve only valid UUIDv7 old ids.
- `material.relative_path` for processed PDFs points to Markdown while `knowledge_item.data.relativePath` points to PDF. This duality is documented, but implementation must decide whether `material` is created before processing with source path and then updated, or only finalized during indexing.
- `deleteItemChunk`: remove entirely or keep a compatibility stub that always returns unsupported. Current UI can call it.
- Per-base index access layer: implement as a replacement `KnowledgeVectorStoreService`, a renamed `KnowledgeIndexStoreService`, or a separate service. The old `BaseVectorStore` abstraction does not fit.
- Migration reuse of old embeddings: docs allow only exact match; current migrator blindly writes old external-id vector rows. Decide whether to rebuild all vectors for v1 -> current v2.
- Development upgrade of existing current-v2 data: docs say dev vector data can be discarded, but existing global `knowledge_item.data` rows with `fileEntryId`/`content` still need either a dev migration or a rebuild/reset path.

## 6. Phase Split Advice

1. Schema and command contract split -> verify: shared schema tests accept target persisted data and reject unsafe paths; runtime add input can carry external path/content without being persisted.
2. Path/material creation foundation -> verify: create base initializes `KnowledgeBase/{baseId}/index.sqlite`; add file/url/note writes a knowledge-owned file and `knowledge_item.data.relativePath`.
3. Remove FileEntry identity from knowledge items -> verify: adding file items creates no `file_entry` or knowledge `file_ref`; existing non-knowledge FileRef tests still pass.
4. Path-based readers and file-processing payloads -> verify: ordinary reindex reads base-owned files/snapshots and no longer needs `sourceFileEntryId` / `processedFileEntryId`.
5. KnowledgeIndexStore material API -> verify: `rebuildMaterial`, `deleteMaterial`, `listMaterialUnits`, and search map to current v2 chunk result shape.
6. Delete/reindex/restore/migration cleanup -> verify: leaf delete removes files/index before row deletion; restore copies base-owned files; v1 migration writes target shape.
7. UI/preload compatibility cleanup -> verify: current v2 UI still lists items, reindexes, views chunks, searches, and no longer exposes single-chunk deletion.

Avoid landing target `KnowledgeItemDataSchema` before readers/importers can create and consume `relativePath`; that would break DataApi row parsing and runtime add flows.

## 7. Test Recommendations

- Shared schema tests:
  - file/url/note target persisted data accepted.
  - unsafe `relativePath` and `indexedRelativePath` rejected: absolute, `..`, empty, NUL, `.cherry`, `.cherry/index.sqlite`.
  - command input schema accepts external file path and note content while persisted schema does not.
- Global DB/service tests:
  - `KnowledgeItemService.create` accepts file item without FileEntry and creates no `file_ref`.
  - `updateIndexedRelativePath` validates item type and path.
  - list/get parse target `knowledge_item.data` rows.
  - delete no longer depends on FileRef cleanup for knowledge.
- Index schema tests:
  - create base creates 9 tables and `index_meta`.
  - `index_meta.base_id` mismatch refuses open.
  - `material.material_id = knowledge_item.id`.
  - directory/sitemap items do not create material.
  - processed file updates `material.relative_path` to `indexedRelativePath`.
- Job payload tests:
  - `narrowKnowledgeJobInput` accepts target payloads and rejects old malformed path/file-entry payloads as intended.
  - check-file-processing validates `context.dataId` and output path.
  - index job reads latest `indexedRelativePath ?? relativePath`.
- Reader tests:
  - file/url/note reindex reads local base-owned files.
  - URL reindex does not call network fetch.
  - note reindex does not read inline content.
  - missing material file marks item/material failed or missing without returning stale search results.
- Search/chunk compatibility tests:
  - `listItemChunks` maps `search_unit` rows to current `KnowledgeItemChunk`.
  - current `KnowledgeSearchResult` maps `material_id` to `itemId` and `unit_id` to `chunkId`.
  - `deleteItemChunk` removed or unsupported behavior is tested.
- Migration tests:
  - v1 file creates copied file and `relativePath`, no knowledge `file_ref`.
  - v1 URL/note creates Markdown snapshot and `relativePath`.
  - legal old item ids are preserved or explicitly remapped according to the final decision.
  - old external-id vectors are not migrated into the old vector table.

## 8. Dependencies On Other Agent Conclusions

- Agent 01 confirms the docs accurately represent the intended decisions; this review assumes those docs are authoritative for current v2.
- Agent 03 must define the path/file helper and exact relative-path safety rules. Agent 02's schema should reuse that validator or mirror it exactly.
- Agent 04 must confirm file-processing path input/output persistence and MinerU output behavior before `indexedRelativePath` can be reliably written.
- Agent 05 must define final `KnowledgeIndexStore` methods and DDL implementation details. Agent 02 depends on its `material_id`, `unit_id`, and search-result mapping.
- Agent 06 must decide job sequencing, reindex force behavior, and delete/reindex recovery. Data contracts should not freeze old job payloads before that.
- Agent 07 must own v1 migration, restore/duplicate, base deletion, and embedding reuse policy.
- Agent 08 must update preload and renderer so current v2 UI remains usable without FileEntry and without single-chunk delete.
- Agent 09 should turn the phase split above into rollout gates and CI/test coverage.

## 9. Cross Review Notes

Reviewed against Agent 03 and Agent 05 reports.

- Agent 03 refines the path requirement: Agent 02's schema-level `relativePath` validation is necessary but not sufficient. The implementation blocker is a main-process, knowledge-owned path/file helper that owns base directory resolution, keep-both allocation, `.cherry` exclusion, path-inside-base checks, and rollback manifests. Shared zod schemas should mirror or call the same validator, but must not be treated as the only safety boundary.
- Agent 03 also clarifies that `application.getPath('feature.knowledgebase.data', filename)` is warning-only for unsafe filename values and must not be used with nested user-controlled relative paths. Agent 02's requirement for POSIX-normalized, non-absolute, no-`..`, no-NUL, no-`.cherry/**` paths remains correct, but path resolution belongs to the helper using `application.getPath('feature.knowledgebase.data')` plus safe joins.
- Agent 05 refines the index claim: the target should be a knowledge-specific `KnowledgeIndexStore`, not a retrofit of `packages/vectorstores/libsql`. Agent 02's material-id rule remains aligned: current v2 leaf `knowledge_item.id` should equal `material.material_id`, and `chunkId` should map to `search_unit.unit_id`.
- No conflict found between Agent 02 and Agent 05 on outward API compatibility. Both expect current `KnowledgeSearchResult` and `KnowledgeItemChunk` shapes to survive while internal storage moves from old `external_id` rows to material/search-unit rows.
- Remaining sequencing dependency: Agent 03's path helper and Agent 05's index-store path migration both must land before `{baseId}` can safely become a directory containing user materials and `index.sqlite`.
- Required clarification: decide whether shared relative-path validation imports a common helper or duplicates a shared pure validator, because main-process path resolution cannot live directly in shared renderer schemas.
