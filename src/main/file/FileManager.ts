/**
 * FileManager — contract surface for the planned sole public entry point for
 * all file operations.
 *
 * Phase status:
 * - **Current phase**: this file is contract-first. It exports the public
 *   types, method signatures, and architectural JSDoc that later phases must
 *   implement.
 * - **Planned Phase 1b+**: a concrete `FileManager extends BaseService`
 *   lifecycle service will live here, be registered in `serviceRegistry.ts`,
 *   and be resolved at runtime via `application.get('FileManager')`.
 *
 * Every FileEntry has an `origin`:
 * - `internal`: Cherry owns the content (stored at `{userData}/files/{id}.{ext}`)
 * - `external`: Cherry references a user-provided absolute path
 *
 * ## Facade pattern
 *
 * In the target implementation, FileManager is a **thin facade** — it exposes
 * the public IPC-backed API and delegates every method to pure-function
 * modules under `./internal/*`. The concrete class will only own:
 * - lifecycle (`onInit` / `onStop`; IPC handler registration via `BaseService`)
 * - `versionCache` (LRU backing `writeIfUnchanged` / `getVersion`)
 * - `FileHandle.kind` dispatch at the IPC boundary
 *
 * In the target implementation, external Main callers will go through the
 * lifecycle-managed singleton via `application.get('FileManager')`. This
 * module currently exposes the type surface only; `internal/*` remains a
 * private implementation area and is not re-exported via `src/main/file/index.ts`.
 *
 * See `docs/references/file/file-manager-architecture.md §1.6` for the full
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
 * not business orchestration. In the planned lifecycle implementation,
 * `FileManager.onInit()` will register handlers with the private
 * `dispatchHandle` helper:
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
 * See `docs/references/file/file-manager-architecture.md §1.6.5` for the
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
 * - [file-manager-architecture.md](../../../docs/references/file/file-manager-architecture.md)
 * - [architecture.md](../../../docs/references/file/architecture.md)
 *
 * Cherry **allows** user-initiated modification of external files:
 * - `write` / `writeIfUnchanged` → atomic write to `externalPath`
 * - `rename` → `fs.rename` + update DB
 *
 * Cherry **never** modifies external files automatically. Specifically:
 * - No watcher-driven writebacks
 * - No background sync
 * - No tracking of external rename/move
 * - `permanentDelete` on an external file_entry removes only the DB row — this
 *   entry-level operation is deliberately decoupled from physical deletion.
 *   Path-level deletion remains available via unmanaged `ops.remove(path)`,
 *   which is an explicit user-facing operation not tied to any entry id.
 *
 * **External entries cannot be trashed.** Their lifecycle is monotonic:
 * created by `ensureExternalEntry` (pure upsert keyed by path — see below),
 * updated in place via `write` / `rename` / `refreshMetadata`, and removed
 * only by an explicit (non-UI) `permanentDelete`. The `fe_external_no_trash`
 * CHECK constraint enforces this at the DB level; `trash` / `restore` on an
 * external entry id will throw.
 *
 * `ensureExternalEntry` is a pure upsert on the `externalPath` global unique
 * index: existing entry at the same path is reused (snapshot refreshed via
 * stat); otherwise a new row is inserted. No "restore trashed" branch — trashed
 * external entries cannot exist.
 *
 * Dangling state is tracked by the file_module's `DanglingCache` singleton,
 * not by FileManager itself. FileManager ops update the cache as a side effect
 * of successful/failed stats.
 */

import type { Readable, Writable } from 'node:stream'

import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type {
  BatchOperationResult,
  CreateInternalEntryIpcParams,
  EnsureExternalEntryIpcParams,
  PhysicalFileMetadata
} from '@shared/file/types'

// Main-side parameter types are structurally identical to the IPC variants —
// `CreateInternalEntryIpcParams` is a discriminated union on `source`
// (`'path' | 'url' | 'base64' | 'bytes'`) that type-gates which of
// `name`/`ext` each source may pass (see ipc.ts JSDoc).
// Re-exported under shorter names for Main callers.
export type CreateInternalEntryParams = CreateInternalEntryIpcParams
export type EnsureExternalEntryParams = EnsureExternalEntryIpcParams

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
  // - `ensureExternalEntry` is pure upsert keyed by `externalPath` — idempotent
  //
  // The original `createEntry({ origin })` umbrella was intentionally split
  // to keep the public API's name match the actual semantics; see ADR / PR
  // #13451 review response (A-7).

  /**
   * Create a new Cherry-owned (internal) FileEntry.
   *
   * `params` is a `source`-discriminated union (`'path' | 'url' | 'base64' | 'bytes'`)
   * that type-gates which of `name`/`ext` each content source may supply —
   * fields derivable from the source are **absent** from the branch; only
   * non-derivable fields (e.g. `name` for base64 / bytes, `ext` for bytes) are
   * exposed. See `@shared/file/types/ipc.ts` for the full matrix and
   * `v2-refactor-temp/docs/file-manager/file-arch-problems-response.md` (A-7
   * extension) for the decision rationale.
   *
   * FileManager resolves the derived fields, writes bytes to
   * `{userData}/files/{newUuid}.{ext}`, and inserts a fresh DB row. No conflict
   * resolution — every call produces an independent entry.
   */
  createInternalEntry(params: CreateInternalEntryParams): Promise<FileEntry>

  /**
   * Ensure an entry exists for a user-provided absolute path.
   *
   * Pure upsert keyed by `externalPath`:
   * - Existing entry with same path → return it (snapshot refreshed via stat)
   * - No existing entry → insert a new row
   *
   * The global unique index `UNIQUE(externalPath)` (internal rows have
   * `externalPath = null` and are exempt — SQLite treats NULLs as distinct)
   * guarantees at most one row per path. External entries cannot be trashed
   * (`fe_external_no_trash` CHECK), so no "restore" branch is possible.
   * Repeated calls with the same path are safe and idempotent.
   */
  ensureExternalEntry(params: EnsureExternalEntryParams): Promise<FileEntry>

  /** Batch version of `createInternalEntry`. Each item produces an independent new entry. */
  batchCreateInternalEntries(items: CreateInternalEntryParams[]): Promise<BatchOperationResult>

  /**
   * Batch version of `ensureExternalEntry`. Within-batch path duplicates are
   * coalesced to a single entry in the result (the second occurrence reuses
   * the just-inserted row).
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

  /**
   * Move entry to Trash (soft delete via `trashedAt`). Internal-only.
   *
   * Passing an external entry id throws: external entries cannot be trashed
   * (enforced by the `fe_external_no_trash` CHECK constraint). Business layers
   * should call `permanentDelete` on external entries if the user really wants
   * the reference gone.
   */
  trash(id: FileEntryId): Promise<void>

  /**
   * Restore entry from Trash (`trashedAt = null`). Internal-only — external
   * entries are never trashed, so passing one throws (the entry is already
   * active by definition).
   */
  restore(id: FileEntryId): Promise<FileEntry>

  /**
   * Permanently delete entry. DB row is always removed; FS behavior depends on origin:
   * - internal: unlinks `{userData}/files/{id}.{ext}`
   * - external: **DB-only** — the user's physical file is left untouched.
   *   Entry-level deletion is deliberately decoupled from physical deletion;
   *   callers that want to also delete the file on disk should invoke the
   *   path-level `ops.remove(path)` (unmanaged FileHandle) separately.
   *
   * For internal, failure to unlink (file already missing, permission denied)
   * is logged but does not block DB deletion — we prefer DB-FS convergence to
   * "both gone".
   */
  permanentDelete(id: FileEntryId): Promise<void>

  /** Batch internal-only — external ids in the batch will fail with the same error as `trash`. */
  batchTrash(ids: FileEntryId[]): Promise<BatchOperationResult>
  /** Batch internal-only — external ids fail like `restore`. */
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
