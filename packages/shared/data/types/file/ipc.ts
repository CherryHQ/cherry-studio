/**
 * FileManager IPC type contracts
 *
 * Defines the parameter and return types for FileManager IPC operations.
 * All file tree write operations that may affect the filesystem go through
 * FileManager IPC (not DataApi). The FileManager handles FS operations
 * internally and calls data/service to synchronize the DB.
 *
 * These types are shared between main (handler implementation) and
 * preload (method signatures exposed to renderer).
 */

import type { FileTreeNode, NodeId } from './node'

// ─── Upload ───

export interface FileManagerUploadParams {
  /** Absolute OS file path */
  filePath: string
  /** Target parent node ID */
  parentId: NodeId
  /** Optional display name override (defaults to basename of filePath) */
  fileName?: string
}

// ─── Create Directory ───

export interface FileManagerCreateDirParams {
  /** Directory name */
  name: string
  /** Target parent node ID */
  parentId: NodeId
}

// ─── Rename ───

export interface FileManagerRenameParams {
  /** Node ID to rename */
  id: NodeId
  /** New full name (with extension for files, plain name for dirs) */
  newName: string
}

// ─── Move ───

export interface FileManagerMoveParams {
  /** Node ID to move */
  id: NodeId
  /** Target parent node ID (must be within the same mount) */
  targetParentId: NodeId
}

// ─── Single-node operations ───

export interface FileManagerNodeParams {
  /** Node ID */
  id: NodeId
}

// ─── Batch operations ───

export interface FileManagerBatchParams {
  /** Node IDs */
  ids: NodeId[]
}

export interface FileManagerBatchMoveParams {
  /** Node IDs */
  ids: NodeId[]
  /** Target parent node ID */
  targetParentId: NodeId
}

// ─── Batch result ───

export interface BatchOperationResult {
  succeeded: NodeId[]
  failed: Array<{ id: NodeId; error: string }>
}

// ─── Return type aliases (for documentation clarity) ───

/**
 * FileManager IPC method signatures (for reference).
 *
 * upload(params: FileManagerUploadParams): Promise<FileTreeNode>
 * createDir(params: FileManagerCreateDirParams): Promise<FileTreeNode>
 * rename(params: FileManagerRenameParams): Promise<FileTreeNode>
 * move(params: FileManagerMoveParams): Promise<FileTreeNode>
 * trash(params: FileManagerNodeParams): Promise<void>
 * restore(params: FileManagerNodeParams): Promise<FileTreeNode>
 * delete(params: FileManagerNodeParams): Promise<void>
 * batchTrash(params: FileManagerBatchParams): Promise<BatchOperationResult>
 * batchMove(params: FileManagerBatchMoveParams): Promise<BatchOperationResult>
 * batchDelete(params: FileManagerBatchParams): Promise<BatchOperationResult>
 * batchRestore(params: FileManagerBatchParams): Promise<BatchOperationResult>
 */
export type FileManagerApi = {
  upload: (params: FileManagerUploadParams) => Promise<FileTreeNode>
  createDir: (params: FileManagerCreateDirParams) => Promise<FileTreeNode>
  rename: (params: FileManagerRenameParams) => Promise<FileTreeNode>
  move: (params: FileManagerMoveParams) => Promise<FileTreeNode>
  trash: (params: FileManagerNodeParams) => Promise<void>
  restore: (params: FileManagerNodeParams) => Promise<FileTreeNode>
  delete: (params: FileManagerNodeParams) => Promise<void>
  batchTrash: (params: FileManagerBatchParams) => Promise<BatchOperationResult>
  batchMove: (params: FileManagerBatchMoveParams) => Promise<BatchOperationResult>
  batchDelete: (params: FileManagerBatchParams) => Promise<BatchOperationResult>
  batchRestore: (params: FileManagerBatchParams) => Promise<BatchOperationResult>
}
