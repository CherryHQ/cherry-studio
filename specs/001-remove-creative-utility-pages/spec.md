# Feature Specification: Remove Creative & Utility Pages

**Feature Branch**: `001-remove-creative-utility-pages`
**Created**: 2026-03-02
**Status**: Draft
**Input**: Phase 01 of the Quick Selection Assistant app trimming plan — remove all standalone creative and utility page features (Paintings, OVMS, Code Tools, OpenClaw, Mini Apps, Launchpad) that have zero cross-dependencies with the Selection Assistant.

## Context

The application is being transformed from a full-featured AI desktop app (~1545 source files, ~346 npm dependencies) into a lightweight Quick Selection Assistant utility. This is Phase 01 — the safest, lowest-risk entry point into the trimming process. It removes six standalone page features that are completely independent from the core Selection Assistant workflow.

### Assumptions

- The Selection Assistant feature is fully functional and does not depend on any code within the pages being removed (Paintings, Code Tools, OpenClaw, Mini Apps, Launchpad).
- The OVMS (OpenVINO Model Server) subsystem is exclusively used by the Paintings feature and has no consumers outside it.
- Three Redux store slices (`paintings`, `codeTools`, `openclaw`) are self-contained and not referenced by any surviving features. The `minapps` slice is referenced by 5 surviving core components (Sidebar, TabContainer, MinApp, MinappPopupContainer, PinnedMinapps) and is deferred to Phase 07/09.
- The preload namespaces (`api.openclaw.*`, `api.codeTools.*`, `api.ovms.*`) are exclusively consumed by their respective page features.
- No persisted user data from these features needs to be migrated — removal means the features simply stop being available.
- The sidebar icon configuration is a declarative array and removing entries has no side effects on remaining icons.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Application Launches Without Removed Features (Priority: P1)

As a user, when I launch the application after Phase 01, the app starts normally and the sidebar no longer shows Paintings, Code Tools, OpenClaw, or Mini Apps icons. The remaining features (Selection Assistant, Chat, Settings, etc.) continue to work exactly as before.

**Why this priority**: This is the fundamental guarantee — the app must remain fully functional after removing features. If the app crashes or existing features break, the trimming has failed.

**Independent Test**: Launch the app with `pnpm dev` and verify the sidebar, navigation, and all non-removed features work correctly.

**Acceptance Scenarios**:

1. **Given** the application has had Paintings, Code Tools, OpenClaw, Mini Apps, and Launchpad features removed, **When** the user launches the application, **Then** the app starts without errors and reaches the main interface.
2. **Given** the application is running after the removal, **When** the user inspects the sidebar, **Then** the icons for Paintings, Code Tools, OpenClaw, and Mini Apps are no longer present.
3. **Given** the application is running after the removal, **When** the user uses the Selection Assistant (select text, trigger toolbar, choose action, view AI response), **Then** the full Selection Assistant workflow completes successfully.

---

### User Story 2 - Removed Routes Do Not Crash the App (Priority: P2)

As a user, if I somehow navigate to a URL that previously belonged to a removed feature (e.g., `/paintings`, `/code`, `/openclaw`, `/apps`, `/launchpad`), the app does not crash — it shows a blank page or redirects gracefully.

**Why this priority**: Deep links, bookmarks, or history entries could reference removed routes. The app must handle these gracefully rather than crashing or showing a broken state.

**Independent Test**: Manually navigate to each removed URL path in the app's address bar and verify no crash occurs.

**Acceptance Scenarios**:

1. **Given** the Paintings page has been removed, **When** a user navigates to `/paintings` directly, **Then** the app shows a blank or fallback page without crashing.
2. **Given** the Code Tools page has been removed, **When** a user navigates to `/code` directly, **Then** the app shows a blank or fallback page without crashing.
3. **Given** the OpenClaw page has been removed, **When** a user navigates to `/openclaw` directly, **Then** the app shows a blank or fallback page without crashing.
4. **Given** the Mini Apps pages have been removed, **When** a user navigates to `/apps` or `/apps/any-id` directly, **Then** the app shows a blank or fallback page without crashing.
5. **Given** the Launchpad page has been removed, **When** a user navigates to `/launchpad` directly, **Then** the app shows a blank or fallback page without crashing.

---

### User Story 3 - Build Pipeline Passes After Removal (Priority: P1)

As a developer, after removing all Phase 01 features, the full build pipeline (`pnpm build:check` — lint + typecheck + test) passes with zero errors. There are no dangling imports, unresolved references, or broken type definitions.

**Why this priority**: Equal to P1 because a failing build blocks all further development and subsequent trimming phases.

**Independent Test**: Run `pnpm build:check` and verify it completes with exit code 0.

**Acceptance Scenarios**:

1. **Given** all Phase 01 files and references have been removed, **When** a developer runs `pnpm build:check`, **Then** the command exits with code 0 (no lint errors, no type errors, no test failures).
2. **Given** all Phase 01 files and references have been removed, **When** a developer runs `pnpm format`, **Then** no formatting issues are introduced by the removal changes.

---

### Edge Cases

- What happens if a third-party component or utility imported by the removed pages was also imported by a surviving feature? The removal must not break shared imports — only delete files exclusively owned by the removed features.
- What happens if the Redux store's persisted state still contains data from removed slices (e.g., `paintings` state in localStorage)? The app must boot without errors even if stale slice data exists in storage — `redux-persist` handles unknown keys gracefully by ignoring them.
- What happens if the OVMS manager (`OvmsManager`) is conditionally loaded only on Intel Windows? The removal must account for the conditional import pattern and not leave dangling platform-specific code paths.
- What happens if a sidebar icon references a removed page via the settings page "sidebar icon manager"? The sidebar icon config is a static array — removing the entries prevents them from appearing regardless of user customization saved in settings.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The application MUST remove the Paintings page (`/paintings`) and all its sub-routes, including the OVMS (OpenVINO) image generation subsystem.
- **FR-002**: The application MUST remove the Code Tools page (`/code`) and its associated sandbox/execution UI.
- **FR-003**: The application MUST remove the OpenClaw page (`/openclaw`) and its integration logic.
- **FR-004**: The application MUST remove the Mini Apps pages (`/apps`, `/apps/:appId`) and the Launchpad grid page (`/launchpad`).
- **FR-005**: The application MUST remove all six route entries and their corresponding imports from the router configuration.
- **FR-006**: The application MUST remove the four sidebar icon entries (`paintings`, `code_tools`, `openclaw`, `minapp`) from the default sidebar configuration.
- **FR-007**: The application MUST remove three Redux store slices (`paintings`, `codeTools`, `openclaw`) and their imports from the store configuration. The `minapps` slice is deferred to Phase 07/09 due to cross-dependencies with 5 surviving core components.
- **FR-008**: The application MUST remove four preload IPC namespaces (`api.openclaw.*`, `api.codeTools.*`, `api.ovms.*`, `api.installOvmsBinary`) from the preload bridge.
- **FR-009**: The application MUST remove any main process initialization or cleanup calls for OpenClaw, Mini Apps, and OVMS services.
- **FR-010**: The application MUST remove the OVMS main process service file and the renderer-side OVMS AI client.
- **FR-011**: The application MUST delete the five page directories and three store slice files for the removed features.
- **FR-012**: The application MUST continue to function correctly for all remaining features — specifically the Selection Assistant end-to-end workflow (text selection, toolbar, action window, AI streaming response).
- **FR-013**: The application MUST pass the full build pipeline (`pnpm build:check` — lint, typecheck, test) after all removals.

### Scope Boundaries

- **IN SCOPE**: Paintings page + OVMS subsystem, Code Tools page, OpenClaw page, Mini Apps pages, Launchpad page — all layers (route, sidebar, store, preload, main process service, file deletion).
- **OUT OF SCOPE**: Home/Chat page, Knowledge/Files/Notes pages, Translate/Store pages, Settings sub-routes, package.json dependency cleanup, any main process service not directly tied to these five features.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The application launches and reaches the main interface within the same timeframe as before the removal (no regression in startup time).
- **SC-002**: The full build pipeline (`pnpm build:check`) passes with zero errors after all removals.
- **SC-003**: Zero features outside the removal scope are affected — the Selection Assistant workflow (select text, trigger toolbar, choose action, view AI response) completes successfully 100% of the time.
- **SC-004**: The sidebar displays exactly four fewer icons than before (Paintings, Code Tools, OpenClaw, Mini Apps removed).
- **SC-005**: Five page directories and three store slice files are fully deleted from the codebase — no orphaned files remain. The `minapps` store slice is intentionally retained (deferred to Phase 07/09).
- **SC-006**: Navigating to any of the five removed URL paths (`/paintings`, `/code`, `/openclaw`, `/apps`, `/launchpad`) does not crash the application.
- **SC-007**: The total source file count is reduced by approximately 50-80 files (the page directories plus store slices plus service files for the removed features).
