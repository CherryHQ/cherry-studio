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
 * - `{ kind: 'path', path }`     → `ops/*` direct (entry-agnostic)
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
 */
export type EnsureExternalEntryIpcParams = {
  externalPath: FilePath
  /** Optional display-name override. Defaults to `path.basename(externalPath)`. */
  name?: string
}

// ─── IPC Result ───

export interface BatchOperationResult {
  succeeded: FileEntryId[]
  failed: Array<{ id: FileEntryId; error: string }>
}

// ─── File IPC API ───

/**
 * File IPC interface — the contract between renderer and main process
 * for all file operations that may affect the filesystem.
 *
 * DataApi handles read-only entry queries; all writes go through this interface.
 */
export interface FileIpcApi {
  // ─── A. File Selection / Dialogs ───

  /** Open file picker dialog (single file) */
  select(options: {
    directory?: never
    multiple?: false
    filters?: FileFilter[]
    title?: string
  }): Promise<string | null>
  /** Open file picker dialog (multiple files) */
  select(options: { directory?: never; multiple: true; filters?: FileFilter[]; title?: string }): Promise<string[]>
  /** Open folder picker dialog (single folder only) */
  select(options: { directory: true; title?: string }): Promise<string | null>
  /** Open save dialog and write content to the selected path */
  save(options: { content: string | Uint8Array; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>

  // ─── B. Entry Creation ───

  /**
   * Create a new Cherry-owned (internal) FileEntry. Always inserts a fresh
   * row with a new UUID. No conflict / upsert semantics — call as many times
   * as needed, each invocation produces an independent entry.
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
   */
  ensureExternalEntry(params: EnsureExternalEntryIpcParams): Promise<FileEntry>

  /** Batch version of `createInternalEntry`. Each item produces an independent new entry. */
  batchCreateInternalEntries(items: CreateInternalEntryIpcParams[]): Promise<BatchOperationResult>

  /**
   * Batch version of `ensureExternalEntry`. Each item is individually upserted
   * by path. Within-batch path duplicates are coalesced to a single entry.
   */
  batchEnsureExternalEntries(items: EnsureExternalEntryIpcParams[]): Promise<BatchOperationResult>

  // ─── C. Read / Metadata (accepts FileHandle) ───

  /** Read content as text */
  read(handle: FileHandle, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<ReadResult<string>>
  /** Read content as base64 */
  read(handle: FileHandle, options: { encoding: 'base64' }): Promise<ReadResult<string>>
  /** Read content as binary */
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
   */
  getMetadata(handle: FileHandle): Promise<PhysicalFileMetadata>

  /** Get lightweight FileVersion (live `fs.stat`-backed). */
  getVersion(handle: FileHandle): Promise<FileVersion>

  /** Compute xxhash-128 of file content. */
  getContentHash(handle: FileHandle): Promise<string>

  // ─── D. Write (accepts FileHandle; both branches land in ops' atomic write) ───

  /** Unconditional atomic write. */
  write(handle: FileHandle, data: string | Uint8Array): Promise<FileVersion>

  /** Optimistic-concurrency write. Throws StaleVersionError on version mismatch. */
  writeIfUnchanged(handle: FileHandle, data: string | Uint8Array, expectedVersion: FileVersion): Promise<FileVersion>

  // ─── E. Trash / Delete ───

  /**
   * Move entry to Trash (soft delete via trashedAt). Internal-origin entries only.
   * Passing an external-origin entry id throws: external entries cannot be trashed
   * (`fe_external_no_trash` CHECK).
   */
  trash(params: { id: FileEntryId }): Promise<void>

  /**
   * Restore entry from Trash. Internal-origin entries only — external entries
   * are never trashed, so passing one throws.
   */
  restore(params: { id: FileEntryId }): Promise<FileEntry>

  /**
   * Permanently delete.
   * - Entry handle, internal origin: unlinks `{userData}/files/{id}.{ext}`, then deletes DB row.
   * - Entry handle, external origin: **DB-only** — the user's physical file
   *   is left untouched. Entry-level deletion is deliberately decoupled from
   *   physical deletion; callers wanting to also delete the file on disk
   *   should invoke the path-handle branch below separately.
   * - Path handle: removes the file at the given path (delegates to `ops.remove`).
   */
  permanentDelete(handle: FileHandle): Promise<void>

  /** Batch trash — internal-origin only; external ids fail like `trash`. */
  batchTrash(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
  /** Batch restore — internal-origin only; external ids fail like `restore`. */
  batchRestore(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
  /** Batch permanently delete entries (DB row always removed; physical FS follows origin rules above). */
  batchPermanentDelete(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>

  // ─── F. Rename ───

  /**
   * Rename a file.
   * - Entry handle: `newTarget` is a new display name (no path separators).
   *   For external-origin entries the physical file is renamed in place; for
   *   internal-origin entries only the DB name changes.
   * - Path handle: `newTarget` is a full new absolute path. Equivalent to
   *   `fs.rename(path, newTarget)`.
   */
  rename(handle: FileHandle, newTarget: string): Promise<FileEntry | void>

  // ─── G. Copy ───

  /**
   * Copy content into a new internal-origin entry.
   * Source can be either handle variant (and for the entry variant, either origin).
   */
  copy(params: { source: FileHandle; newName?: string }): Promise<FileEntry>

  // ─── H. System Operations (accepts FileHandle) ───

  /** Open file/directory with the system default application */
  open(handle: FileHandle): Promise<void>
  /** Reveal file/directory in the system file manager */
  showInFolder(handle: FileHandle): Promise<void>

  // ─── I. Directory Listing (arbitrary path) ───

  /** List contents of an arbitrary directory. */
  listDirectory(dirPath: FilePath, options?: DirectoryListOptions): Promise<string[]>

  /** Check if a directory is non-empty. */
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
   */
  getDanglingState(params: { id: FileEntryId }): Promise<DanglingState>

  /**
   * Batch form of `getDanglingState`. Each requested id appears in the result
   * map. Unknown ids map to `'unknown'`.
   */
  batchGetDanglingStates(params: { ids: FileEntryId[] }): Promise<Record<FileEntryId, DanglingState>>

  /**
   * Resolve the absolute filesystem path of a FileEntry. For internal-origin
   * entries this is `{userData}/files/{id}.{ext}`; for external-origin entries
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
   */
  getPhysicalPath(params: { id: FileEntryId }): Promise<FilePath>

  /**
   * Batch form of `getPhysicalPath`. Each requested id appears in the result
   * map. Unknown ids are omitted.
   */
  batchGetPhysicalPaths(params: { ids: FileEntryId[] }): Promise<Record<FileEntryId, FilePath>>
}

// ─── Electron Types ───

export interface FileFilter {
  name: string
  extensions: string[]
}
