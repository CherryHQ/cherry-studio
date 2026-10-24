# Agent Note: File edit writes without receipts and mutations not blocked by parked sessions

Status: implemented

English | [中文](2026-10-25-file-edit-unblocked-writes.zh.md)

## Problem

The file editing runtime from [the independent lifecycle proposal](../../proposed/architecture/2026-10-23-independent-file-edit-lifecycle.md) carried two costs without a matching failure. First, `EditWriteLedger`, `file.edit.settle_write` and the renderer's outcome-unknown state guarded against a write reply lost after commit. `ipcApi` has no request timeout, so a reply is lost only when a process dies, and then the renderer state that would settle it is gone too. Second, `prepareMutation()` flushed every retained session and aborted on the first failure. One file left in conflict or save failure therefore blocked every rename, move and delete in the window, as [the conflict dialog fix](2026-10-25-conflict-dialog-resolution.md) observed.

## Decision

`file.edit.write` takes `{ editId, expected, data }`, returns the new baseline with `metadataRecoveryPending`, and throws an `IpcError` on failure. The ledger, the settlement route, write sequences and `outcomeUnknown` are removed. Main still drains in-flight reads and writes before releasing a lease. The renderer's per-session queue keeps writes ordered. A retry after an unreported commit hits `STALE_VERSION`, finds its own bytes on disk and adopts them as saved.

`prepareMutation()` still seals every session, but flushes only sessions not already in conflict or save failure. Parked sessions keep their drafts on the recovery surface; the mutation proceeds and `finish()` revalidates attached sessions as before. A flush that fails during preparation still cancels the operation.

## Alternatives considered

- Flush only sessions under the mutated path: rejected, as in the proposal, because it needs alias-aware path matching across entry handles, symlinks and case-insensitive filesystems.
- Ignore every flush failure during preparation: rejected because a failure discovered while preparing is the last point at which the user can resolve it before the file moves.
- Revert the session runtime: rejected because it restores the cross-file overwrite and loses retained drafts.

## Consequences

A parked draft whose own file is renamed or deleted becomes unwritable after `finish()`; it stays recoverable through copy or discard instead of blocking the operation. If a process dies after a commit, the next session reads the file from disk as usual. A renderer bug that issues concurrent writes for one lease gets `STALE_VERSION` from the conditional write instead of a sequence error.

## Verification

- Regression — `pnpm test:renderer src/renderer/services/fileEdit/__tests__/FileEditSessionManager.test.ts`: a detached conflicted session no longer blocks `prepareMutation()` and another file's draft is flushed; the test fails when the parked-session filter is removed. A committed write whose reply is lost is adopted as saved on the next flush without a false conflict.
- Regression — `pnpm test:main src/main/services/file/__tests__/FileEditService.test.ts`: conditional writes, target retargeting, competing entry/path writes, metadata recovery and lease close draining keep their contracts without the ledger.
