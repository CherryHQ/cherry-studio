# File Module Phase 2: Consumer Migration Implementation Plan

> **定位**：Phase 2 消费方迁移的任务分解、依赖分析与粗粒度实施计划。
>
> 本文档**取代** [`rfc-file-manager.md §9.7`](./rfc-file-manager.md) 的 Batch 划分和 [`migration-plan.md §3.3`](./migration-plan.md) 的占位章节。
>
> 相关文档：
>
> - [`rfc-file-manager.md`](./rfc-file-manager.md) — 设计 RFC（数据 Schema、API 契约、核心流程）
> - [`migration-plan.md`](./migration-plan.md) — 字段级退役 + 消费域切换的详细调研
> - [`filemetadata-consumer-audit.md`](./filemetadata-consumer-audit.md) — 96 个 FileMetadata 消费者全量审计

**Goal:** Migrate all renderer-side FileMetadata consumers and v1 file APIs to v2 FileEntry / FileInfo / FileHandle architecture.

**Architecture:** Batch 0 (FileMigrator + cross-module coordination) is complete (PR #15067). Phase 1 (schema, FileManager, ops, services, watcher, dangling cache, orphan sweep) is fully implemented. This plan covers consumer-side migration: retiring the `FileMetadata` type, replacing `window.api.file.*` v1 calls with v2 File IPC / DataApi, and replacing `db.files.*` Dexie reads with v2 queries. The approach is domain-by-domain, from lowest risk to highest.

**Tech Stack:** TypeScript, Electron IPC, Drizzle ORM (SQLite), TanStack Query, Zod

**Current State Snapshot (2026-05-26):**

| Metric | Count |
|--------|-------|
| Files importing `FileMetadata` (renderer) | 29 |
| Files calling `window.api.file.*` (renderer) | 59 (142 call sites) |
| `db.files.*` Dexie direct access sites | 18 |
| v1 preload file API channels (estimated) | ~49 |

---

## 0. Existing Breakdown Reconciliation

RFC §9.7 and migration-plan §3.1 have **two different Batch structures** that need reconciliation.

| RFC §9.7 (by technical layer) | migration-plan §3.1 (by business domain) |
|-------------------------------|------------------------------------------|
| Batch A: Data layer adaptation (toFileMetadata shim) | Batch A: Translate / Agent workspace / Export (S) |
| Batch B: AI Core (fileProcessor / messageConverter) | Batch B: Paste / temporary files / OCR (M) |
| Batch C: Knowledge + Painting | Batch C: Painting (L) |
| Batch D: UI + state management | Batch D: Knowledge (L) |
| Batch E: Cleanup | Batch E: Messages (XL) |

**Decision:** Adopt the **domain-based ordering** from migration-plan §3.1 as the primary structure. Reasons:

1. Small→large complexity progression — validates the migration pattern on low-risk domains first
2. Each domain batch is independently testable and revertable
3. Technical-layer cuts (RFC's Batch A/B) force unnatural groupings — "AI Core" touches multiple domains, "Data layer adaptation" is really a prerequisite, not a batch

The RFC's "Batch A (shim)" and "Batch E (cleanup)" become **bookend phases** (prerequisites + cleanup) rather than domain batches.

### Migration Strategy: Atomic Domain Cutover (No Standalone Field Retirement)

migration-plan §2 originally proposed standalone field-level retirements (e.g., removing `purpose`/`tokens` before domain migration). **This plan rejects that approach** for the following reasons:

1. **Double-touch problem:** Standalone field retirement modifies consumer logic once (to remove the field), then domain migration modifies the same consumer again (to switch types). Two modifications to the same code path create intermediate states that are hard to test and prone to subtle behavioral drift.
2. **FileMetadata is being abolished, not trimmed:** The entire type is going away. Incrementally shaving fields off a doomed type is wasted engineering effort.
3. **Batch 0 postmortem:** The `toFileMetadata` shim dropped `purpose` and `tokens` fields prematurely, causing silent failures in `fileProcessor` and `OpenAIService`. This proves that field removal MUST be synchronized with consumer migration — you can't assume unused fields are truly unused until every consumer is rewritten.

**Adopted strategy:** Each domain batch performs an **atomic cutover** — consumers go directly from `FileMetadata` to `FileEntry`/`FileInfo`/`FileHandle` in one PR, with all field changes (renames, removals, semantic shifts) handled atomically. Unmigrated consumers continue using v1 paths (Dexie + FileMetadata) unchanged — no freeze, no shim, no intermediate states. CLEANUP removes Dexie `files` table, `FileMetadata`, and all v1 infrastructure after all batches complete.

### No Dexie Freeze, No toFileMetadata Shim

migration-plan §3.4.3 proposed freezing Dexie `files` writes and §4.1 proposed a `toFileMetadata` compatibility shim. **This plan rejects both:**

1. **Dexie freeze is unnecessary overhead.** Dexie is already on the deprecated track. Adding a `DexieFilesFrozenError` intermediate state creates engineering complexity (audit all write paths, error handling) for zero user-facing benefit. Unmigrated consumers continue using Dexie normally; migrated consumers use v2. Two parallel paths that don't interfere.

2. **toFileMetadata shim creates an illegitimate intermediate state.** No consumer should ever need a v2 `FileEntry` dressed up as a v1 `FileMetadata`. Before migration: consumer reads Dexie, gets native `FileMetadata`. After migration: consumer reads DataApi/File IPC, gets `FileEntry`/`FileInfo`. There is no middle ground. Batch 0's shim attempt proved this — it introduced silent failures precisely because the shim was an inherently leaky abstraction.

3. **Data consistency requires producer-consumer atomicity.** FileMigrator (Batch 0) copied all *existing* Dexie file entries to SQLite with preserved IDs, so old data is accessible from both systems. However, *new* files created after FileMigrator pose a gap: a v1-created file (Dexie-only) is invisible to v2 consumers (SQLite-only), and vice versa. This gap is closed by the following invariant.

### Main-Side Consumer Scope

An audit of `src/main/` identified several categories of v1 FileStorage / FileMetadata consumers beyond renderer IPC. Their Phase 2 disposition:

| Category | Disposition | Rationale |
|----------|------------|-----------|
| `legacyFile.ts` (main utils) | **Phase 2 (BATCH A)** | Core file utility consumed by migration batches; must be retired before CLEANUP |
| Export utilities (renderer) | **Phase 2 (BATCH A)** | No strict module boundary; file module owns the migration |
| remotefile/* services | **Phase 2 (BATCH A)** | Purpose field internalization; file module owns the migration |
| Translate module | **Independent module migration** | Business-module-level refactor; out of Phase 2 scope |
| Agent module | **Independent module migration** | Business-module-level refactor; out of Phase 2 scope |
| Knowledge module (`KnowledgeService`, `KnowledgeFileReader`, `embedjs/loader`, preprocessing providers) | **Independent module migration** | Business-module-level refactor; out of Phase 2 scope |
| Painting module (`TokenFluxService`, `paintings/utils`, PaintingMigrator) | **Independent module migration** | Business-module-level refactor; out of Phase 2 scope |
| Backup module (`BackupManager`) | **Independent module migration** | Business-module-level refactor; tracked in [#12659](https://github.com/CherryHQ/cherry-studio/issues/12659) |
| FileProcessing module (OCR services, preprocessing providers) | **Independent module migration** | Preprocessing providers are deprecated and migrating into fileProcessing module |
| `McpService` / `ExportService` (main) | **CLEANUP (mechanical)** | Not true file consumers — use `FileStorage.writeFile` / `createTempFile` as convenience I/O; trivially replace with `fs` / v2 when FileStorage is deleted |
| `ipc.ts` legacy handlers | **CLEANUP (CL-4)** | Deleted with v1 preload API removal |

### Invariant: Producer-Consumer Atomicity

**Rule:** Each batch must migrate the complete producer→consumer chain for its domain. If a batch migrates a consumer to read from v2, the producer that feeds data into that consumer must also move to v2 in the same batch.

**Consequence:** File creation entry points (paste, upload, drag-drop) are NOT migrated as standalone infrastructure. They migrate WITH the domain that invokes them:

| File creation entry point | Migrates with... | Rationale |
|---------------------------|------------------|-----------|
| Paste image in chat → `savePastedImage` | BATCH E (Messages) | The message immediately displays the pasted file; creation and consumption are one user operation |
| Upload file in knowledge → `uploadFile` | Knowledge module (independent) | Knowledge item references the uploaded file |
| Paste image in rich editor → `savePastedImage` | BATCH E (Messages) | Rich editor lives within message context |
| AI Core reads file → `fileProcessor.read` | BATCH E (Messages) | fileProcessor receives file refs from the message; it reads content by physical path, but the caller passes `FileMetadata`/`FileEntry` through the pipeline — the whole pipeline must be on the same type system |

**What this means for BATCH A:** BATCH A (Export + remotefile + legacyFile) does NOT switch file creation or `fileProcessor`'s input type. Its scope is limited to:
- Export utilities: no strict module boundary, file module owns migration
- `remotefile/*` service field adaptation: internal service change, no data-layer boundary crossing
- `legacyFile.ts` utility retirement: mechanical migration to v2 patterns

`fileProcessor` and `messageConverter` signature changes (`FileMetadata → FileEntry`) happen in **BATCH E**, because they are part of the message domain's pipeline. OCR and preprocessing providers migrate independently with the FileProcessing module.

**Why this doesn't need a shim or freeze:** Unmigrated domains stay entirely on v1 (Dexie reads + Dexie writes). Migrated domains move entirely to v2 (SQLite reads + v2 IPC writes). The two never cross. Physical files are at the same path (`{userData}/files/{id}.{ext}`) regardless of which metadata system tracks them.

---

## 1. Dependency Graph

```
                    ┌─────────────────────────────────────────┐
                    │  BATCH 0 (DONE): FileMigrator + coord   │
                    └──────────────────┬──────────────────────┘
                                       │
                                       ▼
                          ┌──────────────────┐
                          │ PREREQ-INFRA:    │
                          │ v2 IPC wiring,   │
                          │ shared utils,    │
                          │ DataApi, hooks   │
                          └────────┬─────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
          ┌──────────────────┐      ┌──────────────────────────┐
          │ BATCH A:         │      │ BATCH E: Messages (XL)   │
          │ Export +         │      │ + AI Core pipeline       │
          │ remotefile +     │      │ + paste/upload flows      │
          │ legacyFile (S)   │      │ (depends on #14911)      │
          └────────┬─────────┘      └────────────┬─────────────┘
                   └──────────────┬───────────────┘
                                  ▼
                  ┌──────────────────────────┐
                  │ CLEANUP: Remove Dexie    │
                  │ files, FileMetadata,     │
                  │ FileStorage, v1 preload  │
                  └──────────────────────────┘

             ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
               Independent module migrations
             │ (out of Phase 2 scope):               │
               • Translate module
             │ • Agent module                        │
               • Knowledge module
             │ • Painting module                     │
               • FileProcessing module (+ OCR)
             │ • Backup module                       │
             └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

**Key insight:** After PREREQ-INFRA, the file module as infrastructure is complete. All consumers — whether Phase 2 scope or independent modules — can migrate in parallel. Phase 2 covers only consumers without a clear module owner (Export, remotefile, legacyFile) plus the Messages domain (BATCH E). Business modules (Translate, Agent, Knowledge, Painting, FileProcessing, Backup) each own their own migration timeline.

---

## 2. Task Group Details

### PREREQ-INFRA: Shared Infrastructure + v2 File IPC Wiring

**Scope:** Three categories of infrastructure that all domain batches depend on: (1) v2 File IPC wiring, (2) shared utilities, (3) renderer hooks. Pure additive — no behavioral changes to existing v1 code.

**Why first:** Domain batches cannot begin without working v2 IPC. Currently only **7 of ~48** File IPC methods are wired (channel registered + preload exposed). The main-side implementations already exist in `FileManager.ts` (60+ public methods), but renderer code cannot call them without IPC plumbing. This is the single biggest blocker for all downstream work.

**Current IPC wiring status:**

| Status | Methods | Details |
|--------|---------|---------|
| ✅ Wired + preload | 5 | `createInternalEntry`, `ensureExternalEntry`, `getPhysicalPath`, `permanentDelete`, `runSweep` |
| ⚠️ Wired, no preload | 2 | `getDanglingState`, `batchGetDanglingStates` (main handler registered, preload missing) |
| ❌ Not wired | ~33 | `read`, `write`, `trash`, `restore`, `open`, `showInFolder`, `getMetadata`, `rename`, `copy`, `select`, `save`, batch variants, etc. |

**PR(s):** 2-4 PRs

- [ ] **INF-1: Wire core read/metadata IPC** (needed by BATCH A)
  - Register IPC handlers + preload stubs for: `read` (3 overloads), `getMetadata`, `batchGetMetadata`, `getVersion`, `getContentHash`
  - Fix preload gap: expose `getDanglingState` / `batchGetDanglingStates` in preload
  - These are the methods that every domain batch's "read existing files" path depends on

- [ ] **INF-2: Wire write/lifecycle IPC** (needed by BATCH A)
  - Register IPC handlers + preload stubs for: `write`, `writeIfUnchanged`, `trash`, `restore`, `batchTrash`, `batchRestore`, `batchPermanentDelete`
  - These unlock file mutation operations for renderer consumers

- [ ] **INF-3: Wire system/navigation IPC** (needed by BATCH A)
  - Register IPC handlers + preload stubs for: `open`, `showInFolder`, `select` (3 overloads), `save`, `listDirectory`, `isNotEmptyDir`
  - These are Electron-native operations that domain batches need to replace v1 `window.api.file.open/select/save` calls

- [ ] **INF-4: Wire remaining IPC** (needed by BATCH A-E)
  - Register IPC handlers + preload stubs for: `rename`, `copy`, `batchCreateInternalEntries`, `batchEnsureExternalEntries`, `batchGetPhysicalPaths`
  - These complete the v2 IPC surface

- [ ] **INF-5: Shared `getFileType` extraction** (migration-plan §2.5 Step A)
  - Move `fileTypeMap` + `getFileType(ext)` from `src/main/utils/file.ts` to `packages/shared/file/types/fileType.ts`
  - This file likely already exists — verify and fill in implementation if stub
  - Re-export from old location for backwards compatibility during migration
  - Implement `ops/metadata.ts` `getFileType(path)` and `isTextFile(path)` (move `FileStorage._isTextFile` logic)
  
- [ ] **INF-6: Shared URL utilities** (migration-plan §2.6.5)
  - Create or verify `packages/shared/file/urlUtil.ts` — `isDangerExt(ext)`, `toFileUrl(path)`, `toSafeFileUrl(path, ext)`
  - Port danger-file logic from `FileManager.getSafePath`

- [ ] **INF-7: DataApi `type` filter support** (migration-plan §2.5 Step B)
  - Add `type?: FileType` query param to `GET /files/entries` — handler translates to `ext IN (...)` SQL
  - Response shape unchanged (no opt-in derive fields)

- [ ] **INF-8: Renderer composition hooks** (new)
  - `useFileEntryPaths(ids)` — wraps File IPC `batchGetPhysicalPaths`, returns `Record<id, FilePath>`
  - `useFileEntryRefCounts(ids)` — wraps DataApi `/files/entries/ref-counts`
  - `useFileEntryDanglingStates(ids)` — wraps File IPC `batchGetDanglingStates`
  - These hooks encapsulate the "DataApi + File IPC parallel composition" pattern from RFC §7.3

**IPC wiring per batch dependency:**

| Batch needs → | read/meta | write/lifecycle | system/nav | rename/copy/batch |
|---------------|-----------|-----------------|------------|-------------------|
| BATCH A | ✅ INF-1 | ✅ INF-2 | ✅ INF-3 | ✅ INF-4 (batch create) |
| BATCH E | ✅ INF-1 | ✅ INF-2 | ✅ INF-3 | ✅ INF-4 (all) |

**Dependencies:** None — can start immediately  
**Risk:** Low-Medium — wiring is mostly mechanical (register channel + preload stub), but each method needs its Zod parse schema and proper error handling. The implementations already exist in FileManager.ts.  
**Files touched:** ~10-15 (`FileManager.ts` handler registration, `src/preload/index.ts`, IPC channel enum, preload type declarations)

---

### ~~BATCH A: Translate / Agent Workspace~~ → Independent Module Migrations

Translate module (`TranslatePage.tsx`) and Agent module (`AgentSessionInputbar.tsx`, `AgentModal.tsx`) are scoped as **independent business-module-level migrations**, not part of Phase 2 consumer migration. Both are primarily `path` field users (§2.6 C4/C5 categories) with straightforward migration patterns once PREREQ-INFRA is available.

---

### BATCH A: Export + remotefile + Legacy File Utilities (S)

**Scope:** Consumers without a clear business module owner — the file module takes responsibility for migrating these. Three concerns: (1) Export utilities (no strict module boundary), (2) remotefile/* services needing `purpose` field internalization, (3) `legacyFile.ts` utility retirement.

**PR(s):** 1-2 PRs

- [ ] **A-1: Export utilities migration**
  - `export.ts` — `window.api.file.save/write/saveImage/readExternal` → assess which are v2 File IPC candidates vs. kept-as-is Electron wrappers
  - `exportExcel.ts` — similar assessment
  - `ObsidianExportDialog.tsx` — stop using `file.path` as key, use `entry.id` instead

- [ ] **A-2: remotefile/* services — purpose internalization** (migration-plan §3.4.5 + §2.2)
  - `OpenAIService.ts` / `GeminiService.ts` / `MistralService.ts` — `OpenAIService` receives `context?: { model? }` and infers purpose internally (`inferPurpose(model)`), replacing the `file.purpose` field dependency
  - Note: `fileProcessor.ts` still passes `FileMetadata` to these services during transition; the services accept both v1 and v2 input until BATCH E completes the message pipeline migration

- [ ] **A-3: `legacyFile.ts` migration** (utils-file-migration.md)
  - `src/main/utils/file/legacyFile.ts` — migrate `getAllFiles()`, `base64Image(file: FileMetadata)`, and remaining v1 utility functions to v2 patterns or inline into callers
  - Must complete before CLEANUP removes FileStorage, as downstream consumers depend on these utilities

**Dependencies:** PREREQ-INFRA  
**Risk:** **LOW** — Export and remotefile are secondary features; legacyFile migration is mostly mechanical.  
**Files touched:** ~10-12  
**Verification:** All export formats (markdown, PDF, image, Obsidian). File upload to OpenAI/Gemini/Mistral APIs. Verify no remaining imports of `legacyFile` utilities in Phase 2 scope.

---

### ~~BATCH C: Painting~~ → Independent Module Migration

Painting module (`TokenFluxService`, `paintings/utils`, PaintingMigrator, `painting` sourceType registration) is scoped as an **independent business-module-level migration**, not part of Phase 2 consumer migration.

**Note on PaintingMigrator atomicity:** When eventually implemented, `'painting'` sourceType registration **must** be one atomic PR — the three-piece set (allSourceTypes tuple + SourceTypeChecker + PaintingMigrator file_ref creation) must land together. Until then, do NOT register `'painting'` sourceType; painting files remain zero-ref but untouched by OrphanRefScanner.

---

### ~~BATCH D: Knowledge~~ → Independent Module Migration

Knowledge module (including `KnowledgeService`, `KnowledgeFileReader`, `embedjs/loader`, preprocessing providers, and renderer consumers) is scoped as an **independent business-module-level migration**, not part of Phase 2 consumer migration. Preprocessing providers are deprecated and migrating into the FileProcessing module.

---

### BATCH E: Messages — Attachments / Images / Blocks (XL)

**Scope:** The largest and most deeply entangled domain. Message blocks store inline `FileMetadata` JSON; the count increment/decrement lifecycle is coupled to message CRUD; the FilesPage UI depends on Dexie queries.

**Why last:** Messages touches the most code, has the deepest data model coupling, and requires all field retirements to be complete. Doing it last means all patterns are battle-tested on simpler domains.

**PR(s):** 4-6 PRs

- [ ] **E-1: FilesPage UI migration** (migration-plan §2.3.9 B8, §2.3.11)
  - `FilesPage.tsx` — `db.files.orderBy('count')` / `db.files.where('type')` → DataApi `listEntries` + `useFileEntryRefCounts`
  - `FileList.tsx` — `${item.count}${t('files.count')}` → ref count from DataApi
  - Sorting by refCount, filtering by type via DataApi query params
  - Dangling indicators via `useFileEntryDanglingStates`

- [ ] **E-2: FileAction rewrite** (migration-plan §2.3.9 B7)
  - `FileAction.ts:handleDelete` — currently does manual message block scanning + force delete
  - v2: `fileRefService.cleanupByEntry(entryId)` + `fileIpc.permanentDelete(handle)` — or trash + OrphanRefScanner delayed cleanup
  - **Open decision:** §2.3.10 — immediate vs delayed cleanup for zero-ref files

- [ ] **E-3: Message display components** (migration-plan §2.6 Step B)
  - `ImageBlock.tsx` — `file://` URL rendering → `useFileEntryPaths` + `toSafeFileUrl`
  - `MessageAttachments.tsx` — same pattern
  - `AttachmentPreview.tsx` — preview rendering + open/reveal actions → v2 File IPC
  - `MessageEditor.tsx` — IMAGE-specific editing logic → `getFileType(ext)` check

- [ ] **E-4: Message creation utilities**
  - `utils/messageUtils/create.ts` — `isImageFileMetadata(file)` → `getFileType(entry.ext) === IMAGE`
  - `utils/messageUtils/find.ts` — FileMetadata references

- [ ] **E-5: Message CRUD + count retirement** (migration-plan §2.3.9 B1-B6)
  - `renderer FileManager.ts` — gut and rewrite:
    - `addFile` / `addBase64File` / `uploadFile` — stop `count++`, create `file_ref` instead
    - `deleteFile` — stop `count--`, cleanup `file_ref` instead
    - `getFile` — stop path override hack, query v2 FileEntry
    - `getFiles` / `updateFile` / `updateFileCount` — replace or remove
  - `DexieMessageDataSource.ts:updateFileCount` — remove entirely
  - `messageThunk.ts:1849` — fork/clone count++ → `fileRefService.create`
  - `messageThunk.ts:607` — delete cleanup → `fileRefService.cleanupBySource`
  - `MessagesService.ts:deleteMessageFiles/safeDeleteFiles` — → `fileRefService.cleanupBySource`

- [ ] **E-6: Chat message file_ref sourceType registration** (RFC §8.4 deferred item)
  - Register `'chat_message'` in `allSourceTypes` (three-piece set)
  - Create `file_ref` records for existing message → file references
  - This was explicitly deferred from Batch 0 — now is the time

- [ ] **E-7: AI Core pipeline migration** (moved from original Batch B per producer-consumer atomicity)
  - `fileProcessor.ts` — replace all `file.type === X` with `getFileType(file.ext) === X`; replace `window.api.file.read(file.id + file.ext)` with `fileIpc.read`; change input type from `FileMetadata` to `FileEntry`
  - `messageConverter.ts` — `window.api.file.base64Image(imageBlock.file.id + ext)` → v2 read
  - `modelCapabilities.ts` — type comparisons update
  - `TokenService.ts` — `file.type === TEXT` → `getFileType(file.ext) === TEXT`

- [ ] **E-8: Paste/upload flow migration** (moved from original Batch B per producer-consumer atomicity)
  - `PasteService.ts` — paste handler: `FileMetadata` creation → `createInternalEntry({ source: 'base64' | 'path' })`
  - `usePasteHandler.ts` / `useFileDragDrop.ts` — `FileMetadata` → `FileEntry`
  - `useAttachment.ts` — attachment handling
  - `InputbarCore.tsx` — `readExternal` → `fileIpc.read(handle)`
  - `input.ts` — `window.api.file.get(path)` → `fileIpc.ensureExternalEntry` or `createInternalEntry`

- [ ] **E-9: Rich editor and code block components**
  - `useRichEditor.ts:518` — `savePastedImage` → `createInternalEntry({ source: 'base64' })`
  - `HtmlArtifactsCard.tsx` — `createTempFile` / `write` / `save` — assess v2 mapping
  - `HtmlArtifactsPopup.tsx` — `saveImage`
  - `CodeBlockView/view.tsx` — `save`
  - `SaveToKnowledgePopup.tsx` — `readExternal` → `fileIpc.read`

**Dependencies:** PREREQ-INFRA + [#14911](https://github.com/CherryHQ/cherry-studio/pull/14911)  
**Risk:** **HIGH** — touches the core messaging experience + AI Core pipeline; regression = broken conversations  
**Files touched:** ~30-40 (largest batch: includes fileProcessor, messageConverter, paste flows, message CRUD, FilesPage)  
**Verification:** Full message lifecycle (create, edit, delete, fork), file attachments, image display, FilesPage CRUD, Trash/Restore  
**Open decisions:**
- §2.3.10: Immediate vs delayed cleanup for zero-ref files (recommend delayed/OrphanRefScanner)
- §6 Q8: FilesPage `handleDelete` force-delete + cascade block cleanup — renderer-driven or main-driven?
- §8.4: ChatMigrator `file_ref` creation — batch at migration time or lazy-create on access?

---

### CLEANUP: Final Removal

**Scope:** Remove all v1 artifacts once all domain batches are complete.

**PR(s):** 1-2 PRs

- [ ] **CL-1: Remove Dexie `files` table**
  - Dexie schema upgrade removes `files` table + all indices
  - Remove all `db.files.*` access (should be zero by now)
  
- [ ] **CL-2: Remove `FileMetadata` type**
  - Delete `packages/shared/data/types/file/file.ts` (or `legacyFileMetadata.ts`)
  - Delete `src/renderer/src/types/file.ts` FileMetadata definition
  - Remove all 29 import sites (should already be migrated)
  
- [ ] **CL-3: Remove `FileStorage` service**
  - Delete `src/main/services/FileStorage.ts`
  - Remove preload bridge entries
  
- [ ] **CL-4: Remove deprecated v1 preload APIs** (migration-plan §3.4.4)
  - Batch-delete all deprecated `window.api.file.*` channels
  - Remove corresponding main-side IPC handlers
  - Keep only "retained" APIs: `select`, `selectFolder`, `openPath`, `getPathForFile`

- [ ] **CL-5: Remove renderer `FileManager` v1 service**
  - `src/renderer/src/services/FileManager.ts` — the v1 wrapper around Dexie; replaced by v2 hooks + IPC

- [ ] **CL-6: Rewire incidental FileStorage consumers**
  - `McpService.ts` — `fileStorage.createTempFile()` + `writeFile()` (DXT upload staging) → replace with `fs.mkdtemp` + `fs.writeFile` or v2 equivalent
  - `ExportService.ts` — `fileStorage.writeFile()` (DOCX export to user-chosen path) → replace with direct `fs.writeFile`
  - These are NOT file metadata consumers — purely mechanical replacement when FileStorage is deleted

- [ ] **CL-7: Verify Backup/Restore v2 awareness**
  - Ensure [#12659](https://github.com/CherryHQ/cherry-studio/issues/12659) is complete before release — BackupManager must dump/restore SQLite DB alongside Dexie export

**Dependencies:** ALL Phase 2 batches complete. CLEANUP cannot delete `FileMetadata` / `FileStorage` until independent module migrations (Translate, Agent, Knowledge, Painting, FileProcessing, Backup) have also migrated off v1 — they do NOT block Phase 2 batches but DO gate CLEANUP. #12659 should be complete before release.  
**Risk:** Low — purely subtractive if all batches properly migrated  
**Files touched:** ~20-30

---

## 3. Cross-Cutting Concerns (tracked across batches)

These items don't belong to any single batch but need attention throughout:

### 3.1 Preload API Deprecation (migration-plan §3.4.4)

Each batch should `@deprecated` the v1 APIs it replaces (JSDoc annotation). Deprecation logging, if needed, must go through `loggerService` (not `console.warn` — repo convention). CLEANUP batch does the actual deletion.

### 3.2 `remotefile/*` Services Transition (migration-plan §3.4.5)

- Phase 2 切换期: `remotefile/*` services maintain v1 API surface, only field-level adaptation (purpose, displayName)
- Phase X (AI SDK stable): `FileUploadService` takes over; `remotefile/*` deprecated
- Phase X+1: `remotefile/*` deleted

### 3.3 Field Retirement Tracking (No Standalone Steps)

Per the atomic domain cutover strategy (§0), fields are NOT retired independently. Each field's migration happens atomically within the domain batch that migrates its consumers. Tracking:

| Field | Dies when... | Key batch(es) |
|-------|-------------|---------------|
| `purpose` | Upload services accept v2 types | BATCH A (A-2) internalizes in remotefile; BATCH E (E-7) removes from fileProcessor |
| `tokens` | Never had consumers; vanishes with type | CLEANUP |
| `type` | All `file.type === X` replaced by `getFileType(ext)` | BATCH E (Messages + AI Core E-7); independent module migrations (Knowledge, Painting) handle their own |
| `path` | All `file.path` replaced by IPC / helper | BATCH A + E; independent modules handle their own |
| `count` | All `count++/--` replaced by `file_ref` ops | BATCH E |
| `name` (storage name) | Replaced by `resolvePhysicalPath` | BATCH A + E |
| `origin_name` | Split into `FileEntry.name` + `FileEntry.ext` | Each batch as it migrates; independent modules handle their own |

No shim is used — unmigrated consumers read native `FileMetadata` from Dexie; migrated consumers read `FileEntry` from v2. CLEANUP removes `FileMetadata` and Dexie `files` table together.

---

## 4. Estimated Effort & Timeline

| Task Group | PRs | Complexity | Est. Effort | Parallelizable? |
|------------|-----|------------|-------------|------------------|
| PREREQ-INFRA | 2-4 | M-L | 4-7 days | — |
| BATCH A | 1-2 | S | 2-3 days | After INFRA, ∥ with E |
| BATCH E | 5-8 | XL | 10-16 days | After INFRA + #14911, ∥ with A |
| CLEANUP | 1-2 | M | 2-3 days | After A + E |
| **Total** | **~9-16** | | **~18-29 days** | |

**Critical path:** PREREQ-INFRA → BATCH E → CLEANUP (BATCH A is parallel with E but much smaller; E + #14911 is the bottleneck)

**Out-of-scope (independent module migrations):** Translate, Agent, Knowledge, Painting, FileProcessing, Backup — these proceed on their own timelines and do not block the Phase 2 critical path. They DO gate CLEANUP (v1 artifacts can't be deleted until all modules have migrated off them).

---

## 5. Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| BATCH E concentration: AI Core + paste + messages + FilesPage in one mega-batch | 🔴 | Split E into 5-8 PRs with incremental verification; E-7 (AI Core) and E-8 (paste) can be separate PRs from E-1–E-6 |
| fileProcessor regression breaks ALL conversations | 🔴 | E-7 needs comprehensive provider-matrix testing; feature-flag if possible |
| count retirement changes UX (delayed cleanup) | 🟡 | Product decision needed (§2.3.10); OrphanRefScanner delay = user sees file after unlinking |
| 142 call sites across 59 files — hard to track migration completeness | 🟡 | Grep count regression check per PR: `FileMetadata` imports and `window.api.file.*` calls should decrease monotonically |
| Independent module migrations lag behind Phase 2 | 🟡 | CLEANUP cannot delete `FileMetadata` type / `FileStorage` until all independent modules (Translate, Agent, Knowledge, Painting, FileProcessing, Backup) have also migrated off v1. Track independently but gate CLEANUP on completion. |
| Backup/Restore v2 awareness | 🟢 | Handled independently in [#12659](https://github.com/CherryHQ/cherry-studio/issues/12659); not a blocker for consumer migration (v1/v2 coexistence is dev-only) |

---

## 6. Open Decisions Requiring Input

| # | Decision | Options | Recommendation | Blocking |
|---|----------|---------|----------------|----------|
| 1 | Zero-ref file cleanup: immediate vs delayed? (§2.3.10) | (a) Trigger permanentDelete on last ref removal (b) OrphanRefScanner delayed cleanup | (b) Delayed — simpler, undo-friendly | BATCH E-2 |
| 2 | FilesPage force-delete: renderer-driven cascade or main-driven? (§6 Q8) | (a) Renderer scans blocks + cascades (b) Main-side FileManager handles cascade | (b) Main-side — cleaner boundary | BATCH E-2 |
| 3 | ChatMigrator file_ref: batch at migration or lazy-create? (§8.4) | (a) Batch create during ChatMigrator (b) Lazy-create on first access | (a) Batch — ensures complete ref graph | BATCH E-6 |
| 4 | Shared vs per-batch feature flags? | (a) Global v2-file flag (b) Per-domain flags | (b) Per-domain — enables independent rollback | All batches |

---

## 7. Verification Strategy

Each batch PR must pass:

1. **Automated:** `pnpm lint && pnpm test` (as per CLAUDE.md)
2. **Manual verification matrix:**

| Scenario | Batches |
|----------|---------|
| Export (markdown, PDF, image, Obsidian) | A |
| remotefile provider upload (OpenAI/Gemini/Mistral) | A |
| Upload file (internal) via paste, drag-drop, file picker | E |
| Send message with file attachment (text, image, document) | E |
| AI conversation with file context (OpenAI, Claude, Gemini, Qwen) | E |
| FilesPage: list, filter by type, sort by count, delete, open | E |
| Trash / Restore file | E |
| Fresh install (no migration) + returning user (with migration) | All |

**Independent module verification (out of Phase 2 scope):** Translate page file read, Agent workspace file @-mention, Knowledge base file operations, Painting file references, OCR processing, Backup/Restore — each verified within their own module migration.

3. **Regression grep:** After each batch, count of `FileMetadata` imports and `window.api.file.*` calls should decrease monotonically.
