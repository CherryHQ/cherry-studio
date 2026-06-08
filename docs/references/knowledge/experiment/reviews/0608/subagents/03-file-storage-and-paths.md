# Agent 03 Review: File Storage And Paths

> 状态(2026-06-08): 本评审写于实现之前。部分"当前状态"描述已被 baseline + 顺手改动改变(详见 ../../../drift-report-2026-06-08.md)。本篇仍作为待执行计划的依据阅读。
>
> baseline 现状校准(本篇相关):
> - 中心化路径模块已落地为 `src/main/services/knowledge/utils/storage/pathStorage.ts`(**是函数模块,不是 `KnowledgeBaseFileService` class**);本篇假设的 `resolveMaterialPath` 实际叫 `getKnowledgeBaseFilePath`。
> - `index.sqlite` 已在 `{baseId}/.cherry/index.sqlite`(`pathStorage.ts:8-28`),不是 `{baseId}/index.sqlite`;"当前 v2 放根目录、v2.x 再移进 `.cherry/`"这一步已不存在,移动已经发生。本篇下文涉及 `{baseId}/index.sqlite` 与"未来移动"的描述按此校准。
> - 冲突策略已落地为 **reject-on-conflict**("Knowledge file already exists",`pathStorage.ts:122-133`),不是 keep-both 自动生成 `_2/_3`;仅 v1 迁移器去重(用 `-N` 连字符)。本篇 keep-both 段落作为未来选项保留,但 baseline 现状是报错 + reservedPaths 预检。
> - 文件拷入 base、create 不再 `ensureExternalEntry`/不写 `file_ref`、目录导入子树路径命名空间(跳过 dotfile)均已具备地基。
> - sitemap 已不再作为独立 item 类型(`KNOWLEDGE_ITEM_TYPES = ['file','url','note','directory']`);v1 sitemap 迁移为 `url`,不再有 sitemap 专属的文件/快照存储路径。

## 1. Conclusion

Conditionally feasible. The smallest safe boundary is a main-process, knowledge-owned file/path helper, not FileManager and not raw `application.getPath(..., filename)` calls at each consumer. It should be the single owner for:

- `KnowledgeBase/{baseId}/`
- `KnowledgeBase/{baseId}/index.sqlite`
- future `KnowledgeBase/{baseId}/.cherry/index.sqlite`
- relative path validation and POSIX storage normalization
- keep-both destination allocation
- file/directory copy into the base
- URL/note Markdown snapshot writes
- material path resolution for readers, deletion, restore, and file-processing output validation

Directory and sitemap expansion can copy/snapshot first and emit `relativePath` leaf manifests without FileEntry identity. That is the right direction. The safety condition is that the manifest and cleanup are part of the same workflow boundary: if child item creation or scheduling fails after files were copied, the copied relative paths must be deleted or left in a recorded recoverable state. Today there is no such cleanup because the flow creates FileEntry refs instead of base-owned files.

The current implementation is still FileEntry-centered and conflicts with the plan in several places:

- Vector store path is a single file at `feature.knowledgebase.data/{baseId}` via `application.getPath('feature.knowledgebase.data', sanitizeFilename(baseId, '_'))`.
- File item data requires `fileEntryId`.
- Directory expansion calls `FileManager.ensureExternalEntry`.
- File readers resolve `fileEntryId` through FileManager.
- URL readers fetch network content on every read.
- Note readers read inline `data.content`.
- File processing job payloads still use `fileEntryId`, `sourceFileEntryId`, and `processedFileEntryId`.

This module should be done before or together with data-schema and workflow changes. A path helper alone cannot be safely adopted while persisted `knowledge_item.data` still requires FileEntry identity.

## 2. Codebase Survey

### Commands And Keywords

Required broad searches were run before narrowing:

- `rg -l -F 'knowledge'`
- `rg -l -F 'Knowledge'`
- `rg -n -F 'KnowledgeBase/{baseId}'`
- `rg -l -F 'fileEntryId'`
- `rg -l -F 'FileProcessing'`
- `rg -l -F 'document_to_markdown'`
- `rg -l -F 'sourceFileEntryId'`
- `rg -l -F 'SaveToKnowledge'`
- `rg -l -F '.cherry'`
- `rg -l -F 'application.getPath'`

Focused searches included:

- `rg -n -F 'application.getPath' src/main src/preload src/shared src/renderer docs/references/knowledge`
- `rg -n 'feature\.knowledgebase|KnowledgeBase|index\.sqlite|\.cherry|baseId|relativePath|indexedRelativePath|fileEntryId|sourceFileEntryId|SaveToKnowledge|document_to_markdown|FileProcessing' ...`
- `rg -n 'replaceFileRef|rebuildFileRefsForItems|file_ref|fileEntryId|processed_artifact' ...`
- `rg -n 'copyFile|copy|keep-both|sanitizeFilename|relativePath|\.cherry|hidden' ...`

### Files Read

Required docs:

- `src/main/core/paths/README.md`
- `src/main/core/paths/pathRegistry.ts`
- `src/main/core/application/Application.ts`
- `src/main/core/application/__tests__/Application.getPath.test.ts`
- `docs/references/knowledge/current-v2-knowledge-index-migration-plan.md`
- Relevant path/material sections of `docs/references/knowledge/index-sqlite-schema-design.md`

Knowledge source and reader surface:

- `src/main/services/knowledge/utils/sources/sourcePlanning.ts`
- `src/main/services/knowledge/utils/sources/prepare.ts`
- `src/main/services/knowledge/utils/sources/directory.ts`
- `src/main/services/knowledge/utils/sources/sitemap.ts`
- `src/main/services/knowledge/utils/sources/url.ts`
- `src/main/services/knowledge/readers/KnowledgeReader.ts`
- `src/main/services/knowledge/readers/KnowledgeFileReader.ts`
- `src/main/services/knowledge/readers/KnowledgeUrlReader.ts`
- `src/main/services/knowledge/readers/KnowledgeNoteReader.ts`

Workflow, jobs, and storage dependencies:

- `src/main/services/knowledge/KnowledgeWorkflowService.ts`
- `src/main/services/knowledge/KnowledgeService.ts`
- `src/main/services/knowledge/jobs/prepareRootJobHandler.ts`
- `src/main/services/knowledge/jobs/indexDocumentsJobHandler.ts`
- `src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts`
- `src/main/services/knowledge/jobs/deleteSubtreeJobHandler.ts`
- `src/main/services/knowledge/jobs/jobTypes.ts`
- `src/main/services/knowledge/jobs/utils/jobInput.ts`
- `src/main/services/knowledge/vectorstore/providers/LibSqlVectorStoreProvider.ts`
- `src/main/services/knowledge/vectorstore/KnowledgeVectorStoreService.ts`

Data and contracts:

- `src/shared/data/types/knowledge.ts`
- `src/main/data/services/KnowledgeItemService.ts`
- `src/main/data/db/schemas/knowledge.ts`
- `src/shared/data/types/file/ref/knowledgeItem.ts`
- `src/shared/data/types/file/ref/README.md`
- `src/preload/index.ts`

File primitives and processing:

- `src/main/utils/file/index.ts`
- `src/main/utils/file/fs.ts`
- `src/main/utils/file/path.ts`
- `src/main/utils/file/legacyFile.ts`
- `src/shared/file/types/filename.ts`
- `src/main/services/fileProcessing/types.ts`
- `src/main/services/fileProcessing/FileProcessingOrchestrationService.ts`
- `src/main/services/fileProcessing/tasks/jobExecution.ts`
- `src/main/services/fileProcessing/persistence/artifacts.ts`
- `src/main/services/fileProcessing/processors/types.ts`
- `src/main/services/fileProcessing/processors/mineru/document-to-markdown/handler.ts`

Tests sampled:

- `src/main/services/knowledge/utils/sources/__tests__/directory.test.ts`
- `src/main/services/knowledge/utils/sources/__tests__/sitemap.test.ts`
- `src/main/services/knowledge/utils/sources/__tests__/prepare.test.ts`
- `src/main/services/knowledge/utils/sources/__tests__/sourcePlanning.test.ts`

### Cross-Module Dependencies

- Path registry: `feature.knowledgebase.data` already exists and auto-ensures the parent directory. Nested `baseId/index.sqlite` must be built with `path.join(application.getPath('feature.knowledgebase.data'), safeBaseId, ...)`, not with `getPath` filename.
- Application path validation: `application.getPath(key, filename)` only warns on absolute paths, `..`, or separators, then joins anyway. It is not a security boundary for `relativePath`.
- FileManager: current knowledge file items depend on `file_entry` and `file_ref` through `KnowledgeItemService.create`, `replaceFileRef`, `rebuildFileRefsForItems`, directory expansion, readers, UI, and file processing.
- FileProcessing: current `StartFileProcessingJobInput` accepts only `fileEntryId`; job execution resolves `FileInfo` from FileManager; MinerU requires `fileEntryId` in prepare context.
- Vector store: current libSQL file path is `KnowledgeBase/{baseId}` as a file, so it blocks using `{baseId}` as a directory.
- Renderer/preload: current add-items contract accepts persisted `KnowledgeRuntimeAddItemInput`, and `SaveToKnowledgePopup` creates FileEntries before calling knowledge add.

### Uncovered Areas And Why

- Full libSQL `KnowledgeIndexStore` schema and search implementation: owned by Agent 05. I only checked path conflicts and old `external_id` coupling.
- Full FileProcessing path-output design: owned by Agent 04. I only checked why knowledge cannot safely call it without a path-output contract.
- Full delete/restore/v1 migration design: owned by Agent 07. I only checked where file cleanup and base directory deletion must hook in.
- Full renderer/UI migration: owned by Agent 08. I sampled `SaveToKnowledgePopup`, preload, and obvious FileEntry-dependent rows to identify dependencies.

### Risks Assigned

- Blocker: `LibSqlVectorStoreProvider.getKnowledgeBaseFilePath` currently consumes `KnowledgeBase/{baseId}` as a file. It must move to `{baseId}/index.sqlite` before base directories can own user materials.
- Blocker: persisted file items require `fileEntryId`; any path-only reader/import flow needs `KnowledgeItemDataSchema` and `KnowledgeItemService.create` changed first.
- Blocker: relative paths need a real validator. `application.getPath(..., filename)` is warning-only and unsuitable for user-controlled `relativePath`.
- Blocker: URL/note reindex currently does not read snapshots, so snapshots must be created before readers are switched.
- Warning: `prepare-root` currently performs source expansion under the base mutation lock. Copying directory trees or fetching sitemap pages there would make the lock long-lived.
- Warning: copy-first expansion can leave unmanaged files if child row creation fails unless the returned manifest is cleaned up on rollback.
- Warning: `.cherry` exclusion exists only in docs today; no central code rejects `.cherry` or `.cherry/**` relative paths.
- Notice: symlink, hidden-file, temp-file, and source-inside-target-base policies are not explicit enough in current code.

## 3. Code Volume Estimate

For Agent 03 scope only: medium to large.

Expected source changes:

- New knowledge file/path helper: 1 to 2 files, about 250 to 450 core LOC.
- Source import and expansion changes: 3 to 5 files, about 350 to 700 core LOC.
- Reader changes: 3 to 4 files, about 120 to 250 core LOC.
- Workflow glue for copy/snapshot before item creation: 1 to 2 files, about 200 to 400 core LOC.
- Path correction in vector store provider: small in LOC, high in sequencing risk.

Expected tests:

- New path helper tests: 300 to 600 LOC.
- Directory/sitemap/url/note import tests: 500 to 900 LOC.
- Reader tests: 200 to 400 LOC.
- Workflow rollback/idempotency tests: 300 to 600 LOC.

Total Agent 03 estimate: 8 to 14 source files, 7 to 12 test files, roughly 900 to 1,800 core LOC and 1,300 to 2,500 test LOC.

The heaviest three modules are:

- `src/main/services/knowledge/KnowledgeWorkflowService.ts`
- `src/main/services/knowledge/utils/sources/*`
- New `KnowledgeBaseFileService` or equivalent helper plus tests

The full knowledge migration remains very large because this scope is blocked by schema, FileProcessing, index-store, deletion/restore, and UI agents.

## 4. Required Code Changes

### New Path/File Boundary

Add a knowledge-owned helper, likely one of:

- `src/main/services/knowledge/KnowledgeBaseFileService.ts`
- `src/main/services/knowledge/utils/files/knowledgeBaseFiles.ts`

Recommended shape: stateless direct-import singleton or pure helper module. Do not register it as a lifecycle service unless it starts caching open handles or timers.

Required functions:

- `getBaseDir(baseId): string`
- `getCurrentIndexPath(baseId): string`
- `getHiddenIndexPath(baseId): string`
- `normalizeRelativePath(input): string`
- `resolveMaterialPath(baseId, relativePath): string`
- `resolveIndexablePath(baseId, data): string`
- `allocateMaterialRelativePath(baseId, preferredNameOrRelativePath): Promise<string>`
- `copyFileIntoBase(baseId, sourcePath, options): Promise<{ source: string; relativePath: string }>`
- `copyDirectoryIntoBase(baseId, sourceDir, signal): Promise<DirectoryImportManifest>`
- `writeUrlSnapshot(baseId, url, markdown): Promise<{ url: string; source: string; relativePath: string }>`
- `writeNoteSnapshot(baseId, source, content, sourceUrl?): Promise<{ source: string; relativePath: string; sourceUrl?: string }>`
- `deleteMaterialFiles(baseId, data): Promise<void>`

Validation rules must be centralized:

- non-empty
- no NUL
- not absolute
- no `..` segment after normalization
- stored with POSIX `/`
- first segment cannot be `.cherry`; use case-insensitive comparison at least on macOS/Windows, preferably everywhere for simplicity
- resolve result must be inside the base directory and not equal to the base directory
- no use of `application.getPath('feature.knowledgebase.data', 'baseId/path')`

Use existing primitives where possible:

- `application.getPath('feature.knowledgebase.data')`
- `path.join(...)`
- `sanitizeFilename(...)`
- `@main/utils/file/fs.copy`
- `@main/utils/file/fs.atomicWriteFile`
- `@main/utils/file/fs.ensureDir`
- `@main/utils/file/fs.remove` / `removeDir`

### Existing Files And Functions

`src/main/services/knowledge/vectorstore/providers/LibSqlVectorStoreProvider.ts`

- Change `getKnowledgeBaseFilePath(baseId)` from `application.getPath('feature.knowledgebase.data', sanitizeFilename(baseId, '_'))` to the path helper's `getCurrentIndexPath(baseId)`.
- Delete should remove the index file or delegate to base deletion depending on Agent 07 split.

`src/shared/data/types/knowledge.ts`

- File leaf data: replace required `fileEntryId` with `relativePath` and optional `indexedRelativePath`.
- URL leaf data: add required `relativePath`.
- Note leaf data: replace persisted `content` indexing fact with `relativePath`; keep `sourceUrl`.
- Add or reuse shared relative-path schema validation. This is Agent 02-owned but required before path readers can land.

`src/main/data/services/KnowledgeItemService.ts`

- `create`: stop checking `file_entry` for knowledge file items.
- `create`: stop inserting knowledge `file_ref` rows for source files.
- Remove or stop knowledge callers from using `replaceFileRef` and `rebuildFileRefsForItems`.
- Add `updateIndexedRelativePath(itemId, relativePath)` or equivalent if file-processing result writeback stays here.

`src/main/services/knowledge/KnowledgeWorkflowService.ts`

- `addItems`: treat renderer input as import commands, not final persisted item data. Copy/snapshot first, then create `knowledge_item` rows with final `relativePath`.
- `scheduleItem`: when file processing is needed, pass path-based file processing input once Agent 04 exposes it.
- `scheduleFileProcessingCheck` and `scheduleIndexing`: remove `sourceFileEntryId` / `processedFileEntryId` from payloads once Agent 04/06 changes are ready.

`src/main/services/knowledge/utils/sources/directory.ts`

- Replace `FileManager.ensureExternalEntry` in `expandDirectoryNode`.
- Add `baseId` to the expansion API.
- Scan only importable files and copy them into the base through the path helper.
- Return leaf data with `relativePath`, not `fileEntryId`.
- Use one ignore policy for scan and copy: hidden files, temp files, `.cherry/**`, unsupported file types.

`src/main/services/knowledge/utils/sources/sitemap.ts`

- Keep sitemap URL expansion, but child URL items must not be returned until their Markdown snapshots exist.
- Add `baseId` to the expansion API, or move snapshotting into a source material service called by `prepare.ts`.
- Returned child data must include `relativePath`.

`src/main/services/knowledge/utils/sources/url.ts`

- Keep fetch/sanitize logic for import/refresh.
- Do not make readers call `fetchKnowledgeWebPage` for normal reindex.

`src/main/services/knowledge/utils/sources/prepare.ts`

- Pass `baseId` into directory/sitemap expansion.
- Track the copied/snapshotted relative paths in a rollback manifest.
- If child item creation or status update fails, clean copied files that did not get durable rows.

`src/main/services/knowledge/utils/sources/sourcePlanning.ts`

- Infer document-processing needs from `item.data.indexedRelativePath ?? item.data.relativePath`, not `item.data.source`.
- If `indexedRelativePath` exists, ordinary reindex should index it directly and not re-run document processing.

`src/main/services/knowledge/readers/KnowledgeReader.ts`

- Remove `fileEntryId` override.
- Pass `baseId` and validated relative path to the file/path helper.

`src/main/services/knowledge/readers/KnowledgeFileReader.ts`

- Replace `FileManager.getPhysicalPath(fileEntryId)` with `resolveMaterialPath(baseId, indexedRelativePath ?? relativePath)`.

`src/main/services/knowledge/readers/KnowledgeUrlReader.ts`

- Replace network fetch with reading the local Markdown snapshot path.

`src/main/services/knowledge/readers/KnowledgeNoteReader.ts`

- Replace `item.data.content` with reading the local Markdown snapshot path.

`src/main/services/knowledge/jobs/indexDocumentsJobHandler.ts`

- Remove `knowledgeItemService.rebuildFileRefsForItems`.
- Remove `processedFileEntryId` parsing and reader override.
- Use latest `relativePath` / `indexedRelativePath`.

`src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts`

- Stop validating `sourceFileEntryId`.
- Validate file-processing output path is inside the same base through the path helper.
- Write `indexedRelativePath`.

`src/main/services/knowledge/jobs/deleteSubtreeJobHandler.ts`

- Delete path-owned material files before deleting rows.
- Keep row deletion last so retries can still discover `relativePath`.

`src/main/services/knowledge/KnowledgeService.ts`

- `createBase`: create base directory and initialize/open `{baseId}/index.sqlite`.
- `deleteBase`: close index store before deleting the whole base directory.
- `restoreBase`: copy the old base directory's material files, not external `source` paths.
- Consider dropping `FileManager` from `@DependsOn` after all knowledge FileEntry use is gone.

`src/preload/index.ts` and renderer callers

- Add-items should send import commands: external file path, directory path, URL, sitemap URL, or note content.
- Renderer should not pre-create FileEntries for knowledge items.
- Full UI work belongs to Agent 08, but this contract must be agreed before Agent 03 implementation.

## 5. Blockers And Open Decisions

- Data contract blocker: `KnowledgeItemDataSchema` still requires `fileEntryId` or inline `content`. Agent 03 cannot finish safely until Agent 02 defines the new persisted and command-input DTOs.
- FileProcessing blocker: `FileProcessingOrchestrationService.startJob` only accepts `fileEntryId`, and MinerU currently requires `fileEntryId`. Agent 04 must provide path input, path output, and durable output metadata before PDF path mode can be complete.
- Index path blocker: current vector store uses `KnowledgeBase/{baseId}` as a file. This must change before user files are copied into `{baseId}/`.
- Workflow rollback decision: copy/snapshot before row creation is correct, but the workflow needs a cleanup strategy for copied files when DB writes or scheduling fail.
- Locking decision: directory copy and sitemap page fetch should not run under the base mutation lock if they can be long. The safe split is scan/copy/snapshot outside the DB write lock, then create rows under the lock, with manifest cleanup on failure.
- Import failure policy: for sitemap pages, decide whether one failed page fails the whole sitemap or creates failed child items for only failed pages.
- Source-inside-base policy: current v2 should probably reject importing a directory that is already inside `KnowledgeBase/{baseId}/` to avoid recursive self-copy and unmanaged duplicates. Confirm with product/Agent 07.
- Symlink policy: skip symlinks for current v2 unless explicitly supported. Following symlinked directories can escape source roots and create cycles.
- `.cherry` policy: decide whether to reject only exact `.cherry` or all case variants. I recommend case-insensitive rejection everywhere.
- Filename collision policy: docs say keep-both `_2`, `_3`. Confirm whether extension handling is `paper_2.pdf` or `paper.pdf_2`; I recommend `stem_2.ext`.

## 6. Phase Split Advice

### Phase 1: Path Helper And Index Path

Goal:

- Add the path/file helper.
- Move vector store path from `KnowledgeBase/{baseId}` file to `KnowledgeBase/{baseId}/index.sqlite`.
- Create base directories through the helper.

Verify:

- New base creates `KnowledgeBase/{baseId}/`.
- Index path is `KnowledgeBase/{baseId}/index.sqlite`.
- Bad `relativePath` values are rejected by helper tests.
- `application.getPath` is only used for the root key.

### Phase 2: Persisted Data And Direct Imports

Goal:

- Adopt `relativePath` in knowledge item data.
- Direct file add copies into base with keep-both.
- Direct URL/note add writes Markdown snapshots.
- Readers read from base paths.

Verify:

- Adding a file does not call `ensureExternalEntry`.
- URL/note reindex does not fetch network or read inline content.
- Keep-both produces final persisted `relativePath`.

### Phase 3: Directory And Sitemap Expansion

Goal:

- Directory expansion copies importable files into the base and emits leaf manifests.
- Sitemap expansion creates URL Markdown snapshots before child item creation.
- Rollback cleans copied/snapshotted files if row creation fails.

Verify:

- Hidden files, temp files, and `.cherry/**` are skipped.
- Child file/url rows have `relativePath`.
- No FileEntry rows or knowledge `file_ref` rows are created.

### Phase 4: File Processing Path Output

Goal:

- PDF/doc processing reads the base copy and writes Markdown output inside the same base.
- `indexedRelativePath` is written back.

Verify:

- UI still has one PDF item.
- Indexing reads Markdown.
- Deleting the item deletes both source and processed Markdown.

### Phase 5: Delete, Restore, Migration Hardening

Goal:

- Deletion and restore use path helper manifests and base directory ownership.
- v1 migration writes the new path shape.

Verify:

- Leaf delete removes files then rows.
- Base delete closes store then removes directory.
- Restore does not rely on external `source`.

## 7. Test Recommendations

Path helper tests:

- base dir, current index path, hidden index path
- sanitizing base id
- POSIX normalization
- reject empty, absolute, `..`, NUL, backslash traversal, `.cherry`, `.cherry/**`
- resolved path must stay inside base
- keep-both naming: `file.pdf`, `file_2.pdf`, `file_3.pdf`
- case-only and Windows/macOS reserved filename behavior where practical

Import tests:

- direct file copy stores final `relativePath`
- direct file copy does not create FileEntry or file_ref
- direct URL writes Markdown snapshot and reindex reads snapshot
- direct note writes Markdown snapshot and reindex reads snapshot
- directory copy preserves hierarchy and skips hidden/temp/`.cherry`
- directory copy emits only leaf file manifests
- sitemap expansion deduplicates URLs, snapshots pages, and emits child URL manifests
- import rollback deletes copied files when child creation fails

Reader tests:

- file/url/note readers all use `resolveMaterialPath`
- `indexedRelativePath` wins over `relativePath`
- missing file produces a clear failure path for Agent 06/07 handling
- network fetch is not called during normal URL reindex

Workflow/job tests:

- `indexDocuments` no longer calls `rebuildFileRefsForItems`
- check-processing validates output path is inside the base
- delete-subtree deletes files before rows and is idempotent after partial failure

Database tests:

- Use `setupTestDatabase()` for any `KnowledgeItemService` changes.
- Assert no knowledge `file_ref` rows are created for new knowledge file items.

## 8. Dependencies On Other Agents

- Agent 02: must define final `knowledge_item.data` schemas and command-input DTOs for external paths/content versus persisted `relativePath`.
- Agent 04: must provide path-based FileProcessing input/output and MinerU `context.dataId` behavior.
- Agent 05: must move from old vector store file path and `external_id` APIs to `KnowledgeIndexStore` semantics.
- Agent 06: must own job payload changes, idempotency, recovery, and lock timing around copy/snapshot manifests.
- Agent 07: must own base deletion, restore/duplicate, v1 migration, and cleanup after partial deletion.
- Agent 08: must remove renderer/preload FileEntry assumptions, especially `SaveToKnowledgePopup`, knowledge rows, chunk detail, and attachment flows.
- Agent 09: should turn the path helper and import-manifest behavior into an early POC acceptance gate.

## 9. Cross Review Notes

Agent 02's DTO split strengthens the path-helper boundary: import commands may carry external paths, URLs, and note content, but persisted `knowledge_item.data` must only carry validated `relativePath` / `indexedRelativePath`. The path helper should therefore return persisted manifests, not accept already-persisted item DTOs as import input. Shared zod schemas and the main-process resolver must use identical relative-path rules, especially for POSIX normalization, traversal rejection, and `.cherry/**` exclusion.

Agent 04's `FileHandle` plus path-output contract keeps atomic Markdown writes inside FileProcessing, but Knowledge must allocate and validate the output target before the job starts. Recommended split: Knowledge uses the path helper to choose an absolute Markdown output path inside `KnowledgeBase/{baseId}/`, passes it as `output: { kind: 'path' }`, and later verifies the completed path is still inside the same base before converting it back to `indexedRelativePath`.

This adds two path-helper responsibilities not explicit enough above: `assertPathInsideBase(baseId, absolutePath)` for completed output validation, and `toRelativePath(baseId, absolutePath)` for safe absolute-to-relative conversion after FileProcessing finishes. FileProcessing should validate only absolute-path shape and perform `atomicWriteFile`; it should not know keep-both naming, `.cherry` policy, or knowledge base layout.

Agent 10 should resolve the source-of-truth boundary for relative-path validation. If the shared schema owns the string validator, the main helper must reuse it or share conformance tests; if the main helper owns it, Agent 02's zod schema must mirror it exactly. Agent 10 should also lock the output-allocation decision: Knowledge should preallocate path outputs, otherwise FileProcessing would need knowledge-specific collision and base-containment policy.
