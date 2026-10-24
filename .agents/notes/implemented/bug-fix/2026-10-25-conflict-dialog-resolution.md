# Agent Note: Dismissing the file-edit conflict dialog left sessions stuck

Status: implemented

English | [中文](2026-10-25-conflict-dialog-resolution.zh.md)

## Problem

The external-change conflict dialog in Notes and the agent artifact pane offered "keep draft" only as a dismissal: it closed the dialog without clearing the session's `conflict` flag. `FileEditSessionManager.prepareMutation` flushes every retained session and aborts on the first failure, so one unresolved conflict then failed every later note rename/delete/move with a toast that blamed the unrelated operation. The dialog never reopened on its own because the flag never transitioned.

## Decision

Closing the dialog without reloading now resolves the conflict: the cancel path calls the existing `keepDraft` lease command, which adopts the fresh disk baseline and re-saves the draft, clearing the conflict. The confirm path keeps the reload behavior and guards against a double resolution with a ref, because `ConfirmDialog` always fires `onOpenChange(false)` after `onConfirm` settles. When a keep or reload itself fails, the dialog re-opens reactively — the effect keys on `saveError` (each failure publishes a fresh Error) in addition to `conflict`, so an unresolved conflict always has a reachable resolution entry, while a save that fails after the conflict cleared stays with the ordinary save-error banner. Both close paths settle the dialog synchronously before starting async work so the component's auto-close can never land after a failure publish resets the guard.

## Alternatives considered

- Clear the conflict in the dialog dismissal only, without re-saving: rejected because the draft would silently diverge from the new disk baseline and the next autosave would hit the same stale-version guard.
- Re-open the dialog from the component catch handler: rejected because the closure observes a stale snapshot and cannot distinguish a failed baseline read (conflict still set) from a save that failed after the conflict cleared.
- Add an `onCancel` callback to `ConfirmDialog`: deferred as a `@cherrystudio/ui` contract change deserving its own PR.

## Consequences

A dismissed conflict now overwrites the external version with the kept draft instead of pausing autosave silently, which matches the button's label and the SkillFileBrowser reference implementation. [A follow-up](2026-10-25-file-edit-unblocked-writes.md) stops sessions already in conflict or save failure from blocking `prepareMutation`.

## Verification

- Regression — `pnpm test:renderer src/renderer/pages/notes/__tests__/NotesPage.test.tsx src/renderer/components/chat/panes/__tests__/ArtifactPane.test.tsx`: 84 tests pass, including dismiss-keeps-draft, reload-does-not-keep, and both failure-reopen cases. Guard mutations were verified to flip the negative assertions (stray `keepDraft` call; extra `file.edit.read`).
- Regression — Real Electron via CDP: with the fix, dismissing the conflict preserves the draft and renaming an unrelated note succeeds; the pre-fix run reproduced the blocked rename with a misleading failure toast.
