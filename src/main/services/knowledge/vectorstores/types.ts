/**
 * Core type definitions for KnowledgeServiceV2 vectorstores integration
 */

import type { FileMetadata } from '@shared/data/types/file'
import type { KnowledgeBase, KnowledgeItem, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import type { BaseNode, Metadata } from '@vectorstores/core'

import type { ResolvedKnowledgeBase } from '../KnowledgeProviderAdapter'

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
  base: ResolvedKnowledgeBase
  /** Item being read */
  item: KnowledgeItem
  /** external_id for tracking (maps to item.id) */
  itemId: string
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
}

// ============================================================================
// Service API Types
// ============================================================================

/**
 * Options for adding items to knowledge base
 */
export type KnowledgeProcessingStage = 'preprocessing' | 'embedding'

/**
 * Stages for knowledge queue processing.
 * - read: Reading content from source (file, URL, etc.)
 * - embed: Generating embeddings for content nodes
 * - write: Writing embedded nodes to vector store
 */
export type KnowledgeQueueStage = 'read' | 'embed' | 'write'

export type KnowledgeStageRunner = <T>(stage: KnowledgeQueueStage, task: () => Promise<T>) => Promise<T>

export interface KnowledgeBaseAddItemOptions {
  base: KnowledgeBase
  item: KnowledgeItem
  userId?: string
  signal?: AbortSignal
  onStageChange?: (stage: KnowledgeProcessingStage) => void
  onProgress?: (stage: KnowledgeProcessingStage, progress: number) => void
  runStage?: KnowledgeStageRunner
}

/**
 * Options for removing items from knowledge base
 */
export interface KnowledgeBaseRemoveOptions {
  uniqueId: string
  uniqueIds: string[]
  base: KnowledgeBase
  externalId?: string
  itemType?: KnowledgeItem['type']
}

/**
 * Options for search operations
 */
export interface SearchOptions {
  search: string
  base: KnowledgeBase
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
  base: KnowledgeBase
  results: KnowledgeSearchResult[]
}

// ============================================================================
// Queue Types
// ============================================================================

/**
 * Queue configuration
 */
/**
 * Internal task item for queue processing
 */
export interface QueuedTask<T = void> {
  /** Task identifier */
  id: string
  /** Task execution function */
  task: () => Promise<T>
  /** Estimated workload in bytes */
  workload: number
  /** Resolve callback */
  resolve: (result: T) => void
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

/** 1 MB constant for workload estimation */
export const MB = 1024 * 1024
