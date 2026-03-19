import type { FileMetadata } from './file'
import type { ModelMeta } from './meta'

/**
 * Shared knowledge domain types.
 *
 * These types are referenced by DataApi schemas and DB schemas.
 */

export type KnowledgeItemType = 'file' | 'url' | 'note' | 'sitemap' | 'directory'

export type ItemStatus = 'idle' | 'pending' | 'ocr' | 'read' | 'embed' | 'completed' | 'failed'

export type KnowledgeSearchMode = 'default' | 'bm25' | 'hybrid'

/**
 * Embedding model metadata.
 */
export interface EmbeddingModelMeta extends ModelMeta {
  dimensions?: number
}

/**
 * Knowledge base metadata stored in SQLite.
 */
export interface KnowledgeBase {
  id: string
  name: string
  description?: string
  dimensions: number
  embeddingModelId: string
  embeddingModelMeta?: EmbeddingModelMeta | null
  rerankModelId?: string
  rerankModelMeta?: ModelMeta | null
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

/**
 * JSON payload stored in `knowledge_item.data`.
 */
export type KnowledgeItemData =
  | FileItemData
  | UrlItemData
  | NoteItemData
  | SitemapItemData
  | DirectoryContainerData
  | DirectoryItemData

/**
 * Knowledge item record stored in SQLite.
 */
export interface KnowledgeItem {
  id: string
  baseId: string
  parentId?: string | null
  type: KnowledgeItemType
  data: KnowledgeItemData
  status: ItemStatus
  error?: string | null
  createdAt: string
  updatedAt: string
}

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
