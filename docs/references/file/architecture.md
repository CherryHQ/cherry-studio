# File Module Architecture

> **SoT scope** — **this document** owns: module boundaries, type system (`FileHandle` / `FileEntry` / `FileInfo`), IPC / DataApi contracts, layered architecture (no-FS-side-effect vs FS-side-effect paths), business-service integration, and service lifecycle assignment. FileManager **internal implementation** (storage layout, version detection, atomic writes, recycle bin, reference cleanup, watcher internals, orphan sweep, DanglingCache state machine) lives in [`file-manager-architecture.md`](./file-manager-architecture.md). In case of conflict, the layer ownership above decides: positioning / contract → this document, implementation → the other.
>
> **Contract stability**: the JSDoc, type signatures, and behavioral tables in this document (and `file-manager-architecture.md`) are **binding commitments** for the implementation — not provisional notes. When implementation reveals a contract that cannot be honored (a cleanup semantic that collides with reality, an error-type that needs expanding, a signature shape that doesn't fit), the required workflow is: **(1) open a PR revising the contract doc first**, with justification in the PR description; **(2) land that doc revision**; **(3) implement against the updated contract**. Do not ship an implementation that silently diverges from the doc — the cost of doc revision is minutes, the cost of hidden divergence compounds indefinitely.
>
> Related documents:
>
> - `docs/references/file/file-manager-architecture.md` — FileManager submodule design (FileEntry model, origin semantics, atomic writes, version detection, DirectoryWatcher, AI SDK integration)

---

## 1. Module Scope

### 1.0 Core Principle

> **FileManager manages files introduced via explicit calls to `createInternalEntry` / `ensureExternalEntry`**—files exist as one of two origins: `internal` (Cherry owns the content) or `external` (records a path reference only). Which origin the caller chooses is a business-layer decision; FileManager makes no assumptions about it.

### 1.0.1 Semantics of Origin

The `origin` field on a FileEntry defines content ownership, with two values:

- **`internal`**: Cherry owns the file content, physically stored at `{userData}/Data/Files/{id}.{ext}`. The caller hands a Buffer/Stream/source file to FileManager, which copies and takes ownership. `name` / `ext` / `size` are authoritative on the row (atomic writes keep DB and FS in sync).
- **`external`**: Cherry only records an absolute path reference on the user's side, does not copy content, and does not own the file. `name` / `ext` on the row are pure projections of `externalPath` (basename / extname); `size` is **not stored** (always `null`) — live value is obtained via File IPC `getMetadata`. File availability and content changes are determined by the user side.

Which origin to pick is the **caller's** decision; FileManager makes no assumption about the business layer.

### 1.0.2 Best-effort Semantics for External

An external entry is a persistent record that "the caller expressed the intent to reference this path at some point in time"—analogous to the "best-effort external reference" seen in tools like codex. It does not guarantee the file remains stable, nor that the content matches what it was when first referenced. Cherry does not actively mirror FS changes; instead, FS changes naturally surface as "reading new content next time" or "the entry turns dangling".

### 1.1 What the File Module Includes

```
File Module (src/main/services/file/)
│
├── index.ts              ← module barrel; exports only FileManager + public types
│                           (internal/* is not exported; external imports can't reach it)
│
├── FileManager.ts        ← sole lifecycle service + public facade
│     │                     public methods are thin delegates to internal/*; owns versionCache
│     │                     responsible for IPC registration and FileHandle.kind dispatch
│     ├── FileEntry lifecycle (create-or-upsert / write / trash / restore / rename / copy / permanentDelete)
│     ├── Version detection & concurrency control (read / writeIfUnchanged / withTempCopy)
│     ├── Metadata & system ops (getMetadata / open / showInFolder)
│     ├── registerIpcHandlers() — unified IPC entry, dispatches by FileHandle.kind
│     └── Electron dialog (showOpenDialog / showSaveDialog)
│
├── internal/             ← private implementation, not re-exported by index.ts; external imports forbidden
│     │                     every pure function explicitly receives FileManagerDeps
│     │                     (fileEntryService / fileRefService / danglingCache / versionCache / orphanRegistry)
│     ├── deps.ts               — FileManagerDeps type
│     ├── dispatch.ts           — dispatchHandle (FileHandle.kind → entry vs path adapter)
│     ├── entry/
│     │    ├── create.ts        — createInternal / ensureExternal
│     │    ├── lifecycle.ts     — trash / restore / permanentDelete + batches
│     │    ├── rename.ts
│     │    └── copy.ts
│     ├── content/
│     │    ├── read.ts          — read / createReadStream (including `*ByPath` variants)
│     │    ├── write.ts         — write / writeIfUnchanged / createWriteStream
│     │    └── hash.ts          — getContentHash / getVersion
│     ├── system/
│     │    ├── shell.ts         — open / showInFolder
│     │    └── tempCopy.ts      — withTempCopy
│     └── orphanSweep.ts        — startup orphan scan + FS sweep
│
│     Note: `getMetadata` is implemented inline on the FileManager class (not
│     extracted to internal/entry/) — the only entry method that talks
│     directly to `fs.stat` without an internal/* helper.
│
├── versionCache.ts       ← LRU type definition; instance held as private field on FileManager
│
├── danglingCache.ts (singleton)
│     ├── check(entry): DanglingState — query in-memory / cold-path stat
│     ├── onFsEvent(path, state) — receives watcher events
│     ├── Reverse index Map<path, Set<entryId>> (populated from DB at file_module startup)
│     └── Queried by DataApi handler; automatically wired by the watcher factory
│
└── watcher/
      └── DirectoryWatcher (not a service, a generic FS monitoring primitive)
          ↳ factory createDirectoryWatcher() auto-wires events into danglingCache

Pure FS primitives (src/main/utils/file/) — sole FS owner, open to the entire main process
├── fs.ts         — basic FS: read / write / stat / copy / move / remove
│                   atomic write: atomicWriteFile / atomicWriteIfUnchanged / createAtomicWriteStream
│                   version: statVersion / contentHash (xxhash-h64)
├── shell.ts      — system ops: open / showInFolder
├── path.ts       — path utils: resolvePath / isPathInside / canWrite / isNotEmptyDir / canonicalizeExternalPath
├── metadata.ts   — type detection: getFileType / isTextFile / mimeToExt
├── search.ts     — directory search: listDirectory (ripgrep + fuzzy matching)
├── legacyFile.ts — shared legacy helpers (`getFileType(ext)` / `sanitizeFilename` / `getAllFiles` / `pathExists` / …); planned to be split into the modules above over time
└── index.ts      — barrel: re-exports `./legacyFile` so cross-module callers can `import from '@main/utils/file'`

Data Module dependencies (src/main/data/)
├── FileEntryService (data repository, pure DB) — file_entry table
├── FileRefService (data repository, pure DB) — file_ref table
└── DataApi Handler (files.ts) — pure SQL read-only endpoints; no FS access, no main-side resolvers
```

**Deferred implementation**:

- **`FileUploadService` + `file_upload` table + `FileUploadRepository`** — integrates with Vercel AI SDK's Files Upload API. The AI SDK API is still pre-release and its dependency is unstable, so this is deferred to a separate PR after the SDK reaches a stable version. The design is preserved in `file-manager-architecture.md §9` for reference.

### 1.2 FileManager's Position Within the Module

FileManager is the core submodule of the file module, but is not equivalent to the file module as a whole.

- **FileManager** is the **sole public entry point** for the entry management system—responsible for the full lifecycle and content operations of FileEntry. Its public API only accepts `FileEntryId` / `FileHandle`. At startup, it performs an orphan sweep in the background (cleaning up leftover internal UUID files), **without blocking the ready signal**.
- **FileManager is a facade, not a God class** — business methods are delegated to private pure-function modules. The class itself owns only lifecycle, IPC registration, and instance-scoped caches. Implementation mechanics (dispatch helpers, deps passing, module layout, extension rules) live in [FileManager Architecture §1.6](./file-manager-architecture.md) — this document stays at the positioning layer.
- **DanglingCache** is a file_module singleton—maintains the `'present' | 'missing'` state of external entries, pushed by watcher events, with cold-path stat as a fallback, and served to the renderer via File IPC `getDanglingState` / `batchGetDanglingStates` (never DataApi).
- **DirectoryWatcher** is a generic FS primitive, **not a lifecycle service**; business modules (such as a future NoteService) new/dispose instances themselves via the `createDirectoryWatcher()` factory; the factory internally wires events into DanglingCache.
- **Pure FS / path primitives** live under `src/main/utils/file/` (imported as `@main/utils/file/fs`, `@main/utils/file/path`, etc.). They do not depend on the entry system and are open to the entire main process.

#### Public / Private Boundaries

| Location | Visibility | Access |
|---|---|---|
| `FileManager` class + public types | **Entire main process** | Resolve the runtime instance via `application.get('FileManager')`; import public types from `@main/services/file` |
| Pure FS primitives (`@main/utils/file/{fs,metadata,path,search,shell}`) | **Entire main process** | `import { atomicWriteFile } from '@main/utils/file/fs'` (BootConfig, MCP oauth, etc. can use directly). Shared legacy helpers (`getFileType(ext)`, `sanitizeFilename`, etc.) are barrel-exported from `@main/utils/file` itself. |
| `watcher/` (`createDirectoryWatcher` factory) | **Entire main process** | Business services call this when they need to watch external directories |
| `danglingCache` | **Internal to file-module** | External callers read it via File IPC `getDanglingState` / `batchGetDanglingStates`; never imported directly, never exposed via DataApi |
| `internal/*` | **Only FileManager** | All other locations (including `@main/utils/file/*` and `watcher/` within the file-module) must not import it |

Boundary enforcement: `src/main/services/file/index.ts` barrel does not re-export `internal/*`; external `import from '@main/services/file'` cannot reach it. If violations surface, add an ESLint `no-restricted-imports` rule as a fallback.

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

These modules manage their own files and may use `node:fs` or `@main/utils/file/*` directly; they are not bound by the FileManager of the file module.

---

## 2. Type System: Reference vs Data Shape

### 2.1 Two Layers of File Types

The file module organizes its types along two layers — the **reference layer** (how a call site names the target file when crossing a boundary) and the **data-shape layer** (what the handler receives after resolving that reference):

```
                    Entry-referenced                   Path-referenced
                    ────────────────                   ────────────────
Reference layer     FileEntryHandle                    FilePathHandle
(across boundaries) { kind: 'entry', entryId }         { kind: 'path', path }
                          │                                  │
                          ▼ FileManager.getEntry             ▼ fs.stat + projection
Data-shape layer    FileEntry                          FileInfo
(after resolution)  { id, origin, name, ext,           { path, name, ext, size,
                      size, trashedAt, ... }             mime, type, modifiedAt, ... }
```

Picking a handle variant is a **call-site choice of reference form**, not a statement about the file itself. Crucially, **the two axes are orthogonal**:

- **Reference form** (this layer): `FileEntryHandle` routes through the entry system (FileManager, versionCache, DanglingCache updates); `FilePathHandle` bypasses it and hits the `@main/utils/file/*` primitives directly.
- **Content ownership** (`FileEntry.origin`, not visible in the handle): `internal` means Cherry owns `{userData}/Data/Files/{id}.{ext}`; `external` means Cherry only records a reference to a user-owned path.

The **same physical external file** can therefore be reached by either handle variant. A `FileEntryHandle` to its entry goes through the entry-aware code path (dangling updates, version cache, identity-tracked operations); a `FilePathHandle` to the same absolute path goes through pure FS. Picking one is a matter of which subsystem the caller wants in the loop — not a property of the file.

### 2.2 `FileHandle`: the Polymorphic Reference

`FileHandle = FileEntryHandle | FilePathHandle` (see [`packages/shared/file/types/handle.ts`](../../../packages/shared/file/types/handle.ts)) is the first-class reference type crossing the IPC boundary. Every IPC method that makes sense regardless of which subsystem is in the loop accepts a `FileHandle`; handlers dispatch internally on `handle.kind`. See §3.3 for the full dispatch table.

Use `FileHandle` whenever a signature does not *inherently* require an entry row (e.g. anything that isn't a lifecycle op on a FileEntry).

### 2.3 `FileEntry` vs `FileInfo`

Once a handle is dispatched, the handler works with either a `FileEntry` (the DB row identified by an entryId) or a `FileInfo` (a live descriptor produced from a path). They are the two "data shapes" of a file:

| Aspect         | `FileEntry`                                                | `FileInfo`                                                |
|----------------|------------------------------------------------------------|-----------------------------------------------------------|
| Role           | DB row identified by `id`                                  | Live descriptor identified by `path`                      |
| Identity field | `id` (UUID v7)                                             | `path` (absolute filesystem path)                         |
| Liveness       | Persistent record — identity + stable projections only     | Live view — re-read from `fs.stat`                        |
| Lifecycle      | Persistent; trash/restore (internal-origin only)           | Transient — per-call descriptor                           |
| Produced by    | `createInternalEntry` / `ensureExternalEntry` / DataApi    | `fs.stat(path)` / `toFileInfo(entry)`                    |
| Typical use    | FileManager ops, UI management panels, `file_ref` creation | Pure content processors (OCR, hashing, tokenization)      |

**Field overlap is inherent, not redundant**: `name`, `ext`, `type` (and `mime` / `size` on `FileInfo`) describe a file regardless of whether an entry row exists for it. What distinguishes the two types is the *surrounding* fields and the *liveness* of the shared ones:

- **`FileEntry` has identity fields** `FileInfo` lacks: `id`, `origin`, `externalPath`, `trashedAt`.
- **`FileInfo` has live fields** `FileEntry` lacks: `path` (derived, never stored on `FileEntry`), `modifiedAt`, and a live `size`.
- **`FileEntry.size` is origin-gated**. For `origin='internal'` it is an authoritative byte count (kept in sync by atomic writes). For `origin='external'` it is **always `null`** — external files may change outside Cherry at any time, so no DB snapshot is stored. Consumers that need a live value for an external entry call File IPC `getMetadata(id)`, which runs `fs.stat` on demand. This eliminates the "is this snapshot current?" question at the type level rather than at call sites.
- **`FileEntry.name` / `FileEntry.ext` never drift**. For internal they are user-editable SoT; for external they are pure projections of `externalPath` (basename / extname) and therefore stable as long as the entry itself exists.

**Projection is one-way**. `FileEntry → FileInfo` is always possible via `toFileInfo(entry)` (async — performs `fs.stat` plus path resolution based on `origin`, which is also how the live `size` is materialized for external). The reverse is **not a type conversion**: it is a state change, and requires explicit registration through `FileManager.createInternalEntry` or `ensureExternalEntry`. The Zod brand on `FileEntrySchema` enforces this — arbitrary object literals cannot satisfy the `FileEntry` type.

### 2.4 Signature Selection Guide

Default to the narrowest type that covers the need. "When in doubt, `FileHandle`" for cross-boundary calls, and "when in doubt, `FileInfo`" for leaf content processors.

| What the consumer needs                                                                    | Signature                                |
|--------------------------------------------------------------------------------------------|------------------------------------------|
| Doesn't care which subsystem is in the loop; just operates on a file                       | `FileHandle` ⭐ default for IPC          |
| Only to call a FileManager lifecycle op (trash, restore, permanentDelete, …)               | `FileEntryId`                            |
| Only to hand a path to an ops-level FS function                                            | `FilePath`                               |
| The entry row's fields (UI management panel, origin-aware rendering, ref creation)         | `FileEntry`                              |
| A resolved on-disk descriptor for pure content processing                                  | `FileInfo` (typically a return type)     |

Anti-patterns to avoid:

- **Requiring `FileEntry` when only `path` or `size` is read** — this couples the caller to the entry system. Accept `FileHandle` (and dispatch), or accept `FileInfo` (and have the caller project).
- **Returning a value typed `FileEntry` whose contract is "might or might not be registered"** — use `FileHandle` or an explicit variant instead.
- **Synthesising a `FileEntry` from a `FileInfo`** — registration must go through sanctioned FileManager methods; the Zod brand is specifically there to prevent this.

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
    └── target: FilePath    → @main/utils/file/* (direct FS/path primitives)
```

Other services in the main process can call the FS primitives (`@main/utils/file/*`) or FileManager directly as needed, without going through IPC.

### 3.3 IPC Method Categories

All operations that can act on any file (FileEntry or arbitrary path) **accept a `FileHandle` tagged union** (`{ kind: 'entry', entryId } | { kind: 'path', path }`). Handlers dispatch by `handle.kind` to FileManager (entry branch) or the FS primitives (path branch).

**Operations that accept FileHandle (entry + path branches unified)**:

| Method | Description | entry, internal-origin | entry, external-origin | path |
|---|---|---|---|---|
| `read` | Read content | read(userDataPath) | read(externalPath) (live) | read(path) |
| `getMetadata` | Live physical metadata (`fs.stat`) — entry-id batch variant `batchGetMetadata` (id-only, see below) | resolve + stat | stat(externalPath) — **sole live-size source for external** | stat + getFileType |
| `getVersion` | FileVersion (live `fs.stat`) | stat userData | stat externalPath | statVersion |
| `getContentHash` | xxhash-h64 | read userData + hash | read externalPath + hash | contentHash |
| `write` | Atomic write | atomic → userData + DB size update | atomic → externalPath (explicit user edit; no DB size column to touch) | atomic → path |
| `writeIfUnchanged` | Optimistic concurrent write | same as write plus version check | same | same (caller must getVersion first) |
| `permanentDelete` | Delete entry | unlink userData + delete from DB | **delete from DB only** (physical file untouched; path-level deletion remains available via a `FilePathHandle` to `remove`) | remove(path) |
| `rename` | Rename | pure DB (UUID path unchanged) | fs.rename + DB update (name + externalPath) | rename(path, newPath) |
| `copy` | Copy to a new internal-origin entry | read source + create new internal | read source external + create new internal | read path + create new internal |
| `open` / `showInFolder` | System ops | resolve + shell | resolve + shell | shell |

**Operations accepting only FileEntryId (meaningful only when you already hold an entry id)**:

| Method | Description |
|---|---|
| `createInternalEntry` / `batchCreateInternalEntries` | Create a new Cherry-owned FileEntry (writes to `{userData}/Data/Files/{id}.{ext}`; each call produces an independent new entry, no conflict possible) |
| `ensureExternalEntry` / `batchEnsureExternalEntries` | Pure upsert by `externalPath`—the entry point first `canonicalizeExternalPath(raw)` normalizes it (see `pathResolver.ts`); reuses the existing entry with the same path or inserts a new one. Idempotent by design—callers may safely repeat calls. No "restore" branch: external entries cannot be trashed. External rows carry no stored `size` (always `null`); live values come from `getMetadata`. |
| `trash` / `restore` | Soft delete based on trashedAt (DB only). **Internal-origin only** — external-origin entries cannot be trashed (`fe_external_no_trash` CHECK); passing an external id throws. |
| `batchTrash` / `batchRestore` | Batch versions of `trash` / `restore` — same internal-origin-only rule. |
| `batchPermanentDelete` | Batch version of `permanentDelete`. |
| `withTempCopy` | Copy isolation for calling third-party libraries |
| `getDanglingState` / `batchGetDanglingStates` | Query external-origin entry presence (FS-backed via DanglingCache; cold miss triggers a single `fs.stat`). Internal-origin entries always `'present'`. |
| `getPhysicalPath` / `batchGetPhysicalPaths` | Resolve absolute path for a FileEntry (main-side `resolvePhysicalPath`). Intended for agent context / drag-drop / subprocess spawn. Also the input to `toSafeFileUrl` for `<img src>` / `<video src>` rendering. |
| `batchGetMetadata` | Batch version of `getMetadata` — list-page flows MUST use this over `Promise.all(ids.map(id => getMetadata(...)))`. Handler parallelises `fs.stat` internally; single IPC round-trip. Returns `Record<id, PhysicalFileMetadata \| null>` — `null` marks per-id stat failure (missing / permission), caller falls back to "—". Not handle-native on purpose: path-handle stats have no N-call motivation (pickers/dialogs surface <20 items). |

**How to obtain dangling state / absolute path / live size**: these are FS-IO or main-side computation, so they live in File IPC — never DataApi. Dangling state via `getDanglingState` / `batchGetDanglingStates`, path via `getPhysicalPath` / `batchGetPhysicalPaths`, live `size` / `mtime` via `getMetadata` / `batchGetMetadata`. Any flow iterating over >1 entry MUST reach for the batch form to avoid N+1 IPC. DataApi's SQL-only boundary is documented in §4.1.1.

**How to obtain a `file://` URL for rendering**: compose it in-process from the `FilePath` returned by `getPhysicalPath`, using the shared pure helper `toSafeFileUrl(path, ext)` in `@shared/file/urlUtil` — no dedicated IPC needed. The helper applies the danger-file wrap (`.sh` / `.bat` / `.ps1` / `.exe` / `.app` etc. → containing directory URL) and does cross-platform `file://` encoding.

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
| Trash from Cherry | **Not applicable** — external-origin entries cannot be trashed (`fe_external_no_trash` CHECK) |
| Restore from Cherry | **Not applicable** — external-origin entries are never trashed |
| permanentDelete from Cherry (entry-level) | **Untouched** — only the DB row is deleted; the physical file remains on disk |
| write / writeIfUnchanged from Cherry | **Overwritten** (atomic write) |
| Rename from Cherry | **Physically renamed** (the external filename also changes) |
| `remove(path)` (from `@main/utils/file/fs`) via `FilePathHandle` (path-level) | **Deleted** — this is a deliberate path-level operation, not coupled to any file_entry row |

**Key principles**:
- Cherry does not perform automatic / watcher-driven external file modifications
- Cherry does perform user-explicitly-requested external file modifications (save, rename)
- **Entry-level deletion (`permanentDelete` on an external file_entry) does NOT touch the physical file** — this decouples "remove from Cherry's tracking" from "destroy on disk". If a user truly wants to delete the physical file, they invoke the path-level `remove(path)` (from `@main/utils/file/fs`, via a `FilePathHandle`) explicitly, which is not bound to any entry row.
- External entry lifecycle is monotonic (Active → Deleted), with no Trashed state — "remove entry from Cherry's view" always means clearing the DB row + cascading `file_ref` rows
- **Cherry does not track external file rename/move**—when a file is moved outside of Cherry, the corresponding entry becomes dangling (best-effort semantics); the caller must proactively call `ensureExternalEntry` on the new path to establish a new reference (upsert by path; reuses existing entry if hit)

Similar to VS Code's behavior model for open files: it changes when you tell it to, without modifying behind the scenes; if you change the file externally, it won't auto-follow.

**UX labeling convention for `permanentDelete` (product contract)**:

The IPC method name `permanentDelete` is polymorphic on handle/origin and does not translate literally to user-facing copy. The three branches have materially different user-observable effects; UI surfaces MUST choose the label at the call site based on `(handle.kind, entry.origin)`:

| Call site | User-facing label | Confirmation copy |
|---|---|---|
| entry handle, `origin = 'internal'` | "Permanently delete" / "永久删除" | "This file will be permanently deleted from your library and from disk. This action cannot be undone." |
| entry handle, `origin = 'external'` | "**Remove from library**" / "从库中移除" | "Cherry will stop tracking this file. The file on disk is not affected; it will remain where it is." |
| path handle | "Delete file" / "删除文件" | "This file will be permanently removed from disk. This action cannot be undone." |

The internal and path branches are **true destructive actions** (red button, clear warning). The external-entry branch is an **un-tracking** operation — the user's file is not touched. Presenting it with "permanent delete" language creates two classic bug paths:

1. User expects disk deletion → later finds the file still in Finder/Explorer → files a bug report
2. User hesitates or avoids the action fearing data loss → accumulates dangling library entries they actually want removed

**Enforcement**: convention-only, verified at PR review. The IPC method name is intentionally kept polymorphic (preserves §3.2's "unified entry + kind dispatch" design); what varies is the UI copy around the call — product layer owns that.

**UI filter convention for dangling external entries**:

FilesPage and similar user-facing **list surfaces** SHOULD hide external entries with `DanglingState === 'missing'` by default, with a "Show missing files" toggle for power-user re-linking. Rationale:
- UI noise reduction: dangling entries are far more common than present ones over the lifetime of heavy users (every `@`'d file whose user later moves/deletes becomes dangling eventually)
- Pairs with the automatic cleanup policy in [`file-manager-architecture.md §7.2`](./file-manager-architecture.md#72-dangling-external-auto-cleanup-layer-3-extension) — entries that are dangling AND have lost all refs are eventually garbage-collected; the UI filter hides them during the retention window

**Exception — reference-oriented surfaces**: when a specific message's attachment list, a knowledge item's source files, or any other view that consumes `file_ref` shows entries, dangling rows MUST remain visible (with a "file missing" marker). Hiding them would silently suppress the "your attached file is gone" signal the user needs in order to act — re-attach, remove the reference, etc. The auto-cleanup rule specifically excludes `refs > 0` entries for the same reason.

### 3.5 AI SDK Integration (Deferred)

**AI SDK upload-related** → FileUploadService methods (**deferred implementation**, to be introduced after the AI SDK Files API is stable):

| Method                              | Description                      |
| ----------------------------------- | -------------------------------- |
| `ensureUploaded(entryId, provider)` | upload-if-needed                 |
| `buildProviderReference(entryId)`   | Build SharedV4ProviderReference  |
| `invalidate(entryId)`               | Clear cache (on content change)  |

### 3.6 Mutation Propagation to Renderer (deferred — lands in Phase 2)

> **Status**: design only. Nothing in Phase 1 implements this surface — the
> three typed events, the `useFileManagerEventsBinding()` hook, the
> `WindowManager` broadcast wiring, and the queryKey-prefix dispatch table
> are all Phase 2 deliverables. Sibling `file-manager-architecture.md §1.6.8`
> tags the matching emission slot `(deferred)` consistently. Renderers
> requiring freshness in Phase 1 rely on React Query's natural `staleTime`
> refresh — the same fallback the section opening describes as "brittle"
> below.

Every main-side mutation that changes an entry's DB row, a file's physical content, or the dangling state of an external path invalidates zero or more renderer-side React Query caches. Manual per-caller invalidation is brittle — if any business caller forgets to invalidate after `rename`/`write`/`permanentDelete`, the UI shows stale data for up to the `staleTime` window.

**Design**: FileManager owns both IPC registration (§3.1–3.4) and **post-dispatch event broadcast**. Mutation methods fire in-process `Event<T>` after a successful commit; FileManager's own `onInit` subscribes to those events (plus `DanglingCache.onDanglingStateChanged`) and forwards each via `WindowManager`'s broadcast helper to every live renderer window. Consolidating transport with dispatch keeps both concerns in the single place that already holds renderer-facing IPC authority — no dedicated broadcaster service.

**Event contract** (three independent typed events — see [`file-manager-architecture.md §1.6.8`](./file-manager-architecture.md#168-event-emission--broadcast) for emission timing within each mutation):

| Event | Fired when | Payload | QueryKey **prefixes** to invalidate |
|---|---|---|---|
| `onEntryRowChanged` | `createInternalEntry` / `ensureExternalEntry` / `update` / `rename` / `trash` / `restore` / `permanentDelete` (and batch variants) commit successfully | `{ kind: 'created' \| 'updated' \| 'deleted', id: FileEntryId, origin: FileEntryOrigin }` | `['fileManager', 'entry']`, `['fileManager', 'entries']`, `['fileManager', 'refCounts']`, `['fileManager', 'physicalPath']` |
| `onEntryContentChanged` | `write` / `writeIfUnchanged` / `createWriteStream` commit completes | `{ id: FileEntryId, version: FileVersion }` | `['fileManager', 'metadata']`, `['fileManager', 'version']`, `['fileManager', 'contentHash']` |
| `onDanglingStateChanged` | `DanglingCache` transitions an entry's state (watcher event / cold `fs.stat` observation / explicit `ops` observation) | `{ id: FileEntryId, state: 'present' \| 'missing' }` | `['fileManager', 'dangling']` |

Three separate events, not a discriminated union: invalidation targets per event are disjoint enough that renderer-side dispatch should be `event type → queryKey prefix`, not `payload field → queryKey`. Adding a new event type (e.g. `onUploadStateChanged` when AI SDK lands) costs one handler in the renderer binding.

**QueryKey convention** — required shape for every React Query cache that shadows file-manager state:

| Singular queryKey | Batch queryKey | Shadows |
|---|---|---|
| `['fileManager', 'entry', id]` | — | DataApi `GET /files/entries/:id` |
| — | `['fileManager', 'entries', ...filters]` | DataApi `GET /files/entries` (list; no singular form) |
| — | `['fileManager', 'refCounts', sortedIds]` | DataApi `GET /files/entries/ref-counts` (batch-only endpoint) |
| `['fileManager', 'metadata', id]` | `['fileManager', 'metadata', 'batch', sortedIds]` | File IPC `getMetadata` / `batchGetMetadata` |
| `['fileManager', 'version', id]` | — | File IPC `getVersion` (no batch variant) |
| `['fileManager', 'contentHash', id]` | — | File IPC `getContentHash` (no batch variant) |
| `['fileManager', 'dangling', id]` | `['fileManager', 'dangling', 'batch', sortedIds]` | File IPC `getDanglingState` / `batchGetDanglingStates` |
| `['fileManager', 'physicalPath', id]` | `['fileManager', 'physicalPath', 'batch', sortedIds]` | File IPC `getPhysicalPath` / `batchGetPhysicalPaths` |

**Convention rules**:

1. **Fixed namespace**: every key starts with `['fileManager', <kind>, ...]`. `<kind>` names the resource (one of the second-element values above). Deviating requires a paired update to this table and the renderer binding hook.
2. **Singular = id as third element**: `['fileManager', <kind>, id]`. This is the canonical form — most renderer hooks produce keys in this shape.
3. **Batch = `'batch'` marker + sorted id array as fourth element**: `['fileManager', <kind>, 'batch', sortedIds]`. Always sort ids before keying (lexicographic by `FileEntryId` string) so equivalent batches share a cache entry regardless of input order.
4. **Filter / compound keys append after the third element**: `['fileManager', 'entries', { origin: 'external' }]`. Filters are structured objects, not positional arguments — React Query hashes them structurally.

**Invalidation semantics — prefix-based, uniformly**:

The broadcast binding invalidates at the `['fileManager', <kind>]` prefix (second-element depth), which hits **both singular and batch variants** under that kind. Invalidating `['fileManager', 'metadata']` refreshes every cache under that kind — singular per-id, batch-of-ids, anything keyed off it — regardless of the specific id reported by the event.

This is intentionally coarse: a `write` on entry X invalidates entry Y's metadata cache too. The cost is one extra refetch per unrelated cache; React Query's query-level dedup keeps the network cost bounded, and desktop-scale apps have tens of caches, not thousands. The benefit is that dispatch is one `invalidateQueries` call per kind, and batch caches are automatically covered.

If a future hot spot needs precision (e.g. a view renders 500 independent metadata queries and over-invalidation measurably hurts), upgrade that specific dispatch to predicate-based matching:

```typescript
queryClient.invalidateQueries({
  predicate: (q) =>
    q.queryKey[0] === 'fileManager' &&
    q.queryKey[1] === 'metadata' &&
    (q.queryKey[2] === id || (Array.isArray(q.queryKey[3]) && q.queryKey[3].includes(id)))
})
```

Predicate-based invalidation is an optimization; prefix-based is the default.

**Delivery semantics — best-effort fire-and-forget**:

- **No delivery guarantee**: renderer windows unmounted / starting up / crashed during broadcast lose events. `staleTime ≤ 5min` contract (§4.1.1) is the backstop — lost events mean caches refresh on their natural cadence rather than instantly.
- **No ordering guarantee**: multiple events for the same id may arrive out of order. `queryClient.invalidateQueries` is idempotent, repeated invalidations are benign.
- **Emit cannot roll back commit**: broadcasts fire after the DB transaction commits; if `windowManager.broadcast` throws, the mutation return value is unaffected — the data is durable, only the notification is lost.

**Renderer integration**: a single hook `useFileManagerEventsBinding()` installed once at the application root. It subscribes to the preload-exposed `onFileManagerEvent(listener)` bridge and dispatches each event to `queryClient.invalidateQueries({ queryKey: [...] })` per the dispatch table. Idempotent mounting — if the hook mounts twice, it de-duplicates listeners.

**Design boundary**: events carry **identity + minimal state-change info, never the post-mutation data itself**. Renderers always refetch through the established query/IPC surface — events are invalidation signals, not data pushes. This keeps channel payload bounded and lets React Query manage freshness policy per consumer.

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

DataApi endpoints (read-only, SQL-only, fixed-shape):

| Endpoint                         | Method | Purpose                                                                 |
| -------------------------------- | ------ | ----------------------------------------------------------------------- |
| `/files/entries`                 | GET    | FileEntry list (supports origin / trashed / time-range filters). Fixed shape. |
| `/files/entries/:id`             | GET    | Single entry lookup. Fixed shape.                                       |
| `/files/entries/ref-counts`      | GET    | Ref-count aggregation for a batch of entry ids (pure SQL JOIN + GROUP BY). |
| `/files/entries/:id/refs`        | GET    | All references to a file.                                               |
| `/files/refs/by-source`          | GET    | All files referenced by a business object.                              |

> **DataApi vs File IPC decision criteria (strict boundary)**:
> - **DataApi** = **pure SQL read queries only**. Handlers MUST NOT touch FS, MUST NOT call main-side resolvers (`resolvePhysicalPath`), MUST NOT consult in-memory caches outside the DB (no `danglingCache.check`, no `versionCache`). The response shape is **fixed per endpoint**. SQL aggregations (JOIN / GROUP BY / COUNT) are the only allowed "derivation" because they remain DB-layer.
> - **File IPC** = everything else. All mutations (create / rename / delete / move / write / trash), **and** every read that needs FS IO or main-side computation (content read, dangling probe, path resolution, dialogs, streams, `open`).
>
> Rule of thumb: if a handler must call anything outside the Drizzle / `@db/*` surface to answer the request, it belongs in IPC. If two callers want the same data in different shapes, the answer is **two endpoints**, not one endpoint with a flag.

**List queries for external entries**: DataApi returns the DB row directly — identity (`id`, `origin`, `externalPath`), stable projections (`name`, `ext`), timestamps, `trashedAt`. External rows carry `size: null` by design (no snapshot stored). Consumers needing **live `size` / `mtime`** call File IPC `getMetadata(id)`; those needing only **whether the file currently exists** (dangling) call File IPC `getDanglingState` / `batchGetDanglingStates`.

### 4.1.1 DataApi Boundary: SQL-Only, Fixed Shape

DataApi handlers are strictly SQL-backed. A handler:

- MUST NOT read or `stat` the filesystem
- MUST NOT call main-side resolvers (`resolvePhysicalPath`, etc.)
- MUST NOT consult in-memory caches outside the DB (no `danglingCache.check`, no `versionCache`)
- MUST return a fixed shape per endpoint

The only allowed "derivation" inside DataApi is **SQL aggregation** (JOIN / GROUP BY / COUNT), because that stays in the DB layer.

**Enrichments that require FS IO or main-side compute** are served by File IPC (or an in-process pure helper), never by DataApi:

| Capability                                   | Call site                                                               | Kind                                                    |
|----------------------------------------------|-------------------------------------------------------------------------|---------------------------------------------------------|
| Ref counts per entry                         | DataApi `GET /files/entries/ref-counts?entryIds=...` — dedicated endpoint | Pure SQL aggregation (JOIN + GROUP BY)                  |
| Dangling / presence state                    | File IPC `getDanglingState` / `batchGetDanglingStates`                  | FS-backed (DanglingCache + cold-path `fs.stat`)         |
| Absolute physical path                       | File IPC `getPhysicalPath` / `batchGetPhysicalPaths`                    | Main-side path resolution                               |
| `file://` URL for HTML rendering             | Shared pure helper `toSafeFileUrl(path, ext)` (`@shared/file/urlUtil`), composed in-process from the `FilePath` returned by `getPhysicalPath` | Pure formatting + danger-file wrap (no IPC of its own)  |
| Live `size` / `mtime` for external           | File IPC `getMetadata(id)` (single) / `batchGetMetadata({ ids })` (list-page flows) | FS-backed (`fs.stat`) — external rows have `size: null` in DB by design; batch variant is mandatory when iterating (§3.3) |

**Why this split**: DataApi's value is a predictable, cache-friendly, SQL-level surface. Once a handler can reach past the DB, every consumer inherits hidden IO costs whether they asked for them or not, and React Query cache keys stop being a reliable freshness boundary. Keeping FS / compute side effects on File IPC makes the cost visible at the call site and keeps DataApi endpoints cache-safe.

**Composition in the renderer**: fetch the entry list via DataApi, then call the relevant batch IPC method(s) with the retrieved ids. Wrap the two-step pattern in a dedicated hook (e.g. `useEntriesWithPresence`) so components stay declarative.

**Staleness contract for dangling (best-effort)**: `dangling` is an FS-observed time-varying value — the watcher may not cover every path, and a file may be externally deleted right after a cache hit. Consumers of `getDanglingState` / `batchGetDanglingStates` MUST allow a natural refresh lifecycle (React Query `staleTime` ≤ 5min, or explicit refetch after a user action). **Do not** cache the result with `staleTime: Infinity` — that equates to the contradictory "I want dangling but refuse to re-check". For user-triggered refresh, invalidate the presence query (the refetch re-runs the IPC, which repopulates the cache via a cold `fs.stat`).

**Safety conventions for raw path / URL**:

- **`getPhysicalPath` — NOT intended for**: caching as a stable identifier (storage layout may change); string-concat into shell commands without independent sanitization; bypassing FileManager for writes. Use `entry.id` when identity is all you need.
- **`toSafeFileUrl` — scoped capability**: the danger-file wrap defends only HTML rendering contexts (`<img src>` / `<video src>` / `<embed>`), not arbitrary string concatenation. Don't compose this URL into command-line args or subprocess arguments — pass the raw `FilePath` from `getPhysicalPath` instead.
- Both are bound **by convention**; the type system cannot prevent misuse of a `string`. Code review should verify each call site against the intended uses listed here.

### 4.1.1.1 Main Is SoT for Path Resolution

"Main as SoT for path resolution" means **authority (who defines the resolution rule)** — `resolvePhysicalPath` decides how `id + ext` are concatenated, where `userData` lives, whether the layout becomes hash-bucketed in the future, etc. The renderer consumes the string values produced by Main (via File IPC `getPhysicalPath`), but does not share authority:

- When storage layout iterates on the Main side, renderer code needs zero changes
- The renderer **holds** the string value (locality), but does not **define** the computation rules (authority)

The spread of **locality** (a path string arriving in the renderer via IPC) is not the spread of **authority** (ownership of the resolution rule). The former is a natural consumption relationship; only the latter would actually tear the SoT apart.

Pure **formatting** helpers built on top of an already-resolved path — `toFileUrl` (cross-platform `file://` encoding), `isDangerExt` (HTML-render danger policy), `toSafeFileUrl` (the composition used for `<img src>`) — live in the shared `@shared/file/urlUtil` module and run in whichever process needs them. They consume Main's authoritative path string but carry no authority themselves; storage-layout changes in Main still don't affect them.

### 4.1.2 Typical Renderer Call Flows

The new pattern is **DataApi for SQL-level data + File IPC for enrichments**, composed in the renderer. Each extra enrichment = one more `useQuery` against an IPC method.

```typescript
// Shared helper used throughout: every queryKey in the 'fileManager' namespace
// sorts its id array so equivalent batches share a cache entry (§3.6).
const sortIds = (ids: FileEntryId[]) => [...ids].sort()

// Case 1: FilesPage — list + presence + preview URL + ref counts
//         (external rows also need live size via batchGetMetadata)
const { data: entries } = useQuery(fileApi.listEntries, {})
const entryIds = entries?.map(e => e.id) ?? []
const externalIds = entries?.filter(e => e.origin === 'external').map(e => e.id) ?? []

const { data: presence } = useQuery(
  ['fileManager', 'dangling', 'batch', sortIds(entryIds)],
  () => window.api.fileManager.batchGetDanglingStates({ ids: entryIds }),
  { enabled: entryIds.length > 0 }
)
const { data: paths } = useQuery(
  ['fileManager', 'physicalPath', 'batch', sortIds(entryIds)],
  () => window.api.fileManager.batchGetPhysicalPaths({ ids: entryIds }),
  { enabled: entryIds.length > 0 }
)
const { data: liveMeta } = useQuery(
  ['fileManager', 'metadata', 'batch', sortIds(externalIds)],
  () => window.api.fileManager.batchGetMetadata({ ids: externalIds }),
  { enabled: externalIds.length > 0 } // internal.size is already on the DataApi row
)
const { data: refCounts } = useQuery(
  ['fileManager', 'refCounts', sortIds(entryIds)],
  () => fileApi.refCounts({ entryIds }),
  { enabled: entryIds.length > 0 }
)
// size lookup: prefer DB (internal SoT), fall back to live stat (external):
//   const size = entry.size ?? liveMeta?.[entry.id]?.size
// stat failures surface as `liveMeta?.[id] === null` — render "—" in that case.
// render (URL computed in-process — no extra IPC):
//   <img src={paths && toSafeFileUrl(paths[entry.id], entry.ext)} />
//   dangling: presence?.[entry.id], count: refCounts?.[entry.id]

// Case 2: Agent compose — list + absolute paths (same IPC as above, different consumer)
const { data: entries } = useQuery(fileApi.listEntries, { ids: selectedFileIds })
const { data: paths } = useQuery(
  ['fileManager', 'physicalPath', 'batch', sortIds(selectedFileIds)],
  () => window.api.fileManager.batchGetPhysicalPaths({ ids: selectedFileIds })
)
const filePaths = selectedFileIds.map(id => paths?.[id]).filter(Boolean).join('\n')

// Case 3: Simple chat attachment list — no enrichment needed
const { data: entries } = useQuery(fileApi.listEntries, { origin: 'internal' })
```

**Anti-pattern — N+1 IPC**: DO NOT write `Promise.all(ids.map(id => window.api.fileManager.getMetadata(...)))` or the equivalent for `getDanglingState` / `getPhysicalPath`. Every singular IPC is an independent `ipcMain.handle` round-trip (~0.1ms overhead each); 1000-entry list pages pay >100ms purely in IPC overhead before any `fs.stat` runs. The batch variants run one IPC + `Promise.all`-parallelised handler work — constant round-trip cost.

Benefits of the split:

- **DataApi is predictable**: one SQL query per endpoint, deterministic cost, cache-friendly
- **Enrichment cost is explicit** at the call site — every FS/compute hop has a visible `useQuery` next to it
- **Mutations uniformly go through IPC**, cleanly separating "view data" from "change data"
- **Renderer is unaware of internal storage layout**; main-side storage changes don't propagate

For patterns that recur across components, encapsulate the composition in a hook (e.g. `useEntriesWithPresence(filter)`) so callers stay declarative.

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
| .select()     |           |   |   + @main/utils/file/* prims)    |
| .open()  ...  |           |   |                                  |
|               |           |   +-- path ops ---> @main/utils/file |
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
| FS:   none -- delegates ALL FS ops to @main/utils/file/* primitives     |
| DB:   delegates to FileEntryService / FileRefService (repository)       |
|       maintains in-memory LRU version cache                             |
| Own:  Electron dialog API (showOpenDialog/showSaveDialog)               |
+-------------------------------------------------------------------------+
| Startup Orphan Sweep  (background task inside FileManager)              |
|                                                                         |
| Role: clean up internal UUID files not in DB + *.tmp-<uuid> residues    |
| FS:   via @main/utils/file/*                                            |
| DB:   read-only DB queries                                              |
+-------------------------------------------------------------------------+
| DanglingCache  (file_module singleton, not lifecycle)                   |
|                                                                         |
| Role: track external entry presence state (present/missing/unknown)     |
| State: Map<entryId, DanglingState> + reverse index Map<path, entryIds>  |
| Updates: watcher events (auto-wired), ops observations, cold-path stat  |
| Queried by: File IPC getDanglingState / batchGetDanglingStates          |
+-------------------------------------------------------------------------+
| DirectoryWatcher  (NOT lifecycle -- consumable primitive)               |
|                                                                         |
| Role: chokidar wrapper with optional rename detection                   |
| Factory: createDirectoryWatcher() auto-wires events into DanglingCache  |
| Used by: business modules that need directory monitoring                |
+-------------------------------------------------------------------------+
| @main/utils/file/*  (pure functions)  *** FS OWNER FOR MAIN PROCESS *** |
|                                                                         |
| Role: the sole modules that import `node:fs` / `electron.shell` for     |
|       main-process FS ops; consumable by business services, FileManager,|
|       BootConfig, MCP oauth, etc. (everyone that needs raw FS)          |
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
| **FileManager**          | lifecycle       | via repository | **No (via @main/utils/file/*)** | dialog            | Yes (IPC)           |
| **DanglingCache**        | singleton       | read-only once at startup | No (cache only; fs via primitives) | No          | Indirect (via DataApi) |
| **DirectoryWatcher**     | primitive class | No             | Indirect (chokidar)     | No                        | No (used by business modules) |
| **`@main/utils/file/*`** | pure functions  | No             | **Yes (sole FS owner)** | shell (open/showInFolder) | No                  |
| **FileEntryService**     | data repository | Yes (direct)   | No                      | No                        | Yes (via DataApi)   |
| **FileRefService**       | data repository | Yes (direct)   | No                      | No                        | Yes (via DataApi)   |

**Core principles**:

- **`@main/utils/file/*` owns all `node:fs` imports**—every main-process FS operation flows through these primitives. Any main module (BootConfig, MCP oauth, business services, etc.) can import them — e.g. `atomicWriteFile` from `@main/utils/file/fs`
- **FileManager is the sole entry point for entry operations**—registers IPC handlers, resolves entryId → filePath, coordinates DB (via repository) + FS (via `@main/utils/file/*`)
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
|  |  -- version / live metadata --                           |    |
|  |  getVersion / getContentHash / getMetadata                |    |
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
|  | @main/utils/file/*  *** FS OWNER (pure functions) ***     |    |
|  |  fs.ts:      read / write / stat / copy / move / remove   |    |
|  |              atomicWriteFile / atomicWriteIfUnchanged     |    |
|  |              createAtomicWriteStream                      |    |
|  |              statVersion / contentHash (xxhash-h64)       |    |
|  |  shell.ts:   open / showInFolder                          |    |
|  |  path.ts / metadata.ts / search.ts                        |    |
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

- **Renderer → Main (read, SQL-backed data)**: DataApi → Handler → FileEntryService → DB (pure SQL; no FS, no resolvers)
- **Renderer → Main (read, FS / compute-backed enrichment)**: File IPC → FileManager → DanglingCache / resolvePhysicalPath (side effects allowed). `file://` URL composition happens in-process on top of the returned path via the shared `toSafeFileUrl` helper — no dedicated IPC.
- **Renderer → Main (write)**: IPC → FileManager (coordinates DB + `@main/utils/file/*` primitives)
- **Business Service → file data**: pure DB operations call data repositories directly; FS-involving operations go through FileManager
- **External directory monitoring**: business services create instances via the `createDirectoryWatcher()` factory and subscribe to the events they care about; the factory internally injects events into DanglingCache (business unaware)

### 5.2 Touchpoints for Business Services

Business services interact with the file module through three channels:

- **No-FS-side-effect operations** (entry queries, reference management) → import data repositories directly (`fileEntryService` / `fileRefService`)
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

Reference implementation (`tempSession` ships as the template):

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
    |   +-- fileEntryService.getById(entryId)       -> FileEntry
    |   +-- fileEntryService.findMany(query)        -> FileEntry[]
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
    x-- fs.readFile / writeFile / unlink                 -> FORBIDDEN for FileEntry paths
    x-- @main/utils/file/fs direct on FileEntry-backed paths -> FORBIDDEN (same reason)
    x-- FilePathHandle pointing at {userData}/Data/Files/{uuid}.{ext}
                                                   -> FORBIDDEN for writes — silently desyncs
                                                       FileEntry.size on internal entries
```

**Why business services are forbidden from directly operating on the physical files backing a FileEntry**:

- **Path opacity**: the physical path is determined by origin (internal = UUID-based; external = user-provided); business services must not assume it
- **DB consistency (internal only)**: `FileEntry.size` is authoritative for internal rows and is kept in sync by FileManager's atomic write path. Writing the UUID-backed file directly (via `@main/utils/file/fs` or a `FilePathHandle` to `{userData}/Data/Files/...`) leaves the stored `size` stale relative to the physical file — a silent DataApi drift with no type-system guard.
- **Cache consistency**: FileManager maintains an in-memory `versionCache`; bypassing it leaves `getVersion` returning stale `(mtime, size)` until the next write/reconcile. `writeIfUnchanged` is unaffected (it always re-stats — see [`file-manager-architecture.md §4.4`](./file-manager-architecture.md#44-lru-version-cache)), but UI surfaces that display cached mtime can show stale values.
- **Atomicity guarantee**: writes must go through FileManager's atomic write path

**Enforcement model** — this is a **convention-only constraint**: neither the type system nor `@main/utils/file/fs` runtime checks the target path against the internal-storage tree. Legitimate consumers of the primitives outside the file module (BootConfig, MCP oauth, etc.) operate on their own directories and are unaffected; the scope of the rule is specifically "do not point writes at `{userData}/Data/Files/`". Violations are caught by code review.

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
+-- FileManager                  -- entry coordination + IPC + event broadcast
      @DependsOn(DbService, WindowManager)
      onInit(): registers IPC, inits LRU cache, inits DanglingCache reverse
                index from DB, wires mutation events to WindowManager
                broadcast (see §3.6), FIRES background orphan sweep
                (sweep runs async; does NOT block ready)

Background (fire-and-forget, non-blocking)
+-- OrphanRefScanner             -- delayed 30s, scan orphan refs
+-- FileManager.runOrphanSweep   -- started in onInit, cleans internal UUID
                                    files not in DB + *.tmp-<uuid> residues

Singletons / Primitives (no lifecycle):
+-- @main/utils/file/*            -- sole FS owner, stateless pure functions
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
                       4. subscribe to own mutation Events + DanglingCache
                          events, wire to windowManager.broadcast (§3.6)
                       5. fire void this.runOrphanSweep()  ◄── not awaited
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
  +-- queries entries via fileEntryService (no FS side effect)
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
    FileEntryService.ts               -- repository: exports fileEntryService
    FileRefService.ts                 -- repository: exports fileRefService
  api/handlers/
    files.ts                          -- DataApi handler, no FS side effect
  db/schemas/
    file.ts                           -- file_entry / file_ref

src/main/services/file/               -- file module
  FileManager.ts                      -- entry lifecycle + IPC + startup orphan sweep (background)
  orphanSweep.ts                      -- internal helper: UUID file + *.tmp residue cleanup
  danglingCache.ts                    -- singleton: external entry presence state
                                         exports: check / onFsEvent / addEntry / removeEntry
  watcher/
    DirectoryWatcher.ts               -- chokidar wrapper primitive
    factory.ts                        -- createDirectoryWatcher() — auto-wires danglingCache
    index.ts                          -- barrel export

src/main/utils/file/                  -- pure FS primitives, sole FS owner, open to the entire main process
  index.ts                            -- barrel; re-exports `./legacyFile`
  fs.ts                               -- read / write / stat / copy / move / remove
                                         atomicWriteFile / atomicWriteIfUnchanged
                                         createAtomicWriteStream
                                         statVersion / contentHash
  shell.ts                            -- open / showInFolder
  path.ts                             -- resolvePath / isPathInside / canWrite / isNotEmptyDir
  metadata.ts                         -- getFileType / isTextFile / mimeToExt
  search.ts                           -- listDirectory (ripgrep + fuzzy matching)
  legacyFile.ts                       -- shared helpers: getFileType(ext) / sanitizeFilename / getAllFiles / pathExists / …
```

---

## 8. Constraints and Limitations

- **External entry is a best-effort reference**: no guarantee the file remains stable, no guarantee content matches the reference-time content. Equivalent to "the user expressed intent to reference this path at some point" semantics in tools like codex
- **External entry path is globally unique**: at most one row per `externalPath` at any time, regardless of any state (SQLite global unique index on `externalPath`; internal rows have `externalPath = null` and are exempt, since SQLite treats multiple NULLs as distinct). `ensureExternalEntry` is therefore a pure upsert by path — reuse if an entry exists, otherwise insert; no "restore" branch is possible because external entries cannot be trashed.
- **External entries cannot be trashed**: enforced at the DB layer by `CHECK (origin != 'external' OR trashedAt IS NULL)` (`fe_external_no_trash`). External lifecycle is monotonic: create via `ensureExternalEntry` → update in place via `write` / `rename` → remove via `permanentDelete` (DB row only). There is no soft-delete / restore cycle for external entries. Calling `trash` / `restore` on an external id throws.
- **External entries allow explicit user edits**: `write` / `writeIfUnchanged` / `createWriteStream` / `rename` take effect on external (delegated to ops' atomic write / fs.rename), triggered by explicit user action. Cherry does **not** perform automatic / watcher-driven external file modifications
- **`permanentDelete` on external is entry-level, not file-level**: removes only the DB row + CASCADE-cleans `file_ref`; the physical file is left untouched. Path-level deletion remains available via `remove(path)` (from `@main/utils/file/fs`, reached through a `FilePathHandle`), which is a separate explicit call not bound to any entry id.
- **Cherry does not track rename/move of external files**: an external rename turns the entry dangling; the user must re-@ to establish a new reference
- **External entry DB row carries no `size`**: `size` is `null` on every external row by design (enforced by `fe_size_internal_only` CHECK). `name` / `ext` are pure projections of `externalPath` and do not drift. Live `size` / `mtime` are served by File IPC `getMetadata(id)` via `fs.stat`; DataApi never exposes them.
- **Dangling state exposed via DanglingCache + File IPC query methods** (`getDanglingState` / `batchGetDanglingStates`); never exposed via DataApi: not persisted to DB; watcher events + cold-path stat push updates
- **Physical paths are not persisted**: internal is derived from `application.getPath('feature.files.data', ...)`; external is read from the `externalPath` column
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
| Dangling reactivity (real-time push to renderer) | Currently pull-based via File IPC `getDanglingState` + React Query refresh; future could push state changes over IPC so renderer invalidates presence queries on DanglingCache events |
| Cross-device file sync                  | Out of file_module scope; solved by the application layer or external sync tools (Drive/Dropbox) |
| Full-text search                        | `@main/utils/file/search` provides ripgrep-based scanning; persistent indexes managed by businesses like Knowledge |
