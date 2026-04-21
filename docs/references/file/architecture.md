# File Module Architecture

> **This document is the Source of Truth for the file module architecture**, focusing on module boundaries, component responsibilities, IPC design, and service integration.
>
> **Phase note**: this document mixes two layers of truth:
> - **Current Phase 1a reality** — DB schema, shared types, IPC/DataApi contracts, and design constraints that already exist in code
> - **Planned Phase 1b+ structure** — the concrete `FileManager extends BaseService` lifecycle-service implementation and its `internal/*` execution layout
>
> When a section describes FileManager as a lifecycle service / facade class, read that as the **target implementation shape**, not as "already fully implemented in this phase". In the current phase, `src/main/file/FileManager.ts` is still contract-first: it exports the public type surface and JSDoc that the later lifecycle implementation must satisfy.
>
> Related documents:
>
> - `docs/references/file/file-manager-architecture.md` — FileManager submodule design (FileEntry model, origin semantics, atomic writes, version detection, DirectoryWatcher, AI SDK integration)
> - `v2-refactor-temp/docs/file-manager/rfc-file-manager.md` — Implementation design document (Drizzle Schema, API details, Phase planning, migration strategy)

---

## 1. Module Scope

### 1.0 Core Principle

> **FileManager manages files introduced via explicit calls to `createInternalEntry` / `ensureExternalEntry`**—files exist as one of two origins: `internal` (Cherry owns the content) or `external` (records a path reference only). Which origin the caller chooses is a business-layer decision; FileManager makes no assumptions about it.

### 1.0.1 Semantics of Origin

The `origin` field on a FileEntry defines content ownership, with two values:

- **`internal`**: Cherry owns the file content, physically stored at `{userData}/files/{id}.{ext}`. The caller hands a Buffer/Stream/source file to FileManager, which copies and takes ownership.
- **`external`**: Cherry only records an absolute path reference on the user's side, does not copy content, and does not own the file. File availability and content changes are determined by the user side.

Which origin to pick is the **caller's** decision; FileManager makes no assumption about the business layer. For the specific caller's migration/current state, see the RFC.

### 1.0.2 Best-effort Semantics for External

An external entry is a persistent record that "the caller expressed the intent to reference this path at some point in time"—analogous to the "best-effort external reference" seen in tools like codex. It does not guarantee the file remains stable, nor that the content matches what it was when first referenced. Cherry does not actively mirror FS changes; instead, FS changes naturally surface as "reading new content next time" or "the entry turns dangling".

### 1.1 What the File Module Includes

```
File Module (src/main/file/)
│
├── index.ts              ← module barrel; exports only FileManager + public types
│                           (internal/* is not exported; external imports can't reach it)
│
├── FileManager.ts        ← public contract surface in Phase 1a; planned to become the sole lifecycle service + public facade in Phase 1b+
│     │                     public methods are thin delegates to internal/*; owns versionCache
│     │                     responsible for IPC registration and FileHandle.kind dispatch
│     ├── FileEntry lifecycle (create-or-upsert / write / trash / restore / rename / copy / permanentDelete)
│     ├── Version detection & concurrency control (read / writeIfUnchanged / withTempCopy)
│     ├── Metadata & system ops (getMetadata / open / showInFolder / refreshMetadata)
│     ├── registerIpcHandlers() — unified IPC entry, dispatches by FileHandle.kind
│     └── Electron dialog (showOpenDialog / showSaveDialog)
│
├── internal/             ← private implementation, not re-exported by index.ts; external imports forbidden
│     │                     every pure function explicitly receives FileManagerDeps (repo/versionCache/danglingCache)
│     ├── deps.ts               — FileManagerDeps type
│     ├── entry/
│     │    ├── create.ts        — createInternal / ensureExternal
│     │    ├── lifecycle.ts     — trash / restore / permanentDelete + batches
│     │    ├── rename.ts
│     │    ├── copy.ts
│     │    └── refresh.ts       — refreshMetadata / getMetadata
│     ├── content/
│     │    ├── read.ts          — read / createReadStream (including unmanaged variants)
│     │    ├── write.ts         — write / writeIfUnchanged / createWriteStream
│     │    └── hash.ts          — getContentHash / getVersion
│     ├── system/
│     │    ├── shell.ts         — open / showInFolder
│     │    └── tempCopy.ts      — withTempCopy
│     └── orphanSweep.ts        — startup orphan scan task
│
├── versionCache.ts       ← LRU type definition; instance held as private field on FileManager
│
├── danglingCache.ts (singleton)
│     ├── check(entry): DanglingState — query in-memory / cold-path stat
│     ├── onFsEvent(path, state) — receives watcher events
│     ├── Reverse index Map<path, Set<entryId>> (populated from DB at file_module startup)
│     └── Queried by DataApi handler; automatically wired by the watcher factory
│
├── watcher/
│     └── DirectoryWatcher (not a service, a generic FS monitoring primitive)
│         ↳ factory createDirectoryWatcher() auto-wires events into danglingCache
│
└── ops/ (pure functions, sole FS owner, open to the entire main process)
      ├── fs.ts       — basic FS: read / write / stat / copy / move / remove
      │                 atomic write: atomicWriteFile / atomicWriteIfUnchanged / createAtomicWriteStream
      │                 version: statVersion / contentHash (xxhash-128)
      ├── shell.ts    — system ops: open / showInFolder
      ├── path.ts     — path utils: resolvePath / isPathInside / canWrite / isNotEmptyDir
      ├── metadata.ts — type detection: getFileType / isTextFile / mimeToExt
      └── search.ts   — directory search: listDirectory (ripgrep + fuzzy matching)

Data Module dependencies (src/main/data/)
├── FileEntryService (data repository, pure DB) — file_entry table
├── FileRefService (data repository, pure DB) — file_ref table
└── DataApi Handler (files.ts) — no fs-side-effect endpoints, optionally carries dangling state
```

**Deferred implementation**:

- **`FileUploadService` + `file_upload` table + `FileUploadRepository`** — integrates with Vercel AI SDK's Files Upload API. The AI SDK API is still pre-release and its dependency is unstable, so this is deferred to a separate PR after the SDK reaches a stable version. The design is preserved in `file-manager-architecture.md §9` for reference.

### 1.2 FileManager's Position Within the Module

**Implementation-status note**: the bullets below describe the intended steady state once the lifecycle-backed FileManager lands. In Phase 1a, treat them as architectural commitments, not as a claim that the concrete `BaseService` subclass already exists in code.

FileManager is the core submodule of the file module, but is not equivalent to the file module as a whole.

- **FileManager** is the **sole public entry point** for the entry management system—responsible for the full lifecycle and content operations of FileEntry. Its public API only accepts `FileEntryId` / `FileHandle`. At startup, it performs an orphan sweep in the background (cleaning up leftover internal UUID files), **without blocking the ready signal**.
- **FileManager is a facade, not a God class**—business methods are implemented as pure functions under `internal/*` (`(deps, params) => result`); the FileManager class only handles IPC registration, `FileHandle.kind` dispatch, and persists `versionCache`. See [FileManager Architecture](./file-manager-architecture.md) for details.
- **DanglingCache** is a file_module singleton—maintains the `'present' | 'missing'` state of external entries, pushed by watcher events, with cold-path stat as a fallback, and served to the renderer via opt-in DataApi handler.
- **DirectoryWatcher** is a generic FS primitive, **not a lifecycle service**; business modules (such as a future NoteService) new/dispose instances themselves via the `createDirectoryWatcher()` factory; the factory internally wires events into DanglingCache.
- **ops.ts** is on the same level as FileManager—provides pure FS/path operations that don't depend on the entry system, and is open to the entire main process.

#### Public / Private Boundaries

| Location | Visibility | Access |
|---|---|---|
| `FileManager` class + public types | **Entire main process** | **Today (Phase 1a):** import public types from `@main/file`. **Planned (Phase 1b+):** resolve the runtime instance via `application.get('FileManager')` once the lifecycle service is implemented |
| `ops/*` | **Entire main process** | `import { atomicWriteFile } from '@main/file/ops'` (BootConfig, MCP oauth, etc. can use directly) |
| `watcher/` (`createDirectoryWatcher` factory) | **Entire main process** | Business services call this when they need to watch external directories |
| `danglingCache` | **Internal to file-module** | External callers read it via DataApi `includeDangling`; never imported directly |
| `internal/*` | **Only FileManager** | All other locations (including `ops/` / `watcher/` within file-module) must not import it |

Boundary enforcement: `src/main/file/index.ts` barrel does not re-export `internal/*`; external `import from '@main/file'` cannot reach it. If violations are found during Phase 1b implementation, add an ESLint `no-restricted-imports` rule as a fallback.

### 1.3 Out of Scope

The following categories are **not** managed by the File Module (no FileEntry is produced):

| Category | Owner | Why it's not managed by FileManager |
|---|---|---|
| Notes file tree (files browsed/edited inside the Notes app) | Notes module (FS-first) | Notes has its own notes dir storage and external editor compatibility; the file tree is managed by the Notes domain and is **not mirrored wholesale into FileEntry**. |
| Knowledge base vector index | KnowledgeService | Auto-generated derived data, not a user file |
| MCP server configuration | MCP module | System/user configuration, not user-uploaded files |
| Preference / BootConfig | Config module | Application state |
| Log files | LoggerService | Auto-generated |
| Backup / export files | Corresponding business | Business-generated artifacts in transit |
| Agent workspace files | AgentService | Agent-produced at runtime |
| OCR / PDF pagination intermediates | Business module / `os.tmpdir` | Temporary computational artifacts |
| Real-time sync mirror of external directories | Business module assembles with DirectoryWatcher | File_module does not do bidirectional DB-FS sync |

**Note**: The table above is the boundary for "certain business data does not enter FileManager", not "certain file types don't enter". The same physical file can simultaneously belong to an FS-first business domain AND an external FileEntry (the latter is merely a reference to that path)—these are not mutually exclusive.

These modules manage their own files and may use `node:fs` or `ops/*` directly; they are not bound by the FileManager of the file module.

---

## 2. Type System: Reference vs Data Shape

### 2.1 Two Layers of File Types

The file module organizes its types along two orthogonal axes — and whether the file is *managed* (Cherry has registered a FileEntry for it) or *unmanaged* (just a path on disk):

```
                    Managed                           Unmanaged
                    ───────                           ─────────
Reference layer     ManagedFileHandle                 UnmanagedFileHandle
(across boundaries) { kind: 'managed', entryId }      { kind: 'unmanaged', path }
                          │                                 │
                          ▼ FileManager.getEntry            ▼ ops.stat + projection
Data-shape layer    FileEntry                         FileInfo
(after resolution)  { id, origin, name, ext,          { path, name, ext, size,
                      size, trashedAt, ... }            mime, type, modifiedAt, ... }
```

"Managed vs unmanaged" is a property of the **file itself** at the moment of the call, not a preference of the consumer. The reference layer (`FileHandle`) is the polymorphic currency that lets a single IPC call accept either kind; the data-shape layer is what the handler works with after dispatching.

### 2.2 `FileHandle`: the Polymorphic Reference

`FileHandle = ManagedFileHandle | UnmanagedFileHandle` (see [`packages/shared/file/types/handle.ts`](../../../packages/shared/file/types/handle.ts)) is the first-class reference type crossing the IPC boundary. Every IPC method that makes sense on *both* managed and unmanaged files accepts a `FileHandle`; handlers dispatch internally on `handle.kind`. See §3.3 for the full dispatch table.

Use `FileHandle` whenever a signature does not *inherently* require managed-file identity.

### 2.3 `FileEntry` vs `FileInfo`

Once a handle is dispatched, the handler works with either a `FileEntry` (the DB row for a managed file) or a `FileInfo` (a live descriptor of an unmanaged file). They are the two "data shapes" of a file:

| Aspect         | `FileEntry`                                                | `FileInfo`                                                |
|----------------|------------------------------------------------------------|-----------------------------------------------------------|
| Role           | DB row for a managed file                                  | Descriptor for an unmanaged file                          |
| Identity field | `id` (UUID v7)                                             | `path` (absolute filesystem path)                         |
| Liveness       | Snapshot — decoupled from physical state                   | Live view — re-read from `fs.stat`                        |
| Lifecycle      | Persistent; trash/restore (internal only)                  | Transient — per-call descriptor                           |
| Produced by    | `createInternalEntry` / `ensureExternalEntry` / DataApi    | `ops.stat(path)` / `toFileInfo(entry)`                    |
| Typical use    | FileManager ops, UI management panels, `file_ref` creation | Pure content processors (OCR, hashing, tokenization)      |

**Field overlap is inherent, not redundant**: `name`, `ext`, `size`, `type` (and `mime` on `FileInfo`) describe a file regardless of whether it is managed. What distinguishes the two types is the *surrounding* fields and the *semantics* of the shared ones:

- **`FileEntry` has identity fields** `FileInfo` lacks: `id`, `origin`, `externalPath`, `trashedAt`.
- **`FileInfo` has live fields** `FileEntry` lacks: `path` (derived, never stored on `FileEntry`), `modifiedAt`.
- **Same-named fields have different invariants**. `FileInfo.size` is live from `fs.stat`; `FileEntry.size` for an external entry is a last-observed snapshot that may drift until `refreshMetadata`. Mixing them up is a silent correctness bug.

**Projection is one-way**. `FileEntry → FileInfo` is always possible via `toFileInfo(entry)` (async — performs `fs.stat` plus path resolution based on `origin`). The reverse is **not a type conversion**: it is a state change, and requires explicit registration through `FileManager.createInternalEntry` or `ensureExternalEntry`. The Zod brand on `FileEntrySchema` enforces this — arbitrary object literals cannot satisfy the `FileEntry` type.

### 2.4 Signature Selection Guide

Default to the narrowest type that covers the need. "When in doubt, `FileHandle`" for cross-boundary calls, and "when in doubt, `FileInfo`" for leaf content processors.

| What the consumer needs                                                                 | Signature                                |
|-----------------------------------------------------------------------------------------|------------------------------------------|
| Doesn't care whether managed; just operates on a file                                   | `FileHandle` ⭐ default for IPC          |
| Only to call a FileManager lifecycle op (trash, restore, permanentDelete, …)            | `FileEntryId`                            |
| Only to hand a path to an ops-level FS function                                         | `FilePath`                               |
| The managed record's fields (UI management panel, origin-aware rendering, ref creation) | `FileEntry`                              |
| A resolved on-disk descriptor for pure content processing                               | `FileInfo` (typically a return type)     |

Anti-patterns to avoid:

- **Requiring `FileEntry` when only `path` or `size` is read** — this couples the caller to the management system. Accept `FileHandle` (and dispatch), or accept `FileInfo` (and have the caller project).
- **Returning a value typed `FileEntry` whose contract is "might or might not be registered"** — use `FileHandle` or an explicit variant instead.
- **Synthesising a `FileEntry` from a `FileInfo`** — registration must go through sanctioned FileManager methods; the Zod brand is specifically there to prevent this.

### 2.5 Relationship to v1 `FileMetadata`

The legacy `FileMetadata` type served two roles simultaneously — DB persistence (Dexie `files` table, `message_block.file` JSON) **and** generic file descriptor (OCR input, token estimation, UI rendering). The v2 type system makes those roles explicit by splitting them:

- The **persistence role** → `FileEntry` (plus managed references via `file_ref`)
- The **descriptor role** → `FileInfo`
- The **polymorphic reference** → `FileHandle`

A consumer that was "given a `FileMetadata`" is migrated by asking *which role* it was using — see the [migration plan](../../../v2-refactor-temp/docs/file-manager/migration-plan.md) for per-consumer bucket assignment.

---

## 3. IPC Design

### 3.1 Design Motivation

The renderer needs a unified entry point for file operations (a single `read` can read both FileEntry and an external path), but inside the main process, entry management (DB + FS coordination) and pure path operations (FS directly) are two very different responsibilities.

Solution: **unified call entry + handler-level dispatch**. FileManager, as the sole IPC registrant, owns all handlers; each handler dispatches internally to different implementations based on target type.

### 3.2 Handler Dispatch

```
Renderer
  → FileManager.registerIpcHandlers() (unified entry)
    ├── target: FileEntryId → FileManager method (entry coordination: resolve → DB + FS)
    └── target: FilePath    → ops.ts (direct FS/path ops)
```

Other services in the main process can call ops.ts or FileManager directly as needed, without going through IPC.

### 3.3 IPC Method Categories

All operations that can act on any file (managed FileEntry or unmanaged path) **accept a `FileHandle` tagged union** (`{ kind: 'managed', entryId } | { kind: 'unmanaged', path }`). Handlers dispatch by `handle.kind` to FileManager (managed) or `ops/*` (unmanaged).

**Operations that accept FileHandle (managed + unmanaged unified)**:

| Method | Description | managed-internal | managed-external | unmanaged |
|---|---|---|---|---|
| `read` | Read content | ops.read(userDataPath) | ops.read(externalPath) + DB snapshot refresh | ops.read(path) |
| `getMetadata` | Physical metadata | based on entry + ops.stat | stat + refresh | ops.stat + getFileType |
| `getVersion` | FileVersion | stat userData | stat external + refresh | ops.statVersion |
| `getContentHash` | xxhash-128 | read userData + hash | read external + hash | ops.contentHash |
| `write` | Atomic write | atomic → userData | atomic → externalPath (explicit user edit) | atomic → path |
| `writeIfUnchanged` | Optimistic concurrent write | same as write plus version check | same | same (caller must getVersion first) |
| `permanentDelete` | Delete entry | unlink userData + delete from DB | **delete from DB only** (physical file untouched; path-level deletion remains available via unmanaged `ops.remove`) | ops.remove(path) |
| `rename` | Rename | pure DB (UUID path unchanged) | fs.rename + DB update | ops.rename(path, newPath) |
| `copy` | Copy to a new internal entry | read source + create new internal | read source external + create new internal | read path + create new internal |
| `open` / `showInFolder` | System ops | resolve + shell | resolve + shell | shell |

**Operations accepting only FileEntryId (meaningful only for managed entries)**:

| Method | Description |
|---|---|
| `createInternalEntry` / `batchCreateInternalEntries` | Create a new Cherry-owned FileEntry (writes to `{userData}/files/{id}.{ext}`; each call produces an independent new entry, no conflict possible) |
| `ensureExternalEntry` / `batchEnsureExternalEntries` | Pure upsert by `externalPath`—the entry point first `canonicalizeExternalPath(raw)` normalizes it (see `pathResolver.ts`); reuses the existing entry with the same path (snapshot refreshed via stat) or inserts a new one. Idempotent by design—callers may safely repeat calls. No "restore" branch: external entries cannot be trashed. |
| `trash` / `restore` | Soft delete based on trashedAt (DB only). **Internal-only** — external entries cannot be trashed (`fe_external_no_trash` CHECK); passing an external id throws. |
| `batchTrash` / `batchRestore` | Batch versions of `trash` / `restore` — same internal-only rule. |
| `batchPermanentDelete` | Batch version of `permanentDelete`. |
| `refreshMetadata` | Explicit stat refresh of external snapshot (UI manual refresh button) |
| `withTempCopy` | Copy isolation for calling third-party libraries |

**How to obtain dangling state**: not individually exposed via IPC. The DataApi entry query endpoints support the `includeDangling: true` parameter, which the handler fills on demand via DanglingCache (see §4.1).

**Operations accepting only FilePath**:

| Method | Description |
|---|---|
| `select` | Electron file picker dialog |
| `save` | Electron save dialog + write file |
| `listDirectory` | Scan any directory contents |
| `isNotEmptyDir` | Check whether a directory is non-empty |

### 3.4 Operational Semantics for External Files

**Impact of Cherry's operations on external files**:

| User action | Physical external file |
|---|---|
| Trash from Cherry | **Not applicable** — external entries cannot be trashed (`fe_external_no_trash` CHECK) |
| Restore from Cherry | **Not applicable** — external entries are never trashed |
| permanentDelete from Cherry (entry-level) | **Untouched** — only the DB row is deleted; the physical file remains on disk |
| write / writeIfUnchanged from Cherry | **Overwritten** (atomic write) |
| Rename from Cherry | **Physically renamed** (the external filename also changes) |
| `ops.remove(path)` via unmanaged FileHandle (path-level) | **Deleted** — this is a deliberate path-level operation, not coupled to any file_entry row |

**Key principles**:
- Cherry does not perform automatic / watcher-driven external file modifications
- Cherry does perform user-explicitly-requested external file modifications (save, rename)
- **Entry-level deletion (`permanentDelete` on an external file_entry) does NOT touch the physical file** — this decouples "remove from Cherry's tracking" from "destroy on disk". If a user truly wants to delete the physical file, they invoke the path-level `ops.remove(path)` (unmanaged FileHandle) explicitly, which is not bound to any entry row.
- External entry lifecycle is monotonic (Active → Deleted), with no Trashed state — "remove entry from Cherry's view" always means clearing the DB row + cascading `file_ref` rows
- **Cherry does not track external file rename/move**—when a file is moved outside of Cherry, the corresponding entry becomes dangling (best-effort semantics); the caller must proactively call `ensureExternalEntry` on the new path to establish a new reference (upsert by path; reuses existing entry if hit)

Similar to VS Code's behavior model for open files: it changes when you tell it to, without modifying behind the scenes; if you change the file externally, it won't auto-follow.

### 3.5 AI SDK Integration (Deferred)

**AI SDK upload-related** → FileUploadService methods (**deferred implementation**, to be introduced after the AI SDK Files API is stable):

| Method                              | Description                      |
| ----------------------------------- | -------------------------------- |
| `ensureUploaded(entryId, provider)` | upload-if-needed                 |
| `buildProviderReference(entryId)`   | Build SharedV4ProviderReference  |
| `invalidate(entryId)`               | Clear cache (on content change)  |

---

## 4. Layered Architecture

### 4.1 No-FS-Side-Effect Path (DataApi)

FileEntryService / FileRefService are data repositories under `src/main/data/services/`, following the project's existing DataApi layered pattern. They **are not standalone lifecycle services**, but are exposed to the Renderer through the DataApiService bridge.

(`FileUploadRepository` is deferred along with FileUploadService.)

```
Renderer                              Main
+------------------+           +---------------------------------+
| useQuery()       |           | DataApiService (bridge)         |
| useMutation()    |--DataApi--+   |                             |
| (React hooks)    |           |   v                             |
+------------------+           | Handler (files.ts)              |
                               |   |                             |
                               |   v                             |
                               | FileEntryService (repository)   |
                               | FileRefService  (repository)    |
                               |   |                             |
                               |   v                             |
                               | DB (file_entry / file_ref)      |
                               +---------------------------------+
```

Services inside the main process may directly import and call the data repositories, without going through the DataApi handler.

DataApi endpoints (read-only):

| Endpoint                  | Method | Purpose                                                       |
| ------------------------- | ------ | ------------------------------------------------------------- |
| `/files/entries`          | GET    | FileEntry list (supports origin / trashed / time-range filter; opt-in `includeRefCount` / `includeDangling`) |
| `/files/entries/:id`      | GET    | Single entry lookup (opt-in `includeRefCount` / `includeDangling`) |
| `/files/entries/:id/refs` | GET    | All references to a file                                       |
| `/files/refs/by-source`   | GET    | All files referenced by a business object                      |

> **DataApi vs File IPC decision criteria**:
> - **DataApi** = read-only queries, does not change persistent state. DTO shape may differ from DB schema—derived fields, aggregations, and computed columns are allowed; **idempotent read-only side effects** (SQL aggregation, `fs.stat` for dangling, etc.) are allowed. **No mutations of any kind**.
> - **File IPC** = all mutations (create / rename / delete / move / write / trash), plus reads that are awkward to express as REST (full-file read, dialogs, streams, launching `open` on system programs, etc.)

**List queries for external entries**: DataApi returns the DB snapshot by default (possibly stale) without stat. Consumers needing the **latest snapshot** (refreshed name/ext/size) call File IPC `refreshMetadata` / `read` / `getVersion`; those needing only **whether it currently exists** (dangling) pass `includeDangling: true`.

### 4.1.1 Opt-in Derived Fields

The entry query on DataApi provides four opt-in fields that collectively address "I need a piece of derived information about a file" in any scenario:

**`includeRefCount`** (pure SQL aggregation):
- The handler uses `SELECT fileEntryId, COUNT(*) GROUP BY` to aggregate `file_ref`, joined to FileEntry
- Can be paired with `sortBy: 'refCount'` to sort by reference count
- Zero FS IO

**`includeDangling`** (FS-backed, safe stat):
- Handler calls `danglingCache.check(entry)` in parallel; returns synchronously on cache/watcher hit, falls back to a single `fs.stat` on miss
- Read-only idempotent side effect, compliant with DataApi rules
- Internal entry is always `'present'`
- See FileManager Architecture §11 for details
- **Staleness contract (best-effort)**: `dangling` is an FS-observed **time-varying** value—the watcher may not cover it, and a file may be externally deleted after a cache hit. Consumers **must** allow React Query's default `staleTime` (5min) or shorter to naturally trigger a refresh; **do not** set `staleTime: Infinity`—that equates to the contradictory "I want dangling but refuse to re-check". When the user explicitly refreshes an entry, use File IPC `refreshMetadata(id)` + call `mutate(...)` on the query.

**`includePath`** (raw absolute path):
- Handler calls main-side `resolvePhysicalPath(entry)` and returns the absolute path string
- **Intended uses**: agent context embedding / drag-and-drop to external apps (the `file` field of `webContents.startDrag`) / subprocess spawn / "Open in external editor" UX
- **NOT intended**: don't cache as a stable identifier (storage layout may change); don't string-concat into shell commands without independent sanitization; don't use this path to bypass FileManager for writes; use `entry.id` when only identity reference is needed
- **Bound by convention**: the type system cannot prevent a renderer from misusing the string—code review should examine each caller to check "does this caller really need the path string"

**`includeUrl`** (file:// URL with safety):
- Handler calls main-side `resolveSafeUrl(entry)` to produce a `file://` URL; dangerous files (.sh/.bat/.ps1, etc.) return the dirname to prevent accidental double-click execution
- **Scoped capability**: only serves synchronous rendering of `<img src>` / `<video src>` / `<embed>`; the safety wrap only prevents hover/load side effects in HTML rendering contexts, **not** a general path-safety primitive
- Do not embed this URL into command-line args, subprocess args, or other non-HTML scenarios—use `includePath` when you need the raw path
- Keeps the renderer unaware of internal storage layout (id+ext concatenation, userData path); storage format changes don't affect the renderer

### 4.1.1.1 On "Main is SoT for path resolution"

Main as SoT for path resolution means **authority (who defines resolution rules)**—`resolvePhysicalPath` decides how id + ext are concatenated, where userData lives, whether it becomes hash-bucketed in the future, etc. The renderer consumes the string results produced by Main, but does not share authority:
- When storage layout iterates on the Main side, renderer code needs zero changes
- The renderer **holds** the string value (locality), but does not **define** the computation rules (authority)

`includePath` / `includeUrl` carry the path string to the renderer process—this lets the renderer complete the "hold the value" step. The spread of **locality** is not the spread of **authority**. The former is a natural consumption relationship; only the latter is an actual tearing-apart of the SoT.

### 4.1.2 Typical Renderer Call Flows

```typescript
// Case 1: FilesPage sorted by refCount + showing dangling state + file preview
const { data: entries } = useQuery(fileApi.listEntries, {
  includeRefCount: true,
  includeDangling: true,
  includeUrl: true,
  sortBy: 'refCount',
})
// <img src={entry.url} /> synchronous render

// Case 2: Agent compose needs absolute paths
const { data: entries } = useQuery(fileApi.listEntries, {
  ids: selectedFileIds,
  includePath: true,
})
const filePaths = entries.map(e => e.path).join('\n')

// Case 3: Simple chat attachment list (no derived fields needed)
const { data: entries } = useQuery(fileApi.listEntries, { origin: 'internal' })
```

Benefits of the layering:
- DataApi centralizes all read-only queries; consumers gather needed fields in a single query
- Unwanted fields cost nothing (opt-in)
- Mutations uniformly go through IPC, cleanly separating "view data" from "change data"
- The renderer is unaware of internal storage layout; changes to main's storage format don't break the renderer

### 4.2 FS-Side-Effect Path (File IPC)

All FS-involving operations go through dedicated IPC channels and **do not go through DataApi**.

```
Renderer                          Main
+---------------+           +--------------------------------------+
| window.api    |           | FileManager (lifecycle service)      |
| .fileManager  |---IPC---->|   |                                  |
| .createInternalEntry() |           |   +-- entry ops ----+                |
| .read()       |           |   |  (resolve entryId → filePath,    |
| .trash()      |           |   |   coordinate DB via repository   |
| .select()     |           |   |   + ops.ts pure functions)       |
| .open()  ...  |           |   |                                  |
|               |           |   +-- path ops ---> ops.ts           |
|               |           |   |                 (sole FS owner)  |
|               |           |   +-- dialog -----> Electron dialog  |
+---------------+           +--------------------------------------+
```

### 4.3 Layer Ownership for FS Interactions

```
+-------------------------------------------------------------------------+
| FileManager  (Lifecycle Service, WhenReady phase)                       |
|                                                                         |
| Role: IPC handler registration, entry coordination, dialog              |
| FS:   none -- delegates ALL FS operations to ops.ts                     |
| DB:   delegates to FileEntryService / FileRefService (repository)       |
|       maintains in-memory LRU version cache                             |
| Own:  Electron dialog API (showOpenDialog/showSaveDialog)               |
+-------------------------------------------------------------------------+
| Startup Orphan Sweep  (background task inside FileManager)              |
|                                                                         |
| Role: clean up internal UUID files not in DB + *.tmp-<uuid> residues    |
| FS:   via ops.ts                                                        |
| DB:   read-only DB queries                                              |
+-------------------------------------------------------------------------+
| DanglingCache  (file_module singleton, not lifecycle)                   |
|                                                                         |
| Role: track external entry presence state (present/missing/unknown)     |
| State: Map<entryId, DanglingState> + reverse index Map<path, entryIds>  |
| Updates: watcher events (auto-wired), ops observations, cold-path stat  |
| Queried by: DataApi handler (on includeDangling=true)                   |
+-------------------------------------------------------------------------+
| DirectoryWatcher  (NOT lifecycle -- consumable primitive)               |
|                                                                         |
| Role: chokidar wrapper with optional rename detection                   |
| Factory: createDirectoryWatcher() auto-wires events into DanglingCache  |
| Used by: business modules that need directory monitoring                |
+-------------------------------------------------------------------------+
| ops/ (pure functions)  *** MODULE-INTERNAL FS OWNER ***                 |
|                                                                         |
| Role: the sole module that imports `fs` / `shell` in file_module        |
|       atomicWriteFile exports are consumable by OTHER main modules      |
|       (BootConfig, MCP oauth, etc.) for safe writes                     |
| FS:   all FS ops -- pure path-based, no entry/DB awareness              |
| DB:   none                                                              |
+-------------------------------------------------------------------------+
| FileEntryService / FileRefService  (data repositories, not lifecycle)   |
|                                                                         |
| Role: DB CRUD, exposed via DataApiService bridge                        |
| FS:   none (pure DB)                                                    |
+-------------------------------------------------------------------------+
```

### 4.4 Responsibility Boundaries Summary

| Layer                    | Type            | Touches DB     | Touches FS              | Touches Electron API      | Exposed to Renderer |
| ------------------------ | --------------- | -------------- | ----------------------- | ------------------------- | ------------------- |
| **FileManager**          | lifecycle       | via repository | **No (via ops.ts)**     | dialog                    | Yes (IPC)           |
| **DanglingCache**        | singleton       | read-only once at startup | No (cache only; fs via ops) | No                 | Indirect (via DataApi) |
| **DirectoryWatcher**     | primitive class | No             | Indirect (chokidar)     | No                        | No (used by business modules) |
| **ops.ts**               | pure functions  | No             | **Yes (sole FS owner)** | shell (open/showInFolder) | No                  |
| **FileEntryService**     | data repository | Yes (direct)   | No                      | No                        | Yes (via DataApi)   |
| **FileRefService**       | data repository | Yes (direct)   | No                      | No                        | Yes (via DataApi)   |

**Core principles**:

- **ops.ts is the only module that directly `import node:fs`**—all FS operations go through it. Modules outside file_module (BootConfig, MCP oauth, etc.) may import primitives like `atomicWriteFile`
- **FileManager is the sole entry point for entry operations**—registers IPC handlers, resolves entryId → filePath, coordinates DB (via repository) + FS (via ops.ts)
- **The Renderer never operates on the FS directly**; all FS operations are delegated to Main via IPC

---

## 5. Business Service Integration

### 5.1 Interaction Overview

```
+- Renderer --------------------------------------------------------+
|                                                                   |
|  useQuery('/files/...')        window.api.file.xxx()              |
|           |                                    |                  |
+-----------|------------------------------------|------------------+
            | DataApi (no fs side effect)        | IPC (read/write)
            |                                    |
+===========|====================================|==================+
|  Main     |                                    |                  |
|  Process  v                                    v                  |
|                                                                   |
|  Lifecycle Services                                               |
|  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
|                                                                   |
|  +-----------------------------------------------------------+    |
|  | FileManager                                               |    |
|  |  -- IPC handler registration --                           |    |
|  |  dispatch by target type (FileEntryId vs FilePath)        |    |
|  |                                                           |    |
|  |  -- entry ops --                                          |    |
|  |  createInternalEntry / ensureExternalEntry (upsert by path)|   |
|  |  trash / restore / rename / copy / permDelete             |    |
|  |  read / write / writeIfUnchanged / withTempCopy           |    |
|  |                                                           |    |
|  |  -- version / refresh --                                  |    |
|  |  getVersion / getContentHash / refreshMetadata            |    |
|  |                                                           |    |
|  |  -- Electron dialog --                                    |    |
|  |  showOpenDialog / showSaveDialog                          |    |
|  |                                                           |    |
|  |  in-memory: LRU version cache                             |    |
|  |                                                           |    |
|  |  -- Startup Orphan Sweep (background, non-blocking) --    |    |
|  |  Cleans internal UUID files not in DB + *.tmp residues    |    |
|  |  Non-blocking; other methods work immediately.            |    |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  +-----------------------------------------------------------+    |
|  | DanglingCache (singleton)                                 |    |
|  |  check(entry) → DanglingState                             |    |
|  |  onFsEvent(path, 'present' | 'missing')                   |    |
|  |  state: Map<entryId, DanglingState>                       |    |
|  |  reverse index: Map<path, Set<entryId>>                   |    |
|  |  populated on startup from DB (all external — external    |    |
|  |  entries cannot be trashed)                               |    |
|  |  updated by watcher events / ops observations             |    |
|  +-----------------------------------------------------------+    |
|                        |                                          |
|             all FS ops v                                          |
|  +-----------------------------------------------------------+    |
|  | ops.ts  *** FS OWNER (pure functions) ***                 |    |
|  |  read / write / stat / copy / move / remove / open        |    |
|  |  atomicWriteFile / atomicWriteIfUnchanged                 |    |
|  |  createAtomicWriteStream                                  |    |
|  |  statVersion / contentHash (xxhash-128)                   |    |
|  |                                                           |    |
|  |  stateless, pure path-based, open to all main modules     |    |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  Data Repositories (via DataApiService bridge to Renderer)        |
|  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
|  +-----------------------------------------------------------+    |
|  | FileEntryService (data repository, DB only)               |    |
|  |  getById / list / create / update / delete                |    |
|  +-----------------------------------------------------------+    |
|  +-----------------------------------------------------------+    |
|  | FileRefService (data repository, DB only)                 |    |
|  |  create / cleanupBySource / cleanupBySourceBatch          |    |
|  +-----------------------------------------------------------+    |
|                                                                   |
|  Business Services (examples — each module chooses its own       |
|   origin and ref conventions)                                     |
|  +---------------+ +------------------+                           |
|  | MessageService| | KnowledgeService |   ...                     |
|  +---+-----------+ +------+-----------+                           |
|      |   |                |   |                                   |
|      read/write          read/write                               |
|      file_ref mgmt        file_ref mgmt                           |
|      (may use            (may use                                 |
|       DirectoryWatcher)   DirectoryWatcher)                       |
|                                                                   |
|  Background Services                                              |
|  +---------------------------------------------------------+      |
|  | OrphanRefScanner (Background phase)                     |      |
|  |  checkers: Record<FileRefSourceType, SourceTypeChecker> |      |
|  +---------------------------------------------------------+      |
+===================================================================+
```

**Key data flows**:

- **Renderer → Main (read)**: DataApi → Handler → FileEntryService → DB (optionally merges DanglingCache state via opt-in)
- **Renderer → Main (write)**: IPC → FileManager (coordinates DB + ops.ts)
- **Business Service → file data**: pure DB operations call data repositories directly; FS-involving operations go through FileManager
- **External directory monitoring**: business services create instances via the `createDirectoryWatcher()` factory and subscribe to the events they care about; the factory internally injects events into DanglingCache (business unaware)

### 5.2 Touchpoints for Business Services

Business services interact with the file module through three channels:

- **No-FS-side-effect operations** (entry queries, reference management) → import data repositories directly (`fileEntrySafe` / `fileRefService`)
- **FS-involving operations** (read/write file content, create/delete entry) → **FileManager**
- **External directory monitoring** (if needed) → call the `createDirectoryWatcher()` factory (provided by file_module); the factory auto-wires events into DanglingCache; the business only subscribes to events it cares about

#### (1) On Business Creation — Create a FileRef

When a business operation produces a file reference, call `fileRefService.create()` directly. The Renderer does not create refs directly.

The specific values of `sourceType` / `role` are defined by each business module and uniformly registered when the `SourceTypeChecker` is registered (Layer 3 orphan scanning depends on this registration—enforced at compile time).

#### (2) On Business Deletion — Cleanup FileRef

When a business object is deleted, **you must** actively clean up the associated file_ref:

```typescript
// Single
await fileRefService.cleanupBySource(sourceType, sourceId)
// Batch (e.g., deleting a parent object cascades the refs of all its children)
await fileRefService.cleanupBySourceBatch(sourceType, sourceIds)
```

Each business module calls this inside its own delete flow. Any ref that goes uncleaned is caught by Layer 3 orphan scanning.

#### (2b) Developer Checklist for Adding a New sourceType

To avoid the governance pitfall of "added a sourceType but forgot to wire up some step", follow the order below when adding a new variant (every step is required):

| Step | Location | Action | Enforcement |
|---|---|---|---|
| 1 | `packages/shared/data/types/file/ref/<name>.ts` | Create the variant file: declare `xxxSourceType` / `xxxRoles` / `xxxRefFields` + `xxxFileRefSchema = createRefSchema(...)` | Code review |
| 2 | `packages/shared/data/types/file/ref/index.ts` | Add the variant to `allSourceTypes` (type aggregation) + `FileRefSchema` discriminated union | Type system narrow failure |
| 3 | `src/main/data/services/orphan/FileRefCheckerRegistry.ts` | Add a checker in `Record<FileRefSourceType, SourceTypeChecker>` | **Compile-time enforced** (missing Record key → TS error) |
| 4 | Business service (delete flow) | Call `fileRefService.cleanupBySource(sourceType, id)` when the object is deleted | Code review + unit tests + step 3 as fallback |

**Design intent**: push-and-pull complement each other—

- **Pull** (step 4): the business service cleans it up itself in its delete flow—this is the preferred path and avoids ref buildup
- **Push** (step 3): OrphanRefScanner acts as a safety net, periodically scanning `file_ref` to find rows with non-existent sourceIds and removing them. **Compile-time Record closure** ensures no sourceType is missed.
- **There is no per-sourceType `onSourceDeleted` hook**: the cleanup logic of `cleanupBySource` is identical across all sourceTypes (delete rows matching `(sourceType, sourceId)`). Business-specific cleanup (e.g., rebuilding vectors when a knowledge base is deleted) belongs to the business service's own delete flow and should not be coupled to the ref system.

Reference implementation (Phase 1b provides tempSession as a template):

```typescript
// src/main/data/services/orphan/FileRefCheckerRegistry.ts
// Compile-time enforcement: every FileRefSourceType has a checker; missing keys trigger a TypeScript error
export const fileRefCheckers: Record<FileRefSourceType, SourceTypeChecker> = {
  temp_session: {
    sourceType: 'temp_session',
    checkExists: async () => new Set()  // temp has no persistent source; treat everything as "deleted"
  },
  // If you miss a key here after adding a new sourceType, TypeScript fails to compile
}
```

#### (3) Ways Business Services Access Files

```
BusinessService
    |
    +-- direct import (no FS side effect)
    |   +-- fileEntrySafe.getById(entryId)          -> FileEntry
    |   +-- fileEntrySafe.list(filter)              -> FileEntry[]
    |   +-- fileRefService.create(dto)              -> FileRef
    |   +-- fileRefService.cleanupBySource(...)     -> void
    |
    +-- via FileManager (has FS side effect)
    |   +-- read(entryId, opts?)                    -> ReadResult
    |   +-- write(entryId, data)                    -> FileVersion  [internal only]
    |   +-- writeIfUnchanged(entryId, data, ver)    -> FileVersion  [internal only]
    |   +-- withTempCopy(entryId, fn)               -> T            [for 3rd-party libs]
    |
    +-- fileModule.createDirectoryWatcher(opts) (optional)
    |   +-- for monitoring external directories (NoteService etc. business)
    |   +-- factory auto-wires events into DanglingCache
    |
    x-- fs.readFile / writeFile / unlink           -> FORBIDDEN for FileEntry paths
    x-- ops/fs direct on managed paths              -> FORBIDDEN for FileEntry paths
```

**Why business services are forbidden from directly operating on the physical files backing a FileEntry**:

- **Path opacity**: the physical path is determined by origin (internal = UUID-based; external = user-provided); business services must not assume it
- **Cache consistency**: FileManager maintains an in-memory version cache; bypassing it causes inconsistency
- **Atomicity guarantee**: writes must go through FileManager's atomic write path

The scope of this constraint is **physical files backing a FileEntry**. Other modules' own files (Knowledge vector index, Agent workspace, MCP config, Notes, etc.) are outside this constraint.

### 5.3 Exposure Principles for Path Operations

`resolvePhysicalPath` **is not exposed externally**. Business services obtain file content via two channels:

1. **Buffer / Stream**: `FileManager.read` / `createReadStream` — the majority of cases
2. **Temporary copy**: `FileManager.withTempCopy(id, fn)` — for third-party libraries that only accept a path (sharp / pdf-lib / officeparser, etc.)

This guarantees that writes necessarily go through FileManager (no write-path escape at the type-system level), while providing an escape hatch for third-party libraries that strictly require a path.

**Future**: AI SDK uploads will be wrapped by a standalone `FileUploadService.ensureUploaded` combining read + upload (to be introduced after the AI SDK Files API is stable).

---

## 6. Service Lifecycle

### 6.1 Startup Phase Assignment

```
Lifecycle Services:

BeforeReady (parallel with app.whenReady(), no Electron API)
+-- DbService                    -- database connection

WhenReady (after app.whenReady(), Electron API available)
+-- FileManager                  -- entry coordination + IPC
      @DependsOn(DbService)
      onInit(): registers IPC, inits LRU cache, inits DanglingCache reverse
                index from DB, FIRES background orphan sweep
                (sweep runs async; does NOT block ready)

Background (fire-and-forget, non-blocking)
+-- OrphanRefScanner             -- delayed 30s, scan orphan refs
+-- FileManager.runOrphanSweep   -- started in onInit, cleans internal UUID
                                    files not in DB + *.tmp-<uuid> residues

Singletons / Primitives (no lifecycle):
+-- ops.ts                        -- sole FS owner, stateless
+-- DanglingCache                 -- file_module singleton, populated lazily
+-- DirectoryWatcher              -- consumable class, created via factory

Data Repositories (not lifecycle, managed by DataApiService):
+-- FileEntryService              -- entry CRUD (pure DB)
+-- FileRefService                -- ref CRUD (pure DB)
```

**Deferred introduction (after AI SDK is stable)**:

- `FileUploadService` (lifecycle service) + `FileUploadRepository`

### 6.2 Startup Timeline

```
                     BeforeReady
                          |
                      DbService
                          |
                     app.whenReady()
                          |
                          v     WhenReady
                     FileManager.onInit():
                       1. register IPC handlers
                       2. initialize version cache LRU
                       3. init DanglingCache reverse index from DB
                          (SELECT id, externalPath FROM file_entry
                           WHERE origin='external'
                           — external rows are never trashed by invariant)
                       4. fire void this.runOrphanSweep()  ◄── not awaited
                                   │
                          (ready signal emitted immediately; ready not blocked)
                          │                            │
                          ▼                            ▼
                      onAllReady()                 (background in parallel)
                          │                   orphan sweep:
                          ▼                     UUID files not in DB → unlink
                 OrphanRefScanner.start          *.tmp-<uuidv7> → unlink
                 (delayed 30s)
```

**Key**: `runOrphanSweep()` starts with `void` rather than `await`, so `onInit` returns immediately and the service becomes ready immediately. DanglingCache reverse index initialization is a **synchronous DB query** that should be fast (external entries are usually <10000 rows), so no additional signal mechanism is introduced.

### 6.3 Dependency Declarations for Business Services

Any business service that consumes FileManager needs `@DependsOn(FileManager)`:

```
<AnyBusinessService>
  @DependsOn(FileManager)
  +-- queries entries via fileEntrySafe (no FS side effect)
  +-- creates/cleans refs via fileRefService (pure DB)
  +-- reads file content via FileManager (FS)
  +-- (optional) owns DirectoryWatcher instances via the factory
```

Specific services and their dependency declarations are registered by each business module in `serviceRegistry.ts`.

---

## 7. File Locations and Module Boundaries

```
src/main/data/                        -- data layer (pure DB)
  services/
    FileEntryService.ts               -- repository: exports fileEntryService + fileEntrySafe
    FileRefService.ts                 -- repository: exports fileRefService
  api/handlers/
    files.ts                          -- DataApi handler, no FS side effect
  db/schemas/
    file.ts                           -- file_entry / file_ref

src/main/file/                        -- file module
  FileManager.ts                      -- entry lifecycle + IPC + startup orphan sweep (background)
  orphanSweep.ts                      -- internal helper: UUID file + *.tmp residue cleanup
  danglingCache.ts                    -- singleton: external entry presence state
                                         exports: check / onFsEvent / addEntry / removeEntry
  watcher/
    DirectoryWatcher.ts               -- chokidar wrapper primitive
    factory.ts                        -- createDirectoryWatcher() — auto-wires danglingCache
    index.ts                          -- barrel export
  ops/                                -- pure functions, FS owner
    index.ts                          -- barrel export
    fs.ts                             -- read / write / stat / copy / move / remove
                                         atomicWriteFile / atomicWriteIfUnchanged
                                         createAtomicWriteStream
                                         statVersion / contentHash
    shell.ts                          -- open / showInFolder
    path.ts                           -- resolvePath / isPathInside / canWrite / isNotEmptyDir
    metadata.ts                       -- getFileType / isTextFile / mimeToExt
    search.ts                         -- listDirectory (ripgrep + fuzzy matching)
```

---

## 8. Constraints and Limitations

- **External entry is a best-effort reference**: no guarantee the file remains stable, no guarantee content matches the reference-time content. Equivalent to "the user expressed intent to reference this path at some point" semantics in tools like codex
- **External entry path is globally unique**: at most one row per `externalPath` at any time, regardless of any state (SQLite global unique index on `externalPath`; internal rows have `externalPath = null` and are exempt, since SQLite treats multiple NULLs as distinct). `ensureExternalEntry` is therefore a pure upsert by path — reuse if an entry exists, otherwise insert; no "restore" branch is possible because external entries cannot be trashed.
- **External entries cannot be trashed**: enforced at the DB layer by `CHECK (origin != 'external' OR trashedAt IS NULL)` (`fe_external_no_trash`). External lifecycle is monotonic: create via `ensureExternalEntry` → update in place via `write` / `rename` / `refreshMetadata` → remove via `permanentDelete` (DB row only). There is no soft-delete / restore cycle for external entries. Calling `trash` / `restore` on an external id throws.
- **External entries allow explicit user edits**: `write` / `writeIfUnchanged` / `createWriteStream` / `rename` take effect on external (delegated to ops' atomic write / fs.rename), triggered by explicit user action. Cherry does **not** perform automatic / watcher-driven external file modifications
- **`permanentDelete` on external is entry-level, not file-level**: removes only the DB row + CASCADE-cleans `file_ref`; the physical file is left untouched. Path-level deletion remains available via the unmanaged `ops.remove(path)` operation, which is a separate explicit call not bound to any entry id.
- **Cherry does not track rename/move of external files**: an external rename turns the entry dangling; the user must re-@ to establish a new reference
- **External entry DB snapshot may be stale**: list queries return DB values directly; critical paths (read / hash / upload) automatically stat-verify + refresh; UI may provide a manual refresh
- **Dangling state exposed via DanglingCache + opt-in DataApi param**: not persisted to DB; watcher events + cold-path stat push updates
- **Physical paths are not persisted**: internal is derived from `application.getPath('files', ...)`; external is read from the `externalPath` column
- **FileRef polymorphism has no FK**: `sourceId` points into different business tables and relies on application-layer cleanup + orphan scanning as fallback
- **File Module does not do directory import / bidirectional sync**: business modules implement this with DirectoryWatcher + their own mapping tables
- **File Module does not start any chokidar watcher**: watcher lifecycles are managed by business modules; when created via the factory, DanglingCache is automatically wired

---

## 9. Extension Points

| Extension direction                     | Integration path                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| AI provider uploads (after SDK stable)  | Add `FileUploadService` + `file_upload` table; FileEntry structure unchanged; migrate via additive migration |
| New business reference source           | Add `sourceType` enum value + register `SourceTypeChecker` (compile-time enforced)              |
| Business module needs to watch external dir | Obtain an instance via `createDirectoryWatcher()` factory; subscribe to events; DanglingCache auto-syncs |
| Dangling reactivity (real-time push to renderer) | Currently DataApi query-time lookup; future could trigger DataApi invalidation on DanglingCache state changes |
| Cross-device file sync                  | Out of file_module scope; solved by the application layer or external sync tools (Drive/Dropbox) |
| Full-text search                        | Currently `ops/search.ts` provides ripgrep-based scanning; persistent indexes managed by businesses like Knowledge |
