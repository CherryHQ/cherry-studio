/**
 * File IPC type contracts
 *
 * Defines the parameter and return types for File IPC operations.
 * All file entry write operations that may affect the filesystem go through
 * File IPC (not DataApi). The handler delegates to FileManager (sole FS owner).
 *
 * These types are shared between main (handler implementation) and
 * preload (method signatures exposed to renderer).
 *
 * ## Unified access via FileHandle
 *
 * Most operations accept `FileHandle` (tagged union) so consumers don't need
 * to branch on "managed entry vs arbitrary path". The handler dispatches:
 * - `{ kind: 'managed', entryId }` → FileManager method (entry-aware)
 * - `{ kind: 'unmanaged', path }`  → `ops/*` direct (path-only)
 *
 * Operations that only make sense on FileEntry (trash, rename, refreshMetadata,
 * etc.) take `FileEntryId` directly.
 */

import type { FileEntry, FileEntryId } from '@shared/data/types/file'

import type { DirectoryListOptions, FileContent, FilePath, PhysicalFileMetadata } from './common'
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
 * Always produces a fresh entry with a new UUID — no conflict resolution.
 */
export type CreateInternalEntryIpcParams = {
  name: string
  ext?: string | null
  content: FileContent
}

/**
 * Params for ensuring an entry exists for a user-provided (external) path.
 * Upsert semantics: if a non-trashed entry with the same path exists, return
 * it; if a trashed entry exists, restore it; otherwise create a new one.
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
   * **Upsert + restore** semantics (not plain insert):
   * - Non-trashed entry with same path exists → return it (snapshot refreshed
   *   via stat)
   * - Trashed entry with same path exists → restore (`trashedAt = null`) and
   *   return it
   * - No existing entry → insert a new one
   *
   * Idempotent by design — callers holding an `externalPath` can invoke this
   * freely without pre-checking. The partial unique index
   * `UNIQUE(externalPath) WHERE origin='external' AND trashedAt IS NULL`
   * enforces this invariant at the DB level.
   */
  ensureExternalEntry(params: EnsureExternalEntryIpcParams): Promise<FileEntry>

  /** Batch version of `createInternalEntry`. Each item produces an independent new entry. */
  batchCreateInternalEntries(items: CreateInternalEntryIpcParams[]): Promise<BatchOperationResult>

  /**
   * Batch version of `ensureExternalEntry`. Each item is individually upserted.
   * Within-batch path duplicates are coalesced to a single entry in the result.
   */
  batchEnsureExternalEntries(items: EnsureExternalEntryIpcParams[]): Promise<BatchOperationResult>

  // ─── C. Read / Metadata (accepts FileHandle) ───

  /** Read content as text */
  read(handle: FileHandle, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<ReadResult<string>>
  /** Read content as base64 */
  read(handle: FileHandle, options: { encoding: 'base64' }): Promise<ReadResult<string>>
  /** Read content as binary */
  read(handle: FileHandle, options: { encoding: 'binary' }): Promise<ReadResult<Uint8Array>>

  /** Get physical metadata (size, mime, timestamps, type-specific fields) */
  getMetadata(handle: FileHandle): Promise<PhysicalFileMetadata>

  /** Get lightweight FileVersion. For managed-external entries, refreshes DB snapshot if changed. */
  getVersion(handle: FileHandle): Promise<FileVersion>

  /** Compute xxhash-128 of file content. */
  getContentHash(handle: FileHandle): Promise<string>

  // ─── D. Write (accepts FileHandle; external and unmanaged paths are written via ops atomic write) ───

  /** Unconditional atomic write. */
  write(handle: FileHandle, data: string | Uint8Array): Promise<FileVersion>

  /** Optimistic-concurrency write. Throws StaleVersionError on version mismatch. */
  writeIfUnchanged(handle: FileHandle, data: string | Uint8Array, expectedVersion: FileVersion): Promise<FileVersion>

  // ─── E. Trash / Delete ───

  /**
   * Move entry to Trash (soft delete via trashedAt). No FS impact for either origin.
   * Only applies to managed entries.
   */
  trash(params: { id: FileEntryId }): Promise<void>

  /** Restore entry from Trash. No FS impact. Only applies to managed entries. */
  restore(params: { id: FileEntryId }): Promise<FileEntry>

  /**
   * Permanently delete.
   * - Managed: unlinks physical file (internal or external) and deletes DB row.
   * - Unmanaged: removes the file at the given path (delegates to `ops.remove`).
   */
  permanentDelete(handle: FileHandle): Promise<void>

  /** Batch move entries to Trash (managed only) */
  batchTrash(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
  /** Batch restore entries from Trash (managed only) */
  batchRestore(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
  /** Batch permanently delete managed entries */
  batchPermanentDelete(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>

  // ─── F. Rename ───

  /**
   * Rename a file.
   * - Managed: `newTarget` is a new display name (no path separators). For external,
   *   the physical file is renamed in place; for internal, only DB name changes.
   * - Unmanaged: `newTarget` is a full new absolute path. Equivalent to `fs.rename(path, newTarget)`.
   */
  rename(handle: FileHandle, newTarget: string): Promise<FileEntry | void>

  // ─── G. Copy ───

  /**
   * Copy content into a new internal managed entry.
   * Source can be managed (internal or external) or unmanaged.
   */
  copy(params: { source: FileHandle; newName?: string }): Promise<FileEntry>

  // ─── H. External Metadata Refresh (managed-external only) ───

  /**
   * Re-stat external entry and refresh DB snapshot (name/ext/size). No-op for internal.
   * Side effect: updates DanglingCache based on stat result.
   *
   * Dangling state itself is queried via DataApi (`includeDangling`).
   */
  refreshMetadata(params: { id: FileEntryId }): Promise<FileEntry>

  // ─── I. System Operations (accepts FileHandle) ───

  /** Open file/directory with the system default application */
  open(handle: FileHandle): Promise<void>
  /** Reveal file/directory in the system file manager */
  showInFolder(handle: FileHandle): Promise<void>

  // ─── J. Directory Listing (arbitrary path) ───

  /** List contents of an arbitrary directory. */
  listDirectory(dirPath: FilePath, options?: DirectoryListOptions): Promise<string[]>

  /** Check if a directory is non-empty. */
  isNotEmptyDir(dirPath: FilePath): Promise<boolean>
}

// ─── Electron Types ───

export interface FileFilter {
  name: string
  extensions: string[]
}
