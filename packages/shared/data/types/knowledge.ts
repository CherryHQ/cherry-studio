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
 * Item processing status (merged with processing stage)
 * - idle: Not processed
 * - pending: Waiting to be processed
 * - preprocessing: Document preprocessing in progress
 * - embedding: Vector embedding in progress
 * - completed: Processing completed
 * - failed: Processing failed
 */
export type ItemStatus = 'idle' | 'pending' | 'preprocessing' | 'embedding' | 'completed' | 'failed'

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
// Item Data Types (Discriminated Union)
// ============================================================================

/**
 * File item data
 */
export interface FileItemData {
  type: 'file'
  /** File metadata */
  file: FileMetadata
}

/**
 * URL item data
 */
export interface UrlItemData {
  type: 'url'
  /** Web URL */
  url: string
  /** User-defined name */
  name: string
}

/**
 * Note item data
 */
export interface NoteItemData {
  type: 'note'
  /** Note content */
  content: string
  /** Source URL (optional) */
  sourceUrl?: string
}

/**
 * Sitemap item data
 */
export interface SitemapItemData {
  type: 'sitemap'
  /** Sitemap URL */
  url: string
  /** User-defined name */
  name: string
}

/**
 * Directory item data
 */
export interface DirectoryItemData {
  type: 'directory'
  /** Directory path */
  path: string
}

/**
 * Union type of all knowledge item data types
 * Uses discriminated union pattern for type-safe access
 */
export type KnowledgeItemData = FileItemData | UrlItemData | NoteItemData | SitemapItemData | DirectoryItemData
