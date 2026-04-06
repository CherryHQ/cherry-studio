/**
 * File IPC type contracts
 *
 * Defines the parameter and return types for File IPC operations.
 * All file entry write operations that may affect the filesystem go through
 * FileIpcService (not DataApi). FileIpcService delegates to FileService
 * (sole FS owner), which coordinates FS ops and calls FileTreeService for DB sync.
 *
 * These types are shared between main (handler implementation) and
 * preload (method signatures exposed to renderer).
 */

import type { FileEntry, FileEntryId } from './fileEntry'

// ─── Content Source Types ───

/** Local filesystem path. Runtime validation required — pattern is intentionally broad for type-level hints only. */
export type FilePath = `/${string}` | `${string}:\\${string}` | `file://${string}`
export type Base64String = `data:${string};base64,${string}`
export type URLString = `http://${string}` | `https://${string}`
export type FileContent = FilePath | Base64String | URLString | Uint8Array

// ─── File Metadata (physical file info, separate from FileEntry) ───

type MetadataBase = { size: number; createdAt: number; modifiedAt: number }

type DirectoryMetadata = MetadataBase & { kind: 'directory' }

type FileMetadataCommon = MetadataBase & { kind: 'file'; mime: string }
type ImageFileMetadata = FileMetadataCommon & { type: 'image'; width: number; height: number }
type PdfFileMetadata = FileMetadataCommon & { type: 'pdf'; pageCount: number }
type TextFileMetadata = FileMetadataCommon & { type: 'text'; encoding: string }
type GenericFileMetadata = FileMetadataCommon & { type: 'other' }

type FileKindMetadata = ImageFileMetadata | PdfFileMetadata | TextFileMetadata | GenericFileMetadata
/** Physical file metadata (size, timestamps, and type-specific info like dimensions/pageCount). Discriminate on `kind`, then `type`. */
export type PhysicalFileMetadata = DirectoryMetadata | FileKindMetadata

// ─── CreateEntry Params ───

export type CreateEntryParams =
  | { type: 'file'; parentId: FileEntryId; name: string; content: FileContent }
  | { type: 'dir'; parentId: FileEntryId; name: string }

// ─── Batch Result ───

export interface BatchOperationResult {
  succeeded: FileEntryId[]
  failed: Array<{ id: FileEntryId; error: string }>
}

// ─── File IPC API ───

/**
 * File IPC interface — the complete contract between renderer and main process
 * for all file operations that may affect the filesystem.
 *
 * DataApi handles read-only entry queries; all writes go through this interface.
 * FileIpcService delegates to FileService (sole FS owner) for all operations.
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

  /** Create a file or directory entry. For files, content is processed by source type (path/base64/URL/buffer). */
  createEntry(params: CreateEntryParams): Promise<FileEntry>
  /** Batch create file entries (files only, no directories) */
  batchCreateEntries(params: {
    parentId: FileEntryId
    items: Array<{ name: string; content: FileContent }>
  }): Promise<BatchOperationResult>

  // ─── C. File Reading / Metadata ───

  /** Read file content as text */
  read(target: FileEntryId | FilePath, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
  /** Read file content as base64 */
  read(target: FileEntryId | FilePath, options: { encoding: 'base64' }): Promise<{ data: string; mime: string }>
  /** Read file content as binary */
  read(target: FileEntryId | FilePath, options: { encoding: 'binary' }): Promise<{ data: Uint8Array; mime: string }>
  /** Get physical file metadata (size, timestamps, and type-specific info like dimensions/pageCount) */
  getMetadata(target: FileEntryId | FilePath): Promise<PhysicalFileMetadata>

  // ─── D. Entry Deletion ───

  /** Move entry to Trash (soft delete) */
  trash(params: { id: FileEntryId }): Promise<void>
  /** Restore entry from Trash */
  restore(params: { id: FileEntryId }): Promise<FileEntry>
  /** Permanently delete entry and its physical file */
  permanentDelete(params: { id: FileEntryId }): Promise<void>
  /** Batch move entries to Trash */
  batchTrash(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
  /** Batch restore entries from Trash */
  batchRestore(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>
  /** Batch permanently delete entries */
  batchPermanentDelete(params: { ids: FileEntryId[] }): Promise<BatchOperationResult>

  // ─── E. Entry Move (includes rename) ───

  /** Move entry to new parent and/or rename (Unix mv semantics) */
  move(params: { id: FileEntryId; targetParentId: FileEntryId; newName?: string }): Promise<FileEntry>
  /** Batch move entries to target parent */
  batchMove(params: { ids: FileEntryId[]; targetParentId: FileEntryId }): Promise<BatchOperationResult>

  // ─── F. File Write / Copy ───

  /** Write content to an existing entry or external path (does not create a new entry) */
  write(target: FileEntryId | FilePath, data: string | Uint8Array): Promise<void>
  /** Copy entry within the file tree (creates a new entry with physical copy) */
  copy(params: { id: FileEntryId; targetParentId: FileEntryId; newName?: string }): Promise<FileEntry>
  /** Export entry's physical file to an external path (no new entry created) */
  copy(params: { id: FileEntryId; destPath: FilePath }): Promise<void>

  // ─── G. Validation ───

  /** Validate a directory path for use as the Notes mount basePath */
  validateNotesPath(dirPath: FilePath): Promise<boolean>

  // ─── H. System Operations ───

  /** Open file/directory with the system default application */
  open(target: FileEntryId | FilePath): Promise<void>
  /** Reveal file/directory in the system file manager */
  showInFolder(target: FileEntryId | FilePath): Promise<void>

  // ─── I. Directory Listing ───

  /** List contents of an external directory (not managed by the entry system) */
  listDirectory(dirPath: FilePath, options?: DirectoryListOptions): Promise<string[]>
}

// ─── External Types (re-used from Electron) ───

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface DirectoryListOptions {
  recursive?: boolean
  maxDepth?: number
  includeHidden?: boolean
  includeFiles?: boolean
  includeDirectories?: boolean
  maxEntries?: number
  searchPattern?: string
}
