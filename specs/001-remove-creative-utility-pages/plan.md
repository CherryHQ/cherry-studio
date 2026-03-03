# Implementation Plan: Remove Creative & Utility Pages

**Branch**: `001-remove-creative-utility-pages` | **Date**: 2026-03-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-remove-creative-utility-pages/spec.md`

## Summary

Remove six standalone creative and utility page features (Paintings, OVMS, Code Tools, OpenClaw, Mini Apps, Launchpad) from the Electron app as complete vertical slices — page routes, sidebar entries, Redux store slices, preload IPC namespaces, main process services, and settings components. This is Phase 01 of the app trimming plan — the safest, lowest-risk entry point. Research uncovered three critical cross-dependencies that shape the execution order: a constant relocation, a deferred store slice, and a broader-than-expected OVMS cleanup.

## Technical Context

**Language/Version**: TypeScript 5.x (Electron app, React renderer)
**Primary Dependencies**: Electron, React 18, Redux Toolkit, redux-persist, electron-vite
**Storage**: Redux store with redux-persist (localStorage); OVMS uses main process file system
**Testing**: Vitest (`pnpm test` — main + renderer), Biome (lint/format), TypeScript compiler (typecheck)
**Target Platform**: Windows, macOS, Linux (Electron desktop)
**Project Type**: Desktop app (Electron)
**Performance Goals**: App launches within same timeframe as before removal (no startup regression)
**Constraints**: Must not break any surviving features; `pnpm build:check` must pass with zero errors
**Scale/Scope**: Removing ~50-80 source files across 5 page directories, 4 store slices, OVMS service, and OVMS AI client

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| Keep it clear | PASS | Removing code reduces complexity; no new abstractions introduced |
| Match the house style | PASS | Only editing existing patterns (removing entries from arrays, reducers, routes) |
| Search smart | PASS | Research phase used targeted grep/glob to audit cross-dependencies |
| Log centrally | N/A | No new logging added; removing features removes their logging |
| Research via subagent | PASS | Cross-dependency audit conducted via explore agent before planning |
| Always propose before executing | PASS | Full spec → clarify → plan workflow followed before any code changes |
| Lint, test, and format before completion | PASS | `pnpm format && pnpm build:check` is the final verification step |
| Write conventional commits | PASS | Will use `refactor: remove creative & utility pages (Phase 01)` |

**Post-design re-check**: All gates remain PASS. The CLAUDE_SUPPORTED_PROVIDERS relocation (Decision 1) and OVMS cleanup (Decision 3) are straightforward edits matching existing patterns. The minapps store deferral (Decision 2) avoids violating "keep it clear" by not touching 5+ core components.

## Project Structure

### Documentation (this feature)

```text
specs/001-remove-creative-utility-pages/
├── plan.md              # This file
├── research.md          # Cross-dependency audit results (5 decisions)
├── data-model.md        # N/A — deletion task, no new entities
├── quickstart.md        # Developer verification instructions
├── checklists/
│   └── requirements.md  # Spec quality checklist (all items pass)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code — Files to Remove

```text
# Page directories (REMOVE)
src/renderer/src/pages/paintings/       # Paintings page + OVMS UI
src/renderer/src/pages/code/            # Code Tools page
src/renderer/src/pages/openclaw/        # OpenClaw page
src/renderer/src/pages/minapps/         # Mini Apps pages
src/renderer/src/pages/launchpad/       # Launchpad grid page

# Store slices (REMOVE)
src/renderer/src/store/paintings.ts
src/renderer/src/store/codeTools.ts
src/renderer/src/store/openclaw.ts
# NOTE: store/minapps.ts is DEFERRED (used by 5 core components)

# OVMS subsystem (REMOVE)
src/main/services/OvmsManager.ts
src/renderer/src/aiCore/legacy/clients/ovms/
```

### Source Code — Files to Edit (Hub Files)

```text
# Router — remove 6 route entries + imports
src/renderer/src/Router.tsx

# Sidebar — remove 4 icon entries
src/renderer/src/config/sidebar.ts

# Store — remove 3 reducer imports + entries (paintings, codeTools, openclaw)
# NOTE: minapps reducer stays (deferred)
src/renderer/src/store/index.ts

# Store migration — clean references to removed slices
src/renderer/src/store/migrate.ts

# Preload — remove api.openclaw.*, api.codeTools.*, api.ovms.*, api.installOvmsBinary
src/preload/index.ts

# Main process — remove OVMS import/quit handler, OVMS IPC handlers
src/main/index.ts
src/main/ipc.ts

# AI client factory — remove OVMSClient reference
src/renderer/src/aiCore/legacy/ApiClientFactory.ts  (or equivalent)

# Settings — remove OVMS settings components
src/renderer/src/pages/settings/ (OVMSSettings, DownloadOVMSModelPopup references)

# Provider util — relocate CLAUDE_SUPPORTED_PROVIDERS before deleting pages/code/
src/renderer/src/utils/provider.ts

# Test mock — update/remove store/paintings mock
src/renderer/src/services/__tests__/ApiService.test.ts
```

**Structure Decision**: This is a deletion/cleanup task within an existing Electron app. No new directories or structural changes. The only structural addition is inlining the `CLAUDE_SUPPORTED_PROVIDERS` constant into `utils/provider.ts` (moving it out of `pages/code/index.ts` before deletion).

## Execution Order (from Research)

The research phase identified a strict execution order to avoid broken intermediate states:

1. **Relocate `CLAUDE_SUPPORTED_PROVIDERS`** — Move from `pages/code/index.ts` to `utils/provider.ts` (or inline it). Must happen BEFORE deleting `pages/code/`.
2. **Remove OVMS subsystem** — Remove OvmsManager (main), OVMS IPC handlers (ipc.ts), OVMSClient (ApiClientFactory), OVMS settings components, OVMS preload namespace. Must happen as a unit.
3. **Remove page routes and imports** — Clean Router.tsx of all 6 routes.
4. **Remove sidebar entries** — Clean sidebar.ts of 4 icon entries.
5. **Remove store slices** — Remove 3 slices (paintings, codeTools, openclaw) from store/index.ts. SKIP minapps (deferred).
6. **Remove preload namespaces** — Remove api.openclaw.*, api.codeTools.* from preload.
7. **Update test mock** — Fix ApiService.test.ts mock of store/paintings.
8. **Delete page directories and files** — Remove 5 page dirs, 3 store files, OVMS files.
9. **Verify** — `pnpm format && pnpm build:check`.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
