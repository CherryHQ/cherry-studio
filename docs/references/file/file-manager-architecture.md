# FileManager Architecture

> **SoT scope** — **this document** owns: FileEntry / FileRef data models, physical storage layout, version detection & concurrency control (OCC), atomic writes, recycle bin, reference cleanup, DirectoryWatcher internals, startup orphan sweep, DanglingCache state machine, and AI SDK integration design. **Module-level** concerns (type system, IPC / DataApi contracts, layered architecture, business-service integration, lifecycle assignment) live in [`architecture.md`](./architecture.md). In case of conflict, the layer ownership above decides: positioning / contract → the module-level doc, implementation → this document.
>
> **Phase note**: this document describes the **target implementation shape** of FileManager. In Phase 1a only the type contracts, DB schema, interface skeletons, and JSDoc semantics are landed; all runtime logic is delivered in Phase 1b.1–1b.4. When a section describes a behavior (dispatch, OCC, atomic writes, orphan sweep, etc.), read that as the **specification the implementation must satisfy**, not as "already working in Phase 1a code".
>
> **Phase badges used below**: `[1a ✅]` already in code · `[1b.1]` read path & repository · `[1b.2]` write path & lifecycle · `[1b.3]` watcher & DanglingCache · `[1b.4]` orphan sweep & FileRefCheckerRegistry. See [RFC §9](../../../v2-refactor-temp/docs/file-manager/rfc-file-manager.md#九分阶段实施计划) for the full phase-by-phase deliverables.
>
> Related documents:
>
> - `v2-refactor-temp/docs/file-manager/rfc-file-manager.md` — Implementation design document (Schema, API details, migration strategy)

---

## 1. Core Concepts

### 1.0 Management Principle

FileManager provides file management capabilities for two origins; callers choose based on their own needs:

- **`internal`**: Cherry owns the file content, stored at `{userData}/files/{id}.{ext}`. The caller hands the source content to FileManager, which copies it and takes over the lifecycle.
- **`external`**: Cherry only records an absolute path reference on the user's side; does not copy content. File availability and content changes are determined by the user side.

**The caller decides the origin**; FileManager makes no assumptions about the business layer. For specific callers' migration/current state, see the RFC.

**Best-effort semantics for external**: an external entry is a persistent record that "the caller expressed intent to reference this path at some point in time"—no guarantee the file remains stable, no guarantee content matches the reference-time content. Cherry does no bidirectional DB-FS sync, doesn't track external rename/move; external changes naturally surface as "reading new content next time" or "dangling".

Data categories that do not enter FileManager (auto-derived data, logs, Agent workspace, OCR intermediates, MCP config, files self-managed by FS-first modules, etc.) are detailed in [architecture.md §1.3](./architecture.md#13-out-of-scope).

### 1.1 FileEntry

Each FileEntry corresponds to a file the user uploaded/saved. FileEntry is a **flat individual record**—no directory tree, no parent-child relationship, no mount concept.

```
FileEntry
├── id: UUID v7
├── origin: 'internal' | 'external'
├── name: filename (without extension)
├── ext: extension (without leading dot), nullable
├── size: bytes
├── externalPath: absolute path, non-null only when origin='external'
├── trashedAt: ms epoch | null
├── createdAt / updatedAt
```

### 1.2 Origin: internal vs external

The `origin` field of each FileEntry defines **content ownership**:

| origin | Physical location | Ownership | Mutability |
|---|---|---|---|
| `internal` | `{userData}/files/{id}.{ext}` | Fully owned by Cherry | Read-write |
| `external` | Absolute path pointed to by `externalPath` | Owned by user, referenced by Cherry | **Changeable by explicit user action** (write / rename / permanentDelete apply, delegated to ops); Cherry does no automatic/watcher-driven modifications; **does not track external rename/move**—external changes cause the entry to naturally go dangling |

**Path uniqueness**: at most one entry can exist for the same `externalPath` **in a non-trashed state**. Implemented via SQLite partial unique index: `UNIQUE(externalPath) WHERE origin='external' AND trashedAt IS NULL`.

**Canonical invariant of `externalPath`**: SQLite performs **byte-level** comparison on the `externalPath` field and cannot detect `FILE.pdf` ≡ `file.pdf` (case-insensitive FS) or NFC ≡ NFD (Unicode). Therefore, `externalPath` **must** be normalized via `canonicalizeExternalPath(raw)` before persistence—this is an application-layer invariant, with `ensureExternalEntry` and `fileEntryService.findByExternalPath` as mandatory call sites.

| Source | Natively canonical | Relies on normalization to disambiguate |
|---|---|---|
| Electron `showOpenDialog` | ✅ (OS returns the on-disk true case) | None |
| Drag-drop from Finder/Explorer | ✅ (OS drag source) | None |
| User-typed `@/path/...` / clipboard paste | ❌ | Risk of case / NFD/NFC |
| External URL scheme / shell integration | ❌ | Same as above |
| v1 migration (inherits Dexie stored values) | ❌ (inherits legacy value quality) | Canonicalize once during migration |

**Phase 1b normalization scope** (synchronous, no FS IO):
- `path.resolve(raw)` → absolutize + eliminate `./` `../`
- `.normalize('NFC')` → Unicode normalization (closes the NFD/NFC window for macOS CJK)
- Trailing separator trimming

**Phase 1b intentionally omits** (deferred to Phase 2 based on user feedback):
- `fs.realpath` for case-insensitive FS dedup (requires async FS IO + file existence precondition)
- Symlink target merging
- Windows 8.3 short-name resolution

See the JSDoc for `canonicalizeExternalPath` in `src/main/data/utils/pathResolver.ts` for the detailed contract.

Invariants:

| Field | origin='internal' | origin='external' |
|---|---|---|
| `name` | SoT (user can rename actively) | Pure projection of `externalPath` (basename) |
| `ext` | SoT | Pure projection of `externalPath` (extname) |
| `size` | SoT (non-null, ≥ 0) | **Always `null`** — no DB snapshot; live value via `getMetadata` |
| `externalPath` | NULL | Absolute path (the authoritative identity of external) |

For external entries the row stores only identity + stable projections. `name` / `ext` do not drift because `externalPath` is fixed for the lifetime of the entry (external rename by the user surfaces as a dangling entry, not an in-place rewrite of `name`). `size` / `mtime` are served live by File IPC `getMetadata(id)` on demand — see [§3 External Entry Liveness Model](#3-external-entry-liveness-model).

### 1.3 FileRef (Business Reference)

Business objects polymorphically associate with FileEntry via FileRef:

```
FileRef
├── fileEntryId → FileEntry (FK, CASCADE delete)
├── sourceType: registered by each business module (polymorphic, no FK on sourceId)
├── sourceId: business object ID
├── role: business-semantic reference role (defined by business module)
└── UNIQUE(fileEntryId, sourceType, sourceId, role)
```

The enum values of `sourceType` / `role` are declared by each business module when registering their `SourceTypeChecker`, and are compile-time-closed (Layer 3 orphan scanning depends on this closure; see §7).

When a business object is deleted, the business Service is responsible for cleaning up the corresponding FileRef (Section 7).

### 1.4 FileHandle / FileInfo — see `architecture.md §2`

`FileHandle` (polymorphic reference crossing IPC), `FileInfo` (path-indexed data shape), and the full reference-vs-data-shape symmetry are defined at the **module-level architecture document**, not here. This document concerns FileManager's internal implementation only.

- **`FileHandle`** (tagged union / factories / dispatch): [`architecture.md §2.2`](./architecture.md#22-filehandle-the-polymorphic-reference)
- **`FileEntry` vs `FileInfo`** (semantic comparison / field invariants / projection rules): [`architecture.md §2.3`](./architecture.md#23-fileentry-vs-fileinfo)
- **Signature selection guide & anti-patterns**: [`architecture.md §2.4`](./architecture.md#24-signature-selection-guide)

**Method applicability inside FileManager**:

| Category                                                                                                              | Methods                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Accept `FileHandle`** (entry + path branches via IPC dispatch)                                                      | `read` / `getMetadata` / `getVersion` / `getContentHash` / `write` / `writeIfUnchanged` / `rename` / `permanentDelete` / `copy` / `open` / `showInFolder` |
| **Accept `FileEntryId` only** (entry-identity operations; no path-handle counterpart)                                 | `trash` / `restore` / `createInternalEntry` / `ensureExternalEntry` / `withTempCopy`                              |

### 1.5 FileUpload (AI Provider Upload Cache) — deferred

AI SDK `SharedV4ProviderReference` integration and the `file_upload` table are **deferred** until the Vercel AI SDK Files API stabilises. The module-level DataApi surface (`ensureUploaded` / `buildProviderReference` / `invalidate`) is outlined in [`architecture.md §3.5`](./architecture.md#35-ai-sdk-integration-deferred); the detailed schema and FileUploadService API are retained here in [§9 AI SDK Integration](#9-ai-sdk-integration-fileuploadservice--deferred) for the eventual landing PR.

### 1.6 FileManager Implementation Layout (Facade + Private Internals) `[1a ✅ skeleton]` `[1b.1-1b.4 impl]`

FileManager is the **sole public entry point** of the file module but is not a 30-method God class. The implementation uses a **facade + private pure-function modules** pattern.

#### 1.6.1 Why It Can Be Split

A method-by-method audit of FileManager's public API for "does it depend on class instance state" concludes: **the vast majority of methods do not depend on instance state**.

| State | Users | Ownership |
|---|---|---|
| `versionCache` (LRU) | `write` / `writeIfUnchanged` / `getVersion` | **class private field** (held by FileManager instance) |
| `fileEntryService` / `fileRefService` | All DB operations | container singleton (`application.get(...)`) |
| `danglingCache` | External-related methods | file-module singleton (module import) |
| `ops/*` | All FS operations | pure functions, stateless |
| IPC handler registration handles, orphan sweep handle | lifecycle | managed by `onInit` / `onStop` |

Only **versionCache** and **lifecycle artifacts** are truly bound to the FileManager instance; business methods themselves are stateless.

#### 1.6.2 Module Layout

```
src/main/file/
├── index.ts              ← barrel: exports only FileManager + public types
├── FileManager.ts        ← facade class; lifecycle + IPC + versionCache
├── internal/             ← private implementation (not re-exported by index.ts; external imports forbidden)
│     ├── deps.ts              — FileManagerDeps type
│     ├── entry/
│     │    ├── create.ts       — createInternal / ensureExternal
│     │    ├── lifecycle.ts    — trash / restore / permanentDelete + batches
│     │    ├── rename.ts
│     │    ├── copy.ts
│     │    └── metadata.ts     — getMetadata (live fs.stat for both origins)
│     ├── content/
│     │    ├── read.ts         — read / createReadStream (including `readByPath` variants)
│     │    ├── write.ts        — write / writeIfUnchanged / createWriteStream
│     │    └── hash.ts         — getContentHash / getVersion
│     ├── system/
│     │    ├── shell.ts        — open / showInFolder
│     │    └── tempCopy.ts     — withTempCopy
│     └── orphanSweep.ts       — startup orphan scan task
└── versionCache.ts       ← LRU type definition
```

#### 1.6.3 Dependency Passing Convention

Each `internal/*` pure function explicitly receives `FileManagerDeps`:

```typescript
// internal/deps.ts
export interface FileManagerDeps {
  readonly repo: FileEntryService
  readonly versionCache: VersionCache
  readonly danglingCache: DanglingCache
}

// internal/entry/create.ts — two APIs, corresponding to two public methods on the FileManager facade
// Note: CreateInternalEntryParams is a source-discriminated union
//   (source: 'path' | 'url' | 'base64' | 'bytes'); each branch only exposes content
//   that name/ext cannot be derived from. Full matrix in `packages/shared/file/types/ipc.ts`
//   and `v2-refactor-temp/docs/file-manager/file-arch-problems-response.md` (extension of A-7).
export async function createInternalEntry(
  deps: FileManagerDeps,
  params: CreateInternalEntryParams
): Promise<FileEntry> {
  // Extract { name, ext, bytes } by source branch → write physical file → DB insert; always produces a new entry
}

export async function ensureExternalEntry(
  deps: FileManagerDeps,
  params: EnsureExternalEntryParams
): Promise<FileEntry> {
  // Upsert by externalPath: one of reuse / restore / insert
}
```

#### 1.6.4 Thin-Delegation Facade

```typescript
// FileManager.ts
export class FileManager extends BaseService implements IFileManager {
  private readonly versionCache = new VersionCache(1000)
  private readonly repo = application.get('FileEntryService')

  private get deps(): FileManagerDeps {
    return { repo: this.repo, versionCache: this.versionCache, danglingCache }
  }

  // public API: thin delegates; naming strictly aligned with semantics (create = new, ensure = upsert)
  createInternalEntry(params) { return entryCreate.createInternalEntry(this.deps, params) }
  ensureExternalEntry(params) { return entryCreate.ensureExternalEntry(this.deps, params) }
  read(id, opts?) { return contentRead.readByEntry(this.deps, id, opts) }
  trash(id) { return entryLifecycle.trash(this.deps, id) }
  // ... one line per method

  protected async onInit() {
    this.registerIpcHandlers()
    void orphanSweep.run(this.deps) // fire-and-forget
  }
}
```

#### 1.6.5 FileHandle Dispatch Convention (Adapter Responsibility at the IPC Boundary)

**Dispatch location**: `FileHandle.kind` dispatch **stays at the IPC handler registration site**. Rationale:

- `FileHandle` is the input shape at the IPC serialization layer—the renderer sends a `{ kind, ... }` tagged union, and post-deserialization kind-dispatch is a "request interpretation" concern—it is the **proper responsibility** of the IPC adapter layer
- FileManager's public API remains entry-native (accepts only `FileEntryId`); main-side business service calls are intuitive without needing a `createFileEntryHandle(id)` wrapper
- The `FilePathHandle` branch **only needs the IPC handler**; main-side business services hold FileEntries—they have no arbitrary-path scenario

**Internal module convention**: each action file exposes consistently named variants by kind:

```typescript
// internal/content/read.ts
export async function readByEntry(deps, entryId, opts): Promise<ReadResult<T>>    // serves FileManager public API
export async function readByPath(deps, path, opts): Promise<ReadResult<T>>         // serves the path-handle branch of IPC handler
// future: export async function readVirtual(deps, handle, opts)
```

`*ByEntry` flows through FileManager's public methods; `*ByPath` (and future `*Virtual`) **do not** go through FileManager's public methods—they serve the path-handle branch of the IPC handler only.

**Unified style for dispatch helper**: to prevent "every IPC method writing its own if-else" noise, FileManager provides a small internal helper:

```typescript
// FileManager.ts (private)
private dispatchHandle<T>(
  handle: FileHandle,
  byEntry: (entryId: FileEntryId) => Promise<T>,
  byPath: (path: FilePath) => Promise<T>
): Promise<T> {
  switch (handle.kind) {
    case 'entry': return byEntry(handle.entryId)
    case 'path':  return byPath(handle.path)
  }
}

private registerIpcHandlers() {
  this.ipcHandle('file.read', (handle, opts) =>
    this.dispatchHandle(handle,
      id   => this.read(id, opts),
      path => contentRead.readByPath(this.deps, path, opts)
    )
  )
  this.ipcHandle('file.write', (handle, data) =>
    this.dispatchHandle(handle,
      id   => this.write(id, data),
      path => contentWrite.writeByPath(this.deps, path, data)
    )
  )
  // ... other IPC methods that accept FileHandle

  // IPC methods that accept only FileEntryId pass through directly
  this.ipcHandle('file.trash', ({ id }) => this.trash(id))
  this.ipcHandle('file.createInternalEntry', params => this.createInternalEntry(params))
  this.ipcHandle('file.ensureExternalEntry', params => this.ensureExternalEntry(params))
}
```

**Impact of adding a new handle kind** (e.g., `virtual` pointing into archive members, `remote` pointing to an S3 URI):

1. `packages/shared/file/types/handle.ts` — add variant to handle union
2. Relevant `internal/*/*.ts` — add corresponding `*Virtual` / `*Remote` pure functions
3. `FileManager.ts` — add a callback parameter to the `dispatchHandle` signature; each IPC handler explicitly handles that kind (or throws "unsupported")

**The extension surface is concentrated in a single file, FileManager.ts**—it's immediately obvious which kinds each IPC method supports, which aids auditing. This is lighter than introducing a separate `FileAccessor` class while achieving the same "extension convergence".

#### 1.6.6 External Access Constraints

| Location | May import | Forbidden to import |
|---|---|---|
| Main-side business service (KnowledgeService, MessageService, etc.) | `@main/file` (gets FileManager) / `@main/file/ops` / `@main/file/watcher` | `@main/file/internal/**` |
| Inside file-module itself (`internal/*`, `ops/*`, `watcher/*`) | May reference each other as needed | Except FileManager, must not import `internal/*` |
| External Node/renderer | N/A (file-module is main-side) | — |

**Boundary enforcement**: the `src/main/file/index.ts` barrel re-exports only public types + the `FileManager` class; `internal/` symbols cannot be reached via `@main/file`. If violations are found during Phase 1b implementation, add an ESLint `no-restricted-imports` rule.

#### 1.6.7 Design Trade-offs

| Option | Adopted? | Rationale |
|---|---|---|
| Split business methods into 5 lifecycle services | ❌ | Overkill—lifecycle registration, dependency ordering, and test mocking costs all 5×, in exchange only for "methods split across files" |
| FileManager as facade + `internal/*` pure functions | ✅ | Only 1 lifecycle node; pure functions can be unit-tested with stub deps directly; external API surface remains stable |
| FileAccessor as a standalone class handling `FileHandle` dispatch | ❌ | Dispatch itself is a proper responsibility of the IPC adapter layer; converging into the `dispatchHandle` helper inside FileManager suffices; splitting off another layer adds pure complexity |
| FileManager public API switched to handle-native | ❌ | IPC and Main-side call contracts need not share shape; main-side business services using entry-native directly is more intuitive, without needing a `createFileEntryHandle` wrapper |
| Extract versionCache as a module singleton | ❌ | As a FileManager private field, it naturally supports test isolation (new instance = fresh cache) |

---

## 2. Storage Architecture

### 2.1 Physical Path Rules

Physical paths are not persisted; resolved at runtime based on `origin`:

```typescript
function resolvePhysicalPath(entry: FileEntry): string {
  if (entry.origin === 'internal') {
    return application.getPath('files', `${entry.id}${entry.ext ? '.' + entry.ext : ''}`)
  }
  return entry.externalPath!
}
```

**internal** physical paths are always flat: `{userData}/files/{uuid}.{ext}`, and do not change with the FileEntry's `name`. UUID naming makes internal files **invisible and not manually organizable by the user**—this is an intentional design choice.

**external** physical paths are entirely determined by the user; Cherry does not touch them.

### 2.2 Physical Directory Structure

```
{userData}/files/
├── {uuid-1}.pdf
├── {uuid-2}.png
├── ...
└── {uuid-n}.tmp-{uuid}      ← Temporary files for atomic writes (abnormal residues cleaned by startup sweep)
```

Cherry creates no subdirectories under `{userData}/files/`. All internal files are stored flat.

### 2.3 Temporary File Handling

Transient processing files (OCR intermediates, PDF pagination, archive extraction, etc.) **do not create FileEntry** and use `ops/fs.ts` primitive operations directly under `{userData}/temp/` (or process-level `os.tmpdir()`). After processing, the business side cleans up or relies on OS mechanisms.

---

## 3. External Entry Liveness Model

### 3.1 Design: No DB Snapshot for Drift-Prone Fields

The external file can be modified or moved by the user at any time. Rather than carrying a DB snapshot that silently drifts (and then chasing it with "refresh" paths), **file_module stores only the fields that cannot drift while the entry exists**:

| Field on `file_entry` (external) | Source of truth | Drift possible? |
|---|---|---|
| `id`, `origin`, `createdAt`, `updatedAt` | DB row | No |
| `externalPath` | User intent at registration time | No (user-explicit changes go through `ensureExternalEntry(newPath)`) |
| `name` / `ext` | Pure projection of `externalPath` (`path.basename` / `path.extname`) | No (stable as long as `externalPath` is stable) |
| `size` | **Not stored** — always `null` (enforced by `fe_size_internal_only` CHECK) | N/A |

Live `size` / `mtime` for an external entry are obtained via File IPC `getMetadata(id)` (`fs.stat` on demand). This makes the freshness cost **explicit at the call site** rather than hiding a stale snapshot behind the `FileEntry.size` field.

### 3.2 Why Size Is Not Stored

The classic "DB snapshot + refresh paths" design produces two symmetric defect classes:

1. **Stale reads** — callers consume `FileEntry.size` assuming freshness, missing the part of the doc that says "snapshot may be stale".
2. **Bookkeeping bugs** — every write / read / hash path has to remember to UPDATE the snapshot; forgetting one leaves the snapshot behind.

Making `size` unavailable on the row eliminates both: the renderer cannot read a stale value (there is nothing to read), and the main-side code has no snapshot to maintain. The cost — one extra `fs.stat` per external row when size is actually needed — is localized and observable.

**Paths that used to refresh the snapshot**: `read` / `getVersion` / `getContentHash` on external all still run `fs.stat` as part of their own work (and update DanglingCache as a side effect), but they no longer UPDATE the DB row.

**Cherry does not track external rename**: after a user mv/rename outside of Cherry, the corresponding entry goes dangling. The user must re-@ inside Cherry to establish a new reference at the new path via `ensureExternalEntry(newPath)`.

### 3.3 Dangling Model

When an external file does not exist on disk (or is inaccessible), the corresponding entry is called **dangling**. Dangling state is maintained by **DanglingCache** (a file_module singleton); see §11 for details.

**Three states**:

| State | Meaning |
|---|---|
| `'present'` | The file was recently observed to exist (watcher event / stat success / ops operation observation) |
| `'missing'` | The file was recently observed to be absent (watcher unlink / stat ENOENT) |
| `'unknown'` | No watcher coverage, no prior stat (or cache was actively cleared) |

**Detection timing**:
- **Passive (pull)**: File IPC `getDanglingState` / `batchGetDanglingStates` query → `danglingCache.check(entry)` (synchronous on cache hit, single `fs.stat` on cold miss). DataApi never reads this cache.
- **Active push**: when a business module creates a watcher via `createDirectoryWatcher()`, the factory auto-wires add/unlink events into DanglingCache
- **Side effect**: FileManager's own read/stat/write operations also update the cache on success/failure

**UI semantics**: dangling entries show a failed style in the UI (grayscale, icon marker), but are **not auto-cleaned**—the file_ref chain is preserved; the user can manually permanentDelete or attempt to re-point.

---

## 4. Version Detection and Concurrency Control `[1a ✅ FileVersion type]` `[1b.1 statVersion]` `[1b.2 VersionCache + writeIfUnchanged]`

### 4.1 FileVersion

```typescript
interface FileVersion {
  mtime: number   // ms epoch
  size: number
}
```

Used as a fast signal for detecting external changes. Two tiers of usage:
- Fast path: `statVersion(path)` (microsecond-level, covers 99% of cases)
- Deep path: `contentHash(path)` → xxhash-128 (millisecond-to-second level, used when mtime/size match but further confirmation is needed)

Rationale for mtime + size as a signature:
- Six scenarios where mtime alone fails—multiple writes within the same ms, clock rewind, backup preserving mtime, user touch, low-precision FS (FAT32), in-place 1-byte edit—are covered by size or hash as fallbacks

### 4.2 Read API

```typescript
interface ReadResult<T> {
  content: T
  mime: string
  version: FileVersion
}

read(id, opts?: { encoding?: 'text' }): Promise<ReadResult<string>>
read(id, opts: { encoding: 'base64' }): Promise<ReadResult<string>>
read(id, opts: { encoding: 'binary' }): Promise<ReadResult<Uint8Array>>
```

`read` uniformly returns `{ content, mime, version }`. Returning version comes at near-zero cost—stat is already required on the read path.

### 4.3 Write vs WriteIfUnchanged

```typescript
write(id, data): Promise<FileVersion>
writeIfUnchanged(id, data, expectedVersion: FileVersion): Promise<FileVersion>
```

**Two independent methods** that force the caller to explicitly choose whether conflict detection is needed:

| Caller | Which to use | Reason |
|---|---|---|
| First-time write, overwrite, migration, preprocessing | `write` | No concurrency semantics |
| Editor save (Notes, Markdown, and other potential future consumers) | `writeIfUnchanged` | Must detect external changes |

On conflict, `writeIfUnchanged` throws `StaleVersionError`, and the caller decides on UX after catching (dialog, three-way merge, keep both versions, etc.).

**Behavior on external**: write / writeIfUnchanged / createWriteStream / rename / permanentDelete **all apply**—Cherry supports user-explicitly-triggered external file modifications (editor save, UI rename, user-confirmed delete), delegated to ops primitives like atomic write / fs.rename / ops.remove. Cherry **does not** perform automatic / watcher-driven external file modifications.

### 4.4 LRU Version Cache

FileManager maintains `Map<FileEntryId, CachedVersion>` internally (LRU, ~2000 entries):

| Trigger | Action |
|---|---|
| `write` / `writeIfUnchanged` completes | `set(id, new version)` |
| Critical path detects external change | `set(id, new version)` |
| Startup reconcile completes | `clear()` |

**Trust boundary**: the cache only accelerates `getVersion` queries and is not used for critical decisions. `writeIfUnchanged`'s concurrency comparison **must re-stat**; it does not trust the cache.

---

## 5. Atomic Writes `[1a ✅ signatures + JSDoc]` `[1b.2 impl]`

### 5.1 tmp + fsync + rename Flow

All writes (entry/internal to userData, entry/external to externalPath, path-handle to any path) follow the POSIX atomic flow:

```
1. Create {target}.tmp-{uuid} in the same directory
2. Write data to the tmp fd
3. fsync(tmp fd)                  ← data flushed to disk
4. rename(tmp, target)             ← atomic replacement (POSIX guarantee)
5. fsync(dir fd)                   ← rename metadata flushed to disk
```

Key rules:
- **fsync on by default**. Cherry's write frequency is user-action level, and fsync on SSD costs < 10ms
- **tmp must be in the same directory as target**. Cross-filesystem rename is not atomic
- **tmp naming**: `{target}.tmp-{uuidv7}`—UUID avoids concurrent-write conflicts
- **Crash residue**: FileManager's background orphan sweep cleans up by `^.+\.tmp-<uuidv7>$`
- **2× disk usage** is an inherent cost of POSIX rename semantics, unavoidable

### 5.2 Stream Variant

```typescript
createWriteStream(id): Promise<AtomicWriteStream>
```

Stream writes also follow tmp + rename. The returned `AtomicWriteStream` extends `Writable`; `.close()` triggers fsync + rename + fsync(dir); `.abort()` cancels and unlinks the tmp.

### 5.3 ops.ts External Access

The `atomicWriteFile` / `atomicWriteIfUnchanged` / `createAtomicWriteStream` primitives exported by `ops/fs.ts` **are open to modules outside file_module**. BootConfig / MCP oauth storage / utils/file, etc., uniformly migrate to these, eliminating scattered tmp+rename implementations.

---

## 6. Deletion and Recycle Bin `[1a ✅ schema + CHECK]` `[1b.2 impl]`

### 6.1 trashedAt Model

All soft deletes are implemented via the `trashedAt` timestamp, without physically moving files:

| Operation | Physical impact (internal) | Physical impact (external) |
|---|---|---|
| `trash(id)` | None | **None** (DB marks only; user file untouched) |
| `restore(id)` | None | **None** (DB clears trashedAt) |
| `permanentDelete(id)` | unlink FS + delete from DB | **ops.remove(externalPath) + delete from DB** |

**trash / restore only touch DB for both origins**—soft delete is a "reversible temporary hide", at which point FS is not touched to preserve reversibility.

**permanentDelete deletes FS for both origins**—this is an explicit "fully clean up" user action. permanentDelete on external delegates to `ops.remove(externalPath)`, really deleting the user file. Unlink failures (ENOENT, insufficient permissions, etc.) are logged but do not block DB deletion, keeping the DB-FS final state consistent (neither side has it).

### 6.2 Auto Expiry

By default trashed entries are cleaned up after 30 days (lifecycle service timer); the user may configure the days or disable it in Preferences.

Query: `WHERE trashedAt < now() - retentionMs` → batch permanentDelete.

### 6.3 Edge Cases

| Scenario | Handling |
|---|---|
| unlink fails on permanentDelete (file already missing, permission issue) | Ignore ENOENT idempotently; log warn for others; proceed with DB delete |
| externalPath not writable on permanentDelete external (read-only mounted drive, insufficient permissions) | log error; still delete DB record; from the user's perspective it disappears from Cherry but remains on disk |
| `ensureExternalEntry(path)` when an entry for the same path already exists | Entry point first calls `canonicalizeExternalPath(raw)`; upsert returns the existing row. External entries cannot be trashed, so there is no "restore" branch. |
| **Two entries for the same file due to case / NFC differences** (macOS APFS, Windows NTFS, or NFD ↔ NFC input) | Phase 1b canonicalize closes the NFC window; case-insensitive FS dedup not implemented (see §1.2 "Phase 1b normalization scope")—will add `fs.realpath` + one-off migration when there is concrete user feedback |
| External file at original path externally replaced with a different file | Cherry does not check content consistency (best-effort). `name` / `ext` on the row are derived from `externalPath` and do not change; `size` is always served live by `getMetadata`. DanglingCache flips to `'present'` on the next stat, so the UI just renders the new file under the existing reference. |
| A trashed entry is permanently externally deleted and then restored | Appears dangling (DanglingCache returns missing on next check), UI shows failed style |
| External write with permission error / disk full on target path | Throw without polluting DB; caller decides retry or user notification |

---

## 7. Reference Cleanup Mechanism `[1a ✅ FileRefSourceType union]` `[1b.4 FileRefCheckerRegistry impl]`

Three layers of protection, with each layer as a fallback for the next:

```
+-------------------------------------------------------+
| Layer 1: fileEntryId CASCADE                          |
| FileEntry deleted -> file_ref auto-cascaded           |
| file_upload auto-cascaded                             |
| (DB FK constraint, zero app code)                     |
+-------------------------------------------------------+
| Layer 2: business delete hooks                        |
| business entity deleted -> cleanup file_ref           |
| (called in each Service's delete method)              |
+-------------------------------------------------------+
| Layer 3: registered orphan scanner                    |
| background scan for file_ref with missing sourceId    |
| compile-time enforced: Record<FileRefSourceType, ...> |
+-------------------------------------------------------+
```

Layer 3 enforces "every sourceType must have a checker" via the `Record<FileRefSourceType, OrphanChecker>` type constraint. Adding a sourceType without registering → compile error.

**No-reference file policy**: FileEntry is preserved and not auto-deleted. UI may show an "unreferenced" marker for the user to manually clean up.

---

## 8. DirectoryWatcher `[1a ✅ factory signature]` `[1b.3 impl]`

### 8.1 Positioning

`DirectoryWatcher` is a **non-lifecycle general FS primitive** (not a service), available for business modules to `new` themselves. It is merely a chokidar wrapper and binds no business semantics.

Placed in `src/main/file/watcher/`, **on the same level as `ops/` but as an independent submodule**. Rationale for the split:

| Aspect | `ops/` | `watcher/` |
|---|---|---|
| Paradigm | Pure functions (stateless) | Stateful class |
| Lifecycle | None (completes upon call) | Has one (start → running → dispose) |
| Resource holding | None | FSWatcher instance + pending queues + timers |
| Consumption contract | `const x = await ops.read(path)` | `const w = new DirectoryWatcher(...); ... w.dispose()` |

Placing a stateful class inside a barrel named "ops" (operations) breaks its pure-function contract. This is the layering between Node.js official `fs.readFile` (function) and `fs.watch` returning an `FSWatcher` instance (class) being merged under the same module due to naming—we explicitly split them apart.

### 8.2 API

```typescript
export type IgnoreRule =
  | { basename: string }    // exact filename match
  | { glob: string }         // micromatch against absolute path
  | { regex: RegExp }        // regex against absolute path

export type AwaitWriteFinishOption =
  | { enabled: true; stabilityThreshold?: number; pollInterval?: number }
  | { enabled: false }

export type RenameDetectionOption =
  | { enabled: true; windowMs?: number }
  | { enabled: false }

export interface DirectoryWatcherOptions {
  path: string
  ignored?: IgnoreRule[]
  depth?: number
  emitInitial?: boolean
  awaitWriteFinish?: AwaitWriteFinishOption   // default enabled, stability=200, poll=100
  renameDetection?: RenameDetectionOption      // default disabled
}

export class DirectoryWatcher implements Disposable {
  readonly onAdd: Event<{ path: string; stat: Stats }>
  readonly onChange: Event<{ path: string; stat: Stats }>
  readonly onUnlink: Event<{ path: string }>
  readonly onAddDir: Event<{ path: string; stat: Stats }>
  readonly onUnlinkDir: Event<{ path: string }>
  readonly onRename: Event<{ oldPath: string; newPath: string; stat: Stats }>
  readonly onReady: Event<void>
  readonly onError: Event<Error>

  constructor(opts: DirectoryWatcherOptions)
  start(): Promise<void>
  stop(): Promise<void>
  dispose(): void
}
```

### 8.3 Rename Detection Semantics

When enabled, unlink/add events are delayed `windowMs` to attempt pairing as a rename:

- Successful match → only `onRename` is emitted (the matched unlink/add are suppressed)
- No match → after timeout, unlink/add are emitted normally

**Key guarantee**: when enabled, `onUnlink`/`onAdd` and `onRename` **do not fire simultaneously**, so consumer semantics are clear.

**Platform precision**:
- Unix (macOS/Linux): prefers inode matching, falls back to size
- Windows: size only (NTFS ino is unstable), precision degraded and documented as acceptable

**Only file rename is handled**. Directory renames are not specially recognized; consumers combine sub-file events themselves.

### 8.4 Built-in Ignore Rules

OS garbage files are ignored by default (not disable-able):
- `{ basename: '.DS_Store' }`
- `{ basename: '.localized' }`
- `{ basename: 'Thumbs.db' }`
- `{ basename: 'desktop.ini' }`

Consumers may append `ignored`; merged after the default rules.

### 8.5 Usage Pattern

Business modules `new` + dispose themselves as needed:

```typescript
// Illustrative (non-file_module implementation)
const watcher = new DirectoryWatcher({
  path: source.basePath,
  renameDetection: { enabled: true }
})
watcher.onAdd(...)
watcher.onRename(...)
await watcher.start()
// ...
watcher.dispose()
```

file_module **starts no watcher instances**. Whether to monitor external directories is the business module's decision.

---

## 9. AI SDK Integration (FileUploadService) — **Deferred**

> ⚠️ **This section is a design record and is not in the scope of Phase 1a implementation**. Vercel AI SDK's Files Upload API (`FilesV4`, `SharedV4ProviderReference`) is still pre-release, and the corresponding dependency is unstable. FileUploadService, the `file_upload` table, and related IPC methods are all deferred to a separate PR after the SDK reaches stable. This section preserves the design intent for direct landing in the future.

### 9.1 Motivation

Cherry needs to integrate with the Vercel AI SDK's file upload API. The SDK's `SharedV4ProviderReference` models "the same logical file may be uploaded to N providers, each with its own fileId".

When it lands, a dedicated `file_upload` table tracks these uploads, decoupled from `fileEntry`.

### 9.2 Schema

```sql
CREATE TABLE file_upload (
  id              TEXT PRIMARY KEY,
  file_entry_id   TEXT NOT NULL REFERENCES file_entry(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  remote_id       TEXT NOT NULL,
  content_version TEXT NOT NULL,   -- xxhash-128 at upload time
  uploaded_at     INTEGER NOT NULL,
  expires_at      INTEGER,
  status          TEXT NOT NULL,   -- 'active' | 'expired' | 'failed'
  metadata        TEXT,             -- JSON, provider-specific
  UNIQUE(file_entry_id, provider)
);
```

### 9.3 Service API

```typescript
interface IFileUploadService {
  ensureUploaded(fileEntryId: FileEntryId, provider: string): Promise<FileUpload>
  buildProviderReference(fileEntryId: FileEntryId): Promise<SharedV4ProviderReference>
  invalidate(fileEntryId: FileEntryId): Promise<void>
}
```

**ensureUploaded** logic:
1. Look up (entryId, provider) in `file_upload`
2. Compute current contentHash (internal may trust versionCache; external must recompute)
3. If contentVersion matches + not expired → reuse
4. Otherwise: read content → call `provider.files().uploadFile()` → upsert `file_upload`

**buildProviderReference** assembles all active uploads into `Record<provider, remoteId>`.

### 9.4 Invalidation and Re-upload

- Content change (triggered by FileEntry write) → mark all file_upload as stale (or delete)
- Provider expiry (expires_at < now) → treat as missing on next use; re-upload
- Manually deleted on the provider side → upstream error on send, catch → `invalidate` + re-upload

---

## 10. Startup Orphan Sweep (FileManager Background Task) `[1b.4]`

### 10.1 Positioning

Startup orphan sweep is triggered by FileManager in `onInit()` as **fire-and-forget**:

```typescript
protected override onInit(): void {
  this.registerIpcHandlers()
  this.initVersionCache()

  // DanglingCache reverse index built synchronously from DB
  danglingCache.initFromDb()

  // 🔑 not awaited → ready signal is not blocked
  void this.runOrphanSweep().catch((err) => {
    logger.error('Orphan sweep failed', err)
  })
}

private async runOrphanSweep(): Promise<void> {
  // Scan {userData}/files/*:
  //   UUID v7 file AND not in fileEntryTable AND mtime > 5min → unlink
  //   *.tmp-<uuidv7> file AND mtime > 5min → unlink (atomic write crash residue)
}
```

**Rationale**:
- Orphan sweep typically completes <500ms; fire-and-forget doesn't consume startup time
- Runs in parallel with other services' `onInit()`; business services can depend on FileManager immediately
- Failure doesn't affect service availability (just residual orphans; rescanned on next startup)

### 10.2 DanglingCache Initialization

The reverse index of DanglingCache (`Map<path, Set<entryId>>`) is built via a single synchronous DB query:

```sql
SELECT id, externalPath FROM file_entry
WHERE origin = 'external' AND trashedAt IS NULL
```

**No stat performed**—the state field (`Map<entryId, DanglingState>`) is initially empty; lazy stat on query (see §11).

### 10.3 Why There Is No Dangling Probe

The old version batch-stat'd all external entries at startup to build the dangling set. The new version **cut this step**:

1. **Dangling is a pull-only IPC query** (`getDanglingState` / `batchGetDanglingStates`); most query scenarios don't need it, so it's never computed eagerly
2. **Lazy + Promise.all is fast enough**: on the first dangling query, N stats run in parallel, typically <100ms
3. **Watcher-covered paths have zero IO**: once a business module (NoteService, etc.) enables a watcher, dangling states for entries under the relevant directory are directly pushed by watcher events—no stat needed

### 10.4 Concurrency Safety

| Concurrency scenario | Result |
|---|---|
| createInternalEntry creates a new internal file during sweep | The `mtime > 5min` filter in orphan sweep prevents the new file from being mistakenly deleted |
| FileManager.read/write on existing entries during sweep | No mutual exclusion; read/write follow different code paths and are unaffected |
| app exits during sweep | No persistent side effect; rerun on next startup |

### 10.5 Crash Consistency

file_module's crash window is very narrow:

| Operation | Order | Crash mid-operation | Recovery |
|---|---|---|---|
| createInternalEntry | FS write UUID file → DB insert | Orphan file | Orphan sweep |
| write (internal) | atomic tmp+rename + DB update | One of new/old files preserved | Naturally consistent |
| trash / restore / rename | DB only | None | None |
| permanentDelete (internal) | FS unlink → DB delete | Dangling (truly dangling; manifests as read failure) | Naturally discovered on DanglingCache query |
| copy (internal) | FS copy → DB insert | Orphan file | Orphan sweep |
| ensureExternalEntry | DB insert / reuse / restore (doesn't touch user file) | None | None |
| permanentDelete (external) | DB delete + ops.remove | DB deleted but FS not / vice versa; final state "absent" on both sides is fine | Naturally consistent |

No WAL / pending_fs_ops table needed. Orphan sweep covers the internal crash residue; the external side naturally doesn't need it (delete failure just leaves it on disk).

---

## 11. DanglingCache (External Presence Tracker) `[1a ✅ interface]` `[1b.3 impl]`

### 11.1 Positioning

DanglingCache is a **singleton** in file_module (not a lifecycle service) that maintains the "latest known on-disk state" for external entries.

```typescript
// src/main/file/danglingCache.ts
export const danglingCache = new DanglingCache()
```

**Role**:
- Provides a fast query interface for File IPC `getDanglingState` / `batchGetDanglingStates` (cache hit returns synchronously; cold miss runs a single `fs.stat`). DataApi never reads this cache — DataApi is pure SQL.
- Consumes add/unlink events from all watchers (auto-wired via the factory)
- Consumes observation results from FileManager's own ops (read/stat/write success/failure)

### 11.2 State Model

```typescript
type DanglingState = 'present' | 'missing' | 'unknown'

class DanglingCache {
  private byEntryId: Map<FileEntryId, DanglingState>
  private pathToEntryIds: Map<string, Set<FileEntryId>>  // reverse index
  
  // Query (for DataApi handler)
  async check(entry: FileEntry): Promise<DanglingState>
  
  // Event entry (for watcher factory + FileManager ops)
  onFsEvent(path: string, state: 'present' | 'missing'): void
  
  // Index maintenance (for FileManager entry CRUD)
  addEntry(entryId: FileEntryId, externalPath: string): void
  removeEntry(entryId: FileEntryId, externalPath: string): void
  
  // Startup init
  initFromDb(): void
}
```

**Layered strategy for check**:

```typescript
async check(entry: FileEntry): Promise<DanglingState> {
  if (entry.origin === 'internal') return 'present'
  
  // L1: cache hit (no TTL; event-driven invalidation)
  const cached = this.byEntryId.get(entry.id)
  if (cached !== undefined) return cached
  
  // L2: cold-path stat once
  const state = await statToState(entry.externalPath!)
  this.byEntryId.set(entry.id, state)
  return state
}
```

### 11.3 Watcher Auto-Wiring

Business modules **need not be directly aware of DanglingCache**. All watchers must be created via the `createDirectoryWatcher()` factory, which hooks things up internally:

```typescript
// src/main/file/watcher/factory.ts
export function createDirectoryWatcher(opts: DirectoryWatcherOptions): DirectoryWatcher {
  const watcher = new DirectoryWatcher(opts)
  watcher.onAdd(({ path }) => danglingCache.onFsEvent(path, 'present'))
  watcher.onUnlink(({ path }) => danglingCache.onFsEvent(path, 'missing'))
  // Optional: rename event updates both sides
  watcher.onRename(({ oldPath, newPath }) => {
    danglingCache.onFsEvent(oldPath, 'missing')
    danglingCache.onFsEvent(newPath, 'present')
  })
  return watcher
}
```

**Note**: watcher rename events **do not auto-update an external entry's externalPath**—Cherry does not track external rename. After a rename, the original entry goes dangling; the user must re-@ to establish a new reference.

### 11.4 Reverse Index Maintenance

Timing for changes to `pathToEntryIds` (fully self-governed inside file_module, no DB-FS sync):

| Event | Action |
|---|---|
| Startup `initFromDb()` | `SELECT id, externalPath FROM file_entry WHERE origin='external' AND trashedAt IS NULL` → batch add |
| `ensureExternalEntry` creates new | addEntry(id, path) |
| `ensureExternalEntry` reuses (upsert hit) | No change (path already indexed) |
| `restore(external)` | addEntry(id, path) |
| `trash(external)` | removeEntry(id, path) (trashed entries don't participate in dangling tracking) |
| `permanentDelete(external)` | removeEntry(id, path) |
| `rename(external)` (explicit user action) | removeEntry(id, oldPath) + addEntry(id, newPath) |

### 11.5 Handler-Side Parallelization

The File IPC `batchGetDanglingStates` handler fans out over the requested ids in parallel:

```typescript
async function batchGetDanglingStates(ids: FileEntryId[]): Promise<Record<FileEntryId, DanglingState>> {
  const entries = await fileEntryService.batchGetById(ids)
  const pairs = await Promise.all(
    entries.map(async (e) => [e.id, await danglingCache.check(e)] as const)
  )
  return Object.fromEntries(pairs)
}
```

- Cache-hit entries return synchronously (microtask)
- Only cache-miss external entries go through stat, all in parallel
- 1000 entries cold-start typically <100ms (libuv threadpool parallel stat)
- Handler lives behind File IPC, not DataApi — the FS side effect is contained to the IPC channel where side effects are expected

### 11.6 State Invalidation Policy

**No TTL, event-driven invalidation**. Cache state changes only on the following events:

- Watcher add/unlink/rename events
- Observation side effects of FileManager ops (read success → present; stat ENOENT → missing; write success → present; rename success → oldPath missing + newPath present)
- Cold-path stat performed by `getDanglingState` / `getMetadata` on a cache miss

**No active expiry**—a few seconds of stale state does not affect best-effort semantics; paths without watcher coverage are naturally updated by ops observations on the next query.

### 11.7 Reactivity (Not Implemented Yet)

Current design does not actively push dangling changes to the renderer:
- Renderer's DataApi query refreshes per its own lifecycle (focus switch, refetch interval, etc.)
- UI presents a snapshot at query time

If real-time push is needed in the future, DanglingCache state changes may trigger invalidation of corresponding DataApi queries (not done in Phase 1a).

---

## 12. Key Design Decisions

| Decision | Conclusion | Core rationale |
|---|---|---|
| **Tree vs flat** | Flat | FileEntry manages "user-submitted independent files"; directory organization is not a file_module responsibility |
| **Mount abstraction** | Removed | All internal files live flat under `userData/files/`; external is reached directly via `externalPath`; no mount needed |
| **Origin two-state** | internal/external | Express "Cherry-owned" and "user-owned, Cherry-referenced" respectively; clear semantics |
| **External read/write permissions** | Explicit user ops may change; Cherry doesn't auto-change | VS Code-style behavior model—change when told to; don't modify behind the scenes |
| **External operation symmetry** | write/rename/permanentDelete all delegate to ops and take effect; trash/restore touch DB only | Soft delete preserves reversibility (doesn't touch FS); hard delete is the terminal action (really deletes FS) |
| **External identity** | externalPath unique(where not trashed) | At most one active entry at a time for the same path; `ensureExternalEntry` upserts by path |
| **Cherry tracks external rename** | Not tracked | Best-effort semantics; external rename → dangling → user re-@ |
| **Snapshot vs realtime stat** | External row stores only identity + stable projections (`name` / `ext` from `externalPath`); live `size` / `mtime` via `getMetadata` on demand | Eliminates stale-snapshot bug class at the type level; cost of the extra `fs.stat` is explicit at the call site instead of hidden behind a DB field |
| **Dangling state carrier** | In-memory singleton DanglingCache | Not in DB (avoids bidirectional DB-FS sync); three states `present/missing/unknown`; no TTL, event-driven invalidation |
| **Dangling exposure method** | File IPC `getDanglingState` / `batchGetDanglingStates` (never DataApi) | DataApi is pure SQL; FS probe lives in IPC where side effects are expected; zero cost by default; parallel stat on demand |
| **Watcher → DanglingCache wiring** | Factory auto-wires | Business modules unaware of DanglingCache; a single watcher instance serves business events + dangling tracking |
| **Content hash algorithm** | xxhash-128 | Optimal cost-performance for non-cryptographic scenarios (~20GB/s; 128-bit collision resistance is sufficient) |
| **Does write carry version** | Split into write / writeIfUnchanged | Force the caller to explicitly choose; avoid silent degradation to blind write when version is forgotten |
| **Atomic write fsync** | On by default | Correctness guarantee takes precedence over performance; Cherry is not a high-throughput scenario |
| **Trash model** | trashedAt timestamp | parentId unchanged; naturally supports expiry; no system_trash entries |
| **pending_fs_ops** | Removed | After extreme simplification, orphan sweep suffices to cover crashes |
| **Startup dangling probe** | Removed | Changed to lazy + Promise.all; stat only when an IPC caller explicitly requests dangling state |
| **Is Watcher a lifecycle service** | No | DirectoryWatcher is a primitive; business modules `new` it via the factory; file_module doesn't actively watch |
| **Directory import / bidirectional sync** | Moved out of file_module | Business modules (Knowledge, etc.) implement this with DirectoryWatcher + their own mapping tables |
| **AI SDK upload cache** | Standalone file_upload table (deferred) | Decoupled from mount / remote; naturally aligns with SharedV4ProviderReference |
| **Notes** | File tree is an independent domain, not mirrored to FileEntry | If other modules need to reference Notes files, they use the origin of their choice via the corresponding path |
