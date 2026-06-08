# Agent 06 Review: Workflow Jobs And Recovery

## 1. Conclusion

The workflow/job layer can survive the move from `FileEntry` / vector `external_id` facts to base-relative paths and material ids, but it must be changed as one coordinated slice. The most important rule is to preserve the current guard and recovery model while replacing the payload and storage facts underneath it:

- `deleting` remains a durable cleanup intent, not a terminal failure.
- `knowledge.delete-subtree` remains the only user operation that can preempt active work.
- user-triggered `reindexItems` remains restricted to terminal subtrees (`completed` / `failed`) and must not become a cancellation primitive.
- same-base destructive/index writes still run under `KnowledgeLockManager.withBaseMutationLock`, with SQLite writes still using `DbService.withWriteTx`.
- JobManager idempotency keys and `recovery: 'retry'` behavior must stay stable enough that crash retries are harmless.

The current code still encodes the old facts in three places: job payloads (`sourceFileEntryId`, `processedFileEntryId`), vector operations (`replaceByExternalId`, `listByExternalId`, `deleteByIdAndExternalId`), and source planning/reading through `FileEntry`. Those should be removed from the workflow layer, not shimmed locally.

## 2. Codebase Survey

Required searches were run for:

`processedFileEntryId`, `sourceFileEntryId`, `fileProcessingJobId`, `replaceByExternalId`, `deleteItemChunk`, `deleting`, `reindex-subtree`, `prepare-root`, `index-documents`, `check-file-processing`.

Key files inspected:

- `src/main/services/knowledge/KnowledgeWorkflowService.ts`
- `src/main/services/knowledge/jobs/jobTypes.ts`
- `src/main/services/knowledge/jobs/indexDocumentsJobHandler.ts`
- `src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts`
- `src/main/services/knowledge/jobs/prepareRootJobHandler.ts`
- `src/main/services/knowledge/jobs/deleteSubtreeJobHandler.ts`
- `src/main/services/knowledge/jobs/reindexSubtreeJobHandler.ts`
- `src/main/services/knowledge/jobs/utils/jobInput.ts`
- `src/main/services/knowledge/KnowledgeLockManager.ts`
- `src/main/services/knowledge/KnowledgeService.ts`
- `src/main/data/services/KnowledgeItemService.ts`
- `src/main/core/job/JobManager.ts`
- `src/main/core/job/runtime/recovery.ts`
- job tests under `src/main/services/knowledge/jobs/__tests__/`
- service tests under `src/main/services/knowledge/__tests__/`
- `docs/references/knowledge/operation-guards.md`
- `docs/references/knowledge/workflow-architecture.md`
- `docs/references/knowledge/current-v2-knowledge-index-migration-plan.md`
- `docs/references/knowledge/index-sqlite-schema-design.md`

Current workflow entrypoints:

- `KnowledgeService.addItems` rejects failed bases, creates rows through `KnowledgeWorkflowService.addItems`, sets roots to `preparing` / `processing`, then schedules either `knowledge.prepare-root`, `knowledge.index-documents`, or FileProcessing + `knowledge.check-file-processing-result`.
- `KnowledgeService.deleteItems` collapses nested selections, marks selected root subtrees `deleting`, then enqueues `knowledge.delete-subtree`. Enqueue failure intentionally leaves rows `deleting`.
- `KnowledgeService.reindexItems` collapses nested selections, rejects any non-terminal or `deleting` subtree, then enqueues `knowledge.reindex-subtree` without pre-marking active state.

Current job semantics:

- `knowledge.prepare-root` skips missing/deleting roots, clears stale non-deleting descendants, expands the root, then schedules child items. It marks unscheduled child rows `failed` on scheduling failure.
- `knowledge.index-documents` skips missing/deleting/completed items, rebuilds file refs, reads documents, chunks/embeds, calls `replaceByExternalId(itemId, nodes)`, then marks the item `completed`.
- `knowledge.check-file-processing-result` validates the linked FileProcessing job using `sourceFileEntryId`, polls until terminal, attaches a `processed_artifact` file ref, then schedules indexing with `processedFileEntryId`.
- `knowledge.delete-subtree` finds `deleting` subtree rows, cancels active knowledge jobs and linked FileProcessing jobs, deletes vectors by item id, then hard-deletes rows.
- `knowledge.reindex-subtree` double-checks `deleting`, deletes old vectors by leaf item id, deletes container descendants for selected containers, resets selected roots, then schedules roots.

Current recovery/idempotency:

- All knowledge handlers register with `recovery: 'retry'`.
- JobManager startup recovery resets running retry jobs to pending and keeps delayed jobs; `cancelRequested` overrides recovery.
- JobManager enqueue idempotency only returns existing non-terminal jobs with the same key.
- Knowledge delete recovery scans `KnowledgeItemService.getDeletingRootGroups()` on `KnowledgeService.onAllReady()` and best-effort enqueues bounded `knowledge.delete-subtree` chunks.
- Active cancellation uses `JobManager.cancel()`, not `cancelMany()`, where destructive cleanup must wait for running handlers or fail on cancel timeout.

## 3. Code Volume Estimate

Workflow/jobs/recovery-only migration is medium-large, roughly 550-900 changed lines plus tests, assuming the material index store and base file service already exist.

Expected distribution:

- 80-130 lines: job payload types, idempotency/narrowing tests, workflow scheduling signatures.
- 140-220 lines: FileProcessing check path and `index-documents` reader handoff.
- 120-200 lines: delete/reindex/prepare cleanup calls from vector `external_id` to material/file cleanup primitives.
- 80-140 lines: `KnowledgeService` chunk APIs/search/list calls that still use external id or single-chunk delete.
- 200-350 lines: focused test rewrites for payloads, cancellation, retry, deleting, and material-id calls.

This estimate excludes schema/index-store implementation, material table creation, base-directory import/copy services, renderer changes, and migration work owned by other agents.

## 4. Required Code Changes With Files/Functions

`src/main/services/knowledge/jobs/jobTypes.ts`

- Remove `processedFileEntryId?: string` from `knowledge.index-documents`.
- Remove `sourceFileEntryId: string` from `knowledge.check-file-processing-result`.
- Keep `fileProcessingJobId`, `pollRound`, `firstScheduledAt`, and `parentJobId`; these still define polling identity and recovery.

`src/main/services/knowledge/types.ts`

- Keep current idempotency shape unless another agent changes JobManager semantics. `knowledgeIndexIdempotencyKey(baseId, itemId, parentJobId)` is still useful because reindex follow-up indexing must be a new run scoped by the reindex job parent.
- Keep `knowledgeFileProcessingCheckIdempotencyKey(baseId, itemId, fileProcessingJobId, pollRound)`. Removing `sourceFileEntryId` does not require changing the key.

`src/main/services/knowledge/jobs/utils/jobInput.ts`

- Update `narrowIndexDocumentsJobPayload` to reject old `processedFileEntryId` or ignore it only if an explicit backward-compatibility decision is made. Because v2 is still in development, rejecting stale payload shape is cleaner.
- Update `narrowFileProcessingCheckJobPayload` to no longer require `sourceFileEntryId`.
- Preserve narrowing for `fileProcessingJobId`; delete-base and delete-subtree use it to cancel linked FileProcessing work.

`src/main/services/knowledge/KnowledgeWorkflowService.ts`

- In `scheduleItem`, replace FileProcessing start input from `{ fileEntryId: item.data.fileEntryId }` to the new file-processing file handle/path contract based on `item.data.relativePath`.
- If `item.data.indexedRelativePath` already exists, `planKnowledgeItemSource` should return direct indexing, not reprocess.
- Change `scheduleFileProcessingCheck` signature to remove `sourceFileEntryId`.
- Change `scheduleIndexing` signature to remove `processedFileEntryId`; `index-documents` must load the latest item data and choose `indexedRelativePath ?? relativePath`.
- Preserve the rollback rule when check enqueue fails: cancel the just-started FileProcessing job and throw the original enqueue error.

`src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts`

- Stop validating ownership by `sourceFileEntryId`.
- Validate the FileProcessing job by stable workflow facts: expected type, `document_to_markdown` feature, job context/data id matching `itemId`, and output target inside `KnowledgeBase/{baseId}` for the item.
- On completed processing, write `knowledge_item.data.indexedRelativePath` through a KnowledgeItemService method rather than `replaceFileRef(itemId, processedFileEntryId, 'processed_artifact')`.
- Schedule indexing without a processed file id.
- Keep missing/deleting skip behavior and linked FileProcessing cancellation. Delete still depends on this job payload exposing `fileProcessingJobId`.

`src/main/services/knowledge/jobs/indexDocumentsJobHandler.ts`

- Remove `FileEntryIdSchema` parsing and the `processedFileEntryId` override.
- `loadKnowledgeItemDocuments` should receive `baseId` or a resolved absolute material path so it reads `KnowledgeBase/{baseId}/{indexedRelativePath ?? relativePath}`.
- Keep the status progression `reading -> embedding -> completed`, but remove `knowledgeItemService.rebuildFileRefsForItems`.
- Replace `vectorStore.replaceByExternalId(itemId, nodes)` with `KnowledgeIndexStore.rebuildMaterial(item.id, input)`.
- Preserve the second `deleting` check under the base mutation lock before writing material/index rows.
- Ensure the completed fast path does not swallow reindex. Current reindex resets selected leaf roots to `processing`, which is sufficient if retained.

`src/main/services/knowledge/utils/cleanup/vectorCleanup.ts`

- Replace with material cleanup helpers. At minimum, split the old one-size `deleteKnowledgeItemVectors(base, itemIds)` into semantics that match the caller:
  - delete item: `deleteMaterial(materialId)` plus file cleanup.
  - prepare-root stale descendant cleanup: delete descendant materials/files before deleting rows, skipping descendants already `deleting`.
  - reindex reset: clear/rebuild derived index for selected leaf materials without deleting the material row or knowledge-base file.
- Preserve the old atomicity guarantee from `replaceByExternalId(itemId, [])`: retries must not leave mixed old/new search units visible.

`src/main/services/knowledge/jobs/deleteSubtreeJobHandler.ts`

- Keep cancellation before cleanup, including linked FileProcessing job cancellation via check jobs.
- Under the base mutation lock, re-read only rows still `deleting`, then clean each leaf material:
  - call `KnowledgeIndexStore.deleteMaterial(item.id)`;
  - delete `relativePath`;
  - delete `indexedRelativePath` if present;
  - then call `knowledgeItemService.deleteItemsByIds`.
- Deleting the global `knowledge_item` row must remain last, because crash retry needs `relativePath` / `indexedRelativePath` from item data.
- Keep no-op behavior for already-gone subtrees and stale jobs targeting visible rows.

`src/main/services/knowledge/jobs/reindexSubtreeJobHandler.ts`

- Keep both `deleting` checks: before reset and inside the mutation lock.
- For selected leaf roots, do not delete the material row or file; reset item status and let follow-up `index-documents` call `rebuildMaterial`.
- For selected container roots, remove stale descendant rows through the same material/file cleanup used by delete, but only for non-deleting descendants. Then reset the selected container root to `preparing`.
- Keep schedule-failure compensation: unscheduled reset roots must be marked `failed` so active UI state is not stranded.
- Keep `onSettled` follow-up detection. It should continue to treat `knowledge.check-file-processing-result` as a follow-up because reindex may still create a FileProcessing path when explicit reprocess exists, even though ordinary reindex should not reprocess an item with `indexedRelativePath`.

`src/main/services/knowledge/jobs/prepareRootJobHandler.ts`

- Replace stale expansion vector cleanup with material/file cleanup for non-deleting descendants.
- Ensure directory/sitemap expansion creates child leaf rows with `relativePath` and corresponding material rows. Do not call FileManager `ensureExternalEntry`.
- Keep the second root read before expansion; deleting roots must not create new children.
- Keep child scheduling compensation unchanged.

`src/main/services/knowledge/KnowledgeService.ts`

- `deleteItemChunk` should be removed from IPC/preload/UI or return a clear unsupported error. The current `vectorStore.deleteByIdAndExternalId(chunkId, itemId)` violates the new material-level derived-index model.
- `listItemChunks` may remain if mapped to `KnowledgeIndexStore.listMaterialUnits(materialId)` for leaf items and descendant leaf materials for containers.
- `search` should call the new index store and still filter missing/deleting/non-completed current v2 `knowledge_item` rows.
- `deleteBase` should delete/cancel jobs before deleting the base directory/index store, then delete global rows. If the index store moves to `KnowledgeBase/{baseId}/index.sqlite`, this becomes directory cleanup, not only vector artifact cleanup.

`src/main/data/services/KnowledgeItemService.ts`

- Add an update method for `indexedRelativePath` on file items, using `DbService.withWriteTx`.
- Remove or stop using Knowledge-specific `file_ref` methods for source/material identity: `replaceFileRef` and `rebuildFileRefsForItems` should no longer be part of this workflow path.
- Keep `getDeletingRootGroups`, `setSubtreeStatus`, `deleteItemsByIds`, and the protection that prevents `deleting -> non-deleting` status updates.
- If `deleteItemsByIds` still clears `file_ref` for other compatibility reasons, it should be harmless, but workflow correctness should not depend on file refs.

## 5. Blockers/Open Decisions

- FileProcessing input/output contract must be decided before changing `KnowledgeWorkflowService.scheduleItem`: the current handler starts jobs with `fileEntryId`; the new plan expects path/file-handle input plus `context.dataId === itemId` and a deterministic output target.
- The owning service for base-directory paths and file deletion must be available. Delete crash recovery depends on resolving and deleting `relativePath` / `indexedRelativePath` idempotently.
- `KnowledgeIndexStore` API must be implemented before job handlers can migrate off `replaceByExternalId`. The required primitives are `rebuildMaterial`, `deleteMaterial`, `listMaterialUnits`, and `search`.
- Decide whether stale persisted jobs from old dev builds should be rejected, ignored, or migrated. Because v2 is in development, the simplest path is to reject old payload shapes and rely on recreating dev data.
- Decide the public `deleteItemChunk` behavior. Current knowledge docs say remove it or make it unsupported; keeping single chunk deletion conflicts with material-level derived indexes.
- Missing file semantics need one explicit state path: mark `material.status = missing` and set `knowledge_item` failed or another retryable failed state. Search must not return old index rows after material is missing.

## 6. Phase Split Advice

Phase A: Lock API contracts.

- Land the `KnowledgeIndexStore` interface and base-relative file service.
- Update knowledge item data types to expose `relativePath` / `indexedRelativePath`.
- Decide FileProcessing path/context contract.

Phase B: Payload and scheduling migration.

- Remove `sourceFileEntryId` / `processedFileEntryId` from job payloads and workflow methods.
- Update `narrowKnowledgeJobInput` and cancellation tests.
- Preserve idempotency keys and parent job behavior.

Phase C: Indexing and FileProcessing continuation.

- Move readers to base-relative paths.
- Change check job completion to write `indexedRelativePath`.
- Change index job to call `rebuildMaterial`.

Phase D: Cleanup and recovery.

- Migrate delete/reindex/prepare cleanup from external id vectors to material/file cleanup.
- Keep delete row removal last.
- Keep delete recovery scanning `deleting` root groups.

Phase E: Chunk/search API cleanup.

- Switch chunk listing/search to material units.
- Remove or stub `deleteItemChunk`.

Avoid mixing Phase D before Phase C: delete/reindex recovery needs the new material/file cleanup primitives to be idempotent before the workflow starts relying on path facts.

## 7. Test Recommendations

Update existing job handler tests:

- `indexDocumentsJobHandler.test.ts`: no `processedFileEntryId`; reader uses `indexedRelativePath ?? relativePath`; calls `rebuildMaterial`; still skips write when item becomes `deleting` under lock; vector/index failure does not mark completed.
- `checkFileProcessingResultJobHandler.test.ts`: no `sourceFileEntryId`; validates `context.dataId`/output target; writes `indexedRelativePath`; schedules indexing without processed id; still cancels linked processing for missing/deleting items.
- `deleteSubtreeJobHandler.test.ts`: cancels active jobs and linked FileProcessing before material/file cleanup; `deleteMaterial` and file deletion happen before row delete; cancellation failure/timeout stops cleanup.
- `reindexSubtreeJobHandler.test.ts`: deleting races still skip; leaf reindex preserves material row/file and schedules rebuild; container reindex removes stale descendant materials/files; schedule-failure compensation remains.
- `prepareRootJobHandler.test.ts`: stale non-deleting descendants get material/file cleanup; deleting descendants are left for delete-subtree; second deleting check still prevents expansion.
- `jobInput.test.ts`: old payload fields rejected or ignored per the explicit compatibility decision.

Add or extend service-level tests:

- startup delete recovery still enqueues bounded delete jobs with stable idempotency keys.
- delete enqueue failure still leaves rows `deleting`.
- delete crash retry cases: before index delete, after index delete, after source file delete, after processed artifact delete, before row delete.
- ordinary reindex of an item with `indexedRelativePath` reads the processed Markdown and does not start FileProcessing.
- missing material file marks material/item unavailable and search no longer returns stale units.
- `deleteItemChunk` returns unsupported or is absent from the exposed API.

Keep existing lock tests for `KnowledgeLockManager`; add integration coverage where material store writes and `KnowledgeItemService` writes happen inside the base mutation lock and `DbService.withWriteTx`.

## 8. Dependencies On Other Agents

- Schema/index agent: must provide `index.sqlite` `material`, `content`, `search_unit`, `search_text`, `embedding`, and material-level store APIs with atomic `rebuildMaterial`.
- File/base-directory agent: must provide path validation, relative path resolution, copy/import, keep-both naming, and idempotent delete for `relativePath` / `indexedRelativePath`.
- FileProcessing agent: must replace `fileEntryId` coupling with file-handle/path input, deterministic output target, and `context.dataId` ownership validation.
- Type/API agent: must update shared knowledge item schemas and runtime add-item DTOs away from persisted `fileEntryId` / inline note content facts.
- UI/preload agent: must remove or disable single chunk deletion and stop creating FileEntry-backed knowledge item inputs.
- Migration agent: must decide how much old dev data/job payload compatibility is required; the workflow path should not silently preserve obsolete `FileEntry` material identity.

## 9. Cross Review Notes

- Agent 04's FileProcessing path-mode contract fits this workflow plan if `JobSnapshot.input` durably carries `{ file, output, context.dataId }`. The check job can then validate `context.dataId === itemId`, confirm `output.kind === 'path'` and base-directory containment, write `indexedRelativePath`, and schedule indexing without `sourceFileEntryId` or `processedFileEntryId`.
- Keep `fileProcessingJobId` in the knowledge check payload. It remains the runtime link for polling and linked cancellation; FileProcessing remote-poll recovery should resume from `metadata.remoteState` plus `input.output.path` / `input.context.dataId`, not from knowledge-side FileEntry facts.
- Agent 05's proposed APIs satisfy workflow delete/reindex needs only if `rebuildMaterial()` is an atomic replace and `deleteMaterial(materialId)` is idempotent. Leaf reindex should preserve source files and use `rebuildMaterial()`, while delete and stale descendant cleanup should call `deleteMaterial()` before deleting material files and global `knowledge_item` rows.
- Required Agent 10 clarification: define exact `deleteMaterial()` scope. For workflow purposes it should remove all per-base `index.sqlite` rows for that material id, tolerate already-missing rows, and never delete global `knowledge_item` rows or base-owned files.
- Agent 07 does not change subtree cleanup ordering; it reinforces it. Runtime delete remains: mark rows `deleting`, cancel active knowledge/FileProcessing work, close/wait where needed, delete material index rows, delete `relativePath` / `indexedRelativePath`, then delete global rows last so crash recovery can still read cleanup targets.
- Agent 07 does change base-level ordering: `deleteBase()` must cancel active work and close the per-base index store handle before deleting `KnowledgeBase/{baseId}/`, then remove global base/item rows. This should be separate from subtree delete recovery, which still scans durable `deleting` roots.
- Old job compatibility is the main unresolved cross-agent decision. Agents 04 and 06 prefer rejecting stale knowledge job payloads after migration; Agent 07/09 must decide whether current dev data/jobs are reset, migrated, or normalized. If normalization is kept, keep it at the FileProcessing start API boundary and do not silently accept obsolete knowledge job payload fields.
