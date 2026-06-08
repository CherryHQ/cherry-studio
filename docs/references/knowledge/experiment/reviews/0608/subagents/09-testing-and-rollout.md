# Agent 09 Review: Testing And Rollout

Date: 2026-06-07

## 1. Conclusion

Conclusion: feasible only with staged stop/go gates. Do not start a full implementation branch until two POCs prove the riskiest contracts:

1. `KnowledgeIndexStore` can initialize `KnowledgeBase/{baseId}/index.sqlite`, atomically `rebuildMaterial`, search with the current v2 chunk-shaped result, list units, delete material, and close handles before directory deletion.
2. file processing can run with `FileHandle.kind = path`, durable `output.kind = path`, `context.dataId`, restart-shaped remote polling, and MinerU `data_id = context.dataId` without breaking existing FileEntry/managed-artifact callers.

After those POCs, split implementation by vertical behavior and require tests in the same PR as each behavior. A final "test hardening" PR is too late for this migration because old assumptions are encoded across current tests: `fileEntryId`, `sourceFileEntryId`, `processedFileEntryId`, `replaceByExternalId`, `deleteItemChunk`, and `KnowledgeVectorMigrator` all appear in the existing suite.

Rollback should be code-level, not data-downgrade-based. Current v2 is still development data, so stale dev `knowledge_item` rows, old vectorstore files, and old pending jobs can be rejected or rebuilt after rollback. The stable compatibility target is v1 -> final current-v2 migration, so rollback must preserve the old v1 migration path until the new migration is proven.

## 2. Codebase Survey

Required broad searches were run before narrowing:

- `rg --count-matches 'knowledge'`
- `rg --count-matches 'Knowledge'`
- `rg --count-matches 'fileEntryId|FileProcessing|document_to_markdown|replaceByExternalId|processedFileEntryId|sourceFileEntryId|deleteItemChunk|SaveToKnowledge|KnowledgeMigrator|KnowledgeVectorMigrator'`

Additional focused searches covered:

- test files under `src/main/services/knowledge`, `src/main/services/fileProcessing`, `src/main/data/migration/v2`, `src/renderer/pages/knowledge`, `src/renderer/components/Popups`, `packages/vectorstores/libsql`, and `tests/e2e`
- old-assumption test assertions for `fileEntryId`, `processedFileEntryId`, `sourceFileEntryId`, `replaceByExternalId`, `deleteItemChunk`, `KnowledgeMigrator`, `KnowledgeVectorMigrator`, `SaveToKnowledge`, `ensureExternalEntry`, and `resolveKnowledgeFileMetadataEntryData`
- CI/build gates in `package.json`, `.github/workflows/ci.yml`, `playwright.config.ts`, `tests/e2e/README.md`, and v2 preview/nightly build workflows

Core docs read:

- `docs/references/knowledge/handoff-current-v2-knowledge-review-2026-06-06.md`
- `docs/references/knowledge/current-v2-knowledge-index-migration-plan.md`
- `docs/references/knowledge/index-sqlite-schema-design.md`
- `docs/references/knowledge/operation-guards.md`
- `docs/references/data/README.md`
- `docs/references/testing/database-testing.md`
- `tests/__mocks__/README.md`
- existing subagent reports: `01-original-session-audit.md`, `03-file-storage-and-paths.md`, `04-file-processing-and-mineru.md`, `06-workflow-jobs-and-recovery.md`

Key files/tests surveyed:

- knowledge workflow and service tests: `KnowledgeService.test.ts`, `KnowledgeService.integration.test.ts`, `indexDocumentsJobHandler.test.ts`, `checkFileProcessingResultJobHandler.test.ts`, `deleteSubtreeJobHandler.test.ts`, `prepareRootJobHandler.test.ts`, `reindexSubtreeJobHandler.test.ts`
- file-processing tests: `FileProcessingOrchestrationService.integration.test.ts`, `artifacts.test.ts`, `jobExecution.test.ts`, `remotePollJobHandler.test.ts`, MinerU/Mistral processor tests
- migration tests: `KnowledgeMigrator.test.ts`, `KnowledgeMigrator.fileRefIntegration.test.ts`, `KnowledgeVectorMigrator.test.ts`, `KnowledgeMappings.test.ts`, `KnowledgeVectorSourceReader.test.ts`
- renderer tests: `AddKnowledgeItemDialog.test.tsx`, `SaveToKnowledgePopup.test.tsx`, `KnowledgeItemChunkDetailPanel.test.tsx`, `DataSourcePanel.test.tsx`, `KnowledgePage.test.tsx`, knowledge hooks tests
- vectorstore tests: `LibSQLVectorStore.test.ts`, `KnowledgeVectorStoreService.test.ts`

Findings:

- The surveyed scope has about 130 relevant test files and about 22.5k lines in the most affected test files sampled with `wc -l`.
- Current tests are dense and useful, but many are asserting the old model: FileEntry material identity, old vectorstore `external_id`, and single-chunk delete.
- `setupTestDatabase()` is the required harness for SQLite service/handler tests. It should be used for global DB assertions, FK behavior, and DataApi handlers, but migrator orchestration tests can keep their deliberate mock context.
- Main CI runs lint/typecheck/format, migrations check/generate-diff, i18n, hardcoded strings, OpenAPI, skills check, and main/renderer/shared/package tests. Electron E2E exists but is not part of default PR CI.
- Existing E2E coverage is app launch/navigation/settings/basic chat; there is no knowledge workflow E2E yet.

Uncovered:

- I did not inspect every individual knowledge UI component implementation line by line; Agent 08 owns UI/preload/IPC details.
- I did not validate final per-base SQL DDL because Agent 05 and Agent 02 own schema/index-store specifics.
- I did not run tests because this task is review/planning only and no code behavior changed.

## 3. Code Volume Estimate For Testing/Rollout Work

Testing work is large. Estimate 30-45 test files touched or added across the full rollout:

- POC tests: 6-10 files, roughly 1,200-2,000 test LOC.
- Main-process knowledge workflow rewrite tests: 8-12 files, roughly 1,500-2,800 changed/new test LOC.
- File-processing path-mode tests: 6-9 files, roughly 900-1,600 changed/new test LOC.
- Migration tests: 5-8 files, roughly 1,000-2,000 changed/new test LOC.
- Renderer/preload tests: 6-10 files, roughly 900-1,700 changed/new test LOC.
- E2E smoke tests: 2-4 files/page objects, roughly 300-700 LOC.

Rollout/support work outside product implementation:

- one temporary POC branch or two throwaway POC PRs
- one knowledge E2E page object plus a smoke spec
- one release/breaking-change entry if user-visible import/delete/reindex behavior changes
- optional temporary developer-only migration cleanup notes for current-v2 dev data

This should be planned as a multi-PR program. A single PR would mix schema, path safety, job recovery, index search, UI contract, and migration risk in a way that makes review and rollback weak.

## 4. Required Code/Test/Doc Changes With Files/Modules

Test changes must track these modules:

- `src/shared/data/types/knowledge.ts` and `src/shared/__tests__/knowledge-schemas.test.ts`: schema acceptance/rejection for `relativePath`, `indexedRelativePath`, URL/note snapshots, and old `fileEntryId` removal.
- `src/main/data/services/KnowledgeItemService.ts` and `src/main/data/services/__tests__/KnowledgeItemService.test.ts`: no FileEntry lookup/ref creation for knowledge material identity; update indexed relative path; delete row last.
- `src/main/data/api/handlers/knowledges.ts` and `src/main/data/api/handlers/__tests__/knowledges.test.ts`: DataApi payload shape, runtime validation, list/search/chunk behavior, and OpenAPI update.
- new path helper/service from Agent 03: tests for path normalization, `.cherry` rejection, path escape rejection, keep-both naming, copy rollback, snapshot writes, source-inside-base policy, symlink policy, and idempotent delete.
- `src/main/services/fileProcessing/*`: tests for legacy entry mode, path mode, path output artifact, remote-poll restart, output target persistence, and MinerU `data_id` fallback.
- `src/main/services/knowledge/jobs/*`: rewrite tests away from `processedFileEntryId`, `sourceFileEntryId`, and `replaceByExternalId`; assert `rebuildMaterial`, `deleteMaterial`, material/file cleanup, and deleting/reindex race behavior.
- `src/main/services/knowledge/readers/*`: tests that file/url/note readers read `KnowledgeBase/{baseId}/{indexedRelativePath ?? relativePath}` and do not fetch network/read inline note content during ordinary reindex.
- `src/main/services/knowledge/vectorstore/*` or new `KnowledgeIndexStore`: tests for per-base `index.sqlite` path, handle close, base-id meta validation, FTS rowid mapping, embedding contract mismatch, and search compatibility.
- `packages/vectorstores/libsql/*`: either keep existing tests if a new store is separate, or split old generic vectorstore tests from knowledge-specific tests. Do not mutate old `replaceByExternalId` tests into unrelated expectations without a clear package boundary decision.
- `src/main/data/migration/v2/*`: tests must change from "migrate old vectors/file refs" to "copy/snapshot materials, create current-v2 global rows, initialize index.sqlite, then rebuild index." Existing `KnowledgeVectorMigrator` tests should likely be replaced or sharply reduced if the old vector rows are no longer migrated.
- `src/preload/index.ts`: contract tests or type tests for new knowledge/fileProcessing IPC payloads and `deleteItemChunk` removal/unsupported behavior.
- `src/renderer/pages/knowledge/*`: tests for add file/directory/url/sitemap command inputs, display from `relativePath/source`, no `/files/entries/:id` dependency for item row/chunk detail, and no single chunk delete UI.
- `src/renderer/components/Popups/SaveToKnowledgePopup.tsx`: tests that saved resolvable files are passed as import commands, not pre-created FileEntries.
- `tests/e2e/`: add at least one knowledge smoke spec once UI is wired.

Docs:

- add or update a breaking-change entry under `v2-refactor-temp/docs/breaking-changes/` if the UI loses single-chunk deletion or import semantics visibly change.
- update knowledge reference docs only after Agent 10 finalizes the review conclusions.

## 5. Blockers/Open Decisions

- `KnowledgeIndexStore` ownership is unresolved: new knowledge-specific store vs reshaping `packages/vectorstores/libsql`. This blocks test placement and rollout ownership.
- Path service contract is unresolved: symlink behavior, source file already inside the target base, collision strategy details, and cleanup manifest after copy/snapshot failure need explicit decisions.
- File-processing artifact shape is unresolved: completed path output needs a stable parsed shape, not just "whatever is in job input."
- Old dev job/data compatibility is unresolved. Recommendation: reject old current-v2 job payloads and require dev data rebuild; do not build compatibility shims unless a real user migration path needs them.
- `deleteItemChunk` public behavior must be decided before UI/API PRs: remove it from preload/API, or keep a stub returning an explicit unsupported error.
- Migration strategy for old vectors must be explicit. Recommendation: v1 -> current v2 rebuilds from copied/snapshotted materials by default; old vector reuse is only a later optimization behind exact model/dim/hash proof.
- CI does not currently run Electron E2E. The rollout needs a manual or added CI gate for knowledge E2E before preview/nightly promotion.
- Agent 02, 05, 07, and 08 reports are not present yet in this workspace; their conclusions may change the exact test split.

## 6. Phase Split Advice: POC/PR Order And Parallel Work

Phase 0: review closeout gate.

- Stop/go: Agent 02, 05, 07, 08, and 10 must confirm no hard contradiction with data model, index store, migration/delete/restore, and UI/IPC.
- Output: final architecture checklist with accepted contracts.

Phase 1 POC A: `KnowledgeIndexStore`.

- Build a narrow per-base index store with DDL, `rebuildMaterial`, `search`, `listMaterialUnits`, `deleteMaterial`, and `close`.
- Stop/go: tests prove atomic replace rollback, FTS rowid join, embedding dimension mismatch handling, old chunk-shaped result mapping, and handle close before base directory delete.

Phase 1 POC B: path-based file processing.

- Add path input/output as an additive mode; keep FileEntry managed artifact mode.
- Stop/go: tests prove path output survives restart-shaped remote poll, MinerU uses `context.dataId`, path output writes atomically, and old callers still pass.

Phase 2 PR 1: path/data model foundation.

- Land `relativePath` schemas, path helper, base directory/index path initialization, and source import/snapshot primitives.
- Parallelizable with POC B only after shared FileHandle/output contracts are agreed.

Phase 2 PR 2: index store integration.

- Wire `KnowledgeVectorStoreService` replacement or new service, `index-documents`, search, list chunks, and material delete.
- Can run in parallel with renderer preparation if API contracts are frozen.

Phase 2 PR 3: file-processing workflow integration.

- Switch knowledge scheduling and check-result jobs to path output and `indexedRelativePath`.
- Must land after POC B and path helper.

Phase 2 PR 4: delete/reindex/prepare recovery.

- Move cleanup from vector external id/file refs to material/file cleanup.
- Must land after index store and path helper.

Phase 2 PR 5: migration.

- Change v1 migration to create base directories, snapshots, global rows, and new index stores.
- Should not land before the runtime target schema/store is stable.

Phase 2 PR 6: UI/preload/API cleanup.

- Remove FileEntry assumptions from add dialogs, SaveToKnowledge, data source rows, chunk detail, and preload.
- Can start after schemas are agreed, but should merge after runtime endpoints exist.

Phase 3: rollout hardening.

- Add E2E smoke, manual preview checklist, release note/breaking-change entry, and stale current-v2 dev-data cleanup instructions if needed.

Stop/go before preview/nightly promotion:

- `pnpm ci` passes locally/CI.
- `pnpm build:check` passes, including docs link checks.
- `pnpm test:e2e` passes for knowledge smoke on at least one platform.
- manual restart/recovery smoke passes for active import, active delete, and remote-poll file processing.
- no remaining production references to knowledge material identity through `fileEntryId`, `sourceFileEntryId`, `processedFileEntryId`, `replaceByExternalId`, or `deleteItemChunk` except deliberate compatibility stubs.

## 7. Test Recommendations: Unit, Integration, Migration, UI/IPC, Recovery

Unit tests:

- Relative path schema rejects absolute paths, `..`, empty strings, NUL, `.cherry`, and OS separator ambiguity; stores POSIX-style paths.
- Chunker returns offsets where `content.text.slice(charStart, charEnd) === bodyText`.
- `unit_id` is stable for unchanged material/content/offset and changes when content or offsets change.
- source planning uses `indexedRelativePath ?? relativePath`, not `source`.
- `deleteItemChunk` is absent or unsupported.

Integration tests:

- Use `setupTestDatabase()` for `KnowledgeBaseService`, `KnowledgeItemService`, DataApi handlers, global DB FK behavior, and write transaction assertions.
- Add real file-backed temp-dir tests for base directory creation, copy, snapshot, keep-both names, file deletion, and index.sqlite lifecycle.
- Index store integration should use real SQLite/libSQL and assert `index_meta.base_id`, FTS search, vector/hybrid search, material status filtering, and close/delete behavior.
- Knowledge add/index/search/delete vertical slice: import a Markdown file, create `knowledge_item` with `relativePath`, rebuild material, search returns current v2 chunk shape, delete removes material/index/file before row.

Migration tests:

- v1 file item copies the actual file into `KnowledgeBase/{baseId}/`, writes `relativePath`, preserves legal item id, creates material, and rebuilds index.
- v1 URL/note creates Markdown snapshots and indexes from those snapshots.
- no knowledge `file_ref` rows are created for material identity.
- old vector rows are ignored/rebuilt unless exact reuse criteria are explicitly implemented.
- failed/missing embedding bases remain recoverable and do not produce inconsistent index stores.
- migration is idempotent enough to fail per-base without counting uncommitted groups as processed.

UI/IPC tests:

- `AddKnowledgeItemDialog` submits external file paths/directories/URLs/sitemap/note command inputs, not persisted `fileEntryId` data.
- `SaveToKnowledgePopup` does not call FileEntry resolution before submitting to knowledge runtime.
- data source rows and chunk detail display titles/source paths from `relativePath`, `indexedRelativePath`, or `source` without calling `/files/entries/:id`.
- chunk detail lists units but cannot delete a single chunk.
- preload exposes new file-processing start payload and knowledge runtime payloads; stale old payloads are rejected or normalized by explicit decision.

Recovery tests:

- file-processing remote poll rehydrates with `input.output.path` and `input.context.dataId` and writes the same Markdown path after restart.
- `check-file-processing-result` validates `context.dataId`, output kind, and path-inside-base before writing `indexedRelativePath`.
- deleting rows stay `deleting` after enqueue failure, startup recovery re-enqueues cleanup, and crash retries are safe after each cleanup step.
- delete base cancels knowledge and linked file-processing jobs, closes the index store, then removes the base directory.
- ordinary reindex of a processed PDF reads existing Markdown and does not rerun file processing.
- missing material file marks item/material unavailable and search stops returning stale rows.

E2E/manual smoke:

- Create a knowledge base, add a small Markdown file, wait for completion, search/recall it, view chunks/units, delete it, and verify it disappears.
- Add a PDF with a mocked or lightweight document-to-markdown processor path if feasible.
- Restart during active import and during delete cleanup; verify recovery state.
- Exercise SaveToKnowledge from a message/file source once UI contracts are final.

## 8. Dependencies On Other Agent Conclusions

- Agent 02 must confirm final `knowledge_item.data`, DTO, DataApi, and global schema boundaries before renderer and service tests can be finalized.
- Agent 03 path decisions define path-helper test cases, cleanup manifest expectations, and filesystem rollback gates.
- Agent 04 file-processing conclusions define path output artifact shape, MinerU identity tests, and remote-poll recovery tests.
- Agent 05 index-store/search conclusions define whether tests live in `packages/vectorstores/libsql` or a knowledge-specific store, and which search compatibility assertions are required.
- Agent 06 workflow conclusions define job payload compatibility, deleting/reindex race tests, and recovery invariants.
- Agent 07 migration/delete/restore conclusions define v1 migration acceptance, restore/duplicate tests, and rollback policy for old current-v2 dev data.
- Agent 08 UI/preload/IPC conclusions define exact UI tests, E2E selectors, and whether `deleteItemChunk` is removed or stubbed.
- Agent 10 should turn the above into the final rollout checklist and decide which gates are required before preview/nightly builds.

## 9. Cross Review Notes

- Agent 05 confirms the POC/store gate should require a knowledge-specific `KnowledgeIndexStore`, not a rewrite of `packages/vectorstores/libsql`. Agent 09's POC A mostly covers this, but Agent 10 should make these proof points explicit: atomic `rebuildMaterial()` across material/content/search/FTS/embedding rows, repeated-text chunk offset correctness, vector/BM25/hybrid result compatibility with current `KnowledgeSearchResult`, read-only `listMaterialUnits()` compatibility, and `deleteItemChunk` absent or explicitly unsupported.
- Agent 05 also tightens preview/nightly stop/go: no production `replaceByExternalId`, `listByExternalId`, `deleteByIdAndExternalId`, or old per-base single-file vector DB path should remain in the knowledge runtime except deliberately quarantined legacy package tests.
- Agent 06's recovery requirements are reflected in the proposed gates, but should be promoted from "test recommendations" to required PR gates for workflow PRs: durable `deleting` intent, delete as the only preemptive user operation, reindex restricted to terminal subtrees, stable idempotency keys, stale job payload rejection/explicit compatibility, and crash retries after each cleanup step.
- Agent 07 adds rollout risk that should be a pre-preview migration gate, not late hardening: v1 migration must create final base directories/snapshots/index stores, create no knowledge `file_ref`, avoid old `libsql_vectorstores_embedding`, preserve or consistently remap legal ids, and leave missing source/model cases restorable without stale search rows.
- Agent 07 also requires delete-base rollout coverage distinct from subtree delete: cancel active knowledge/FileProcessing work, close the per-base index handle, delete `KnowledgeBase/{baseId}/`, then remove global rows. Agent 10 should clarify recovery when the directory is gone but global base/item rows remain after a crash.
- Agent 08's UI risks need explicit UI/preload gates: add/save flows do not call `ensureExternalEntry`, rows and chunk detail do not query `/files/entries/:id`, attachment selection uses knowledge material identity instead of `fileEntryId`, preview/open uses a main-owned material handle, and chunk detail has no visible single-chunk delete affordance.
- Add one final grep gate before preview/nightly promotion over knowledge UI/preload/runtime surfaces for `fileEntryId`, `sourceFileEntryId`, `processedFileEntryId`, `replaceByExternalId`, `deleteItemChunk`, `ensureExternalEntry`, and `/files/entries/:id`; any remaining hit must be an intentional compatibility stub or unrelated non-knowledge domain.
- Required Agent 10 clarifications: final `deleteItemChunk` transition behavior, `deleteMaterial()` scope/idempotency, attachment/preview IPC shape for base-owned files, old current-v2 dev data/job compatibility policy, URL/sitemap migration policy, and how staged filesystem copy manifests coordinate with short DB/index locks.
