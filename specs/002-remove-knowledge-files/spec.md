# Feature Specification: Remove Knowledge & Files Features (Phase 02)

**Feature Branch**: `002-remove-knowledge-files`
**Created**: 2026-03-03
**Status**: Draft
**Input**: Phase 02 of app trimming — remove Knowledge Bases, File Manager, and Doc Processing features to reduce the app to a focused Selection Assistant utility.

---

## Context

This is Phase 02 of a multi-phase effort to transform a full-featured Electron desktop app (~1,545 source files) into a lightweight Quick Selection Assistant (~150–200 source files). Phase 01 removed creative and utility pages. Phase 02 targets the Knowledge Bases system, File Manager, and Document Processing features — all unused by the core Selection Assistant workflow.

---

## Clarifications

### Session 2026-03-03

- Q: Should Phase 02 delete supporting backend directories (`src/main/knowledge/`, `src/main/services/ocr/`, `src/main/services/remotefile/`) and clean IPC handlers in `src/main/ipc.ts`, or follow the plan doc minimally? → A: Thorough removal — delete all three supporting directories and clean `src/main/ipc.ts` in Phase 02. The build cannot pass without touching `ipc.ts` (it imports from the deleted services), and leaving large dead-code directories creates confusion for future phases.
- Q: Should `src/main/mcpServers/dify-knowledge.ts` and other MCP files that solely serve the Knowledge feature be deleted in Phase 02, or left for Phase 04 (MCP removal)? → A: Delete them in Phase 02 — remove all Knowledge-referencing code now rather than leaving cross-phase dead references.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Clean App Navigation (Priority: P1)

As an end user of the trimmed app, I open the application and see only the features relevant to the Selection Assistant. There are no Knowledge Base or File Manager icons in the sidebar, and the Settings page has no Doc Processing section. The app feels focused and uncluttered.

**Why this priority**: Navigation surface area is immediately visible. Leftover icons or menu items from removed features would confuse users and break the "lightweight utility" promise.

**Independent Test**: Launch the app, inspect the sidebar icon list and Settings menu — Knowledge and Files entries must be absent.

**Acceptance Scenarios**:

1. **Given** the app is launched, **When** the user views the sidebar, **Then** no Knowledge Base or File Manager icons are displayed.
2. **Given** the user opens Settings, **When** the settings menu is visible, **Then** there is no "Doc Processing" menu item or sub-route.
3. **Given** the user navigates directly to `/knowledge` or `/files`, **When** the route resolves, **Then** the app shows a blank or 404 state without crashing.

---

### User Story 2 — Stable App After Removal (Priority: P1)

As a developer shipping the trimmed app, I run the build and start the app expecting zero compilation errors and a clean startup. All Selection Assistant functionality continues to work exactly as before — text selection, action window, AI responses.

**Why this priority**: Build stability and runtime correctness are prerequisite to all other phases. A failing build blocks all further trimming work.

**Independent Test**: Run the build check; launch the app; trigger the Selection Assistant on any selected text.

**Acceptance Scenarios**:

1. **Given** all deletions and edits are applied, **When** the build check runs, **Then** it passes with zero type errors and zero lint violations.
2. **Given** the app starts, **When** the renderer initialises, **Then** no errors referencing deleted modules appear in the console.
3. **Given** the user selects text and triggers the Selection Assistant, **When** an AI action runs, **Then** the result is returned correctly, confirming unrelated features are unaffected.

---

### User Story 3 — Reduced Internal Complexity (Priority: P2)

As a developer working on future trimming phases, I open the codebase and find that all store slices, backend services, renderer services, IPC handlers, and preload API namespaces related to Knowledge and Files have been deleted — including the supporting backend directories for embeddings, OCR, and remote file services. The codebase is measurably smaller and easier to navigate.

**Why this priority**: Removing dead code (including orphaned supporting directories) reduces future maintenance burden and is a prerequisite to later dependency pruning (Phase 10).

**Independent Test**: Search the codebase for imports or references to the removed services, store slices, and directory names — none should remain.

**Acceptance Scenarios**:

1. **Given** the deletions are applied, **When** the codebase is searched for the removed service names, store slice names, and directory references, **Then** no active imports or registrations exist.
2. **Given** the preload layer is updated, **When** the app starts, **Then** the two removed API namespaces (`knowledgeBase`, `ocr`) are not exposed to the renderer. The `file:` and `fileService:` namespaces remain exposed as they are required by the AI core engine.
3. **Given** `src/main/ipc.ts` is cleaned, **When** the build runs, **Then** no IPC handler references the deleted service files (`KnowledgeService`, `OcrService`). All `File_*`, `Fs_*`, and `FileService_*` handlers remain and continue to reference `FileStorage`, `FileSystemService`, and `remotefile/` — those are retained infrastructure.
4. **Given** Knowledge-only MCP server files are deleted, **When** the MCP server factory is inspected, **Then** no registration of `dify-knowledge` or equivalent Knowledge-specific MCP servers remains.

---

### Edge Cases

- What happens if persisted app state from a previous version contains keys for the removed store slices? The app must start cleanly without crashing — removed slice keys should be silently ignored or stripped via a migration step.
- What happens if another module imports from one of the deleted services or directories? The build check must surface these as type errors, ensuring no dangling references survive.
- What happens if the sidebar icon configuration still lists removed icon identifiers? The sidebar must not attempt to render icons for routes that no longer exist.
- What happens if `src/main/ipc.ts` still registers IPC channel handlers that reference deleted service methods? The build will fail with import errors — all such handlers must be removed along with their imports.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app's sidebar MUST NOT display Knowledge Base or File Manager navigation icons after this phase.
- **FR-002**: The app's routing MUST NOT register `/knowledge` or `/files` routes; navigating to these URLs MUST result in a graceful, crash-free state.
- **FR-003**: The Settings page MUST NOT include a "Doc Processing" menu item or its corresponding sub-route.
- **FR-004**: The app's state management MUST NOT include `knowledge`, `ocr`, or `preprocess` slices or their reducers.
- **FR-005**: All backend service registrations, IPC handlers, and supporting backend directories for Knowledge (including embedding, preprocessing, and reranking infrastructure), File Manager, File Storage, and OCR MUST be removed; the app backend MUST start and stop cleanly without them. Any MCP server files that exclusively serve the Knowledge feature (e.g., `dify-knowledge.ts`) MUST also be deleted in this phase rather than deferred to Phase 04. Note: `src/main/services/remotefile/` backs the Gemini AI file-upload path and MUST be retained.
- **FR-006**: All renderer-side service modules for Knowledge and File operations MUST be deleted; no remaining module may import them.
- **FR-007**: The communication bridge between the app backend and frontend MUST NOT expose `knowledgeBase` or `ocr` namespaces. The `file:` and `fileService:` namespaces MUST be retained — they are used by the AI core engine and Gemini file-upload path respectively and are not part of this removal scope.
- **FR-008**: The app MUST compile and pass all type checks with zero errors after all removals are applied.
- **FR-009**: The Selection Assistant feature MUST continue to function correctly end-to-end after this phase completes.
- **FR-010**: Persisted app state containing removed slice keys MUST be handled gracefully on first launch after the upgrade — no crash, no data loss in unaffected slices.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The build check passes with zero new errors introduced by this phase.
- **SC-002**: The app sidebar contains exactly 2 fewer navigation icons than before this phase (Knowledge and Files icons removed).
- **SC-003**: The Settings navigation contains exactly 1 fewer section than before this phase (Doc Processing removed).
- **SC-004**: A codebase-wide search finds zero active references to deleted source files, removed IPC handlers, or the 2 removed API namespaces (`knowledgeBase`, `ocr`).
- **SC-005**: The Selection Assistant completes a full text-selection → action → AI-response cycle without errors after this phase, confirming no regression.
- **SC-006**: The total deleted source file and directory count significantly exceeds the 11 items in the original plan, as the thorough removal includes `src/main/knowledge/` (embedding/preprocessing/reranking), `src/main/services/ocr/`, and `src/main/services/remotefile/` in addition to the originally scoped items.

---

## Assumptions

- Phase 01 is merged to `main` before this phase starts (confirmed: complete).
- No feature currently in the codebase depends on the removed services, directories, or store slices beyond the pages being deleted in this phase.
- Persisted Redux state migration follows the same pattern used in Phase 01: a numbered migration step strips removed slice keys on startup.
- The `pdf-parse`, `mammoth`, and `sharp` npm packages are **not** removed in this phase — their removal is deferred to Phase 10.
- The sidebar icon type definition will be updated to remove `'knowledge'` and `'files'` literals, consistent with the Phase 01 pattern.
- `src/main/ipc.ts` IPC handlers for `KnowledgeBase_*` (7 handlers) and `OCR_*` (2 handlers) are removed as part of FR-005. All `File_*`, `Fs_*`, and `FileService_*` IPC handlers (~50 total) are **retained** — they back the AI core engine's file-reading and Gemini file-upload paths and are not part of this removal scope.
