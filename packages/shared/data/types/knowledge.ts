import * as z from 'zod'

import { type FileMetadata, FileTypeSchema } from './file'

/**
 * Shared knowledge domain types.
 *
 * Entity schemas live here so DataApi schemas and DB schemas can reuse the
 * same source of truth.
 */

export const KNOWLEDGE_ITEM_TYPES = ['file', 'url', 'note', 'sitemap', 'directory'] as const
export const KnowledgeItemTypeSchema = z.enum(KNOWLEDGE_ITEM_TYPES)
export type KnowledgeItemType = z.infer<typeof KnowledgeItemTypeSchema>

export const KNOWLEDGE_ITEM_STATUSES = [
  'idle',
  'pending',
  'file_processing',
  'read',
  'embed',
  'completed',
  'failed'
] as const
export const KnowledgeItemStatusSchema = z.enum(KNOWLEDGE_ITEM_STATUSES)
export type KnowledgeItemStatus = z.infer<typeof KnowledgeItemStatusSchema>

export const KNOWLEDGE_SEARCH_MODES = ['default', 'bm25', 'hybrid'] as const
export const KnowledgeSearchModeSchema = z.enum(KNOWLEDGE_SEARCH_MODES)
export type KnowledgeSearchMode = z.infer<typeof KnowledgeSearchModeSchema>
export const DEFAULT_KNOWLEDGE_SEARCH_MODE: KnowledgeSearchMode = 'hybrid'

export const KnowledgeChunkSizeSchema = z.number().int().positive()
export const KnowledgeChunkOverlapSchema = z.number().int().min(0)
export const KnowledgeThresholdSchema = z.number().min(0).max(1)
export const KnowledgeDocumentCountSchema = z.number().int().positive()
export const KnowledgeHybridAlphaSchema = z.number().min(0).max(1)
export const KnowledgeBaseGroupIdSchema = z.string()
export const KnowledgeBaseEmojiSchema = z.emoji()
export const DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE = 1024
export const DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP = 200
export const DEFAULT_KNOWLEDGE_BASE_EMOJI = '📁'

/**
 * Temporary schema mirroring the current FileMetadata shape.
 * TODO: Move to `types/file.ts` once the dedicated file domain schema is ready.
 */
export const FileMetadataSchema: z.ZodType<FileMetadata> = z.object({
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
  purpose: z.custom<FileMetadata['purpose']>((value) => value === undefined || typeof value === 'string').optional()
})

/**
 * File item data.
 */
export const FileItemDataSchema = z.object({
  file: FileMetadataSchema
})
export type FileItemData = z.infer<typeof FileItemDataSchema>

/**
 * URL item data.
 */
export const UrlItemDataSchema = z.object({
  url: z.string().trim().min(1),
  name: z.string().trim().min(1)
})
export type UrlItemData = z.infer<typeof UrlItemDataSchema>

/**
 * Note item data.
 */
export const NoteItemDataSchema = z.object({
  content: z.string(),
  sourceUrl: z.string().optional()
})
export type NoteItemData = z.infer<typeof NoteItemDataSchema>

/**
 * Sitemap item data.
 */
export const SitemapItemDataSchema = z.object({
  url: z.string().trim().min(1),
  name: z.string().trim().min(1)
})
export type SitemapItemData = z.infer<typeof SitemapItemDataSchema>

/**
 * Directory item data.
 */
export const DirectoryItemDataSchema = z.object({
  name: z.string().trim().min(1),
  path: z.string().trim().min(1)
})
export type DirectoryItemData = z.infer<typeof DirectoryItemDataSchema>

export type KnowledgeItemDataMap = {
  file: FileItemData
  url: UrlItemData
  note: NoteItemData
  sitemap: SitemapItemData
  directory: DirectoryItemData
}

/**
 * JSON payload stored in `knowledge_item.data`.
 */
export const KnowledgeItemDataSchema = z.union([
  FileItemDataSchema,
  UrlItemDataSchema,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  DirectoryItemDataSchema
])
export type KnowledgeItemData = z.infer<typeof KnowledgeItemDataSchema>

/**
 * Knowledge base metadata stored in SQLite.
 */
export const KnowledgeBaseSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  groupId: KnowledgeBaseGroupIdSchema.nullable().optional(),
  emoji: KnowledgeBaseEmojiSchema.default(DEFAULT_KNOWLEDGE_BASE_EMOJI),
  dimensions: z.number().int().positive(),
  embeddingModelId: z.string().min(1).nullable(),
  rerankModelId: z.string().optional(),
  fileProcessorId: z.string().optional(),
  chunkSize: KnowledgeChunkSizeSchema,
  chunkOverlap: KnowledgeChunkOverlapSchema,
  threshold: KnowledgeThresholdSchema.optional(),
  documentCount: KnowledgeDocumentCountSchema.optional(),
  searchMode: KnowledgeSearchModeSchema.optional(),
  hybridAlpha: KnowledgeHybridAlphaSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>

const KnowledgeItemBaseSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  groupId: z.string().nullable().optional(),
  status: KnowledgeItemStatusSchema,
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

/**
 * Knowledge item record stored in SQLite.
 */
export const KnowledgeItemSchema = z.discriminatedUnion('type', [
  KnowledgeItemBaseSchema.extend({
    type: z.literal('file'),
    data: FileItemDataSchema
  }),
  KnowledgeItemBaseSchema.extend({
    type: z.literal('url'),
    data: UrlItemDataSchema
  }),
  KnowledgeItemBaseSchema.extend({
    type: z.literal('note'),
    data: NoteItemDataSchema
  }),
  KnowledgeItemBaseSchema.extend({
    type: z.literal('sitemap'),
    data: SitemapItemDataSchema
  }),
  KnowledgeItemBaseSchema.extend({
    type: z.literal('directory'),
    data: DirectoryItemDataSchema
  })
])
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>
export type KnowledgeItemOf<T extends KnowledgeItemType> = Extract<KnowledgeItem, { type: T }>

/**
 * Search result returned by retrieval.
 */
export const KnowledgeSearchResultSchema = z.object({
  pageContent: z.string(),
  score: z.number(),
  metadata: z.record(z.string(), z.unknown()),
  itemId: z.string().optional(),
  chunkId: z.string()
})
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>
