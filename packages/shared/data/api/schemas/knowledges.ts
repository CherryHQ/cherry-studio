/**
 * Knowledge API Schema definitions
 *
 * Defines v2 DataApi endpoints for knowledge bases, items, and search operations.
 */

import type {
  EmbeddingModelMeta,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeItemData,
  KnowledgeItemType,
  KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import type { ItemStatus } from '@shared/data/types/knowledge'
import type { ModelMeta } from '@shared/data/types/meta'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a knowledge base.
 */
export interface CreateKnowledgeBaseDto {
  /** Knowledge base name */
  name: string
  /** Knowledge base description */
  description?: string
  /** Embedding model ID for vectorization */
  embeddingModelId: string
  /** Preserved embedding model info */
  embeddingModelMeta?: EmbeddingModelMeta
  /** Rerank model ID for search result reordering */
  rerankModelId?: string
  /** Preserved rerank model info */
  rerankModelMeta?: ModelMeta
  /** Preprocessing provider ID */
  preprocessProviderId?: string
  /** Chunk size for text splitting */
  chunkSize?: number
  /** Chunk overlap for text splitting */
  chunkOverlap?: number
  /** Similarity threshold for search */
  threshold?: number
  /** Number of documents to return in search results */
  documentCount?: number
}

/**
 * DTO for updating a knowledge base.
 */
export interface UpdateKnowledgeBaseDto extends Partial<CreateKnowledgeBaseDto> {}

/**
 * DTO for creating a knowledge item.
 */
export interface CreateKnowledgeItemDto {
  /** Item type: file, url, note, sitemap, or directory */
  type: KnowledgeItemType
  /** Type-specific data (discriminated union) */
  data: KnowledgeItemData
}

/**
 * DTO for updating a knowledge item.
 */
export interface UpdateKnowledgeItemDto {
  /** Updated item data */
  data?: KnowledgeItemData
  /** Processing status (internal use) */
  status?: ItemStatus
  /** Error message if processing failed */
  error?: string | null
}

/**
 * DTO for creating knowledge items (supports single or batch).
 */
export interface CreateKnowledgeItemsDto {
  /** Array of items to create (supports batch creation) */
  items: CreateKnowledgeItemDto[]
}

/**
 * Query parameters for knowledge search.
 */
export interface KnowledgeSearchRequest {
  /** Search query text */
  search: string
}

// ============================================================================
// Queue Status Types
// ============================================================================

/**
 * Queue status for a knowledge base.
 * Used to detect and handle orphan tasks (tasks stuck after app crash).
 */
export interface BaseQueueStatus {
  /** IDs of orphan items (stuck in incomplete status but not in active queue) */
  orphanItemIds: string[]
  /** IDs of items currently in the active queue */
  activeItemIds: string[]
  /** Number of items pending in the queue */
  pendingCount: number
}

/**
 * Response for recovering orphan tasks.
 */
export interface RecoverResponse {
  /** Number of tasks successfully recovered */
  recoveredCount: number
}

/**
 * Response for ignoring orphan tasks.
 */
export interface IgnoreResponse {
  /** Number of tasks marked as failed */
  ignoredCount: number
}

// ============================================================================
// API Schema Definitions
// ============================================================================

/**
 * Knowledge API Schema definitions
 *
 * Organized by domain responsibility:
 * - /knowledge-bases - Knowledge base CRUD
 * - /knowledge-bases/:id/items - Knowledge items management
 * - /knowledge-items/:id - Individual item operations
 * - /knowledge-bases/:id/search - Vector/hybrid search
 */
export interface KnowledgeSchemas {
  /**
   * Knowledge bases collection endpoint
   * @example GET /knowledge-bases
   * @example POST /knowledge-bases { "name": "My KB", "embeddingModelId": "model_123" }
   */
  '/knowledge-bases': {
    /** List all knowledge bases */
    GET: {
      response: KnowledgeBase[]
    }
    /** Create a new knowledge base */
    POST: {
      body: CreateKnowledgeBaseDto
      response: KnowledgeBase
    }
  }

  /**
   * Individual knowledge base endpoint
   * @example GET /knowledge-bases/kb123
   * @example PATCH /knowledge-bases/kb123 { "name": "Updated Name" }
   * @example DELETE /knowledge-bases/kb123
   */
  '/knowledge-bases/:id': {
    /** Get a knowledge base by ID */
    GET: {
      params: { id: string }
      response: KnowledgeBase
    }
    /** Update a knowledge base */
    PATCH: {
      params: { id: string }
      body: UpdateKnowledgeBaseDto
      response: KnowledgeBase
    }
    /** Delete a knowledge base and all its items */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  /**
   * Knowledge items sub-resource endpoint
   * @example GET /knowledge-bases/kb123/items
   * @example POST /knowledge-bases/kb123/items { "items": [...] }
   */
  '/knowledge-bases/:id/items': {
    /** List all items in a knowledge base */
    GET: {
      params: { id: string }
      response: KnowledgeItem[]
    }
    /** Create items in a knowledge base (supports batch) */
    POST: {
      params: { id: string }
      body: CreateKnowledgeItemsDto
      response: { items: KnowledgeItem[] }
    }
  }

  /**
   * Individual knowledge item endpoint
   * @example GET /knowledge-items/item123
   * @example PATCH /knowledge-items/item123 { "data": {...} }
   * @example DELETE /knowledge-items/item123
   */
  '/knowledge-items/:id': {
    /** Get a knowledge item by ID */
    GET: {
      params: { id: string }
      response: KnowledgeItem
    }
    /** Update a knowledge item */
    PATCH: {
      params: { id: string }
      body: UpdateKnowledgeItemDto
      response: KnowledgeItem
    }
    /** Delete a knowledge item and its vectors */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  /**
   * Reprocess endpoint for re-embedding a knowledge item
   * @example POST /knowledge-items/item123/reprocess
   */
  '/knowledge-items/:id/reprocess': {
    /** Reprocess a knowledge item (re-embed) */
    POST: {
      params: { id: string }
      response: KnowledgeItem
    }
  }

  /**
   * Search endpoint for vector/hybrid search
   * @example GET /knowledge-bases/kb123/search?search=query&mode=hybrid
   */
  '/knowledge-bases/:id/search': {
    /** Search knowledge base using vector/hybrid search */
    GET: {
      params: { id: string }
      query?: KnowledgeSearchRequest
      response: KnowledgeSearchResult[]
    }
  }

  /**
   * Queue status endpoint for monitoring and orphan task detection
   * @example GET /knowledge-bases/kb123/queue
   */
  '/knowledge-bases/:id/queue': {
    /** Get queue status including orphan tasks */
    GET: {
      params: { id: string }
      response: BaseQueueStatus
    }
  }

  /**
   * Recover orphan tasks by re-enqueueing them
   * @example POST /knowledge-bases/kb123/queue/recover
   */
  '/knowledge-bases/:id/queue/recover': {
    /** Recover orphan tasks for a knowledge base */
    POST: {
      params: { id: string }
      response: RecoverResponse
    }
  }

  /**
   * Ignore orphan tasks by marking them as failed
   * @example POST /knowledge-bases/kb123/queue/ignore
   */
  '/knowledge-bases/:id/queue/ignore': {
    /** Ignore orphan tasks (mark as failed) */
    POST: {
      params: { id: string }
      response: IgnoreResponse
    }
  }
}
