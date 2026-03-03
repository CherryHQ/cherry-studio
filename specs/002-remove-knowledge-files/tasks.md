# Tasks: Remove Knowledge & Files Features (Phase 02)

**Input**: Design documents from `/specs/002-remove-knowledge-files/`
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅

**Tests**: Not requested — this is a pure removal phase. Verification is `pnpm build:check`.

**Organization**: Tasks are grouped by user story. Foundational deletions must complete before any edits begin. All edits across US1/US2/US3 touch different files and can be executed in parallel.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: Confirm research findings before making any changes.

- [x] T001 Read `specs/002-remove-knowledge-files/research.md` and confirm the critical scope correction: `api.file.*`, `api.fileService.*`, `FileStorage.ts`, `FileSystemService.ts`, `remotefile/`, and `FileManager.ts` are **retained** — only the Knowledge/OCR layer is removed

**Checkpoint**: Research reviewed — proceed to deletions

---

## Phase 2: Foundational — Delete All Dead Source Files

**Purpose**: Remove all files and directories whose consumers are being cleaned up in Phases 3–5. Deletions are independent and can all be done in parallel.

**⚠️ CRITICAL**: No edit tasks (Phases 3–5) should begin until all deletions in this phase are complete, as the TypeScript compiler will catch dangling imports.

- [x] T002 [P] Delete `src/renderer/src/pages/knowledge/` entire directory (KnowledgeBasePage and all sub-components)
- [x] T003 [P] Delete `src/renderer/src/pages/files/` entire directory (FilesPage, FileList, and all sub-components)
- [x] T004 [P] Delete `src/renderer/src/pages/settings/DocProcessSettings/` entire directory (OCR provider config, preprocessing settings)
- [x] T005 [P] Delete `src/renderer/src/store/knowledge.ts`
- [x] T006 [P] Delete `src/renderer/src/store/ocr.ts`
- [x] T007 [P] Delete `src/renderer/src/store/preprocess.ts`
- [x] T008 [P] Delete `src/renderer/src/services/KnowledgeService.ts` (only used by deleted pages/knowledge)
- [x] T009 [P] Delete `src/renderer/src/services/FileAction.ts` (only used by deleted pages/files)
- [x] T010 [P] Delete `src/main/services/KnowledgeService.ts` (only imported by ipc.ts KnowledgeBase handlers)
- [x] T011 [P] Delete `src/main/knowledge/` entire directory (embeddings, preprocessing, reranking — only used by KnowledgeService.ts)
- [x] T012 [P] Delete `src/main/services/ocr/` entire directory (OcrService, provider adapters — only imported by ipc.ts OCR handlers)
- [x] T013 [P] Delete `src/main/mcpServers/dify-knowledge.ts` (Knowledge-only MCP server)

**Checkpoint**: All dead files removed — begin edits in Phases 3, 4, and 5 (can start in parallel)

---

## Phase 3: User Story 1 — Clean App Navigation (Priority: P1) 🎯 MVP

**Goal**: Remove Knowledge Base and File Manager icons from the sidebar, and remove the Doc Processing section from Settings. Navigation surface area is immediately user-visible.

**Independent Test**: Launch the app → sidebar has no Knowledge or Files icons → Settings has no Doc Processing menu item → navigating to `/knowledge` or `/files` results in graceful state, no crash.

### Implementation for User Story 1

- [x] T014 [P] [US1] Edit `src/renderer/src/Router.tsx`: remove `import KnowledgePage` and `import FilesPage` lines; remove `<Route path="/knowledge" ...>` and `<Route path="/files" ...>` JSX entries
- [x] T015 [P] [US1] Edit `src/renderer/src/config/sidebar.ts`: remove `'knowledge'` and `'files'` string literals from the `DEFAULT_SIDEBAR_ICONS` array
- [x] T016 [P] [US1] Edit `src/renderer/src/pages/settings/SettingsPage.tsx`: remove `import DocProcessSettings` line; remove the `<MenuItemLink>` block for `/settings/docprocess`; remove `<Route path="docprocess" element={<DocProcessSettings />} />`
- [x] T017 [P] [US1] Edit `src/renderer/src/types/index.ts`: remove `'knowledge'` and `'files'` string literals from the `SidebarIcon` union type (follow Phase 01 pattern exactly)
- [x] T018 [P] [US1] Edit `src/renderer/src/i18n/label.ts`: remove `knowledge` and `files` key-value entries from the `getSidebarIconLabel` map
- [x] T019 [P] [US1] Edit `src/renderer/src/pages/settings/DisplaySettings/SidebarIconsManager.tsx`: remove `knowledge` and `files` entries from the `iconMap` object

**Checkpoint**: Navigation clean — no Knowledge/Files icons in sidebar, no Doc Processing in Settings

---

## Phase 4: User Story 2 — Stable App After Removal (Priority: P1)

**Goal**: Ensure the Redux store doesn't reference deleted slices, add a migration step so existing persisted state is upgraded cleanly, and verify the build passes.

**Independent Test**: `pnpm build:check` passes with zero new errors; app launches without console errors referencing deleted modules; `state.knowledge`, `state.ocr`, `state.preprocess` keys are stripped from any persisted state on first launch.

### Implementation for User Story 2

- [x] T020 [US2] Edit `src/renderer/src/store/index.ts` — remove reducer imports and registrations: remove `import knowledge from './knowledge'`, `import ocr from './ocr'`, `import preprocess from './preprocess'`; remove their entries from the `combineReducers` call
- [x] T021 [US2] Edit `src/renderer/src/store/index.ts` — add Redux persist migration step `'202'` (strip `knowledge`, `ocr`, `preprocess` keys from state; filter `'knowledge'` and `'files'` from `sidebarIcons.visible` and `sidebarIcons.disabled`; use the same pattern as migration `'201'`); bump the store `version` constant from `201` to `202`

**Checkpoint**: Store slice removal and migration complete — app will boot cleanly from any previous persisted state

---

## Phase 5: User Story 3 — Reduced Internal Complexity (Priority: P2)

**Goal**: Remove all backend service registrations, IPC handlers, preload namespaces, and MCP server entries that exclusively served the Knowledge and OCR features. Zero dead code remaining in the backend.

**Independent Test**: Codebase-wide search finds zero imports of `KnowledgeService`, `OcrService`, `dify-knowledge`, or `DifyKnowledgeServer`; preload exposes no `knowledgeBase:` or `ocr:` namespaces; `ipc.ts` registers no `KnowledgeBase_*` or `OCR_*` handlers.

### Implementation for User Story 3

- [x] T022 [P] [US3] Edit `src/main/ipc.ts` — remove the two service imports: `import KnowledgeService from './services/KnowledgeService'` and `import { ocrService } from './services/ocr/OcrService'`; also remove the type imports that are only used by these handlers (`OcrProvider`, `SupportedOcrFile`, `KnowledgeBaseParams`, `KnowledgeItem`, `KnowledgeSearchResult`, `KnowledgeSearchParams`, `KnowledgeBaseItems` — verify each is unused before removing)
- [x] T023 [US3] Edit `src/main/ipc.ts` — remove the 7 KnowledgeBase IPC handler registrations: `KnowledgeBase_Create`, `KnowledgeBase_Reset`, `KnowledgeBase_Delete`, `KnowledgeBase_Add`, `KnowledgeBase_Remove`, `KnowledgeBase_Search`, `KnowledgeBase_Rerank` (depends on T022)
- [x] T024 [US3] Edit `src/main/ipc.ts` — remove the 2 OCR IPC handler registrations: `OCR_ocr` and `OCR_ListProviders` (depends on T022)
- [x] T025 [P] [US3] Edit `src/main/mcpServers/factory.ts` — remove `import DifyKnowledgeServer from './dify-knowledge'`; remove the `case BuiltinMCPServerNames.difyKnowledge:` block (do NOT touch `memory.ts` import or its case — that is Phase 03 scope)
- [x] T026 [P] [US3] Edit `src/preload/index.ts` — remove the `knowledgeBase:` namespace block (~lines 282–305); do NOT touch `file:` (~line 197) or `fileService:` (~lines 330–337) — those are used by the AI core engine
- [x] T027 [US3] Edit `src/preload/index.ts` — remove the `ocr:` namespace block (~lines 545–548) (depends on T026; same file — execute sequentially after T026)
- [x] T028 [P] [US3] Edit `src/main/index.ts` — search for any initialization or cleanup calls referencing `KnowledgeService` (e.g., `knowledgeService.initialize()`, `knowledgeService.destroy()`) and remove them. Verify with: `grep -n "KnowledgeService\|knowledgeService" src/main/index.ts` — expected output is zero matches after edits; if no calls existed, note "no calls found" and mark complete.

**Checkpoint**: All backend dead code removed — no active references to deleted services, IPC channels, or preload namespaces

---

## Phase 6: Polish & Verification

**Purpose**: Format, lint, and confirm zero new build errors across all three user stories.

- [x] T029 Run `pnpm format` from repository root to auto-fix any style issues introduced by the removals
- [x] T030 Run `pnpm build:check` and confirm it passes with zero new TypeScript errors (the same 8 pre-existing Vitest failures that existed before this phase are acceptable)
- [ ] T031 [P] Manual smoke test — launch the app (`pnpm dev`) and verify: (1) sidebar has no Knowledge or Files icons, (2) Settings has no Doc Processing section, (3) navigating to `/knowledge` or `/files` does not crash, (4) selecting text and triggering the Selection Assistant returns an AI result correctly

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: No dependencies — start immediately
- **Navigation edits (Phase 3)**: Depends on T002, T003, T004 (page directories deleted)
- **Store edits (Phase 4)**: Depends on T005, T006, T007 (slice files deleted)
- **Backend edits (Phase 5)**: Depends on T010, T012, T013 (KnowledgeService, ocr/, dify-knowledge deleted)
- **Phase 3, 4, 5**: Can all start as soon as their respective foundational deletions are done — they touch completely different files
- **Verification (Phase 6)**: Depends on ALL phases complete

### Within Phase Dependencies

- T022 → T023 → T024 (ipc.ts: remove imports first, then handlers)
- T026 → T027 (preload/index.ts: sequential edits to same file)
- T020 → T021 (store/index.ts: remove reducers, then add migration)

### Parallel Opportunities

All Phase 2 deletions (T002–T013) are fully parallel.
Once deletions are done, Phase 3 tasks (T014–T019) are fully parallel.
Phase 3, 4, and 5 are parallel with each other (different files).

---

## Parallel Example: All Edits After Deletions

```bash
# Once Phase 2 completes, these can all be worked in parallel:

# US1 - Navigation (Phase 3):
Task T014: "Edit Router.tsx — remove /knowledge and /files routes"
Task T015: "Edit sidebar.ts — remove knowledge and files icons"
Task T016: "Edit SettingsPage.tsx — remove DocProcessSettings"
Task T017: "Edit types/index.ts — remove SidebarIcon literals"
Task T018: "Edit i18n/label.ts — remove label entries"
Task T019: "Edit SidebarIconsManager.tsx — remove iconMap entries"

# US2 - Store (Phase 4):
Task T020: "Edit store/index.ts — remove reducers"
Task T021: "Edit store/index.ts — add migration 202"

# US3 - Backend (Phase 5):
Task T022: "Edit ipc.ts — remove imports"
Task T025: "Edit factory.ts — remove dify-knowledge"
Task T026: "Edit preload/index.ts — remove knowledgeBase namespace"
Task T028: "Edit main/index.ts — remove KnowledgeService calls"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Delete all dead files (required baseline)
2. Complete Phase 3: Navigation edits (US1 — visible user-facing changes)
3. Partial Phase 4: Remove store reducers from store/index.ts (required for build)
4. Partial Phase 5: Remove ipc.ts handlers and preload namespaces (required for build)
5. Run `pnpm build:check` → **STOP and VALIDATE**

### Recommended: Complete All Phases Together

This phase is small enough to complete end-to-end in a single session. All 31 tasks are straightforward deletions and surgical edits. Complete Phases 2–5 in sequence, then run Phase 6 verification once.

---

## Notes

- **CRITICAL**: Do NOT delete `src/main/services/FileStorage.ts`, `src/main/services/FileSystemService.ts`, `src/main/services/remotefile/`, or `src/renderer/src/services/FileManager.ts` — these back the AI core engine
- **CRITICAL**: Do NOT remove `file:` or `fileService:` namespaces from `src/preload/index.ts` — used by AI core and Gemini file upload respectively
- **CRITICAL**: Do NOT remove `src/main/mcpServers/memory.ts` — that is Phase 03 scope (Notes & Memory)
- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps each task to its user story for traceability
- Commit after Phase 6 passes: `refactor: remove knowledge base, files, and doc processing features (Phase 02)`
