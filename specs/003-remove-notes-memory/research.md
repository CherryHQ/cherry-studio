# Research: Remove Notes & Memory Features (Phase 03)

## Codebase Audit Findings

### Decision 1: Boot-Crash Risk Confirmed — Persistor Callback

- **Decision**: Remove the `setNotesPath` block inside the `persistStore` callback in `store/index.ts` at the same time as removing the `note` slice.
- **Rationale**: Confirmed that `store/index.ts` reads `state.note.notesPath` inside the `persistor` boot callback. If the `note` slice is removed but this callback remains, Redux Persist rehydrates without the `note` key and the property access throws immediately on every app launch. This is a complete startup crash.
- **Exact block to remove** (lines ~82–92 of `store/index.ts`):
  ```typescript
  const state = store.getState()
  if (!state.note.notesPath) {
    setTimeout(async () => {
      try {
        const info = await window.api.getAppInfo()
        store.dispatch(setNotesPath(info.notesPath))
        logger.info('Initialized notes path on startup:', info.notesPath)
      } catch (error) {
        logger.error('Failed to initialize notes path on startup:', error as Error)
      }
    }, 0)
  }
  ```
- **Alternatives considered**: Leaving the callback with a null-guard (`state.note?.notesPath`) — rejected because the entire `note` key is absent after slice removal, making the guard fragile and leaving dead code.

---

### Decision 2: State Migration Version 203 Required

- **Decision**: Add Redux Persist migration `203` in `store/migrate.ts` to strip `state.note`, `state.memory`, and filter `'notes'` from `sidebarIcons`.
- **Rationale**: Current store version is `202`. Users who upgrade from an older version will have `state.note` and `state.memory` in their persisted localStorage. Redux Persist will attempt to rehydrate these into the now-absent slices, which may produce warnings or errors. A migration that strips these keys ensures a clean upgrade path.
- **Migration logic**:
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
- **Alternatives considered**: Skipping migration and relying on the `blacklist` option — rejected because existing persisted state with `note`/`memory` keys would still be written back to storage on next save, polluting the store unnecessarily.

---

### Decision 3: Notes Consumer Audit — Only Two Cross-Boundary References

- **Decision**: Outside of `pages/notes/`, only two files reference `state.note`: `store/index.ts` (the persistor callback) and `store/migrate.ts` (old migration entries). Both are handled by this phase.
- **Rationale**: A full `rg` search for `state\.note` and `from.*store/note` confirmed no other renderer files read from the note slice directly. This validates the spec assumption that the persistor callback is the only runtime cross-dependency.
- **Hook files** (`useNotesQuery`, `useNotesSettings`, `useShowWorkspace`) are consumed by `MessageMenubar.tsx` and `Topics.tsx` — these hooks are being deleted, so their consumers need cleanup too. These are **indirect** consumers of the notes system, not direct `state.note` readers.

---

### Decision 4: Memory "Blast Radius" Is Larger Than Phase 03 Doc Lists

- **Decision**: Delete `MemoryProcessor.ts`, `AssistantMemorySettings.tsx`, `MessageMemorySearch.tsx`, and the renderer `MemoryService.ts` in addition to what the Phase 03 doc specifies. Edit `searchOrchestrationPlugin.ts`, `useAppInit.ts`, `MessageTool.tsx`, and `AssistantSettings/index.tsx` as additional consumer cleanup.
- **Rationale**: A grep for `store/memory` and `MemoryService` revealed these additional consumers beyond the MemorySettings page:
  - `searchOrchestrationPlugin.ts` — imports `selectGlobalMemoryEnabled`, `selectMemoryConfig`, `MemoryProcessor`, `memorySearchTool`; injects memory search into AI pipeline
  - `useAppInit.ts` — initializes `MemoryService.getInstance()` on app start
  - `AssistantMemorySettings.tsx` — embedded in `AssistantSettings/index.tsx`
  - `MessageMemorySearch.tsx` — renders memory search tool UI in chat
  - `MessageTool.tsx` — has `case 'memory_search':` dispatch
  - `MemoryProcessor.ts` — processes AI responses to extract memories
- **Alternatives considered**: Stubbing memory functions to return empty results — rejected because it adds complexity and leaves dead code; cleaner to remove entirely.

---

### Decision 5: Notes Export Functions Must Be Removed from export.ts

- **Decision**: Remove `exportMessageToNotes` and `exportTopicToNotes` from `src/renderer/src/utils/export.ts`, and remove their callers in `MessageMenubar.tsx` and `Topics.tsx`.
- **Rationale**: These functions call `NotesService.addNote()` from the renderer notes service. With `NotesService.ts` deleted, these calls would produce build errors. The export functions are exclusively used for notes functionality with no shared purpose.
- **Alternatives considered**: Making these functions no-ops — rejected; dead export functions add noise with no benefit.

---

### Decision 6: ValidateNotesDirectory IPC Handler Must Be Removed

- **Decision**: Remove `ipcMain.handle(IpcChannel.File_ValidateNotesDirectory, ...)` from `src/main/ipc.ts` and remove `validateNotesDirectory` from `src/preload/index.ts`.
- **Rationale**: This IPC handler is only ever called by `NotesSettings.tsx` inside `pages/notes/`, which is being deleted. The IPC channel constant itself lives in a shared enums file and can stay (removing unused constants is out of scope for this phase).
- **Alternatives considered**: Keeping the handler as a no-op — rejected; dead IPC handlers add surface area without benefit.

---

### Decision 7: SidebarIconsManager and Types Cleanup

- **Decision**: Remove `'notes'` from the `SidebarIcon` union type in `types/index.ts` and remove the notes entry from `SidebarIconsManager.tsx`'s icon map.
- **Rationale**: `SidebarIconsManager` renders the drag-and-drop sidebar icon configurator in Display Settings. Leaving `'notes'` in the icon map would show a broken/non-functional notes icon option in the sidebar settings UI.
- **Alternatives considered**: Leaving the type and disabling the UI entry — rejected; the type should accurately reflect available sidebar features.

---

### Decision 8: i18n Keys Are Out of Scope

- **Decision**: Do not remove i18n label keys for Notes and Memory in this phase.
- **Rationale**: Phase 03 spec and docs explicitly defer i18n cleanup to Phase 10. Removing i18n keys risks breaking the `pnpm build:check` i18n validation if any remaining files still reference those keys transitively. Deferred removal is safer.
- **Alternatives considered**: Removing all notes/memory i18n keys now — rejected per phase scope boundary.

---

### Decision 9: No Main Process NotesService Exists

- **Decision**: There is no `src/main/services/NotesService.ts` to delete. Notes backend operations in the main process are handled by `FileStorage` methods (e.g., `validateNotesDirectory`) accessed via IPC, not a dedicated service class.
- **Rationale**: Phase 03 doc mentions "NotesService (main process)" but a file search found no such file. The renderer-side `src/renderer/src/services/NotesService.ts` does exist and must be deleted. The main-process IPC handler in `ipc.ts` is the only main-process Notes artifact.
- **Alternatives considered**: N/A — this is a factual finding, not a design choice.

---

### Decision 10: Memory Main Process Service Location

- **Decision**: Delete `src/main/services/memory/` directory (contains `MemoryService.ts`, `queries.ts`, and `embeddings/` subdirectory).
- **Rationale**: The main process memory service is organized in a subdirectory `services/memory/`, not a flat file. It is referenced in `src/main/utils/lifecycle.ts` (`MemoryService.getInstance().close()`) which must be cleaned up.
- **Lifecycle cleanup**: Remove the `MemoryService` import and its `.close()` call from `lifecycle.ts`. Keep all other services in the `closeAllDataConnections` array.
