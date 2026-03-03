# Phase 07: Extract MessageContent & Remove Home/Chat Page

## Overall Product Objective

Transform the full-featured Cherry Studio Electron app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility — a fast, focused tool for AI-powered text actions (summarize, translate, explain, refine, custom prompts) — targeting ~150-200 source files and ~100-130 npm dependencies.

## Phase Goal

Remove the entire Home/Chat page system — the largest single feature in the application. This is the **highest-risk phase** because the `MessageContent` component (deeply nested inside `pages/home/Messages/`) is a shared rendering dependency consumed by the selection action windows. The component must be extracted to a shared location *before* the home page directory can be deleted.

This phase has **two mandatory sub-steps** that must be executed in strict order:
1. Extract `MessageContent` and the Markdown rendering pipeline to a shared location
2. Delete the home page only after extraction succeeds

## Scope

- **Home/Chat page** (`/`) — The main chat interface, conversation management
- **Agents page** (`/agents` or `/store` if not already removed)
- **Topics page** (if it exists as a standalone page)
- **Shared rendering extraction**: `MessageContent.tsx` + `Markdown/` directory → `components/Markdown/`
- **Heavy markdown stripping**: Remove `katex` and `mermaid` imports from extracted components
- **Store slices**: `assistants`, `tabs`
- **Store sync list**: Remove `'assistants/'` from `storeSyncService`
- **`persistReducer` blacklist**: Remove `'tabs'`
- **Default route**: Change from `/` (Home) to `/selection`
- **Cross-consumer fixes**: `ContentSearch.tsx`, `TabContainer.tsx`

## Out of Scope

- Settings page simplification (Phase 09)
- Main process service cleanup (Phase 08)
- Package.json dependency removal for `katex`, `mermaid` (Phase 10)
- Sidebar simplification (Phase 09)

## Dependencies

### Previous Phases
- None — this phase is independently executable. However, executing Phases 01-06 first reduces the number of consumers that import from `pages/home/`, making this phase slightly simpler.

### External Systems
- None.

## Deliverables

1. New shared directory created: `src/renderer/src/components/Markdown/`
2. `MessageContent.tsx` and `Markdown/` rendering pipeline extracted and working from new location
3. Selection action windows (`ActionGeneral.tsx`, `ActionTranslate.tsx`) updated to import from shared location
4. Heavy markdown packages (`katex`, `mermaid`) stripped from extracted components
5. Cross-consumer imports fixed (`ContentSearch.tsx`, `TabContainer.tsx`)
6. Home page directory deleted (entire `pages/home/`)
7. Default route changed from `/` → `/selection`
8. Two Redux store slices removed (`assistants`, `tabs`)
9. `storeSyncService` sync list updated
10. App compiles, runs, and selection assistant AI streaming still works

## Technical Tasks

### Step 1: Extract MessageContent (DO THIS FIRST — stop if it fails)

**1a.** Create directory: `src/renderer/src/components/Markdown/`

**1b.** Copy these files into the new directory:
- `src/renderer/src/pages/home/Messages/MessageContent.tsx`
- `src/renderer/src/pages/home/Messages/Markdown/` (entire directory)
- Any helper files these components import from within `pages/home/Messages/` (trace all local imports)

**1c.** Update all internal import paths in the copied files to reference the new `components/Markdown/` location instead of the old `pages/home/Messages/` paths.

**1d.** Update these consumers to import from the new location:
- `src/renderer/src/windows/selection/action/components/ActionGeneral.tsx` — change `@renderer/pages/home/Messages/MessageContent` → `@renderer/components/Markdown/MessageContent`
- `src/renderer/src/windows/selection/action/components/ActionTranslate.tsx` — same change

**1e.** Strip heavy package imports from extracted markdown components:
- Remove all references to `katex` / `react-katex`
- Remove all references to `mermaid`
- Replace these with simple passthrough or removal (the selection assistant's small floating window does not need math equations or flowcharts)

**1f.** Run verification:
```bash
pnpm build:check
```
**STOP if this fails. Fix all extraction issues before proceeding to Step 2.**

### Step 2: Fix cross-consumers of pages/home/

Before deleting `pages/home/`, fix these files that import from it:

**2a.** `src/renderer/src/components/ContentSearch.tsx` — imports `NarrowLayout` from `pages/home/Messages/`. Options:
- Inline the `NarrowLayout` component into `ContentSearch.tsx`
- Move `NarrowLayout` to `components/` as a shared component
- Remove the import and the functionality that depends on it (if ContentSearch is only used by the chat page)

**2b.** `src/renderer/src/components/Tab/TabContainer.tsx` — imports `UpdateAppButton` from `pages/home/components/`. Options:
- Move `UpdateAppButton` to `components/` as a shared component
- Inline the button code
- Remove the import (if update functionality is being removed)

### Step 3: Remove Home page and chat infrastructure

**3a.** Edit `src/renderer/src/Router.tsx`:
- Remove: `import HomePage from './pages/home/HomePage'`
- Change: `<Route path="/" element={<HomePage />} />` → `<Route path="/" element={<Navigate to="/selection" replace />} />`
- Add: `import { Navigate } from 'react-router-dom'`

**3b.** Edit `src/renderer/src/config/sidebar.ts`:
- Remove `'assistants'` from `DEFAULT_SIDEBAR_ICONS`
- Remove `'assistants'` from `REQUIRED_SIDEBAR_ICONS`

**3c.** Edit `src/renderer/src/store/index.ts`:
- Remove: `import assistants from './assistants'` + its `combineReducers` entry
- Remove: `import tabs from './tabs'` + its `combineReducers` entry
- Remove `'tabs'` from the `persistReducer` `blacklist` array
- Remove `'assistants/'` from `storeSyncService.setOptions({ syncList })`

### Step 4: Delete files and directories

```
rm -rf src/renderer/src/pages/home/
rm -rf src/renderer/src/pages/agents/     (if not already removed)
rm -rf src/renderer/src/pages/topics/     (if exists)
rm -f  src/renderer/src/store/assistants.ts
rm -f  src/renderer/src/store/tabs.ts
rm -f  src/renderer/src/services/TopicService.ts
```

### Step 5: Full verification
```bash
pnpm format && pnpm build:check
pnpm dev
```
Manual test: select text → trigger selection action → verify AI streaming response renders correctly in the action window.

## Acceptance Criteria

- [ ] `pnpm build:check` passes
- [ ] App launches and defaults to `/selection` page (not chat)
- [ ] Selection assistant works end-to-end: select text → toolbar → action window → AI streaming response renders with proper markdown formatting
- [ ] New `src/renderer/src/components/Markdown/` directory exists and contains the extracted components
- [ ] No imports reference `pages/home/` from anywhere in the codebase
- [ ] `pages/home/` directory is completely deleted
- [ ] No references to `katex` or `mermaid` remain in the extracted markdown components
- [ ] `ContentSearch.tsx` and `TabContainer.tsx` compile without errors
- [ ] Sidebar no longer shows "Assistants/Chat" icon

## Clarifications Needed

- **Full dependency tree of `MessageContent`**: The PRD says to copy "any helpers these files import from within `pages/home/Messages/`." A full trace of local imports inside `MessageContent.tsx` and the `Markdown/` directory is needed before extraction. The exact file list may be larger than anticipated.
- **`ContentSearch.tsx` disposition**: The PRD says to "inline, stub, or remove" its import from `pages/home/`. The correct choice depends on whether `ContentSearch` is used by any remaining feature. If it's only used by the chat page, the entire component may be deletable.
- **`TabContainer.tsx` `UpdateAppButton` import**: The PRD doesn't specify whether the update button functionality should be preserved (it relates to `UpdateService` which is flagged for removal in Phase 08). If `UpdateService` is removed, this import can be deleted entirely.
- **`assistants` slice necessity**: The PRD notes this slice may be needed for `getDefaultAssistant()` resolution used by selection code. This must be verified before deletion. If selection code depends on it, the slice must be kept (and its removal deferred to Phase 09's evaluation).

## Summary of Previous Phases

- **Phase 01**: Removed Paintings, Code Tools, OpenClaw, Mini Apps, Launchpad pages.
- **Phase 02**: Removed Knowledge Bases, File Manager, Doc Processing Settings.
- **Phase 03**: Removed Notes, Memory features with persistor callback cleanup.
- **Phase 04**: Removed MCP, Web Search, API Server Settings.
- **Phase 05**: Removed Sync/Backup/Proxy, Data Settings, Agent Store/Presets.
- **Phase 06**: Removed Standalone Translate, Quick Phrase, Quick Assistant, Agent Settings, Copilot.

## Next Phase Preview

**Phase 08: Clean Main Process Services & Preload Script** is a safety-net sweep phase. It removes any remaining main process backend services and preload API namespaces that belong to features deleted in Phases 01-07 but whose backend counterparts were not yet cleaned up. This is a low-risk infrastructure-level cleanup.
