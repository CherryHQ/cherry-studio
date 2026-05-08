/**
 * Knowledge DataApi schemas.
 *
 * Runtime/index operations are exposed through KnowledgeOrchestrationService
 * IPC contracts in `src/main/services/knowledge/types/ipc`, not through DataApi.
 */

import type { OffsetPaginationResponse } from '@shared/data/api'
import {
  type KnowledgeBase,
  KnowledgeBaseEntitySchema,
  type KnowledgeItem,
  KnowledgeItemTypeSchema
} from '@shared/data/types/knowledge'
import * as z from 'zod'

const KNOWLEDGE_BASE_MUTABLE_FIELDS = {
  name: true,
  groupId: true,
  emoji: true,
  rerankModelId: true,
  fileProcessorId: true,
  chunkSize: true,
  chunkOverlap: true,
  threshold: true,
  documentCount: true,
  searchMode: true,
  hybridAlpha: true
} as const

// `embeddingModelId` and `dimensions` are intentionally excluded: changing
// either invalidates existing vectors and must go through a runtime reindex flow.
export const UpdateKnowledgeBaseSchema = KnowledgeBaseEntitySchema.pick(KNOWLEDGE_BASE_MUTABLE_FIELDS)
  .partial()
  .extend({
    rerankModelId: KnowledgeBaseEntitySchema.shape.rerankModelId,
    fileProcessorId: KnowledgeBaseEntitySchema.shape.fileProcessorId,
    threshold: KnowledgeBaseEntitySchema.shape.threshold,
    documentCount: KnowledgeBaseEntitySchema.shape.documentCount,
    hybridAlpha: KnowledgeBaseEntitySchema.shape.hybridAlpha
  })
export type UpdateKnowledgeBaseDto = z.input<typeof UpdateKnowledgeBaseSchema>

export const KNOWLEDGE_ITEMS_DEFAULT_PAGE = 1
export const KNOWLEDGE_ITEMS_DEFAULT_LIMIT = 20
export const KNOWLEDGE_ITEMS_MAX_LIMIT = 100
export const KNOWLEDGE_BASES_DEFAULT_PAGE = 1
export const KNOWLEDGE_BASES_DEFAULT_LIMIT = 20
export const KNOWLEDGE_BASES_MAX_LIMIT = 100

export const ListKnowledgeBasesQuerySchema = z.strictObject({
  page: z.int().positive().default(KNOWLEDGE_BASES_DEFAULT_PAGE),
  limit: z.int().positive().max(KNOWLEDGE_BASES_MAX_LIMIT).default(KNOWLEDGE_BASES_DEFAULT_LIMIT)
})

export type ListKnowledgeBasesQueryParams = z.input<typeof ListKnowledgeBasesQuerySchema>
export type ListKnowledgeBasesQuery = z.output<typeof ListKnowledgeBasesQuerySchema>

/**
 * Query parameters for GET /knowledge-bases/:id/items
 *
 * Returns flat knowledge items for one knowledge base with optional filters.
 */
export const ListKnowledgeItemsQuerySchema = z.strictObject({
  page: z.int().positive().default(KNOWLEDGE_ITEMS_DEFAULT_PAGE),
  limit: z.int().positive().max(KNOWLEDGE_ITEMS_MAX_LIMIT).default(KNOWLEDGE_ITEMS_DEFAULT_LIMIT),
  type: KnowledgeItemTypeSchema.optional(),
  groupId: z.string().nullable().optional()
})

export type ListKnowledgeItemsQueryParams = z.input<typeof ListKnowledgeItemsQuerySchema>
export type ListKnowledgeItemsQuery = z.output<typeof ListKnowledgeItemsQuerySchema>

export type KnowledgeSchemas = {
  '/knowledge-bases': {
    GET: {
      query?: ListKnowledgeBasesQueryParams
      response: OffsetPaginationResponse<KnowledgeBase>
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
  }

  '/knowledge-bases/:id/items': {
    /**
     * Flat knowledge items for one knowledge base.
     */
    GET: {
      params: { id: string }
      query?: ListKnowledgeItemsQueryParams
      response: OffsetPaginationResponse<KnowledgeItem>
    }
  }

  '/knowledge-items/:id': {
    GET: {
      params: { id: string }
      response: KnowledgeItem
    }
  }
}
