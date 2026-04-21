/**
 * Knowledge API DTOs and schema contracts.
 */

import type { OffsetPaginationResponse } from '@shared/data/api'
import {
  DEFAULT_KNOWLEDGE_BASE_EMOJI,
  DirectoryItemDataSchema,
  FileItemDataSchema,
  FileMetadataSchema,
  type KnowledgeBase,
  KnowledgeBaseEmojiSchema,
  KnowledgeBaseGroupIdSchema,
  KnowledgeChunkOverlapSchema,
  KnowledgeChunkSizeSchema,
  KnowledgeDocumentCountSchema,
  KnowledgeHybridAlphaSchema,
  type KnowledgeItem,
  KnowledgeItemStatusSchema,
  KnowledgeItemTypeSchema,
  KnowledgeSearchModeSchema,
  KnowledgeThresholdSchema,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  UrlItemDataSchema
} from '@shared/data/types/knowledge'
import * as z from 'zod'

export const CreateKnowledgeBaseSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().optional(),
    groupId: KnowledgeBaseGroupIdSchema.optional(),
    emoji: KnowledgeBaseEmojiSchema.default(DEFAULT_KNOWLEDGE_BASE_EMOJI),
    dimensions: z.number().int().positive(),
    embeddingModelId: z.string().trim().min(1),
    rerankModelId: z.string().optional(),
    fileProcessorId: z.string().optional(),
    chunkSize: KnowledgeChunkSizeSchema.optional(),
    chunkOverlap: KnowledgeChunkOverlapSchema.optional(),
    threshold: KnowledgeThresholdSchema.optional(),
    documentCount: KnowledgeDocumentCountSchema.optional(),
    searchMode: KnowledgeSearchModeSchema.optional(),
    hybridAlpha: KnowledgeHybridAlphaSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.chunkOverlap != null && value.chunkSize == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['chunkSize'],
        message: 'Chunk size is required when chunk overlap is provided'
      })
    }
  })
export type CreateKnowledgeBaseDto = z.input<typeof CreateKnowledgeBaseSchema>

export const UpdateKnowledgeBaseSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    groupId: KnowledgeBaseGroupIdSchema.optional(),
    emoji: KnowledgeBaseEmojiSchema.optional(),
    embeddingModelId: z.string().trim().min(1).optional(),
    rerankModelId: z.string().nullable().optional(),
    fileProcessorId: z.string().nullable().optional(),
    chunkSize: KnowledgeChunkSizeSchema.optional(),
    chunkOverlap: KnowledgeChunkOverlapSchema.optional(),
    threshold: KnowledgeThresholdSchema.nullable().optional(),
    documentCount: KnowledgeDocumentCountSchema.nullable().optional(),
    searchMode: KnowledgeSearchModeSchema.nullable().optional(),
    hybridAlpha: KnowledgeHybridAlphaSchema.nullable().optional()
  })
  .strict()
export type UpdateKnowledgeBaseDto = z.input<typeof UpdateKnowledgeBaseSchema>

export {
  DirectoryItemDataSchema,
  FileItemDataSchema,
  FileMetadataSchema,
  KnowledgeItemStatusSchema,
  KnowledgeItemTypeSchema,
  KnowledgeSearchModeSchema,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  UrlItemDataSchema
}

const CreateKnowledgeItemBaseSchema = z
  .object({
    ref: z.string().trim().min(1).optional(),
    groupId: z.string().nullable().optional(),
    groupRef: z.string().trim().min(1).optional()
  })
  .strict()

type CreateKnowledgeItemReferenceInput = z.input<typeof CreateKnowledgeItemBaseSchema>

function validateCreateKnowledgeItemReferences(item: CreateKnowledgeItemReferenceInput, ctx: z.RefinementCtx): void {
  if (item.groupId != null && item.groupRef != null) {
    ctx.addIssue({
      code: 'custom',
      path: ['groupRef'],
      message: 'Knowledge items cannot specify both groupId and groupRef'
    })
  }
}

export function getCreateKnowledgeItemsReferenceErrors(
  items: CreateKnowledgeItemReferenceInput[]
): Record<string, string[]> {
  const refs = new Set<string>()
  const duplicateRefs = new Set<string>()
  const missingGroupRefs = new Set<string>()

  for (const item of items) {
    if (item.ref) {
      if (refs.has(item.ref)) {
        duplicateRefs.add(item.ref)
      } else {
        refs.add(item.ref)
      }
    }
  }

  for (const item of items) {
    if (item.groupId == null && item.groupRef && !refs.has(item.groupRef)) {
      missingGroupRefs.add(item.groupRef)
    }
  }

  const fieldErrors: Record<string, string[]> = {}

  if (duplicateRefs.size > 0) {
    fieldErrors.ref = [`Duplicate knowledge item refs in request batch: ${[...duplicateRefs].join(', ')}`]
  }

  if (missingGroupRefs.size > 0) {
    fieldErrors.groupRef = [`Knowledge item group ref not found in request batch: ${[...missingGroupRefs].join(', ')}`]
  }

  return fieldErrors
}

export const CreateKnowledgeItemSchema = z.discriminatedUnion('type', [
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('file'),
    data: FileItemDataSchema
  }).superRefine(validateCreateKnowledgeItemReferences),
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('url'),
    data: UrlItemDataSchema
  }).superRefine(validateCreateKnowledgeItemReferences),
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('note'),
    data: NoteItemDataSchema
  }).superRefine(validateCreateKnowledgeItemReferences),
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('sitemap'),
    data: SitemapItemDataSchema
  }).superRefine(validateCreateKnowledgeItemReferences),
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('directory'),
    data: DirectoryItemDataSchema
  }).superRefine(validateCreateKnowledgeItemReferences)
])
export type CreateKnowledgeItemDto = z.infer<typeof CreateKnowledgeItemSchema>

export const KNOWLEDGE_ITEMS_DEFAULT_PAGE = 1
export const KNOWLEDGE_ITEMS_DEFAULT_LIMIT = 20
export const KNOWLEDGE_ITEMS_MAX_LIMIT = 100
export const KNOWLEDGE_BASES_DEFAULT_PAGE = 1
export const KNOWLEDGE_BASES_DEFAULT_LIMIT = 20
export const KNOWLEDGE_BASES_MAX_LIMIT = 100

export const CreateKnowledgeItemsSchema = z
  .object({
    items: z.array(CreateKnowledgeItemSchema).min(1).max(KNOWLEDGE_ITEMS_MAX_LIMIT)
  })
  .superRefine((value, ctx) => {
    const fieldErrors = getCreateKnowledgeItemsReferenceErrors(value.items)

    for (const [field, messages] of Object.entries(fieldErrors)) {
      for (const message of messages) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', field],
          message
        })
      }
    }
  })
export type CreateKnowledgeItemsDto = z.infer<typeof CreateKnowledgeItemsSchema>

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
    status: KnowledgeItemStatusSchema.optional(),
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
 * Query parameters for GET /knowledge-bases/:id/items
 *
 * Returns flat knowledge items for one knowledge base with optional filters.
 */
export const KnowledgeItemsQuerySchema = z.object({
  page: z.int().positive().default(KNOWLEDGE_ITEMS_DEFAULT_PAGE),
  limit: z.int().positive().max(KNOWLEDGE_ITEMS_MAX_LIMIT).default(KNOWLEDGE_ITEMS_DEFAULT_LIMIT),
  type: KnowledgeItemTypeSchema.optional(),
  groupId: z.string().optional()
})

export type KnowledgeItemsQueryParams = z.input<typeof KnowledgeItemsQuerySchema>
export type KnowledgeItemsQuery = z.output<typeof KnowledgeItemsQuerySchema>

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

  '/knowledge-bases/:id/items': {
    /**
     * Flat knowledge items for one knowledge base.
     */
    GET: {
      params: { id: string }
      query?: KnowledgeItemsQueryParams
      response: OffsetPaginationResponse<KnowledgeItem>
    }
    /**
     * Create flat knowledge items with optional grouping metadata.
     */
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
    /**
     * Delete one knowledge item by id.
     *
     * If the deleted item acts as a group owner, all items with
     * `groupId = :id` are deleted in the same operation through the
     * database-level same-base cascade constraint.
     */
    DELETE: {
      params: { id: string }
      response: void
    }
  }
}
