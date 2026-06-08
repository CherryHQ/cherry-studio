# Agent 07 Review: Migration, Delete, Restore

> 状态(2026-06-08): 本评审写于实现之前。部分"当前状态"描述已被 baseline + 顺手改动改变(详见 ../../../drift-report-2026-06-08.md)。本篇仍作为待执行计划的依据阅读。
>
> baseline 现状校准(本篇相关):
> - v1 迁移已把上传文件拷入 `{newBaseId}/`、写 relativePath、不写 knowledge `file_ref`(`KnowledgeMigrator.ts:767`)。本篇关于停写 `file_ref`/拷文件的内容已具备地基。
> - `KnowledgeVectorMigrator` 此前把重建向量写到 legacy 扁平路径,与运行时读取的 `{newBaseId}/.cherry/index.sqlite` 不一致(迁移后向量被孤立、搜索返回空);已在 `a6128a6da9` 修复(读源/写目标分离 + 运行时路径回归测试)。但迁移器**仍写旧 `libsql_vectorstores_embedding` 单表格式**,本篇关于"迁进新 index.sqlite(9 表 material)形态"的内容仍是未来工作。
> - `knowledge_item.id == material.material_id`:当前迁移重新生成 id(moot),本篇"保留合法旧 id"仍是未来目标。
> - note 迁移仍读 inline `data.content`(快照模型未做);本篇 note 快照内容为未来计划。

## 1. Conclusion

Directly migrating v1 knowledge data into the final v2 layout is feasible and is the right direction. The migration should create the final per-base directory and `index.sqlite` shape instead of carrying old vector artifacts forward:

```text
KnowledgeBase/{baseId}/
  index.sqlite
  materials/...
  snapshots/...
```

However, the current implementation is far from that target. It still writes knowledge `file_ref` rows, uses FileEntry ids as knowledge file identity, migrates vectors into the old `libsql_vectorstores_embedding` table, and stores each LibSQL vector database as a single file named after the base id rather than `{baseId}/index.sqlite`.

The plan's delete/restore/migration sections are internally consistent if the path helper, material file copier, and `KnowledgeIndexStore` work lands first. Without those primitives, trying to patch migration alone will either preserve the wrong artifacts or introduce a second temporary storage model.

## 2. Codebase Survey

Required searches were run before narrowing:

```bash
rg -n "KnowledgeMigrator"
rg -n "KnowledgeVectorMigrator"
rg -n "restore-base"
rg -n "delete-base"
rg -n "file_ref"
rg -n "fileEntryId"
rg -n "libsql_vectorstores_embedding"
rg -n "knowledge_item"
rg -n "knowledge_base"
rg -n "sourceFileEntryId"
rg -n "processedFileEntryId"
```

Key files inspected:

- `docs/references/knowledge/current-v2-knowledge-index-migration-plan.md`
- `docs/references/knowledge/index-sqlite-schema-design.md`
- `src/main/data/migration/v2/README.md`
- `src/main/data/migration/v2/MigrationPaths.ts`
- `src/main/data/migration/v2/migrators/KnowledgeMigrator.ts`
- `src/main/data/migration/v2/migrators/KnowledgeVectorMigrator.ts`
- `src/main/data/migration/v2/migrators/mappings/KnowledgeMappings.ts`
- `src/main/data/migration/v2/migrators/__tests__/KnowledgeMigrator.test.ts`
- `src/main/data/migration/v2/migrators/__tests__/KnowledgeMigrator.fileRefIntegration.test.ts`
- `src/main/data/migration/v2/migrators/__tests__/KnowledgeVectorMigrator.test.ts`
- `src/main/services/knowledge/KnowledgeService.ts`
- `src/main/services/knowledge/__tests__/KnowledgeService.test.ts`
- `src/main/data/services/KnowledgeBaseService.ts`
- `src/main/data/services/KnowledgeItemService.ts`
- `src/main/services/knowledge/vectorstore/KnowledgeVectorStoreService.ts`
- `src/main/services/knowledge/vectorstore/providers/LibSqlVectorStoreProvider.ts`
- `src/main/services/knowledge/readers/KnowledgeUrlReader.ts`

Current plan summary:

- Current v2 should create `KnowledgeBase/{baseId}/index.sqlite`.
- Knowledge should not use `file_ref`.
- `knowledge_item.id` should become the material id for leaf material rows.
- Delete leaf should cancel active work, mark rows `deleting`, delete material/index rows, delete `relativePath`, delete `indexedRelativePath`, and delete global rows last.
- Delete base should cancel active work, close the index store handle, delete the whole `KnowledgeBase/{baseId}/` directory, then delete global rows.
- Restore/duplicate should copy old base-owned files into a new base directory and rebuild the index. It should not use external file sources.
- v1 migration should write final base folders, snapshots, and `index.sqlite`; it should not write knowledge `file_ref` rows or migrate into old `libsql_vectorstores_embedding` files.

Current-code conflicts:

- `KnowledgeMappings.transformKnowledgeBase()` creates a new UUIDv4 base id instead of preserving the old base id where legal.
- `KnowledgeMappings.transformKnowledgeItem()` creates new UUIDv7 item ids, writes file item data with `{ source, fileEntryId }`, writes URL item data without a snapshot path, and writes note data with inline `content`.
- `KnowledgeMigrator.execute()` builds knowledge `file_ref` rows and drops file items whose `FileEntry` was not migrated.
- `KnowledgeVectorMigrator` creates and migrates the old `libsql_vectorstores_embedding` table with `external_id` and `collection`, then swaps the legacy per-base database path in place with `.embedjs.bak`.
- `KnowledgeService.createBase()` creates the global base row and then calls `KnowledgeVectorStoreService.createStore()`, not a base-directory initializer.
- `KnowledgeService.deleteBase()` cancels jobs and deletes the vector store file plus global SQLite rows, not the whole base-owned directory.
- `KnowledgeService.restoreBase()` reconstructs root DTOs from old item data and calls `addItems()`, so restore reuses external `fileEntryId`, URL, or inline note source instead of copying base-owned material files.
- `KnowledgeItemService.create()` validates `file_entry` and writes a source `file_ref` for file items.
- `KnowledgeItemService.deleteItemsByIds()`, `deleteFileRefsForSubtreeTx()`, `replaceFileRef()`, and `rebuildFileRefsForItems()` are still file-ref centric.
- `LibSqlVectorStoreProvider.getKnowledgeBaseFilePath()` resolves a single file path under `feature.knowledgebase.data`, not `{baseId}/index.sqlite`.
- `KnowledgeVectorStoreService.deleteStore()` already closes cached LibSQL clients before deletion; keep that behavior when deletion becomes directory deletion.

Migration path safety:

- Runtime code should resolve the root with `application.getPath('feature.knowledgebase.data')`, then join a sanitized base id and `index.sqlite`.
- Migration code should use `ctx.paths` / `MigrationPaths`, not `application.getPath()`, because the v1 migration context can target custom user data.
- `MigrationPaths` currently exposes `knowledgeBaseDir`; it needs explicit final v2 base-directory/index/material/snapshot helpers or a migration-safe path service.

URL and sitemap nuance:

- File materials and notes can be migrated directly once base path and snapshot helpers exist.
- A durable historical URL/sitemap Markdown snapshot source was not found in the current inspected code. `KnowledgeUrlReader` fetches live content through Jina on read, and sitemap expansion creates URL children. The migration must decide whether to live-refetch, skip/mark failed, or reconstruct from legacy vector `pageContent`.

## 3. Code Volume Estimate

Agent 07's slice is large because it spans migration, destructive cleanup, restore/duplicate, and old-vector retirement.

Expected volume after path/index/schema primitives exist:

- 600-1000 production lines for migration changes.
- 900-1600 test lines for migration coverage and inverted old-vector/file-ref assertions.
- 250-500 production lines for delete-base, delete-leaf, restore, and duplicate folder semantics.
- 400-800 test lines for delete/restore crash and copy behavior.

The total churn will look larger in review because old tests currently assert the behavior being removed: knowledge `file_ref` creation, FileEntry filtering, old `libsql_vectorstores_embedding`, `.embedjs.bak`, and `external_id` storage.

## 4. Required Code Changes With Files/Functions

`src/main/data/migration/v2/MigrationPaths.ts`

- Add migration-safe helpers for final knowledge paths:
  - base directory: `KnowledgeBase/{baseId}/`
  - source/material files
  - generated snapshots
  - index database: `KnowledgeBase/{baseId}/index.sqlite`
- Ensure base ids and relative paths cannot escape the migration root.

`src/main/data/migration/v2/migrators/mappings/KnowledgeMappings.ts`

- Preserve old base ids when they are legal under the final schema.
- Preserve old item ids when they are legal under the final `KnowledgeItemIdSchema`.
- Keep an id remap for any invalid ids that must change, and apply it consistently to parents, groups, jobs, and material ids.
- Stop producing persisted knowledge item data shaped around `fileEntryId` or inline note content.
- Produce final data with `relativePath` and, when already available, `indexedRelativePath`.

`src/main/data/migration/v2/migrators/KnowledgeMigrator.ts`

- Stop writing knowledge `file_ref` rows.
- Stop requiring a migrated `FileEntry` row for a file knowledge item.
- Copy v1 source files into the final base directory.
- Write note Markdown snapshots into the base directory.
- Apply the final URL/sitemap policy once decided.
- Initialize `index.sqlite` with the final schema for every migrated base.
- Create material rows with `material.material_id = knowledge_item.id`.
- Populate content/search rows only from final base-owned files/snapshots.
- Record failed/skipped material states instead of silently dropping items when source content is unavailable.

`src/main/data/migration/v2/migrators/KnowledgeVectorMigrator.ts`

- Retire the current old-table migration path, or gate it behind a strict compatibility mode that is not the default.
- Do not create `libsql_vectorstores_embedding`.
- Do not swap old per-base databases with `.embedjs.bak` as the final migration behavior.
- Prefer rebuilding `index.sqlite` from migrated material files and snapshots.
- Only reuse legacy embeddings if all final invariants match exactly: material id, embedding text hash, model id, dimensions, and search-unit text. Otherwise skip old vectors.

`src/main/services/knowledge/KnowledgeService.ts`

- `createBase()` should initialize the base directory and `index.sqlite` through the new path/index service.
- `deleteBase()` should cancel active jobs, close the index store handle, delete `KnowledgeBase/{baseId}/`, then delete global rows.
- `restoreBase()` should copy base-owned material files and indexed snapshots to a new base directory, create new rows pointing at those copied relative paths, initialize a new `index.sqlite`, and schedule or run index rebuild.
- `duplicateBase()` should follow the same file-copy and rebuild path as restore if implemented separately.
- Do not route restore through external file sources, old URLs, or inline note content.

`src/main/data/services/KnowledgeItemService.ts`

- Remove knowledge source identity dependence on `file_ref`.
- Stop creating source `file_ref` rows for file knowledge items.
- Add or keep a focused method to update `indexedRelativePath` after processing.
- Keep global row deletion last in destructive flows so crash retry can still read `relativePath` and `indexedRelativePath`.

`src/main/data/services/KnowledgeBaseService.ts`

- Keep global metadata ownership here.
- Do not add base-directory side effects unless this service becomes the explicit owner of base file lifecycle. Prefer a dedicated knowledge path/file service if Agent 03 provides one.

`src/main/services/knowledge/vectorstore/providers/LibSqlVectorStoreProvider.ts`

- Replace the single-file path with `{baseId}/index.sqlite`, or retire this provider behind the new `KnowledgeIndexStore`.
- Keep handle-close-before-delete semantics from `KnowledgeVectorStoreService.deleteStore()`.

`src/main/services/knowledge/readers/KnowledgeUrlReader.ts`

- Do not assume URL migration can restore old content from this reader. It currently reads live URL content, so migration needs an explicit policy before using it.

## 5. Blockers/Open Decisions

- Final id preservation rule: the plan says preserve legal old ids, but current item ids are generated as UUIDv7. Decide whether to preserve only valid UUIDv7 ids, relax the schema, or remap invalid ids with a durable migration map.
- URL/sitemap source policy: live-refetch during migration, mark missing/failed, or reconstruct from legacy vector `pageContent`.
- Embedding policy: migration should probably rebuild from final files and skip old vectors by default. If migration must avoid online embedding, it needs a durable "needs rebuild" state.
- Missing embedding model behavior: decide whether bases with missing models migrate as failed-but-restorable material files with no index rows.
- Legacy artifact cleanup: define what happens to old `.embedjs`, `.embedjs.bak`, and current-v2 single-file vector databases after final folder migration.
- Current-v2 dev data compatibility: decide whether current dev data can be reset/rebuilt instead of migrated through compatibility code.
- Copy rollback policy: delete/restore/migration need a manifest or staged-copy rule so partial directories can be retried safely after crashes.

## 6. Phase Split Advice

1. Path and index primitives first.
   - Verify: new code can create `KnowledgeBase/{baseId}/index.sqlite` with the final table set and reject path escapes.

2. Runtime base lifecycle next.
   - Verify: create, delete, restore, and duplicate use base-owned directories and no knowledge `file_ref`.

3. Rewrite `KnowledgeMigrator` to final artifacts.
   - Verify: v1 migration creates global rows, material files, snapshots, and `index.sqlite` without old vector tables.

4. Retire or replace `KnowledgeVectorMigrator`.
   - Verify: old `libsql_vectorstores_embedding` is not created in the final migration path; skipped old vectors trigger rebuild behavior.

5. Clean up inverted tests and docs.
   - Verify: old file-ref/vector tests are replaced with final folder/index/material assertions.

## 7. Test Recommendations

- v1 migration creates `KnowledgeBase/{baseId}/index.sqlite` with all final index tables and correct `index_meta.base_id`.
- File migration copies source files into the base directory, persists `relativePath`, and creates no knowledge `file_ref`.
- Note migration writes a Markdown snapshot and does not persist inline note content as the source of truth.
- URL/sitemap migration follows the final chosen policy with explicit tests for unavailable source content.
- Legal old base and item ids are preserved; illegal ids are remapped consistently across parents, groups, jobs, and material ids.
- Old `libsql_vectorstores_embedding` is never created in the final path.
- Legacy vectors are skipped unless exact final embedding invariants match.
- Delete leaf is idempotent after partial crashes before index delete, after file delete, and before global row delete.
- Delete base closes the index store handle before deleting the directory.
- Restore copies both `relativePath` and `indexedRelativePath` files, rebuilds the index, and does not read external source paths.
- Duplicate follows restore semantics with new global ids and new copied files.
- Path traversal attempts in migrated paths, delete paths, and restore paths are rejected.
- Missing model or missing source content leaves restorable material state and no stale search results.

## 8. Dependencies On Other Agents

- Agent 02: final schemas, id constraints, DTO split, and material/status model.
- Agent 03: base path helpers, safe copy/delete primitives, snapshot naming, and rollback/staging policy.
- Agent 04: file-processing contract using `relativePath` and `indexedRelativePath`.
- Agent 05: `KnowledgeIndexStore`, final `index.sqlite` schema, rebuild/delete/search APIs, and old vector retirement.
- Agent 06: job cancellation, crash recovery, delete idempotency, and rebuild scheduling semantics.
- Agent 08: preload/IPC/UI removal of FileEntry assumptions and single-chunk delete behavior.
- Agent 09: rollout gates, migration verification, and current-v2 data compatibility decision.

## 9. Cross Review Notes

- Agent 03 strengthens the copy rollback blocker. Migration, restore, duplicate, and runtime import should use the same knowledge-owned path/copy/snapshot rules, but migration must still resolve paths through `ctx.paths` / `MigrationPaths` instead of `application.getPath()`. Agent 10 should decide whether this is a runtime helper with a migration root override or a separate migration-safe wrapper.
- Agent 03's staging policy changes migration design from "copy as we go" to a manifest-based flow. Each migrated base should track copied source files, generated URL/note snapshots, initialized `index.sqlite`, and failed/skipped materials so a failed base can either clean uncommitted files or leave a recorded recoverable state. URL/sitemap migration must create local snapshots or explicit failed material states; it should not rely on normal readers refetching network content later.
- Agent 06 aligns with the leaf delete ordering in this report: mark rows `deleting`, cancel linked knowledge/FileProcessing jobs, delete material/index rows, delete `relativePath` and `indexedRelativePath`, then delete global `knowledge_item` rows last. Keeping rows until the end is required because crash retry needs the cleanup targets.
- Base delete needs one extra clarification for Agent 10. The intended order is cancel active work, close the per-base index handle, delete `KnowledgeBase/{baseId}/`, then remove global base/item rows. If a crash happens after directory removal but before global row deletion, recovery needs a durable base-level deleting intent or an idempotent path where missing base directories cause global cleanup, not stranded failed items.
- Restore/duplicate should follow Agent 03's copy manifest and Agent 06's rebuild scheduling model: copy base-owned `relativePath` / `indexedRelativePath` files into the new base first, create durable rows that point only at copied paths, initialize the new index, then schedule rebuild. It should not read external `source`, `fileEntryId`, URL live content, or inline note content.
- Agent 09's rollout gates cover the main migration risks if they explicitly include migration acceptance: no knowledge `file_ref`, no old `libsql_vectorstores_embedding`, legal id preservation/remap, snapshot creation, index initialization, skipped-vector rebuild state, and crash-safe failed-base retry/cleanup. These should be stop/go checks before preview/nightly promotion, not deferred hardening.
- The old current-v2 dev data decision is now consistent across Agents 06, 07, and 09: prefer rejecting or rebuilding stale current-v2 rows/jobs/vector files over compatibility shims. Agent 10 should make that explicit so `KnowledgeVectorMigrator`, old job payloads, and single-file vector DBs are not kept alive by ambiguity.
- Potential conflict for Agent 10: Agent 03 recommends copy/snapshot outside long base mutation locks, while Agent 06 requires destructive/index writes under `KnowledgeLockManager.withBaseMutationLock` and `DbService.withWriteTx`. The clean split is staged filesystem work outside the DB lock, short durable row/index writes under the lock, and manifest cleanup on failure.
