/**
 * FileManager — sole public entry point for all file operations.
 *
 * Registered as a lifecycle service (`@Injectable('FileManager')`,
 * `@ServicePhase(Phase.WhenReady)`); resolved at runtime via
 * `application.get('FileManager')`.
 *
 * Every FileEntry has an `origin`:
 * - `internal`: Cherry owns the content (stored at `{userData}/Data/Files/{id}.{ext}`)
 * - `external`: Cherry references a user-provided absolute path
 *
 * ## Facade pattern
 *
 * FileManager is a **thin facade** — it exposes the public IPC-backed API and
 * delegates every method to pure-function modules under `./internal/*`. The
 * class only owns:
 * - lifecycle (`onInit` / `onStop`; IPC handler registration via `BaseService`)
 * - per-instance `versionCache` (LRU backing `writeIfUnchanged` / `getVersion`)
 * - `FileHandle.kind` dispatch at the IPC boundary
 *
 * External Main callers go through the lifecycle-managed singleton via
 * `application.get('FileManager')`. The `internal/*` tree is a private
 * implementation area and is not re-exported via `src/main/services/file/index.ts`.
 *
 * See `docs/references/file/file-manager-architecture.md §1.6` for the full
 * implementation-layout decision.
 *
 * ## FileHandle dispatch at the IPC boundary
 *
 * FileManager's public API (below) is **entry-native** — every method takes a
 * `FileEntryId`. Main-side business services call it directly without having
 * to wrap ids in a handle.
 *
 * At the IPC boundary, the renderer speaks `FileHandle` (a tagged union whose
 * variants select the *reference form* — `FileEntryHandle` routes through the
 * entry system, `FilePathHandle` hits `@main/utils/file/*` directly). Dispatching on
 * `handle.kind` is treated as the IPC adapter's legitimate responsibility
 * (translating request shape), not business orchestration. The IPC adapter
 * uses the private `dispatchHandle` helper:
 *
 * - `{ kind: 'entry', entryId }` → the corresponding FileManager public
 *   method (e.g. `this.read(entryId, opts)`)
 * - `{ kind: 'path', path }`     → the `*ByPath` variant exported from
 *   `internal/*` (e.g. `contentRead.readByPath(deps, path, opts)`)
 *
 * `*ByPath` variants are not exposed on the FileManager class — Main-side
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
 *   Path-level deletion remains available via `remove(path)` from
 *   `@main/utils/file/fs` (reached through a `FilePathHandle`), which is an
 *   explicit user-facing operation not tied to any entry id.
 *
 * **External entries cannot be trashed.** Their lifecycle is monotonic:
 * created by `ensureExternalEntry` (pure upsert keyed by path — see below),
 * updated in place via `write` / `rename`, and removed only by an explicit
 * (non-UI) `permanentDelete`. The `fe_external_no_trash` CHECK constraint
 * enforces this at the DB level; `trash` / `restore` on an external entry id
 * will throw.
 *
 * `ensureExternalEntry` is a pure upsert on the `externalPath` global unique
 * index: existing entry at the same path is reused; otherwise a new row is
 * inserted. No "restore trashed" branch — trashed external entries cannot
 * exist. External rows carry no stored `size` (always `null`); consumers
 * needing a live value call `getMetadata(id)`.
 *
 * Dangling state is tracked by the file_module's `DanglingCache` singleton,
 * not by FileManager itself. FileManager ops update the cache as a side effect
 * of successful/failed stats.
 */

import { createReadStream as nodeCreateReadStream } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'

import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { orphanCheckerRegistry } from '@data/services/orphan/FileRefCheckerRegistry'
import { canonicalizeExternalPath, resolvePhysicalPath } from '@data/utils/pathResolver'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { stat as fsStat } from '@main/utils/file/fs'
import type { DanglingState, FileEntry, FileEntryId } from '@shared/data/types/file'
import type {
  BatchOperationResult,
  CreateInternalEntryIpcParams,
  EnsureExternalEntryIpcParams,
  FilePath,
  FileURLString,
  PhysicalFileMetadata
} from '@shared/file/types'
import { IpcChannel } from '@shared/IpcChannel'
import mime from 'mime'

import { danglingCache } from './danglingCache'
import { hash as internalHash } from './internal/content/hash'
import { read as internalRead } from './internal/content/read'
import {
  createWriteStream as internalCreateWriteStream,
  write as internalWrite,
  writeIfUnchanged as internalWriteIfUnchanged
} from './internal/content/write'
import type { FileManagerDeps } from './internal/deps'
import { copy as internalCopy } from './internal/entry/copy'
import {
  createInternal as internalCreateInternal,
  ensureExternal as internalEnsureExternal
} from './internal/entry/create'
import {
  batchPermanentDelete as internalBatchPermanentDelete,
  batchRestore as internalBatchRestore,
  batchTrash as internalBatchTrash,
  permanentDelete as internalPermanentDelete,
  restore as internalRestore,
  trash as internalTrash
} from './internal/entry/lifecycle'
import { rename as internalRename } from './internal/entry/rename'
import { observeExternalAccess } from './internal/observe'
import { type DbSweepReport, type OrphanReport, runDbSweep, runStartupFileSweep } from './internal/orphanSweep'
import { open as internalShellOpen, showInFolder as internalShellShowInFolder } from './internal/system/shell'
import { withTempCopy as internalWithTempCopy } from './internal/system/tempCopy'
import { createVersionCacheImpl, type VersionCache } from './versionCache'

const fileManagerLogger = loggerService.withContext('FileManager')

// Main-side parameter types are structurally identical to the IPC variants —
// `CreateInternalEntryIpcParams` is a discriminated union on `source`
// (`'path' | 'url' | 'base64' | 'bytes'`) that type-gates which of
// `name`/`ext` each source may pass (see ipc.ts JSDoc).
// Re-exported under shorter names for Main callers.
export type CreateInternalEntryParams = CreateInternalEntryIpcParams
export type EnsureExternalEntryParams = EnsureExternalEntryIpcParams

// ─── Version types ───

/**
 * Best-effort identity of a file's current on-disk state, captured from
 * `fs.stat`.
 *
 * ## Precision caveat
 *
 * `mtime` resolution is **filesystem-dependent**:
 * - APFS / ext4 / NTFS (local) — typically nanosecond / millisecond precision
 * - FAT32 / exFAT / SMB / NFS — **second-precision** (any sub-second change is
 *   invisible to `mtime` alone)
 *
 * Combined with a same-size edit, a second-precision `FileVersion` comparison
 * can **silently mis-identify two different files as equal**. `writeIfUnchanged`
 * would then run over "stale" data without tripping `StaleVersionError`.
 *
 * ## Opt-in hash fallback
 *
 * `writeIfUnchanged` accepts an optional `expectedContentHash` (xxhash-h64 hex
 * of the content the caller last observed). When supplied AND the observed
 * mtime is ambiguous (ms === 0 AND size matches), the implementation re-hashes
 * the file on disk and throws `StaleVersionError` on mismatch. When omitted
 * (the default), `writeIfUnchanged` proceeds optimistically under reduced
 * mtime precision — the same behavior as on sub-second filesystems.
 *
 * `FileVersion` itself intentionally excludes the hash: the hot path
 * (read → sub-second-precision compare) should not pay for hash computation,
 * and `createReadStream` cannot produce a hash without breaking its lazy
 * pipeline. Callers that need strict OCC on second-precision filesystems
 * compute and supply the hash per-call.
 */
export interface FileVersion {
  /** ms epoch (may be truncated to whole seconds on FAT/SMB/NFS — see caveat above) */
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

/**
 * Atomic write stream: buffered to a tmp file until `.end()` commits the write
 * by renaming the tmp file onto the target path.
 *
 * ## Lifecycle
 *
 * - `.write(chunk)` — buffers to the tmp file. Honors Node's standard
 *   back-pressure semantics (return value `false` = pause until `'drain'`).
 * - `.end(chunk?)` — finalises the tmp file, fsyncs, then `rename(tmp → target)`.
 *   On success emits `'finish'`; on failure emits `'error'` after attempting
 *   to unlink the tmp file. This is the **commit path** — no rename happens
 *   on any other terminal transition.
 * - `.destroy(err?)` — abnormal termination (Node stream convention). The
 *   implementation treats this the same as `.abort()` + error propagation:
 *   no rename, tmp file is unlinked best-effort.
 * - `.abort()` — explicit cancel. Unlinks the tmp file and resolves once
 *   cleanup completes. Idempotent. Preferred over `.destroy()` when the
 *   caller wants to discard the write deliberately (e.g. validation failed)
 *   — `.abort()` returns a promise that awaits the unlink, while `.destroy()`
 *   follows the fire-and-forget Node convention.
 *
 * The only way to commit is `.end()`. `.abort()`, `.destroy()`, GC-collection,
 * process exit — all result in **no** rename onto the target path.
 */
export interface AtomicWriteStream extends Writable {
  /** Cancel the write; unlink the tmp file. Idempotent; awaitable. */
  abort(): Promise<void>
}

// ─── Errors ───

/**
 * Thrown by `writeIfUnchanged` when the current file version does not match the
 * caller's expected version. Caller should refresh or present a conflict UX.
 *
 * Note: the Phase 1b.2 implementation uses the xxhash-h64 fallback path
 * described on `FileVersion` when mtime resolution is ambiguous — a
 * `StaleVersionError` under that branch means the hash also diverged, i.e.
 * the content genuinely differs even when `(mtime, size)` looked equal.
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
  // The two methods are kept separate (rather than a single
  // `createEntry({ origin })` umbrella) so the public API's name matches the
  // actual semantics per origin.

  /**
   * Create a new Cherry-owned (internal) FileEntry.
   *
   * `params` is a `source`-discriminated union (`'path' | 'url' | 'base64' | 'bytes'`)
   * that type-gates which of `name`/`ext` each content source may supply —
   * fields derivable from the source are **absent** from the branch; only
   * non-derivable fields (e.g. `name` for base64 / bytes, `ext` for bytes) are
   * exposed. See `@shared/file/types/ipc.ts` for the full matrix.
   *
   * FileManager resolves the derived fields, writes bytes to
   * `{userData}/Data/Files/{newUuid}.{ext}`, and inserts a fresh DB row. No
   * conflict resolution — every call produces an independent entry.
   */
  createInternalEntry(params: CreateInternalEntryParams): Promise<FileEntry>

  /**
   * Ensure an entry exists for a user-provided absolute path.
   *
   * Pure upsert keyed by `externalPath`:
   * - Existing entry with same path → return it as-is. `name` / `ext` are
   *   projections of `externalPath` and do not drift; `size` is not stored
   *   for external entries (always `null` — live values come from
   *   `getMetadata`), so there is nothing to refresh on the row.
   * - No existing entry → insert a new row (after a one-shot `fs.stat` to
   *   verify the path exists and populate DanglingCache).
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

  /**
   * Get live physical file metadata (always via `fs.stat`).
   *
   * This is the canonical way to obtain a fresh `size` / `mtime` for an
   * external entry, since external rows carry no stored `size`. For internal
   * entries the returned `size` agrees with `FileEntry.size` by construction
   * (atomic writes keep DB and FS in sync).
   *
   * Side effect: updates DanglingCache based on stat outcome (external only).
   */
  getMetadata(id: FileEntryId): Promise<PhysicalFileMetadata>

  // ─── Version / Hash ───

  /** Get FileVersion (stat-based) — live for both origins. */
  getVersion(id: FileEntryId): Promise<FileVersion>

  /** Compute xxhash-h64 of file content. Reads full file. */
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
   *
   * `expectedContentHash` is optional. When supplied AND the observed mtime
   * is second-precision-ambiguous (ms === 0 AND size matches), the
   * implementation re-hashes the file on disk and throws `StaleVersionError`
   * on mismatch — guarding against same-size edits on FAT32 / SMB / NFS.
   * See `FileVersion` JSDoc for details.
   */
  writeIfUnchanged(
    id: FileEntryId,
    data: string | Uint8Array,
    expectedVersion: FileVersion,
    expectedContentHash?: string
  ): Promise<FileVersion>

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
   *   path-level `remove(path)` from `@main/utils/file/fs` (via a
   *   `FilePathHandle`) separately.
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

// ─── Runtime ───

/**
 * Lifecycle-managed FileManager singleton.
 *
 * Phase 1b.2 implements the full read + write surface — every IFileManager
 * method delegates to a pure function under `./internal/*` taking the deps
 * bundle this class owns.
 *
 * Internal ops live as pure functions under `./internal/*` and receive a
 * `FileManagerDeps` bundle. The class owns lifecycle (BaseService) and
 * delegates per public method.
 *
 * Access via `application.get('FileManager')`. Direct construction is
 * reserved for tests; production code MUST go through the container.
 */
@Injectable('FileManager')
@ServicePhase(Phase.WhenReady)
export class FileManager extends BaseService {
  // Per-instance VersionCache so each `new FileManager()` (e.g. in tests) gets
  // a fresh cache — file-manager-architecture.md §1.6.1 / §12 mandate this is
  // a class private field, not a module singleton, for test-isolation reasons.
  private readonly _versionCache: VersionCache = createVersionCacheImpl(2000)

  private readonly deps: FileManagerDeps = {
    fileEntryService,
    fileRefService,
    danglingCache,
    versionCache: this._versionCache,
    orphanRegistry: orphanCheckerRegistry
  }

  /**
   * Most recent DbSweepReport produced by `runStartupSweeps`. Captured with
   * its completion timestamp into `lastDbSweepRanAt` so `getOrphanReport()`
   * can answer "when did the last scan run" — not "when did the renderer
   * last poll".
   */
  private lastDbSweepReport: DbSweepReport | null = null
  private lastDbSweepRanAt: number | null = null

  protected override async onInit(): Promise<void> {
    await this.deps.danglingCache.initFromDb()
    this.ipcHandle(IpcChannel.File_GetDanglingState, (_e, params: { id: FileEntryId }) => this.getDanglingState(params))
    this.ipcHandle(IpcChannel.File_BatchGetDanglingStates, (_e, params: { ids: FileEntryId[] }) =>
      this.batchGetDanglingStates(params)
    )
    void this.runStartupSweeps()
  }

  /**
   * Run both the FS-level orphan sweep (file-manager-architecture §10) and
   * the DB-level orphan-ref/entry sweep (file-manager-architecture §7 Layer 3)
   * concurrently, returning once both
   * settle. The fire-and-forget call site in `onInit` (line above) is what
   * keeps the ready signal unblocked — this method itself awaits both
   * branches so tests and explicit callers can deterministically observe
   * the side effects (e.g. `await fm.runStartupSweeps()`).
   *
   * Both branches absorb their own errors via inner try/catch (returning a
   * `'failed'` report); the outer `.catch()` here is a belt-and-suspenders
   * fallback for synchronous throws in dep wiring (e.g. registry property
   * access racing with service shutdown).
   */
  async runStartupSweeps(): Promise<void> {
    await Promise.all([
      runStartupFileSweep({ fileEntryService: this.deps.fileEntryService }).catch((err) => {
        fileManagerLogger.error('Startup file sweep failed', err)
      }),
      runDbSweep({
        fileEntryService: this.deps.fileEntryService,
        fileRefService: this.deps.fileRefService,
        registry: this.deps.orphanRegistry
      })
        .then((report) => {
          this.lastDbSweepReport = report
          this.lastDbSweepRanAt = Date.now()
        })
        .catch((err) => {
          fileManagerLogger.error('DB orphan sweep failed', err)
        })
    ])
  }

  /**
   * The most recent DbSweepReport projection, or an empty default before
   * the first sweep completes. Cleanup UI consumes this to surface orphan
   * refs (already deleted by the sweep) and orphan entries (preserved per
   * architecture §7.1; user decides).
   *
   * `lastRunAt` is the **sweep completion** timestamp, not the call time —
   * UI surfaces like "last scanned at HH:MM" can render this directly.
   * Null until the first sweep settles.
   */
  getOrphanReport(): OrphanReport {
    if (!this.lastDbSweepReport) {
      return {
        orphanRefsByType: {},
        orphanRefsTotal: 0,
        orphanEntriesByOrigin: {},
        orphanEntriesTotal: 0,
        lastRunAt: null
      }
    }
    return {
      orphanRefsByType: this.lastDbSweepReport.orphanRefsByType,
      orphanRefsTotal: this.lastDbSweepReport.orphanRefsTotal,
      orphanEntriesByOrigin: this.lastDbSweepReport.orphanEntriesByOrigin,
      orphanEntriesTotal: this.lastDbSweepReport.orphanEntriesTotal,
      lastRunAt: this.lastDbSweepRanAt
    }
  }

  // ─── Entry queries ───

  async getById(id: FileEntryId): Promise<FileEntry> {
    return this.deps.fileEntryService.getById(id)
  }

  async findById(id: FileEntryId): Promise<FileEntry | null> {
    return this.deps.fileEntryService.findById(id)
  }

  async findByExternalPath(rawPath: string): Promise<FileEntry | null> {
    return this.deps.fileEntryService.findByExternalPath(canonicalizeExternalPath(rawPath))
  }

  async ensureExternalEntry(params: EnsureExternalEntryParams): Promise<FileEntry> {
    return internalEnsureExternal(this.deps, params)
  }

  // ─── Read ───

  read(id: FileEntryId, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<ReadResult<string>>
  read(id: FileEntryId, options: { encoding: 'base64' }): Promise<ReadResult<string>>
  read(id: FileEntryId, options: { encoding: 'binary' }): Promise<ReadResult<Uint8Array>>
  async read(
    id: FileEntryId,
    options?: { encoding?: 'text' | 'base64' | 'binary'; detectEncoding?: boolean }
  ): Promise<ReadResult<string | Uint8Array>> {
    // Single overload-erasing call site keeps the dispatcher simple; the public
    // overloads above narrow the return type for type-safe call sites.
    return internalRead(this.deps, id, options as { encoding?: 'text' })
  }

  /**
   * Phase 1b.1 returns the structural shape with `type: 'other'` for files
   * (regardless of ext). Per-kind enrichment — image width/height, PDF
   * pageCount, text encoding — lands in Phase 1b.2 alongside the full write
   * path; renderer call sites that need those fields are expected to handle
   * them as 1b.2-deliverable.
   */
  async getMetadata(id: FileEntryId): Promise<PhysicalFileMetadata> {
    const entry = await this.deps.fileEntryService.getById(id)
    const physicalPath = resolvePhysicalPath(entry)
    const s = await observeExternalAccess(this.deps, entry, physicalPath, () => fsStat(physicalPath))
    if (s.isDirectory) {
      return {
        kind: 'directory',
        size: s.size,
        createdAt: s.createdAt || s.modifiedAt,
        modifiedAt: s.modifiedAt
      }
    }
    const ext = entry.ext
    const inferredMime = ext ? (mime.getType(ext) ?? 'application/octet-stream') : 'application/octet-stream'
    return {
      kind: 'file',
      type: 'other',
      size: s.size,
      createdAt: s.createdAt || s.modifiedAt,
      modifiedAt: s.modifiedAt,
      mime: inferredMime
    }
  }

  async getVersion(id: FileEntryId): Promise<FileVersion> {
    const entry = await this.deps.fileEntryService.getById(id)
    const physicalPath = resolvePhysicalPath(entry)
    const s = await observeExternalAccess(this.deps, entry, physicalPath, () => fsStat(physicalPath))
    return { mtime: s.modifiedAt, size: s.size }
  }

  async getContentHash(id: FileEntryId): Promise<string> {
    return internalHash(this.deps, id)
  }

  async getUrl(id: FileEntryId): Promise<FileURLString> {
    const entry = await this.deps.fileEntryService.getById(id)
    const physicalPath = resolvePhysicalPath(entry)
    return pathToFileURL(physicalPath).toString() as FileURLString
  }

  async getPhysicalPath(id: FileEntryId): Promise<FilePath> {
    const entry = await this.deps.fileEntryService.getById(id)
    return resolvePhysicalPath(entry)
  }

  // ─── Mutation methods (Phase 1b.2) ───

  async createInternalEntry(params: CreateInternalEntryParams): Promise<FileEntry> {
    return internalCreateInternal(this.deps, params)
  }

  async batchCreateInternalEntries(items: CreateInternalEntryParams[]): Promise<BatchOperationResult> {
    return aggregateCreate(items, (p) => this.createInternalEntry(p))
  }

  async batchEnsureExternalEntries(items: EnsureExternalEntryParams[]): Promise<BatchOperationResult> {
    // Within-batch path duplicates resolve to the same entry per the public
    // contract; the second occurrence reuses the just-inserted row. The
    // canonical-path memoization here ensures both items end up in
    // `succeeded` even though only one DB insert happens.
    const seen = new Map<string, FileEntry>()
    const succeeded: FileEntryId[] = []
    const failed: BatchOperationResult['failed'] = []
    for (const params of items) {
      try {
        const canonical = canonicalizeExternalPath(params.externalPath)
        const cached = seen.get(canonical)
        const entry = cached ?? (await this.ensureExternalEntry(params))
        if (!cached) seen.set(canonical, entry)
        succeeded.push(entry.id)
      } catch (err) {
        failed.push({ sourceRef: params.externalPath, error: (err as Error).message })
      }
    }
    return { succeeded, failed }
  }

  async createReadStream(id: FileEntryId): Promise<Readable> {
    const entry = await this.deps.fileEntryService.getById(id)
    return nodeCreateReadStream(resolvePhysicalPath(entry))
  }

  async write(id: FileEntryId, data: string | Uint8Array): Promise<FileVersion> {
    return internalWrite(this.deps, id, data)
  }

  async writeIfUnchanged(
    id: FileEntryId,
    data: string | Uint8Array,
    expectedVersion: FileVersion,
    expectedContentHash?: string
  ): Promise<FileVersion> {
    return internalWriteIfUnchanged(this.deps, id, data, expectedVersion, expectedContentHash)
  }

  async createWriteStream(id: FileEntryId): Promise<AtomicWriteStream> {
    return internalCreateWriteStream(this.deps, id)
  }

  /** Alias kept for backwards compatibility; prefer `createWriteStream`. */
  async createAtomicWriteStream(id: FileEntryId): Promise<AtomicWriteStream> {
    return this.createWriteStream(id)
  }

  async trash(id: FileEntryId): Promise<void> {
    return internalTrash(this.deps, id)
  }

  async restore(id: FileEntryId): Promise<FileEntry> {
    return internalRestore(this.deps, id)
  }

  async permanentDelete(id: FileEntryId): Promise<void> {
    return internalPermanentDelete(this.deps, id)
  }

  async batchTrash(ids: FileEntryId[]): Promise<BatchOperationResult> {
    return internalBatchTrash(this.deps, ids)
  }

  async batchRestore(ids: FileEntryId[]): Promise<BatchOperationResult> {
    return internalBatchRestore(this.deps, ids)
  }

  async batchPermanentDelete(ids: FileEntryId[]): Promise<BatchOperationResult> {
    return internalBatchPermanentDelete(this.deps, ids)
  }

  async rename(id: FileEntryId, newName: string): Promise<FileEntry> {
    return internalRename(this.deps, id, newName)
  }

  async copy(params: { id: FileEntryId; newName?: string }): Promise<FileEntry> {
    return internalCopy(this.deps, params)
  }

  async withTempCopy<T>(id: FileEntryId, fn: (tempPath: string) => Promise<T>): Promise<T> {
    return internalWithTempCopy(this.deps, id, fn)
  }

  async open(id: FileEntryId): Promise<void> {
    const entry = await this.deps.fileEntryService.getById(id)
    return internalShellOpen(resolvePhysicalPath(entry))
  }

  async showInFolder(id: FileEntryId): Promise<void> {
    const entry = await this.deps.fileEntryService.getById(id)
    return internalShellShowInFolder(resolvePhysicalPath(entry))
  }

  // ─── Dangling state (Phase 1b.3) ───

  /**
   * Resolve the current `DanglingState` for an entry. Hot path: `'present'`
   * for any internal entry; cache hit for external; cold-stat fallback on
   * miss. Unknown ids resolve to `'unknown'`.
   */
  async getDanglingState(params: { id: FileEntryId }): Promise<DanglingState> {
    const entry = await this.deps.fileEntryService.findById(params.id)
    if (!entry) return 'unknown'
    return this.deps.danglingCache.check(entry)
  }

  /**
   * Subscribe to dangling state transitions for a specific entry. The
   * listener fires only on genuine transitions ('present' → 'missing' or
   * vice versa); same-state observations are silent. Returns a dispose
   * function. In-process only — renderer fan-out via the planned
   * `file-manager-event` IPC channel is deferred to Phase 2.
   */
  subscribeDangling(params: { id: FileEntryId }, listener: (state: 'present' | 'missing') => void): () => void {
    return this.deps.danglingCache.subscribe(params.id, (_id, state) => {
      if (state !== 'unknown') listener(state)
    })
  }

  /**
   * Batch form of `getDanglingState`. Each requested id appears in the result;
   * unknown ids map to `'unknown'`. Cache-hit entries return synchronously
   * (microtask); cache-miss external entries run a single parallel `fs.stat`.
   */
  async batchGetDanglingStates(params: { ids: FileEntryId[] }): Promise<Record<FileEntryId, DanglingState>> {
    const entries = await Promise.all(params.ids.map((id) => this.deps.fileEntryService.findById(id)))
    const pairs = await Promise.all(
      entries.map(async (entry, index) => {
        const id = params.ids[index]
        const state: DanglingState = entry ? await this.deps.danglingCache.check(entry) : 'unknown'
        return [id, state] as const
      })
    )
    return Object.fromEntries(pairs) as Record<FileEntryId, DanglingState>
  }
}

async function aggregateCreate<P>(
  items: readonly P[],
  op: (p: P) => Promise<FileEntry>
): Promise<BatchOperationResult> {
  const succeeded: FileEntryId[] = []
  const failed: BatchOperationResult['failed'] = []
  for (let i = 0; i < items.length; i++) {
    try {
      const entry = await op(items[i])
      succeeded.push(entry.id)
    } catch (err) {
      // No FileEntryId yet (insert never happened); report by input index so
      // callers can correlate with the original `items` array.
      failed.push({ sourceRef: `#${i}`, error: (err as Error).message })
    }
  }
  return { succeeded, failed }
}
