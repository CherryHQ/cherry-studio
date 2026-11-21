# Agent Note: Restore notes without sharing the current selection

Status: implemented

English | [中文](2026-11-18-notes-selection-restore.zh.md)

Date: 2026-11-18
Owners: Notes renderer maintainers
Related issue: [#24843](https://github.com/CherryHQ/cherry-studio/issues/24843)

## Problem

After restarting with the starred filter enabled, the list returns to all notes while the editor loses its selection. With notes present but none selected, the editor also claims that no notes exist. Both filter and selection were session state, and the empty editor did not distinguish missing selection from an empty directory.

Persisting selection directly creates a concurrency problem: renderer persist writes broadcast across windows. A selection broadcast bypasses the receiving window's `requestFileTransition` and its composition guard. Creation and rename can also make windows clear each other's selection while directory mirrors catch up.

## Decision

`notes.active_file_path` stays in window-local memory as `AbsoluteFilePath | undefined`. The renderer persist key `notes.last_open_file_path` has type `AbsoluteFilePath | null` and default `null`. Each NotesPage mount seeds an empty selection once. Later broadcasts never select a note, including after selection is cleared. A selected path writes back to recovery; clearing an invalid clean selection or deleting the selected note clears the current selection and clears recovery only if it still points to that path. File-edit recovery updates current-window memory; NotesPage owns persistence.

Existence checks use the directory session's O(1) index, trying the original absolute path before its normalized form, and accepting files only. A snapshot is trusted only when its root exists, its tree identifier is active, loading has finished, and no tree error exists. Cleanup also waits until the file session is no longer loading, when its dirty state is known; an error still permits cleanup of a missing clean path. The same snapshot and the file session's own dirty flag govern cleanup and missing-draft retention. Root release, loading, and tree errors never prove a file missing, even if an old root remains after observation stops. Dirty drafts remain accessible when a reconnect removes their file. The editor stays on its path until the file is confirmed missing and clean, including while the projected tree catches up with the index. Creation, rename, and composition retain their transition guards.

The starred filter remains session-only. With files present, including in collapsed folders, an unselected editor uses `notes.no_note_selected`. A directory without notes retains the existing empty state.

## Alternatives considered

- One persist key for selection and recovery lets broadcasts bypass guarded transitions.
- Persisting the starred filter changes its session semantics without fixing selection recovery or the misleading empty state.
- Checking the projected tree or a second projection ref lets existence and dirty retention observe different revisions and mistake root release for file deletion.

## Consequences

Recovery is shared history; each open window keeps its own selection. Concurrent windows may replace the recovery hint; cleanup resets it to `null` only while it still matches the cleared path, preserving a newer path received from another window. Cleanup waits for an active tree and the file session's dirty state to be known, so a released index or pending session acquisition cannot erase the selection. This is disposable navigation state, not document storage. The earlier experimental persist key has no compatibility migration.

Cross-machine root-directory changes remain unverified. An invalid restored path can still trigger the existing “Failed to load note” notification before the trusted tree clears selection; improving that notification is a follow-up.

Known limitations inherited from the current tree and editor plumbing, tracked separately: `findNodeByPath` matches both the relative `treePath` and the absolute path, so a projection update can land on a colliding node and change the editor key; a confirmed-missing clean file can drop the editor area while an IME composition is still in flight; and a missing dirty session that fails to reload shows the existing load-failure state, whose draft stays reachable from the recovery UI.

## Verification

- Regression — `src/renderer/pages/notes/__tests__/NotesPage.test.tsx` covers restart recovery, invalid clean-path cleanup to `null`, root-session release and reconnect, dirty reconnect drafts, cross-window persist broadcasts, one-time seeding, and the unselected editor. It also covers file-session loading through ready/error, editor retention when the index recovers before projection, a stopped tree retaining its old root, and both cleanup paths preserving another window's recovery value. All six added cases fail before these fixes; earlier targeted counterchecks restore the old D2 guards or single-persist-selection mechanism to expose regressions.
- Manual — a device probe in a disposable profile with three notes, two of them starred: restarting the app restores the previously opened note in the editor while the starred filter resets to all three rows; deleting that note while the app is closed clears both the editor selection and the persisted recovery value; an unselected page shows the select-a-note state instead of claiming there are no notes.
