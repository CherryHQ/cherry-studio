# Implementation Plan: Remove MCP & Web Search Features

**Branch**: `004-remove-mcp-websearch` | **Date**: 2026-03-04 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-remove-mcp-websearch/spec.md`

## Summary

Remove the MCP server management system, AI-powered Web Search integration, and API Server settings from the Quick Selection Assistant (Phase 04 of app-trimming). This involves deleting settings UI directories, Redux store slices, backend services, renderer services, AI tools, and IPC preload namespaces. Additionally, all cross-references in the Chat/AI pipeline (scheduled for removal in Phase 07) that import from deleted modules must be cleaned up to keep TypeScript compilation passing.

## Technical Context

**Language/Version**: TypeScript ~5.8.3
**Primary Dependencies**: Electron 40, React 19, Redux Toolkit ^2.2.5, redux-persist ^6.0.0, react-router-dom 6, Vitest ^3.2.4, Biome ^2.2.4, electron-vite 5
**Storage**: redux-persist (localStorage) — state blacklist updated
**Testing**: Vitest (pnpm test), TypeScript compiler (pnpm lint), Biome (pnpm format)
**Target Platform**: Desktop (Windows, macOS, Linux via Electron)
**Project Type**: desktop-app
**Authentication**: none
**Deployment Target**: N/A (local Electron app distributed as binary)
**CI/CD**: none (local build check via `pnpm build:check`)
**Performance Goals**: Build must pass with 0 TypeScript errors, 0 lint errors
**Constraints**: `pnpm build:check` must pass; Selection Assistant must remain functional
**Scale/Scope**: ~15–25 files deleted or modified; i18n keys for 3 settings sections removed

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Rule | Status | Notes |
|------|--------|-------|
| Keep it clear | PASS | Removal task; no new complexity introduced |
| Match the house style | PASS | Deleting existing files, not adding new patterns |
| Log centrally via loggerService | PASS | No new logging needed; existing log calls in deleted files go away |
| Lint, test, and format before completion | **GATE** | `pnpm build:check` is the exit criterion (SC-001) |
| Write conventional commits | PASS | Will use `refactor:` prefix per convention |
| Always propose before executing | PASS | Plan approved before implementation |

No constitution violations. All gates satisfied.

## Artifact Generation Matrix

| Artifact | Decision | Reason |
|----------|----------|--------|
| research.md | GENERATE (always) | Documents cross-reference impact finding; resolves scope question |
| data-model.md | GENERATE (always) | Documents deleted Redux state shapes and their inter-dependencies |
| contracts/ | SKIP | Internal desktop app with no external consumers |
| api-spec.md | SKIP | Project Type is `desktop-app`; no HTTP endpoints being added or modified |
| frontend-spec.md | GENERATE | React UI is modified (SettingsPage.tsx menu + routes deleted); user-facing screens change |
| backend-spec.md | SKIP | No new services being created; only deletions from main process |
| auth-security.md | SKIP | Authentication is N/A; no user auth system |
| infra.md | SKIP | Deployment Target is N/A; local desktop app, no CI/CD pipeline |
| testing-strategy.md | GENERATE | Constitution mandates `pnpm lint + test + format`; spec has measurable acceptance criteria |
| quickstart.md | GENERATE (always) | Developer onboarding for this removal task |

## Project Structure

### Documentation (this feature)

```text
specs/004-remove-mcp-websearch/
├── plan.md                # This file
├── research.md            # Phase 0: cross-reference impact analysis
├── data-model.md          # Phase 1: deleted Redux state shapes
├── frontend-spec.md       # Phase 1: SettingsPage changes
├── testing-strategy.md    # Phase 1: build verification and smoke test strategy
├── quickstart.md          # Phase 1: developer steps to execute this removal
└── tasks.md               # Phase 2 output (/5.tasks command — NOT created here)
```

### Source Code (affected paths)

```text
# Files DELETED
src/renderer/src/pages/settings/MCPSettings/        (directory)
src/renderer/src/pages/settings/WebSearchSettings/  (directory)
src/renderer/src/pages/settings/ToolSettings/       (directory)
src/renderer/src/store/mcp.ts
src/renderer/src/store/websearch.ts
src/renderer/src/store/toolPermissions.ts
src/renderer/src/services/MCPClientService.ts
src/renderer/src/services/WebSearchService.ts
src/main/services/MCPService.ts
src/main/services/SearchService.ts
src/renderer/src/aiCore/tools/WebSearchTool.ts
src/renderer/src/providers/WebSearchProvider/LocalSearchProvider.ts

# Files EDITED
src/renderer/src/store/index.ts           (remove 3 imports + combineReducers entries + blacklist entry)
src/renderer/src/pages/settings/SettingsPage.tsx  (remove 3 imports, 3 menu items, 3 routes, orphaned dividers)
src/main/index.ts                         (remove MCPService + ApiServerService init/cleanup)
src/preload/index.ts                      (remove api.mcp.*, api.searchService.*, api.agentTools.*, api.apiServer.*)
src/renderer/src/i18n/locales/en-us.json  (remove orphaned i18n keys)
src/renderer/src/i18n/locales/zh-cn.json  (remove orphaned i18n keys)
src/renderer/src/i18n/locales/zh-tw.json  (remove orphaned i18n keys)

# Files requiring TypeScript-error cleanup (Chat pipeline — Phase 07 scope but blocking build)
src/renderer/src/hooks/useMCPServers.ts   (exclusively wraps store/mcp — DELETE)
src/renderer/src/hooks/useWebSearchProviders.ts  (exclusively wraps store/websearch — DELETE)
src/renderer/src/hooks/useAppInit.ts      (remove toolPermissions import only)
src/renderer/src/aiCore/               (remove imports of deleted store slices/services)
src/renderer/src/pages/home/           (remove imports of deleted store slices/services)
```

**Structure Decision**: Single Electron project (Option 1). Main process in `src/main/`, renderer process in `src/renderer/src/`, preload bridge in `src/preload/`.

## Complexity Tracking

No constitution violations requiring justification.
