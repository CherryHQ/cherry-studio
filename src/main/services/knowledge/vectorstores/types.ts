/**
 * Core type definitions for KnowledgeServiceV2 vectorstores integration
 */

import type { LoaderReturn } from '@shared/config/types'
import type { FileMetadata, KnowledgeBaseParams, KnowledgeItem, KnowledgeSearchResult } from '@types'
import type { BaseNode, Metadata } from '@vectorstores/core'

// ============================================================================
// Reader Types
// ============================================================================

/**
 * Knowledge item type for reader selection
 */
export type KnowledgeItemType = 'file' | 'url' | 'note' | 'sitemap' | 'directory'

/**
 * Result returned by all content readers
 */
export interface ReaderResult {
  /** Nodes ready for embedding (without embeddings yet) */
  nodes: BaseNode<Metadata>[]
  /** Unique identifier for this read operation */
  uniqueId: string
  /** Type name for debugging/logging */
  readerType: string
}

/**
 * Context passed to readers containing all necessary information
 */
export interface ReaderContext {
  /** Knowledge base configuration */
  base: KnowledgeBaseParams
  /** Item being read */
  item: KnowledgeItem
  /** external_id for tracking (maps to item.id) */
  itemId: string
  /** Force reload even if exists */
  forceReload?: boolean
  /** User ID for preprocessing services */
  userId?: string
}

/**
 * Base interface for all content readers
 */
export interface ContentReader {
  /** Content type this reader handles */
  readonly type: KnowledgeItemType

  /**
   * Read content and return nodes (without embeddings)
   * @param context Reader context with base, item, and other info
   * @returns Promise resolving to ReaderResult with nodes
   */
  read(context: ReaderContext): Promise<ReaderResult>

  /**
   * Estimate workload in bytes (for queue management)
   * @param context Reader context
   * @returns Estimated workload in bytes
   */
  estimateWorkload(context: ReaderContext): number
}

// ============================================================================
// Service API Types
// ============================================================================

/**
 * Options for adding items to knowledge base
 * Compatible with v1 KnowledgeService API
 */
export interface KnowledgeBaseAddItemOptions {
  base: KnowledgeBaseParams
  item: KnowledgeItem
  forceReload?: boolean
  userId?: string
}

/**
 * Options for removing items from knowledge base
 */
export interface KnowledgeBaseRemoveOptions {
  uniqueId: string
  uniqueIds: string[]
  base: KnowledgeBaseParams
  externalId?: string
  itemType?: KnowledgeItem['type']
}

/**
 * Options for search operations
 */
export interface SearchOptions {
  search: string
  base: KnowledgeBaseParams
  /** Search mode: vector (default), bm25, or hybrid */
  mode?: 'default' | 'bm25' | 'hybrid'
  /** Alpha value for hybrid search (0-1, default 0.5) */
  alpha?: number
}

/**
 * Options for rerank operations
 */
export interface RerankOptions {
  search: string
  base: KnowledgeBaseParams
  results: KnowledgeSearchResult[]
}

// ============================================================================
// Queue Types
// ============================================================================

/**
 * Queue configuration
 */
export interface QueueConfig {
  /** Maximum total workload in bytes (default: 80MB) */
  maxWorkload: number
  /** Maximum concurrent tasks (default: 30) */
  maxConcurrent: number
  /** Maximum retry attempts (default: 3) */
  retryAttempts: number
}

/**
 * Internal task item for queue processing
 */
export interface QueuedTask {
  /** Task identifier */
  id: string
  /** Task execution function */
  task: () => Promise<LoaderReturn>
  /** Estimated workload in bytes */
  workload: number
  /** Resolve callback */
  resolve: (result: LoaderReturn) => void
  /** Reject callback */
  reject: (error: Error) => void
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * File content from KnowledgeItem
 */
export type FileContent = FileMetadata

/**
 * String content from KnowledgeItem (url, note, sitemap, directory)
 */
export type StringContent = string

/**
 * Extract content type based on item type
 */
export type ItemContent<T extends KnowledgeItemType> = T extends 'file' ? FileContent : StringContent

// ============================================================================
// Constants
// ============================================================================

/** Default chunk size for text splitting */
export const DEFAULT_CHUNK_SIZE = 1024

/** Default chunk overlap for text splitting */
export const DEFAULT_CHUNK_OVERLAP = 20

/** Default document count for search results */
export const DEFAULT_DOCUMENT_COUNT = 30

/** Maximum workload in bytes (80MB) */
export const MAX_WORKLOAD = 80 * 1024 * 1024

/** Maximum concurrent processing items */
export const MAX_CONCURRENT = 30

/** 1 MB constant for workload estimation */
export const MB = 1024 * 1024
