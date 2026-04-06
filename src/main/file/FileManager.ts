/**
 * FileManager — the sole coordinator between file entries (DB) and the filesystem.
 *
 * Public API only accepts FileEntryId. Pure path operations live in ops/.
 * IPC handlers dispatch by target type: FileEntryId → FileManager, FilePath → ops.
 */

import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { BatchOperationResult, FileContent, FilePath, PhysicalFileMetadata } from '@shared/file/types'

export type CreateEntryParams =
  | { type: 'file'; parentId: FileEntryId; name: string; content: FileContent }
  | { type: 'dir'; parentId: FileEntryId; name: string }

export interface IFileManager {
  // ─── Entry Creation ───

  /** Create a file or directory entry. Handles content processing, dedup, and compression. */
  createEntry(params: CreateEntryParams): Promise<FileEntry>

  /** Batch create file entries under the same parent. */
  batchCreateEntries(
    parentId: FileEntryId,
    items: Array<{ name: string; content: FileContent }>
  ): Promise<BatchOperationResult>

  // ─── Reading ───

  /** Read file content as text. */
  read(id: FileEntryId, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
  /** Read file content as base64. */
  read(id: FileEntryId, options: { encoding: 'base64' }): Promise<{ data: string; mime: string }>
  /** Read file content as binary. */
  read(id: FileEntryId, options: { encoding: 'binary' }): Promise<{ data: Uint8Array; mime: string }>

  /** Get physical file metadata (size, timestamps, type-specific info). */
  getMetadata(id: FileEntryId): Promise<PhysicalFileMetadata>

  // ─── Writing ───

  /** Write content to an existing file entry. */
  write(id: FileEntryId, data: string | Uint8Array): Promise<void>

  // ─── Copy ───

  /** Copy entry within the file tree (creates a new entry with physical copy). */
  copy(params: { id: FileEntryId; targetParentId: FileEntryId; newName?: string }): Promise<FileEntry>
  /** Export entry's physical file to an external path (no new entry created). */
  copy(params: { id: FileEntryId; destPath: FilePath }): Promise<void>

  // ─── Move / Rename ───

  /** Move entry to new parent and/or rename (Unix mv semantics). */
  move(params: { id: FileEntryId; targetParentId: FileEntryId; newName?: string }): Promise<FileEntry>
  /** Batch move entries to target parent. */
  batchMove(params: { ids: FileEntryId[]; targetParentId: FileEntryId }): Promise<BatchOperationResult>

  // ─── Deletion ───

  /** Move entry to Trash (soft delete). */
  trash(id: FileEntryId): Promise<void>
  /** Restore entry from Trash. */
  restore(id: FileEntryId): Promise<FileEntry>
  /** Permanently delete entry and its physical file. */
  permanentDelete(id: FileEntryId): Promise<void>

  /** Batch move entries to Trash. */
  batchTrash(ids: FileEntryId[]): Promise<BatchOperationResult>
  /** Batch restore entries from Trash. */
  batchRestore(ids: FileEntryId[]): Promise<BatchOperationResult>
  /** Batch permanently delete entries. */
  batchPermanentDelete(ids: FileEntryId[]): Promise<BatchOperationResult>

  // ─── Temp ───

  /** Clear all entries and physical files in mount_temp. */
  clearTemp(): Promise<void>

  // ─── Path Resolution ───

  /**
   * Resolve entry ID to absolute physical path.
   *
   * OPEN QUESTION: whether to expose this publicly or keep it internal.
   * Exposing path enables callers to bypass FileManager and operate on FS directly,
   * breaking cache consistency and sync engine invariants. But not exposing it
   * forces FileManager to grow API surface for every new consumption pattern
   * (Buffer, ReadStream, etc.). Decision deferred to implementation phase.
   */
  resolvePhysicalPath(id: FileEntryId): Promise<string>

  // ─── System ───

  /** Open file with the system default application. */
  open(id: FileEntryId): Promise<void>
  /** Reveal file in the system file manager. */
  showInFolder(id: FileEntryId): Promise<void>
}
