/**
 * Core type definitions for KnowledgeServiceV2 vectorstores integration
 */

import type { FileMetadata } from '@shared/data/types/file'
import type {
  ItemStatus,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeItemType,
  KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import type { BaseNode, Metadata } from '@vectorstores/core'

import type { ResolvedKnowledgeBase } from './KnowledgeProviderAdapter'

/**
 * Result returned by all content readers
 */
export interface ReaderResult {
  /** Nodes ready for embedding (without embeddings yet) */
  nodes: BaseNode<Metadata>[]
}

/**
 * Context passed to readers containing all necessary information
 */
export interface ReaderContext {
  /** Knowledge base configuration */
  base: ResolvedKnowledgeBase
  /** Item being read */
  item: KnowledgeItem
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
 * Knowledge processing stages - derived from ItemStatus.
 * - ocr: OCR/document preprocessing (PDF parsing, image recognition, etc.)
 * - read: Reading content from source and chunking
 * - embed: Generating embeddings and storing in vector database
 */
export type KnowledgeStage = Extract<ItemStatus, 'ocr' | 'read' | 'embed'>

export type KnowledgeStageRunner = <T>(stage: KnowledgeStage, task: () => Promise<T>) => Promise<T>

/**
 * Options for removing items from knowledge base
 */
export interface KnowledgeBaseRemoveOptions {
  base: KnowledgeBase
  item: KnowledgeItem
}

/**
 * Options for search operations
 */
export interface SearchOptions {
  search: string
  base: KnowledgeBase
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

/** 1 MB constant for workload estimation */
export const MB = 1024 * 1024

export const DEFAULT_DOCUMENT_COUNT = 6
export const DEFAULT_RELEVANT_SCORE = 0
