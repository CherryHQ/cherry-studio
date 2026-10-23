---
description: Independent file editing drafts, conditional persistence, revalidation, and retained draft recovery
sources:
  - src/main/services/file/FileEditService.ts
  - src/renderer/services/fileEdit
  - src/renderer/hooks/useFileEditSession.ts
  - src/renderer/components/FileEditSessionProvider.tsx
  - src/shared/ipc/schemas/fileEdit.ts
---

# File Editing Sessions

English | [中文](file-editing.zh.md)

## Ownership

`FileEditSessionProvider` creates a window-owned `FileEditSessionManager`. `useFileEditSession(handle, ownerId)` subscribes to its snapshots; the hook owns no draft, save timer, or SWR cache.

| Owner | Responsibility |
|---|---|
| Renderer manager | Independent drafts, disk baselines, revisions, save queues, attachment generations, mutation barriers, and retained draft inventory |
| Editor | Interactive document and undo history; callbacks carry attachment and document generations |
| `FileEditService` | Window-owned edit leases, pinned filesystem targets, immutable write attempts, and terminal receipts |
| `DirectoryTreeManager` | Existing directory tree watchers and tree invalidation events |

Notes, each Skill, and each Agent artifact surface use distinct stable owner IDs. The registry matches an owner plus the exact handle kind and locator. Reopening that locator within the same owner restores a retained draft. A replacement attachment invalidates its predecessor's callbacks. Different owners, path aliases, and entry/path handles do not share drafts or elect a writer. Recovery actions address the unique `sessionId`, not a filesystem path.

## Persistence contract

| Route | Contract |
|---|---|
| `file.edit.open` | Resolve a handle, enforce path policy, pin its target, and return an opaque `editId` |
| `file.edit.read` | Return a bounded coherent binary snapshot and the hash of those exact bytes |
| `file.edit.write` | Submit immutable bytes with a mandatory expected version/hash and lease-local sequence |
| `file.edit.settle_write` | Recover a terminal receipt; fence a sequence that has not started |
| `file.edit.close` | Stop admission, settle accepted reads/writes, and release the lease and temporary-entry retention |

Main resolves the original filesystem locator with asynchronous `realpath`, without first collapsing dot segments. It keeps the resolved target private and checks the locator again for subsequent reads and writes. Retargeting a symlink or moving an entry invalidates the old lease. Writes replace the resolved target while preserving a final symlink. Raw path access must pass managed-storage policy checks for both the requested address and the actual target. This pins an address, not an inode identity across arbitrary external replacements.

The 8 MiB limit applies before and during loading. An already-open editor can grow beyond that limit. The codec preserves UTF-8 BOM and LF/CRLF, and rejects unsupported encoding or mixed line endings. Opening or changing editor mode does not serialize an untouched rich document back to disk.

Writes return `committed`, `not-committed`, or `not-started`. A committed receipt includes the new baseline and `metadataRecoveryPending`; a metadata finalization failure must not replay committed bytes. If transport loses a receipt, the renderer settles the same sequence before issuing another write. It retains the attempt and draft while the result remains unknown.

`flush()` captures the current draft and revision immediately. Its target waits behind older writes and cannot be replaced by a later edit. Undoing to the previous disk text while a different save is pending still requires a subsequent write. Autosave debounces unsent edits. Persistent failures pause automatic retry while preserving the draft and explicit retry.

Entry writes, entry rename/delete/cleanup, and path mutations coordinate in entry-lock → path-mutex order. Hash validation detects changed bytes even when size and timestamps match. Independently opened editors can both edit; a stale save reports a conflict and retains its local draft. Atomic replacement does not provide compare-and-swap against arbitrary external programs between validation and rename.

## Replacement and mutations

If the current acquisition fails before an editing instance exists, `flush()` and `discard()` complete without work so navigation can continue. Loading acquisitions still reject these commands; errors on an existing instance retain its normal draft and write-settlement protections. `reload()` and `keepLocal()` require an instance.

`documentEpoch` changes for an initial document or explicit replacement, not ordinary edits or save receipts. Notes mount editors by session/epoch. Programmatic rich-editor hydration is silent. A separate binding generation rejects callbacks from replaced attachments or before a mutation barrier while preserving the current document and undo history.

`discard()` settles writes and restores the confirmed baseline. `reload()` settles writes before adopting a new disk document. `keepLocal()` seals input, captures the draft, reads a fresh baseline, and conditionally saves the captured text. Failure retains the draft.

`prepareMutation()` seals and flushes all retained sessions in the window. Composition, concurrent transitions, conflicts, save failures, and unresolved write outcomes block preparation. New acquisitions wait; interrupted acquisitions release their stale leases and retry. This conservative window-wide barrier avoids inferring affected resources from path prefixes.

After preparation, the caller performs rename, move, or deletion and calls the idempotent `finish()` in `finally`, including when the filesystem operation fails. It revalidates attached sessions, then releases the barrier. A missing or changed target becomes unavailable; the caller opens a destination as a new editing instance. The manager does not remap paths or transfer drafts across owners. Detached clean sessions are evicted; failed or unsaved sessions remain recoverable.

## Revalidation

Notes and Skills reuse existing tree invalidation callbacks. Active editors also reread on window focus, visible-document transitions, and reactivation. Editing adds no dedicated watcher service or shared watcher pool. Notifications invalidate knowledge; they never supply a replacement draft. Save correctness relies on conditional writes even when notifications are delayed or absent.

A reread checks its generation, draft revision, pending writes, and mutation barrier before adopting a result. Clean content can refresh; dirty content remains in memory and differing disk bytes set a conflict. Notifications deferred during a save or barrier are revalidated when the session becomes available.

A transient observation read failure is logged and leaves freshness unknown. It does not erase the draft or create a save failure. Missing/retargeted leases, or failed revalidation during mutation completion, make the current binding unavailable. An explicit reload can clear the read error after a successful read; actual save failures retain their separate retry state.

## Closing and recovery

Closing a file view releases its attachment and attempts to flush accepted edits while the renderer remains alive. A window recovery surface lists detached drafts with their owner and locator and offers copy/retry/discard. Clean settled sessions release Main leases after their attachments leave. Main also releases leases when their owner window is destroyed or the service stops, settling accepted operations.

Window close, application quit, relaunch, renderer reload, and pool reset retain their existing lifecycle behavior; they have no file-edit preparation barrier. Main cleanup cannot save edits that never reached it, and renderer reload does not itself guarantee disposal of the previous document's leases. In-memory drafts are not guaranteed to survive these operations. Retention is not a crash-recovery journal or collaboration history.

## Verification boundaries

Service tests cover real filesystem hashes, symlink traversal and retargeting, independent lease contention, rename ordering, settlement fences, and metadata recovery. Renderer tests cover independent owner drafts and conflicts, switching, stale callbacks, pinned flush targets, undo during save, retention, replacement, mutation barriers, and composition veto. Electron acceptance and broader CI remain separate from these contracts; local filesystem tests do not establish network filesystem guarantees.
