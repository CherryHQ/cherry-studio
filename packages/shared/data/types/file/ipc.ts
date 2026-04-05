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

// ─── Content Source Types ───

export type FilePath = `/${string}` | `${string}:${string}` | `file://${string}`
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
/** Physical file metadata, separate from FileTreeNode. Not exported to avoid conflict with v1 FileMetadata. */
type PhysicalFileMetadata = DirectoryMetadata | FileKindMetadata

// ─── CreateNode Params ───

export type CreateNodeParams =
  | { type: 'file'; parentId: NodeId; name: string; content: FileContent }
  | { type: 'dir'; parentId: NodeId; name: string }

// ─── Batch Result ───

export interface BatchOperationResult {
  succeeded: NodeId[]
  failed: Array<{ id: NodeId; error: string }>
}

// ─── FileManager API ───

export type FileManagerApi = {
  // A. 文件选择 / 对话框
  select(options: {
    directory?: never
    multiple?: false
    filters?: FileFilter[]
    title?: string
  }): Promise<string | null>
  select(options: { directory?: never; multiple: true; filters?: FileFilter[]; title?: string }): Promise<string[]>
  select(options: { directory: true; title?: string }): Promise<string | null>
  save(options: { content: string | Uint8Array; defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>

  // B. 节点创建
  createNode(params: CreateNodeParams): Promise<FileTreeNode>
  batchCreateNodes(params: {
    parentId: NodeId
    items: Array<{ name: string; content: FileContent }>
  }): Promise<BatchOperationResult>

  // C. 文件读取 / 元信息
  read(target: NodeId | FilePath, options?: { encoding?: 'text'; detectEncoding?: boolean }): Promise<string>
  read(target: NodeId | FilePath, options: { encoding: 'base64' }): Promise<{ data: string; mime: string }>
  read(target: NodeId | FilePath, options: { encoding: 'binary' }): Promise<{ data: Uint8Array; mime: string }>
  getMetadata(target: NodeId | FilePath): Promise<PhysicalFileMetadata>

  // D. 节点删除
  trash(params: { id: NodeId }): Promise<void>
  restore(params: { id: NodeId }): Promise<FileTreeNode>
  permanentDelete(params: { id: NodeId }): Promise<void>
  batchTrash(params: { ids: NodeId[] }): Promise<BatchOperationResult>
  batchRestore(params: { ids: NodeId[] }): Promise<BatchOperationResult>
  batchPermanentDelete(params: { ids: NodeId[] }): Promise<BatchOperationResult>

  // E. 节点移动（含重命名）
  move(params: { id: NodeId; targetParentId: NodeId; newName?: string }): Promise<FileTreeNode>
  batchMove(params: { ids: NodeId[]; targetParentId: NodeId }): Promise<BatchOperationResult>

  // F. 文件写入 / 复制
  write(target: NodeId | FilePath, data: string | Uint8Array): Promise<void>
  copy(params: { id: NodeId; targetParentId: NodeId; newName?: string }): Promise<FileTreeNode>
  copy(params: { id: NodeId; destPath: FilePath }): Promise<void>

  // G. 校验
  validateNotesPath(dirPath: FilePath): Promise<boolean>

  // H. 系统操作
  open(target: NodeId | FilePath): Promise<void>
  showInFolder(target: NodeId | FilePath): Promise<void>

  // I. 目录扫描
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
