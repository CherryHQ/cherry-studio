# Feature Specification: Remove MCP & Web Search Features

**Feature Branch**: `004-remove-mcp-websearch`
**Created**: 2026-03-04
**Status**: Draft
**Input**: User description: "Remove MCP and WebSearch features from Quick Selection Assistant (Phase 04 of app-trimming)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - App Compiles and Runs Clean (Priority: P1)

A developer trimming the Quick Selection Assistant app needs the application to build and launch successfully after the MCP, Web Search, and API Server features are removed — with zero compilation errors and no runtime crashes.

**Why this priority**: If the app does not build or run, no other functionality can be verified. This is the foundational check for the entire phase.

**Independent Test**: Can be fully tested by running the build verification command and launching the app, which delivers a deployable application state.

**Acceptance Scenarios**:

1. **Given** the MCP, Web Search, and API Server code has been removed, **When** `pnpm build:check` runs (lint + typecheck + all tests), **Then** it exits with code 0 — zero TypeScript errors, zero lint errors, all tests pass.
2. **Given** the build passes, **When** the application is launched via `pnpm dev`, **Then** it starts without runtime errors, the main window appears, and no console errors referencing deleted modules are logged in the renderer DevTools.

---

### User Story 2 - Settings Page No Longer Shows Removed Sections (Priority: P1)

An end user opening the Settings page of the Quick Selection Assistant should not see the MCP Server Management, Web Search Provider Configuration, or API Server sections — they have no relevance in the simplified tool.

**Why this priority**: Removing dead UI is the primary visible outcome of this phase. Leaving orphaned menu items would confuse users and indicate an incomplete removal.

**Independent Test**: Can be fully tested by navigating to Settings and confirming no MCP, Web Search, or API Server entries appear in the navigation menu.

**Acceptance Scenarios**:

1. **Given** the application is running, **When** a user opens the Settings page, **Then** no MCP, Web Search, or API Server menu items are displayed.
2. **Given** the settings navigation no longer has these items, **When** a user inspects the settings sidebar, **Then** there are no orphaned dividers or blank spaces where those items used to appear.
3. **Given** a user attempts to navigate directly to a removed settings route (e.g., `/settings/mcp`, `/settings/websearch`, `/settings/api-server`), **Then** the application handles the navigation gracefully — rendering a blank/empty content area or redirecting to a valid settings route — without crashing or logging an unhandled error.

---

### User Story 3 - Selection Assistant Continues Working (Priority: P1)

A user relying on the Quick Selection Assistant for text actions (summarize, translate, explain, refine, and browser-based search) must continue to experience all those actions working correctly, unaffected by the removal of the AI-powered Web Search and MCP features.

**Why this priority**: The Selection Assistant is the core product. Any regression in its functionality directly breaks the primary use case.

**Independent Test**: Can be fully tested by triggering each selection action (including the browser-URL-open search action) and confirming expected results.

**Acceptance Scenarios**:

1. **Given** the app is running, **When** a user selects text and triggers the summarize, translate, explain, or refine actions, **Then** each action produces the expected AI-powered result.
2. **Given** the app is running, **When** a user triggers the "search" action on selected text, **Then** the system opens a browser window with a Google search URL constructed from the selected text.
3. **Given** the Web Search AI integration code has been removed, **When** the user uses the browser-search action, **Then** there is no error — because this action is independent of the removed AI search providers.

---

### Edge Cases

- What happens if a persisted application state (from a previous session) references the removed MCP, Web Search, or Tool Permissions state slices? The app must load without crashing — redux-persist silently ignores unknown slice keys during rehydration, so no migration step is required. Pass condition: main window appears, no uncaught exceptions.
- What happens if any remaining settings sections referenced shared UI components that were exclusively used by the removed sections? Specifically: the `<Divider />` between the Data Settings group and the MCP menu group must be removed; the `<Divider />` before the Quick Phrase section must be retained. Icon imports `McpLogo`, `Search`, and `Server` must be removed entirely.
- What happens if any code path outside of Settings references the removed services or state slices? All such cross-references (identified in `hooks/`, `aiCore/`, `pages/home/`) must be resolved — imports deleted and dependent logic removed. The build MUST pass even if this causes Chat-page features to degrade (per Q1 clarification: degradation of future-removal features is acceptable as long as `pnpm build:check` succeeds).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Settings page MUST NOT display menu items, routes, or orphaned UI elements for MCP Server Management, Web Search Provider Configuration, or API Server.
- **FR-002**: The application MUST pass `pnpm build:check` (which runs lint, TypeScript typecheck, and all Vitest tests) with exit code 0 after all MCP, Web Search, and API Server code is removed — including resolution of all TypeScript cross-references to deleted modules.
- **FR-003**: The application MUST launch and remain stable at runtime after the removal — defined as: the main window appears, no uncaught exceptions are thrown on startup, and no renderer console errors referencing deleted modules are logged.
- **FR-004**: The Selection Assistant's browser-URL-based search action (opens `google.com/search?q=[text]` in the system browser) MUST remain fully functional and unaffected by the removal.
- **FR-005**: All Selection Assistant AI actions — summarize, translate, explain, and refine — MUST remain fully functional and continue to return AI-powered results.
- **FR-006**: The application's Redux store MUST NOT include reducer slices for MCP, Web Search, or Tool Permissions after the removal. Specifically, these three slices must be absent from `combineReducers`.
- **FR-007**: The `persistReducer` blacklist array in `src/renderer/src/store/index.ts` MUST be updated so that `'toolPermissions'` is no longer listed — the array must retain only: `'runtime'`, `'messages'`, `'messageBlocks'`, `'tabs'`.
- **FR-008**: The preload IPC bridge MUST NOT expose the following namespaces after the removal: `mcp`, `searchService`, `agentTools`, `apiServer`. All associated TypeScript type imports that become unused after block removal must also be deleted.
- **FR-009**: The following main-process service files MUST be deleted: `src/main/services/MCPService.ts` (MCP server process manager) and `src/main/services/SearchService.ts` (hidden-browser web scraper). The file `src/main/services/ApiServerService.ts` is explicitly RETAINED; only its initialization block in `src/main/index.ts` and its preload namespace (`api.apiServer`) are removed.
- **FR-010**: All orphaned UI elements associated solely with the removed settings sections MUST be removed from `src/renderer/src/pages/settings/SettingsPage.tsx`. This includes: the `McpLogo` icon import, the `Search` and `Server` lucide-react icon imports, the `<Divider />` immediately above the MCP menu group (between Data Settings and the MCP group), and the three `<MenuItemLink>` blocks for `/settings/mcp`, `/settings/websearch`, and `/settings/api-server`.
- **FR-011**: The following i18n key subtrees MUST be removed from all three locale files (`src/renderer/src/i18n/locales/en-us.json`, `zh-cn.json`, `zh-tw.json`): the entire `settings.mcp` subtree, the `settings.tool.websearch` subtree, and the top-level `apiServer` key. After key removal, `pnpm i18n:sync` MUST be run to re-synchronize the i18n template and confirm locale consistency.
- **FR-012**: All TypeScript cross-references to deleted modules in files outside of the Settings directory MUST be resolved. This includes imports from the deleted store slices in: `src/renderer/src/hooks/useAppInit.ts`, `src/renderer/src/aiCore/utils/websearch.ts`, `src/renderer/src/aiCore/prepareParams/parameterBuilder.ts`, and any other files in `src/` that import from `store/mcp`, `store/websearch`, or `store/toolPermissions`. Exclusive wrapper hooks (`hooks/useMCPServers.ts`, `hooks/useWebSearchProviders.ts`) and test files that test deleted utilities must also be deleted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm build:check` exits with code 0 — zero TypeScript errors, zero lint errors, all Vitest tests pass.
- **SC-002**: The application launches via `pnpm dev`, the main window renders, and zero errors referencing deleted modules appear in the renderer DevTools console (main-process logs are excluded from this criterion).
- **SC-003**: The Settings sidebar contains zero menu items and zero routes for MCP, Web Search, or API Server — verified by manual navigation through all settings sections; no orphaned dividers or blank spaces appear where removed items were.
- **SC-004**: All five Selection Assistant actions execute correctly in a manual smoke test — success defined per action: (a) summarize/translate/explain/refine: an AI-generated result is returned and displayed without error; (b) browser-search: the system browser opens with a `google.com/search?q=[selected text]` URL.
- **SC-005**: On first launch after the removal, if a prior app data directory contains state referencing removed slices (`mcp`, `websearch`, `toolPermissions`), the app loads without crashing — defined as: main window appears within normal startup time and no uncaught exceptions are thrown.
- **SC-006**: The total number of deleted source files matches the count of files listed for deletion in tasks.md Phase 2 (16 files + 3 directories) — approximately 15–20 files removed total.

## Clarifications

### Session 2026-03-04

- Q: Are features scheduled for future-phase removal (e.g., Chat) allowed to have degraded or broken MCP-dependent behaviour after this phase? → A: Yes — features slated for later removal may degrade; the Selection Assistant is the only quality gate for this phase.
- Q: Should orphaned i18n translation keys for the removed settings sections be cleaned up as part of this phase? → A: Yes — remove orphaned i18n keys for the deleted settings sections as part of this phase.

## Assumptions

- The Selection Assistant's "search" action performs a simple browser URL open (e.g., `google.com/search?q=...`) and has no dependency on the AI-powered Web Search providers being removed. This is confirmed in the Phase 04 documentation.
- Code in `aiCore/`, `hooks/`, and `pages/home/` does reference the deleted store slices (mcp, websearch, toolPermissions). These cross-references are intentionally included in the removal scope under FR-012 and tasks T036–T039. The build will not pass without cleaning these up.
- Persisted state from previous sessions that references removed slices will be ignored at load time by redux-persist's built-in rehydration behavior (unknown keys are silently dropped), without requiring an explicit migration step.
- The `@modelcontextprotocol/*` npm package removal is out of scope for this phase (deferred to Phase 10).
- The `src/main/services/ApiServerService.ts` file itself is retained in this phase — only its startup/shutdown calls in `src/main/index.ts` and its preload namespace (`api.apiServer.*`) are removed. Full removal is deferred to a later phase.
- Sync, Backup, Proxy, and other features slated for later phases are not touched in this phase.
- Features scheduled for removal in future phases (e.g., Chat with MCP tool calls) are permitted to have degraded or broken functionality after this phase. The Selection Assistant is the sole quality gate; no obligation exists to keep future-removal features operational.
- Phase 2 file deletions MUST be completed before any Phase 3+ editing tasks begin, because the editing tasks remove imports of the deleted files (importing a deleted file would otherwise still compile until the import is removed).
