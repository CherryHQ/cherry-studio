# Agent 10 Chief Architect Review

> 状态(2026-06-08): 本评审写于实现之前。部分"当前状态"描述已被 baseline + 顺手改动改变(详见 ../../../drift-report-2026-06-08.md)。本篇仍作为待执行计划的依据阅读。
>
> baseline 现状校准:index 库已位于 `{baseId}/.cherry/index.sqlite`(隐藏布局已落地,移动已发生);`KnowledgeIndexStore` + material 模型仍未实现,本篇 `{baseId}/index.sqlite` 指其未来目标(按 `.cherry` 布局)。

Date: 2026-06-07

## 1. Review Process

Agent 10 reviewed the completed reports:

- `01-original-session-audit.md`
- `02-data-model-and-schema.md`
- `03-file-storage-and-paths.md`
- `04-file-processing-and-mineru.md`
- `05-index-store-and-search.md`
- `06-workflow-jobs-and-recovery.md`
- `07-migration-delete-restore.md`
- `08-ui-preload-ipc.md`
- `09-testing-and-rollout.md`

Agents 02-09 completed the required cross-review pass and appended `Cross Review Notes` to their own reports. This review focuses on remaining conflicts, missing decisions, and the final execution shape.

## 2. Final Architecture Conclusion

Final conclusion: conditionally feasible.

This should move forward only after two narrow POCs:

1. `KnowledgeIndexStore` over `KnowledgeBase/{baseId}/index.sqlite`.
2. path-based file processing with durable `FileHandle`, output target, and `context.dataId`.

The review found no hard blocker in current UI, JobManager, DataApi, FileProcessing, or migration architecture. The risk is sequencing. A schema-only or vectorstore-only implementation would break current v2 because old `fileEntryId`, `file_ref`, `external_id`, `sourceFileEntryId`, `processedFileEntryId`, and `deleteItemChunk` assumptions are still distributed across backend, renderer, tests, and migration.

## 3. Conflict Matrix

| Topic | Inputs | Resolution |
| --- | --- | --- |
| Relative path validation source of truth | Agents 02, 03, 04 | Use a shared pure validator for stored POSIX relative path strings. The main-process knowledge path service must re-run validation and own absolute path resolution, containment checks, keep-both allocation, and `.cherry` exclusion. Shared zod validation is not a filesystem security boundary. |
| FileProcessing path output ownership | Agents 03, 04, 06 | Knowledge preallocates and validates the absolute output path inside the base. FileProcessing owns generic absolute path writing, atomic temp-write + rename, durable job input/output, and path artifact reporting. |
| `KnowledgeIndexStore` ownership | Agents 02, 05, 09 | Add a knowledge-specific store. Do not rewrite `packages/vectorstores/libsql` into a knowledge graph store. Reuse low-level ideas only. |
| `deleteMaterial()` scope | Agents 05, 06 | `deleteMaterial(materialId)` removes all per-base `index.sqlite` rows for that material and tolerates already-missing rows. It never deletes global `knowledge_item` rows and never deletes material files. File deletion remains workflow/path-service responsibility. |
| `deleteItemChunk` public behavior | Agents 02, 05, 06, 08, 09 | Remove the visible UI and preload call. A temporary backend unsupported stub is acceptable only during transition and must not be reachable from renderer controls. Single-chunk mutation must not remain functional. |
| Old current-v2 dev data and job payloads | Agents 04, 06, 07, 09 | Do not build compatibility shims for stale current-v2 dev jobs/vector files. Reject or rebuild them. Stable compatibility target is v1 -> final current-v2 migration. |
| Legacy v1 id preservation | Agents 02, 05, 07 | Preserve legal old base/item ids when they satisfy final schemas and do not conflict. Remap invalid ids with a durable migration map. The invariant remains `knowledge_item.id = material.material_id` after migration. |
| URL/sitemap migration source | Agents 07, 09 | Open question remains. Preferred default: create local Markdown snapshots when source content can be obtained, otherwise mark material/base recoverable without stale search rows. Do not silently live-fetch during ordinary reindex. |
| Copy/snapshot lock timing | Agents 03, 06, 07 | Stage filesystem work outside long DB locks, then perform short durable row/index writes under `KnowledgeLockManager` and `DbService.withWriteTx`. Use cleanup manifests for failure and retry. |
| Base delete crash after directory removal | Agents 07, 09 | Implementation needs a durable base-level delete intent or idempotent cleanup path. If the directory is already gone, recovery should continue deleting global rows rather than strand failed visible data. |
| Attachment/preview IPC | Agent 08 | Add a main-owned knowledge material handle API, preferably `{ baseId, itemId }` based. Renderer must not compose `KnowledgeBase/{baseId}` paths and must not convert materials back into FileEntry identity. |

## 4. Consensus Decisions

- Keep global `knowledge_base` and `knowledge_item` for current v2.
- Persist leaf item data with `relativePath` and optional `indexedRelativePath`; external paths and note content are command inputs only.
- `knowledge_item.id` is the current-v2 `material.material_id`.
- Use `KnowledgeBase/{baseId}/index.sqlite` in current v2 and leave `.cherry/index.sqlite` for v2.x.
- Keep current v2 search output chunk-shaped; map `search_unit.unit_id` to chunk id.
- Do not enable watcher, FTS-only creation, content-index UI, material-relation lifecycle, or Agent-first locator/read UI in current v2.
- Use path-based file processing for knowledge and keep FileEntry + managed artifact mode for other callers.
- Do not migrate old vectors into `libsql_vectorstores_embedding` as the final path. Rebuild the new index from base-owned material files/snapshots by default.
- Delete and rebuild are material-level operations, not chunk-level operations.

## 5. Required POCs

### POC A: KnowledgeIndexStore

Stop/go criteria:

- Initializes all target tables and writes `index_meta`.
- Rejects `index_meta.base_id` mismatch.
- `rebuildMaterial()` atomically replaces material units without mixed old/new visible rows.
- `deleteMaterial()` is idempotent.
- FTS rowids join through `search_text.rowid`, not text ids.
- Vector, BM25, and hybrid search map to current `KnowledgeSearchResult`.
- `listMaterialUnits()` maps to current read-only chunk view.
- Repeated-text chunk offsets satisfy `content.text.slice(charStart, charEnd) === bodyText`.
- Embedding contract mismatch is detected and never mixes vector dimensions.
- Store handles close before base directory deletion.

### POC B: Path-Based File Processing

Stop/go criteria:

- `StartFileProcessingJobInput` accepts `FileHandle`, output target, and `context.dataId`.
- Existing FileEntry managed-artifact callers still pass.
- Path output is durable in JobSnapshot input/output.
- Remote-poll recovery rehydrates and writes the same output path.
- MinerU uses `context.dataId ?? fileEntryId` for provider `data_id`.
- Markdown output uses atomic write semantics.
- Knowledge check-result validates `context.dataId`, output kind, and path-inside-base before writing `indexedRelativePath`.

## 6. Implementation Order

Recommended order:

1. POC A and POC B.
2. Path/data model foundation.
3. KnowledgeIndexStore runtime integration.
4. FileProcessing workflow integration.
5. Delete/reindex/prepare recovery.
6. v1 migration, restore, duplicate, and delete-base hardening.
7. UI/preload cleanup.
8. E2E and rollout hardening.

Do not land the target `KnowledgeItemDataSchema` before importers and readers can create and consume `relativePath`.

## 7. Remaining Open Questions

- Exact URL/sitemap migration policy when source content is unavailable.
- Exact attachment/preview IPC return shape for chat input compatibility.
- Whether to keep a short-lived backend unsupported `deleteItemChunk` stub after renderer removal.
- Whether final implementation names the store service `KnowledgeIndexStoreService` immediately or keeps a transitional service name.
- Whether old current-v2 dev data gets a manual cleanup note or an automated dev-only reset.

## 8. Final Instruction For Implementation Planning

Treat this as a multi-PR architecture migration. The first implementation PR should not touch UI or migration. It should prove one POC with focused tests. The full program should not start until both POCs are green and the open questions above are answered or explicitly deferred.

