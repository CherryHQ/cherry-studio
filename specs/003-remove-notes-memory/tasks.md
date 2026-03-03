# Tasks: Remove Notes & Memory Features (Phase 03)

**Input**: Design documents from `/specs/003-remove-notes-memory/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, quickstart.md ✓

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup

**Purpose**: Confirm pre-flight state — validate that the consumer audit findings from research.md match the current codebase before destructive changes begin.

- [X] T001 Confirm pre-flight: run `rg "state\.note\." src/renderer/src --include="*.ts" --include="*.tsx" -l` and `rg "selectGlobalMemoryEnabled\|selectMemoryConfig" src/renderer/src --include="*.ts" --include="*.tsx" -l` to verify only the expected files are listed. For the first search: expected files are `store/index.ts`. For the second search: expected files are `store/index.ts` (if present), `searchOrchestrationPlugin.ts`, `useAppInit.ts`, `AssistantMemorySettings.tsx`, and any files within `MemorySettings/` — **the MemorySettings/ files are expected and will be deleted in Phase 4**

---

## Phase 2: Foundational — Boot Crash Fix (US1) 🎯 CRITICAL

**Goal**: Remove the Redux store slices for Notes and Memory, and eliminate the persistor callback that reads `state.note.notesPath` on every boot — the primary crash risk for this phase. Add migration 203 to handle previously persisted state.

**Independent Test**: Launch `pnpm dev` after this phase alone and verify the app boots to the main chat view without any crash or console error referencing `state.note` or missing reducers.

**⚠️ CRITICAL**: T002 must be completed before T003/T004. All four tasks must complete before any user story work.

- [X] T002 [US1] Edit `src/renderer/src/store/index.ts` — remove `import { setNotesPath } from './note'`, remove `import note from './note'`, remove `import memory from './memory'`, remove `note,` and `memory,` from `combineReducers({})`, remove `'note/'` from the `storeSyncService.setOptions({ syncList: [...] })` array, bump `version` from `202` to `203`, and delete the entire `setNotesPath` block from the `persistor` callback (the `if (!state.note.notesPath) { setTimeout(...) }` block — keep the remaining IPC and logger calls)
- [X] T003 [P] [US1] Delete `src/renderer/src/store/note.ts` (safe after T002 removes its import from store/index.ts)
- [X] T004 [P] [US1] Delete `src/renderer/src/store/memory.ts` (safe after T002 removes its import from store/index.ts)
- [X] T005 [US1] Add migration `203` to `src/renderer/src/store/migrate.ts` — the migration function should: `delete state.note`, `delete state.memory`, and filter `'notes'` from `state.settings?.sidebarIcons` if that array exists; register it in the migrations map at key `203`

**Checkpoint**: After T002–T005, the store compiles without the note/memory slices. Running `pnpm dev` should boot the app cleanly.

---

## Phase 3: User Story 2 — Notes Feature No Longer Accessible (Priority: P1)

**Goal**: Delete all Notes UI, service, and hook files, then remove every consumer reference (route, sidebar, settings, export functions, menu items, IPC handler).

**Independent Test**: Launch the app, verify no Notes icon appears in the sidebar, and navigate to `/notes` — it should show a graceful empty/404 state with no crash.

### Deletions (all parallel — separate files)

- [X] T006 [P] [US2] Delete `src/renderer/src/pages/notes/` entire directory (NotesPage, NotesSidebar, NotesEditor, NotesSidebarHeader, NotesSettings, HeaderNavbar, MenuConfig, and all hooks/context/components subdirectories)
- [X] T007 [P] [US2] Delete `src/renderer/src/hooks/useNotesQuery.ts`
- [X] T008 [P] [US2] Delete `src/renderer/src/hooks/useNotesSettings.ts`
- [X] T009 [P] [US2] Delete `src/renderer/src/hooks/useShowWorkspace.ts`
- [X] T010 [P] [US2] Delete `src/renderer/src/services/NotesService.ts`

### Consumer Edits (all parallel — different files)

- [X] T011 [P] [US2] Remove notes route from `src/renderer/src/Router.tsx` — delete `import NotesPage from './pages/notes/NotesPage'` and the `<Route path="/notes" element={<NotesPage />} />` line
- [X] T012 [P] [US2] Remove `'notes'` from the `DEFAULT_SIDEBAR_ICONS` array in `src/renderer/src/config/sidebar.ts`
- [X] T013 [P] [US2] Remove the `notes: <NotepadText size={16} />` entry from the icon map in `src/renderer/src/pages/settings/DisplaySettings/SidebarIconsManager.tsx` (also remove the `NotepadText` import if it becomes unused)
- [X] T014 [P] [US2] Remove notes label entries (any entry with key `notes` or value referencing `notes.title` or `title.notes`) from `src/renderer/src/i18n/label.ts`
- [X] T015 [P] [US2] Remove the `ipcMain.handle(IpcChannel.File_ValidateNotesDirectory, ...)` handler block from `src/main/ipc.ts`
- [X] T016 [P] [US2] Remove `exportMessageToNotes` function, `exportTopicToNotes` function, and the `addNote` import from `src/renderer/src/utils/export.ts`
- [X] T017 [P] [US2] Remove the notes export menu item (the menu item that calls `exportMessageToNotes`), remove `useNotesSettings` import and all `notesPath` usages from `src/renderer/src/pages/home/Messages/MessageMenubar.tsx`
- [X] T018 [P] [US2] Remove the notes export menu item (the menu item that calls `exportTopicToNotes`), remove `useNotesSettings` import and all `notesPath` usages from `src/renderer/src/pages/home/Tabs/components/Topics.tsx`

**Checkpoint**: After T006–T018, the Notes feature is fully absent. `pnpm build:check` errors should only relate to Memory (next phase) or pre-existing failures.

---

## Phase 4: User Story 3 — Conversation Memory Settings Removed (Priority: P1)

**Goal**: Delete all Memory UI, services, processor, and tool files, then remove every consumer reference (settings page, assistant settings, AI search pipeline, app init hook, message tool, main-process lifecycle, preload).

**Independent Test**: Open Settings and confirm no "Memory" item appears in the navigation. Navigate to `/settings/memory` — graceful empty state, no crash.

### Deletions (all parallel — separate files)

- [X] T019 [P] [US3] Delete `src/renderer/src/pages/settings/MemorySettings/` entire directory (MemorySettings.tsx, MemorySettingsModal.tsx, UserSelector.tsx, constants.ts, index.tsx)
- [X] T020 [P] [US3] Delete `src/renderer/src/pages/settings/AssistantSettings/AssistantMemorySettings.tsx`
- [X] T021 [P] [US3] Delete `src/renderer/src/services/MemoryService.ts` (renderer-side service)
- [X] T022 [P] [US3] Delete `src/renderer/src/services/MemoryProcessor.ts`
- [X] T023 [P] [US3] Delete `src/main/services/memory/` entire directory (MemoryService.ts, queries.ts, embeddings/ subdirectory)
- [X] T024 [P] [US3] Delete `src/renderer/src/aiCore/tools/MemorySearchTool.ts`
- [X] T025 [P] [US3] Delete `src/renderer/src/pages/home/Messages/Tools/MessageMemorySearch.tsx`

### Consumer Edits (all parallel — different files)

- [X] T026 [P] [US3] Remove MemorySettings from `src/renderer/src/pages/settings/SettingsPage.tsx` — delete `import MemorySettings from './MemorySettings'`, remove the `<MenuItemLink>` block for `/settings/memory` (the one with the Brain icon), and remove the `<Route path="memory" element={<MemorySettings />} />` line
- [X] T027 [P] [US3] Remove AssistantMemorySettings from `src/renderer/src/pages/settings/AssistantSettings/index.tsx` — delete the import statement and remove the `<AssistantMemorySettings />` JSX element from the component body
- [X] T028 [P] [US3] Remove all memory logic from `src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts` — **read the full file before editing**. Remove: imports of `selectGlobalMemoryEnabled`, `selectMemoryConfig` from `store/memory`; imports of `MemoryProcessor` and `memorySearchTool`/`MemorySearchTool`; the memory-enabled conditional that injects `memorySearchTool` into the tools array; the `storeConversationMemory()` call in the `onFinish`/completion handler. Preserve: the main plugin `apply()`/`process()` structure, the web search tool injection (non-memory branches), and all search result rendering middleware
- [X] T029 [P] [US3] Remove MemoryService initialization from `src/renderer/src/hooks/useAppInit.ts` — delete `import MemoryService` (or `import { MemoryService }`) and remove the `MemoryService.getInstance()` initialization call
- [X] T030 [P] [US3] Remove memory search tool references from `src/renderer/src/pages/home/Messages/Tools/MessageTool.tsx` — delete `import { MessageMemorySearchToolTitle } from './MessageMemorySearch'` and remove the `case 'memory_search': return <MessageMemorySearchToolTitle toolResponse={toolResponse} />` block from the `ChooseTool` switch
- [X] T031 [P] [US3] Remove MemoryService from `src/main/utils/lifecycle.ts` — delete `import MemoryService from '../services/memory/MemoryService'` and remove `MemoryService.getInstance().close()` from the `closeAllDataConnections` (or equivalent) function call/array

**Checkpoint**: After T019–T031, the Memory feature is fully absent from both UI and backend. Combined with Phase 3, `pnpm build:check` should now produce only pre-existing failures.

---

## Phase 5: Shared File Cleanups (US2 + US3)

**Purpose**: Edit files that carry changes for both Notes (US2) and Memory (US3) to avoid two sequential edits to the same file.

- [X] T032 [US2] [US3] Edit `src/preload/index.ts` — (a) remove the entire `memory:` namespace block (~12 IPC method mappings: add, search, list, delete, update, get, setConfig, deleteUser, deleteAllMemoriesForUser, getUsersList, migrateMemoryDb) [US3]; (b) remove `validateNotesDirectory` from within the `file:` namespace [US2]; clean up any unused imports that result
- [X] T033 [US2] [US3] Edit `src/renderer/src/types/index.ts` — (a) remove `'notes'` from the `SidebarIcon` union type [US2]; (b) remove `enableMemory?: boolean` from the `Assistant` interface [US3]; clean up any now-unused type imports if applicable

---

## Phase 6: User Story 4 — Selection Assistant Continues to Function (Priority: P1)

**Goal**: Run the build check and verify the core Selection Assistant feature is unaffected by all removals.

**Independent Test**: Run `pnpm build:check` (zero new errors) then trigger the Selection Assistant on any text — a complete AI response must be returned.

- [X] T034 [US4] Run `pnpm format` to auto-format all edited files; fix any formatting issues before proceeding
- [X] T035 [US4] Run `pnpm build:check` and confirm: (a) zero TypeScript type errors in changed files, (b) zero new lint errors, (c) only the 8 pre-existing test failures remain (DxtService.test.ts, process.test.ts, BackupManager.deleteTempBackup.test.ts)
- [ ] T036 [US4] Launch `pnpm dev` and perform boot verification per quickstart.md Scenario 1: app must reach main chat view within 5 seconds with no crash dialog and no console error referencing `state.note`, `notesPath`, or missing reducers — repeat 3 times (cold launch each run) to satisfy SC-001
- [ ] T037 [US4] Verify Notes removal per quickstart.md Scenario 2: (a) no Notes icon in sidebar; (b) `/notes` URL shows graceful empty state with no crash
- [ ] T038 [US4] Verify Memory removal per quickstart.md Scenarios 3 and 4: (a) no Memory item in Settings navigation; (b) `/settings/memory` URL shows graceful empty state; (c) Assistant settings panel shows no Memory section
- [ ] T039 [US4] Verify Selection Assistant per quickstart.md Scenario 5: select text in any app, trigger the Selection Assistant, choose "Summarize", confirm AI response is returned correctly with no console errors

---

## Phase 7: Polish

**Purpose**: Automated reference validation and commit.

- [X] T040 Run automated dead-reference checks per quickstart.md Scenario 7 to satisfy SC-004 and SC-006. All of the following must return zero matches:
  - `rg "setNotesPath" src/renderer/src/store/index.ts` (SC-004: persistor callback removed)
  - `rg "'note/'" src/renderer/src/store/index.ts` (FR-008: syncList cleaned)
  - `rg "memory:" src/preload/index.ts` (FR-007: IPC namespace removed)
  - `rg "from.*store/note" src/renderer/src --include="*.ts" --include="*.tsx" -l` (SC-006: no store/note imports)
  - `rg "from.*store/memory" src/renderer/src --include="*.ts" --include="*.tsx" -l` (SC-006: no store/memory imports)
  - `rg "state\.note" src/renderer/src --include="*.ts" --include="*.tsx" -l` (SC-006: no state.note references)
- [ ] T041 Commit all changes with conventional commit message: `refactor: remove Notes and Memory features (Phase 03)` — stage all modified and deleted files, verify `git status` shows no unintended changes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — run T001 immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — **CRITICAL: blocks all user story phases**
  - T002 must complete before T003 and T004 (T002 removes the import that makes T003/T004 safe to delete)
  - T005 can run after T003/T004 (or in parallel with T003/T004 since it edits a different file — migrate.ts)
- **US2 (Phase 3)**: Depends on Phase 2 — T006–T018 can begin after T002–T005
- **US3 (Phase 4)**: Depends on Phase 2 — T019–T031 can begin after T002–T005 (and can run in parallel with Phase 3 since they touch different files)
- **Shared Cleanups (Phase 5)**: Depends on Phase 3 and Phase 4 being complete (to ensure all context for types/preload edits is known)
- **US4 Verification (Phase 6)**: Depends on all prior phases
- **Polish (Phase 7)**: Depends on Phase 6

### User Story Dependencies

- **US1 (P1)**: No external dependencies — the store fix is self-contained
- **US2 (P1)**: Depends on Phase 2 completing (store/note.ts must be deleted first, which requires store/index.ts to be edited first)
- **US3 (P1)**: Depends on Phase 2 completing (store/memory.ts must be deleted first)
- **US4 (P1)**: Depends on US1, US2, US3 all completing

### Within Each Phase

- All tasks marked [P] within the same phase can run simultaneously
- Tasks without [P] that share a file must run sequentially
- Phase 3 and Phase 4 can run in parallel once Phase 2 is complete (all files are different)

### Parallel Opportunities

```bash
# Phase 2: After T002 completes, these can run in parallel:
T003 Delete store/note.ts
T004 Delete store/memory.ts
T005 Add migration 203 to migrate.ts

# Phase 3: All deletions (T006–T010) can run in parallel
# Phase 3: All consumer edits (T011–T018) can run in parallel

# Phases 3 and 4 can run in parallel with each other
# (all files are different between the two phases)

# Phase 4: All deletions (T019–T025) can run in parallel
# Phase 4: All consumer edits (T026–T031) can run in parallel
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational — US1 Boot Fix (T002–T005)
3. **STOP and VALIDATE**: Run `pnpm dev` — app should boot cleanly
4. If boot is clean, proceed to Phase 3

### Incremental Delivery

1. Phase 2 complete → Boot crash risk eliminated (app works)
2. Phase 3 complete → Notes entirely gone (US2 verified)
3. Phase 4 complete → Memory entirely gone (US3 verified)
4. Phase 5 complete → Shared files cleaned (build clean)
5. Phase 6 complete → Selection Assistant verified functional (US4 passed)
6. Phase 7 complete → Committed and ready for review

---

## Notes

- [P] tasks = different files, no sequential dependency — safe to execute concurrently
- T002 is the highest-risk task: a single atomic edit to `store/index.ts` with 8 distinct changes — read the full file before editing
- The 8 pre-existing test failures (DxtService, process, BackupManager) are expected and do NOT indicate a regression
- `pnpm format` (T034) must run before `pnpm build:check` (T035) to avoid Biome formatting errors masking real TypeScript errors
- i18n key cleanup for notes/memory is explicitly out of scope per spec.md Assumptions — do not remove i18n keys beyond what `label.ts` contains
- Data on disk (notes files, memory SQLite database) is NOT deleted — it simply becomes unreachable
