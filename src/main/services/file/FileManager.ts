/**
 * FileManager — public facade for entry-aware file operations.
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
 * FileManager is a **thin facade** — it exposes the public entry-native API and
 * delegates every method to pure-function modules under `./internal/*`. The
 * class only owns:
 * - lifecycle (`onInit` / `onStop`; remaining legacy IPC handlers via `BaseService`)
 * - per-instance `versionCache` (LRU backing `writeIfUnchanged` / `getVersion`)
 * - per-instance content-write lock shared by foreground writes and hash backfill
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
 * entry system, `FilePathHandle` routes through path-arm helpers under
 * `utils/*`). The IPC adapter dispatches on `handle.kind` via a
 * `dispatchHandle` helper, with the dispatch logic treated as the adapter's
 * legitimate responsibility (translating request shape), not business
 * orchestration.
 *
 * **Current status**: the IpcApi adapter in `src/main/ipc/handlers/file.ts`
 * dispatches read, metadata, open, show-in-folder, and optimistic-write
 * routes. Entry arms call FileManager; path arms call helpers under `utils/*`.
 *
 * - `{ kind: 'entry', entryId }` → the corresponding FileManager public
 *   method (e.g. `this.open(entryId)`)
 * - `{ kind: 'path', path }`     → the `*ByPath` variant in `utils/*`
 *   (e.g. `getMetadataByPath(path)`) or a narrow path helper such as `safeOpen`
 *
 * `*ByPath` variants are not exposed on the FileManager class — Main-side
 * callers use the documented `utils/*` path API directly when needed.
 *
 * New handle kinds (e.g. `virtual` for zip members) extend `dispatchHandle`
 * and each handler in `src/main/ipc/handlers/file.ts`; the public API surface
 * and `internal/*` pure-function structure both stay stable.
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
 *   general operation remains for internal cleanup and legacy callers.
 *   Path-level deletion remains available via `remove(path)` from
 *   `@main/utils/file/fs` (reached through a `FilePathHandle`), which is an
 *   explicit user-facing operation not tied to any entry id.
 * - User-facing removal goes through `batchRemoveFromLibrary`, which also
 *   verifies external origin and persistent-reference absence in the delete tx.
 *
 * **External entries cannot be trashed.** Their lifecycle is monotonic:
 * created by `ensureExternalEntry` (pure upsert keyed by path — see below),
 * updated in place via `write` / `rename`, and removed from the library by an
 * explicit protected action. The `fe_external_no_delete` CHECK constraint
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
 * not by FileManager itself. FileManager ops mutate the cache asymmetrically:
 *
 * - **Failed stat (ENOENT) on external** — commits `'missing'` through the
 *   `observeExternalAccess` chokepoint (`internal/observe.ts`). Covers read,
 *   getContentHash, getMetadata, getVersion; `createReadStream` mirrors the
 *   same transition through a `'error'` listener on the stream.
 * - **Successful create / ensureExternal / rename** — explicitly pushes
 *   `'present'` (via `addEntry` + `onFsEvent(..., 'present', 'ops')`) so the
 *   cache learns presence from the producer side.
 * - **Successful read / hash / stat** — does NOT touch the cache. The cache
 *   learns `'present'` from the watcher or from explicit ops-side writes,
 *   never from passive reads (see `observe.ts` semantics).
 *
 * Reading "ops update the cache on every stat" would suggest a symmetric
 * fresh-stat-flip-to-present rule, which would defeat the watcher-led
 * design. The asymmetry above is the actual contract.
 */

import { createReadStream as nodeCreateReadStream } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { loggerService } from '@logger'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { stat as fsStat } from '@main/utils/file'
import type { ContentHash, DanglingState, FileEntry, FileEntryId } from '@shared/data/types/file'
import { CleanupPolicySchema, FileEntryIdSchema } from '@shared/data/types/file'
import { type CreateInternalEntryInput, createInternalEntryInputSchema } from '@shared/ipc/schemas/file'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  AbsoluteFilePath,
  BatchCreateResult,
  BatchMutationResult,
  EnsureExternalEntryIpcParams,
  FileUrlString,
  PhysicalFileMetadata
} from '@shared/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { canonicalizeFilePath } from '@shared/utils/file'
import * as z from 'zod'

import { danglingCache } from './danglingCache'
import { hash as internalHash } from './internal/content/hash'
import { read as internalRead, readChunk as internalReadChunk } from './internal/content/read'
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
  batchPermanentDeleteFromTrash as internalBatchPermanentDeleteFromTrash,
  batchRemoveFromLibrary as internalBatchRemoveFromLibrary,
  batchRestore as internalBatchRestore,
  batchTrash as internalBatchTrash,
  permanentDelete as internalPermanentDelete,
  restore as internalRestore,
  trash as internalTrash
} from './internal/entry/lifecycle'
import { rename as internalRename } from './internal/entry/rename'
import type { EntryCleanupReport } from './internal/entryCleanup'
import { runEntryCleanup as internalRunEntryCleanup, summariseEntryCleanup } from './internal/entryCleanup'
import { observeExternalAccess } from './internal/observe'
import {
  type DbSweepReport,
  type FileSweepReport,
  inspectFileSweep,
  type OrphanReport,
  runDbSweep,
  runFileSweep
} from './internal/orphanSweep'
import { showInFolder as internalShellShowInFolder } from './internal/system/shell'
import { withTempCopy as internalWithTempCopy } from './internal/system/tempCopy'
import { safeOpen } from './system'
import { createContentHashBackfillJobHandler } from './tasks/contentHashBackfillJobHandler'
import { ensureContentMetadataGeneration } from './tasks/contentMetadataGeneration'
import { buildPhysicalFileMetadata } from './utils/metadata'
import { resolvePhysicalPath } from './utils/pathResolver'
import { createVersionCacheImpl, type VersionCache } from './versionCache'

const fileManagerLogger = loggerService.withContext('FileManager')

/**
 * Render a one-line description of a non-`'completed'` FS sweep outcome,
 * suitable for the `fsSweepIssue` field on a degraded `OrphanReport.partial`.
 * Returns `undefined` when the sweep ran clean (no degradation needed).
 */
function summariseFsSweepIssue(report: FileSweepReport): string | undefined {
  switch (report.outcome) {
    case 'completed':
      return undefined
    case 'partial':
      // First sample is enough to identify the failure class (e.g. EACCES on
      // <id>.txt); the full list lives in the FS sweep log line.
      return `FS sweep partial: ${report.failedDeleteCount} of ${report.plannedDeleteCount} unlinks failed${
        report.failedSamples.length > 0 ? ` (first: ${report.failedSamples[0]})` : ''
      }`
    case 'aborted':
      return report.abortReason === 'pending-restore'
        ? 'FS sweep stood aside: a staged backup restore is pending promotion'
        : `FS sweep aborted by safety threshold (${report.abortReason})`
    case 'failed':
      return `FS sweep failed: ${report.errorMessage}`
  }
}

/**
 * Whether a sweep earned the weekly interval before the next one may run.
 *
 * The floor prices the scan — `listAllIds()` plus a full `readdir` and per-file
 * `stat` of the Files tree — so the question is not "did it succeed" but **did
 * it actually pay that cost**. A pass that never looked at the tree has spent
 * nothing and must not spend the window either.
 *
 * - `completed` / `partial` — the tree was enumerated and the plan executed.
 *   `partial` counts: a stuck file (EACCES, EBUSY) does not get better by
 *   rescanning everything half an hour later, and treating it as retryable
 *   would turn one unlinkable blob into a full-tree scan every idle tick,
 *   forever. The next scheduled sweep retries it.
 * - `aborted` by a safety threshold — the tree *was* enumerated; refusing is
 *   the considered verdict of a completed plan phase, and the state it reads
 *   will not have changed by the next tick.
 * - `aborted` for `pending-restore` — returns before enumerating anything. A
 *   stand-aside is not a sweep. This is the case that made the bug visible:
 *   the first tick of a session correctly defers to a staged restore, and the
 *   previous session's crash orphans then wait a week past its completion.
 * - `failed` — the scan collapsed; nothing was reclaimed and the cause may be
 *   transient, so the next idle tick should try again.
 */
function sweepConsumedItsWindow(report: FileSweepReport): boolean {
  switch (report.outcome) {
    case 'completed':
    case 'partial':
      return true
    case 'aborted':
      return report.abortReason !== 'pending-restore'
    case 'failed':
      return false
  }
}

// Main consumes the schema-derived transport type so validation and the
// implementation cannot drift into accepting renderer-supplied metadata.
export type CreateInternalEntryParams = CreateInternalEntryInput
export type EnsureExternalEntryParams = EnsureExternalEntryIpcParams

// ─── File IPC input schemas ───

// Phase 2 schemas — reuse the canonical essential.ts validators so the IPC
// boundary is the gate (path-traversal / null bytes / whitespace-only names
// rejected here, before downstream factories see them).
export const EnsureExternalEntryIpcSchema = z.strictObject({
  externalPath: AbsoluteFilePathSchema,
  cleanupPolicy: CleanupPolicySchema
})

export const GetPhysicalPathIpcSchema = z.strictObject({ id: FileEntryIdSchema })

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
 * `writeIfUnchanged` accepts an optional algorithm-tagged `expectedContentHash`
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
  /** True after the prepared tmp file enters the non-abortable commit phase. */
  readonly commitStarted: boolean
  /** Cancel the write; unlink the tmp file. Idempotent; awaitable. */
  abort(): Promise<void>
}

// ─── Errors ───

/**
 * Thrown by `writeIfUnchanged` when the current file version does not match the
 * caller's expected version. Caller should refresh or present a conflict UX.
 *
 * Note: this implementation uses the tagged XXH3-64 fallback path described on
 * `FileVersion` when mtime resolution is ambiguous — a `StaleVersionError`
 * under that branch means the hash also diverged, i.e. the content genuinely
 * differs even when `(mtime, size)` looked equal.
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

/**
 * The atomic rename committed new bytes, but the DB metadata finalize step
 * failed. Callers must refresh instead of retrying blindly; the NULL hash is
 * the durable recovery marker consumed by the startup reconciliation job.
 */
export class ContentCommittedMetadataPendingError extends Error {
  constructor(
    public readonly entryId: FileEntryId,
    public readonly version: FileVersion,
    options?: { cause?: unknown }
  ) {
    super(`Entry ${entryId} content committed but metadata is pending recovery`, options)
    this.name = 'ContentCommittedMetadataPendingError'
  }
}

// ─── IFileManager ───

/**
 * Public surface of `FileManager` for Main-side business services and the
 * entry arms of the File IPC adapter. The class below declares `implements IFileManager`
 * so a method declared here but missing on the class (or mis-typed) is a
 * compile error.
 *
 * ## What's in vs. out of this interface
 *
 * **In** — methods consumers should hold against:
 *   - Entry lifecycle (`createInternalEntry`, `ensureExternalEntry`,
 *     `trash`/`restore`/`permanentDelete`, batch variants)
 *   - Content (`read`/`write`/`writeIfUnchanged`/`createReadStream`/
 *     `createWriteStream`/`createAtomicWriteStream`/`copy`/`rename`)
 *   - Metadata / version / hash / URL / physical path resolution
 *   - DanglingCache surface (`getDanglingState` /
 *     `batchGetDanglingStates` / `subscribeDangling`)
 *   - Orphan sweep — scheduled FS half (`fileSweepTick`) + on-demand report (`runSweep`)
 *   - 3rd-party escape hatch (`withTempCopy`), `open` / `showInFolder`
 *
 * **Out** — kept on the class but **not** in the interface:
 *   - DB-pass-through queries (`getById` / `findById` / `findByExternalPath`).
 *     These are convenience accessors for tests and a few internal sites; the
 *     authoritative read surface is `fileEntryService` directly. Adding them
 *     to the interface would expose persistence concerns business code
 *     should not depend on.
 *
 * If a new "consumer-facing" method lands on the class, add it to this
 * interface in the same PR; the `implements` clause will fail the build
 * otherwise.
 */
export interface IFileManager {
  /** Return active internal entries matching a content hash; consumers choose whether to reuse one. */
  findInternalByContentHash(contentHash: ContentHash): Promise<FileEntry[]>

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
   * exposed. See `@shared/types/file/ipc.ts` for the full matrix.
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
   * (`fe_external_no_delete` CHECK), so no "restore" branch is possible.
   * Repeated calls with the same path are safe and idempotent.
   */
  ensureExternalEntry(params: EnsureExternalEntryParams): Promise<FileEntry>

  /** Batch version of `createInternalEntry`. Each item produces an independent new entry. */
  batchCreateInternalEntries(items: CreateInternalEntryParams[]): Promise<BatchCreateResult>

  /**
   * Batch version of `ensureExternalEntry`. Within-batch path duplicates are
   * coalesced to a single entry in the result (the second occurrence reuses
   * the just-inserted row).
   */
  batchEnsureExternalEntries(items: EnsureExternalEntryParams[]): Promise<BatchCreateResult>

  // ─── Reading ───

  /** Read file content as text (default). */
  read(id: FileEntryId, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<ReadResult<string>>
  /** Read file content as base64 string with detected mime. */
  read(id: FileEntryId, options: { encoding: 'base64' }): Promise<ReadResult<string>>
  /** Read file content as binary. */
  read(id: FileEntryId, options: { encoding: 'binary' }): Promise<ReadResult<Uint8Array>>

  /** Read a byte range without loading the complete file. */
  readChunk(id: FileEntryId, offset: number, length: number): Promise<ReadResult<Uint8Array>>

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

  /** Compute an algorithm-tagged xxh3-64 hash of file content. Reads full file. */
  getContentHash(id: FileEntryId): Promise<ContentHash>

  // ─── Writing ───

  /**
   * Unconditional write.
   * - internal: atomic write to `{userData}/Data/Files/{id}.{ext}`
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
    expectedContentHash?: ContentHash
  ): Promise<FileVersion>

  /** Stream write with atomic commit (tmp + rename during `.end()`). Works for both origins. */
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
   * Move entry to Trash (soft delete via `deletedAt`). Internal-only.
   *
   * Passing an external entry id throws: external entries cannot be trashed
   * (enforced by the `fe_external_no_delete` CHECK constraint). Business layers
   * should call `batchRemoveFromLibrary` for a user-requested external entry
   * removal.
   */
  trash(id: FileEntryId): Promise<void>

  /**
   * Restore entry from Trash (`deletedAt = null`). Internal-only — external
   * entries are never trashed, so passing one throws (the entry is already
   * active by definition).
   */
  restore(id: FileEntryId): Promise<FileEntry>

  /**
   * General cleanup/compensation primitive. DB row is always removed without
   * user-action trash/reference guards; FS behavior depends on origin:
   * - internal: unlinks `{userData}/Data/Files/{id}.{ext}`
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
  batchTrash(ids: FileEntryId[]): Promise<BatchMutationResult>
  /** Batch internal-only — external ids fail like `restore`. */
  batchRestore(ids: FileEntryId[]): Promise<BatchMutationResult>
  /** Permanently delete unreferenced internal entries that are currently in Trash. */
  batchPermanentDeleteFromTrash(ids: FileEntryId[]): Promise<BatchMutationResult>
  /** Remove unreferenced external entries from the library without modifying user files. */
  batchRemoveFromLibrary(ids: FileEntryId[]): Promise<BatchMutationResult>

  // ─── Stream ───

  /** Read a file as a Node Readable stream. ENOENT on external propagates and flips DanglingCache. */
  createReadStream(id: FileEntryId): Promise<Readable>

  /**
   * Backwards-compatible alias for `createWriteStream` — accepts a
   * `FileEntryId` and returns the same atomic stream. Prefer
   * `createWriteStream` in new code.
   */
  createAtomicWriteStream(id: FileEntryId): Promise<AtomicWriteStream>

  // ─── Path / URL resolution ───

  /** Resolve an entry to its `file://` URL with the danger-file safety wrap. */
  getUrl(id: FileEntryId): FileUrlString

  /** Resolve an entry to its absolute filesystem path. */
  getPhysicalPath(id: FileEntryId): AbsoluteFilePath

  // ─── Dangling state ───

  /** Resolve the current `DanglingState` for an entry. Hot path; see `DanglingCache.check`. */
  getDanglingState(params: { id: FileEntryId }): Promise<DanglingState>

  /** Batch form of `getDanglingState` keyed by id. */
  batchGetDanglingStates(params: { ids: FileEntryId[] }): Promise<Record<FileEntryId, DanglingState>>

  /**
   * Subscribe to dangling-state transitions for a single entry. Pre-cursor to
   * the §3.6 broadcast pipeline; for now a Main-process consumer surface.
   * Returns an unsubscribe function. Same-state observations are silent;
   * only genuine `'present' ↔ 'missing'` transitions fire the listener.
   */
  subscribeDangling(params: { id: FileEntryId }, listener: (state: 'present' | 'missing') => void): () => void

  // ─── Orphan sweep ───

  /** Inspect the FS-level orphan plan without deleting files. */
  inspectOrphanFiles(): Promise<FileSweepReport>

  /** Run only the FS-level orphan-file cleanup pass. */
  cleanupOrphanFiles(): Promise<FileSweepReport>

  /**
   * Run the scan-based entry cleanup pass, then the FS-level orphan sweep
   * (architecture §10) and the DB-level zero-ref entry
   * report (§7 Layer 3) concurrently, returning a single `OrphanReport` once
   * all three settle. The `outcome` discriminator on the report distinguishes
   * `'completed'` / `'partial'` / `'failed'` so the renderer cannot read a
   * failed run as a healthy zero; the cleanup pass's own outcome rides in
   * `entryCleanup` without affecting the umbrella `outcome`.
   *
   * Caller-initiated maintenance via IPC (`File_RunSweep`), which no renderer
   * code calls today. Reclamation does not depend on it: the entry pass and the
   * FS sweep both run unattended from the idle tick (`entryCleanupTick` /
   * `fileSweepTick`). This method stays the on-demand "report everything"
   * entry point. See architecture §10 for the sweep mechanics.
   */
  runSweep(): Promise<OrphanReport>

  // ─── 3rd-party Library Escape Hatch ───

  /**
   * Copy file content to an isolated temp path, invoke `fn(tempPath)`, then delete the temp copy.
   * For libraries that only accept file paths (e.g. sharp, pdf-lib, officeparser, OpenAI uploads).
   * The temp copy is independent — if the library writes to it, the original is not affected.
   */
  withTempCopy<T>(id: FileEntryId, fn: (tempPath: string) => Promise<T>): Promise<T>

  // ─── System ───

  /** Open with the system default application. Unsafe executable/script types are blocked. */
  open(id: FileEntryId): Promise<void>

  /** Reveal in the system file manager. */
  showInFolder(id: FileEntryId): Promise<void>
}

// ─── Runtime ───

/**
 * Lifecycle-managed FileManager singleton.
 *
 * Every IFileManager method delegates to a pure function under `./internal/*`
 * taking the deps bundle this class owns.
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
@DependsOn(['PowerService', 'JobManager'])
export class FileManager extends BaseService implements IFileManager {
  // Per-instance VersionCache so each `new FileManager()` (e.g. in tests) gets
  // a fresh cache — file-manager-architecture.md §1.6.1 / §12 mandate this is
  // a class private field, not a module singleton, for test-isolation reasons.
  private readonly _versionCache: VersionCache = createVersionCacheImpl(2000)
  private readonly _contentWriteLock = new KeyedMutex()
  private readonly activeWriteStreams = new Set<AtomicWriteStream>()

  private readonly deps: FileManagerDeps = {
    fileEntryService,
    fileRefService,
    danglingCache,
    versionCache: this._versionCache,
    contentWriteLock: this._contentWriteLock
  }

  private readonly contentHashBackfillJobHandler = createContentHashBackfillJobHandler(this.deps)

  private static readonly CLEANUP_INTERVAL_MS = 30 * 60 * 1000
  private static readonly CLEANUP_IDLE_THRESHOLD_S = 60
  private static readonly CLEANUP_MAX_DEFER_MS = 2 * 60 * 60 * 1000
  /**
   * Floor between FS orphan sweeps. Far coarser than the entry-cleanup cadence:
   * an orphan blob needs a crash between row-delete and unlink, or an unlink that
   * fails outright — both rare — and it only ever costs disk, never correctness.
   * The sweep meanwhile pays a `listAllIds()` scan plus a `readdir` + per-file
   * `stat` of the whole Files tree.
   */
  private static readonly FILE_SWEEP_MIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

  private lastCleanupCompletedAt = 0
  private lastFileSweepAt = 0
  /**
   * Separate from `lastFileSweepAt` on purpose. The timestamp answers "when may
   * the next sweep run"; this answers "is one running right now". They used to
   * be the same field — stamping before the await made the interval double as a
   * concurrency guard, which is exactly what tied the retry cadence to a pass
   * that had not finished (let alone succeeded) yet.
   */
  private fileSweepInFlight = false

  protected override async onInit(): Promise<void> {
    const generation = ensureContentMetadataGeneration()
    if (generation.applied) {
      fileManagerLogger.info('content metadata generation applied', { invalidated: generation.invalidated })
    }
    await this.deps.danglingCache.initFromDb()
    this.registerIpcHandlers()
    application.get('JobManager').registerHandler('file.contenthash-backfill', this.contentHashBackfillJobHandler)

    // Previous-session backlog (crashed sends, pre-upgrade leaks) — ungated.
    void this.runEntryCleanup()
    this.registerInterval(() => this.entryCleanupTick(), FileManager.CLEANUP_INTERVAL_MS)
  }

  /** Run one cleanup pass now. Never throws — failures land in the report. */
  async runEntryCleanup(): Promise<EntryCleanupReport> {
    const report = await internalRunEntryCleanup(this.deps)
    if (report.outcome === 'completed') {
      this.lastCleanupCompletedAt = Date.now()
    }
    return report
  }

  /** Idle gate (spec §5.5): run only when idle ≥60s, with a 2h reliability floor. */
  private async entryCleanupTick(): Promise<void> {
    const idleSeconds = application.get('PowerService').getSystemIdleTime()
    const overdue = Date.now() - this.lastCleanupCompletedAt > FileManager.CLEANUP_MAX_DEFER_MS
    if (idleSeconds < FileManager.CLEANUP_IDLE_THRESHOLD_S && !overdue) return
    // Two independent GC mechanisms sharing one idle window, not a pipeline:
    // the entry pass reclaims rows (and their blobs), the file sweep reclaims
    // blobs whose row is already gone. Neither reads the other's output, so
    // they run concurrently. `runFileSweep` tolerates the overlap on its own —
    // its `listAllIds()` snapshot can go stale mid-run either way, and the
    // 5-minute mtime freshness gate is what actually protects a file the
    // snapshot never saw. The only cost of not serializing is latency: a blob
    // this very pass strands via `unlinkFailures` may sit in the snapshot as
    // still-referenced and wait for the next sweep. That is disk, not risk.
    await Promise.all([this.runEntryCleanup(), this.fileSweepTick()])
  }

  /**
   * Reclaim orphan blobs (spec §5.4/§6): internal files on disk whose row is
   * gone — left by a crash between the row delete and the unlink, or by an
   * unlink that failed outright (`unlinkFailures`).
   *
   * The cleanup pass above *manufactures* this class of orphan on every run, so
   * without a scheduled sweep those blobs leak permanently: `runSweep()` is the
   * only other caller and it is reachable solely through the `File_RunSweep`
   * IPC, which is exposed on preload but invoked by no renderer code and never
   * runs at startup.
   *
   * Rides the cleanup tick's idle gate rather than owning a timer, then applies
   * its own weekly floor. `lastFileSweepAt` starts at 0 so the first idle tick of
   * a session sweeps once — that is what collects the previous session's crash
   * orphans. Failures are swallowed here (already logged inside): a hygiene pass
   * must never break the entry cleanup it runs alongside.
   *
   * **A week is only spent on a pass that did the work.** The floor exists to
   * price the scan (`listAllIds()` + a full `readdir` + per-file `stat`), so it
   * may only be charged for a run that actually paid it — see
   * `sweepConsumedItsWindow`. Stamping up front instead made a stand-aside cost
   * as much as a full sweep: the first tick after startup correctly defers to a
   * pending restore, and then crash orphans sit untouched for seven days after
   * that restore completes.
   */
  private async fileSweepTick(): Promise<void> {
    if (this.fileSweepInFlight) return
    if (Date.now() - this.lastFileSweepAt < FileManager.FILE_SWEEP_MIN_INTERVAL_MS) return
    this.fileSweepInFlight = true
    try {
      const report = await runFileSweep({ fileEntryService: this.deps.fileEntryService })
      if (sweepConsumedItsWindow(report)) this.lastFileSweepAt = Date.now()
    } catch (err) {
      // A throw means the scan never returned a verdict, so the window stays
      // open and the next idle tick retries.
      fileManagerLogger.error('Scheduled file sweep failed', err as Error)
    } finally {
      this.fileSweepInFlight = false
    }
  }

  protected override onAllReady(): void {
    try {
      const pending = this.deps.fileEntryService.countInternalMissingContentHash()
      if (pending === 0) return
      application
        .get('JobManager')
        .enqueue('file.contenthash-backfill', {}, { idempotencyKey: 'file.contenthash-backfill' })
      fileManagerLogger.info('contentHash backfill: enqueued', { pending })
    } catch (err) {
      fileManagerLogger.warn('contentHash backfill: failed to enqueue at startup', { err })
    }
  }

  protected override async onStop(): Promise<void> {
    const streams = [...this.activeWriteStreams]
    await Promise.allSettled(
      streams.map(async (stream) => {
        if (stream.commitStarted) {
          await finished(stream)
        } else {
          await stream.abort()
        }
      })
    )
    this.activeWriteStreams.clear()
  }

  /**
   * Register legacy File_* IPC handlers that are still consumed through
   * `window.api.file.*`. Files-page batch operations have moved to IpcApi
   * (`src/main/ipc/handlers/file.ts`) and must not be re-registered here.
   *
   * Every handler Zod-parses its `params` before delegating, matching the
   * DataApi handler discipline (`b8709c964` / `2437c1104`).
   */
  private registerIpcHandlers(): void {
    // Handlers are async so a synchronous `Schema.parse` throw becomes a
    // Promise rejection at the IPC boundary (matching Electron's contract
    // for `ipcMain.handle` listeners).
    // Phase 2 channels.
    //
    // Zod outputs structural strings while the TS-side param types use template
    // literal brands (`AbsoluteFilePath`) that Zod cannot reproduce without a
    // `.transform()` per field. The cast at this single boundary keeps the
    // brand-as-doc convention intact while runtime validation remains the gate.
    this.ipcHandle(IpcChannel.File_CreateInternalEntry, async (_e, params: unknown) =>
      this.createInternalEntry(createInternalEntryInputSchema.parse(params))
    )
    this.ipcHandle(IpcChannel.File_EnsureExternalEntry, async (_e, params: unknown) =>
      this.ensureExternalEntry(EnsureExternalEntryIpcSchema.parse(params) as EnsureExternalEntryIpcParams)
    )
    this.ipcHandle(IpcChannel.File_GetPhysicalPath, async (_e, params: unknown) =>
      this.getPhysicalPath(GetPhysicalPathIpcSchema.parse(params).id)
    )
    this.ipcHandle(IpcChannel.File_RunSweep, async () => this.runSweep())
  }

  inspectOrphanFiles(): Promise<FileSweepReport> {
    return inspectFileSweep({ fileEntryService: this.deps.fileEntryService })
  }

  cleanupOrphanFiles(): Promise<FileSweepReport> {
    return runFileSweep({ fileEntryService: this.deps.fileEntryService })
  }

  /**
   * Run the scan-based entry cleanup pass (`runEntryCleanup`) first, then
   * the FS-level orphan sweep (file-manager-architecture §10) and the
   * DB-level zero-ref entry report (file-manager-architecture §7 Layer 3)
   * concurrently, returning a single `OrphanReport` once all three settle.
   * The DB pass only *reports*; it prunes nothing. Running the cleanup pass
   * first means the DB sweep's
   * zero-ref report doesn't re-report entries the pass just reclaimed.
   * Caller-initiated via the `File_RunSweep` IPC channel, which has no renderer
   * caller today; the FS half also runs unattended on the weekly floor in
   * `fileSweepTick`, which is what actually reclaims orphan blobs in production.
   * This method stays the on-demand "report everything" entry point. The cleanup
   * pass's own outcome
   * rides in `counts.entryCleanup` and never changes the umbrella `outcome`
   * below.
   *
   * Each branch absorbs its own errors via inner try/catch and surfaces
   * them through the umbrella `OrphanReport`:
   *
   * - DB sweep collapse → `outcome: 'failed'` (counts are meaningless;
   *   `errorMessage` carries the cause). FS sweep status no longer
   *   matters in this branch.
   * - DB sweep `partial` is preserved in the wire type for compatibility,
   *   but the current DB implementation returns only `completed` or `failed`.
   * - DB sweep clean BUT FS sweep returned `'partial'` / `'aborted'` /
   *   `'failed'` (or threw before producing a report) → umbrella degrades
   *   to `'partial'` with empty `errorsByType` and a populated
   *   `fsSweepIssue`. Without this degrade, an EACCES or safety-threshold
   *   abort on the FS side would silently surface as `'completed'` to
   *   whatever reads the report, which is the inverse of what the discriminator
   *   exists to prevent.
   * - Both clean → `outcome: 'completed'`.
   */
  async runSweep(): Promise<OrphanReport> {
    const cleanupReport = await this.runEntryCleanup()
    const startedAt = Date.now()
    const fsSweepPromise = runFileSweep({ fileEntryService: this.deps.fileEntryService }).catch(
      (err): FileSweepReport => {
        fileManagerLogger.error('File sweep failed', err)
        // Promote a thrown FS sweep into a structured `'failed'` report so
        // the umbrella merge below can degrade `outcome` to `'partial'`
        // (otherwise a permission error would surface as a clean
        // `'completed'` umbrella — the regression 0xfullex flagged in
        // PRRT_kwDOL_2xws6EeQI5).
        return {
          outcome: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
          entriesInDb: 0,
          direntsScanned: 0,
          filesOnDisk: 0,
          bytesOnDisk: 0,
          plannedDeleteCount: 0,
          plannedDeleteBytes: 0,
          actualDeleteCount: 0,
          actualDeleteBytes: 0,
          statFailedCount: 0,
          scanDurationMs: 0
        }
      }
    )

    let dbReport: DbSweepReport
    try {
      dbReport = runDbSweep({
        fileEntryService: this.deps.fileEntryService,
        fileRefService: this.deps.fileRefService
      })
    } catch (err) {
      fileManagerLogger.error('DB orphan sweep failed', err as Error)
      dbReport = {
        outcome: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        orphanEntriesByOrigin: {},
        orphanEntriesTotal: 0,
        scanDurationMs: 0
      }
    }

    const fsReport = await fsSweepPromise
    const lastRunAt = startedAt
    const counts = {
      orphanEntriesByOrigin: dbReport.orphanEntriesByOrigin,
      orphanEntriesTotal: dbReport.orphanEntriesTotal,
      entryCleanup: summariseEntryCleanup(cleanupReport)
    }
    const fsSweepIssue = summariseFsSweepIssue(fsReport)
    switch (dbReport.outcome) {
      case 'completed':
        // DB clean; degrade umbrella to partial iff the FS sweep didn't also
        // come back clean — UI must not render "all clear" when an FS-side
        // permission error / pending-restore stand-aside silently swallowed the unlink work.
        if (fsSweepIssue === undefined) {
          return { ...counts, outcome: 'completed', lastRunAt }
        }
        return { ...counts, outcome: 'partial', errorsByType: {}, fsSweepIssue, lastRunAt }
      case 'partial':
        return {
          ...counts,
          outcome: 'partial',
          errorsByType: dbReport.errorsByType,
          ...(fsSweepIssue !== undefined && { fsSweepIssue }),
          lastRunAt
        }
      case 'aborted':
        // Deliberate stand-aside for a pending restore. Both branches check
        // the same journal microseconds apart, so the FS half aborted too in
        // every realistic run — surface it as an abort, not a degraded
        // 'partial' (this is expected behavior, not a half-finished sweep).
        return { ...counts, outcome: 'aborted', abortReason: dbReport.abortReason, lastRunAt }
      case 'failed':
        // DB-level collapse dominates: counts are meaningless either way,
        // so the FS sweep's status doesn't change the umbrella.
        return { ...counts, outcome: 'failed', errorMessage: dbReport.errorMessage, lastRunAt }
    }
  }

  // ─── Entry queries ───

  async getById(id: FileEntryId): Promise<FileEntry> {
    return this.deps.fileEntryService.getById(id)
  }

  async findById(id: FileEntryId): Promise<FileEntry | null> {
    return this.deps.fileEntryService.findById(id)
  }

  async findByExternalPath(path: AbsoluteFilePath): Promise<FileEntry | null> {
    return this.deps.fileEntryService.findByExternalPath(canonicalizeFilePath(path))
  }

  async findInternalByContentHash(contentHash: ContentHash): Promise<FileEntry[]> {
    return this.deps.fileEntryService.findInternalByContentHash(contentHash)
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

  async readChunk(id: FileEntryId, offset: number, length: number): Promise<ReadResult<Uint8Array>> {
    return internalReadChunk(this.deps, id, offset, length)
  }

  /**
   * Live physical metadata for an entry. Resolves the entry's physical path and
   * delegates the stat → shape mapping to the shared `buildPhysicalFileMetadata`
   * (the same derivation as the path-arm `getMetadataByPath`), so `type` is
   * content-derived rather than hardcoded. Per-kind enrichment — image
   * width/height, PDF pageCount, text encoding — is still deferred; call sites
   * that need those fields tolerate their absence until enrichment lands.
   */
  async getMetadata(id: FileEntryId): Promise<PhysicalFileMetadata> {
    const entry = this.deps.fileEntryService.getById(id)
    const physicalPath = resolvePhysicalPath(entry)
    const s = await observeExternalAccess(this.deps, entry, physicalPath, () => fsStat(physicalPath))
    return buildPhysicalFileMetadata(physicalPath, s)
  }

  async getVersion(id: FileEntryId): Promise<FileVersion> {
    const entry = this.deps.fileEntryService.getById(id)
    const physicalPath = resolvePhysicalPath(entry)
    const s = await observeExternalAccess(this.deps, entry, physicalPath, () => fsStat(physicalPath))
    return { mtime: s.modifiedAt, size: s.size }
  }

  async getContentHash(id: FileEntryId): Promise<ContentHash> {
    return internalHash(this.deps, id)
  }

  getUrl(id: FileEntryId): FileUrlString {
    const entry = this.deps.fileEntryService.getById(id)
    const physicalPath = resolvePhysicalPath(entry)
    return pathToFileURL(physicalPath).toString() as FileUrlString
  }

  getPhysicalPath(id: FileEntryId): AbsoluteFilePath {
    const entry = this.deps.fileEntryService.getById(id)
    return resolvePhysicalPath(entry)
  }

  // ─── Mutation methods ───

  async createInternalEntry(params: CreateInternalEntryParams): Promise<FileEntry> {
    return internalCreateInternal(this.deps, params)
  }

  async batchCreateInternalEntries(items: CreateInternalEntryParams[]): Promise<BatchCreateResult> {
    return aggregateCreate(
      items,
      (_, index) => `#${index}`,
      (p) => this.createInternalEntry(p)
    )
  }

  async batchEnsureExternalEntries(items: EnsureExternalEntryParams[]): Promise<BatchCreateResult> {
    // Within-batch path duplicates resolve to the same entry per the public
    // contract; the second occurrence reuses the just-inserted row. The
    // in-memory memo keys on the branded `externalPath` directly — no re-parse,
    // trusting the already-validated `AbsoluteFilePath` param. Byte-identical inputs
    // dedup here; any canonically-equal-but-byte-different pair still coalesces
    // one level down (`ensureExternalEntry` canonicalizes and hits the DB
    // upsert). Both items end up in `succeeded` even though only one DB insert
    // happens — and each carries its own `sourceRef`, so the caller can still
    // correlate every input.
    const seen = new Map<string, FileEntry>()
    const succeeded: BatchCreateResult['succeeded'] = []
    const failed: BatchCreateResult['failed'] = []
    for (const params of items) {
      const sourceRef = params.externalPath
      try {
        const cached = seen.get(params.externalPath)
        const entry = cached ?? (await this.ensureExternalEntry(params))
        if (!cached) seen.set(params.externalPath, entry)
        succeeded.push({ id: entry.id, sourceRef })
      } catch (err) {
        // Wire format only carries `.message`; preserve the stack via the
        // logger side-channel for postmortem.
        fileManagerLogger.warn('batchEnsureExternalEntries item failed', { sourceRef, err })
        failed.push({ sourceRef, error: (err as Error).message })
      }
    }
    return { succeeded, failed }
  }

  async createReadStream(id: FileEntryId): Promise<Readable> {
    const entry = this.deps.fileEntryService.getById(id)
    const physicalPath = resolvePhysicalPath(entry)
    const stream = nodeCreateReadStream(physicalPath)
    if (entry.origin === 'external') {
      // observeExternalAccess covers the awaitable read paths (read / hash /
      // getMetadata / getVersion). createReadStream surfaces ENOENT lazily
      // through the stream's 'error' event instead, so we mirror the same
      // "external + ENOENT → 'missing'" cache commit at the stream layer.
      // Listener stays passive (no throw, no other side effect) and respects
      // the cache's existing emission rules — only a real transition fires
      // subscribers.
      stream.once('error', (err) => {
        // Mirror observeExternalAccess: treat both ENOENT and ENOTDIR as
        // "path proven non-existent" and bucket the commit as 'ops' so
        // diagnostics tell them apart from watcher-driven transitions.
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          this.deps.danglingCache.onFsEvent(physicalPath, 'missing', 'ops')
        }
      })
    }
    return stream
  }

  async write(id: FileEntryId, data: string | Uint8Array): Promise<FileVersion> {
    return internalWrite(this.deps, id, data)
  }

  async writeIfUnchanged(
    id: FileEntryId,
    data: string | Uint8Array,
    expectedVersion: FileVersion,
    expectedContentHash?: ContentHash
  ): Promise<FileVersion> {
    return internalWriteIfUnchanged(this.deps, id, data, expectedVersion, expectedContentHash)
  }

  async createWriteStream(id: FileEntryId): Promise<AtomicWriteStream> {
    const stream = await internalCreateWriteStream(this.deps, id)
    this.activeWriteStreams.add(stream)
    const forget = () => this.activeWriteStreams.delete(stream)
    stream.once('finish', forget)
    stream.once('close', forget)
    return stream
  }

  /** Alias kept for backwards compatibility; prefer `createWriteStream`. */
  async createAtomicWriteStream(id: FileEntryId): Promise<AtomicWriteStream> {
    return this.createWriteStream(id)
  }

  async trash(id: FileEntryId): Promise<void> {
    internalTrash(this.deps, id)
    this.notifyReadModelChange([id])
  }

  async restore(id: FileEntryId): Promise<FileEntry> {
    const entry = await internalRestore(this.deps, id)
    this.notifyReadModelChange([id])
    return entry
  }

  async permanentDelete(id: FileEntryId): Promise<void> {
    await internalPermanentDelete(this.deps, id)
    this.notifyReadModelChange([id])
  }

  async batchTrash(ids: FileEntryId[]): Promise<BatchMutationResult> {
    const result = internalBatchTrash(this.deps, ids)
    this.notifyReadModelChange(result.succeeded)
    return result
  }

  async batchRestore(ids: FileEntryId[]): Promise<BatchMutationResult> {
    const result = internalBatchRestore(this.deps, ids)
    this.notifyReadModelChange(result.succeeded)
    return result
  }

  async batchPermanentDeleteFromTrash(ids: FileEntryId[]): Promise<BatchMutationResult> {
    const result = await internalBatchPermanentDeleteFromTrash(this.deps, ids)
    this.notifyReadModelChange(result.succeeded)
    return result
  }

  async batchRemoveFromLibrary(ids: FileEntryId[]): Promise<BatchMutationResult> {
    const result = await internalBatchRemoveFromLibrary(this.deps, ids)
    this.notifyReadModelChange(result.succeeded)
    return result
  }

  private notifyReadModelChange(ids: readonly FileEntryId[]): void {
    if (ids.length === 0) return
    const entityIds = [...new Set(ids)]
    notifyDataApiDataChange([
      { endpoint: '/files/entries', kind: 'membership', entityIds },
      { endpoint: '/files/entries/:id', entityIds }
    ])
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
    const entry = this.deps.fileEntryService.getById(id)
    return safeOpen(resolvePhysicalPath(entry))
  }

  async showInFolder(id: FileEntryId): Promise<void> {
    const entry = this.deps.fileEntryService.getById(id)
    return internalShellShowInFolder(resolvePhysicalPath(entry))
  }

  // ─── Dangling state ───

  /**
   * Resolve the current `DanglingState` for an entry. Hot path: `'present'`
   * for any internal entry; cache hit for external; cold-stat fallback on
   * miss. Unknown ids resolve to `'unknown'`.
   */
  async getDanglingState(params: { id: FileEntryId }): Promise<DanglingState> {
    const entry = this.deps.fileEntryService.findById(params.id)
    if (!entry) return 'unknown'
    return this.deps.danglingCache.check(entry)
  }

  /**
   * Subscribe to dangling state transitions for a specific entry. The
   * listener fires only on genuine transitions ('present' → 'missing' or
   * vice versa); same-state observations are silent. Returns a dispose
   * function. In-process only — renderer fan-out via the planned
   * `file-manager-event` IPC channel is deferred.
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
  resolveSourceRef: (p: P, index: number) => string,
  op: (p: P) => Promise<FileEntry>
): Promise<BatchCreateResult> {
  const succeeded: BatchCreateResult['succeeded'] = []
  const failed: BatchCreateResult['failed'] = []
  for (let i = 0; i < items.length; i++) {
    const sourceRef = resolveSourceRef(items[i], i)
    try {
      const entry = await op(items[i])
      succeeded.push({ id: entry.id, sourceRef })
    } catch (err) {
      // No FileEntryId yet (insert never happened); report by sourceRef so
      // callers can correlate with the original `items` array. Wire format
      // carries `.message`; side-channel the full err for stack preservation.
      fileManagerLogger.warn('batch create item failed', { sourceRef, err })
      failed.push({ sourceRef, error: (err as Error).message })
    }
  }
  return { succeeded, failed }
}
