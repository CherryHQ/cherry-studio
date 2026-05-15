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
 * entry system, `FilePathHandle` hits `@main/utils/file/*` directly). The
 * design plan is for the IPC adapter to dispatch on `handle.kind` via a
 * `dispatchHandle` helper, with the dispatch logic treated as the adapter's
 * legitimate responsibility (translating request shape), not business
 * orchestration.
 *
 * **Current status (through Batch 0)**: `dispatchHandle` lives in
 * `internal/dispatch.ts` and is wired by exactly one IPC handler today —
 * `File_PermanentDelete`, which accepts a `FileHandle` and routes
 * `{ kind: 'entry' }` to `FileManager.permanentDelete` and `{ kind: 'path' }`
 * to `@main/utils/file/fs.remove`. The Phase 1 dangling channels
 * (`File_GetDanglingState` / `File_BatchGetDanglingStates`) and the Phase 2
 * entry-shaped channels (`File_CreateInternalEntry`, `File_EnsureExternalEntry`,
 * `File_GetPhysicalPath`) take typed params directly and bypass the dispatcher
 * because their semantics are entry-only by design. When `FileHandle`-accepting
 * read/write/metadata channels land in later batches, they will follow the
 * same pattern as `File_PermanentDelete`:
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
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { orphanCheckerRegistry } from '@data/services/orphan/FileRefCheckerRegistry'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { bootConfigService } from '@main/data/bootConfig'
import { remove as fsRemove, stat as fsStat } from '@main/utils/file/fs'
import type { DanglingState, FileEntry, FileEntryId } from '@shared/data/types/file'
import { FileEntryIdSchema } from '@shared/data/types/file'
import { SafeExtSchema } from '@shared/data/types/file/essential'
import type {
  BatchCreateResult,
  BatchMutationResult,
  CreateInternalEntryIpcParams,
  EnsureExternalEntryIpcParams,
  FilePath,
  FileURLString,
  PhysicalFileMetadata
} from '@shared/file/types'
import { FileHandleSchema } from '@shared/file/types/handle'
import { IpcChannel } from '@shared/IpcChannel'
import { eq } from 'drizzle-orm'
import mime from 'mime'
import * as z from 'zod'

import { danglingCache } from './danglingCache'
import { hash as internalHash } from './internal/content/hash'
import { read as internalRead } from './internal/content/read'
import {
  createWriteStream as internalCreateWriteStream,
  write as internalWrite,
  writeIfUnchanged as internalWriteIfUnchanged
} from './internal/content/write'
import type { FileManagerDeps } from './internal/deps'
import { dispatchHandle } from './internal/dispatch'
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
import { canonicalizeExternalPath, resolvePhysicalPath } from './utils/pathResolver'
import { createVersionCacheImpl, type VersionCache } from './versionCache'

const fileManagerLogger = loggerService.withContext('FileManager')

// Main-side parameter types are structurally identical to the IPC variants —
// `CreateInternalEntryIpcParams` is a discriminated union on `source`
// (`'path' | 'url' | 'base64' | 'bytes'`) that type-gates which of
// `name`/`ext` each source may pass (see ipc.ts JSDoc).
// Re-exported under shorter names for Main callers.
export type CreateInternalEntryParams = CreateInternalEntryIpcParams
export type EnsureExternalEntryParams = EnsureExternalEntryIpcParams

// ─── File IPC input schemas ───

/**
 * Maximum number of entry ids a single `File_BatchGetDanglingStates` call may
 * carry. Mirrors `REF_COUNTS_MAX_ENTRY_IDS` from the DataApi side — the batch
 * still fans out one `findById` per id, so the renderer-side cap protects the
 * event loop and connection pool from runaway requests.
 */
export const FILE_BATCH_DANGLING_MAX_IDS = 500

export const GetDanglingStateIpcSchema = z.strictObject({ id: FileEntryIdSchema })
export const BatchGetDanglingStatesIpcSchema = z.strictObject({
  ids: z.array(FileEntryIdSchema).max(FILE_BATCH_DANGLING_MAX_IDS)
})

// Phase 2 schemas — reuse SafeExtSchema (canonical bare-suffix rules + whitespace guard).
const SafeExtNullableSchema = SafeExtSchema.nullable()

export const CreateInternalEntryIpcSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('path'), path: z.string().min(1) }),
  z.strictObject({ source: z.literal('url'), url: z.string().min(1) }),
  z.strictObject({ source: z.literal('base64'), data: z.string().min(1), name: z.string().optional() }),
  z.strictObject({
    source: z.literal('bytes'),
    data: z.instanceof(Uint8Array),
    name: z.string().min(1),
    ext: SafeExtNullableSchema
  })
])

export const EnsureExternalEntryIpcSchema = z.strictObject({ externalPath: z.string().min(1) })

export const GetPhysicalPathIpcSchema = z.strictObject({ id: FileEntryIdSchema })

export const PermanentDeleteIpcSchema = FileHandleSchema

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
 * Note: this implementation uses the xxhash-h64 fallback path described on
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

// ─── IFileManager ───

/**
 * Public surface of `FileManager` for Main-side business services and the
 * future Phase 2 IPC layer. The class below declares `implements IFileManager`
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
 *   - Orphan report (`getOrphanReport`)
 *   - 3rd-party escape hatch (`withTempCopy`), `open` / `showInFolder`
 *
 * **Out** — kept on the class but **not** in the interface:
 *   - DB-pass-through queries (`getById` / `findById` / `findByExternalPath`).
 *     These are convenience accessors for tests and a few internal sites; the
 *     authoritative read surface is `fileEntryService` directly. Adding them
 *     to the interface would expose persistence concerns business code
 *     should not depend on.
 *   - Lifecycle internals (`runStartupSweeps`). Public on the class so tests
 *     can `await` it, but not a binding consumer-facing contract.
 *
 * If a new "consumer-facing" method lands on the class, add it to this
 * interface in the same PR; the `implements` clause will fail the build
 * otherwise.
 */
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
  batchPermanentDelete(ids: FileEntryId[]): Promise<BatchMutationResult>

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
  getUrl(id: FileEntryId): Promise<FileURLString>

  /** Resolve an entry to its absolute filesystem path. */
  getPhysicalPath(id: FileEntryId): Promise<FilePath>

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

  // ─── Orphan report (cleanup UI) ───

  /**
   * Snapshot of the last DB-level orphan sweep. `outcome` discriminator
   * distinguishes `'unknown'` (no sweep yet), `'completed'`, `'partial'`,
   * and `'failed'` so the renderer cannot read a failed run as healthy zero.
   */
  getOrphanReport(): OrphanReport

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
export class FileManager extends BaseService implements IFileManager {
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
    this.registerIpcHandlers()
    // Fire-and-forget: both branches catch their own errors, but a synchronous
    // throw in dep wiring (e.g. registry access racing with shutdown, or
    // `application.get(...)` before a dep is registered) would otherwise become
    // an unhandled rejection at this `void` site.
    void this.runStartupSweeps().catch((err) => {
      fileManagerLogger.error('runStartupSweeps unhandled rejection', err)
    })
  }

  /**
   * Register the Phase 1 File_* IPC handlers. Kept as a dedicated helper so
   * `onInit` stays a narrow three-step sequence (init → register → sweep) and
   * Phase 2 channels land next to these two without bloating the lifecycle
   * method.
   *
   * Every handler Zod-parses its `params` before delegating, matching the
   * DataApi handler discipline (`b8709c964` / `2437c1104`). Without this the
   * batch fan-out is unbounded: a 100k-id `Promise.all` over `findById`
   * would saturate the event loop and the DB connection pool.
   */
  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.File_GetDanglingState, (_e, params: unknown) =>
      this.getDanglingState(GetDanglingStateIpcSchema.parse(params))
    )
    this.ipcHandle(IpcChannel.File_BatchGetDanglingStates, (_e, params: unknown) =>
      this.batchGetDanglingStates(BatchGetDanglingStatesIpcSchema.parse(params))
    )
    // Phase 2 channels
    this.ipcHandle(IpcChannel.File_CreateInternalEntry, (_e, params: unknown) =>
      this.createInternalEntry(CreateInternalEntryIpcSchema.parse(params))
    )
    this.ipcHandle(IpcChannel.File_EnsureExternalEntry, (_e, params: unknown) =>
      this.ensureExternalEntry(EnsureExternalEntryIpcSchema.parse(params))
    )
    this.ipcHandle(IpcChannel.File_GetPhysicalPath, (_e, params: unknown) =>
      this.getPhysicalPath(GetPhysicalPathIpcSchema.parse(params).id)
    )
    this.ipcHandle(IpcChannel.File_PermanentDelete, (_e, params: unknown) => {
      const handle = PermanentDeleteIpcSchema.parse(params)
      return dispatchHandle(
        handle,
        (entryId) => this.permanentDelete(entryId),
        (path) => fsRemove(path)
      )
    })
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
    // FS sweep is independent of migration state — always run it.
    const fsSweepPromise = runStartupFileSweep({ fileEntryService: this.deps.fileEntryService }).catch((err) => {
      fileManagerLogger.error('Startup file sweep failed', err)
    })

    // Skip DB sweep once when migration marker mismatches current completedAt.
    // This provides a grace window after first-boot post-migration and after a
    // v2 backup restore (see file-manager-architecture §migration-skip-once).
    const completedAt = await this.getMigrationCompletedAt()
    const marker = bootConfigService.get('file.lastProcessedMigrationCompletedAt')

    if (completedAt !== null && completedAt !== marker) {
      bootConfigService.set('file.lastProcessedMigrationCompletedAt', completedAt)
      fileManagerLogger.info('runStartupSweeps: skipping DB sweep once (post-migration grace window)', {
        previousMarker: marker,
        currentCompletedAt: completedAt
      })
      await fsSweepPromise
      return
    }

    await Promise.all([
      fsSweepPromise,
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
          // Surface the outer-catch path through `lastDbSweepReport` so
          // `getOrphanReport()` can distinguish "sweep collapsed" from
          // "no sweep yet". Without this assignment a synchronous wiring
          // throw (e.g. registry property access racing with shutdown)
          // would leave the report null forever, and the renderer-side
          // cleanup UI would see `outcome: 'unknown'` indistinguishable
          // from the pre-first-sweep state. Counts stay zero because
          // nothing was actually scanned.
          this.lastDbSweepReport = {
            outcome: 'failed',
            errorMessage: err instanceof Error ? err.message : String(err),
            orphanRefsByType: {},
            orphanRefsTotal: 0,
            orphanEntriesByOrigin: {},
            orphanEntriesTotal: 0,
            scanDurationMs: 0
          }
          this.lastDbSweepRanAt = Date.now()
        })
    ])
  }

  /**
   * Read the `completedAt` ms-epoch from `app_state.migration_v2_status`.
   * Returns null if the row is absent, if `completedAt` is not a number
   * (fresh install, in-progress, failed run), or if the DB read throws.
   *
   * The error path treats failure as "no migration record" so callers fall
   * through to running the orphan sweep normally — a sweep is always more
   * useful than silently no-op'ing on a transient DB hiccup.
   */
  private async getMigrationCompletedAt(): Promise<number | null> {
    try {
      const db = application.get('DbService').getDb()
      const row = await db.select().from(appStateTable).where(eq(appStateTable.key, 'migration_v2_status')).get()
      if (!row) return null
      const value = row.value as { completedAt?: unknown }
      return typeof value.completedAt === 'number' ? value.completedAt : null
    } catch (error) {
      fileManagerLogger.error('Failed to read migration_v2_status; treating as no migration', error as Error)
      return null
    }
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
        outcome: 'unknown',
        orphanRefsByType: {},
        orphanRefsTotal: 0,
        orphanEntriesByOrigin: {},
        orphanEntriesTotal: 0,
        lastRunAt: null
      }
    }
    const counts = {
      orphanRefsByType: this.lastDbSweepReport.orphanRefsByType,
      orphanRefsTotal: this.lastDbSweepReport.orphanRefsTotal,
      orphanEntriesByOrigin: this.lastDbSweepReport.orphanEntriesByOrigin,
      orphanEntriesTotal: this.lastDbSweepReport.orphanEntriesTotal
    }
    // lastDbSweepRanAt is non-null once lastDbSweepReport is populated
    // (set in lockstep in runStartupSweeps); narrow for the non-'unknown'
    // variants which require number.
    const lastRunAt = this.lastDbSweepRanAt ?? Date.now()
    switch (this.lastDbSweepReport.outcome) {
      case 'completed':
        return { ...counts, outcome: 'completed', lastRunAt }
      case 'partial':
        return {
          ...counts,
          outcome: 'partial',
          errorsByType: this.lastDbSweepReport.errorsByType,
          lastRunAt
        }
      case 'failed':
        return {
          ...counts,
          outcome: 'failed',
          errorMessage: this.lastDbSweepReport.errorMessage,
          lastRunAt
        }
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
   * Returns the structural shape with `type: 'other'` for files regardless
   * of ext. Per-kind enrichment — image width/height, PDF pageCount, text
   * encoding — is deferred; renderer call sites that need those fields are
   * expected to tolerate their absence until enrichment lands.
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
    // canonical-path memoization here ensures both items end up in
    // `succeeded` even though only one DB insert happens — and each carries
    // its own `sourceRef`, so the caller can still correlate every input.
    const seen = new Map<string, FileEntry>()
    const succeeded: BatchCreateResult['succeeded'] = []
    const failed: BatchCreateResult['failed'] = []
    for (const params of items) {
      const sourceRef = params.externalPath
      try {
        const canonical = canonicalizeExternalPath(params.externalPath)
        const cached = seen.get(canonical)
        const entry = cached ?? (await this.ensureExternalEntry(params))
        if (!cached) seen.set(canonical, entry)
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
    const entry = await this.deps.fileEntryService.getById(id)
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

  async batchTrash(ids: FileEntryId[]): Promise<BatchMutationResult> {
    return internalBatchTrash(this.deps, ids)
  }

  async batchRestore(ids: FileEntryId[]): Promise<BatchMutationResult> {
    return internalBatchRestore(this.deps, ids)
  }

  async batchPermanentDelete(ids: FileEntryId[]): Promise<BatchMutationResult> {
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

  // ─── Dangling state ───

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
