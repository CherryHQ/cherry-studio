/**
 * Knowledge API DTOs and schema contracts.
 */

import type {
  ItemStatus,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeItemDataMap,
  KnowledgeSearchMode
} from '@shared/data/types/knowledge'

import type { OffsetPaginationResponse } from '../apiTypes'

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

export interface UpdateKnowledgeBaseDto {
  name?: string
  description?: string | null
  rerankModelId?: string | null
  fileProcessorId?: string | null
  chunkSize?: number | null
  chunkOverlap?: number | null
  threshold?: number | null
  documentCount?: number | null
  searchMode?: KnowledgeSearchMode | null
  hybridAlpha?: number | null
}

export type CreateKnowledgeItemDto =
  | {
      parentId?: string | null
      type: 'file'
      data: KnowledgeItemDataMap['file']
    }
  | {
      parentId?: string | null
      type: 'url'
      data: KnowledgeItemDataMap['url']
    }
  | {
      parentId?: string | null
      type: 'note'
      data: KnowledgeItemDataMap['note']
    }
  | {
      parentId?: string | null
      type: 'sitemap'
      data: KnowledgeItemDataMap['sitemap']
    }
  | {
      parentId?: string | null
      type: 'directory'
      data: KnowledgeItemDataMap['directory']
    }

export interface CreateKnowledgeItemsDto {
  items: CreateKnowledgeItemDto[]
}

export interface UpdateKnowledgeItemDto {
  data?:
    | KnowledgeItemDataMap['file']
    | KnowledgeItemDataMap['url']
    | KnowledgeItemDataMap['note']
    | KnowledgeItemDataMap['sitemap']
    | KnowledgeItemDataMap['directory']
  status?: ItemStatus
  error?: string | null
}

export const KNOWLEDGE_ITEMS_DEFAULT_PAGE = 1
export const KNOWLEDGE_ITEMS_DEFAULT_LIMIT = 20
export const KNOWLEDGE_ITEMS_MAX_LIMIT = 100

export interface KnowledgeItemsQueryParams {
  page?: number
  limit?: number
  parentId?: string
}

export interface KnowledgeItemsQuery {
  page: number
  limit: number
  parentId?: string
}

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
      query?: KnowledgeItemsQueryParams
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
}
