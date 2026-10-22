---
description: File editing session ownership, conditional persistence, observation leases, and retained draft recovery
sources:
  - src/main/services/file/FileEditService.ts
  - src/main/services/file/FileObservationManager.ts
  - src/renderer/services/fileEdit
  - src/renderer/hooks/useFileEditSession.ts
  - src/renderer/components/FileEditSessionProvider.tsx
  - src/shared/ipc/schemas/fileEdit.ts
  - src/shared/ipc/schemas/fileObservation.ts
---

# File Editing Sessions

English | [中文](file-editing.zh.md)

## Ownership

`FileEditSessionProvider` creates a window-owned `FileEditSessionManager` in the main and sub-window composition roots. `useFileEditSession` acquires a lease and subscribes with `useSyncExternalStore`; it owns no draft, save timer, or SWR cache. Notes, Skill files, and artifact editing use the same session boundary.

| Owner | Responsibility |
|---|---|
| Renderer manager | Canonical-resource registry, draft and disk baseline, revisions, writer attachment, save queue, replacement and mutation seals, retained draft inventory |
| Editor | Interactive document and undo history; callbacks carry their attachment and document generation |
| `FileEditService` | Window-owned edit leases, pinned entry/path targets, immutable write attempts and terminal receipts |
| `FileObservationManager` | Shared watcher coverage and window-scoped observation subscriptions |
| `DirectoryTreeManager` | Shared tree builders and renderer tree projections; releases its watcher lease independently of editing |

A path and an entry resolving to the same permitted canonical address share a renderer session. Each locator remains separately leased in Main. An accepted edit retains its originating locator, so sharing a draft cannot turn an entry-target check into a path write. Only one attachment is writable; other attachments observe read-only snapshots. Symlink and hard-link alias unification is not promised.

## Persistence contract

| Route | Contract |
|---|---|
| `file.edit.open` | Resolve a handle, enforce path policy, return a pinned edit ID, canonical resource key, and observation root |
| `file.edit.read` | Return a bounded coherent binary snapshot and the hash of those exact bytes |
| `file.edit.write` | Submit immutable bytes with a mandatory expected version/hash and lease-local sequence |
| `file.edit.settle_write` | Recover a terminal receipt; fence a sequence that has not started |
| `file.edit.close` | Stop admission, settle accepted reads/writes, then release the lease and temporary-entry retention |

The 8 MiB limit applies before and during loading. An already-open editor can grow beyond that limit. The codec preserves UTF-8 BOM and LF/CRLF, and rejects unsupported encoding or mixed line endings. Opening or changing editor mode does not serialize an untouched rich document back to disk.

Writes return `committed`, `not-committed`, or `not-started`. A committed receipt includes the new baseline and `metadataRecoveryPending`; a metadata finalization failure must not replay committed bytes. If transport loses a receipt, the renderer settles the same sequence before issuing another write. It retains the attempt and draft while the result remains unknown.

`flush()` captures the current draft and revision immediately. Its target waits behind older writes and cannot be replaced by a later edit. In particular, undoing to the previous disk text while a different save is pending still requires a subsequent write. Autosave debounces unsent edits. Persistent failures pause automatic retry while preserving editing and explicit retry.

Entry writes, entry rename/delete/cleanup, and path mutations coordinate in entry-lock → path-mutex order. Hash validation applies whenever a hash is provided, including equal-size, preserved subsecond timestamps. Atomic replacement does not provide compare-and-swap against arbitrary external programs between validation and rename.

## Replacement and mutations

`documentEpoch` changes for an initial document or explicit replacement, not ordinary edits or save receipts. Notes mount editors by session/epoch and remove the previous string-comparison hydration effect. Programmatic rich-editor hydration is silent. Editor-dependent UI waits for a Tiptap instance when an inactive tab resumes. A separate binding generation rejects callbacks captured before a seal/cancel cycle while preserving the current document and undo history.

`discard()` settles writes and restores the confirmed baseline. `reload()` settles writes before adopting a new disk document. `keepLocal()` seals input, captures the draft, reads a fresh baseline, and conditionally saves the captured text. Failure keeps the draft available.

`prepareMutation(roots)` seals matching sessions and flushes accepted edits. Mutations serialize within a window, temporarily block new attachments, and invalidate acquisitions started before preparation. Callers perform the filesystem operation, then `commit()` retires deleted resources or `commit({ from, to })` verifies and binds moved resources. `cancel()` restores input after a failed operation. A failed post-move verification retains the source snapshot with an error; it cannot undo an already completed filesystem move. Notes use this boundary for rename, move, and deletion, including directories.

## Observation

`file.observe.create` waits for watcher readiness and buffers events until `file.observe.activate`. IDs, generations, owner windows, sequence numbers, and bounded queues protect the handshake. `file.observe.dispose` releases one subscription; the final lease closes the native watcher. Equivalent roots/options/filter policies can share coverage with a tree builder.

The renderer observes parent directories independently of visible trees. Events invalidate knowledge; they never carry a replacement draft. The session rereads and checks its read generation, revision, pending writes, and seals before adopting a result. Notifications deferred during a save or sealed transition are revalidated when the session becomes available. Dirty content stays in memory and conflicting bytes pause saves. Gaps, overflow, and watcher errors trigger resubscription with bounded backoff and revalidation. Modification times alone never dismiss an editing event as a self-save echo.

## Closing and recovery

Closing a file view releases its attachment and attempts to flush accepted edits while the renderer remains alive. Window close, application quit, relaunch, renderer reload, and pool reset retain their existing lifecycle behavior; there is no file-edit preparation barrier for those operations. Unsaved in-memory drafts are not guaranteed to survive them.

Main releases editing leases and observation subscriptions when their owner window is destroyed or the services stop, settling already accepted file operations. This cleanup cannot save edits that never reached Main. Reloading a renderer does not itself guarantee disposal of all leases held by its previous document.

Releasing a view does not discard a dirty, failed, conflicted, or unknown-outcome session. The window recovery surface lists detached drafts and offers copy/retry/discard. Clean settled sessions release observations and Main leases after their attachments leave. This is in-process retention, not a crash-recovery journal or collaboration history.

## Verification boundaries

Service tests cover real filesystem hashes, alias contention, rename, lease ownership, settlement fences, and metadata recovery. Renderer tests cover switching, stale callbacks, pinned flush targets, undo during save, failed-draft retention, replacement, mutation seals, composition veto, and observer reconnection. Platform-specific Electron acceptance and broader CI remain separate from these local contracts.
