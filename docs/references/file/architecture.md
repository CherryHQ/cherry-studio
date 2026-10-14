---
description: Current file-domain boundaries, shared types, renderer transports, and business-reference ownership
sources:
  - src/main/services/file
  - src/main/ipc/handlers/file.ts
  - src/main/data/api/handlers/files.ts
  - src/shared/data/types/file.ts
  - src/shared/ipc/schemas/file.ts
---

# File Module Architecture

The file domain has two independent runtime capabilities:

- `FileManager` manages persistent `FileEntry` records and entry-owned file operations.
- `DirectoryTreeManager` manages live, in-memory directory mirrors for renderer consumers.

They share filesystem utilities and the watcher primitive, but a directory tree does not create
`FileEntry` rows and a `FileEntry` does not join a directory tree automatically.

This document describes the current module boundary. FileManager implementation details live in
[FileManager Architecture](./file-manager-architecture.md), and the tree protocol lives in
[Directory Tree Architecture](./directory-tree.md).

## 1. Module Scope

The current implementation is split across four layers:

| Layer | Current owner | Responsibility |
|---|---|---|
| Persistent data | `src/main/data/` | `file_entry`, source-owned reference tables, repositories, and SQL-only DataApi handlers |
| File services | `src/main/services/file/` | Entry lifecycle/content operations, dangling-state cache, orphan cleanup, directory watcher, and directory trees |
| Shared contracts | `src/shared/data/types/file.ts`, `src/shared/types/file/`, `src/shared/ipc/schemas/file.ts` | File entities, handles, filesystem shapes, and IpcApi schemas |
| Renderer adapters | `src/renderer/` | DataApi queries, IpcApi requests, legacy preload calls, and live tree mirrors |

`src/main/utils/file/` contains general main-process filesystem primitives. Code outside the file
domain may use those primitives directly for paths it owns. Files stored as internal `FileEntry`
content must be mutated through FileManager so the DB row, hash, size, and caches stay coherent.

### 1.1 Managed Entries

Every `FileEntry` has one of two origins:

- `internal`: Cherry owns the bytes under `application.getPath('feature.files.data', filename)`.
  The row stores authoritative `name`, `ext`, `size`, and a nullable `contentHash`.
- `external`: Cherry stores a canonical absolute path but does not own the bytes. The row derives
  `name` and `ext` from that path and stores neither size nor content hash. Call File IPC for live
  metadata.

Creation is intentionally asymmetric: `createInternalEntry` always creates a new entry, while
`ensureExternalEntry` reuses an existing canonical-path entry when possible.

### 1.2 FileManager's Position Within the Module

`FileManager` is a `WhenReady` lifecycle service resolved with
`application.get('FileManager')`. Its public methods take `FileEntryId`; it does not accept a
`FileHandle` or own renderer routing. The IpcApi adapter in `src/main/ipc/handlers/file.ts`
dispatches handle-based requests to either FileManager or a path helper.

`DirectoryTreeManager` is a separate `WhenReady` service. It owns builders, consumers, and the
`file.tree.mutation` stream. `DirectoryTreeBuilder` uses the generic watcher in
`src/main/services/file/watcher.ts`, but neither tree class depends on the file-entry database.

`FileEntryService` and `FileRefService` are synchronous, direct-import data services. The former is
the `file_entry` repository; the latter is a read-only projection across business-owned reference
tables.

### 1.3 Out of Scope

FileManager is not a registry for every path the application touches. Examples that stay with
their owning domain include notes and agent workspace trees, logs, caches, backup archives,
configuration files, OCR intermediates, and other temporary artifacts. Such modules may use
`src/main/utils/file/`, their own lifecycle service, or `DirectoryTreeManager` without creating a
`FileEntry`.

Provider upload state is also outside this module today. There is no `file_upload` table or
`FileUploadService` in the current file domain; upload behavior remains with the feature or provider
that performs it.

## 2. Type System: Reference vs Data Shape

### 2.1 Current Type Locations

| Contract | Location |
|---|---|
| `FileEntry`, `FileEntryId`, `FileHandle`, `FileRef`, `DanglingState` | `src/shared/data/types/file.ts` |
| `AbsoluteFilePath`, `FileVersion`, `PhysicalFileMetadata`, directory-listing types | `src/shared/types/file/common.ts` |
| `FileInfo` | `src/shared/types/file/info.ts` |
| Handle factories, path brands, URL helpers, tree classes and DTOs | `src/shared/utils/file/` |
| IpcApi file request/event schemas | `src/shared/ipc/schemas/file.ts` |

`src/shared/types/file/ipc.ts` is the deprecated legacy preload contract. It intentionally carries
migration-era declarations and is not authoritative for routes already defined in
`src/shared/ipc/schemas/file.ts`.

### 2.2 `FileHandle`: the Polymorphic Reference

`FileHandle` selects how one operation reaches a file:

```typescript
type FileHandle =
  | { kind: 'entry'; entryId: FileEntryId }
  | { kind: 'path'; path: AbsoluteFilePath }
```

An entry handle routes through FileManager and participates in entry semantics. A path handle
routes to a path-level helper and does not register or resolve a `FileEntry`. The same physical
file can therefore be addressed by either form with different ownership and side effects.

### 2.3 `FileEntry` vs `FileInfo`

| Shape | Identity | Source | Freshness |
|---|---|---|---|
| `FileEntry` | `id` | SQLite row | Persistent snapshot constrained by `origin` |
| `FileInfo` | absolute `path` | Filesystem projection | Live at construction time |

`FileEntry` is a branded discriminated union. Fields that do not apply to an origin are absent
from its business object even though the flat DB row stores `NULL` in those columns. `FileInfo` is
a branded live descriptor and has no persistent identity. `toFileInfo(entry)` performs the
one-way entry-to-live projection; registering a path requires an explicit FileManager creation
call.

### 2.4 Signature Selection Guide

- Use `FileEntryId` for entry lifecycle, persistent references, and main-side FileManager calls.
- Use `FileHandle` at a boundary that deliberately supports both registered entries and arbitrary
  paths. Dispatch it in the adapter, not inside business logic.
- Use `AbsoluteFilePath` for an operation owned by a filesystem-first module.
- Use `FileInfo` for a live descriptor returned to a leaf consumer, not as a substitute for entry
  identity.
- Use `DirectoryTreeOptions` and the shared tree classes for live hierarchical views; do not derive
  them from `FileEntry` rows.

## 3. Renderer Boundaries

### 3.1 DataApi: SQL-only Reads

`src/main/data/api/handlers/files.ts` exposes the current `/files/*` read surface:

- paginated entries and individual entries;
- exact content-hash candidates and entry statistics;
- batched reference counts;
- references by entry or business source.

These handlers do not touch the filesystem, resolve physical paths, or query `DanglingCache`.
Renderer views compose those SQL results with File IPC only when they need live state.

### 3.2 IpcApi: Filesystem-backed Operations

`src/shared/ipc/schemas/file.ts` and `src/main/ipc/handlers/file.ts` own the migrated routes. They
currently cover binary reads, optimistic writes, metadata, path and dangling-state batches,
internal-entry batch creation, trash operations, rename, open/reveal, and the directory-tree
protocol.

The adapter uses `dispatchHandle` for routes that support both handle kinds:

```text
FileEntryHandle -> FileManager entry method
FilePathHandle  -> path helper under src/main/services/file/
```

Path mutations are guarded against targeting FileManager's managed storage.

### 3.3 Legacy Preload Surface

The migration is incomplete. `FileManager.registerIpcHandlers()` still registers legacy channels
for single internal/external creation, physical-path lookup, permanent deletion, and `runSweep`.
`src/main/ipc.ts` still registers `listDirectory` and `listDirectoryEntries`. Existing renderer
consumers reach these through `window.api.file`.

New file routes should use IpcApi. When changing an existing route, first check whether its live
contract is in `src/shared/ipc/schemas/file.ts` or is still one of the legacy handlers; do not infer
runtime behavior from the deprecated `FileIpcApi` interface.

### 3.4 External Entry Operations

External entries are best-effort references to user-owned paths:

- reads and explicit writes operate on the current bytes at `externalPath`;
- `rename(id, newName)` renames the physical file within its current parent and updates the row;
- `trash` and `restore` reject external entries;
- `permanentDelete(id)` removes only the row and leaves the user's file on disk;
- missing paths are reported through `DanglingState`, not treated as permission to delete the row.

UI copy must distinguish removing an external reference from deleting an internal managed file or
an arbitrary path on disk.

## 4. Layer Ownership

| Need | Owner |
|---|---|
| Query stored entry/ref data | DataApi / data services |
| Create or mutate a `FileEntry` | FileManager |
| Read or mutate a handle from renderer | File IpcApi adapter |
| Use a raw path in a main-owned workflow | `src/main/utils/file/` or a narrow file-domain helper |
| Track a live directory hierarchy | DirectoryTreeManager / `useDirectoryTree` |
| Track external-entry presence | DanglingCache through FileManager/File IPC |

The authoritative physical path of an internal entry is resolved in main from the application path
registry. Renderer code may consume a returned path for display, drag-and-drop, or a subprocess,
but must not reconstruct the managed-storage layout.

## 5. Business Service Integration

### 5.1 Persistent References

Persistent business domains own their association tables, foreign keys, and writes. Current source
tables are registered in `persistentFileRefTablesBySourceType` in
`src/main/data/db/schemas/fileRelations.ts`. `FileRefService` only aggregates them for reads,
reference counts, and cleanup decisions.

Source deletion should cascade its association rows. Multi-write business operations use the
owning service's synchronous `withWriteTx` flow so the source row and its file refs commit together.

### 5.2 Adding a New Reference Source

When a new persistent business object references files:

1. Add a source-owned association table with foreign keys to both the source row and `file_entry`.
2. Add the source type and `FileRef` variant in `src/shared/data/types/file.ts`.
3. Register the table in `persistentFileRefTablesBySourceType`.
4. Extend every exhaustive mapping in `FileRefService` and its tests.
5. Write refs through the owning business service, preferably in the source write transaction.

This registration also feeds the anti-join used by manual-orphan reporting and automatic entry
cleanup. A separate file-domain write API is not needed.

For filesystem access, business services may use `src/main/utils/file/` on paths their own domain
owns. They must not point those helpers at internal FileManager storage: doing so bypasses managed
size/hash updates, the content-write lock, and cache invalidation. Use FileManager for any mutation
identified by `FileEntryId`.

## 6. Lifecycle

Both `FileManager` and `DirectoryTreeManager` are registered in
`src/main/core/application/serviceRegistry.ts` at `Phase.WhenReady`.

- FileManager initializes the external-entry reverse index, registers remaining legacy handlers,
  registers content-hash backfill work, and starts its cleanup interval.
- DirectoryTreeManager creates resources on demand and closes consumers, builders, watchers, and
  WebContents listeners during shutdown.

Production code resolves either service through `application.get(...)`; direct construction is a
test seam.

## 7. Source Map

| Area | Source |
|---|---|
| Entry and ref types | `src/shared/data/types/file.ts` |
| Filesystem value types | `src/shared/types/file/` |
| IpcApi contract | `src/shared/ipc/schemas/file.ts` |
| IpcApi handlers | `src/main/ipc/handlers/file.ts` |
| DataApi contract and handlers | `src/shared/data/api/schemas/files.ts`, `src/main/data/api/handlers/files.ts` |
| FileManager facade and internals | `src/main/services/file/` |
| General main-process filesystem helpers | `src/main/utils/file/` |
| Directory tree renderer mirror | `src/renderer/hooks/useDirectoryTree.ts` |
