# Implementation Plan: Remove Notes & Memory Features (Phase 03)

**Branch**: `003-remove-notes-memory` | **Date**: 2026-03-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-remove-notes-memory/spec.md`

## Summary

Remove the Notes note-taking system and the Conversation Memory feature from the Quick Selection Assistant app. The critical risk is a Redux Persist boot callback in `store/index.ts` that reads `state.note.notesPath` on every app launch — this callback must be removed in the same change as the `note` store slice, or the app crashes on startup. Memory removal has a broader blast radius than the phase doc describes, requiring cleanup across the AI search pipeline, app init hooks, and assistant settings.

The approach is: audit first (done), then delete files top-down (pages → services → hooks → store), then clean up consumers (router → sidebar → settings → AI pipeline → preload), and finally verify build and boot.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: React 19, Redux Toolkit, Redux Persist, Electron 40.6.1
**Storage**: Redux Persist (localStorage) for UI state; SQLite for memory data (main process)
**Testing**: Vitest (pnpm test:main / pnpm test:renderer)
**Target Platform**: Windows/macOS/Linux desktop (Electron)
**Project Type**: Desktop application (Electron + React renderer)
**Performance Goals**: App boot under 5 seconds; no regression in Selection Assistant latency
**Constraints**: Zero new TypeScript errors; 8 pre-existing test failures are acceptable; no data migration required
**Scale/Scope**: ~14 files/directories deleted; ~18 files edited; store version bumped 202→203

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Keep it clear | PASS | Deletions are straightforward; edited files get cleaner |
| Match house style | PASS | Following same pattern as Phase 01 and Phase 02 |
| Log centrally | PASS | No new logging added; removed logging goes with the service |
| Lint + test + format before completion | REQUIRED | `pnpm format && pnpm build:check` required before commit |
| Write conventional commits | REQUIRED | Use `refactor:` prefix for feature removal commits |
| Always propose before executing | N/A | This is the planning artifact; execution requires user approval |

No constitution violations. No complexity justification table required.

## Project Structure

### Documentation (this feature)

```text
specs/003-remove-notes-memory/
├── plan.md          # This file
├── research.md      # Codebase audit findings and decisions
├── data-model.md    # Entities removed and migration plan
├── quickstart.md    # Verification scenarios
└── tasks.md         # Task breakdown (/speckit.tasks output — not yet created)
```

### Source Code — Files to Delete

```text
src/renderer/src/pages/notes/                         # Notes UI — entire directory
src/renderer/src/pages/settings/MemorySettings/       # Memory Settings UI — entire directory
src/renderer/src/store/note.ts                        # Note Redux slice
src/renderer/src/store/memory.ts                      # Memory Redux slice
src/renderer/src/services/NotesService.ts             # Renderer notes service
src/renderer/src/services/MemoryService.ts            # Renderer memory service
src/renderer/src/services/MemoryProcessor.ts          # AI memory extraction processor
src/main/services/memory/                             # Main process memory service — entire directory
src/renderer/src/hooks/useNotesQuery.ts               # Notes selector hook
src/renderer/src/hooks/useNotesSettings.ts            # Notes settings hook
src/renderer/src/hooks/useShowWorkspace.ts            # Notes workspace hook
src/renderer/src/aiCore/tools/MemorySearchTool.ts     # Memory search AI tool
src/renderer/src/pages/home/Messages/Tools/MessageMemorySearch.tsx  # Memory search message UI
src/renderer/src/pages/settings/AssistantSettings/AssistantMemorySettings.tsx  # Per-assistant memory settings
```

### Source Code — Files to Edit

```text
src/renderer/src/Router.tsx                               # Remove /notes route
src/renderer/src/config/sidebar.ts                        # Remove 'notes' from DEFAULT_SIDEBAR_ICONS
src/renderer/src/store/index.ts                           # CRITICAL: remove note/memory reducers, syncList, persistor block; bump to 203
src/renderer/src/store/migrate.ts                         # Add migration 203
src/renderer/src/pages/settings/SettingsPage.tsx          # Remove MemorySettings import, menu item, route
src/main/utils/lifecycle.ts                               # Remove MemoryService import and .close() call
src/preload/index.ts                                      # Remove memory: namespace; remove validateNotesDirectory
src/renderer/src/aiCore/plugins/searchOrchestrationPlugin.ts  # Remove all memory logic
src/renderer/src/hooks/useAppInit.ts                      # Remove MemoryService initialization
src/renderer/src/pages/settings/AssistantSettings/index.tsx  # Remove AssistantMemorySettings
src/renderer/src/pages/home/Messages/Tools/MessageTool.tsx   # Remove memory_search case
src/renderer/src/utils/export.ts                          # Remove exportMessageToNotes, exportTopicToNotes
src/renderer/src/pages/home/Messages/MessageMenubar.tsx   # Remove notes export menu items
src/renderer/src/pages/home/Tabs/components/Topics.tsx    # Remove notes export menu items
src/renderer/src/types/index.ts                           # Remove 'notes' from SidebarIcon; remove enableMemory
src/renderer/src/i18n/label.ts                            # Remove notes label entries
src/renderer/src/pages/settings/DisplaySettings/SidebarIconsManager.tsx  # Remove notes from icon map
src/main/ipc.ts                                           # Remove File_ValidateNotesDirectory handler
```

## Implementation Phases

### Phase 1: Delete Files and Directories

Delete in this order (pages first, then services/tools, then hooks, then store slices — following consumer → provider direction):

1. `src/renderer/src/pages/notes/` (entire directory)
2. `src/renderer/src/pages/settings/MemorySettings/` (entire directory)
3. `src/renderer/src/pages/settings/AssistantSettings/AssistantMemorySettings.tsx`
4. `src/renderer/src/pages/home/Messages/Tools/MessageMemorySearch.tsx`
5. `src/renderer/src/aiCore/tools/MemorySearchTool.ts`
6. `src/renderer/src/services/MemoryProcessor.ts`
7. `src/renderer/src/services/MemoryService.ts`
8. `src/renderer/src/services/NotesService.ts`
9. `src/main/services/memory/` (entire directory)
10. `src/renderer/src/hooks/useNotesQuery.ts`
11. `src/renderer/src/hooks/useNotesSettings.ts`
12. `src/renderer/src/hooks/useShowWorkspace.ts`
13. `src/renderer/src/store/note.ts`
14. `src/renderer/src/store/memory.ts`

### Phase 2: Edit Consumer Files (Router / Sidebar / Settings)

1. **`Router.tsx`**: Remove `import NotesPage` and `<Route path="/notes">`.
2. **`sidebar.ts`**: Remove `'notes'` from `DEFAULT_SIDEBAR_ICONS` array.
3. **`SettingsPage.tsx`**: Remove `import MemorySettings`, the Memory `<MenuItemLink>` block, and the `<Route path="memory">`.
4. **`SidebarIconsManager.tsx`**: Remove `notes: <NotepadText size={16} />` from the icon map.
5. **`i18n/label.ts`**: Remove `notes` entries from the label map.
6. **`types/index.ts`**: Remove `'notes'` from `SidebarIcon` union; remove `enableMemory?: boolean` from `Assistant` interface.

### Phase 3: Edit Store (CRITICAL)

**`store/index.ts`** — Multiple changes, must be atomic:
1. Remove `import { setNotesPath } from './note'`
2. Remove `import note from './note'`
3. Remove `import memory from './memory'`
4. Remove `note,` from `combineReducers({...})`
5. Remove `memory,` from `combineReducers({...})`
6. Remove `'note/'` from `storeSyncService.setOptions({ syncList: [...] })`
7. Bump `version` from `202` to `203`
8. **CRITICAL**: Remove the entire `setNotesPath` block from the `persistor` callback (see research.md Decision 1 for exact block)

**`store/migrate.ts`** — Add migration 203:
```typescript
203: (state: any) => {
  delete state.note
  delete state.memory
  if (Array.isArray(state.settings?.sidebarIcons)) {
    state.settings.sidebarIcons = state.settings.sidebarIcons.filter(
      (icon: string) => icon !== 'notes'
    )
  }
  return state
}
```

### Phase 4: Edit Backend and IPC Files

1. **`lifecycle.ts`**: Remove `import MemoryService from '../services/memory/MemoryService'` and remove `MemoryService.getInstance().close()` from the close array.
2. **`ipc.ts`**: Remove the `ipcMain.handle(IpcChannel.File_ValidateNotesDirectory, ...)` handler block.
3. **`preload/index.ts`**: Remove the entire `memory:` namespace block (~12 IPC mappings). Remove `validateNotesDirectory` from the `file:` namespace.

### Phase 5: Edit AI Pipeline and Hook Files

1. **`searchOrchestrationPlugin.ts`**: Remove all imports and logic related to `selectGlobalMemoryEnabled`, `selectMemoryConfig`, `MemoryProcessor`, `memorySearchTool`. Remove `storeConversationMemory` call in the `onFinish` middleware and the `memorySearchTool` injection into the tools array.
2. **`useAppInit.ts`**: Remove `import MemoryService` and the `MemoryService.getInstance()` initialization call.
3. **`AssistantSettings/index.tsx`**: Remove `import AssistantMemorySettings` and its JSX usage.
4. **`MessageTool.tsx`**: Remove `import { MessageMemorySearchToolTitle }` and the `case 'memory_search':` block in `ChooseTool`.

### Phase 6: Edit Export and Topic Files

1. **`export.ts`**: Remove `exportMessageToNotes` and `exportTopicToNotes` functions and the `addNote` import.
2. **`MessageMenubar.tsx`**: Remove the notes export menu item, `useNotesSettings` import/usage, and `notesPath` references.
3. **`Topics.tsx`**: Remove the notes export menu item, `useNotesSettings` import/usage, and `notesPath` references.

### Phase 7: Verify

```bash
pnpm format
pnpm build:check
# Then manual: pnpm dev — verify boot without crash
```

## Key Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Forgetting to remove the persistor callback (boot crash) | Phase 3 makes this atomic — store/index.ts edit covers all note references in one pass |
| Missing a consumer of `useNotesSettings` outside pages/notes | Research confirmed only MessageMenubar and Topics — both are in Phase 6 |
| Partial memory cleanup leaving broken imports | Phase 4 and 5 are sequenced to clean all consumers before the store slice is gone (Phase 3) |
| Breaking `searchOrchestrationPlugin.ts` partially | Read the full file before editing; remove the memory-specific conditional blocks while preserving non-memory search logic |
| Migration 203 not matching current state shape | data-model.md documents exact state shape; migration uses optional chaining for safety |

## Acceptance Criteria

- [ ] `pnpm build:check` passes with zero new errors (8 pre-existing failures remain only)
- [ ] App launches with `pnpm dev` without boot crash
- [ ] Sidebar shows no Notes icon
- [ ] Settings shows no Memory section
- [ ] `/notes` URL shows blank/404, no crash
- [ ] `/settings/memory` URL shows blank/404, no crash
- [ ] `store/index.ts` has no reference to `setNotesPath`
- [ ] `store/index.ts` has no `'note/'` in syncList
- [ ] Store version is `203`
- [ ] Migration 203 exists in `store/migrate.ts`
- [ ] Selection Assistant completes a text action end-to-end
