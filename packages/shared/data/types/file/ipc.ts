/**
 * File IPC type contracts
 *
 * Defines the parameter and return types for File IPC operations.
 * All file tree write operations that may affect the filesystem go through
 * FileIpcService (not DataApi). FileIpcService delegates to FileService
 * (sole FS owner), which coordinates FS ops and calls FileTreeService for DB sync.
 *
 * These types are shared between main (handler implementation) and
 * preload (method signatures exposed to renderer).
 */

import type { FileTreeNode, NodeId } from './node'

// ─── Content Source Types ───

/** Local filesystem path. Runtime validation required — pattern is intentionally broad for type-level hints only. */
export type FilePath = `/${string}` | `${string}:\\${string}` | `file://${string}`
export type Base64String = `data:${string};base64,${string}`
export type URLString = `http://${string}` | `https://${string}`
export type FileContent = FilePath | Base64String | URLString | Uint8Array

// ─── File Metadata (physical file info, separate from FileTreeNode) ───

type MetadataBase = { size: number; createdAt: number; modifiedAt: number }

type DirectoryMetadata = MetadataBase & { kind: 'directory' }

type FileMetadataCommon = MetadataBase & { kind: 'file'; mime: string }
type ImageFileMetadata = FileMetadataCommon & { type: 'image'; width: number; height: number }
type PdfFileMetadata = FileMetadataCommon & { type: 'pdf'; pageCount: number }
type TextFileMetadata = FileMetadataCommon & { type: 'text'; encoding: string }
type GenericFileMetadata = FileMetadataCommon & { type: 'other' }

type FileKindMetadata = ImageFileMetadata | PdfFileMetadata | TextFileMetadata | GenericFileMetadata
/** Physical file metadata (size, timestamps, and type-specific info). Discriminate on `kind`, then `type`. */
export type PhysicalFileMetadata = DirectoryMetadata | FileKindMetadata

// ─── CreateNode Params ───

export type CreateNodeParams =
  | { type: 'file'; parentId: NodeId; name: string; content: FileContent }
  | { type: 'dir'; parentId: NodeId; name: string }

// ─── Batch Result ───

export interface BatchOperationResult {
  succeeded: NodeId[]
  failed: Array<{ id: NodeId; error: string }>
}

// ─── File IPC API ───

/**
 * File IPC interface — the complete contract between renderer and main process
 * for all file operations that may affect the filesystem.
 *
 * DataApi handles read-only node queries; all writes go through this interface.
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

  // ─── B. Node Creation ───

  /** Create a file or directory node. For files, content is processed by source type (path/base64/URL/buffer). */
  createNode(params: CreateNodeParams): Promise<FileTreeNode>
  /** Batch create file nodes (files only, no directories) */
  batchCreateNodes(params: {
    parentId: NodeId
    items: Array<{ name: string; content: FileContent }>
  }): Promise<BatchOperationResult>

  // ─── C. File Reading / Metadata ───

  /** Read file content as text */
  read(target: NodeId | FilePath, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
  /** Read file content as base64 */
  read(target: NodeId | FilePath, options: { encoding: 'base64' }): Promise<{ data: string; mime: string }>
  /** Read file content as binary */
  read(target: NodeId | FilePath, options: { encoding: 'binary' }): Promise<{ data: Uint8Array; mime: string }>
  /** Get physical file metadata (size, timestamps, and type-specific info like dimensions/pageCount) */
  getMetadata(target: NodeId | FilePath): Promise<PhysicalFileMetadata>

  // ─── D. Node Deletion ───

  /** Move node to Trash (soft delete) */
  trash(params: { id: NodeId }): Promise<void>
  /** Restore node from Trash */
  restore(params: { id: NodeId }): Promise<FileTreeNode>
  /** Permanently delete node and its physical file */
  permanentDelete(params: { id: NodeId }): Promise<void>
  /** Batch move nodes to Trash */
  batchTrash(params: { ids: NodeId[] }): Promise<BatchOperationResult>
  /** Batch restore nodes from Trash */
  batchRestore(params: { ids: NodeId[] }): Promise<BatchOperationResult>
  /** Batch permanently delete nodes */
  batchPermanentDelete(params: { ids: NodeId[] }): Promise<BatchOperationResult>

  // ─── E. Node Move (includes rename) ───

  /** Move node to new parent and/or rename (Unix mv semantics) */
  move(params: { id: NodeId; targetParentId: NodeId; newName?: string }): Promise<FileTreeNode>
  /** Batch move nodes to target parent */
  batchMove(params: { ids: NodeId[]; targetParentId: NodeId }): Promise<BatchOperationResult>

  // ─── F. File Write / Copy ───

  /** Write content to an existing node or external path (does not create a new node) */
  write(target: NodeId | FilePath, data: string | Uint8Array): Promise<void>
  /** Copy node within the file tree (creates a new node with physical copy) */
  copy(params: { id: NodeId; targetParentId: NodeId; newName?: string }): Promise<FileTreeNode>
  /** Export node's physical file to an external path (no new node created) */
  copy(params: { id: NodeId; destPath: FilePath }): Promise<void>

  // ─── G. Validation ───

  /** Validate a directory path for use as the Notes mount basePath */
  validateNotesPath(dirPath: FilePath): Promise<boolean>

  // ─── H. System Operations ───

  /** Open file/directory with the system default application */
  open(target: NodeId | FilePath): Promise<void>
  /** Reveal file/directory in the system file manager */
  showInFolder(target: NodeId | FilePath): Promise<void>

  // ─── I. Directory Listing ───

  /** List contents of an external directory (not managed by the node system) */
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
