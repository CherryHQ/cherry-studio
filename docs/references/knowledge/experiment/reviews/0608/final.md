# Final Review: Current v2 Knowledge Index Migration

Date: 2026-06-07

> 状态(2026-06-08): 本报告的 POC-gated 结论已部分校准。baseline 已推进:中心化 path helper(`pathStorage.ts` 函数模块)、path 化文件处理、base 目录化文件存储、迁移写 `relativePath`、渲染层去 FileEntry 均已具备地基。其中 POC B(path-based FileProcessing)对应的基础工作已落地;POC A(material 模型 + `KnowledgeIndexStore` + 9 表 `index.sqlite`)仍未开始,运行时仍是旧单表 `libsql_vectorstores_embedding` + `external_id` API,故 POC A 仍是要执行的计划。本报告作为路线图继续有效。详见 `../../drift-report-2026-06-08.md`。

## 1. Executive Summary

Final conclusion: conditionally feasible.

The current v2 knowledge migration can be implemented, but it is a system migration across data contracts, path ownership, file processing, JobManager recovery, indexing/search, migration, and UI/preload. It should not be treated as a small JSON schema or vectorstore refactor.

Largest risks:

- New `KnowledgeIndexStore` correctness, especially atomic rebuild, FTS rowid mapping, embedding contract, chunk offsets, and old result compatibility.
- path-based FileProcessing recovery, especially remote poll, MinerU `data_id`, and deterministic Markdown output.
- broad FileEntry assumptions across schema, services, readers, jobs, UI, migration, and tests.
- destructive cleanup ordering for delete, restore, duplicate, and base deletion.
- v1 migration as the stable user-data target.

Recommended first POCs:

1. `KnowledgeIndexStore` over `KnowledgeBase/{baseId}/index.sqlite`.
2. path-based file processing with `FileHandle`, `output.kind = path`, and `context.dataId`.

No full implementation branch should start before both POCs pass their stop/go tests.

> 状态(2026-06-08): POC 2(path-based file processing)对应的基础已在 baseline 落地(path 化文件处理 + `FileHandle` + `context.dataId`,index.sqlite 已位于 `KnowledgeBase/{baseId}/.cherry/index.sqlite`)。POC 1(`KnowledgeIndexStore` + 9 表 + material 模型)仍未开始,仍是要先验证再实现的计划项;运行时当前仍走旧向量库。

## 2. Consensus Decisions

- Current v2 keeps global `knowledge_base` and `knowledge_item`.
- Current v2 stores user files and snapshots under `KnowledgeBase/{baseId}/`.
- Current v2 stores the per-base index at `KnowledgeBase/{baseId}/.cherry/index.sqlite` (baseline already uses the hidden `.cherry` layout; no later move).
- Leaf `knowledge_item.id` equals `material.material_id`.
- Persisted leaf data uses `relativePath`; processed files can also use `indexedRelativePath`.
- External paths, URLs, and note content are runtime command inputs, not persisted indexing facts. (sitemap is no longer a standalone item type; v1 sitemap migrates to `url`.)
- FileEntry and `file_ref` stop being knowledge material identity.
- Knowledge path service owns base paths, containment checks, keep-both names, snapshot writes, and idempotent file deletes.
- FileProcessing supports path mode additively. Non-knowledge callers keep FileEntry + managed artifact behavior.
- `KnowledgeIndexStore` is knowledge-specific. `packages/vectorstores/libsql` stays generic.
- Current v2 search remains chunk-oriented. Internally, `search_unit.unit_id` maps to chunk id.
- `deleteItemChunk` is removed from UI/preload or kept only as a temporary unsupported backend stub.
- Old current-v2 dev data and old job payloads may be rejected or rebuilt. Do not preserve obsolete FileEntry/vectorstore compatibility.
- v1 migration rebuilds the new index from copied/snapshotted materials by default and does not migrate old `libsql_vectorstores_embedding` as the final path.

## 3. Codebase Survey Coverage

Subagents covered these keywords and paths:

- Keywords: `knowledge`, `Knowledge`, `knowledge_item`, `knowledge_base`, `fileEntryId`, `file_ref`, `replaceByExternalId`, `processedFileEntryId`, `sourceFileEntryId`, `FileProcessing`, `document_to_markdown`, `MinerU`, `deleteItemChunk`, `SaveToKnowledge`, `KnowledgeBase/{baseId}`.
- Shared contracts: `src/shared/data/types/knowledge.ts`, `src/shared/data/api/schemas/knowledges.ts`, `src/shared/file/types/handle.ts`, `src/shared/data/types/fileProcessing.ts`.
- Main data: `src/main/data/db/schemas/knowledge.ts`, `src/main/data/services/KnowledgeItemService.ts`, `src/main/data/services/KnowledgeBaseService.ts`.
- Knowledge runtime: `src/main/services/knowledge/KnowledgeService.ts`, `KnowledgeWorkflowService.ts`, `jobs/*`, `readers/*`, `utils/sources/*`, `utils/indexing/*`, `utils/cleanup/*`, `vectorstore/*`.
- File processing: `src/main/services/fileProcessing/*`, `tasks/*`, `persistence/*`, `processors/mineru/*`, `processors/open-mineru/*`.
- Vector package: `packages/vectorstores/libsql/*`.
- Migration: `src/main/data/migration/v2/*`.
- Preload/UI: `src/preload/index.ts`, `src/renderer/pages/knowledge/*`, `src/renderer/components/Popups/SaveToKnowledgePopup.tsx`, `src/renderer/pages/home/Inputbar/tools/components/AttachmentButton.tsx`.
- Tests: knowledge service/job tests, file-processing tests, migration tests, renderer knowledge tests, `tests/__mocks__/README.md`, database testing references.

Cross-module dependency summary:

- DTO split must precede renderer and workflow migration.
- Path helper must precede persisted `relativePath` usage.
- FileProcessing path mode must precede processed-PDF indexing.
- KnowledgeIndexStore must precede job/search/delete replacement.
- Delete/reindex recovery depends on idempotent material and file cleanup.
- Migration depends on final path and index-store primitives.
- UI can stay visually similar but must stop creating and resolving FileEntries for knowledge material identity.

Uncovered or still needs confirmation:

- Final URL migration policy for unavailable source content (v1 sitemap folds into this as `url`).
- Final attachment/preview IPC shape.
- Final class/service naming for `KnowledgeIndexStoreService`.

## 4. Code Volume Estimate

Overall complexity: very large.

Approximate production files touched: 45 to 75.

Approximate core code churn: 4,500 to 8,500 LOC.

Approximate test code churn: 6,000 to 11,000 LOC.

Module estimates:

| Module | Size | Notes |
| --- | --- | --- |
| Data model and shared DTOs | Large | persisted vs command schema split, service validation, tests |
| Path service and import/snapshot | Medium-large | path validation, keep-both, copy manifests, reader switch |
| FileProcessing path mode | Large | input/output contracts, path artifacts, remote poll, MinerU |
| KnowledgeIndexStore/search | Large | new store, DDL, rebuild/search/list/delete, chunk offsets |
| Workflow/jobs/recovery | Medium-large | payload changes, delete/reindex/prepare cleanup, cancellation |
| Migration/delete/restore | Large | v1 final migration, base delete, restore/duplicate, old vector retirement |
| UI/preload | Medium | command inputs, row display, chunk delete removal, attachment/preview |
| Testing/rollout | Large | POC tests, integration, migration, renderer, E2E smoke |

## 5. Proposed Implementation Phases

### Phase 0: Review Closeout And Decisions

Goal: close open questions before implementation.

Files: review docs only.

Acceptance:

- `final.md` accepted.
- URL migration policy decided (sitemap folded into `url`).
- attachment/preview IPC decided.
- `deleteItemChunk` transition behavior decided.

Can be separate PR: yes, docs-only.

### Phase 1: POC A, KnowledgeIndexStore

Goal: prove final per-base index schema and store API.

Files:

- new knowledge index-store module under `src/main/services/knowledge/vectorstore/` or renamed equivalent.
- focused tests under the same module.

Acceptance:

- DDL creates nine target tables and `index_meta`.
- `rebuildMaterial`, `deleteMaterial`, `listMaterialUnits`, `search`, `close` tested.
- atomic rebuild rollback tested.
- FTS rowid mapping tested.
- repeated-text offset tested.
- current `KnowledgeSearchResult` mapping tested.

Can be separate PR: yes.

### Phase 2: POC B, Path-Based FileProcessing

Goal: prove additive file-processing path mode.

Files:

- `src/shared/data/types/fileProcessing.ts`
- `src/main/services/fileProcessing/*`
- `src/main/services/fileProcessing/tasks/*`
- `src/main/services/fileProcessing/persistence/*`
- MinerU tests.

Acceptance:

- legacy FileEntry mode still passes.
- path input/output persists in job snapshots.
- remote-poll recovery writes same output path.
- MinerU uses `context.dataId`.
- path Markdown writes atomically.

Can be separate PR: yes.

### Phase 3: Path And Data Model Foundation

Goal: make base-owned files and persisted `relativePath` possible.

Files:

- `src/shared/data/types/knowledge.ts`
- `src/main/services/knowledge` path/file helper.
- `KnowledgeItemService`.
- `KnowledgeService.createBase`.
- direct file/url/note import helpers.

Acceptance:

- base creation creates `KnowledgeBase/{baseId}/index.sqlite`.
- shared schema rejects unsafe relative paths.
- main helper rejects traversal and `.cherry`.
- direct file add does not create FileEntry or knowledge `file_ref`.
- URL/note snapshots write Markdown files.

Can be separate PR: yes.

### Phase 4: Runtime Index Integration

Goal: replace old `external_id` vectorstore operations.

Files:

- `indexDocumentsJobHandler`
- `KnowledgeService.search/listItemChunks`
- cleanup helper
- `KnowledgeVectorStoreService` replacement or semantic migration.

Acceptance:

- no runtime `replaceByExternalId`, `listByExternalId`, or `deleteByIdAndExternalId` in knowledge runtime.
- search and chunk list keep current v2 shape.
- `deleteItemChunk` removed or unsupported.

Can be separate PR: yes, after Phase 1 and 3.

### Phase 5: FileProcessing Workflow Integration

Goal: process files using base paths and write `indexedRelativePath`.

Files:

- `KnowledgeWorkflowService`
- `checkFileProcessingResultJobHandler`
- `jobTypes`
- `jobInput`
- readers.

Acceptance:

- job payloads no longer carry `sourceFileEntryId` or `processedFileEntryId`.
- check job validates `context.dataId` and output path.
- processed PDF indexes Markdown while UI item remains PDF.
- ordinary reindex of processed PDF does not rerun processing.

Can be separate PR: yes, after Phase 2 and 3.

### Phase 6: Delete, Reindex, Restore, Migration

Goal: harden destructive and migration flows.

Files:

- delete/reindex/prepare job handlers.
- `KnowledgeService.deleteBase/restoreBase`.
- `src/main/data/migration/v2/*`.

Acceptance:

- leaf delete removes index and files before global rows.
- base delete cancels jobs, closes store, deletes directory, then global rows.
- restore/duplicate copies base-owned files and rebuilds index.
- v1 migration creates base directories, snapshots, global rows, and new index stores.
- no knowledge `file_ref` and no old `libsql_vectorstores_embedding` final path.

Can be separate PRs: yes. Migration should land after runtime target is stable.

### Phase 7: UI, Preload, Rollout Hardening

Goal: remove FileEntry assumptions from current v2 UI without redesigning it.

Files:

- `src/preload/index.ts`
- `AddKnowledgeItemDialog`
- `SaveToKnowledgePopup`
- Data Source rows/detail/selectors.
- `AttachmentButton`.

Acceptance:

- add/save submits command inputs, not FileEntry-backed persisted data.
- no `/files/entries/:id` query for knowledge item rows/chunk detail.
- no visible single-chunk delete.
- attachment/preview uses knowledge material handle.
- final grep gate has no unintended knowledge hits for old identifiers.

Can be separate PR: yes, after backend contracts exist.

## 6. Blockers And Open Questions

Must resolve before implementation:

- URL migration policy when source content is not available (sitemap folds into `url`).
- attachment/preview IPC shape for base-owned files.
- final `deleteItemChunk` transition behavior.
- legacy id preservation/remapping rule.
- base delete crash recovery when directory deletion succeeds but global row deletion does not.

Implementation blockers:

- POC A and POC B not yet proven.
- no central knowledge path helper exists.
- FileProcessing start payload/output still FileEntry-centered.
- current vectorstore path uses `KnowledgeBase/{baseId}` as a file, blocking `{baseId}/` directory ownership.
- current renderer and migration still create/use FileEntries for knowledge.

> 状态(2026-06-08): 上列实现 blocker 多数已在 baseline 解除 —— 中心化 path helper 已具备(`pathStorage.ts` 函数模块);FileProcessing 已 path 化(`output.kind = path` + `context.dataId`);index.sqlite 已是目录布局下的 `{baseId}/.cherry/index.sqlite`,不再把 `KnowledgeBase/{baseId}` 当文件,`{baseId}/` 目录归属已就绪;渲染层已去 FileEntry,迁移把上传文件拷入 base 目录并写 `relativePath`、不写 knowledge `file_ref`。仍待执行的 blocker 是 POC A(`KnowledgeIndexStore` + material 模型),其尚未开始,运行时仍走旧 `external_id` 向量库。
>
> ✅ 已修复 baseline bug(`../../drift-report-2026-06-08.md` §4):此前 v1 向量迁移把重建库写到 legacy 扁平路径 `{root}/{legacyBaseId}`,而运行时读 `{newBaseId}/.cherry/index.sqlite`,id 与布局两维度都不一致 → 迁移后的向量被孤立、运行时读到空库。已在 `a6128a6da9` 修复(读源/写目标分离 + 运行时路径回归测试);但迁移器仍写旧单表 `libsql_vectorstores_embedding` 格式,9 表 material 终态仍是未来工作。

## 7. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `KnowledgeIndexStore` atomicity is wrong | stale/mixed search rows | POC A with failure injection and rollback tests |
| FTS joins wrong row id | incorrect search result mapping | test `search_text.rowid` and FTS rowid behavior |
| chunk offsets wrong for repeated text | bad locator/read future compatibility | cursor-based offset tests |
| file-processing output path lost after restart | stuck processing or missing Markdown | durable job input/output tests |
| unsafe relative path accepted | path traversal or `.cherry` corruption | shared validator plus main containment checks |
| delete row removed too early | crash loses cleanup facts | enforce index/files before global row deletion |
| base delete crash strands rows | visible broken base | base-level deleting intent or idempotent cleanup path |
| old vectors reused incorrectly | wrong dimension/model/search results | rebuild by default; exact reuse only if proven |
| UI still creates FileEntry | broken target data model | grep gate and renderer tests |
| migration drops source content | user data loss | copy/snapshot with recoverable failed states |

## 8. Test Plan

Unit:

- relative path validation.
- command vs persisted schemas.
- chunk offsets and stable ids.
- file-processing path artifact parsing.
- source planning with `indexedRelativePath ?? relativePath`.

Integration:

- base directory and index lifecycle.
- add file/url/note -> index -> search -> list chunks -> delete.
- FileProcessing remote-poll recovery.
- delete/reindex race and crash retry.
- missing file marks material/item unavailable and search filters stale rows.

Migration:

- v1 file copies into base and persists `relativePath`.
- v1 note/url snapshots write Markdown.
- legal ids preserved and invalid ids remapped consistently.
- no knowledge `file_ref`.
- no old `libsql_vectorstores_embedding` final path.
- failed missing-model bases remain restorable.

UI/IPC:

- add dialog and SaveToKnowledge no longer call `ensureExternalEntry`.
- rows/chunk detail no longer query `/files/entries/:id`.
- chunk delete controls absent.
- attachment/preview uses knowledge material handle.
- preload validates new command inputs.

E2E/manual:

- create base, add Markdown, search, view chunks, delete.
- add processed document with mocked/lightweight processor.
- restart during import and delete cleanup.

Required gates:

- `pnpm lint`
- `pnpm test`
- `pnpm format`
- `pnpm build:check` before commits
- knowledge E2E/manual smoke before preview/nightly promotion

## 9. Subagent Report Index

- [01 Original Session Audit](./subagents/01-original-session-audit.md)
- [02 Data Model And Schema](./subagents/02-data-model-and-schema.md)
- [03 File Storage And Paths](./subagents/03-file-storage-and-paths.md)
- [04 File Processing And MinerU](./subagents/04-file-processing-and-mineru.md)
- [05 Index Store And Search](./subagents/05-index-store-and-search.md)
- [06 Workflow Jobs And Recovery](./subagents/06-workflow-jobs-and-recovery.md)
- [07 Migration Delete Restore](./subagents/07-migration-delete-restore.md)
- [08 UI Preload IPC](./subagents/08-ui-preload-ipc.md)
- [09 Testing And Rollout](./subagents/09-testing-and-rollout.md)
- [10 Chief Architect](./subagents/10-chief-architect.md)

## 10. Execution Plan

> 状态(2026-06-08): 下列 issue/PR 序列仍是有效路线图,但起点已前移。POC B(item 3,path-based FileProcessing)及 item 4(path/data foundation)、item 9(渲染去 FileEntry)对应的基础已在 baseline 落地;item 8(v1 迁移)已部分落地,其孤立向量 bug 已修复(`a6128a6da9`,见 §6 状态注 / `../../drift-report-2026-06-08.md` §4),但迁移器仍写旧单表格式。仍未开始的核心是 item 2(POC A: `KnowledgeIndexStore` + material 模型)与依赖它的 item 5(index runtime integration)。

Recommended issues or PRs:

1. Docs closeout and final decisions.
   - Input: this final report.
   - Output: accepted open-question decisions.
   - Stop condition: no unresolved blocker decisions.

2. POC A: `KnowledgeIndexStore`.
   - Input: schema design and Agent 05 gates.
   - Output: isolated tested store.
   - Stop condition: all POC A gates pass.

3. POC B: path-based FileProcessing.
   - Input: Agent 04 contract.
   - Output: additive path mode with tests.
   - Stop condition: legacy and path modes both pass.

4. Path/data foundation.
   - Input: POCs and validator decisions.
   - Output: base dirs, persisted relative paths, direct imports.
   - Stop condition: file/url/note add creates no FileEntry identity.

5. Index runtime integration.
   - Input: POC A.
   - Output: search/list/delete material behavior.
   - Stop condition: no old vectorstore runtime calls remain.

6. FileProcessing workflow integration.
   - Input: POC B and path foundation.
   - Output: `indexedRelativePath` workflow.
   - Stop condition: no knowledge job payload uses source/processed FileEntry ids.

7. Delete/reindex/recovery.
   - Input: index and path cleanup primitives.
   - Output: idempotent destructive workflows.
   - Stop condition: crash retry tests cover each cleanup phase.

8. v1 migration and restore.
   - Input: stable runtime target.
   - Output: final-shape migration and restore.
   - Stop condition: migration acceptance tests pass.

9. UI/preload cleanup.
   - Input: stable backend contracts.
   - Output: current UI without FileEntry material identity.
   - Stop condition: grep gate and UI tests pass.

Parallelism:

- POC A and POC B can run in parallel.
- UI work can start as branch work after DTO contracts freeze, but should merge after backend endpoints exist.
- Migration should not merge before runtime target schema/store is stable.

