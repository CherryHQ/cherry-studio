/**
 * Knowledge API Schema definitions.
 */

import type {
  ItemStatus,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeItemData,
  KnowledgeItemDataMap,
  KnowledgeItemTreeNode,
  KnowledgeItemType,
  KnowledgeSearchMode
} from '@shared/data/types/knowledge'

// ============================================================================
// DTOs
// ============================================================================

export interface CreateKnowledgeBaseDto {
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
}

export interface UpdateKnowledgeBaseDto extends Partial<CreateKnowledgeBaseDto> {}

export type CreateKnowledgeItemDto = {
  [T in KnowledgeItemType]: {
    type: T
    data: KnowledgeItemDataMap[T]
    parentId?: string
  }
}[KnowledgeItemType]

export interface CreateKnowledgeItemsDto {
  items: CreateKnowledgeItemDto[]
}

export interface UpdateKnowledgeItemDto {
  data?: KnowledgeItemData
  status?: ItemStatus
  error?: string | null
}

// ============================================================================
// API Schema Definitions
// ============================================================================

export interface KnowledgeSchemas {
  '/knowledge-bases': {
    GET: {
      response: KnowledgeBase[]
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
      response: KnowledgeItemTreeNode[]
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
}
