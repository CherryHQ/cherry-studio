/**
 * Knowledge API DTOs and schema contracts.
 */

import {
  DirectoryItemDataSchema,
  FileItemDataSchema,
  FileMetadataSchema,
  ItemStatusSchema,
  type KnowledgeBase,
  type KnowledgeItem,
  KnowledgeItemTypeSchema,
  KnowledgeSearchModeSchema,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  UrlItemDataSchema
} from '@shared/data/types/knowledge'
import * as z from 'zod'

import type { OffsetPaginationResponse } from '../apiTypes'

export const CreateKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  dimensions: z.number().int().positive(),
  embeddingModelId: z.string().trim().min(1),
  rerankModelId: z.string().optional(),
  fileProcessorId: z.string().optional(),
  chunkSize: z.number().optional(),
  chunkOverlap: z.number().optional(),
  threshold: z.number().optional(),
  documentCount: z.number().optional(),
  searchMode: KnowledgeSearchModeSchema.optional(),
  hybridAlpha: z.number().optional()
})
export type CreateKnowledgeBaseDto = z.infer<typeof CreateKnowledgeBaseSchema>

export const UpdateKnowledgeBaseSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    rerankModelId: z.string().nullable().optional(),
    fileProcessorId: z.string().nullable().optional(),
    chunkSize: z.number().nullable().optional(),
    chunkOverlap: z.number().nullable().optional(),
    threshold: z.number().nullable().optional(),
    documentCount: z.number().nullable().optional(),
    searchMode: KnowledgeSearchModeSchema.nullable().optional(),
    hybridAlpha: z.number().nullable().optional()
  })
  .strict()
export type UpdateKnowledgeBaseDto = z.infer<typeof UpdateKnowledgeBaseSchema>

export {
  DirectoryItemDataSchema,
  FileItemDataSchema,
  FileMetadataSchema,
  ItemStatusSchema,
  KnowledgeItemTypeSchema,
  KnowledgeSearchModeSchema,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  UrlItemDataSchema
}

export const CreateKnowledgeRootItemSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('file'),
      data: FileItemDataSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('url'),
      data: UrlItemDataSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('note'),
      data: NoteItemDataSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('sitemap'),
      data: SitemapItemDataSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('directory'),
      data: DirectoryItemDataSchema
    })
    .strict()
])
export type CreateKnowledgeRootItemDto = z.infer<typeof CreateKnowledgeRootItemSchema>

export const KNOWLEDGE_ITEMS_DEFAULT_PAGE = 1
export const KNOWLEDGE_ITEMS_DEFAULT_LIMIT = 20
export const KNOWLEDGE_ITEMS_MAX_LIMIT = 100
export const KNOWLEDGE_BASES_DEFAULT_PAGE = 1
export const KNOWLEDGE_BASES_DEFAULT_LIMIT = 20
export const KNOWLEDGE_BASES_MAX_LIMIT = 100

export const CreateKnowledgeRootChildrenSchema = z.object({
  items: z.array(CreateKnowledgeRootItemSchema).min(1).max(KNOWLEDGE_ITEMS_MAX_LIMIT)
})
export type CreateKnowledgeRootChildrenDto = z.infer<typeof CreateKnowledgeRootChildrenSchema>

export const UpdateKnowledgeItemDataSchema = z.union([
  FileItemDataSchema,
  UrlItemDataSchema,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  DirectoryItemDataSchema
])

export const UpdateKnowledgeItemSchema = z
  .object({
    data: UpdateKnowledgeItemDataSchema.optional(),
    status: ItemStatusSchema.optional(),
    error: z.string().nullable().optional()
  })
  .strict()
export type UpdateKnowledgeItemDto = z.infer<typeof UpdateKnowledgeItemSchema>

export const KnowledgeBaseListQuerySchema = z.object({
  page: z.int().positive().default(KNOWLEDGE_BASES_DEFAULT_PAGE),
  limit: z.int().positive().max(KNOWLEDGE_BASES_MAX_LIMIT).default(KNOWLEDGE_BASES_DEFAULT_LIMIT)
})

export type KnowledgeBaseListQueryParams = z.input<typeof KnowledgeBaseListQuerySchema>
export type KnowledgeBaseListQuery = z.output<typeof KnowledgeBaseListQuerySchema>

/**
 * Query parameters for GET /knowledge-bases/:id/root/children
 *
 * Returns direct children of the implicit root node for one knowledge base.
 * `type` is used by the tab UI to filter root-level items by item type.
 */
export const KnowledgeRootChildrenQuerySchema = z.object({
  page: z.int().positive().default(KNOWLEDGE_ITEMS_DEFAULT_PAGE),
  limit: z.int().positive().max(KNOWLEDGE_ITEMS_MAX_LIMIT).default(KNOWLEDGE_ITEMS_DEFAULT_LIMIT),
  type: KnowledgeItemTypeSchema.optional()
})

export type KnowledgeRootChildrenQueryParams = z.input<typeof KnowledgeRootChildrenQuerySchema>
export type KnowledgeRootChildrenQuery = z.output<typeof KnowledgeRootChildrenQuerySchema>

export const KnowledgeItemChildrenQuerySchema = z.object({
  page: z.int().positive().default(KNOWLEDGE_ITEMS_DEFAULT_PAGE),
  limit: z.int().positive().max(KNOWLEDGE_ITEMS_MAX_LIMIT).default(KNOWLEDGE_ITEMS_DEFAULT_LIMIT)
})

export type KnowledgeItemChildrenQueryParams = z.input<typeof KnowledgeItemChildrenQuerySchema>
export type KnowledgeItemChildrenQuery = z.output<typeof KnowledgeItemChildrenQuerySchema>

export interface KnowledgeSchemas {
  '/knowledge-bases': {
    GET: {
      query?: KnowledgeBaseListQueryParams
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

  '/knowledge-bases/:id/root/children': {
    /**
     * Direct children of the implicit root node for one knowledge base.
     *
     * This is the main entry for tab-based root rendering. It returns only
     * root-level items (`parentId IS NULL`) and supports optional type
     * filtering for the current tab.
     */
    GET: {
      params: { id: string }
      query?: KnowledgeRootChildrenQueryParams
      response: OffsetPaginationResponse<KnowledgeItem>
    }
    /**
     * Create root-level knowledge items.
     *
     * This endpoint only creates direct children of the implicit root node
     * for the knowledge base. Child-node creation is intentionally out of
     * scope for the current UI flow.
     */
    POST: {
      params: { id: string }
      body: CreateKnowledgeRootChildrenDto
      response: { items: KnowledgeItem[] }
    }
  }

  '/knowledge-items/:id/children': {
    /**
     * Direct children of one knowledge item.
     *
     * Returns only the immediate children of `:id`. It does not recursively
     * expand descendants.
     */
    GET: {
      params: { id: string }
      query?: KnowledgeItemChildrenQueryParams
      response: OffsetPaginationResponse<KnowledgeItem>
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
    /**
     * Delete a knowledge item subtree.
     *
     * The target item identified by `id` is removed together with all of its
     * descendants linked through `parentId`.
     */
    DELETE: {
      params: { id: string }
      response: void
    }
  }
}
