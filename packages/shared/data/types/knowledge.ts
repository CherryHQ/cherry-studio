import type { FileMetadata } from './file'
import type { ModelMeta } from './meta'

// ============================================================================
// Enum Types
// ============================================================================

/**
 * Knowledge item type
 * - file: Local file
 * - url: Web URL
 * - note: Text note
 * - sitemap: Sitemap URL
 * - directory: Local directory
 */
export type KnowledgeItemType = 'file' | 'url' | 'note' | 'sitemap' | 'directory'

/**
 * Item processing status
 * - idle: Not processed
 * - pending: Waiting to be processed
 * - ocr: OCR/document preprocessing in progress
 * - read: Reading and chunking content
 * - embed: Vector embedding and storing in progress
 * - completed: Processing completed
 * - failed: Processing failed
 */
export type ItemStatus = 'idle' | 'pending' | 'ocr' | 'read' | 'embed' | 'completed' | 'failed'

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Knowledge base configuration
 * @deprecated Use separate columns (chunkSize, chunkOverlap, threshold) instead of JSON config
 */
export interface KnowledgeBaseConfig {
  chunkSize?: number
  chunkOverlap?: number
  similarityThreshold?: number
}

/**
 * Embedding model metadata
 * Extends ModelMeta with embedding-specific fields
 */
export interface EmbeddingModelMeta extends ModelMeta {
  /** Vector dimensions */
  dimensions?: number
}

// ============================================================================
// Entity Types
// ============================================================================

/**
 * Knowledge base metadata stored in SQLite.
 */
export interface KnowledgeBase {
  id: string
  name: string
  description?: string
  embeddingModelId: string
  embeddingModelMeta?: EmbeddingModelMeta | null
  rerankModelId?: string
  rerankModelMeta?: ModelMeta | null
  preprocessProviderId?: string
  chunkSize?: number
  chunkOverlap?: number
  threshold?: number
  documentCount?: number
  createdAt: string
  updatedAt: string
}

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
  progress?: number
  createdAt: string
  updatedAt: string
}

/**
 * Tree node for hierarchical knowledge items.
 *
 * Root nodes have `item.parentId = null`.
 * Children are recursively represented in `children`.
 */
export interface KnowledgeItemTreeNode {
  item: KnowledgeItem
  children: KnowledgeItemTreeNode[]
}

/**
 * Directory container item data
 */
export interface DirectoryContainerData {
  /** Absolute directory path */
  path: string
  /** Whether directory scan is recursive */
  recursive: boolean
}

/**
 * Search result returned by vector search.
 */
export interface KnowledgeSearchResult {
  pageContent: string
  score: number
  metadata: Record<string, unknown>
  itemId?: string
  chunkId?: string
}

// ============================================================================
// Item Data Types (Discriminated Union)
// ============================================================================

/**
 * File item data
 */
export interface FileItemData {
  /** File metadata */
  file: FileMetadata
}

/**
 * URL item data
 */
export interface UrlItemData {
  /** Web URL */
  url: string
  /** User-defined name */
  name: string
}

/**
 * Note item data
 */
export interface NoteItemData {
  /** Note content */
  content: string
  /** Source URL (optional) */
  sourceUrl?: string
}

/**
 * Sitemap item data
 */
export interface SitemapItemData {
  /** Sitemap URL */
  url: string
  /** User-defined name */
  name: string
}

/**
 * Directory item data
 */
export interface DirectoryItemData {
  /** Group identifier for files within the same directory */
  groupId: string
  /** Directory path for UI grouping */
  groupName: string
  /** File metadata for the specific file entry */
  file: FileMetadata
}

/**
 * Union type of all knowledge item data types
 * Uses discriminated union pattern for type-safe access
 */
export type KnowledgeItemData =
  | FileItemData
  | UrlItemData
  | NoteItemData
  | SitemapItemData
  | DirectoryContainerData
  | DirectoryItemData
