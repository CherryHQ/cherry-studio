/**
 * Knowledge API Schema definitions
 *
 * Defines v2 DataApi endpoints for knowledge bases, items, and search operations.
 */

import type {
  OffsetPaginationParams,
  OffsetPaginationResponse,
  SearchParams,
  SortParams
} from '@shared/data/api/apiTypes'
import type {
  EmbeddingModelMeta,
  ItemStatus,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeItemData,
  KnowledgeItemType,
  KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import type { ModelMeta } from '@shared/data/types/meta'

// ============================================================================
// DTOs
// ============================================================================

/**
 * DTO for creating a knowledge base.
 */
export interface CreateKnowledgeBaseDto {
  name: string
  description?: string
  embeddingModelId: string
  embeddingModelMeta?: EmbeddingModelMeta
  rerankModelId?: string
  rerankModelMeta?: ModelMeta
  preprocessProviderId?: string
  chunkSize?: number
  chunkOverlap?: number
  threshold?: number
}

/**
 * DTO for updating a knowledge base.
 */
export interface UpdateKnowledgeBaseDto extends Partial<CreateKnowledgeBaseDto> {}

/**
 * DTO for creating a knowledge item.
 */
export interface CreateKnowledgeItemDto {
  type: KnowledgeItemType
  data: KnowledgeItemData
}

/**
 * DTO for updating a knowledge item.
 */
export interface UpdateKnowledgeItemDto {
  data?: KnowledgeItemData
  status?: ItemStatus
  error?: string | null
}

/**
 * DTO for creating knowledge items (supports single or batch).
 */
export interface CreateKnowledgeItemsDto {
  items: CreateKnowledgeItemDto[]
}

/**
 * Request payload for knowledge search.
 */
export interface KnowledgeSearchRequest {
  search: string
  mode?: 'default' | 'vector' | 'bm25' | 'hybrid'
  alpha?: number
  limit?: number
  rerank?: boolean
  filters?: {
    type?: KnowledgeItemType[]
    status?: ItemStatus[]
    createdAfter?: string
    createdBefore?: string
  }
}

// ============================================================================
// API Schema Definitions
// ============================================================================

export interface KnowledgeSchemas {
  '/knowledge-bases': {
    GET: {
      query?: OffsetPaginationParams & SortParams & SearchParams
      response: OffsetPaginationResponse<KnowledgeBase>
    }
    POST: {
      body: CreateKnowledgeBaseDto
      response: KnowledgeBase
    }
  }

  '/knowledge-bases/:id': {
    GET: {
      params: { id: string }
      response: KnowledgeBase
    }
    PATCH: {
      params: { id: string }
      body: UpdateKnowledgeBaseDto
      response: KnowledgeBase
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  '/knowledge-bases/:id/items': {
    GET: {
      params: { id: string }
      query?: OffsetPaginationParams &
        SortParams & {
          type?: KnowledgeItemType
          status?: ItemStatus
          search?: string
        }
      response: OffsetPaginationResponse<KnowledgeItem>
    }
    POST: {
      params: { id: string }
      body: CreateKnowledgeItemsDto
      response: { items: KnowledgeItem[] }
    }
  }

  '/knowledge-items/:id': {
    GET: {
      params: { id: string }
      response: KnowledgeItem
    }
    PATCH: {
      params: { id: string }
      body: UpdateKnowledgeItemDto
      response: KnowledgeItem
    }
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  '/knowledge-items/:id/refresh': {
    POST: {
      params: { id: string }
      response: KnowledgeItem
    }
  }

  '/knowledge-items/:id/cancel': {
    POST: {
      params: { id: string }
      response: { status: 'cancelled' | 'ignored' }
    }
  }

  '/knowledge-bases/:id/search': {
    POST: {
      params: { id: string }
      body: KnowledgeSearchRequest
      response: KnowledgeSearchResult[]
    }
  }

  '/knowledge-queue/status': {
    GET: {
      response: {
        queueSize: number
        processingCount: number
        currentWorkload: number
      }
    }
  }
}
