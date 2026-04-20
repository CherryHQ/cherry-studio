/**
 * FileManager — the sole public entry point for all file operations.
 *
 * Every FileEntry has an `origin`:
 * - `internal`: Cherry owns the content (stored at `{userData}/files/{id}.{ext}`)
 * - `external`: Cherry references a user-provided absolute path
 *
 * ## Facade pattern
 *
 * FileManager is a **thin facade** — it exposes the public IPC-backed API and
 * delegates every method to pure-function modules under `./internal/*`. The
 * class itself only owns:
 * - lifecycle (`onInit` / `onStop`; IPC handler registration via `BaseService`)
 * - `versionCache` (LRU backing `writeIfUnchanged` / `getVersion`)
 * - `FileHandle.kind` dispatch at the IPC boundary
 *
 * External callers in the Main process must go through FileManager (either via
 * `application.get('FileManager')` or by importing from `@main/file`). The
 * `internal/*` modules are private and not re-exported via `src/main/file/index.ts`.
 *
 * See `docs/zh/references/file/file-manager-architecture.md §1.6` for the full
 * implementation-layout decision.
 *
 * ## Managed vs Unmanaged — FileHandle dispatch at the IPC boundary
 *
 * FileManager's public API (below) is **entry-native** — every method takes a
 * `FileEntryId`. Main-side business services call it directly without having
 * to wrap ids in a handle.
 *
 * At the IPC boundary, the renderer speaks `FileHandle` (a tagged union over
 * managed/unmanaged references). Dispatching on `handle.kind` is treated as
 * the IPC adapter's legitimate responsibility (translating request shape),
 * not business orchestration. FileManager.onInit registers handlers with the
 * private `dispatchHandle` helper:
 *
 * - `{ kind: 'managed', entryId }` → the corresponding FileManager public
 *   method (e.g. `this.read(entryId, opts)`)
 * - `{ kind: 'unmanaged', path }`  → the `*Unmanaged` variant exported from
 *   `internal/*` (e.g. `contentRead.readUnmanaged(deps, path, opts)`)
 *
 * `*Unmanaged` variants are not exposed on the FileManager class — Main-side
 * callers have no use for them (they hold FileEntry, not arbitrary paths).
 *
 * New handle kinds (e.g. `virtual` for zip members) extend `dispatchHandle`
 * and each IPC handler within this file; the public API surface and
 * `internal/*` pure-function structure both stay stable.
 *
 * See `docs/zh/references/file/file-manager-architecture.md §1.6.5` for the
 * full dispatch convention.
 *
 * ## External entries — best-effort reference semantics
 *
 * External entries represent "the caller expressed an intention to reference
 * this path at some point in time". Cherry does not track external renames/
 * moves; external filesystem changes surface naturally as "read returns new
 * content" or "entry becomes dangling".
 *
 * Which callers use internal vs external is a business-layer decision —
 * FileManager makes no assumption. For module boundaries and dangling-state
 * tracking, see:
 * - [file-manager-architecture.md](../../../docs/zh/references/file/file-manager-architecture.md)
 * - [architecture.md](../../../docs/zh/references/file/architecture.md)
 *
 * Cherry **allows** user-initiated modification of external files:
 * - `write` / `writeIfUnchanged` → atomic write to `externalPath`
 * - `rename` → `fs.rename` + update DB
 * - `permanentDelete` → `ops.remove(externalPath)` + delete DB
 *
 * Cherry **never** modifies external files automatically:
 * - No watcher-driven writebacks
 * - No background sync
 * - No tracking of external rename/move
 *
 * Trash / restore on external entries only update `trashedAt` in DB;
 * the user's file on disk is not touched. Only `permanentDelete` physically
 * removes it.
 *
 * `createEntry({ origin: 'external' })` upserts by `externalPath` (partial unique
 * index on `file_entry` when `trashedAt IS NULL`), restoring a trashed entry
 * with the same path if one exists.
 *
 * Dangling state is tracked by the file_module's `DanglingCache` singleton,
 * not by FileManager itself. FileManager ops update the cache as a side effect
 * of successful/failed stats.
 */

import type { Readable, Writable } from 'node:stream'

import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { BatchOperationResult, FileContent, FilePath, PhysicalFileMetadata } from '@shared/file/types'

// ─── Version types ───

export interface FileVersion {
  /** ms epoch */
  mtime: number
  /** bytes */
  size: number
}

export interface ReadResult<T> {
  content: T
  mime: string
  version: FileVersion
}

// ─── Create params ───

/**
 * Params for `createInternalEntry`. Each call produces a fresh entry with a
 * new UUID — no conflict / upsert semantics.
 */
export type CreateInternalEntryParams = {
  /** User-visible name (without extension) */
  name: string
  /** Optional extension (without leading dot). Derived from `name` if omitted. */
  ext?: string | null
  content: FileContent
}

/**
 * Params for `ensureExternalEntry`. Upsert semantics — see method JSDoc below
 * for the full insert / reuse / restore matrix.
 */
export type EnsureExternalEntryParams = {
  /** Absolute path to user-provided file. Must exist and be readable. */
  externalPath: FilePath
  /** Optional override for display name (defaults to basename of externalPath) */
  name?: string
}

// ─── Stream helpers ───

/** Atomic write stream: buffered to tmp until `.close()` commits via rename. */
export interface AtomicWriteStream extends Writable {
  /** Cancel the write; unlink tmp file. */
  abort(): Promise<void>
}

// ─── Errors ───

/**
 * Thrown by `writeIfUnchanged` when the current file version does not match the
 * caller's expected version. Caller should refresh or present a conflict UX.
 */
export class StaleVersionError extends Error {
  constructor(
    public readonly entryId: FileEntryId,
    public readonly expected: FileVersion,
    public readonly current: FileVersion
  ) {
    super(
      `Entry ${entryId} version mismatch: expected mtime=${expected.mtime} size=${expected.size}, ` +
        `got mtime=${current.mtime} size=${current.size}`
    )
    this.name = 'StaleVersionError'
  }
}

// ─── IFileManager ───

export interface IFileManager {
  // ─── Entry Creation ───
  //
  // Naming follows strict create-vs-ensure convention:
  // - `createInternalEntry` is pure insert — always a new row, new UUID
  // - `ensureExternalEntry` is upsert+restore — idempotent by design
  //
  // The original `createEntry({ origin })` umbrella was intentionally split
  // to keep the public API's name match the actual semantics; see ADR / PR
  // #13451 review response (A-7).

  /**
   * Create a new Cherry-owned (internal) FileEntry.
   *
   * Writes `content` to `{userData}/files/{newUuid}.{ext}` and inserts a fresh
   * DB row. No conflict resolution — every call produces an independent entry.
   */
  createInternalEntry(params: CreateInternalEntryParams): Promise<FileEntry>

  /**
   * Ensure an entry exists for a user-provided absolute path.
   *
   * Upsert semantics on `externalPath`:
   * - Existing non-trashed entry with same path → return it (snapshot refreshed via stat)
   * - Existing trashed entry with same path → restore (`trashedAt = null`) and return it
   * - No existing entry → insert a new row
   *
   * The partial unique index
   * `UNIQUE(externalPath) WHERE origin='external' AND trashedAt IS NULL`
   * enforces this invariant at the DB level; repeated calls with the same
   * path are safe and idempotent.
   */
  ensureExternalEntry(params: EnsureExternalEntryParams): Promise<FileEntry>

  /** Batch version of `createInternalEntry`. Each item produces an independent new entry. */
  batchCreateInternalEntries(items: CreateInternalEntryParams[]): Promise<BatchOperationResult>

  /**
   * Batch version of `ensureExternalEntry`. Within-batch path duplicates are
   * coalesced to a single entry in the result (the second occurrence hits the
   * non-trashed reuse path).
   */
  batchEnsureExternalEntries(items: EnsureExternalEntryParams[]): Promise<BatchOperationResult>

  // ─── Reading ───

  /** Read file content as text (default). */
  read(id: FileEntryId, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<ReadResult<string>>
  /** Read file content as base64 string with detected mime. */
  read(id: FileEntryId, options: { encoding: 'base64' }): Promise<ReadResult<string>>
  /** Read file content as binary. */
  read(id: FileEntryId, options: { encoding: 'binary' }): Promise<ReadResult<Uint8Array>>

  /** Create a readable stream. */
  createReadStream(id: FileEntryId): Promise<Readable>

  /** Get physical file metadata. For external entries, triggers stat-refresh of DB snapshot. */
  getMetadata(id: FileEntryId): Promise<PhysicalFileMetadata>

  // ─── Version / Hash ───

  /** Get FileVersion (stat-based). For external, refreshes cached size if changed. */
  getVersion(id: FileEntryId): Promise<FileVersion>

  /** Compute xxhash-128 of file content. Reads full file. */
  getContentHash(id: FileEntryId): Promise<string>

  // ─── Writing ───

  /**
   * Unconditional write.
   * - internal: atomic write to `{userData}/files/{id}.{ext}`
   * - external: atomic write to `externalPath`
   */
  write(id: FileEntryId, data: string | Uint8Array): Promise<FileVersion>

  /**
   * Optimistic-concurrency write.
   * Throws `StaleVersionError` if current version differs from expected.
   * Works for both internal and external entries.
   */
  writeIfUnchanged(id: FileEntryId, data: string | Uint8Array, expectedVersion: FileVersion): Promise<FileVersion>

  /** Stream write with atomic commit (tmp + rename on close). Works for both origins. */
  createWriteStream(id: FileEntryId): Promise<AtomicWriteStream>

  // ─── Rename ───

  /**
   * Rename (change display name).
   * - internal: updates DB name only (UUID-based physical path doesn't change)
   * - external: `fs.rename(externalPath, newPath)` + update DB (externalPath, name)
   *   where `newPath = path.join(dirname(externalPath), newName + ext)`.
   * Throws if FS rename fails (target exists, permission denied, etc.).
   */
  rename(id: FileEntryId, newName: string): Promise<FileEntry>

  // ─── Copy ───

  /** Copy content into a new internal entry. Source can be internal or external. */
  copy(params: { id: FileEntryId; newName?: string }): Promise<FileEntry>

  // ─── Trash / Delete ───

  /** Move entry to Trash (soft delete via `trashedAt`). No FS impact for either origin. */
  trash(id: FileEntryId): Promise<void>

  /** Restore entry from Trash (`trashedAt = null`). No FS impact. */
  restore(id: FileEntryId): Promise<FileEntry>

  /**
   * Permanently delete entry. Physical file is removed for both origins:
   * - internal: unlinks `{userData}/files/{id}.{ext}`
   * - external: `ops.remove(externalPath)` — user explicitly asked to destroy
   * Then deletes the DB row.
   *
   * Failure to unlink (e.g., file already missing, permission denied) is logged
   * but does not block DB deletion — we prefer DB-FS convergence to "both gone".
   */
  permanentDelete(id: FileEntryId): Promise<void>

  batchTrash(ids: FileEntryId[]): Promise<BatchOperationResult>
  batchRestore(ids: FileEntryId[]): Promise<BatchOperationResult>
  batchPermanentDelete(ids: FileEntryId[]): Promise<BatchOperationResult>

  // ─── External entry metadata refresh ───

  /**
   * For external entries: re-stat and update DB snapshot (name/ext/size).
   * For internal entries: no-op (returns current entry).
   *
   * Side effect: updates DanglingCache based on stat outcome.
   *
   * Note: Cherry does not track external renames. If the file has moved, the
   * entry becomes dangling. Users must re-@ to establish a new reference (which
   * upserts against the new path).
   */
  refreshMetadata(id: FileEntryId): Promise<FileEntry>

  // ─── 3rd-party Library Escape Hatch ───

  /**
   * Copy file content to an isolated temp path, invoke `fn(tempPath)`, then delete the temp copy.
   * For libraries that only accept file paths (e.g. sharp, pdf-lib, officeparser, OpenAI uploads).
   * The temp copy is independent — if the library writes to it, the original is not affected.
   */
  withTempCopy<T>(id: FileEntryId, fn: (tempPath: string) => Promise<T>): Promise<T>

  // ─── System ───

  /** Open with the system default application. */
  open(id: FileEntryId): Promise<void>

  /** Reveal in the system file manager. */
  showInFolder(id: FileEntryId): Promise<void>
}
