# Agent Note: Edit Pi Durable queued drafts in the composer

Status: implemented

English | [中文](2026-11-28-pi-durable-queued-draft-editing.zh.md)

## Problem

Work originally opened a text-only dialog when editing a [Pi Durable follow-up](2026-11-26-pi-durable-queue.md). The composer already provides the controls for editing a complete message draft, including attachments and references. The initial text-only edit also required a text part in the queued message.

## Decision

Open the queued draft in the existing Work composer. Restore all draft content that the composer supports for the session, including text, attachments, and reference tokens. Save uses the same draft validation and attachment preparation as an ordinary Work submission. Cancel restores the composer's previous draft. A failed save keeps the editor contents available.

Durable marks the waiting input as editing before Work opens the editor. The queue can dispatch earlier follow-ups and stops at the editing item. Save updates the original input and clears the mark in one native commit. Cancel clears the mark and retains the last saved content. The input keeps its message ID and queue position. The queue can resume a dispatch deferred by editing, subject to the independent Stop pause and failed-run policy.

Commit the prepared model input and its revised message parts in the same native transaction. Live projection and recovery apply the committed parts and managed file references together. Retained attachments keep their identities. New managed attachments remain available across the interval between native commit and desktop projection. Recovery also understands queued text edits written by older builds.

## Alternatives considered

- Extend the dialog with attachment controls. This duplicates draft editing and file handling already owned by the composer.
- Withdraw the original input and submit the edited draft. This changes submission identity and can move the input behind later entries.

## Consequences

Save checks the captured revision and the editing window's token. The mark survives window loss and restart. A new window can reopen an edit whose owner is gone using the last saved content. Native and desktop storage commit separately. Recovery applies the final file references when the desktop missed the live update. The queued input continues to use the knowledge-base authorization of its existing runtime connection.

## Verification

- AC1 — Electron opened a file-only queued draft in the Work composer, added and removed files, and restored the original draft on Cancel and Save.
- AC2 — Electron saved an attachment-only edit, reopened it to add text, and observed the revised input and attachments at the local model. The runtime integration test verified the original submission ID and retained attachment part ID.
- AC3 — `PiDurableRuntimeConnection.test.ts` and `followups.test.ts` checked revision conflicts and preserved the queued submission.
- AC4 — `PiDurableRuntimeConnection.test.ts` recovered the complete committed parts and managed file reference after missing the live projection. `followups.test.ts` checked the legacy text edit record.
- Regression — `followups.test.ts` and `PiDurableRuntimeConnection.test.ts`: the edited item and later items stay queued across completion and restart, the preceding reply still settles, Save releases a deferred dispatch without overriding failed-run policy, and explicit Resume waits for the edit to end.
- Regression — Electron with a local scripted provider: the queue showed the editing item after the preceding reply finished. Save sent the revised content once and the next input followed in order.
