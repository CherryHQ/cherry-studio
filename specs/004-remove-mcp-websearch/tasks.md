# Tasks: Remove MCP & Web Search Features

**Input**: Design documents from `/specs/004-remove-mcp-websearch/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, frontend-spec.md ✓, testing-strategy.md ✓, quickstart.md ✓

**Artifacts referenced**: research.md, data-model.md, frontend-spec.md, testing-strategy.md, quickstart.md
**Artifacts not present**: api-spec.md (skipped — desktop-app), backend-spec.md (skipped — deletions only), auth-security.md (skipped — N/A), infra.md (skipped — N/A), contracts/ (skipped — no external consumers)

**Tests**: No new test tasks added. Testing is verification-only (`pnpm build:check` gate per testing-strategy.md). Existing test files for deleted utilities are deleted in Phase 2.

**Organization**: Tasks grouped by user story. All three stories are P1; ordered by logical implementation dependency (UI edits → code edits → smoke test).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: Confirm working state before starting any deletions.

- [x] T001 Confirm active branch is `004-remove-mcp-websearch` and working tree is clean (`git status`)
- [x] T002 Confirm project installs and current build passes as baseline: run `pnpm build:check` from `d:/quick-assistant/`

**Checkpoint**: Baseline confirmed — safe to begin file removals

---

## Phase 2: Foundational — File Deletions

**Purpose**: Remove all target files. This must complete before any editing tasks, since edit tasks remove imports of these files.

**⚠️ CRITICAL**: No editing tasks can begin until all deletions in this phase are complete.

DONE [P] Delete settings directory `src/renderer/src/pages/settings/MCPSettings/` (entire directory tree)
DONE [P] Delete settings directory `src/renderer/src/pages/settings/WebSearchSettings/` (entire directory tree)
DONE [P] Delete settings directory `src/renderer/src/pages/settings/ToolSettings/` (entire directory tree)
DONE [P] Delete Redux slice `src/renderer/src/store/mcp.ts`
DONE [P] Delete Redux slice `src/renderer/src/store/websearch.ts`
DONE [P] Delete Redux slice `src/renderer/src/store/toolPermissions.ts`
DONE [P] Delete renderer service `src/renderer/src/services/MCPClientService.ts`
DONE [P] Delete renderer service `src/renderer/src/services/WebSearchService.ts`
DONE [P] Delete main process service `src/main/services/MCPService.ts`
DONE [P] Delete main process service `src/main/services/SearchService.ts`
DONE [P] Delete AI tool `src/renderer/src/aiCore/tools/WebSearchTool.ts`
DONE [P] Delete search provider `src/renderer/src/providers/WebSearchProvider/LocalSearchProvider.ts`
DONE [P] Delete hook `src/renderer/src/hooks/useMCPServers.ts` (exclusively wraps deleted `store/mcp`)
DONE [P] Delete hook `src/renderer/src/hooks/useWebSearchProviders.ts` (exclusively wraps deleted `store/websearch`)
DONE [P] Delete test file `src/renderer/src/aiCore/utils/__tests__/mcp.test.ts` (tests deleted MCP utilities)
DONE [P] Delete test file `src/renderer/src/aiCore/utils/__tests__/websearch.test.ts` (tests deleted WebSearch utilities)

**Checkpoint**: All target files deleted. Begin editing tasks.

---

## Phase 3: User Story 2 — Settings Page No Longer Shows Removed Sections (Priority: P1)

**Goal**: Remove all dead UI from the Settings page — menu items, routes, and orphaned imports for MCP, Web Search, and API Server.

**Independent Test**: Launch `pnpm dev`, open Settings — sidebar must contain no MCP, Web Search, or API Server items; no orphaned dividers.

### Implementation for User Story 2

- [x] T019 [US2] Edit `src/renderer/src/pages/settings/SettingsPage.tsx` — remove import statements: `import { McpLogo } from '@renderer/components/Icons'`, `import MCPSettings from './MCPSettings'`, `import WebSearchSettings from './WebSearchSettings'`, `import { ApiServerSettings } from './ToolSettings/ApiServerSettings'`
- [x] T020 [US2] Edit `src/renderer/src/pages/settings/SettingsPage.tsx` — remove `Search` and `Server` from the lucide-react import destructure (keep all other icons)
- [x] T021 [US2] Edit `src/renderer/src/pages/settings/SettingsPage.tsx` — remove the three `<MenuItemLink>` blocks for `/settings/mcp`, `/settings/websearch`, `/settings/api-server` and the `<Divider />` immediately above the MCP item (between Data Settings and the MCP group)
- [x] T022 [US2] Edit `src/renderer/src/pages/settings/SettingsPage.tsx` — remove the three `<Route>` entries: `path="websearch/*"`, `path="api-server"`, `path="mcp/*"`

**Checkpoint**: Settings page has no MCP/WebSearch/API Server UI. Verifiable via `pnpm dev` after Phase 4 build gate passes.

---

## Phase 4: User Story 1 — App Compiles and Runs Clean (Priority: P1)

**Goal**: Edit all remaining files that reference deleted modules, clean up i18n keys, fix TypeScript cross-references, and achieve a green `pnpm build:check`.

**Independent Test**: `pnpm build:check` exits with code 0.

### Implementation for User Story 1

#### Redux Store

- [x] T023 [US1] Edit `src/renderer/src/store/index.ts` — remove the three imports: `import mcp from './mcp'`, `import websearch from './websearch'`, `import toolPermissions from './toolPermissions'`
- [x] T024 [US1] Edit `src/renderer/src/store/index.ts` — remove `websearch,`, `mcp,`, and `toolPermissions` entries from the `combineReducers({...})` call
- [x] T025 [US1] Edit `src/renderer/src/store/index.ts` — remove `'toolPermissions'` from the `blacklist` array in the `persistReducer` config (blacklist should retain: `'runtime', 'messages', 'messageBlocks', 'tabs'`)

#### Main Process

- [x] T026 [US1] Edit `src/main/index.ts` — remove `import mcpService from './services/MCPService'` and the `await mcpService.cleanup()` call in the app quit/cleanup handler
- [x] T027 [US1] Edit `src/main/index.ts` — remove `import { apiServerService } from './services/ApiServerService'` (if exclusively used by the init block being removed) and the `apiServerService` start/stop initialization block inside `app.whenReady()`

#### Preload Bridge

- [x] T028 [US1] Edit `src/preload/index.ts` — remove the `mcp: { ... }` namespace block from the `api` object (all MCP IPC call wrappers)
- [x] T029 [US1] Edit `src/preload/index.ts` — remove the `searchService: { ... }` namespace block from the `api` object
- [x] T030 [US1] Edit `src/preload/index.ts` — remove the `agentTools: { ... }` namespace block from the `api` object
- [x] T031 [US1] Edit `src/preload/index.ts` — remove the `apiServer: { ... }` namespace block from the `api` object and remove any TypeScript type imports (`GetApiServerStatusResult`, `RestartApiServerStatusResult`, `StartApiServerStatusResult`, `StopApiServerStatusResult`, `MCPServer`, `MCPServerLogEntry`) that become unused after block removal

#### i18n Key Removal

- [x] T032 [P] [US1] Edit `src/renderer/src/i18n/locales/en-us.json` — remove entire `settings.mcp` subtree, `settings.tool.websearch` subtree, and top-level `apiServer` key
- [x] T033 [P] [US1] Edit `src/renderer/src/i18n/locales/zh-cn.json` — remove entire `settings.mcp` subtree, `settings.tool.websearch` subtree, and top-level `apiServer` key
- [x] T034 [P] [US1] Edit `src/renderer/src/i18n/locales/zh-tw.json` — remove entire `settings.mcp` subtree, `settings.tool.websearch` subtree, and top-level `apiServer` key
- [x] T035 [US1] Run `pnpm i18n:sync` to re-synchronize i18n template after locale key removals (depends on T032–T034)

#### Cross-Reference TypeScript Cleanup

- [x] T036 [P] [US1] Edit `src/renderer/src/hooks/useAppInit.ts` — remove `toolPermissions` import and all associated dispatch calls / initialization logic referencing the deleted slice
- [x] T037 [P] [US1] Edit or delete `src/renderer/src/aiCore/utils/websearch.ts` — remove all imports of `CherryWebSearchConfig` from deleted `store/websearch`; delete the file if no remaining content serves non-websearch purposes
- [x] T038 [P] [US1] Edit `src/renderer/src/aiCore/prepareParams/parameterBuilder.ts` — remove `import type { CherryWebSearchConfig } from '@renderer/store/websearch'`, remove `import { setupToolsConfig } from '../utils/mcp'`, remove `import { buildProviderBuiltinWebSearchConfig } from '../utils/websearch'`, and remove all code blocks using these imports
- [x] T039 [US1] Run `pnpm lint` to enumerate all remaining TypeScript errors caused by deleted modules across all of `src/`; for each error in any file (including `src/renderer/src/pages/home/`, `src/renderer/src/aiCore/`, `src/renderer/src/config/`, and test files) that references a deleted module, remove the specific import and its usage (acceptable degradation of Chat-page features per Q1 clarification; re-run `pnpm lint` after each batch of fixes until 0 errors remain)
- [x] T040 [US1] Run `pnpm format` to auto-format all modified files with Biome
- [x] T041 [US1] Run `pnpm build:check` — lint=0, TypeScript=0, i18n=pass, format=pass; 8 pre-existing test failures remain (BackupManager×3, DxtService×3, process.test.ts×2 — unrelated to Phase 04; ApiService MCP tool test skipped as MCP removed)

**Checkpoint**: `pnpm build:check` passes — US1 complete. App is buildable and launchable.

---

## Phase 5: User Story 3 — Selection Assistant Continues Working (Priority: P1)

**Goal**: Confirm the Selection Assistant and all five of its actions remain fully functional after all code removals.

**Independent Test**: All five actions (summarize, translate, explain, refine, browser-search) produce expected results with no console errors.

### Implementation for User Story 3

- [ ] T042 [US3] Run `pnpm dev` and launch the application; verify the main window loads without any console errors referencing deleted modules
- [ ] T043 [US3] Select text in an external application and trigger the Selection Assistant overlay; verify the overlay appears correctly
- [ ] T044 [P] [US3] Test Selection Assistant action: **Summarize** — verify AI-powered result is returned
- [ ] T045 [P] [US3] Test Selection Assistant action: **Translate** — verify AI-powered result is returned
- [ ] T046 [P] [US3] Test Selection Assistant action: **Explain** — verify AI-powered result is returned
- [ ] T047 [P] [US3] Test Selection Assistant action: **Refine** — verify AI-powered result is returned
- [ ] T048 [US3] Test Selection Assistant action: **Search** — verify browser opens with `google.com/search?q=[selected text]` URL (no AI web search involved)

**Checkpoint**: All five Selection Assistant actions verified — US3 complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification checks and confirmation of scope compliance.

- [ ] T049 Visually confirm Settings page sidebar: navigate through all settings items in `pnpm dev` and confirm no MCP, Web Search, or API Server menu items appear and no orphaned dividers are visible (addresses SC-003)
- [ ] T050 Verify persisted state graceful load: if a previous app data directory exists with stale state, confirm app launches without crashes (addresses SC-005)
- [ ] T051 [P] Confirm file deletions: spot-check that `src/renderer/src/pages/settings/MCPSettings/`, `src/main/services/MCPService.ts`, `src/renderer/src/store/mcp.ts` no longer exist (addresses SC-006)
- [ ] T052 [P] Confirm no stray `McpLogo`, `MCPSettings`, `WebSearchSettings`, or `ApiServerSettings` references remain in `src/renderer/src/pages/settings/SettingsPage.tsx`
- [ ] T053 [US2] Verify US2 Acceptance Scenario 3: with `pnpm dev` running, directly navigate to `/settings/mcp`, `/settings/websearch`, and `/settings/api-server` (e.g., via URL bar or programmatically); confirm the app does not crash and renders a blank content area or redirects — no unhandled errors in DevTools console (addresses US2 Scenario 3 / FR-001)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational Deletions)**: Depends on Phase 1 — **BLOCKS all editing tasks**
- **Phase 3 (US2 Settings UI)**: Depends on Phase 2 — SettingsPage imports deleted directories
- **Phase 4 (US1 Build Gate)**: Depends on Phase 2 and Phase 3 — store/main/preload edits + cross-reference cleanup
- **Phase 5 (US3 Smoke Test)**: Depends on Phase 4 — app must build before smoke testing
- **Phase 6 (Polish)**: Depends on Phase 5

### User Story Dependencies

- **US2 (Settings Page)**: Starts after Phase 2 (file deletions) — independent of US1 edits
- **US1 (Build Gate)**: Starts after Phase 2 and US2 — requires all deletes + SettingsPage edits to enumerate all TypeScript errors
- **US3 (Selection Assistant)**: Starts after US1 (`pnpm build:check` passes)

### Parallel Opportunities Within Phases

**Phase 2** — All T003–T018 can run in parallel (different files):
```
T003, T004, T005  # directory deletions
T006, T007, T008  # store slice deletions
T009, T010        # renderer service deletions
T011, T012        # main service deletions
T013, T014        # AI tool deletions
T015, T016        # hook deletions
T017, T018        # test file deletions
```

**Phase 4** — Parallel groups:
```
Group A (independent): T023–T025 (store/index.ts)
Group B (independent): T026–T027 (main/index.ts)
Group C (independent): T028–T031 (preload/index.ts)
Group D (independent): T032, T033, T034 (locale files — run together, then T035 after)
Group E (independent): T036, T037, T038 (cross-reference hooks/aiCore)
# T039 (lint enumeration) starts after all above groups
# T040, T041 run sequentially after T039
```

**Phase 5** — Parallel after T042–T043:
```
T044, T045, T046, T047 # four AI actions can be tested in parallel
T048 # browser-search action (sequential after overlay verified)
```

---

## Parallel Example: Phase 2 (File Deletions)

```bash
# All deletions can run simultaneously since they target different files:
rm -rf src/renderer/src/pages/settings/MCPSettings/
rm -rf src/renderer/src/pages/settings/WebSearchSettings/
rm -rf src/renderer/src/pages/settings/ToolSettings/
rm -f  src/renderer/src/store/mcp.ts
rm -f  src/renderer/src/store/websearch.ts
rm -f  src/renderer/src/store/toolPermissions.ts
rm -f  src/renderer/src/services/MCPClientService.ts
rm -f  src/renderer/src/services/WebSearchService.ts
rm -f  src/main/services/MCPService.ts
rm -f  src/main/services/SearchService.ts
rm -f  src/renderer/src/aiCore/tools/WebSearchTool.ts
rm -f  src/renderer/src/providers/WebSearchProvider/LocalSearchProvider.ts
rm -f  src/renderer/src/hooks/useMCPServers.ts
rm -f  src/renderer/src/hooks/useWebSearchProviders.ts
rm -f  src/renderer/src/aiCore/utils/__tests__/mcp.test.ts
rm -f  src/renderer/src/aiCore/utils/__tests__/websearch.test.ts
```

---

## Implementation Strategy

### MVP First (US2 + US1 = visible + compiling)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: All file deletions (T003–T018)
3. Complete Phase 3: Settings page UI edits (T019–T022)
4. Complete Phase 4: Code edits + build gate (T023–T041)
5. **STOP and VALIDATE**: `pnpm build:check` passes — app is shippable
6. Complete Phase 5: Smoke test Selection Assistant (T042–T048)

### Critical Path

The critical path runs through: T001 → T002 → [T003–T018 in parallel] → [T019–T022 sequential] → [T023–T038 in parallel groups] → T039 → T040 → T041 → T042 → T048

---

## Notes

- `[P]` tasks touch different files — safe to parallelize
- All three user stories are P1; execution order is by logical dependency, not spec priority
- The biggest risk is T039 (TypeScript cross-reference cleanup in Chat/home pages) — time estimate varies based on how many Chat files reference deleted modules; run `pnpm lint` after Phase 2+3 to get the full list before starting Phase 4 edits
- The `apiServerService` in `src/main/index.ts` removes its IPC preload namespace and settings UI, but the service file `ApiServerService.ts` itself is kept (Phase 04 scope per research.md Finding 4)
- After T041 (`pnpm build:check` passes), the implementation is done — Phases 5–6 are verification only
