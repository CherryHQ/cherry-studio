/**
 * Knowledge API Schema definitions.
 */

import type OpenAI from '@cherrystudio/openai'
import type {
  ItemStatus,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeItemData,
  KnowledgeItemDataMap,
  KnowledgeItemType,
  KnowledgeSearchMode
} from '@shared/data/types/knowledge'
import * as z from 'zod'

import { type FileMetadata, FileTypeSchema } from '../../types/file'

// ============================================================================
// DTOs
// ============================================================================

export const KnowledgeSearchModeSchema = z.enum(['default', 'bm25', 'hybrid']) satisfies z.ZodType<KnowledgeSearchMode>
export const ItemStatusSchema = z.enum([
  'idle',
  'pending',
  'ocr',
  'read',
  'embed',
  'completed',
  'failed'
]) satisfies z.ZodType<ItemStatus>

export const FileMetadataSchema: z.ZodType<FileMetadata> = z
  .object({
    id: z.string(),
    name: z.string(),
    origin_name: z.string(),
    path: z.string(),
    size: z.number(),
    ext: z.string(),
    type: FileTypeSchema,
    created_at: z.string(),
    count: z.number(),
    tokens: z.number().optional(),
    purpose: z.custom<OpenAI.FilePurpose>((value) => typeof value === 'string').optional()
  })
  .strict()

export const FileItemDataSchema: z.ZodType<KnowledgeItemDataMap['file']> = z
  .object({
    file: FileMetadataSchema
  })
  .strict()

export const UrlItemDataSchema: z.ZodType<KnowledgeItemDataMap['url']> = z
  .object({
    url: z.string(),
    name: z.string()
  })
  .strict()

export const NoteItemDataSchema: z.ZodType<KnowledgeItemDataMap['note']> = z
  .object({
    content: z.string(),
    sourceUrl: z.string().optional()
  })
  .strict()

export const SitemapItemDataSchema: z.ZodType<KnowledgeItemDataMap['sitemap']> = z
  .object({
    url: z.string(),
    name: z.string()
  })
  .strict()

export const DirectoryContainerDataSchema = z
  .object({
    kind: z.literal('container'),
    path: z.string(),
    recursive: z.boolean()
  })
  .strict() satisfies z.ZodType<Extract<KnowledgeItemDataMap['directory'], { kind: 'container' }>>

export const DirectoryItemDataSchema = z
  .object({
    kind: z.literal('entry'),
    groupId: z.string(),
    groupName: z.string(),
    file: FileMetadataSchema
  })
  .strict() satisfies z.ZodType<Extract<KnowledgeItemDataMap['directory'], { kind: 'entry' }>>

export const DirectoryDataSchema = z.discriminatedUnion('kind', [
  DirectoryContainerDataSchema,
  DirectoryItemDataSchema
]) satisfies z.ZodType<KnowledgeItemDataMap['directory']>

export const KnowledgeItemDataSchema = z.union([
  FileItemDataSchema,
  UrlItemDataSchema,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  DirectoryDataSchema
]) satisfies z.ZodType<KnowledgeItemData>

export const CreateKnowledgeBaseSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    dimensions: z.number(),
    embeddingModelId: z.string(),
    rerankModelId: z.string().optional(),
    fileProcessorId: z.string().optional(),
    chunkSize: z.number().optional(),
    chunkOverlap: z.number().optional(),
    threshold: z.number().optional(),
    documentCount: z.number().optional(),
    searchMode: KnowledgeSearchModeSchema.optional(),
    hybridAlpha: z.number().optional()
  })
  .strict()
export type CreateKnowledgeBaseDto = z.infer<typeof CreateKnowledgeBaseSchema>

export const UpdateKnowledgeBaseSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    rerankModelId: z.string().optional(),
    fileProcessorId: z.string().optional(),
    chunkSize: z.number().optional(),
    chunkOverlap: z.number().optional(),
    threshold: z.number().optional(),
    documentCount: z.number().optional(),
    searchMode: KnowledgeSearchModeSchema.optional(),
    hybridAlpha: z.number().optional()
  })
  .strict()
export type UpdateKnowledgeBaseDto = z.infer<typeof UpdateKnowledgeBaseSchema>

export type CreateKnowledgeItemDto = {
  [T in KnowledgeItemType]: {
    type: T
    data: KnowledgeItemDataMap[T]
  }
}[KnowledgeItemType]

export const CreateKnowledgeItemSchema = z.discriminatedUnion('type', [
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
      data: DirectoryDataSchema
    })
    .strict()
]) satisfies z.ZodType<CreateKnowledgeItemDto>

export const CreateKnowledgeItemsSchema = z
  .object({
    items: z.array(CreateKnowledgeItemSchema).min(1)
  })
  .strict()
export type CreateKnowledgeItemsDto = z.infer<typeof CreateKnowledgeItemsSchema>

export const UpdateKnowledgeItemSchema = z
  .object({
    data: KnowledgeItemDataSchema.optional(),
    status: ItemStatusSchema.optional(),
    error: z.string().nullable().optional()
  })
  .strict()
export type UpdateKnowledgeItemDto = z.infer<typeof UpdateKnowledgeItemSchema>

export interface ListKnowledgeItemsQueryParams {
  parentId?: string
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
      query?: ListKnowledgeItemsQueryParams
      response: KnowledgeItem[]
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
