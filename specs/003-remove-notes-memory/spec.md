# Feature Specification: Remove Notes & Memory Features (Phase 03)

**Feature Branch**: `003-remove-notes-memory`
**Created**: 2026-03-04
**Status**: Draft
**Input**: Phase 03 of the Quick Selection Assistant app-trimming project

## Overview

This phase removes the Notes note-taking system and the Conversation Memory feature from the Quick Selection Assistant app. These are two independent but co-located features: Notes provides a built-in note-taking page, and Memory provides configurable AI conversation-memory persistence.

**Critical Risk**: The Notes system has a startup initialization routine that reads from the Notes store slice on every boot. This routine must be removed together with the slice — leaving it in place causes an immediate crash every time the app starts.

This is Phase 03 of a multi-phase reduction from a full-featured AI chat platform (~1,545 source files) to a lightweight text-action utility (~150–200 source files). Phases 01 (creative/utility pages) and 02 (knowledge base, file manager, OCR) are already complete.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - App Boots Reliably After Removal (Priority: P1)

After Notes and Memory features are removed, the app must launch without any startup crash or error. The primary risk in this phase is the store initialization routine that references Notes data — if not removed alongside the store slice, every app launch results in an immediate crash.

**Why this priority**: A startup crash is a complete blocker that makes the entire app unusable. This is the highest-risk deliverable in this phase and must be verified before anything else.

**Independent Test**: Launch the app after changes and verify it reaches the main chat view within 5 seconds with no error dialogs, no crash, and no missing-store errors in the console.

**Acceptance Scenarios**:

1. **Given** the app has been updated with Notes and Memory removed, **When** a user launches the app, **Then** the app starts fully and reaches the main UI without crashing or displaying any error message.
2. **Given** a user who previously had Notes configured, **When** they launch the updated app, **Then** the app starts normally — previously stored Notes data is silently ignored with no migration required.
3. **Given** the app is running, **When** a user navigates to the `/notes` URL, **Then** they see a graceful blank or 404 state — not a crash.
4. **Given** the app is running, **When** a user navigates to the Memory Settings URL, **Then** they see a graceful blank or 404 state — not a crash.

---

### User Story 2 - Notes Feature No Longer Accessible (Priority: P1)

The Notes note-taking functionality — sidebar icon, navigation route, and all associated UI — is completely removed from the application surface. No trace of Notes remains in the navigation or routing layer.

**Why this priority**: Notes is a primary target of this phase. Its complete removal from the UI is a required deliverable and must be testable independently of Memory removal.

**Independent Test**: Launch the app, inspect the sidebar (no Notes icon), and navigate to the Notes URL (graceful empty state). The core Selection Assistant remains fully functional.

**Acceptance Scenarios**:

1. **Given** the updated app, **When** a user inspects the sidebar, **Then** no Notes icon is present.
2. **Given** the updated app, **When** a user manually navigates to the Notes URL, **Then** they get a graceful empty/404 state with no crash and no error logged.
3. **Given** the updated app, **When** a user opens any Settings page, **Then** no Notes-related configuration option is visible.

---

### User Story 3 - Conversation Memory Settings Removed (Priority: P1)

The Conversation Memory configuration section in Settings is fully removed. No Memory menu item appears, and no Memory configuration UI is reachable.

**Why this priority**: The Memory settings UI references backend services that are being removed. Leaving it in place would cause broken Settings interactions and expose deleted functionality to users.

**Independent Test**: Open Settings and confirm no "Memory" section is listed. Navigate to the Memory settings URL and get a graceful empty state.

**Acceptance Scenarios**:

1. **Given** the updated app, **When** a user opens Settings, **Then** no "Memory" menu item appears in the Settings navigation.
2. **Given** the updated app, **When** a user manually navigates to the Memory Settings URL, **Then** they get a graceful empty/404 state with no crash.
3. **Given** a user who previously had Memory configured, **When** they open Settings, **Then** no memory-related configuration is visible and no error is shown.

---

### User Story 4 - Selection Assistant Continues to Function (Priority: P1)

The core Selection Assistant feature — selecting text and triggering AI actions (summarize, translate, explain, refine, custom prompts) — must remain fully functional after removing Notes and Memory.

**Why this priority**: The Selection Assistant is the entire purpose of the trimmed app. Any regression here is a showstopper.

**Independent Test**: Select text in any application, trigger the Selection Assistant, choose an action (e.g., Summarize), and verify an AI response is returned correctly.

**Acceptance Scenarios**:

1. **Given** the updated app is running, **When** a user selects text and triggers a text action, **Then** the AI processes the request and returns a result correctly — identical behavior to pre-Phase-03.
2. **Given** the updated app, **When** a user triggers any of the standard actions (Summarize, Translate, Explain, Refine), **Then** all actions complete successfully without errors.

---

### Edge Cases

- **Previously configured Memory**: Users who had Memory enabled will find their stored configuration silently dropped on next launch. No error is displayed; the underlying data remains on disk but is inaccessible.
- **Previously stored Notes data**: Notes files on disk are not deleted or migrated. The data is simply unreachable — no message is shown to the user.
- **Hidden consumers of Notes store**: Before removing the Notes store slice, a full codebase search must confirm no files outside the Notes page directory read from the Notes state. Any such consumers must be cleaned up first, or removal will produce build errors.
- **Concurrent store rehydration**: The startup initialization routine must be removed in the same change that removes the Notes store slice. Partial removal (slice removed but routine kept) causes an immediate crash on rehydration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST launch and reach its main interface without any startup crash after Notes and Memory features are removed.
- **FR-002**: The sidebar MUST NOT display a Notes icon after removal.
- **FR-003**: The Settings page MUST NOT display a Memory configuration section after removal.
- **FR-004**: Navigating to the Notes or Memory Settings URLs MUST result in a graceful empty/404 state — not a crash.
- **FR-005**: The app's startup initialization routine MUST NOT reference any removed store data; specifically, the routine that reads the Notes directory path on every boot must be removed alongside the Notes store slice.
- **FR-006**: All backend services that exclusively serve Notes and Memory functionality MUST be removed (NotesService and MemoryService in both main process and renderer).
- **FR-007**: The inter-process communication bridge MUST NOT expose any memory-related API namespaces after removal.
- **FR-008**: The state synchronization service MUST NOT attempt to sync Notes-related data after removal.
- **FR-009**: The app's build verification MUST complete with zero new errors after all removals (pre-existing test failures from before this phase are acceptable).
- **FR-010**: The Selection Assistant MUST continue to function correctly and process all text actions after the removals.
- **FR-011**: Persisted app state from previous versions MUST be handled gracefully on first launch — any previously stored Notes or Memory state must not cause a crash or error during state rehydration.

### Key Entities

- **Notes Store Slice**: Manages the state of the note-taking feature, including the notes directory path. Has a boot-time startup dependency — an initialization routine reads from this slice on every app launch. Both the slice and its startup consumer must be removed together.
- **Memory Store Slice**: Manages conversation memory configuration. Has no startup dependency; can be removed independently of the Notes slice.
- **Notes IPC Handler**: Notes backend operations in the main process are handled by a `File_ValidateNotesDirectory` IPC handler in the main process entry point — not a standalone service file. This handler is the only main-process Notes artifact and must be removed alongside the Notes page.
- **MemoryService (main & renderer)**: Backend and renderer-side services handling memory persistence. No consumers remain after the Memory Settings page is deleted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: App launches to the main chat view in under 5 seconds with zero startup errors — verified across 3 consecutive cold launches.
- **SC-002**: Zero Notes or Memory UI surfaces are discoverable through any app navigation entry point (sidebar, Settings menu, route navigation) — verified by manual inspection of all navigation paths.
- **SC-003**: The app's build verification completes with zero new errors compared to the Phase 02 baseline — pre-existing failures (if any existed before this phase) remain the only failures.
- **SC-004**: Zero references to the Notes path initialization routine remain in the store initialization code after removal — verified by automated codebase search.
- **SC-005**: The Selection Assistant successfully completes a text action (Summarize, Translate, or Explain) end-to-end after removal — verified by manual test.
- **SC-006**: Zero references to Notes or Memory store state remain in active application code (outside of any state migration/upgrade step) — verified by automated search.

## Assumptions

- **No data migration**: Existing Notes data and Memory configurations stored on disk are not migrated, exported, or cleaned up in this phase. Data remains on disk but becomes inaccessible.
- **Independent phase**: This phase can be executed cleanly from the Phase 02 result without depending on any unreleased Phase 04+ work.
- **No i18n cleanup**: Internationalization label keys for Notes and Memory are out of scope for this phase and are deferred to Phase 10.
- **Consumer audit required first**: Before deleting the Notes store slice, a codebase-wide search must confirm no files outside the Notes page directory read from Notes state. This audit is a prerequisite task, not an assumption to skip.
- **Memory scope clarity**: The "Memory" feature being removed is Conversation Memory — the AI feature that persists conversation history across sessions. It is not the in-session AI context window, which is unaffected by this phase.
- **Startup routine is the only runtime cross-dependency**: The Phase 03 documentation identifies the `persistor` boot callback as the only runtime consumer of the Notes store state. This assumption must be validated by the consumer audit task before proceeding with deletion.
