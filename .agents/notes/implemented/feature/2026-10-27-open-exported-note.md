# Agent Note: Opening an exported note

Status: implemented

English | [中文](2026-10-27-open-exported-note.zh.md)

## Problem

Saving conversation, message, or translation content to Notes confirmed success without a way to reach the created note.

## Decision

The existing successful Notes-export toast offers Open note for five seconds. It captures the path returned by `addNote`, including filename collision handling and destination fallback, rather than reconstructing a filename. Saving alone does not navigate; failed writes keep the error path and offer no open action.

Main-window navigation reuses the Notes tab. Its optional `notePath` search parameter accepts absolute paths, but the page selects only a file present in its current Notes tree. It waits for directory discovery and text composition to finish, then consumes the parameter. A manual file selection cancels an unavailable pending request. Existing file-edit sessions continue to own unsaved drafts and autosave.

## Alternatives considered

- Automatically switching after every save interrupts the conversation.
- Displaying an absolute destination path does not provide navigation and unnecessarily exposes filesystem details in the toast.
- Adding Notes to the sidebar or introducing a recent-exports view expands the issue beyond the save confirmation.

## Consequences

All callers of the shared Notes exporter receive the same action. No new preference, database schema, file format, or credential access is introduced. A missing or out-of-tree target cannot cause an arbitrary file read; a later manual selection clears the pending request.

## Verification

- Regression — `src/renderer/services/__tests__/ExportService.test.ts`: the action navigates to the actual created filename only after clicking, and failed writes expose no success action.
- Regression — `src/renderer/pages/notes/__tests__/NotesPage.test.tsx`: delayed directory discovery, composition, out-of-tree targets, and manual cancellation preserve selection and draft ownership.
- Regression — `src/renderer/hooks/tab/__tests__/useMainWindowNavigation.test.tsx`: saved-note requests reuse both an existing Notes tab and a tab opened before the next React render.
