# Agent 08 Review: UI, Preload, and IPC

Date: 2026-06-07

## 1. Conclusion

Conditionally feasible. The current v2 UI can stay visually close to the old Data Source UI: the existing table, add-source dialog, save-to-knowledge popup, attachment quick panel, and chunk detail/list layout are all structurally reusable. The required change is semantic, not primarily visual.

The current implementation is still FileEntry-centered at the renderer/preload boundary:

- `KnowledgeRuntimeAddItemInput` is currently an alias of `CreateKnowledgeItemDto`, so renderer callers build persistent `knowledge_item.data`.
- File add flows call `window.api.file.ensureExternalEntry` before `knowledgeRuntime.addItems`.
- File rows and chunk detail headers query DataApi `/files/entries/:id`.
- The attachment button assumes completed file knowledge items expose `item.data.fileEntryId` and resolves them through `window.api.file.getPhysicalPath`.
- Chunk detail exposes single-chunk deletion through `window.api.knowledgeRuntime.deleteItemChunk`.

Those assumptions conflict with the migration plan. The target UI should submit import commands such as external path, URL, sitemap URL, or note content, then display persisted results from `relativePath` / `indexedRelativePath` after main has copied or snapshotted material into `KnowledgeBase/{baseId}/`. Single-chunk deletion should be removed from the UI. `listItemChunks` can remain as a read-only "view indexed units" operation if Agent 05/06 keep the old result shape, but deletion cannot remain an actionable per-chunk control.

## 2. Codebase Survey

### Searches Run

Required searches were run before narrowing:

- `rg -n "SaveToKnowledge"`
- `rg -n "AttachmentButton"`
- `rg -n "list-item-chunks|delete-item-chunk|listItemChunks|deleteItemChunk"`
- `rg -n "/files/entries|ensureExternalEntry|fileEntryId|KnowledgeRuntimeAddItemInput"`

I also ran a broader scoped survey across `src/preload`, `src/renderer/pages/knowledge`, `SaveToKnowledgePopup`, `AttachmentButton`, renderer hooks/utils, and the knowledge docs for:

- `knowledge`
- `Knowledge`
- `knowledge_item`
- `knowledge_base`
- `fileEntryId`
- `file_ref`
- `replaceByExternalId`
- `processedFileEntryId`
- `sourceFileEntryId`
- `FileProcessing`
- `document_to_markdown`
- `MinerU`
- `deleteItemChunk`
- `SaveToKnowledge`
- `KnowledgeBase/{baseId}`
- `relativePath`
- `indexedRelativePath`

### Files Read

Required docs and handoff:

- `docs/references/knowledge/current-v2-knowledge-index-migration-plan.md`
- `docs/references/knowledge/handoff-current-v2-knowledge-review-2026-06-06.md`
- `docs/README.md`
- `README.md`

Preload and IPC contract surface:

- `src/preload/index.ts`
- `src/shared/IpcChannel.ts`
- `src/main/services/knowledge/types/ipc.ts`
- `src/main/services/knowledge/KnowledgeService.ts`
- `src/shared/data/types/knowledge.ts`

Knowledge UI:

- `src/renderer/pages/knowledge/KnowledgePage.tsx`
- `src/renderer/pages/knowledge/sections/KnowledgePageDetailSection.tsx`
- `src/renderer/pages/knowledge/components/AddKnowledgeItemDialog.tsx`
- `src/renderer/pages/knowledge/components/addKnowledgeItemDialog/*`
- `src/renderer/pages/knowledge/panels/dataSource/DataSourcePanel.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemList.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemRow.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemChunkDetailPanel.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/utils/models.ts`
- `src/renderer/pages/knowledge/panels/dataSource/utils/selectors.ts`
- `src/renderer/pages/knowledge/hooks/usePreviewKnowledgeSource.ts`

Save and attachment entry points:

- `src/renderer/components/Popups/SaveToKnowledgePopup.tsx`
- `src/renderer/utils/knowledgeFileEntry.ts`
- `src/renderer/hooks/useKnowledgeItems.ts`
- `src/renderer/pages/home/Inputbar/tools/components/AttachmentButton.tsx`

Related tests:

- `src/renderer/components/Popups/__tests__/SaveToKnowledgePopup.test.tsx`
- `src/renderer/pages/knowledge/components/__tests__/AddKnowledgeItemDialog.test.tsx`
- `src/renderer/pages/home/Inputbar/tools/components/__tests__/AttachmentButton.test.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/__tests__/KnowledgeItemRow.test.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/__tests__/KnowledgeItemChunkDetailPanel.test.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/__tests__/DataSourcePanel.test.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/__tests__/KnowledgeItemList.test.tsx`
- `src/renderer/pages/knowledge/panels/dataSource/__tests__/dataSourcePanel.selectors.test.ts`
- `src/renderer/pages/knowledge/hooks/__tests__/useKnowledgeItems.test.ts`
- `src/renderer/pages/knowledge/hooks/__tests__/usePreviewKnowledgeSource.test.ts`
- `src/shared/__tests__/knowledge-schemas.test.ts`

### Current Cross-Module Call Chains

Add dialog file import:

`AddKnowledgeItemDialog.handleSubmit` -> `resolveSelectedFileEntryData` -> `resolveKnowledgeFileEntryData` -> `window.api.file.ensureExternalEntry` -> `useAddKnowledgeItems.submit` -> `window.api.knowledgeRuntime.addItems`.

Save popup file import:

`SaveToKnowledgePopup.onOk` -> `processMessageContent` / `processTopicContent` -> `resolveKnowledgeFileMetadataEntryData` -> `window.api.file.ensureExternalEntry` -> `useAddKnowledgeItems.submit`.

Save popup note import:

`SaveToKnowledgePopup.onOk` -> `window.api.file.readExternal(note.externalPath)` -> submits `type: 'note', data: { source, content }`.

Data Source row display:

`KnowledgeItemRow` -> `useQuery('/files/entries/:id', { id: item.data.fileEntryId })` -> `toKnowledgeItemRowViewModel(item, language, fileEntry)`.

Chunk detail:

`KnowledgePageDetailSection` -> `KnowledgeItemChunkDetailPanel` -> `useQuery('/knowledge-items/:id')` plus `/files/entries/:id` for file rows -> `window.api.knowledgeRuntime.listItemChunks` -> per-card delete button -> `window.api.knowledgeRuntime.deleteItemChunk`.

Attachment from knowledge base:

`AttachmentButton` -> `useKnowledgeBases` -> `useKnowledgeItems(selectedKnowledgeBaseId)` -> filter completed file items -> `item.data.fileEntryId` -> `window.api.file.getPhysicalPath({ id })` -> `window.api.file.get(filePath)` -> append `FileMetadata` with id set to the FileEntry id.

### Uncovered Areas And Why

- Main data schema and persistent `knowledge_item.data` migration are owned by Agent 02. I only inspected enough shared schema to confirm renderer coupling.
- Knowledge file/path service and snapshot/copy policy are owned by Agent 03. I only identified the renderer need for a main-owned preview/attachment path contract.
- FileProcessing path mode and `fileProcessing.startJob` compatibility are owned by Agent 04. I only inspected preload exposure because it shares `src/preload/index.ts`.
- Index-store shape and whether `listItemChunks` is kept as old DTO or renamed to material units are owned by Agent 05.
- Workflow/job payload removal of `sourceFileEntryId` and `processedFileEntryId` is owned by Agent 06.
- Delete/restore/v1 migration behavior is owned by Agent 07.

### Risks Assigned To Other Agents

- Agent 02: split import command DTOs from persisted `KnowledgeItemDataSchema`. Renderer cannot stop fabricating persistent data until this exists.
- Agent 03: provide a main-owned way to resolve or open `KnowledgeBase/{baseId}/{relativePath}` safely. Renderer should not construct absolute base paths.
- Agent 04: update `fileProcessing.startJob` preload contract to `FileHandle` + output target + context; keep non-knowledge callers compatible.
- Agent 05/06: decide whether `listItemChunks` remains a read-only compatibility API or is replaced by a material-unit API.
- Agent 06/07: if `deleteItemChunk` remains as an IPC channel, it must return a clear unsupported error and not mutate derived chunk rows.

## 3. Code Volume Estimate

For this UI/preload slice: medium.

Expected production changes:

- Shared/preload typing touchpoints: 2 to 4 files, about 80 to 180 LOC.
- Renderer add/save command mapping: 4 to 6 files, about 180 to 350 LOC.
- Data Source row/detail display from `relativePath`: 3 to 5 files, about 140 to 280 LOC.
- AttachmentButton knowledge-file selection contract: 1 to 2 files, about 100 to 220 LOC.
- Chunk delete removal/unsupported handling: 2 to 4 files, about 60 to 140 LOC.

Expected test changes:

- Add dialog and SaveToKnowledgePopup tests: 180 to 350 LOC changed.
- Data Source row/selectors/chunk detail tests: 220 to 450 LOC changed.
- AttachmentButton tests: 120 to 240 LOC changed.
- Preload/IPC schema tests, if added near main shared schemas: 80 to 180 LOC.

Total estimate: 10 to 16 source/test files touched, roughly 560 to 1,170 production LOC changed and 600 to 1,200 test LOC changed. The count depends on whether preview/attachment use an existing file IPC shape or a new knowledge-runtime helper.

This is not a design-system rewrite. It should not require changing the table composition, empty states, add-source tabs, popup layout, or quick-panel menu pattern.

## 4. Required Code Changes With Files/Functions

### `src/shared/data/types/knowledge.ts`

Split persisted item data from import command input.

Current state:

- `KnowledgeRuntimeAddItemInputSchema = CreateKnowledgeItemSchema`.
- File input requires `data.fileEntryId`.
- Note input requires persistent `data.content`.

Required direction:

- Persisted `KnowledgeItemDataSchema` should use target `relativePath` / `indexedRelativePath` shapes as decided by Agent 02.
- Runtime add input should be a separate command schema that accepts external paths, URLs, sitemap URLs, and note content as transient import inputs.
- Renderer-facing `KnowledgeRuntimeAddItemInput` should not require or expose `fileEntryId`.

Suggested command shape for UI callers:

- file: `{ type: 'file', data: { source: string, path: string } }`
- directory: `{ type: 'directory', data: { source: string, path: string } }`
- url: `{ type: 'url', data: { source: string, url: string } }`
- sitemap: `{ type: 'sitemap', data: { source: string, url: string } }`
- note: `{ type: 'note', data: { source: string, content: string, sourceUrl?: string } }`

The exact names should follow Agent 02's shared schema, but the important boundary is that these are command inputs, not the stored `knowledge_item.data`.

### `src/preload/index.ts`

Update `knowledgeRuntime.addItems` to use the new add-command type.

Current state:

- `addItems(baseId, items: KnowledgeRuntimeAddItemInput[])`
- `listItemChunks(baseId, itemId)`
- `deleteItemChunk(baseId, itemId, chunkId)`
- `fileProcessing.startJob` still accepts `fileEntryId`.

Required direction:

- Keep `knowledgeRuntime.addItems` as the renderer entry point, but type it to the new command input.
- Keep `listItemChunks` only if backend preserves a read-only old chunk DTO; otherwise rename/add a read-only material-unit API in the same migration phase.
- Remove `knowledgeRuntime.deleteItemChunk` from preload after all renderer calls are removed, or keep it temporarily as an unsupported compatibility stub with tests proving no UI calls it.
- Update `fileProcessing.startJob` preload type with Agent 04's `FileHandle` + output target + context contract. This is adjacent work in the same file, not a knowledge UI feature.

### `src/renderer/utils/knowledgeFileEntry.ts`

Delete or replace this helper for knowledge import.

Current state:

- `resolveKnowledgeFileEntryData(externalPath)` validates absolute path and calls `window.api.file.ensureExternalEntry`.
- Returns `{ source, fileEntryId }`.

Required direction:

- Replace with a path-command helper that returns `{ source, path }` or whatever Agent 02 names the file import command.
- Do not call FileEntry IPC from knowledge import UI.
- Keep absolute-path validation if it remains useful for immediate UI feedback, but main must still validate and copy the file.

### `src/renderer/pages/knowledge/components/AddKnowledgeItemDialog.tsx`

Change only submit mapping, not the visual dialog.

Current state:

- File dropzone stores `File[]`.
- `resolveSelectedFileEntryData` converts each browser `File` to a path and then to a FileEntry.
- Directory, URL, and sitemap already submit command-like source data.

Required direction:

- `resolveSelectedFileEntryData` should resolve only local path and display source.
- File branch should submit file import commands, not `fileEntryId`.
- Directory/URL/sitemap branches can likely stay visually and structurally close, but their result type must align with the new command schema.
- Note tab is currently disabled. No migration blocker unless note picker is added in the same phase.

### `src/renderer/components/Popups/SaveToKnowledgePopup.tsx`

Keep the modal UI, change how items are built.

Current state:

- Imports `resolveKnowledgeFileMetadataEntryData`.
- Note mode reads the note file with `window.api.file.readExternal` and submits inline `data.content`.
- Message/topic text also submits inline `data.content`.
- Message/topic files call `ensureExternalEntry` via the helper and submit `fileEntryId`.

Required direction:

- Remove the FileEntry helper call from the file branch.
- For files from message/topic processing, submit external readable paths as file import commands. If some message file lacks a readable path, continue the current partial-failure UX but log/report path resolution failure, not FileEntry creation failure.
- For note/text saves, inline content is acceptable as an import command input, but the main workflow must snapshot it and persist only `relativePath`.
- Update log messages and tests so they no longer talk about resolving "knowledge file entries".

### `src/renderer/hooks/useKnowledgeItems.ts`

Keep hook shape, update command type.

Current state:

- `useAddKnowledgeItems.submit(items: KnowledgeRuntimeAddItemInput[])` calls `window.api.knowledgeRuntime.addItems`.
- `useKnowledgeItems` polls `/knowledge-bases/:id/items`.

Required direction:

- Keep hook ergonomics.
- Change the `submit` item type to the new add command.
- Existing cache invalidation for `/knowledge-bases/${baseId}/items` and `/knowledge-bases` is still reasonable.
- Tests should use `relativePath`-based returned item fixtures once shared schema changes.

### `src/renderer/pages/knowledge/panels/dataSource/utils/models.ts`

Remove `FileEntry` from row view-model inputs.

Current state:

- `DataSourceDisplayContext` includes `fileEntry?: FileEntry`.
- File title/suffix prefer `fileEntry.name` / `fileEntry.ext`.
- Note title is derived from `item.data.content`.

Required direction:

- File title and suffix should derive from `item.data.relativePath` first, with `source` as display fallback if needed.
- Note title should derive from `source` or a stored display title. It cannot read persistent `item.data.content` after note snapshots move content to files.
- URL/sitemap can still display `source` / `url`.
- Directory can still display `source` or `path` as a user-facing origin, but child file rows should display copied `relativePath`.

### `src/renderer/pages/knowledge/panels/dataSource/utils/selectors.ts`

Remove `FileEntry` parameters.

Current state:

- `getItemTitle(item, fileEntry?)`
- `toKnowledgeItemRowViewModel(item, language, fileEntry?)`

Required direction:

- Make selectors pure over `KnowledgeItem` and locale.
- Add small path-name/ext helpers for `relativePath`.
- Update `matchesSearch` in `DataSourcePanel` to use the new `getItemTitle(item)` behavior.

### `src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemRow.tsx`

Remove DataApi `/files/entries/:id` use.

Current state:

- Calls `useQuery('/files/entries/:id', { id: item.data.fileEntryId })` for file rows.
- Passes `fileEntry` into selectors.

Required direction:

- Delete the file-entry query.
- Render the same row layout using `toKnowledgeItemRowViewModel(item, language)`.
- Keep existing actions: preview, view chunks, reindex, delete.

### `src/renderer/pages/knowledge/panels/dataSource/KnowledgeItemChunkDetailPanel.tsx`

Keep read-only list, remove single-chunk deletion.

Current state:

- Fetches `/knowledge-items/:id`.
- Fetches `/files/entries/:id` for file item header.
- Calls `window.api.knowledgeRuntime.listItemChunks`.
- Shows a delete icon per chunk and confirmation dialog.
- Calls `window.api.knowledgeRuntime.deleteItemChunk(baseId, chunk.itemId, chunk.id)`.

Required direction:

- Delete the file-entry query and use the same `relativePath`-based view model as rows.
- Keep `listItemChunks` if backend keeps that read API.
- Remove `KnowledgeItemChunkActionButton`, per-card delete icon, delete state, confirm dialog, and `deleteItemChunk` call.
- If backend temporarily leaves `deleteItemChunk` unsupported, this component should not surface it.
- Existing visual shape can remain a header plus scrollable chunk cards.

### `src/renderer/pages/knowledge/hooks/usePreviewKnowledgeSource.ts`

Do not open raw `source` for base-owned files.

Current state:

- URL/sitemap open external `source`.
- Note only opens `source` if it is HTTP.
- File/directory call `window.api.file.openPath(source)`.

Required direction:

- For file and snapshotted note/url material preview, renderer needs a main-owned way to open the copied base material path from `{ baseId, itemId }` or `{ baseId, relativePath }`.
- Do not construct absolute `KnowledgeBase/{baseId}` paths in renderer.
- For URL/sitemap, opening the original URL can remain as "open original source"; consider a separate "preview captured snapshot" only if product wants it.
- For directory containers, preview can open original source only if still available, but any "show imported material" action must be knowledge-owned.

This likely needs either:

- a knowledge IPC such as `knowledgeRuntime.openItemSource(baseId, itemId)`, or
- a safe file IPC that accepts a knowledge material handle rather than arbitrary renderer-composed paths.

### `src/renderer/pages/home/Inputbar/tools/components/AttachmentButton.tsx`

Do not use FileEntry identity for knowledge file attachments.

Current state:

- Filters completed `KnowledgeItemOf<'file'>`.
- Uses `item.data.fileEntryId` as selection identity.
- Resolves path through `window.api.file.getPhysicalPath({ id: fileEntryId })`.
- Reads metadata through `window.api.file.get(filePath)`.
- Appends `FileMetadata` with id overwritten to the FileEntry id.

Required direction:

- Use a knowledge material handle or a main-resolved base material path.
- Selection identity should be stable knowledge identity, likely `${baseId}:${item.id}` or an explicit material handle, not `fileEntryId`.
- If the chat input still requires `FileMetadata[]`, add a narrow adapter that builds a `FileMetadata`-compatible object from the resolved knowledge material path without creating a FileEntry. This is a compatibility adapter, not new knowledge identity.
- Prefer a main/preload helper that returns attachment-ready file metadata for a knowledge item, because renderer should not resolve base paths itself.
- Keep the quick-panel visual menu: base list -> completed file items -> multi-select.

### `src/main/services/knowledge/KnowledgeService.ts` and `src/main/services/knowledge/types/ipc.ts`

Backend implementation is outside Agent 08 scope, but UI depends on these contract changes:

- `KnowledgeRuntimeAddItemsPayloadSchema` must parse new import commands.
- `KnowledgeRuntimeDeleteItemChunkPayloadSchema` should be removed or converted to an explicit unsupported path.
- `KnowledgeService.deleteItemChunk` currently mutates old vector chunks through `vectorStore.deleteByIdAndExternalId`; target semantics must not do that.
- `KnowledgeService.listItemChunks` currently reads old vector docs through `vectorStore.listByExternalId`; if kept, Agent 05 should remap it to material search units.

## 5. Blockers/Open Decisions

- Add-items DTO split is a blocker. Renderer cannot stop sending `fileEntryId` or inline persistent note content while `KnowledgeRuntimeAddItemInputSchema` is still `CreateKnowledgeItemSchema`.
- Main-owned material opening/attachment contract is unresolved. The UI needs a safe way to open or attach `KnowledgeBase/{baseId}/{relativePath}` without constructing app data paths in renderer.
- Attachment compatibility with chat input is unresolved. `AttachmentButton` currently outputs `FileMetadata[]`; either chat input must accept knowledge material handles, or this button needs a temporary adapter from knowledge material to `FileMetadata`.
- `listItemChunks` naming is acceptable as a compatibility read API, but its meaning changes from old vector chunks to material search units. Decide whether to keep old name for UI continuity or rename when Agent 05 replaces the store.
- `deleteItemChunk` decision must be explicit: remove from preload and UI, or keep a stub only for compatibility tests. It must not remain a working mutation.
- Note title display needs a source/title field after `data.content` is removed. If `source` is the note title, the UI can use it directly.
- Preview semantics need product wording: "Preview source" may mean original URL/path for URL/directory, but copied base material for files and notes. Mixing both is acceptable only if the labels are clear.

## 6. Phase Split Advice

Phase 1: Contract preparation.

- Split `KnowledgeRuntimeAddItemInput` from persisted item data.
- Add or decide the knowledge material preview/attachment helper.
- Make `deleteItemChunk` unsupported at backend/preload or mark it for removal.
- Verification: shared schema tests prove file add input no longer accepts/requires `fileEntryId` and persisted file item data uses `relativePath`.

Phase 2: Add/save entry points.

- Migrate `AddKnowledgeItemDialog`, `SaveToKnowledgePopup`, and `knowledgeFileEntry.ts`.
- Stop all knowledge add flows from calling `ensureExternalEntry`.
- Verification: tests assert file import commands carry paths and `ensureExternalEntry` is not mocked/called.

Phase 3: Data Source display.

- Remove `/files/entries/:id` queries from `KnowledgeItemRow` and `KnowledgeItemChunkDetailPanel`.
- Update selectors to display from `relativePath` / `source`.
- Remove persistent note-content display assumptions.
- Verification: row/chunk tests assert no `/files/entries/:id` query and titles/suffixes come from relative paths.

Phase 4: Chunk UI mutation removal.

- Remove per-chunk delete controls and confirmation state.
- Keep read-only chunk list if `listItemChunks` remains.
- Verification: chunk detail tests assert delete buttons are absent and `window.api.knowledgeRuntime.deleteItemChunk` is not required.

Phase 5: Attachment button.

- Switch knowledge file quick-panel items to knowledge material handles or a main-resolved attachment metadata API.
- Verification: selecting a knowledge file no longer calls `file.getPhysicalPath({ id: fileEntryId })`.

Phase 6: Preload cleanup.

- Remove dead `deleteItemChunk` exposure after renderer is migrated, or keep a documented unsupported stub if other agents need a transition period.
- Verification: `rg -n "deleteItemChunk|/files/entries/:id|ensureExternalEntry|fileEntryId" src/renderer/pages/knowledge src/renderer/components/Popups/SaveToKnowledgePopup.tsx src/renderer/pages/home/Inputbar/tools/components/AttachmentButton.tsx` has no knowledge UI hits except unrelated chat/file domains.

## 7. Test Recommendations

Add/update tests before implementation where practical:

- `AddKnowledgeItemDialog.test.tsx`: file submission emits path import commands and does not call `ensureExternalEntry`.
- `SaveToKnowledgePopup.test.tsx`: file saves emit path import commands; partial failures are path-resolution failures; note/text content is command input only.
- `useKnowledgeItems.test.ts`: `submit` accepts new runtime add command fixtures.
- `KnowledgeItemRow.test.tsx`: file rows do not call `/files/entries/:id`; title/suffix derive from `relativePath`.
- `dataSourcePanel.selectors.test.ts`: selectors cover file `relativePath`, file `indexedRelativePath`, note `source`, URL `source`, directory `source`.
- `KnowledgeItemChunkDetailPanel.test.tsx`: header uses item data without FileEntry query; chunks render read-only; delete controls are absent.
- `usePreviewKnowledgeSource.test.ts`: file preview uses the new knowledge material open contract; URL/sitemap original source behavior remains deliberate.
- `AttachmentButton.test.tsx`: knowledge file selection uses knowledge item/material identity and does not call `getPhysicalPath({ id: fileEntryId })`.
- Preload or IPC schema tests: `knowledgeRuntime.addItems` validates command inputs; legacy FileEntry-only add payload is rejected or normalized only during an explicit compatibility phase.
- Regression search test or documented manual check: no `/files/entries/:id` or `ensureExternalEntry` calls remain in knowledge UI add/display flows.

Do not run review-scope `pnpm lint`, `pnpm test`, or `pnpm format` for this report-only task.

## 8. Dependencies On Other Agents

- Agent 02: required for final `KnowledgeItemDataSchema`, command DTOs, and note/file display fields. Agent 08 should not guess the final persisted shape independently.
- Agent 03: required for safe base material path resolution, preview/open behavior, and copied-file naming semantics.
- Agent 04: required for adjacent preload `fileProcessing.startJob` changes and path-output contract, especially if UI exposes processing status that depends on new job payloads.
- Agent 05: required for whether `listItemChunks` remains the read API and what `KnowledgeItemChunk` maps to after `KnowledgeIndexStore`.
- Agent 06: required for add/reindex workflow semantics and removal of FileEntry job payloads. UI polling should continue to rely on item status, not processing internals.
- Agent 07: required for delete/restore behavior. UI delete can remain item/subtree-level, but its confirmation text should match whether files and indexed artifacts are removed from the base directory.
- Agent 09: should include UI acceptance checks: old Data Source visuals still render, add/save flows do not create FileEntries, attachment selection works from base-owned files, and single-chunk deletion is absent.

## 9. Cross Review Notes

- Agent 02 aligns with the UI boundary assumed here: renderer inputs should be transient add commands, while persisted `knowledge_item.data` stores `relativePath` and optional `indexedRelativePath`. Agent 08 should not invent a parallel DTO; it should consume Agent 02's split command schema and use persisted item data only for display after backend import.
- The proposed command shape remains compatible with current UI entry points: file and directory flows can submit external paths, URL and sitemap flows can submit URLs, and SaveToKnowledge note/text saves can submit inline content as command input only. The UI must not persist or later read note `content`; it needs a display field such as `source`/title plus the backend snapshot path.
- Agent 06's workflow constraints do not require new polling behavior in the renderer. The UI should keep polling item/base status and avoid exposing FileProcessing internals such as `fileProcessingJobId`, `sourceFileEntryId`, or `processedFileEntryId`. Delete and reindex controls should continue to be item/subtree-level actions governed by backend guards.
- Agent 06 reinforces the chunk decision: `listItemChunks` can remain read-only if mapped to material units, but `deleteItemChunk` conflicts with material-level rebuild/cleanup semantics. UI removal should happen before or with preload removal; a temporary backend stub is acceptable only if no renderer control can trigger it.
- Delete UI copy/state should account for `deleting` as durable cleanup intent. Failed enqueue can leave rows `deleting`, and recovery owns cleanup, so the UI should not present per-chunk delete or treat item delete as an immediate reversible vector mutation.
- Agent 09's rollout gates cover the important UI/preload risks: add/save must stop creating FileEntries, rows and chunk detail must stop querying `/files/entries/:id`, attachment selection must use knowledge material identity, and single-chunk delete must be absent or explicitly unsupported. Add one final grep gate for `deleteItemChunk`, `ensureExternalEntry`, `/files/entries/:id`, and knowledge-owned `fileEntryId` usages in renderer/preload.
- Required Agent 10 clarification: choose the public transition behavior for `knowledgeRuntime.deleteItemChunk` before the UI/preload PR. Preferred outcome is full preload removal after renderer migration; fallback is a documented unsupported stub with tests and no visible UI affordance.
- Required Agent 10 clarification: define the attachment/preview IPC contract for base-owned material files. Renderer should pass `{ baseId, itemId }` or another knowledge material handle, not construct `KnowledgeBase/{baseId}` paths or convert the material back into FileEntry identity.
