# Agent 04 Review: File Processing and MinerU

> 状态(2026-06-08): 本评审写于实现之前。部分"当前状态"描述已被 baseline + 顺手改动改变(详见 ../../../drift-report-2026-06-08.md)。本篇仍作为待执行计划的依据阅读。
>
> baseline 现状校准(本篇相关):
> - 文件处理已收敛为单一 `{kind:'path'}` 输出;`managed_artifact` 已被**整个删除**(不是本篇设想的"保留作默认/附加模式")。本篇下文凡以 `managed_artifact` 为默认、双臂 `FileProcessingOutputTarget` union、保留 FileEntry artifact 的描述,均已被 baseline 取代为单臂 path 模型;`document_to_markdown` 入队前强制要求 path output。
> - `StartFileProcessingJobInput` 已落地为 `{ feature, file: FileHandle, output?, context?:{dataId?}, processorId? }`;MinerU 仅用 `context.dataId`(无 `fileEntryId` 回退)。job payload 已去掉 `sourceFileEntryId`/`processedFileEntryId`,归属用 `context.dataId === itemId` 校验。
> - 持久化恢复(remote-poll/重启/snapshot rehydrate)与原子写 markdown 已具备地基。

Date: 2026-06-07

## 1. Conclusion

Path-based file processing can be added without breaking non-knowledge callers, but only if it is introduced as an additive mode:

- Keep the existing FileEntry + managed artifact behavior as the default for omitted `output` or `output.kind === 'managed_artifact'`.
- Add `FileHandle` input, path output, and `context.dataId` to the persisted file-processing job payload instead of replacing the current concepts globally.
- Make knowledge use the new path mode while preserving the existing FileEntry artifact helpers for other callers and tests.

The current file-processing pipeline is already close to the right shape internally: processors receive resolved `FileInfo`, and provider handlers return logical outputs (`markdown`, `remote-zip-url`, `response-zip`) before persistence. The high-risk gap is persistence and recovery: today job payloads only contain `fileEntryId`, completed Markdown outputs only contain `artifact.fileEntryId`, and knowledge result polling validates FileEntry identity. Path output must therefore be durable in `JobSnapshot.input` / `JobSnapshot.output`, not transient state.

MinerU is the only inspected provider that currently requires a FileEntry-derived identity: it sends provider `data_id` from `fileEntryId` and throws if `fileEntryId` is absent. For knowledge path mode, MinerU should use `context.dataId` as `data_id`, while FileEntry callers continue to use their entry id.

## 2. Codebase Survey

Required searches were run for:

`FileProcessing`, `document_to_markdown`, `MinerU`, `open-mineru`, `StartFileProcessingJobInput`, `FileHandle`, `managed_artifact`, `data_id`, `processedFileEntryId`, `sourceFileEntryId`.

Relevant findings:

- `src/shared/file/types/handle.ts` already defines `FileHandle = { kind: 'entry'; entryId } | { kind: 'path'; path }` with IPC-safe schemas. This is the right input abstraction for file processing.
- `src/main/services/fileProcessing/types.ts` currently exposes `StartFileProcessingJobInput` as `{ feature, fileEntryId, processorId? }`.
- `src/main/services/fileProcessing/FileProcessingOrchestrationService.ts` validates IPC with `fileEntryId` only, resolves FileEntry metadata before enqueue, and persists job input as `{ feature, fileEntryId, processorId }`.
- `src/main/services/fileProcessing/tasks/shared.ts` registers both file-processing job types with the same `fileEntryId`-only payload.
- `src/main/services/fileProcessing/tasks/jobExecution.ts` resolves `FileInfo` only through `FileManager`, passes `{ fileEntryId }` into provider `prepare`, and returns prepared jobs that carry `fileEntryId`.
- `src/main/services/fileProcessing/tasks/backgroundJobHandler.ts` and `remotePollJobHandler.ts` both call `createFileProcessingJobOutput(ctx, output)` after provider completion. This is the best place to branch on output target while keeping providers mostly output-target agnostic.
- `src/main/services/fileProcessing/persistence/artifacts.ts` currently maps Markdown-like outputs to `{ kind: 'file', format: 'markdown', fileEntryId }` via `MarkdownResultStore`.
- `src/main/services/fileProcessing/persistence/MarkdownResultStore.ts` persists Markdown by creating an internal FileManager entry. It has no path target branch today.
- `src/main/services/fileProcessing/persistence/resultPersistence.ts` safely extracts Markdown bytes from remote zips and response zips. It can be reused for path output if the path writer accepts bytes.
- `src/main/utils/file/fs.ts` already provides `atomicWriteFile(target, data)`, which matches the migration plan's atomic Markdown write requirement.
- `src/main/services/fileProcessing/processors/mineru/*` sends provider `data_id` from `fileEntryId`. `prepareStartContext` rejects missing `fileEntryId`.
- `src/main/services/fileProcessing/processors/open-mineru/*` posts a file to `/file_parse` and returns a zip response. It does not use `data_id`.
- `src/main/services/knowledge/KnowledgeWorkflowService.ts` schedules file processing with `item.data.fileEntryId`, then schedules result polling with `sourceFileEntryId`.
- `src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts` validates `snapshot.input.fileEntryId === sourceFileEntryId`, extracts a Markdown artifact FileEntry id, calls `knowledgeItemService.replaceFileRef(..., 'processed_artifact')`, and schedules indexing with `processedFileEntryId`.
- `src/main/services/knowledge/jobs/jobTypes.ts` still defines `processedFileEntryId` and `sourceFileEntryId` in knowledge job payloads.
- `src/main/services/knowledge/jobs/utils/jobInput.ts` narrows active job inputs using those same FileEntry-shaped fields.
- `src/preload/index.ts` exposes `fileProcessing.startJob` as `fileEntryId`-only.
- `src/shared/data/types/fileProcessing.ts` only accepts text artifacts and Markdown FileEntry artifacts. There is no path artifact or output target type yet.
- `docs/references/knowledge/current-v2-knowledge-index-migration-plan.md` section 7 already describes the target: `FileHandle` input, `managed_artifact` or `path` output, `context.dataId`, durable job snapshots, MinerU `data_id = context.dataId`, and knowledge result polling without `sourceFileEntryId` / `processedFileEntryId`.

## 3. Code Volume Estimate

Estimated implementation size for the file-processing path-mode slice only:

- Shared/API type widening: 80-130 lines.
- Orchestration and IPC schema changes: 80-140 lines.
- FileInfo resolution for `FileHandle`: 60-110 lines.
- Output-target-aware persistence and path artifact helpers: 120-220 lines.
- MinerU `data_id` contract change: 30-70 lines.
- Knowledge scheduling/result-poll adaptation: 120-220 lines, excluding broader knowledge item schema/path-service work.
- Tests: 350-650 lines.

Total likely implementation: 840-1,540 lines touched across production and tests, depending on how much compatibility scaffolding is retained during migration.

Current inspected surface area directly relevant to this review is about 2,000 lines across file-processing source plus another 1,400 lines in immediate knowledge consumers and migration-plan docs.

## 4. Required Code Changes With Files/Functions

Add shared file-processing contract types:

- `src/shared/data/types/fileProcessing.ts`
  - Add `FileProcessingOutputTargetSchema`:
    - `{ kind: 'managed_artifact' }`
    - `{ kind: 'path'; path: AbsolutePathSchema }`
  - Add `FileProcessingPathArtifactSchema`, likely `{ kind: 'file'; format: 'markdown'; path: AbsolutePathSchema }`, or another explicit output shape that `checkFileProcessingResult` can parse.
  - Keep existing `{ kind: 'file'; format: 'markdown'; fileEntryId }` valid for managed artifacts.

Widen start-job input while keeping compatibility:

- `src/main/services/fileProcessing/types.ts`
  - Change `StartFileProcessingJobInput` from `fileEntryId` to `file: FileHandle`, plus optional `output` and `context`.
  - Consider a temporary compatibility union that accepts legacy `{ fileEntryId }` and normalizes to `{ file: { kind: 'entry', entryId: fileEntryId }, output: { kind: 'managed_artifact' } }`.
- `src/main/services/fileProcessing/FileProcessingOrchestrationService.ts`
  - Replace `StartJobPayloadSchema` with the new schema or a compatibility union.
  - Resolve file info from `FileHandle` before capability checks.
  - Persist `{ feature, file, output, processorId, context }` in job input.
  - Default `output` to `{ kind: 'managed_artifact' }` so existing callers keep current behavior.
  - Keep `defaultQueue` based on processor id.
- `src/preload/index.ts`
  - Update the exposed `fileProcessing.startJob` payload type.
  - Preserve compatibility only if renderer callers still pass `fileEntryId` during the migration window.

Resolve `FileHandle` to `FileInfo`:

- `src/main/services/fileProcessing/tasks/jobExecution.ts`
  - Replace `resolveFileProcessingFileInfo(fileEntryId)` with `resolveFileProcessingFileInfo(file: FileHandle)`.
  - For `entry`, keep current FileManager metadata/getById/toFileInfo path.
  - For `path`, stat the absolute path and derive name/ext/mime/type into a `FileInfo` using the same conventions as `toFileInfo`.
  - Pass prepare context with both legacy identity and business identity, for example `{ fileEntryId?: FileEntryId, dataId?: string }`.
- `src/main/services/fileProcessing/processors/types.ts`
  - Change `FileProcessingPrepareContext` to include `file?: FileHandle` or minimally `{ fileEntryId?: FileEntryId; dataId?: string }`.

Persist output target durably:

- `src/main/services/fileProcessing/tasks/shared.ts`
  - Change `FileProcessingJobPayload` to the new durable shape. This is the payload that survives restart and feeds remote-poll recovery.
- `src/main/services/fileProcessing/tasks/backgroundJobHandler.ts`
  - Pass output target into `createFileProcessingJobOutput`.
- `src/main/services/fileProcessing/tasks/remotePollJobHandler.ts`
  - Same output target branch on completion.
  - Recovery already reads `ctx.input` and `ctx.metadata`; no JobManager schema blocker was found because `JobSnapshot.input`, `output`, and `metadata` are unknown JSON.
- `src/main/services/fileProcessing/persistence/artifacts.ts`
  - Change `createFileProcessingJobOutput(ctx, output)` to inspect `ctx.input.output`.
  - For `managed_artifact`, keep current `MarkdownResultStore.persistResult()` behavior.
  - For `path`, write Markdown bytes to `output.path` and return a path artifact.
  - Add a helper equivalent to `getFileProcessingMarkdownArtifactFileEntryId` for path artifacts, for example `getFileProcessingMarkdownArtifactPath`.
- `src/main/services/fileProcessing/persistence/MarkdownResultStore.ts`
  - Either add `resolveMarkdownBytes` as a reusable public method or add `persistResultToPath({ result, path, signal })`.
  - Use `atomicWriteFile` from `@main/utils/file/fs` for path writes.
  - Do not route path output through `FileManager.createInternalEntry`.

Provider identity:

- `src/main/services/fileProcessing/processors/mineru/document-to-markdown/handler.ts`
  - Stop requiring `context.fileEntryId`.
  - Derive provider `data_id` from `context.dataId ?? context.fileEntryId`.
  - Keep throwing only if neither identity exists and MinerU still requires `data_id`.
- `src/main/services/fileProcessing/processors/mineru/types.ts`
  - Rename `fileEntryId` in `PreparedMineruStartContext` to provider-neutral `dataId`.
- `src/main/services/fileProcessing/processors/mineru/utils.ts`
  - Send `data_id: context.dataId`.
- `src/main/services/fileProcessing/processors/open-mineru/*`
  - No provider-contract change appears required for `data_id`.
  - It should get path output automatically through shared persistence.

Knowledge path-mode consumer changes:

- `src/main/services/knowledge/KnowledgeWorkflowService.ts`
  - For file items under the new schema, call file processing with `{ file: { kind: 'path', path: absoluteSourcePath }, output: { kind: 'path', path: absoluteMarkdownPath }, context: { dataId: item.id } }`.
  - Change `scheduleFileProcessingCheck` to stop accepting `sourceFileEntryId`.
  - Change `scheduleIndexing` to stop requiring `processedFileEntryId`; indexing should read `indexedRelativePath ?? relativePath`.
- `src/main/services/knowledge/jobs/jobTypes.ts`
  - Remove `sourceFileEntryId` from `knowledge.check-file-processing-result`.
  - Remove `processedFileEntryId` from `knowledge.index-documents`.
- `src/main/services/knowledge/jobs/checkFileProcessingResultJobHandler.ts`
  - Validate file-processing job ownership through `snapshot.input.context.dataId === itemId`.
  - Validate `snapshot.input.output.kind === 'path'` and the output path is inside the current knowledge base root.
  - Parse the completed path artifact or actual `output.path`.
  - Convert absolute output path to `indexedRelativePath`.
  - Call a new `knowledgeItemService.updateIndexedRelativePath(itemId, relativePath)` instead of `replaceFileRef`.
  - Schedule indexing without `processedFileEntryId`.
- `src/main/services/knowledge/jobs/utils/jobInput.ts`
  - Update narrowers for active-job cancellation/recovery.

## 5. Blockers/Open Decisions

- Exact output artifact shape is not finalized. The migration plan says completed actual `output.path` must be persisted, but code should decide whether that lives as `artifact.path`, `output.target.path`, or both.
- Path output security boundary needs an owner. File-processing should validate absolute path shape, but knowledge must validate the path is inside `KnowledgeBase/{baseId}/` before trusting it.
- MinerU `data_id` fallback needs a product/API decision. Recommended: `context.dataId ?? entryId`, preserving old behavior for FileEntry callers.
- Path input `FileInfo` construction should use a central helper rather than duplicate `toFileInfo` logic. If no helper exists, add one near file utilities, not inside provider code.
- Knowledge path mode depends on the broader knowledge schema/path-service migration: `relativePath`, `indexedRelativePath`, base directory resolution, and output target path selection.
- Existing remote-poll metadata intentionally excludes sensitive fields. Do not add `output.path` to provider `remoteState`; it belongs in job input/output.
- IPC backward compatibility window is a decision. Main process can normalize legacy `fileEntryId`, but shared/preload types may force renderer changes if no compatibility union is kept.

## 6. Phase Split Advice

Phase 1: Add file-processing compatibility contracts.

- Add `FileHandle` input, output targets, context, and path artifacts.
- Normalize legacy `fileEntryId` to the new internal shape.
- Keep all existing FileEntry managed-artifact tests passing.
- Verify with file-processing unit tests only.

Phase 2: Add path output persistence.

- Implement Markdown bytes to path with `atomicWriteFile`.
- Add path output tests for `markdown`, `remote-zip-url`, and `response-zip`.
- Verify that `managed_artifact` still creates internal FileEntry artifacts.

Phase 3: Fix MinerU provider identity.

- Replace provider `data_id` source with `context.dataId ?? fileEntryId`.
- Add tests for entry mode and path/context mode.
- Keep Open MinerU unchanged unless tests reveal a contract mismatch.

Phase 4: Switch knowledge to path mode.

- Change knowledge scheduling/result polling to use path input/output and `context.dataId`.
- Remove FileEntry payload fields from knowledge job types.
- Write back `indexedRelativePath` and index from current item data.

Phase 5: Recovery and restart coverage.

- Add tests that rehydrate `file-processing.remote-poll` from persisted metadata while retaining output target and `context.dataId` from job input.
- Add knowledge check tests that succeed after restart-shaped `JobSnapshot` reload.

## 7. Test Recommendations

File-processing contract tests:

- Shared schema accepts `{ file: { kind: 'entry' }, output: { kind: 'managed_artifact' } }`.
- Shared schema accepts `{ file: { kind: 'path' }, output: { kind: 'path' }, context: { dataId } }`.
- Legacy `fileEntryId` is either accepted and normalized or rejected deliberately after all callers are migrated.

Resolution tests:

- Entry handle resolves through FileManager and passes `fileEntryId` in prepare context.
- Path handle bypasses FileManager and passes only `dataId` when provided.
- Directory metadata is rejected for entry and path inputs.

Persistence tests:

- Managed Markdown output still calls `FileManager.createInternalEntry` and returns `artifact.fileEntryId`.
- Path Markdown output writes the target with `atomicWriteFile` and returns the target path artifact.
- Remote zip and response zip path outputs reuse safe zip extraction and do not leave partial target files on failure.
- Path output does not create FileEntry or file_ref rows.

Remote-poll recovery tests:

- First launch persists only provider `remoteState`; no API key, no signed URL.
- Restart-shaped job with `metadata.remoteState`, `input.output.path`, and `input.context.dataId` resumes polling and writes the same target path.
- Stage switch still patches metadata without losing output target because target remains in job input.

MinerU tests:

- Entry mode sends `data_id = fileEntryId`.
- Path/context mode sends `data_id = context.dataId`.
- Missing both identities produces a clear error only for MinerU if provider contract still requires it.
- Open MinerU path output works through shared persistence and does not require `data_id`.

Knowledge integration tests:

- File processing check validates `context.dataId === itemId`.
- Mismatched output path outside the base directory fails the item.
- Completed path output writes `indexedRelativePath` and schedules indexing without `processedFileEntryId`.
- Existing managed-artifact file-processing callers still receive FileEntry artifacts.

## 8. Dependencies on Other Agents

- Depends on the knowledge schema/path-service work for `relativePath`, `indexedRelativePath`, base-root resolution, keep-both names, and safe absolute-to-relative conversion.
- Depends on indexing-reader work so `indexDocuments` reads `indexedRelativePath ?? relativePath` instead of a FileEntry override.
- Depends on knowledge workflow agents removing `sourceFileEntryId` and `processedFileEntryId` from job payloads at the same time as result polling changes.
- Depends on data-service work adding an `updateIndexedRelativePath` style method and stopping knowledge material identity from relying on `file_ref`.
- Coordinates with UI/preload agents if they remove renderer `fileEntryId` start-job calls or decide to keep legacy IPC compatibility longer.

## 9. Cross Review Notes

- Agent 03's path-service boundary aligns with this report's output-target expectations. FileProcessing should validate generic absolute-path shape and write atomically, but knowledge-owned callers must allocate the target path and validate containment under `KnowledgeBase/{baseId}/`; FileProcessing should not duplicate `.cherry`, relative-path, keep-both, or base-root policy.
- Agent 03 clarifies that `application.getPath(..., filename)` is not a security boundary. For path output, Agent 10 should require the knowledge path helper to provide the absolute Markdown target and a safe absolute-to-relative conversion for `indexedRelativePath`.
- Agent 06 confirms that `JobSnapshot.input` must remain the durable source for `file`, `output`, and `context.dataId`. Do not put output target paths into provider `remoteState`; restart/recovery should resume from `metadata.remoteState` plus `input.output.path` and `input.context.dataId`.
- Agent 06 refines the knowledge payload migration: remove `sourceFileEntryId` and `processedFileEntryId`, but keep `fileProcessingJobId`, poll fields, parent job id, idempotency keys, and linked FileProcessing cancellation semantics.
- Completed FileProcessing output should expose enough information for the check job to verify `context.dataId === itemId`, confirm the output target belongs to the current base, write `indexedRelativePath`, and schedule indexing without a processed FileEntry id.
- Required clarification for Agent 10: decide whether old dev job payloads are rejected or normalized. Agents 04 and 06 both prefer clean v2 payloads once callers migrate, with only the main FileProcessing start API optionally normalizing legacy `fileEntryId` during the transition.
