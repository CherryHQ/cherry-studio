/**
 * Knowledge DataApi schemas.
 *
 * Runtime/index operations are exposed through KnowledgeOrchestrationService
 * IPC contracts in `src/main/services/knowledge/types/ipc`, not through DataApi.
 */

import type { OffsetPaginationResponse } from '@shared/data/api'
import {
  type KnowledgeBase,
  KnowledgeBaseEmojiSchema,
  KnowledgeBaseSchema,
  KnowledgeChunkOverlapSchema,
  KnowledgeChunkSizeSchema,
  KnowledgeDocumentCountSchema,
  KnowledgeHybridAlphaSchema,
  type KnowledgeItem,
  KnowledgeItemTypeSchema,
  KnowledgeSearchModeSchema,
  KnowledgeThresholdSchema
} from '@shared/data/types/knowledge'
import * as z from 'zod'

export const UpdateKnowledgeBaseSchema = KnowledgeBaseSchema.pick({
  groupId: true
})
  .partial()
  .extend({
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    emoji: KnowledgeBaseEmojiSchema.optional(),
    rerankModelId: z.string().nullable().optional(),
    fileProcessorId: z.string().nullable().optional(),
    chunkSize: KnowledgeChunkSizeSchema.optional(),
    chunkOverlap: KnowledgeChunkOverlapSchema.optional(),
    threshold: KnowledgeThresholdSchema.nullable().optional(),
    documentCount: KnowledgeDocumentCountSchema.nullable().optional(),
    searchMode: KnowledgeSearchModeSchema.nullable().optional(),
    hybridAlpha: KnowledgeHybridAlphaSchema.nullable().optional()
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
