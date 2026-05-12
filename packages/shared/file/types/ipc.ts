/**
 * File IPC type contracts
 *
 * Defines the parameter and return types for File IPC operations.
 *
 * File IPC is the home for **all** file operations that need FS IO or main-side
 * computation — both mutations (create / rename / delete / move / write / trash)
 * and reads that reach past the DB (content read, dangling probe, path resolution,
 * safe URL, dialogs, streams, `open`). DataApi is kept strictly to pure SQL
 * queries; anything that would touch `fs.stat`, `resolvePhysicalPath`, or
 * `DanglingCache` belongs here instead.
 *
 * These types are shared between main (handler implementation) and
 * preload (method signatures exposed to renderer).
 *
 * ## Unified access via FileHandle
 *
 * Most operations accept `FileHandle` (tagged union) so consumers don't have
 * to pick between "route through the entry system" and "hit the FS directly"
 * at the type-signature level — they encode the choice in the handle instead.
 * The handler dispatches:
 * - `{ kind: 'entry', entryId }` → FileManager method (entry-aware)
 * - `{ kind: 'path', path }`     → `@main/utils/file/*` direct (entry-agnostic)
 *
 * Operations that only make sense against a FileEntry row (trash, rename,
 * enrichment queries, etc.) take `FileEntryId` directly.
 */

import type { DanglingState, FileEntry, FileEntryId } from '@shared/data/types/file'

import type { Base64String, DirectoryListOptions, FilePath, PhysicalFileMetadata, URLString } from './common'
import type { FileHandle } from './handle'

export type { DirectoryListOptions, FilePath } from './common'

// ─── Version ───

export interface FileVersion {
  mtime: number
  size: number
}

export interface ReadResult<T> {
  content: T
  mime: string
  version: FileVersion
}

// ─── IPC Params ───

/**
 * Params for creating a Cherry-owned (internal) FileEntry.
 *
 * Always produces a fresh entry with a new UUID — no conflict resolution.
 *
 * ## Why a `source` discriminator union?
 *
 * `name` and `ext` are display metadata. They can sometimes be derived from
 * the content source, but not always. Rather than taking them all as optional
 * and letting callers silently pass redundant (or contradictory) values, we
 * enumerate the four content sources and type-gate the fields that each one
 * can or cannot derive:
 *
 * | source   | name derivation          | ext derivation              | caller must pass  |
 * |----------|--------------------------|-----------------------------|-------------------|
 * | `path`   | `basename(path)`         | `extname(path)`             | — (path only)     |
 * | `url`    | URL tail / CD header     | URL suffix / Content-Type   | — (url only)      |
 * | `base64` | no origin                | mime → ext lookup           | `name?` (UX)      |
 * | `bytes`  | no origin                | no origin                   | `name`, `ext`     |
 *
 * "Can derive" ⇒ the field is **absent** from that branch — preventing
 * callers from accidentally passing a `name` that disagrees with `basename(path)`.
 * "Cannot derive" ⇒ the field is **required** (or optional-with-fallback for
 * UX names, where the caller has a legitimate choice).
 *
 * See `file-arch-problems-response.md` for the full rationale (extension of A-7).
 */
export type CreateInternalEntryIpcParams =
  | {
      /** Copy the file at `path` into Cherry storage. `name` / `ext` derived from basename+extname. */
      source: 'path'
      path: FilePath
    }
  | {
      /** Download the URL into Cherry storage. `name` / `ext` derived from URL tail, Content-Disposition, and Content-Type. */
      source: 'url'
      url: URLString
    }
  | {
      /** Decode `data:<mime>;base64,...` and write into Cherry storage. `ext` derived from mime; caller may override the UX display name. */
      source: 'base64'
      data: Base64String
      /** Optional display name override. If omitted, FileManager synthesizes one (e.g. `Pasted Image 2026-04-21`). */
      name?: string
    }
  | {
      /** Write raw bytes into Cherry storage. No derivation possible — caller is the sole authority for `name` and `ext`. */
      source: 'bytes'
      data: Uint8Array
      /** Display name without extension. */
      name: string
      /** File extension without leading dot (e.g. `'pdf'`), or `null` for extensionless. */
      ext: string | null
    }

/**
 * Params for ensuring an entry exists for a user-provided (external) path.
 * Pure upsert semantics on `externalPath`: if an entry with the same path
 * exists, it is returned as-is; otherwise a new row is inserted. External
 * rows carry no stored `size` (always `null`); live values come from
 * `getMetadata`. External entries cannot be trashed, so no "restore" branch
 * is possible.
 *
 * ## Canonicalization stays on the main side (by design)
 *
 * `externalPath` is intentionally typed as raw `FilePath` rather than
 * `CanonicalExternalPath`. The asymmetry is deliberate:
 *
 * - **Renderer has no canonicalize use case.** It never compares paths
 *   for dedup (the DB-level `UNIQUE(externalPath)` index does that
 *   after `ensureExternalEntry`), never derives a canonical projection,
 *   and never uses paths as join keys. Every path the renderer holds
 *   either flows back to main (for an IPC call) or feeds a system API
 *   that itself accepts arbitrary user paths.
 * - **Canonicalization implementation is main-only.**
 *   `canonicalizeExternalPath` (`src/main/services/file/utils/pathResolver.ts`)
 *   depends on main-only modules (realpath / NFC / case-fold). Asking the
 *   renderer to canonicalize would either duplicate that logic or
 *   require an extra IPC hop per call — no upside for either choice.
 * - **The brand is already protected by a project rule, not by JSDoc.**
 *   `fileEntry.ts` makes the construction discipline explicit: only the
 *   `canonicalizeExternalPath` factory may produce `CanonicalExternalPath`;
 *   production code MUST NEVER `as`-cast into the brand. Code that
 *   bypasses the gate violates the rule, not just an inline comment —
 *   PR review catches it the same way it catches any other rule break.
 *
 * **Why not extend the brand to the IPC boundary** (e.g. a `RawExternalPath`
 * brand on the param): the renderer would have to `as`-cast `string →
 * RawExternalPath` at the call site, which is itself a violation of the
 * same "no production `as`-cast into brands" rule. The proposal therefore
 * trades one boundary's discipline for another's, without adding actual
 * enforcement; meanwhile dev / test ergonomics get worse at every call
 * site. The four current main consumers (FileManager.ensureExternalEntry,
 * FileManager.rename, `internal/entry/rename.ts`, `internal/entry/create.ts`)
 * already canonicalize before any DB lookup, and Phase 2 consumers join
 * that pattern via code review at the same sites.
 *
 * Skipping canonicalization silently misses entries on case-insensitive
 * filesystems and after symlink resolution — which is why the gate exists
 * at all.
 */
export type EnsureExternalEntryIpcParams = {
  externalPath: FilePath
  /** Optional display-name override. Defaults to `path.basename(externalPath)`. */
  name?: string
}

// ─── IPC Result ───

/**
 * Aggregate result of a batch operation.
 *
 * `failed` is a discriminated union: exactly one of `id` / `sourceRef` is
 * present per entry, enforced by the type system so a handler returning a
 * malformed entry (`{ error }` alone, or `{ id, sourceRef, error }`) stops
 * compiling instead of leaking into renderer consumers.
 *
 * - **id-bearing**: the input was an existing FileEntryId (batchTrash,
 *   batchRestore, batchPermanentDelete).
 * - **sourceRef-bearing**: create-side batches that never materialized an
 *   entry — batchCreateInternalEntries carries an opaque caller-provided
 *   index/label; batchEnsureExternalEntries carries the input externalPath.
 *
 * Consumer narrowing (`if (item.id) … else if (item.sourceRef) …`) keeps
 * working — TypeScript narrows the union on the truthy branch.
 */
export interface BatchOperationResult {
  succeeded: FileEntryId[]
  failed: Array<
    { id: FileEntryId; sourceRef?: never; error: string } | { id?: never; sourceRef: string; error: string }
  >
}

// ─── File IPC API ───

/**
 * File IPC interface — the contract between renderer and main process
 * for all file operations that may affect the filesystem.
 *
 * DataApi handles read-only entry queries; all writes go through this interface.
 *
 * ## Wiring status — read this before calling
 *
 * Every method below carries a `@phase` JSDoc tag declaring whether its
 * underlying IPC channel is registered in this PR (Phase 1) or planned to
 * land in a follow-up (Phase 2). Renderer code calling a `@phase 2` method
 * will type-check but fail at runtime because the channel does not exist.
 *
 * | Phase 1 — wired in `IpcChannel.ts` | Phase 2 — type-only declaration |
 * |---|---|
 * | `getDanglingState`, `batchGetDanglingStates` | everything else |
 *
 * Phase 2 method shapes are *design drafts*; signatures may shift when each
 * channel actually lands alongside its first FileManager consumer. Treat
 * them as a roadmap, not a frozen contract.
 *
 * Grep `@phase 2` to enumerate Phase 2 surface; grep `@phase 1` for what is
 * already callable today.
 */
export interface FileIpcApi {
  // ─── A. File Selection / Dialogs ───
  //
  // Section status: all `@phase 2` — none of these dialogs has an IPC channel
  // yet. Renderer code that needs file selection in Phase 1 must use the
  // existing legacy `IpcChannel.File_Select` surface.

  /**
   * Open file picker dialog (single file)
   * @phase 2 — not yet wired
   */
  select(options: {
    directory?: never
    multiple?: false
    filters?: FileFilter[]
    title?: string
  }): Promise<string | null>
  /**
   * Open file picker dialog (multiple files)
   * @phase 2 — not yet wired
   */
  select(options: { directory?: never; multiple: true; filters?: FileFilter[]; title?: string }): Promise<string[]>
  /**
   * Open folder picker dialog (single folder only)
   * @phase 2 — not yet wired
   */
  select(options: { directory: true; title?: string }): Promise<string | null>
  /**
   * Open save dialog and write content to the selected path
   * @phase 2 — not yet wired
   */
  save(options: { content: string | Uint8Array; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>

  // ─── B. Entry Creation ───
  //
  // Section status: all `@phase 2`.

  /**
   * Create a new Cherry-owned (internal) FileEntry. Always inserts a fresh
   * row with a new UUID. No conflict / upsert semantics — call as many times
   * as needed, each invocation produces an independent entry.
   *
   * @phase 2 — not yet wired
   */
  createInternalEntry(params: CreateInternalEntryIpcParams): Promise<FileEntry>

  /**
   * Ensure an external FileEntry exists for the given absolute path.
   *
   * **Pure upsert** semantics keyed by `externalPath`:
   * - Existing entry with same path → return it as-is (nothing to refresh —
   *   `name` / `ext` are projections of `externalPath` and `size` is not
   *   stored for external; live values come from `getMetadata`).
   * - No existing entry → insert a new row after a one-shot `fs.stat` that
   *   verifies the path exists and seeds DanglingCache.
   *
   * Idempotent by design — callers holding an `externalPath` can invoke this
   * freely without pre-checking. The global unique index
   * `UNIQUE(externalPath)` (internal rows are `null` and exempt) enforces the
   * invariant; `fe_external_no_trash` forbids trashed external rows so no
   * "restore" branch exists.
   *
   * @phase 2 — not yet wired
   */
  ensureExternalEntry(params: EnsureExternalEntryIpcParams): Promise<FileEntry>

  /**
   * Batch version of `createInternalEntry`. Each item produces an independent new entry.
   * @phase 2 — not yet wired
   */
  batchCreateInternalEntries(items: CreateInternalEntryIpcParams[]): Promise<BatchOperationResult>

  /**
   * Batch version of `ensureExternalEntry`. Each item is individually upserted
   * by path. Within-batch path duplicates are coalesced to a single entry.
   *
   * @phase 2 — not yet wired
   */
  batchEnsureExternalEntries(items: EnsureExternalEntryIpcParams[]): Promise<BatchOperationResult>

  // ─── C. Read / Metadata (accepts FileHandle) ───
  //
  // Section status: all `@phase 2`.

  /**
   * Read content as text
   * @phase 2 — not yet wired
   */
  read(handle: FileHandle, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<ReadResult<string>>
  /**
   * Read content as base64
   * @phase 2 — not yet wired
   */
  read(handle: FileHandle, options: { encoding: 'base64' }): Promise<ReadResult<string>>
  /**
   * Read content as binary
   * @phase 2 — not yet wired
   */
  read(handle: FileHandle, options: { encoding: 'binary' }): Promise<ReadResult<Uint8Array>>

  /**
   * Get live physical metadata (size, mime, timestamps, type-specific fields).
   *
   * Always runs `fs.stat` — this is the canonical way to obtain a fresh `size`
   * / `mtime` for an external entry, since external rows carry no stored
   * `size` in DB. For internal entries the returned `size` matches the DB
   * row's `size` by construction (atomic writes keep DB and FS in sync).
   *
   * Side effect: updates DanglingCache based on stat outcome (external only).
   *
   * @phase 2 — not yet wired
   */
  getMetadata(handle: FileHandle): Promise<PhysicalFileMetadata>

  /**
   * Batch version of `getMetadata`. Entry-id only — path-handle stat has no
   * N-call motivation (pickers and dialogs typically surface <20 items, for
   * which parallel singular calls are fine).
   *
   * List-page flows in the renderer MUST use this over
   * `Promise.all(ids.map(id => getMetadata(...)))` — the latter incurs N IPC
   * round-trips, while this endpoint is a single round-trip whose handler
   * parallelises `fs.stat` internally via `Promise.all` (microseconds per
   * stat on local FS; the IPC hop dominates).
   *
   * Per-id result semantics:
   * - `fs.stat` succeeds → `PhysicalFileMetadata`
   * - `fs.stat` fails (missing file, permission denied, etc.) → `null`
   *   (caller renders a "—" fallback; DanglingCache is updated to `'missing'`
   *   for external entries as a side effect)
   *
   * The result map contains every input id exactly once. Ids that refer to
   * non-existent FileEntry rows (already deleted, never existed) cause the
   * whole batch to throw — this is a caller bug, not a per-id failure.
   *
   * @phase 2 — not yet wired
   */
  batchGetMetadata(params: { ids: FileEntryId[] }): Promise<Record<FileEntryId, PhysicalFileMetadata | null>>

  /**
   * Get lightweight FileVersion (live `fs.stat`-backed).
   * @phase 2 — not yet wired
   */
  getVersion(handle: FileHandle): Promise<FileVersion>

  /**
   * Compute xxhash-h64 of file content.
   * @phase 2 — not yet wired
   */
  getContentHash(handle: FileHandle): Promise<string>

  // ─── D. Write (accepts FileHandle; both branches land in ops' atomic write) ───
  //
  // Section status: all `@phase 2`.

  /**
   * Unconditional atomic write.
   * @phase 2 — not yet wired
   */
  write(handle: FileHandle, data: string | Uint8Array): Promise<FileVersion>

  /**
   * Optimistic-concurrency write. Throws StaleVersionError on version mismatch.
   *
   * `expectedContentHash` (xxhash-h64 hex) is optional and only consulted on
   * second-precision filesystems (FAT32 / SMB / NFS) where the observed mtime
   * truncates to whole seconds — see `FileVersion` JSDoc for the full
   * fallback contract.
   *
   * @phase 2 — not yet wired
   */
  writeIfUnchanged(
    handle: FileHandle,
    data: string | Uint8Array,
    expectedVersion: FileVersion,
    expectedContentHash?: string
  ): Promise<FileVersion>

  // ─── E. Trash / Delete ───
  //
  // Section status: all `@phase 2`.

  /**
   * Move entry to Trash (soft delete via trashedAt). Internal-origin entries only.
   * Passing an external-origin entry id throws: external entries cannot be trashed
   * (`fe_external_no_trash` CHECK).
   *
   * @phase 2 — not yet wired
   */
  trash(params: { id: FileEntryId }): Promise<void>

  /**
   * Restore entry from Trash. Internal-origin entries only — external entries
   * are never trashed, so passing one throws.
   *
   * @phase 2 — not yet wired
   */
  restore(params: { id: FileEntryId }): Promise<FileEntry>

  /**
   * Permanently delete.
   * - Entry handle, internal origin: unlinks `{userData}/Data/Files/{id}.{ext}`, then deletes DB row.
   * - Entry handle, external origin: **DB-only** — the user's physical file
   *   is left untouched. Entry-level deletion is deliberately decoupled from
   *   physical deletion; callers wanting to also delete the file on disk
   *   should invoke the path-handle branch below separately.
   * - Path handle: removes the file at the given path (delegates to `@main/utils/file/fs.remove`).
   *
   * **⚠️ UX label warning**: the literal name `permanentDelete` is misleading
   * for the external-entry branch, where nothing is "permanently deleted"
   * on disk. UI surfaces MUST choose the user-facing label per
   * `(handle.kind, origin)` — see the UX labeling convention table in
   * `docs/references/file/architecture.md §3.4` before wiring this call
   * into a button. Failing to differentiate results in either (a) user
   * expects disk deletion and files a bug report, or (b) user avoids the
   * action fearing data loss and accumulates dangling library entries.
   *
   * @phase 2 — not yet wired
   */
  permanentDelete(handle: FileHandle): Promise<void>

  /**
   * Batch trash — internal-origin only; external ids fail like `trash`.
   * @phase 2 — not yet wired
   */
  batchTrash(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
  /**
   * Batch restore — internal-origin only; external ids fail like `restore`.
   * @phase 2 — not yet wired
   */
  batchRestore(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
  /**
   * Batch permanently delete entries (DB row always removed; physical FS follows origin rules above).
   * @phase 2 — not yet wired
   */
  batchPermanentDelete(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>

  // ─── F. Rename ───
  //
  // Section status: all `@phase 2`.

  /**
   * Rename a file.
   * - Entry handle: `newTarget` is a new display name (no path separators).
   *   For external-origin entries the physical file is renamed in place; for
   *   internal-origin entries only the DB name changes.
   * - Path handle: `newTarget` is a full new absolute path. Equivalent to
   *   `fs.rename(path, newTarget)`.
   *
   * @phase 2 — not yet wired
   */
  rename(handle: FileHandle, newTarget: string): Promise<FileEntry | void>

  // ─── G. Copy ───
  //
  // Section status: all `@phase 2`.

  /**
   * Copy content into a new internal-origin entry.
   * Source can be either handle variant (and for the entry variant, either origin).
   *
   * @phase 2 — not yet wired
   */
  copy(params: { source: FileHandle; newName?: string }): Promise<FileEntry>

  // ─── H. System Operations (accepts FileHandle) ───
  //
  // Section status: all `@phase 2`.

  /**
   * Open file/directory with the system default application
   * @phase 2 — not yet wired
   */
  open(handle: FileHandle): Promise<void>
  /**
   * Reveal file/directory in the system file manager
   * @phase 2 — not yet wired
   */
  showInFolder(handle: FileHandle): Promise<void>

  // ─── I. Directory Listing (arbitrary path) ───
  //
  // Section status: all `@phase 2`.

  /**
   * List contents of an arbitrary directory.
   * @phase 2 — not yet wired
   */
  listDirectory(dirPath: FilePath, options?: DirectoryListOptions): Promise<string[]>

  /**
   * Check if a directory is non-empty.
   * @phase 2 — not yet wired
   */
  isNotEmptyDir(dirPath: FilePath): Promise<boolean>

  // ─── J. Entry Enrichment (FileEntryId only; FS / main-side compute) ───
  //
  // These methods replace the former DataApi opt-in fields
  // (`includeDangling` / `includePath`). DataApi is kept strictly SQL-only;
  // anything that needs FS IO or main-side resolvers lives here.
  //
  // For the `file://` URL that used to be served via `includeUrl`, callers
  // now compose it in-process via the shared `toSafeFileUrl(path, ext)` helper
  // in `@shared/file/urlUtil` — a pure formatting layer over the `FilePath`
  // returned by `getPhysicalPath`, so it needs no IPC of its own.
  //
  // Each method has a single-item and a batch form. Prefer the batch form when
  // rendering lists — it gives the handler room to parallelize and amortize
  // cache lookups, and keeps the per-call IPC overhead O(1).
  //
  // Section status: dangling pair is `@phase 1` (wired); physical-path pair
  // is `@phase 2`.

  /**
   * Query the presence state of an external-origin entry (via file_module's
   * `DanglingCache`). On cache hit, synchronous; on miss, performs a single
   * `fs.stat` and updates the cache. Internal-origin entries always return `'present'`.
   *
   * ## Staleness contract (best-effort)
   *
   * `dangling` is an FS-observed time-varying value — the watcher does not
   * guarantee coverage of every path, and a file may be externally deleted
   * immediately after a cache hit. Consumers MUST allow a natural refresh
   * lifecycle (React Query `staleTime` ≤ 5min, or explicit refetch after a
   * user action). Do NOT cache with `staleTime: Infinity` — that combination
   * is self-contradictory (asking for dangling while refusing to re-check).
   *
   * For user-triggered refresh of a specific entry, invalidate the presence
   * query directly (a refetch re-runs this IPC, which repopulates the cache
   * via a cold `fs.stat`).
   *
   * @phase 1 — wired in `IpcChannel.File_GetDanglingState`
   */
  getDanglingState(params: { id: FileEntryId }): Promise<DanglingState>

  /**
   * Batch form of `getDanglingState`. Each requested id appears in the result
   * map. Unknown ids map to `'unknown'`.
   *
   * @phase 1 — wired in `IpcChannel.File_BatchGetDanglingStates`
   */
  batchGetDanglingStates(params: { ids: FileEntryId[] }): Promise<Record<FileEntryId, DanglingState>>

  /**
   * Resolve the absolute filesystem path of a FileEntry. For internal-origin
   * entries this is `{userData}/Data/Files/{id}.{ext}`; for external-origin entries
   * it returns `entry.externalPath`.
   *
   * ## Intended uses
   *
   * - Agent context embedding (passing a path string to an LLM prompt)
   * - Drag-drop to external apps (via `webContents.startDrag`)
   * - Subprocess spawn / third-party CLI that only accepts path arguments
   * - "Open in external editor" UX
   *
   * ## NOT intended (convention)
   *
   * - Do NOT treat this as a stable identifier — storage layout may change.
   *   Use `entry.id` when identity is all you need.
   * - Do NOT string-concat into shell commands without independent sanitization.
   * - Do NOT use this to bypass FileManager for writes — mutations must go
   *   through File IPC so version / dangling / FS invariants stay consistent.
   *
   * Enforced **by convention** (code review gate); the type system cannot
   * prevent a renderer from misusing a `FilePath` string.
   *
   * @phase 2 — not yet wired
   */
  getPhysicalPath(params: { id: FileEntryId }): Promise<FilePath>

  /**
   * Batch form of `getPhysicalPath`. Each requested id appears in the result
   * map. Unknown ids are omitted.
   *
   * @phase 2 — not yet wired
   */
  batchGetPhysicalPaths(params: { ids: FileEntryId[] }): Promise<Record<FileEntryId, FilePath>>
}

// ─── Electron Types ───

export interface FileFilter {
  name: string
  extensions: string[]
}
