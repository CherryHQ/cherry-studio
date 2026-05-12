# FileManager Architecture

> **SoT scope** — **this document** owns: FileEntry / FileRef data models, physical storage layout, version detection & concurrency control (OCC), atomic writes, recycle bin, reference cleanup, DirectoryWatcher internals, startup orphan sweep, DanglingCache state machine, and AI SDK integration design. **Module-level** concerns (type system, IPC / DataApi contracts, layered architecture, business-service integration, lifecycle assignment) live in [`architecture.md`](./architecture.md). In case of conflict, the layer ownership above decides: positioning / contract → the module-level doc, implementation → this document.
>
> When a section describes a behavior (dispatch, OCC, atomic writes, orphan sweep, etc.), read it as the **specification the implementation must satisfy**. Sections explicitly tagged "(deferred)" describe planned architecture that is not yet implemented.

---

## 1. Core Concepts

### 1.0 Management Principle

FileManager provides file management capabilities for two origins; callers choose based on their own needs:

- **`internal`**: Cherry owns the file content, stored at `{userData}/Data/Files/{id}.{ext}`. The caller hands the source content to FileManager, which copies it and takes over the lifecycle.
- **`external`**: Cherry only records an absolute path reference on the user's side; does not copy content. File availability and content changes are determined by the user side.

**The caller decides the origin**; FileManager makes no assumptions about the business layer.

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
| `internal` | `{userData}/Data/Files/{id}.{ext}` | Fully owned by Cherry | Read-write |
| `external` | Absolute path pointed to by `externalPath` | Owned by user, referenced by Cherry | **Changeable by explicit user action** (write / rename / permanentDelete apply, delegated to the FS primitives); Cherry does no automatic/watcher-driven modifications; **does not track external rename/move**—external changes cause the entry to naturally go dangling |

**Path uniqueness**: at most one entry can exist for the same `externalPath` **in a non-trashed state**. Implemented via SQLite partial unique index: `UNIQUE(externalPath) WHERE origin='external' AND trashedAt IS NULL`.

**Canonical invariant of `externalPath`**: SQLite performs **byte-level** comparison on the `externalPath` field and cannot detect `FILE.pdf` ≡ `file.pdf` (case-insensitive FS) or NFC ≡ NFD (Unicode). Therefore, `externalPath` **must** be normalized via `canonicalizeExternalPath(raw)` before persistence—this is an application-layer invariant, with `ensureExternalEntry` and `fileEntryService.findByExternalPath` as mandatory call sites.

**Compile-time enforcement via `CanonicalExternalPath` brand**: `canonicalizeExternalPath()` returns a branded `CanonicalExternalPath` (TS phantom type, zero runtime cost; see `packages/shared/data/types/file/fileEntry.ts`). Every DB read/write surface that filters by `externalPath` — today `findByExternalPath`, and any future DataApi endpoint or repository method — MUST accept this type, not a plain `string`. The type system then guarantees callers routed their input through the normalization function, eliminating the "forgot to canonicalize" class of bug that would silently miss all matches.

| Source | Natively canonical | Relies on normalization to disambiguate |
|---|---|---|
| Electron `showOpenDialog` | ✅ (OS returns the on-disk true case) | None |
| Drag-drop from Finder/Explorer | ✅ (OS drag source) | None |
| User-typed `@/path/...` / clipboard paste | ❌ | Risk of case / NFD/NFC |
| External URL scheme / shell integration | ❌ | Same as above |
| v1 migration (inherits Dexie stored values) | ❌ (inherits legacy value quality) | Canonicalize once during migration |

**Normalization scope** (synchronous, no FS IO):
- Null-byte rejection — `raw.includes('\0')` → throw, so poisoned paths never reach DB persistence (reject at the earliest boundary, not at use-time inside `resolvePhysicalPath`)
- `path.resolve(raw)` → absolutize + eliminate `./` `../`
- `.normalize('NFC')` → Unicode normalization (closes the NFD/NFC window for macOS CJK)
- Trailing separator trimming

**Intentionally omitted** (deferred until concrete user feedback warrants the cost):
- `fs.realpath` for case-insensitive FS dedup (requires async FS IO + file existence precondition)
- Symlink target merging
- Windows 8.3 short-name resolution

See the JSDoc for `canonicalizeExternalPath` in `src/main/services/file/utils/pathResolver.ts` for the detailed contract.

#### Rule evolution discipline

Because the canonical form is **application-layer logic**, not DB schema, any change to `canonicalizeExternalPath`'s normalization steps desynchronizes historical rows (written under the old rule) from new queries (running under the new rule). This produces a silent failure mode: byte-compare misses, the user sees "my file is in the library but the app says it isn't", and `ensureExternalEntry` inserts a duplicate.

**Rule**: modifying `canonicalizeExternalPath` ≡ ship a paired Drizzle migration that re-canonicalizes every existing `file_entry` row with `origin='external'` in the **same PR**. No exceptions — even if the new rule is claimed "strictly more permissive", the byte-compare will still miss.

When a rule change additionally collapses previously-distinct strings to the same canonical form (e.g. adding `fs.realpath` merges APFS case-insensitive duplicates), the migration MUST also merge the colliding rows. The rules below are prescriptive; follow them exactly rather than improvising per-migration.

**Winner selection when merging rows**:

1. Oldest `createdAt` wins (preserves user-visible history — a 3-year-old entry's creation timestamp is more valuable than a 3-day-old one's).
2. Tiebreaker: highest ref count (keeps the entry that more of the user's data already points at).
3. Final tiebreaker: smallest `id` by lexicographic order (deterministic, no FS-state dependency).

**Losers' dependents** (executed in the same Drizzle transaction as the merge):

- `file_ref.fileEntryId = loser.id` → update to `winner.id`. No deduplication inside the `UNIQUE(fileEntryId, sourceType, sourceId, role)` constraint is expected because each `(sourceType, sourceId, role)` triple originally referenced only one entry; if violations occur, the update conflicts and the migration fails loudly (do not silently `ON CONFLICT DO NOTHING` — investigate).
- `file_entry.id = loser.id` → delete.
- Any downstream consumer of `loser.id` (future `file_upload.fileEntryId`, business-service caches keyed by entryId) MUST be enumerated and updated in the same migration. If you add a new table that references `file_entry.id`, the canonicalization migration procedure expands — document the expansion alongside the table's schema.

**Atomicity**: the entire re-canonicalize + merge operation runs in one Drizzle migration transaction. On failure the DB rolls back to the pre-migration state and the next startup re-attempts; partial progress is not possible.

**Renderer-side cache invalidation**: after the migration runs, some React Query caches keyed by the loser's `id` may be stale. Because migrations execute before the renderer boots, this is self-healing on the first query — no special coordination required.

#### Duplicate-entry detection on insert

To give operational visibility for the deliberately-omitted case-insensitive dedup (and other edge cases where the same physical file enters Cherry under two distinct canonical forms), `ensureExternalEntry`'s insert branch MUST perform a best-effort case-insensitive scan of existing external rows before completing the insert:

```typescript
// Inside ensureExternalEntry, AFTER canonicalize, AFTER findByExternalPath miss,
// BEFORE actually inserting:
const suspects = await fileEntryService.findCaseInsensitivePeers(canonicalPath)
if (suspects.length > 0) {
  logger.warn('External entry duplicate suspect on insert', {
    canonicalPath,
    existingIds: suspects.map(s => s.id),
    existingPaths: suspects.map(s => s.externalPath),
  })
}
// proceed with insert regardless — this is surveillance, not enforcement.
```

**Scope constraints**:
- Runs only on the **insert** branch, never on the reuse / update / read branches.
- The scan is best-effort: when the `file_entry` table exceeds a size threshold (e.g. 10k external rows) the scan is skipped silently rather than slowing down the hot path. The heuristic is operational support, not a correctness contract.
- Logs at `warn` level only — the insert itself proceeds unconditionally. Blocking the insert would contradict the "best-effort external reference" semantic ([architecture.md §1.0.2](./architecture.md#102-best-effort-semantics-for-external)).

This is the observability layer that makes the future `fs.realpath` upgrade decision **data-driven**: if `warn` records accumulate in production logs, the upgrade path in `canonicalizeExternalPath`'s JSDoc becomes the scheduled fix. If they don't, the deferral is retrospectively validated.

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

### 1.6 FileManager Implementation Layout (Facade + Private Internals)

FileManager is the **sole public entry point** of the file module but is not a 30-method God class. The implementation uses a **facade + private pure-function modules** pattern.

#### 1.6.1 Why It Can Be Split

A method-by-method audit of FileManager's public API for "does it depend on class instance state" concludes: **the vast majority of methods do not depend on instance state**.

| State | Users | Ownership |
|---|---|---|
| `versionCache` (LRU) | `write` / `writeIfUnchanged` / `getVersion` | **class private field** (held by FileManager instance) |
| `fileEntryService` / `fileRefService` | All DB operations | container singleton (`application.get(...)`) |
| `danglingCache` | External-related methods | file-module singleton (module import) |
| `@main/utils/file/*` | All FS operations | pure functions, stateless |
| IPC handler registration handles, orphan sweep handle | lifecycle | managed by `onInit` / `onStop` |

Only **versionCache** and **lifecycle artifacts** are truly bound to the FileManager instance; business methods themselves are stateless.

#### 1.6.2 Module Layout

```
src/main/services/file/
├── index.ts              ← barrel: exports only FileManager + public types
├── FileManager.ts        ← facade class; lifecycle + IPC + versionCache + inline getMetadata
├── internal/             ← private implementation (not re-exported by index.ts; external imports forbidden)
│     ├── deps.ts              — FileManagerDeps type
│     ├── dispatch.ts          — FileHandle.kind dispatch helper (entry vs path adapter)
│     ├── entry/
│     │    ├── create.ts       — createInternal / ensureExternal
│     │    ├── lifecycle.ts    — trash / restore / permanentDelete + batches
│     │    ├── rename.ts
│     │    └── copy.ts
│     ├── content/
│     │    ├── read.ts         — read / createReadStream (including `readByPath` variants)
│     │    ├── write.ts        — write / writeIfUnchanged / createWriteStream
│     │    └── hash.ts         — getContentHash / getVersion
│     ├── system/
│     │    ├── shell.ts        — open / showInFolder
│     │    └── tempCopy.ts     — withTempCopy
│     └── orphanSweep.ts       — startup orphan-ref scan + FS-level orphan sweep
└── versionCache.ts       ← LRU type definition
```

`getMetadata` is the one entry-level read that does NOT live under
`internal/entry/` — it is implemented inline on the FileManager class
because it is a thin wrapper around `fs.stat` with no entry-flow logic
of its own. Adding a future entry-flow concern (e.g. presence event
emission on success) would justify extracting it, but until then the
inline definition keeps the facade's stat path single-hop.

#### 1.6.3 Dependency Passing Convention

Each `internal/*` pure function explicitly receives `FileManagerDeps`:

```typescript
// internal/deps.ts (illustrative — see src/main/services/file/internal/deps.ts for the authoritative definition)
export interface FileManagerDeps {
  readonly fileEntryService: FileEntryService
  readonly fileRefService: FileRefService
  readonly danglingCache: DanglingCache
  readonly versionCache: VersionCache
  readonly orphanRegistry: OrphanCheckerRegistry
}

// internal/entry/create.ts — two APIs, corresponding to two public methods on the FileManager facade
// Note: CreateInternalEntryParams is a source-discriminated union
//   (source: 'path' | 'url' | 'base64' | 'bytes'); each branch only exposes content
//   that name/ext cannot be derived from. Full matrix in `packages/shared/file/types/ipc.ts`.
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
// FileManager.ts (illustrative — see src/main/services/file/FileManager.ts for the authoritative wiring)
export class FileManager extends BaseService implements IFileManager {
  private readonly versionCache = createVersionCacheImpl(2000)
  private readonly deps: FileManagerDeps = {
    fileEntryService,
    fileRefService,
    danglingCache,
    versionCache: this.versionCache,
    orphanRegistry: orphanCheckerRegistry
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
| Main-side business service (KnowledgeService, MessageService, etc.) | `@main/services/file` (gets FileManager) / `@main/utils/file/{fs,path,metadata,search,shell}` / `@main/services/file/watcher` | `@main/services/file/internal/**` |
| Inside the file module itself (`internal/*`, `watcher/*`) | May reference each other as needed; may also import `@main/utils/file/*` primitives | Except FileManager, must not import `internal/*` |
| External Node/renderer | N/A (file-module is main-side) | — |

**Boundary enforcement**: the `src/main/services/file/index.ts` barrel re-exports only public types + the `FileManager` class; `internal/` symbols cannot be reached via `@main/services/file`. If violations surface, add an ESLint `no-restricted-imports` rule.

#### 1.6.7 Design Trade-offs

| Option | Adopted? | Rationale |
|---|---|---|
| Split business methods into 5 lifecycle services | ❌ | Overkill—lifecycle registration, dependency ordering, and test mocking costs all 5×, in exchange only for "methods split across files" |
| FileManager as facade + `internal/*` pure functions | ✅ | Only 1 lifecycle node; pure functions can be unit-tested with stub deps directly; external API surface remains stable |
| FileAccessor as a standalone class handling `FileHandle` dispatch | ❌ | Dispatch itself is a proper responsibility of the IPC adapter layer; converging into the `dispatchHandle` helper inside FileManager suffices; splitting off another layer adds pure complexity |
| FileManager public API switched to handle-native | ❌ | IPC and Main-side call contracts need not share shape; main-side business services using entry-native directly is more intuitive, without needing a `createFileEntryHandle` wrapper |
| Extract versionCache as a module singleton | ❌ | As a FileManager private field, it naturally supports test isolation (new instance = fresh cache) |

#### 1.6.8 Event Emission & Broadcast (deferred)

FileManager exposes three typed `Event<T>` on its instance surface and forwards each to every live renderer window. The public contract and queryKey invalidation table live in [`architecture.md §3.6`](./architecture.md#36-mutation-propagation-to-renderer); this section pins down the emission mechanics that the FileManager implementation must satisfy.

```typescript
class FileManager extends BaseService {
  readonly onEntryRowChanged: Event<EntryRowChangedEvent>
  readonly onEntryContentChanged: Event<EntryContentChangedEvent>
  readonly onDanglingStateChanged: Event<DanglingStateChangedEvent>

  private readonly _entryRow = new Emitter<EntryRowChangedEvent>()
  private readonly _entryContent = new Emitter<EntryContentChangedEvent>()
  // onDanglingStateChanged is re-exposed from DanglingCache — see §11.7

  constructor(private readonly windowManager: WindowManager) { super() }

  protected override onInit(): void {
    this.registerIpcHandlers()
    this.initVersionCache()
    danglingCache.initFromDb()

    // Wire internal events → renderer broadcast. Each disposable auto-cleans on stop.
    this.registerDisposable(this.onEntryRowChanged((e) =>
      this.windowManager.broadcast('file-manager-event', { type: 'entry-row', ...e })))
    this.registerDisposable(this.onEntryContentChanged((e) =>
      this.windowManager.broadcast('file-manager-event', { type: 'entry-content', ...e })))
    this.registerDisposable(this.onDanglingStateChanged((e) =>
      this.windowManager.broadcast('file-manager-event', { type: 'dangling-state', ...e })))

    void this.runOrphanSweep().catch((err) => logger.error('Orphan sweep failed', err))
  }
}
```

**Emission point per mutation** (all emits happen **after** the DB transaction commits, never inside):

| Method | Emit |
|---|---|
| `createInternalEntry` / batch | `onEntryRowChanged { kind: 'created' }` per newly-inserted row |
| `ensureExternalEntry` / batch | Insert branch → `onEntryRowChanged { kind: 'created' }`. **Reuse branch → no emit** (no state change). |
| `write` / `writeIfUnchanged` | After atomic rename + (internal-only) DB `size` update commits → `onEntryContentChanged { id, version }`. `StaleVersionError` → no emit. |
| `createWriteStream` | On stream `'finish'` → emit. On `'abort'` / `'error'` / `.destroy()` → no emit. |
| `rename` | After DB commit (and FS rename for external) → `onEntryRowChanged { kind: 'updated' }`. |
| `trash` / `restore` / batch | After DB update commits → `onEntryRowChanged { kind: 'updated' }` per affected id. |
| `permanentDelete` / batch | After DB delete commits (internal: FS unlink runs first; external: FS untouched per §1.2) → `onEntryRowChanged { kind: 'deleted' }`. CASCADE-dropped `file_ref` rows emit no extra events — the renderer invalidates `['fileManager', 'entries']` and refetches. |
| `copy` | Creates a new internal entry → emit `onEntryRowChanged { kind: 'created' }` for the new id only (source is untouched). |

**Atomicity & crash semantics**: emits are plain `Emitter.fire()` calls, **not** part of the DB transaction. A process crash between `commit` and `fire` loses the event. This is acceptable because:

1. The committed DB state is authoritative — user data is durable
2. The renderer's `staleTime` contract (see [`architecture.md §4.1.1`](./architecture.md#411-dataapi-boundary-sql-only-fixed-shape)) refreshes the query on its natural cadence
3. Next renderer query loads the latest state — no permanent desync

Events are **accelerators**, not authoritative notifications. This is an explicit design choice documented in `architecture.md §3.6`.

**Multi-window fan-out**: `windowManager.broadcast` iterates every live `webContents` in the window pool and sends the IPC payload. Backgrounded / minimized windows still receive the IPC (Electron delivers to paused webContents); they process it on resume via React Query's standard refresh-on-focus behavior, and any brief overlap with the renderer's first query after resume is resolved idempotently by `queryClient.invalidateQueries`. Windows whose renderer bundle has not finished loading miss the event entirely, but their first query hits a fresh state with no ghost data.

**Testing contract**: unit tests of mutation methods must not depend on broadcast — `windowManager.broadcast` is mocked in test fixtures. The emission-point table above is the contract tests should assert against (e.g. "ensureExternalEntry reuse branch does not emit").

---

## 2. Storage Architecture

### 2.1 Physical Path Rules

Physical paths are not persisted; resolved at runtime based on `origin`:

```typescript
function resolvePhysicalPath(entry: FileEntry): string {
  if (entry.origin === 'internal') {
    return application.getPath('feature.files.data', `${entry.id}${entry.ext ? '.' + entry.ext : ''}`)
  }
  return entry.externalPath!
}
```

**internal** physical paths are always flat: `{userData}/Data/Files/{uuid}.{ext}`, and do not change with the FileEntry's `name`. UUID naming makes internal files **invisible and not manually organizable by the user**—this is an intentional design choice.

**external** physical paths are entirely determined by the user; Cherry does not touch them.

### 2.2 Physical Directory Structure

```
{userData}/Data/Files/
├── {uuid-1}.pdf
├── {uuid-2}.png
├── ...
└── {uuid-n}.tmp-{uuid}      ← Temporary files for atomic writes (abnormal residues cleaned by startup sweep)
```

Cherry creates no subdirectories under `{userData}/Data/Files/`. All internal files are stored flat.

### 2.3 Temporary File Handling

Transient processing files (OCR intermediates, PDF pagination, archive extraction, etc.) **do not create FileEntry** and use `@main/utils/file/fs` primitives directly under `{userData}/temp/` (or process-level `os.tmpdir()`). After processing, the business side cleans up or relies on OS mechanisms.

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

**Paths that would otherwise need to refresh a snapshot**: `read` / `getVersion` / `getContentHash` on external still run `fs.stat` as part of their own work (and update DanglingCache as a side effect), but they do not write to the DB row — no `size` column exists to refresh.

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

## 4. Version Detection and Concurrency Control

### 4.1 FileVersion

```typescript
interface FileVersion {
  mtime: number   // ms epoch
  size: number
}
```

Used as a fast signal for detecting external changes. Two tiers of usage:
- Fast path: `statVersion(path)` (microsecond-level, covers 99% of cases)
- Deep path: `contentHash(path)` → xxhash-h64 (millisecond-to-second level, used when mtime/size match but further confirmation is needed)

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

**Behavior on external**: write / writeIfUnchanged / createWriteStream / rename / permanentDelete **all apply**—Cherry supports user-explicitly-triggered external file modifications (editor save, UI rename, user-confirmed delete), delegated to the FS primitives at `@main/utils/file/fs` (atomic write / rename / remove). Cherry **does not** perform automatic / watcher-driven external file modifications.

### 4.4 LRU Version Cache

FileManager maintains `Map<FileEntryId, CachedVersion>` internally (LRU, ~2000 entries):

| Trigger | Action |
|---|---|
| `write` / `writeIfUnchanged` completes | `set(id, new version)` |
| Critical path detects external change | `set(id, new version)` |
| Startup reconcile completes | `clear()` |

**Trust boundary**: the cache only accelerates `getVersion` queries and is not used for critical decisions. `writeIfUnchanged`'s concurrency comparison **must re-stat**; it does not trust the cache.

---

## 5. Atomic Writes

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

### 5.3 FS Primitive Access Policy

The `atomicWriteFile` / `atomicWriteIfUnchanged` / `createAtomicWriteStream` primitives exported by `@main/utils/file/fs` **are open to modules outside the file module**. BootConfig, MCP oauth storage, and any other main-process service that needs a safe atomic write imports them directly; scattered ad-hoc tmp+rename implementations are not introduced.

---

## 6. Deletion and Recycle Bin

### 6.1 trashedAt Model

All soft deletes are implemented via the `trashedAt` timestamp, without physically moving files:

| Operation | Physical impact (internal) | Physical impact (external) |
|---|---|---|
| `trash(id)` | None | **N/A** (`fe_external_no_trash` CHECK rejects; external rows cannot be trashed) |
| `restore(id)` | None | **N/A** (no trashed external rows to restore) |
| `permanentDelete(id)` | DB delete + best-effort `remove(physicalPath)` (`@main/utils/file/fs`) | **DB delete only — user's file is never modified** (matches `architecture.md §3.4`) |

**trash / restore are internal-only.** External entries cannot be trashed by definition (`fe_external_no_trash` CHECK enforces this); the trash semantics make sense only for files Cherry owns.

**permanentDelete on internal**: DB row is removed first, then the physical file at `{userData}/Data/Files/{id}.{ext}` is best-effort unlinked. Unlink failures (ENOENT, insufficient permissions, etc.) are logged but do not block — the DB-row-gone outcome is what callers observe; any orphaned blob is later cleaned by the startup file sweep (§10).

**permanentDelete on external**: DB row is removed; the user's file at `externalPath` is **never** modified — Cherry only owns the reference, not the content. This is the only safe contract: silently deleting user files from inside the app would violate the "best-effort external reference" semantics (§1.0.2 in `architecture.md`). Users who actually want the underlying file gone do so through their OS file manager.

### 6.2 Auto Expiry

By default trashed entries are cleaned up after 30 days (lifecycle service timer); the user may configure the days or disable it in Preferences.

Query: `WHERE trashedAt < now() - retentionMs` → batch permanentDelete.

### 6.3 Edge Cases

| Scenario | Handling |
|---|---|
| unlink fails on permanentDelete internal (file already missing, permission issue) | Log warn; the DB row is already gone, so the failure surfaces only as an orphan blob that the startup file sweep will reclaim |
| permanentDelete on external | DB-only by design; the user's file at `externalPath` is never touched — Cherry owns only the reference |
| `ensureExternalEntry(path)` when an entry for the same path already exists | Entry point first calls `canonicalizeExternalPath(raw)`; upsert returns the existing row. External entries cannot be trashed, so there is no "restore" branch. |
| **Two entries for the same file due to case / NFC differences** (macOS APFS, Windows NTFS, or NFD ↔ NFC input) | The `canonicalizeExternalPath` step closes the NFC window; case-insensitive FS dedup not implemented (see §1.2 "Normalization scope")—will add `fs.realpath` + one-off migration when there is concrete user feedback |
| External file at original path externally replaced with a different file | Cherry does not check content consistency (best-effort). `name` / `ext` on the row are derived from `externalPath` and do not change; `size` is always served live by `getMetadata`. DanglingCache flips to `'present'` on the next stat, so the UI just renders the new file under the existing reference. |
| A trashed entry is permanently externally deleted and then restored | Appears dangling (DanglingCache returns missing on next check), UI shows failed style |
| External write with permission error / disk full on target path | Throw without polluting DB; caller decides retry or user notification |

---

## 7. Reference Cleanup Mechanism

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

### 7.1 No-Reference Entry Policy

The default stance — *FileEntry is preserved even when no business refs point at it* — is chosen so the user never loses a file they (or Cherry) bothered to track merely because the original consumer got deleted. A UI surface may show an "unreferenced" marker for user-triggered cleanup.

There is **one narrow exception**: external entries whose physical file is confirmed missing are garbage-collected automatically once their ref count reaches zero. The rationale: both sides of the reference relationship are gone — no file on disk, no business object using it — and the entry's continued existence is pure zombie noise.

**Policy matrix by `(origin, dangling state, refs)`**:

| origin | dangling state | refs | Policy |
|---|---|---|---|
| `internal` | n/a (always `'present'`) | any | **Preserve** — user may re-link via UI; only user-initiated cleanup |
| `external` | `'present'` | any | **Preserve** — file still exists, fully re-attachable |
| `external` | `'unknown'` | any | **Preserve** — not yet observed; treated as still-live until proven otherwise |
| `external` | `'missing'` | >0 | **Preserve** — business objects still reference this entry. Automatic deletion would CASCADE-drop `file_ref` rows and silently mutate user data (messages' attachment count drops, UI state shifts). The business service owning those refs is the right layer to decide replacement / removal policy, not the file module. Reference-oriented UI surfaces (§3.4 UI filter convention) show these as "file missing" so the user can act. |
| `external` | `'missing'` | 0 | **Auto-clean after retention window** — both sides are gone, no user-visible impact; see §7.2 |

### 7.2 Dangling External Auto-Cleanup (Layer 3 Extension, deferred)

As part of the same Layer-3 scanner pass — not a separate background task — after cleaning orphan refs, the scanner scans for external entries eligible under row `('external', 'missing', 0)` of the policy matrix above:

```sql
SELECT id FROM file_entry
WHERE origin = 'external'
  AND updatedAt < :now - INTERVAL 30 DAY               -- retention window (see below)
  AND id NOT IN (SELECT DISTINCT fileEntryId FROM file_ref)
LIMIT 500;                                             -- batch cap
-- For each candidate: verify DanglingCache.check(entry) === 'missing'
-- immediately before delete (TOCTOU guard; see below).
```

**Parameters** (open to later tuning based on production telemetry):

| Parameter | Value | Rationale |
|---|---|---|
| Retention window | **30 days** | Covers temporary unmounts (external drive, NAS downtime, weekend trips with USB at home). Any file genuinely reconnected within a month naturally excludes itself — DanglingCache flips back to `'present'` and the candidate fails the per-row verification below. |
| "Dangling duration" proxy | `file_entry.updatedAt` | Avoids adding a `dangling_since` column (schema change). Any user interaction with the entry (rename, write, ref churn) resets the clock — coherent with "this entry is still actively tracked". |
| Dangling verification | `DanglingCache.forceRecheck(entry) === 'missing'` before each delete — **not `check()`** | `check()` would return cached state while within TTL (§11.6); the scanner must `fs.stat` unconditionally to guarantee the file really is still missing at delete time, not just that DanglingCache saw it missing some minutes ago. `forceRecheck` also closes the TOCTOU gap if the file reappeared between scanner run and per-row execution, and if the file is back, the fresh stat automatically flips cache to `'present'` and fires a transition event — next-day scanner excludes the entry. |
| Batch granularity | Up to **500 deletes per scanner run**, in a single transaction | Avoids long-held DB locks; unusually large cleanups spread across multiple scanner runs (scanner runs daily, so worst-case 500×365 ≈ 180k rows/year — more than enough for any realistic account). |

**Safety threshold** (same pattern as the orphan sweep in §10.4):
- If the planned deletion exceeds **50% of total external rows** OR **more than 1000 rows in a single plan**, abort and `warn`-log `{ planned, totalExternal, reason }`. Mass cleanup of that scale almost always signals an upstream bug (DanglingCache mis-initialization, filesystem fault marking every file missing, migration regression). Abort gives human intervention a chance.
- Abort is not a hard failure — the scanner continues with orphan-ref cleanup and completes normally; the dangling-entry pass simply runs zero deletions this cycle and re-evaluates next run.

**Event emission**: each deleted entry fires `onEntryRowChanged { kind: 'deleted', id, origin: 'external' }` through the same pipeline interactive `permanentDelete` uses (see [`architecture.md §3.6`](./architecture.md#36-mutation-propagation-to-renderer)). A daily scanner run deleting ~tens to a few hundred entries is a non-flood for the renderer pipeline; React Query's prefix-invalidation dedupes the resulting refetches. The alternative — suppressing events and relying on `staleTime` — would leave open FilesPage views stale for up to the staleness window, and the event-emission path is already the standard contract.

**Scope limits** (what this does NOT do):

- **Does not touch `refs > 0` dangling entries**. The business service owning those refs is the authoritative decider of what to do when a referenced file goes missing (re-attach, prompt, remove ref, etc.). Auto-cleanup of referenced entries would silently destroy user-visible data.
- **Does not touch internal entries**, regardless of ref count or DanglingCache state. Internal entries are always `'present'` by construction (§3.3); a no-ref internal entry is a user's "file uploaded but not yet consumed" state — preserved for user-initiated cleanup only.
- **Does not touch external entries in `'unknown'` state**. `'unknown'` means no observation has been performed; treat as still-live.

**Observability** — each scanner run emits:

```typescript
{ event: 'dangling-entry-cleanup',
  outcome: 'completed' | 'aborted',
  totalExternalRows: number,
  planned: number,
  verified: number,           // after per-row DanglingCache re-check
  deleted: number,            // may be < verified if the 500-row cap was hit
  scanDurationMs: number,
  abortReason?: 'count-fraction' | 'count-absolute' }
```

Mirrors the orphan sweep's observability contract (§10.5) — one record per scanner run through `loggerService`, no separate metrics pipeline.

**Implementation location**: lives alongside the OrphanRefScanner. The scanner gains a second pass method (e.g. `scanDanglingEntries(): Promise<void>`) called after `scanOrphanRefs` inside the same scheduled tick.

---

## 8. DirectoryWatcher

### 8.1 Positioning

`DirectoryWatcher` is a **non-lifecycle general FS primitive** (not a service), available for business modules to `new` themselves. It is merely a chokidar wrapper and binds no business semantics.

Placed in `src/main/services/file/watcher/`, as a dedicated submodule of the file module distinct from the pure FS primitives at `@main/utils/file/*`. Rationale for the split:

| Aspect | `@main/utils/file/*` primitives | `watcher/` |
|---|---|---|
| Paradigm | Pure functions (stateless) | Stateful class |
| Lifecycle | None (completes upon call) | Has one (start → running → dispose) |
| Resource holding | None | FSWatcher instance + pending queues + timers |
| Consumption contract | `const x = await read(path)` | `const w = new DirectoryWatcher(...); ... w.dispose()` |

Grouping a stateful class with pure-function primitives would break the primitives' stateless contract. This mirrors the layering between Node.js official `fs.readFile` (function) and `fs.watch` returning an `FSWatcher` instance (class): functionally related but fundamentally different consumption shapes, so they live in separate submodules.

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

> ⚠️ **This section is a design record; the corresponding implementation is deferred.** Vercel AI SDK's Files Upload API (`FilesV4`, `SharedV4ProviderReference`) is still pre-release, and the corresponding dependency is unstable. FileUploadService, the `file_upload` table, and related IPC methods are all deferred to a separate PR after the SDK reaches stable. This section preserves the design intent for direct landing in the future.

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
  content_version TEXT NOT NULL,   -- xxhash-h64 at upload time
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

## 10. Startup Orphan Sweep (FileManager Background Task)

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
  // 1. Snapshot file_entry.id set via a single SELECT (see §10.2)
  // 2. Enumerate {userData}/Data/Files/* via readdir
  // 3. Build the deletion plan:
  //      UUID v7 file  AND not in snapshot AND mtime > 5min → unlink
  //      *.tmp-<uuidv7> file                AND mtime > 5min → unlink
  //    (heuristic rationale and FS prerequisites: see §10.3)
  // 4. Evaluate the safety threshold before executing (see §10.4)
  // 5. Execute unlinks and emit a structured observability record (see §10.5)
}
```

**Rationale**:
- Orphan sweep typically completes <500ms; fire-and-forget doesn't consume startup time
- Runs in parallel with other services' `onInit()`; business services can depend on FileManager immediately
- Failure doesn't affect service availability (just residual orphans; rescanned on next startup)

### 10.2 Scan Strategy

The sweep uses a **single snapshot** of `file_entry.id` taken at sweep start, not per-file DB lookups:

```sql
SELECT id FROM file_entry  -- one query, held in an in-memory Set for the duration of the sweep
```

It then diffs `readdir({userData}/Data/Files/)` against the snapshot in memory. Chosen properties:

- **Simple and fast**: one SQL round-trip vs N round-trips; for <10k internal entries the cost is sub-10ms.
- **Race window is bounded and explicit**: entries inserted *after* the snapshot but *before* the sweep reaches their file appear as "not in DB". The `mtime > 5min` filter in §10.3 is the only thing that protects them — the snapshot strategy makes this reliance explicit rather than hiding it behind DB isolation levels.

Implementations MUST NOT silently switch to per-file DB lookups — the snapshot strategy, the `mtime > 5min` filter (§10.3), and the safety threshold (§10.4) are co-designed; any change to one requires re-evaluating the other two.

### 10.3 Heuristic Rationale & FS Prerequisites

The `mtime > 5min` filter is an **engineering heuristic**, not a formal guarantee. It is sufficient under the following assumptions:

- `createInternalEntry`'s "FS write UUID file → DB insert" window is << 5min in practice (microseconds to seconds)
- `atomicWriteFile`'s "open tmp → write → fsync → rename" window is << 5min, with streaming writes refreshing mtime on each `write(2)`
- `userData` resides on a **local POSIX-compliant filesystem** with **sub-minute mtime resolution** (APFS / ext4 / NTFS local)
- System clock is not discontinuously advanced by > 5min while a write is in flight

**Known breakage modes** (documented, accepted as residual risk):

| Scenario | Consequence |
|---|---|
| Very slow write (huge file + slow disk/fsync) exceeds 5min between FS write and DB insert | Newly-written internal file may be unlinked on next startup |
| Process frozen / suspended > 5min mid-write; then restart triggers sweep | Same as above |
| System clock jumps forward > 5min after file creation | Recent residue gets mis-aged; usually harmless — those files were orphans anyway |
| System clock jumps backward | Filter becomes permissive (`now < mtime` disqualifies the file); cleanup delayed to next startup (safe) |
| `userData` on FAT32 / exFAT / SMB / NFS (second-precision or offset-prone mtime) | Filter still works at coarse granularity; extreme clock skew between client and server can mis-age files |
| `userData` on tmpfs / CoW FS with unusual mtime semantics | Out of contract; user responsibility |

The sweep does **not** defend against deliberately hostile mtime manipulation. These are known limits, not bugs.

### 10.4 Safety Threshold & Abort

To bound the blast radius of **application-layer regressions** (e.g. a faulty migration that truncates `file_entry`, a regression in the sweep predicate, a developer running the app against a stale DB), the sweep MUST evaluate its plan before executing and abort on suspicious scale:

```typescript
interface SweepPlan {
  orphanFiles: { path: string; bytes: number }[]
  tmpFiles:    { path: string; bytes: number }[]
}

function shouldAbort(
  plan: SweepPlan,
  totalFilesOnDisk: number,
  totalBytesOnDisk: number
): boolean {
  const toDelete      = plan.orphanFiles.length + plan.tmpFiles.length
  const toDeleteBytes = sumBytes(plan.orphanFiles) + sumBytes(plan.tmpFiles)

  // Normal crash residue: always proceed.
  if (toDelete < 20 && toDeleteBytes < 10 * 1024 * 1024) return false

  // Otherwise check proportion. If the sweep would erase a large fraction of
  // the on-disk UUID population, something upstream is wrong — refuse and
  // warn; the next startup re-evaluates after the bug is fixed.
  const countFraction = toDelete      / Math.max(1, totalFilesOnDisk)
  const byteFraction  = toDeleteBytes / Math.max(1, totalBytesOnDisk)
  return countFraction > 0.5 || byteFraction > 0.5
}
```

**Contract**:
- On abort, no files are unlinked.
- Emits a `warn`-level structured log (see §10.5) so developers / on-call can diagnose.
- The service remains available — abort is a controlled outcome, not a failure; no `Error` is thrown into the `.catch()` handler.
- The next startup re-evaluates the plan after the upstream issue is resolved.

**Scope note**: the threshold defends against internal bugs, not user-side manipulation of `{userData}/Data/Files/`. Users are not expected or encouraged to edit the storage directory (all file operations should go through the in-app entry system). The threshold's job is to ensure "nothing Cherry itself does, internally, silently deletes the bulk of a user's library".

### 10.5 Observability

Every sweep run emits one structured log record through `loggerService` — `info` on normal completion, `warn` on partial / aborted outcomes, `error` on unexpected failure caught by `.catch()`:

```typescript
{
  event: 'orphan-file-sweep',          // disambiguates from the DB-side 'orphan-sweep' (§7 Layer 3)
  outcome: 'completed' | 'partial' | 'aborted' | 'failed',
  entriesInDb: number,
  direntsScanned: number,              // total readdir entries (informational)
  filesOnDisk: number,                 // UUID files + tmp residue candidates only
  bytesOnDisk: number,                 // bytes of candidates (drives the abort fraction math)
  plannedDeleteCount: number,
  plannedDeleteBytes: number,
  actualDeleteCount: number,           // 0 on aborted / failed
  actualDeleteBytes: number,
  oldestDeletedMtime?: number,         // ms epoch of the oldest file unlinked this run
  statFailedCount: number,             // non-ENOENT stat errors during planning
  scanDurationMs: number,
  // outcome-specific fields (discriminated union):
  // 'partial':  failedDeleteCount: number, failedSamples: readonly string[]  (capped at 5)
  // 'aborted':  abortReason: 'count-fraction' | 'byte-fraction'
  // 'failed':   errorMessage: string
}
```

The DB-side sweep emits a parallel record under `event: 'orphan-sweep'` — same outcome union (minus `'aborted'`, which only applies to the FS sweep's safety threshold) and `errorsByType: Partial<Record<FileRefSourceType, string>>` on the `'partial'` branch (per-sourceType isolation, so one checker throwing does not abort the whole run).

These two records are the single source of truth for post-hoc diagnosis. No separate metrics pipeline is needed — at most two records per app startup is a trivial volume for log aggregation.

### 10.6 DanglingCache Initialization

The reverse index of DanglingCache (`Map<path, Set<entryId>>`) is built via a single synchronous DB query:

```sql
SELECT id, externalPath FROM file_entry
WHERE origin = 'external' AND trashedAt IS NULL
```

**No stat performed**—the state field (`Map<entryId, DanglingState>`) is initially empty; lazy stat on query (see §11).

### 10.7 Why There Is No Dangling Probe

The old version batch-stat'd all external entries at startup to build the dangling set. The new version **cut this step**:

1. **Dangling is a pull-only IPC query** (`getDanglingState` / `batchGetDanglingStates`); most query scenarios don't need it, so it's never computed eagerly
2. **Lazy + Promise.all is fast enough**: on the first dangling query, N stats run in parallel, typically <100ms
3. **Watcher-covered paths have zero IO** — *where coverage happens to exist*. In practice, watcher coverage is **emergent and typically sparse** (see §11.1): only business modules with their own directory-monitoring needs (NoteService watching the notes directory, etc.) create watchers. Ad-hoc user-`@`-ed external paths — the main source of external entries — are **almost never covered by any watcher**. For those paths, the TTL-based cache (§11.6) and ops observations are the dominant freshness mechanisms, not watchers. Do not read this bullet as "watchers cover most paths"; they don't.

### 10.8 Concurrency Safety

| Concurrency scenario | Result |
|---|---|
| createInternalEntry creates a new internal file during sweep | The `mtime > 5min` filter (§10.3) prevents the new file from being mistakenly deleted; the snapshot strategy (§10.2) makes this reliance explicit |
| FileManager.read/write on existing entries during sweep | No mutual exclusion; read/write follow different code paths and are unaffected |
| Upstream bug causes bulk deletion plan | Safety threshold (§10.4) aborts the sweep without unlinking |
| app exits during sweep | No persistent side effect; rerun on next startup |

### 10.9 Crash Consistency

file_module's crash window is very narrow:

| Operation | Order | Crash mid-operation | Recovery |
|---|---|---|---|
| createInternalEntry | FS write UUID file → DB insert | Orphan file | Orphan sweep |
| write (internal) | atomic tmp+rename + DB update | One of new/old files preserved | Naturally consistent |
| trash / restore / rename | DB only | None | None |
| permanentDelete (internal) | DB delete → best-effort FS unlink | Crash after DB delete leaves an orphan blob | Orphan sweep |
| copy (internal) | FS copy → DB insert | Orphan file | Orphan sweep |
| ensureExternalEntry | DB insert / reuse (doesn't touch user file) | None | None |
| permanentDelete (external) | DB delete only | None — user's file at `externalPath` is never modified | None needed |

No WAL / pending_fs_ops table needed. Orphan sweep covers the internal crash residue; the external side naturally doesn't need it (delete failure just leaves it on disk).

---

## 11. DanglingCache (External Presence Tracker)

### 11.1 Positioning

DanglingCache is a **singleton** in file_module (not a lifecycle service) that maintains the "latest known on-disk state" for external entries.

```typescript
// src/main/services/file/danglingCache.ts
export const danglingCache = new DanglingCache()
```

**Role**:
- Provides a fast query interface for File IPC `getDanglingState` / `batchGetDanglingStates`. Cache hit within TTL (§11.2, 30 min) returns synchronously; TTL-expired or cold miss runs a single `fs.stat` and refreshes the cache. DataApi never reads this cache — DataApi is pure SQL.
- Consumes add/unlink/rename events from watchers that **happen to cover** an entry's path (auto-wired via the factory). **Watcher coverage is sparse in practice**: it exists only where a business module has created a watcher for its own reasons (NoteService watching the notes directory, a future Obsidian-like module, etc.). Arbitrary user-`@`-ed external paths — which are the bulk of external entries — are typically NOT watcher-covered. Do not assume event-driven updates as the primary freshness mechanism; the TTL (§11.6) is.
- Consumes observation results from FileManager's own ops (read/stat/write success/failure) — updates cache opportunistically whenever a mutation or lookup touches a path.

### 11.2 State Model

> **Phase 1 vs deferred surface.** `forceRecheck()` (and the related
> `'forceRecheck'` value of `CachedState['source']`) belongs to the §7.2
> dangling-external auto-cleanup pass, which is itself deferred. Phase 1
> ships `CachedState['source']` with only three values (`'watcher' | 'ops'
> | 'stat'`) and exposes no `forceRecheck()` method on `DanglingCache`.
> The signature is preserved below for design continuity — when §7.2
> lands, both the source value and the method come back together as a
> single change.

```typescript
type DanglingState = 'present' | 'missing' | 'unknown'

interface CachedState {
  state: 'present' | 'missing'
  /** ms epoch of last observation — drives TTL expiry in `check` */
  observedAt: number
  /** Where this observation came from (for diagnostics / log context).
   *  Phase 1: `'watcher' | 'ops' | 'stat'`. `'forceRecheck'` is added
   *  alongside the §7.2 auto-cleanup pass (deferred). */
  source: 'watcher' | 'ops' | 'stat' | 'forceRecheck' // deferred: forceRecheck
}

class DanglingCache {
  /** TTL for cached observations. 30min — external file path moves are rare,
   *  and freshness is bounded by TTL for any entry the user actually queries. */
  private static readonly TTL_MS = 30 * 60 * 1000

  private byEntryId: Map<FileEntryId, CachedState>
  private pathToEntryIds: Map<string, Set<FileEntryId>>  // reverse index

  /** Public event: fires on every genuine state transition (see §11.7). */
  readonly onDanglingStateChanged: Event<DanglingStateChangedEvent>

  // Query (TTL-aware; re-stats when cache entry is stale)
  async check(entry: FileEntry): Promise<DanglingState>

  /**
   * **Deferred (lands with §7.2)**: always re-stat, regardless of cache
   * freshness. Used by callers with stricter freshness requirements than
   * a plain query — notably the F-2 scanner's pre-delete verification
   * step (see §7.2). Not implemented in Phase 1 because no production
   * call site exists yet — the entry-delete path that needs it is
   * itself deferred.
   */
  async forceRecheck(entry: FileEntry): Promise<DanglingState>

  // Event entry (for watcher factory + FileManager ops) — resets observedAt
  onFsEvent(path: string, state: 'present' | 'missing'): void

  // Index maintenance (for FileManager entry CRUD)
  addEntry(entryId: FileEntryId, externalPath: string): void
  removeEntry(entryId: FileEntryId, externalPath: string): void

  // Startup init
  initFromDb(): void
}
```

**Query strategy for `check` — lazy TTL expiration**:

```typescript
async check(entry: FileEntry): Promise<DanglingState> {
  if (entry.origin === 'internal') return 'present'

  // L1: cache hit AND still within TTL → return cached
  const cached = this.byEntryId.get(entry.id)
  if (cached && Date.now() - cached.observedAt < DanglingCache.TTL_MS) {
    return cached.state
  }

  // L2: no cache OR TTL expired → re-stat and update
  return this.doStatAndUpdate(entry, 'stat')
}

// Deferred: lands with §7.2. Not implemented in Phase 1.
async forceRecheck(entry: FileEntry): Promise<DanglingState> {
  if (entry.origin === 'internal') return 'present'
  return this.doStatAndUpdate(entry, 'forceRecheck')
}

private async doStatAndUpdate(
  entry: FileEntry,
  source: CachedState['source']
): Promise<DanglingState> {
  const state = await statToState(entry.externalPath!)
  const prev = this.byEntryId.get(entry.id)
  this.byEntryId.set(entry.id, { state, observedAt: Date.now(), source })
  if (!prev || prev.state !== state) {
    this._onDanglingStateChanged.fire({ id: entry.id, state })
  }
  return state
}
```

**Key design points**:

- **Lazy expiration only, no periodic background sweep**. FS IO cost scales with query frequency, not total entry count — heavy-user populations (10k+ external entries) consume zero IO when no UI is querying.
- **Watcher events / ops observations reset `observedAt`** to `Date.now()` — a path with active watcher coverage stays fresh indefinitely and never triggers TTL-driven re-stat.
- **TTL = 30 min**: external file path moves are rare in practice (files accumulate, rarely move); a 30-minute worst-case staleness window is acceptable for background UI state, while keeping TTL ≫ React Query's renderer-side `staleTime ≤ 5min` means most renderer refetches hit cache (desired: the cache adds value).
- **`forceRecheck` is the explicit escape hatch** for callers that need guaranteed freshness — the F-2 scanner (§7.2) is its only intended production caller. Both `forceRecheck()` and §7.2 are deferred; nothing in Phase 1 calls this path.

### 11.3 Watcher Auto-Wiring

Business modules **need not be directly aware of DanglingCache**. All watchers must be created via the `createDirectoryWatcher()` factory, which hooks things up internally:

```typescript
// src/main/services/file/watcher/factory.ts
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
| `permanentDelete(external)` | removeEntry(id, path) |
| `rename(external)` (explicit user action) | removeEntry(id, oldPath) + addEntry(id, newPath) |

External entries cannot be trashed (`fe_external_no_trash` CHECK enforces this
at the schema level; `trash` / `restore` throw at the entry layer before
reaching the reverse-index update). Earlier drafts listed `restore(external)`
and `trash(external)` rows here — they were dead branches and have been
removed.

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

**TTL-based lazy expiration**. A cached entry is considered fresh while `now - observedAt < TTL_MS` (30 min); once stale, the next `check()` call re-stats and updates the cache. `observedAt` is refreshed by any of:

- Watcher add/unlink/rename events (where coverage exists — see §11.1 caveat)
- Observation side effects of FileManager ops (read success → present; stat ENOENT → missing; write success → present; rename success → oldPath missing + newPath present)
- Cold-path or TTL-driven `fs.stat` from `check()` / `getMetadata` / `getDanglingState`
- Explicit `forceRecheck()` calls (F-2 scanner verify step)

**Freshness guarantee**: for any path the caller queries, cached state is never older than the TTL. Paths that are never queried may stay stale indefinitely — but by construction, no consumer is looking at them, so the staleness has no user-visible impact.

**Why no background sweep**: a periodic background re-validation across all cached entries was considered and rejected. See [§12 Key Design Decisions](#12-key-design-decisions). The short version: FS IO cost would scale with total entry count instead of query frequency, and the F-2 scanner (§7.2) already provides a daily `forceRecheck` path for refs=0 candidates — the only subset where stale-`'present'` state would materially harm correctness.

**Known residual case — stale `'present'` with `refs > 0`**: if an external file is deleted outside Cherry, without any watcher or ops observation to signal it, and no UI ever queries `getDanglingState` for that entry, the cache stays `'present'` past TTL boundaries (first query after TTL will re-stat and fix). Business services that depend on referenced files MUST re-validate at use time (read will surface ENOENT anyway) — this is the explicit "use-site check" side of the F-1 / F-2 policy split and is not attempted to be hidden behind cache semantics.

### 11.7 Reactivity — Event Emission (deferred)

DanglingCache exposes `onDanglingStateChanged: Event<DanglingStateChangedEvent>` fired on every **genuine** state transition (watcher event, cold-path `fs.stat` observation after a cache miss, explicit `ops` observation):

```typescript
export interface DanglingStateChangedEvent {
  id: FileEntryId
  state: 'present' | 'missing'
  // Note: 'unknown' is never broadcast — transitions FROM unknown TO concrete
  // fire; 'unknown' itself is the default pre-observation state, not a signal.
}
```

FileManager subscribes in `onInit` (see §1.6.8) and fans the event out to all renderer windows via the shared `file-manager-event` IPC channel, closing the "main-side FS observation → renderer React Query invalidation" loop. The public queryKey invalidation target is `['fileManager', 'dangling', id]`; see [`architecture.md §3.6`](./architecture.md#36-mutation-propagation-to-renderer) for the full dispatch table.

**Emission rules**:
- **Transitions only** — if `onFsEvent(path, 'present')` arrives and the cached state is already `'present'`, no emit. Prevents broadcast floods on watcher-chatty filesystems.
- **Fan-out via reverse index** — when multiple entries share the same `externalPath` (allowed by schema — one row per path per non-trashed state, but historical / edge cases may produce more), §11.4's reverse index yields all affected ids. Emit **one event per id**. Renderer invalidates `['fileManager', 'dangling', id]` per id.
- **Internal-origin entries never fire** — they are always `'present'` by construction (§3.3); DanglingCache never tracks them.

**Staleness backstop retained**: the `staleTime ≤ 5min` contract from [architecture.md §4.1.1](./architecture.md#411-dataapi-boundary-sql-only-fixed-shape) still applies. Events accelerate refresh; a lost event is bounded by React Query's natural refetch cadence. DanglingCache's emission is therefore an optimization over pure pull, not a replacement for the pull path.

### 11.8 Observability (deferred)

DanglingCache emits a structured `info`-level log record at a fixed cadence (every 10 minutes, driven by a simple timer in `onInit`) summarizing its recent activity. This mirrors the F-2 scanner and orphan sweep observability contracts (§7.2, §10.5) — one periodic record plus opportunistic `warn` / `error` on anomalies, no separate metrics pipeline.

```typescript
{
  event: 'dangling-cache-snapshot',
  cachedEntries: number,           // total entries currently in byEntryId
  pathIndexSize: number,           // total keys in pathToEntryIds
  // counters since the last snapshot record (reset each emit)
  checkCalls: number,              // total check() invocations
  checkCacheHits: number,          // returned cached within TTL
  checkTtlExpiredReStats: number,  // re-stat triggered by TTL
  checkColdStats: number,          // re-stat triggered by cache miss
  forceRecheckCalls: number,       // explicit forceRecheck (F-2 scanner)
  watcherEvents: number,           // onFsEvent calls from watcher factory
  opsObservations: number,         // onFsEvent calls from FileManager ops
  transitionsFired: number,        // onDanglingStateChanged fires
  statErrors: number,              // fs.stat threw (permission, I/O error, etc.)
  windowMs: number,                // interval this snapshot covers (≈ 600_000)
}
```

**Emission cadence**: every 10 minutes while the service is active. Upon `onStop`, one final snapshot flushes any outstanding counters. Snapshot volume at steady state is `6 records/hour × 24 = 144 records/day` through `loggerService` — trivial for log aggregation even on long-running installs.

**Anomaly triggers** (emitted out-of-band at `warn` level, independent of the snapshot cadence):
- `statErrors / (checkCalls + forceRecheckCalls) > 0.1` sustained across two consecutive snapshot windows → likely a systemic FS issue (unmounted drive, permission regression)
- `cachedEntries > 50_000` → memory-budget anomaly; suggests either a runaway caller or a bug in `removeEntry` cleanup
- `transitionsFired > 1000` within one 10-minute window → likely a watcher feedback loop or mass unmount event

These thresholds are heuristic starting points — tune based on real-world telemetry once available. IPC latency is **not** instrumented here; `loggerService` is a log pipeline, not a metrics system, and Cherry has no telemetry backend. Per-IPC latency concerns should be diagnosed ad-hoc via `performance.now()` in the affected handler during investigation, not baked into a permanent counter.

---

## 12. Key Design Decisions

| Decision | Conclusion | Core rationale |
|---|---|---|
| **Tree vs flat** | Flat | FileEntry manages "user-submitted independent files"; directory organization is not a file_module responsibility |
| **Mount abstraction** | Removed | All internal files live flat under `{userData}/Data/Files/` (via the `feature.files.data` path key); external is reached directly via `externalPath`; no mount needed |
| **Origin two-state** | internal/external | Express "Cherry-owned" and "user-owned, Cherry-referenced" respectively; clear semantics |
| **External read/write permissions** | Explicit user ops may change; Cherry doesn't auto-change | VS Code-style behavior model—change when told to; don't modify behind the scenes |
| **External operation symmetry** | write/rename/permanentDelete all delegate to the FS primitives and take effect; trash/restore touch DB only | Soft delete preserves reversibility (doesn't touch FS); hard delete is the terminal action (really deletes FS) |
| **External identity** | externalPath unique(where not trashed) | At most one active entry at a time for the same path; `ensureExternalEntry` upserts by path |
| **Cherry tracks external rename** | Not tracked | Best-effort semantics; external rename → dangling → user re-@ |
| **Snapshot vs realtime stat** | External row stores only identity + stable projections (`name` / `ext` from `externalPath`); live `size` / `mtime` via `getMetadata` on demand | Eliminates stale-snapshot bug class at the type level; cost of the extra `fs.stat` is explicit at the call site instead of hidden behind a DB field |
| **Dangling state carrier** | In-memory singleton DanglingCache | Not in DB (avoids bidirectional DB-FS sync); three states `present/missing/unknown`; TTL-based lazy expiration (§11.6, 30 min); refreshed on query / FS observation / watcher; no periodic background sweep — IO cost scales with query frequency, not entry count |
| **Dangling exposure method** | File IPC `getDanglingState` / `batchGetDanglingStates` (never DataApi) | DataApi is pure SQL; FS probe lives in IPC where side effects are expected; zero cost by default; parallel stat on demand |
| **Watcher → DanglingCache wiring** | Factory auto-wires | Business modules unaware of DanglingCache; a single watcher instance serves business events + dangling tracking |
| **Content hash algorithm** | xxhash-h64 | Optimal cost-performance for non-cryptographic scenarios (~20GB/s). 64-bit collision space is sufficient for distinguishing successive versions within a single file's write history — the `xxhash-wasm` package shipped in this version exposes only h32 / h64, and h64 is the strongest variant available; revisit if a 128-bit variant becomes a dependency-cost tradeoff worth taking. |
| **Does write carry version** | Split into write / writeIfUnchanged | Force the caller to explicitly choose; avoid silent degradation to blind write when version is forgotten |
| **Atomic write fsync** | On by default | Correctness guarantee takes precedence over performance; Cherry is not a high-throughput scenario |
| **Trash model** | trashedAt timestamp | parentId unchanged; naturally supports expiry; no system_trash entries |
| **pending_fs_ops** | Removed | After extreme simplification, orphan sweep suffices to cover crashes |
| **Startup dangling probe** | Removed | Changed to lazy + Promise.all; stat only when an IPC caller explicitly requests dangling state |
| **Is Watcher a lifecycle service** | No | DirectoryWatcher is a primitive; business modules `new` it via the factory; file_module doesn't actively watch |
| **Directory import / bidirectional sync** | Moved out of file_module | Business modules (Knowledge, etc.) implement this with DirectoryWatcher + their own mapping tables |
| **AI SDK upload cache** | Standalone file_upload table (deferred) | Decoupled from mount / remote; naturally aligns with SharedV4ProviderReference |
| **Notes** | File tree is an independent domain, not mirrored to FileEntry | If other modules need to reference Notes files, they use the origin of their choice via the corresponding path |
| **CacheService integration for DanglingCache / versionCache** | Not integrated; both stay bespoke | `CacheService` (`src/main/data/CacheService.ts`) is a general TTL KV + cross-window sync primitive. DanglingCache needs a `path → Set<entryId>` reverse index (§11.4), transition-aware event emission (§11.7 — fire only on genuine state change by comparing old vs new), a `forceRecheck` escape hatch that bypasses TTL (§11.2, for F-2 scanner), and `observedAt`-based "TTL expired → re-stat then update" semantics (§11.6 — CacheService's TTL is "expired → deleted", which would destroy the prev-state comparison needed for transition detection). versionCache needs size-bounded LRU (§4.4), not TTL — a fundamentally different eviction policy; and lives as a per-FileManager-instance field for test isolation, not as a BeforeReady singleton. Wrapping either in CacheService would flatten the value schema, bolt on the secondary structures separately, and bypass the TTL layer — no logic shed, only domain expression lost. CacheService remains the right tool for future scenarios that genuinely match "simple per-id TTL cache" or "cross-window cache" shape (e.g. a short-lived batchGetMetadata result cache, a future FileUploadService provider-upload cache). |

---

## 13. Adding a New `origin` Variant — Developer Checklist

The `origin` field (`'internal' | 'external'` today) is the single most cross-cutting axis in the file module: its value implicitly drives storage layout, DB constraints, mutability policy, dangling semantics, UX language, and cleanup scope. Adding a new variant (e.g. `'archived'`, `'shared'`, `'synced'`) requires coordinated changes across the layers below. **Missing any row silently breaks an invariant** — TypeScript catches discriminated-union exhaustiveness but not CHECK constraints, not ad-hoc policy branches, and not documentation tables.

This checklist is the canonical addition procedure. A PR introducing a new origin MUST tick every row it touches (or explicitly justify a skip).

### 13.1 Type & Schema Layer

| Location | Change required |
|---|---|
| `packages/shared/data/types/file/fileEntry.ts` → `FileEntryOriginSchema` | Add the new enum value |
| Same file → new `XxxEntrySchema` | Define the row shape for the new variant (which columns are nullable / required / branded) |
| Same file → `FileEntrySchema` discriminated union | Add the new schema as a union member |
| Same file → any type guard helpers (`isInternalEntry`, etc.) | Add `isXxxEntry` helper if code needs to narrow |

### 13.2 DB Schema Layer

| Location | Change required |
|---|---|
| `src/main/data/db/schemas/file.ts` | Review every CHECK constraint naming `origin` — `fe_origin_consistency`, `fe_size_internal_only`, `fe_external_no_trash`, `fe_external_path_unique`, etc. — and decide whether the new variant honors / violates / is exempt from each |
| Drizzle migration | Ship the constraint updates in the same migration as the enum expansion. Partial unique indexes on `externalPath` may need a new branch |
| Existing rows | No migration should run for existing rows unless the new variant has a natural subset mapping (unlikely) |

### 13.3 Path Resolution Layer

| Location | Change required |
|---|---|
| `src/main/services/file/utils/pathResolver.ts` → `resolvePhysicalPath` | Add the new `entry.origin` branch; decide storage layout |
| Same file → `canonicalizeExternalPath` | If the new variant is path-based and distinct from `'external'`, decide whether it shares the canonical form or needs its own normalization + brand |

### 13.4 Behavior Policy Matrix

Every ad-hoc `if (entry.origin === 'internal')` / `=== 'external'` in the codebase is a policy decision that must be re-evaluated. Grep for both and review:

| Policy | Location |
|---|---|
| Trash-ability (who can soft-delete) | `trash` / `restore` in FileManager; DB CHECK `fe_external_no_trash` |
| Size snapshot storage | `write` / `writeIfUnchanged` internal-DB-update branch; `toFileInfo` projection |
| Name / ext as SoT vs projection | `rename` mutation; `toFileInfo` projection; `FileEntrySchema` field docs |
| DanglingCache participation | `DanglingCache.check` returns `'present'` for internal; consider where the new variant falls on the `present/missing/unknown` axis |
| `permanentDelete` semantics | Does it touch physical files? Just DB? Refer to §6 and architecture.md §3.4 |
| Orphan sweep scope | §10 scans `origin='internal'` UUID files; does the new variant have a sweepable disk presence? |
| F-2 auto-cleanup scope | §7.2 operates on `('external', 'missing', 0)`; extend the policy matrix row by row |
| IPC dispatch applicability | architecture.md §3.3 tables per method — does each method make sense for the new variant? |

### 13.5 UX Layer

| Location | Change required |
|---|---|
| architecture.md §3.4 UX labeling convention table | Add a row for the new origin's `permanentDelete` user-facing label + confirmation copy |
| Product-side component copy | Concrete button labels / menu items that branch on origin |

### 13.6 Event & Observability Layer

| Location | Change required |
|---|---|
| architecture.md §3.6 event payloads | `onEntryRowChanged.origin` field value domain expands — TS catches via discriminated-union narrowing in the renderer binding |
| Observability logs | `dangling-cache-snapshot`, `orphan-sweep`, `dangling-entry-cleanup` records may need per-origin breakdowns if the new variant is material to diagnostics |

### 13.7 Documentation Layer

| Location | Change required |
|---|---|
| `architecture.md §1.0.1` Semantics of Origin | Add a paragraph describing the new variant |
| `file-manager-architecture.md §1.2` Origin table | Add the row — physical location, ownership, mutability |
| `file-manager-architecture.md §1.2` Invariants table | Add the column — `name` / `ext` / `size` / `externalPath` behavior per-origin |
| `file-manager-architecture.md §12` Key Design Decisions | If the addition surfaces a notable new trade-off, record it |

### 13.8 Gate

PR description MUST list each ticked row with a one-line justification, and each explicitly-skipped row with a reason. A reviewer MUST spot-check §13.2 (DB CHECK constraints) and §13.4 (ad-hoc policy grep) before approval — these are the two layers where silent bugs most often hide.
