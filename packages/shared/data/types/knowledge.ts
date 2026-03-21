import type { FileMetadata } from './file'

/**
 * Shared knowledge domain types.
 *
 * These types are referenced by DataApi schemas and DB schemas.
 */

export type KnowledgeItemType = 'file' | 'url' | 'note' | 'sitemap' | 'directory'

export type ItemStatus = 'idle' | 'pending' | 'ocr' | 'read' | 'embed' | 'completed' | 'failed'

export type KnowledgeSearchMode = 'default' | 'bm25' | 'hybrid'

/**
 * Knowledge base metadata stored in SQLite.
 */
export interface KnowledgeBase {
  id: string
  name: string
  description?: string
  dimensions: number
  embeddingModelId: string
  rerankModelId?: string
  fileProcessorId?: string
  chunkSize?: number
  chunkOverlap?: number
  threshold?: number
  documentCount?: number
  searchMode?: KnowledgeSearchMode
  hybridAlpha?: number
  createdAt: string
  updatedAt: string
}

/**
 * File item data.
 */
export interface FileItemData {
  file: FileMetadata
}

/**
 * URL item data.
 */
export interface UrlItemData {
  url: string
  name: string
}

/**
 * Note item data.
 */
export interface NoteItemData {
  content: string
  sourceUrl?: string
}

/**
 * Sitemap item data.
 */
export interface SitemapItemData {
  url: string
  name: string
}

/**
 * Directory container item data.
 */
export interface DirectoryContainerData {
  path: string
  recursive: boolean
}

/**
 * Directory file-entry item data.
 */
export interface DirectoryItemData {
  groupId: string
  groupName: string
  file: FileMetadata
}

export type DirectoryData = DirectoryContainerData | DirectoryItemData

export interface KnowledgeItemDataMap {
  file: FileItemData
  url: UrlItemData
  note: NoteItemData
  sitemap: SitemapItemData
  directory: DirectoryData
}

/**
 * JSON payload stored in `knowledge_item.data`.
 */
export type KnowledgeItemData = KnowledgeItemDataMap[KnowledgeItemType]

/**
 * Knowledge item record stored in SQLite.
 */
export type KnowledgeItemOf<T extends KnowledgeItemType> = {
  id: string
  baseId: string
  parentId?: string | null
  type: T
  data: KnowledgeItemDataMap[T]
  status: ItemStatus
  error?: string | null
  createdAt: string
  updatedAt: string
}

export type KnowledgeItem = {
  [T in KnowledgeItemType]: KnowledgeItemOf<T>
}[KnowledgeItemType]

/**
 * Tree node for hierarchical knowledge items.
 */
export interface KnowledgeItemTreeNode {
  item: KnowledgeItem
  children: KnowledgeItemTreeNode[]
}

/**
 * Search result returned by retrieval.
 */
export interface KnowledgeSearchResult {
  pageContent: string
  score: number
  metadata: Record<string, unknown>
  itemId?: string
  chunkId?: string
}
