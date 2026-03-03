# Phase 03: Remove Notes & Memory Features

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Remove the Notes system and Conversation Memory features. This phase requires special care because the `note` Redux slice has a **runtime cross-dependency** in the store's `persistor` callback — a block of code that reads `state.note.notesPath` on every app boot. Removing the slice without removing this callback causes the app to crash immediately on startup.

## Scope

- **Notes page** (`/notes`) — Note-taking UI
- **Memory Settings** (`/settings/memory`) — Conversation memory configuration
- **Backend services**: `NotesService`, `MemoryService`
- **Renderer service**: `MemoryService.ts`
- **Store slices**: `note`, `memory`
- **Store sync list**: Remove `'note/'` from `storeSyncService.setOptions()`
- **Persistor callback**: Remove the `setNotesPath` initialization block
- **Preload namespace**: `api.memory.*`

## Out of Scope

- Knowledge & Files (Phase 02)
- MCP, Web Search (Phase 04)
- Home/Chat page (Phase 07)
- i18n key cleanup for notes/memory (Phase 10)

## Dependencies

### Previous Phases
- None — this phase is independently executable.

### External Systems
- None.

## Deliverables

1. Notes page directory deleted
2. Memory Settings directory deleted
3. Two Redux store slices removed (`note`, `memory`) with safe persistor callback cleanup
4. `storeSyncService` sync list updated (removed `'note/'`)
5. Two main process services deleted
6. One renderer service deleted
7. Memory Settings sub-route removed from SettingsPage
8. Preload namespace removed
9. App compiles, runs, and boots without crash

## Technical Tasks

### 1. Edit `src/renderer/src/Router.tsx`
Remove import:
- `import NotesPage from './pages/notes/NotesPage'`

Remove route:
- `<Route path="/notes" element={<NotesPage />} />`

### 2. Edit `src/renderer/src/config/sidebar.ts`
Remove from `DEFAULT_SIDEBAR_ICONS`: `'notes'`

### 3. Edit `src/renderer/src/store/index.ts` (CRITICAL — multiple edits)

**3a.** Remove imports:
- `import { setNotesPath } from './note'`
- `import note from './note'`
- `import memory from './memory'`

**3b.** Remove from `combineReducers({})`:
- `note,`
- `memory,`

**3c.** Remove `'note/'` from `storeSyncService.setOptions({ syncList: [...] })`.

**3d. CRITICAL** — Remove the entire `setNotesPath` block inside the `persistor` callback (the `persistStore` third argument). This block reads `state.note.notesPath` and will crash if the `note` slice is removed. Delete:
```typescript
// Initialize notes path after rehydration if empty
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
Keep the remaining code in the callback (`window.electron?.ipcRenderer?.invoke(IpcChannel.ReduxStoreReady)` and the logger call).

### 4. Edit `src/renderer/src/pages/settings/SettingsPage.tsx`
- Remove import: `import MemorySettings from './MemorySettings'`
- Remove menu item block for `/settings/memory` (the `<MenuItemLink>` wrapping the Brain icon)
- Remove route: `<Route path="memory" element={<MemorySettings />} />`

### 5. Edit `src/main/index.ts`
Remove initialization and cleanup calls for:
- `NotesService`
- `MemoryService`

### 6. Edit `src/preload/index.ts`
Remove API namespace: `api.memory.*`

### 7. Delete files and directories
```
rm -rf src/renderer/src/pages/notes/
rm -rf src/renderer/src/pages/settings/MemorySettings/
rm -f  src/renderer/src/store/note.ts
rm -f  src/renderer/src/store/memory.ts
rm -f  src/renderer/src/services/MemoryService.ts
rm -f  src/main/services/NotesService.ts
rm -f  src/main/services/MemoryService.ts
```

### 8. Verify
```bash
pnpm format && pnpm build:check
pnpm dev   # CRITICAL: verify the app boots without crash (persistor callback fix)
```

## Acceptance Criteria

- [ ] `pnpm build:check` passes
- [ ] App launches with `pnpm dev` **without boot crash** (this is the key risk for this phase)
- [ ] `/notes` URL shows blank/404 — no crash
- [ ] Settings page no longer shows "Memory" menu item
- [ ] Sidebar no longer shows Notes icon
- [ ] `storeSyncService` sync list no longer includes `'note/'`
- [ ] No references to `setNotesPath` remain in `store/index.ts`
- [ ] Selection Assistant still functions correctly

## Clarifications Needed

- **`state.note.notesPath` consumer audit**: The PRD identifies the `persistor` callback as the only runtime cross-dependency. Verify there are no other files outside of `pages/notes/` that read from `state.note` before deleting.

## Summary of Previous Phases

- **Phase 01**: Removed Paintings, Code Tools, OpenClaw, Mini Apps, and Launchpad pages with their store slices and sidebar entries.
- **Phase 02**: Removed Knowledge Bases, File Manager, Doc Processing Settings with their backend/renderer services and preload namespaces.

## Next Phase Preview

**Phase 04: Remove MCP & Web Search Features** will remove the MCP Server Management system, AI-powered Web Search settings, and API Server settings. This is another clean vertical slice — the selection assistant's "search" action uses a simple browser URL open, completely independent from the WebSearch AI providers.
