# Quickstart: Verify Phase 03 Removal (Notes & Memory)

## Prerequisites

- Phase 03 implementation complete (all deletions and edits applied)
- `pnpm format` has been run to auto-format changed files
- `pnpm build:check` passes (zero new errors vs Phase 02 baseline)

---

## Verification Scenario 1: App Boots Without Crash (P1 — Critical)

**Purpose**: Confirms the persistor callback boot-crash risk has been resolved.

### Steps

1. Run `pnpm dev` to launch the app in development mode.
2. Watch the terminal output for any errors during startup.
3. Observe the app UI — it should reach the main chat view.
4. Open DevTools (`Ctrl+Shift+I`) → Console tab.
5. Check for any error messages.

### Expected Result

- App starts fully within 5 seconds.
- No error dialogs appear.
- No console errors referencing `state.note`, `notesPath`, or missing store slices.
- The `Redux store is ready` IPC message fires successfully.

### Failure Indicators

- App shows a blank white screen or crash dialog — indicates the persistor callback was not removed.
- Console error: `Cannot read properties of undefined (reading 'notesPath')` — persistor block still present.
- Console error about missing reducer — slice was removed but combineReducers reference remains.

---

## Verification Scenario 2: Notes Icon Gone from Sidebar (P1)

**Purpose**: Confirms the Notes navigation entry point is removed.

### Steps

1. Launch the app (`pnpm dev`).
2. Inspect the left sidebar icons.
3. Look for a notebook/notes icon — it should not be present.
4. Navigate to `/notes` URL manually via DevTools console: `window.location.hash = '#/notes'` or equivalent.

### Expected Result

- No Notes icon is visible in the sidebar.
- Navigating to `/notes` shows a blank/404 state — **not a crash or error overlay**.

---

## Verification Scenario 3: Memory Settings Absent (P1)

**Purpose**: Confirms the Memory configuration UI is removed from Settings.

### Steps

1. Launch the app.
2. Open Settings (gear icon or keyboard shortcut).
3. Inspect the Settings navigation menu — look for a "Memory" entry.
4. Navigate to the Memory settings URL: `window.location.hash = '#/settings/memory'`.

### Expected Result

- No "Memory" item appears in the Settings navigation.
- Navigating to the memory settings URL shows a blank/404 state — no crash.

---

## Verification Scenario 4: Assistant Settings Has No Memory Section (P1)

**Purpose**: Confirms AssistantMemorySettings is removed from Assistant configuration.

### Steps

1. Open any assistant's settings panel.
2. Inspect the settings tabs/sections — look for "Memory" or memory-related controls.

### Expected Result

- No memory toggle or memory configuration section appears in assistant settings.

---

## Verification Scenario 5: Selection Assistant Still Works (P1 — Core Feature)

**Purpose**: Confirms the core product feature is unaffected by removals.

### Steps

1. Open any text-editable or readable application (e.g., a browser with text).
2. Select a paragraph of text.
3. The Selection Assistant popup should appear.
4. Click "Summarize" (or any available action).
5. Wait for the AI response.

### Expected Result

- The action window opens.
- The AI processes the text and returns a result.
- No errors appear in the console related to missing memory or notes modules.

---

## Verification Scenario 6: Build Check Passes (SC-003)

**Purpose**: Confirms zero new TypeScript/lint errors introduced.

### Steps

```bash
pnpm format
pnpm build:check
```

### Expected Result

- `pnpm format` runs without error.
- `pnpm build:check` completes with the same failures as the Phase 02 baseline (8 pre-existing test failures in 3 unrelated test files). Zero new errors.

---

## Verification Scenario 7: No Remaining Store References (SC-004, SC-006)

**Purpose**: Automated check that no dead references remain.

### Steps

Run these searches from the repo root — each should return zero matches in active source files:

```bash
# Should find NO matches in active source (store/migrate.ts old entries are acceptable)
rg "state\.note\." src/renderer/src --include="*.ts" --include="*.tsx" -l

# Should find NO matches outside deleted directories
rg "from.*store/note" src/renderer/src --include="*.ts" --include="*.tsx" -l
rg "from.*store/memory" src/renderer/src --include="*.ts" --include="*.tsx" -l

# Should find NO setNotesPath in store/index.ts
rg "setNotesPath" src/renderer/src/store/index.ts

# Should find NO 'note/' in storeSyncService
rg "'note/'" src/renderer/src/store/index.ts

# Should find NO memory namespace in preload
rg "memory:" src/preload/index.ts
```

### Expected Result

- All searches return zero matches (or zero matches in the store/index.ts and preload checks specifically).
