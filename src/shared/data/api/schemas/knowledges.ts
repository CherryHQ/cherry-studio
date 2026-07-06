/**
 * Knowledge DataApi schemas.
 *
 * Runtime/index operations are exposed through the KnowledgeService IpcApi routes
 * declared in `src/shared/ipc/schemas/knowledge`, not through DataApi.
 */

import type { CursorPaginationResponse, OffsetPaginationResponse } from '@shared/data/api/types'
import {
  type KnowledgeBase,
  KnowledgeBaseEntitySchema,
  KnowledgeBaseGroupIdInputSchema,
  type KnowledgeItem,
  KnowledgeItemTypeSchema
} from '@shared/data/types/knowledge'
import * as z from 'zod'

const KNOWLEDGE_BASE_MUTABLE_FIELDS = {
  name: true,
  groupId: true,
  embeddingModelId: true,
  dimensions: true,
  rerankModelId: true,
  fileProcessorId: true,
  chunkSize: true,
  chunkOverlap: true,
  chunkStrategy: true,
  chunkSeparator: true,
  threshold: true,
  documentCount: true,
  searchMode: true,
  hybridAlpha: true
} as const

// `embeddingModelId` and `dimensions` are mutable here only while the base has
// zero items — KnowledgeBaseService.update() enforces that server-side. Once
// items exist, changing either must go through the restore-into-a-new-base flow
// instead: changing either on a vector base invalidates its existing vectors,
// and adding a model to a BM25-only base still needs a full embedding backfill
// for those items.
export const UpdateKnowledgeBaseSchema = KnowledgeBaseEntitySchema.pick(KNOWLEDGE_BASE_MUTABLE_FIELDS)
  .partial()
  .extend({
    groupId: KnowledgeBaseGroupIdInputSchema.nullable().optional(),
    rerankModelId: KnowledgeBaseEntitySchema.shape.rerankModelId,
    fileProcessorId: KnowledgeBaseEntitySchema.shape.fileProcessorId,
    threshold: KnowledgeBaseEntitySchema.shape.threshold,
    documentCount: KnowledgeBaseEntitySchema.shape.documentCount,
    hybridAlpha: KnowledgeBaseEntitySchema.shape.hybridAlpha
  })
  .superRefine((value, ctx) => {
    // Paired like create/restore: a vector base needs both, a BM25-only base
    // needs neither. Only enforced when the caller is actually touching one of
    // them — omitting both leaves the existing pairing untouched.
    const embeddingModelIdProvided = value.embeddingModelId !== undefined
    const dimensionsProvided = value.dimensions !== undefined

    if (embeddingModelIdProvided !== dimensionsProvided) {
      ctx.addIssue({
        code: 'custom',
        path: ['dimensions'],
        message: 'Embedding model and dimensions must be provided together'
      })
      return
    }

    // Both provided: reject a half-null pair (e.g. a null model with a leftover
    // non-null dimensions) — presence alone isn't enough, since that combination
    // would otherwise reach the DB CHECK as an untranslated constraint violation.
    if (embeddingModelIdProvided && (value.embeddingModelId === null) !== (value.dimensions === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['dimensions'],
        message: 'Embedding model and dimensions must be both null or both set'
      })
    }
  })
export type UpdateKnowledgeBaseDto = z.input<typeof UpdateKnowledgeBaseSchema>

export const KNOWLEDGE_ITEMS_DEFAULT_LIMIT = 20
export const KNOWLEDGE_ITEMS_MAX_LIMIT = 100
export const KNOWLEDGE_BASES_DEFAULT_PAGE = 1
export const KNOWLEDGE_BASES_DEFAULT_LIMIT = 20
export const KNOWLEDGE_BASES_MAX_LIMIT = 100

export const ListKnowledgeBasesQuerySchema = z.strictObject({
  page: z.int().positive().default(KNOWLEDGE_BASES_DEFAULT_PAGE),
  limit: z.int().positive().max(KNOWLEDGE_BASES_MAX_LIMIT).default(KNOWLEDGE_BASES_DEFAULT_LIMIT),
  search: z.string().trim().min(1).optional(),
  updatedAtFrom: z.iso.datetime().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'name']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
})

export type ListKnowledgeBasesQueryParams = z.input<typeof ListKnowledgeBasesQuerySchema>
export type ListKnowledgeBasesQuery = z.output<typeof ListKnowledgeBasesQuerySchema>
export type KnowledgeBaseListItem = KnowledgeBase & {
  itemCount: number
}

/**
 * Query parameters for GET /knowledge-bases/:id/items
 *
 * Returns flat knowledge items for one knowledge base with optional filters,
 * using cursor-based pagination (keyset on `createdAt`/`id`) so concurrent
 * inserts during polling never duplicate or skip rows across pages.
 */
export const ListKnowledgeItemsQuerySchema = z.strictObject({
  /** Cursor returned by the previous page. Omitted for the first page. */
  cursor: z.string().optional(),
  limit: z.int().positive().max(KNOWLEDGE_ITEMS_MAX_LIMIT).default(KNOWLEDGE_ITEMS_DEFAULT_LIMIT),
  type: KnowledgeItemTypeSchema.optional(),
  groupId: z.string().nullable().optional()
})

// This schema declares `cursor` + `limit` inline (above), so `z.input` already covers the
// cursor-pagination params and the `& CursorPaginationParams` intersection would be redundant.
export type ListKnowledgeItemsQueryParams = z.input<typeof ListKnowledgeItemsQuerySchema>
export type ListKnowledgeItemsQuery = z.output<typeof ListKnowledgeItemsQuerySchema>

export interface KnowledgeItemListResponse extends CursorPaginationResponse<KnowledgeItem> {
  items: KnowledgeItem[]
  total: number
}

export type KnowledgeSchemas = {
  '/knowledge-bases': {
    GET: {
      query?: ListKnowledgeBasesQueryParams
      response: OffsetPaginationResponse<KnowledgeBaseListItem>
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
      response: KnowledgeItemListResponse
    }
  }

  '/knowledge-items/:id': {
    GET: {
      params: { id: string }
      response: KnowledgeItem
    }
  }
}
