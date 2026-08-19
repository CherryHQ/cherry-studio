---
description: Current FileManager storage, lifecycle, atomic-write, watcher, dangling-cache, and orphan-cleanup behavior
sources:
  - src/main/services/file
  - src/main/data/services/FileEntryService.ts
  - src/main/data/services/FileRefService.ts
  - src/main/data/db/schemas/file.ts
  - src/shared/data/types/file.ts
---

# FileManager Architecture

`FileManager` is the lifecycle-managed facade for operations whose target is a `FileEntryId`.
This document records the current implementation; it does not reserve APIs for future upload,
event-broadcast, or watcher features.

For the cross-module type and transport boundaries, see
[File Module Architecture](./architecture.md).

## 1. Core Concepts

### 1.1 FileEntry

`FileEntry` is a branded discriminated union backed by the flat `file_entry` table. The database
enforces origin, size, content-hash, trash, and cleanup-policy invariants with CHECK constraints;
`FileEntryService` converts each row into the origin-specific business object and validates it with
`FileEntrySchema`.

| Field | Internal entry | External entry |
|---|---|---|
| `id` | UUID; also names the managed blob | UUID identifying the stored reference |
| `name`, `ext` | Managed display metadata | Projection of `externalPath` |
| `size` | Required and authoritative | Absent from the business object; DB value is `NULL` |
| `contentHash` | Tagged XXH3-64 value or `null` while unknown/recovering | Absent; DB value is `NULL` |
| `externalPath` | Absent | Required canonical absolute path |
| `deletedAt` | Optional trash timestamp | Absent; external entries cannot be trashed |
| `cleanupPolicy` | `manual` or `delete_when_unreferenced` | Same |

Persistent relationships are stored in source-owned association tables. `FileRefService` is a
read/count facade over the registered tables, not their write owner.

### 1.2 Origin and External-Path Identity

Internal entries own their content. External entries are best-effort references: another process
may edit, move, or remove the file at any time, and Cherry does not mirror those changes into a
second copy.

`ensureExternalEntry` validates existence on insert, canonicalizes the input, and uses the
canonical path as its upsert identity. Reusing an entry may upgrade
`delete_when_unreferenced -> manual`; it never implicitly demotes a manual entry.

Canonicalization is lexical and byte-faithful:

- it resolves `.` and `..`, strips trailing separators, and normalizes the Windows drive/separator
  form;
- it does not Unicode-normalize or resolve symlinks at storage time;
- `AbsoluteFilePath` accepts UNC shape, but `canonicalizeFilePath` rejects UNC because UNC is not a
  supported persistent dedup key.

#### Duplicate-Entry Detection on Insert

The exact canonical-path lookup handles ordinary reuse. The database also has a unique index on
`lower(externalPath)`. Before insert, FileManager compares case-insensitive peers with
`fs.realpath`: it reuses a peer that resolves to the same filesystem entity and throws a
domain-readable case-collision error when distinct files would violate the index.

#### Rule-Evolution Discipline

Any change to the canonical form must ship with an appended migration that rewrites existing
external rows and resolves collisions while preserving every source-owned reference. Changing only
the runtime helper would make lookups disagree with stored keys; read-time repair would change
persisted identity silently.

#### UNC Paths

UNC paths may be used where an `AbsoluteFilePath` is sufficient, such as direct filesystem access
on Windows. They cannot be persisted through `ensureExternalEntry` because
`CanonicalFilePathSchema` deliberately excludes them.

#### Rejected: Unicode (NFC) Normalization of `externalPath`

Stored external paths retain their original Unicode bytes. Normalizing a path can make it point to
a different or nonexistent filesystem entry on normalization-sensitive filesystems.

### 1.3 Content Hashes

Internal writes derive `size` and the tagged content hash from the prepared byte stream. Hashes are
non-unique and support candidate lookup; they are not entry identity and `createInternalEntry`
does not deduplicate automatically.

At startup, `ensureContentMetadataGeneration()` invalidates hashes from an obsolete generation.
After all services are ready, FileManager enqueues the idempotent `file.contenthash-backfill` job
when internal rows still have a null hash. Foreground writes and backfill share a per-entry lock.

### 1.4 FileRef

Each persistent source table owns its foreign keys and mutations. Deleting a source row cascades
its refs. FileManager cleanup asks `FileRefService` only whether registered persistent refs remain;
it does not call per-domain deletion hooks.

### 1.5 Provider Uploads

The file module has no `file_upload` table or `FileUploadService`. Provider-specific upload
behavior is not part of FileManager's public contract.

### 1.6 FileManager Implementation Layout

`FileManager.ts` owns lifecycle, dependency wiring, remaining legacy IPC handlers, a per-entry
content-write lock, active write-stream shutdown, and the cleanup schedule. Operations are
delegated to focused modules:

#### 1.6.1 Owned State

The service instance owns the keyed content-write lock, active atomic streams, cleanup timestamps,
and a bounded `VersionCache`. Data repositories and `DanglingCache` are shared dependencies. Keeping
the version cache per instance gives direct-construction tests isolated state.

```text
src/main/services/file/
├── FileManager.ts
├── internal/
│   ├── content/       # read, hash, atomic write
│   ├── entry/         # create, lifecycle, rename, copy
│   ├── system/        # shell operations, temporary copies
│   ├── entryCleanup.ts
│   ├── orphanSweep.ts
│   └── observe.ts
├── tasks/             # content-hash generation/backfill
├── tree/              # separate directory-tree capability
├── utils/             # file-domain path/content/metadata guards
├── danglingCache.ts
├── watcher.ts
└── versionCache.ts
```

Main-process consumers resolve the service with `application.get('FileManager')`. They import the
public facade and narrow helpers from `@main/services/file`; `internal/*` is not a consumer API.

#### 1.6.5 FileHandle Dispatch Convention

FileManager methods are entry-native and take `FileEntryId`. The IpcApi adapter owns
`FileHandle.kind` dispatch:

- entry arm -> FileManager;
- path arm -> a narrow path helper exported by `@main/services/file`.

This is live for read, metadata, optimistic write, open, and show-in-folder routes. The remaining
legacy permanent-delete channel uses the same dispatcher. There is no reason for business code to
wrap an ID in a handle before calling FileManager directly.

## 2. Storage Architecture

### 2.1 Physical Path Rules

Internal content lives at:

```text
application.getPath('feature.files.data', `${entry.id}${entry.ext ? `.${entry.ext}` : ''}`)
```

External content resolves directly to `entry.externalPath`. All application-owned paths are
obtained through the application path registry.

### 2.2 Creation and Temporary Copies

`createInternalEntry` accepts path, URL, base64, or bytes input. It prepares and commits a managed
blob, then inserts the row with derived size/hash. A failed DB insert triggers best-effort blob
cleanup.

`withTempCopy` creates an isolated directory under
`application.getPath('feature.files.tempcopy.temp')`, copies the entry into it, invokes the caller,
and removes the directory in `finally`. Cleanup failure is logged without replacing the caller's
original error.

## 3. External Entry Liveness Model

`DanglingState` is runtime state, not a database column:

- internal entries always return `present`;
- external entries use a 30-minute cache and stat on a miss or expired observation;
- `ENOENT` and `ENOTDIR` become `missing`;
- permission and other indeterminate stat errors return `unknown` and are not cached.

The cache starts with a reverse index of external paths but does not stat every row at startup.
Reads and metadata/hash/version operations record a missing observation when they encounter
`ENOENT`; successful external-entry insertion and rename record presence.
There is no renderer event fan-out for dangling-state changes. Renderer callers use the batch
IpcApi query and their normal refetch lifecycle.

## 4. Version Detection and Concurrency Control

`FileVersion` is `{ mtime, size }` from a live stat. `writeIfUnchanged` serializes writes by entry,
prepares the replacement, then re-stats the target before committing. A mismatch throws
`StaleVersionError` (mapped to a file-domain IpcError by the adapter).

When the observed mtime has whole-second precision and size is unchanged, a caller can also supply
the expected content hash. The implementation hashes the current target in that ambiguous case
before deciding whether the write is stale.

### 4.4 LRU Version Cache

Each FileManager instance owns a bounded `VersionCache`. Current writes update it, external rename
invalidates it, and deletion removes the cached entry, but correctness does not depend on a cache
hit: `getVersion` and the optimistic write comparison read live filesystem state. Do not treat the
cache as a source of truth.

## 5. Atomic Writes

### 5.1 Prepared Commit Flow

File writes use the primitives in `src/main/utils/file/fs.ts`:

1. write a uniquely named temporary file in the target directory;
2. flush and close the temporary file;
3. rename it over the target;
4. return the committed filesystem version.

Keeping the temporary file beside the target avoids a cross-filesystem rename. Aborting or
destroying an `AtomicWriteStream` removes the temporary file; only `.end()` enters the commit path.

For internal entries, FileManager first marks content metadata pending, commits the prepared bytes,
then stores the prepared size/hash. If bytes commit but DB finalization fails, the hash remains null
as a durable recovery marker and `ContentCommittedMetadataPendingError` tells callers to refresh,
not retry blindly.

## 6. Trash, Delete, and Rename

- `trash` and `restore` only update internal entries' `deletedAt` state.
- `permanentDelete` deletes the row first. It then best-effort unlinks an internal blob; an external
  path is never removed by this entry operation.
- Batch delete/trash operations return per-ID successes and failures.
- Internal rename changes display metadata; its UUID-based physical path is unchanged.
- External rename moves the file inside its current parent and updates path/name in the DB. On a
  DB failure, the implementation best-effort moves the file back.

## 7. Reference Cleanup

`manual` entries with no persistent refs are preserved and can be reported by the DB sweep.
`delete_when_unreferenced` entries are reclaimed by the scan-based pass described in
[File Entry Cleanup](./file-entry-cleanup.md). Dangling state is not a cleanup predicate.

## 8. DirectoryWatcher

The current watcher is the single file `src/main/services/file/watcher.ts`, not a `watcher/`
submodule.

### 8.1 Current API

`createDirectoryWatcher(root, options)` returns a watcher synchronously:

```typescript
interface DirectoryWatcher {
  onEvent(listener: (event: WatcherEvent) => void): () => void
  close(): Promise<void>
}
```

### 8.2 Supported Events and Options

The event union is `add | addDir | unlink | unlinkDir | change | ready | error`. Chokidar rename
activity remains an `unlink` plus `add`; the generic watcher does not detect or emit rename events.
Options cover recursion/depth, an ignore predicate, write-stability threshold, and whether the
initial scan emits entries.

Built-in OS-junk names are always ignored. On `EMFILE`, and on Windows `EPERM`, the wrapper retries
with polling. Other errors are logged and emitted. `close()` is idempotent.

The factory mirrors file `add`/`unlink` observations into `DanglingCache`. The only production
constructor today is `DirectoryTreeBuilder`; there is no global watcher covering every external
entry.

## 9. Provider Upload Boundary

FileManager supplies entry reads and `withTempCopy` to callers that need bytes or a temporary path.
It does not cache provider upload identifiers. Any future provider-upload architecture needs its
own concrete consumers and contract rather than extending the file reference model speculatively.

## 10. Orphan Sweep

Three related passes have distinct jobs:

| Pass | Current behavior |
|---|---|
| Entry cleanup | Deletes eligible `delete_when_unreferenced` rows, then best-effort removes internal blobs |
| DB sweep | Reports active `manual` entries with zero persistent refs; does not delete them |
| File sweep | Removes old UUID-named blobs without a DB row and old `*.tmp-<uuid>` residue |

The file sweep ignores non-files and candidates newer than five minutes. It plans before deleting
and aborts large plans when at least 20 files or 10 MiB are involved and the planned candidates
exceed half of the candidate count or bytes. A pending staged restore makes all passes stand aside.

FileManager runs entry cleanup on startup and on its idle-gated interval. The file sweep shares the
idle tick with a seven-day floor. Cache Cleanup calls `inspectOrphanFiles()` for preview and
`cleanupOrphanFiles()` for execution. The legacy `runSweep()` channel composes entry cleanup, file
sweep, and DB reporting, but currently has no renderer caller.

## 11. DanglingCache

### 11.1 State and Indexes

The singleton keeps an entry-ID cache plus a reverse index from external path to entry IDs.
`ensureExternalEntry`, external rename, and deletion maintain the reverse index. The cache exposes
an in-process subscription event only on genuine state transitions.

### 11.2 Refresh Rules

A concrete `present` or `missing` observation is cached with its timestamp. `unknown` represents a
lack of trustworthy observation and is never committed. Same-state observations refresh the cache
without emitting another transition.

### 11.3 Watcher Auto-Wiring

Every `createDirectoryWatcher` instance forwards file `add` and `unlink` paths to the reverse index.
That updates only external entries whose stored path exactly matches the emitted path. Directory
events and file `change` events are not presence transitions.

Because watcher coverage is opportunistic, `DanglingCache.check()` remains the correctness path:
it stats on a miss or expired cache entry. A missed watcher event delays a UI update but does not
make the stored state permanent.

## 12. Key Runtime Decisions

- FileManager stays entry-native; renderer handle dispatch belongs to the IPC adapter.
- External paths are referenced, not mirrored, and are never physically removed by entry cleanup.
- Optimistic concurrency trusts live stat/hash checks rather than cached versions.
- Automatic entry cleanup is policy- and ref-driven; dangling state never authorizes deletion.
- The generic watcher exposes raw normalized events and does not infer renames.

## 13. Verification Map

| Concern | Primary tests |
|---|---|
| Entry facade and lifecycle | `src/main/services/file/__tests__/FileManager.integration.test.ts` |
| Entry creation, mutation, and atomic writes | `src/main/services/file/internal/**/__tests__/` |
| Cleanup and orphan safety | `src/main/services/file/internal/__tests__/entryCleanup.test.ts`, `orphanSweep.test.ts` |
| Watcher contract and fallback | `src/main/services/file/__tests__/watcher.test.ts`, `watcher.errors.test.ts` |
| Dangling state | `src/main/services/file/__tests__/danglingCache.test.ts` |
| IpcApi adapter | `src/main/ipc/handlers/__tests__/file.test.ts` |
