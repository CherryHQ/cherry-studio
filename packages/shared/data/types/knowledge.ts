import * as z from 'zod'

import { type FileMetadata, FileTypeSchema } from './file'

/**
 * Knowledge domain types.
 *
 * Keep this file as the single shared entry point for knowledge data contracts.
 * Sections below separate persisted entities, runtime search types, and
 * runtime operation DTOs.
 */

// ============================================================================
// Constants and Field Schemas
// ============================================================================

export const KNOWLEDGE_ITEM_TYPES = ['file', 'url', 'note', 'sitemap', 'directory'] as const
export const KnowledgeItemTypeSchema = z.enum(KNOWLEDGE_ITEM_TYPES)
export type KnowledgeItemType = z.infer<typeof KnowledgeItemTypeSchema>

export const KNOWLEDGE_ITEM_STATUSES = ['idle', 'processing', 'completed', 'failed'] as const
export const KnowledgeItemStatusSchema = z.enum(KNOWLEDGE_ITEM_STATUSES)
export type KnowledgeItemStatus = z.infer<typeof KnowledgeItemStatusSchema>

export const KNOWLEDGE_ITEM_PHASES = ['preparing', 'file_processing', 'reading', 'embedding'] as const
export const KnowledgeItemPhaseSchema = z.enum(KNOWLEDGE_ITEM_PHASES)
export type KnowledgeItemPhase = z.infer<typeof KnowledgeItemPhaseSchema>

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
export const KNOWLEDGE_RUNTIME_ITEMS_MAX = 100

// ============================================================================
// Knowledge Base Entity
// ============================================================================

/**
 * Knowledge base metadata stored in SQLite.
 */
export const KnowledgeBaseSchema = z.strictObject({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  groupId: KnowledgeBaseGroupIdSchema.nullable().optional(),
  emoji: KnowledgeBaseEmojiSchema,
  dimensions: z.number().int().positive(),
  embeddingModelId: z.string().min(1).nullable(),
  rerankModelId: z.string().optional(),
  fileProcessorId: z.string().optional(),
  chunkSize: KnowledgeChunkSizeSchema,
  chunkOverlap: KnowledgeChunkOverlapSchema,
  threshold: KnowledgeThresholdSchema.optional(),
  documentCount: KnowledgeDocumentCountSchema.optional(),
  searchMode: KnowledgeSearchModeSchema,
  hybridAlpha: KnowledgeHybridAlphaSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>

// ============================================================================
// Knowledge Item Data
// ============================================================================

const KnowledgeItemSharedSchema = z.strictObject({
  source: z.string().trim().min(1)
})

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
export const FileItemDataSchema = KnowledgeItemSharedSchema.extend({
  file: FileMetadataSchema
})

/**
 * URL item data.
 */
export const UrlItemDataSchema = KnowledgeItemSharedSchema.extend({
  url: z.string().trim().min(1)
})

/**
 * Note item data.
 */
export const NoteItemDataSchema = KnowledgeItemSharedSchema.extend({
  content: z.string(),
  sourceUrl: z.string().optional()
})

/**
 * Sitemap item data.
 */
export const SitemapItemDataSchema = KnowledgeItemSharedSchema.extend({
  url: z.string().trim().min(1)
})

/**
 * Directory item data.
 */
export const DirectoryItemDataSchema = KnowledgeItemSharedSchema.extend({
  path: z.string().trim().min(1)
})

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

// ============================================================================
// Knowledge Item Entity
// ============================================================================

const KnowledgeItemBaseSchema = z.strictObject({
  id: z.string(),
  baseId: z.string(),
  groupId: z.string().nullable().optional(),
  status: KnowledgeItemStatusSchema,
  phase: KnowledgeItemPhaseSchema.nullable(),
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

// ============================================================================
// Runtime Search and Chunk Types
// ============================================================================

export const KnowledgeChunkMetadataSchema = z.strictObject({
  itemId: z.string(),
  itemType: KnowledgeItemTypeSchema,
  source: z.string().trim().min(1),
  chunkIndex: z.number().int().min(0),
  tokenCount: z.number().int().min(0)
})
export type KnowledgeChunkMetadata = z.infer<typeof KnowledgeChunkMetadataSchema>
export type KnowledgeSourceMetadata = Pick<KnowledgeChunkMetadata, 'source'>

/**
 * Search result returned by retrieval.
 */
export const KnowledgeSearchResultSchema = z.strictObject({
  pageContent: z.string(),
  score: z.number(),
  metadata: KnowledgeChunkMetadataSchema,
  itemId: z.string().optional(),
  chunkId: z.string()
})
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>

export const KnowledgeItemChunkSchema = z.strictObject({
  id: z.string(),
  itemId: z.string(),
  content: z.string(),
  metadata: KnowledgeChunkMetadataSchema
})
export type KnowledgeItemChunk = z.infer<typeof KnowledgeItemChunkSchema>

// ============================================================================
// Runtime Operation Schemas
// ============================================================================

/**
 * Runtime create-base request. This is intentionally not a DataApi endpoint:
 * orchestration creates the SQLite row and initializes the vector store.
 */
export const CreateKnowledgeBaseSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    description: z.string().optional(),
    groupId: KnowledgeBaseGroupIdSchema.optional(),
    emoji: KnowledgeBaseEmojiSchema.optional(),
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

    if (value.chunkOverlap != null && value.chunkSize != null && value.chunkOverlap >= value.chunkSize) {
      ctx.addIssue({
        code: 'custom',
        path: ['chunkOverlap'],
        message: 'Chunk overlap must be smaller than chunk size'
      })
    }
  })
export type CreateKnowledgeBaseDto = z.input<typeof CreateKnowledgeBaseSchema>

const CreateKnowledgeItemBaseSchema = z.strictObject({
  groupId: z.string().nullable().optional()
})

export const CreateKnowledgeItemSchema = z.discriminatedUnion('type', [
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('file'),
    data: FileItemDataSchema
  }),
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('url'),
    data: UrlItemDataSchema
  }),
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('note'),
    data: NoteItemDataSchema
  }),
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('sitemap'),
    data: SitemapItemDataSchema
  }),
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('directory'),
    data: DirectoryItemDataSchema
  })
])
export type CreateKnowledgeItemDto = z.infer<typeof CreateKnowledgeItemSchema>

export const CreateKnowledgeItemsSchema = z.strictObject({
  items: z.array(CreateKnowledgeItemSchema).min(1).max(KNOWLEDGE_RUNTIME_ITEMS_MAX)
})
export type CreateKnowledgeItemsDto = z.infer<typeof CreateKnowledgeItemsSchema>

const KnowledgeRuntimeAddItemBaseSchema = z.strictObject({
  groupId: z.string().nullable().optional()
})

export const KnowledgeRuntimeAddItemInputSchema = z.discriminatedUnion('type', [
  KnowledgeRuntimeAddItemBaseSchema.extend({
    type: z.literal('file'),
    // TODO: Replace FileMetadata input with a path once file system metadata lookup is centralized.
    file: FileMetadataSchema
  }),
  KnowledgeRuntimeAddItemBaseSchema.extend({
    type: z.literal('url'),
    url: z.string().trim().min(1)
  }),
  KnowledgeRuntimeAddItemBaseSchema.extend({
    type: z.literal('sitemap'),
    url: z.string().trim().min(1)
  }),
  KnowledgeRuntimeAddItemBaseSchema.extend({
    type: z.literal('note'),
    content: z.string().trim().min(1),
    source: z.string().trim().min(1).optional(),
    sourceUrl: z.string().trim().min(1).optional()
  }),
  KnowledgeRuntimeAddItemBaseSchema.extend({
    type: z.literal('directory'),
    path: z.string().trim().min(1)
  })
])
export type KnowledgeRuntimeAddItemInput = z.infer<typeof KnowledgeRuntimeAddItemInputSchema>

export const UpdateKnowledgeItemDataSchema = z.union([
  FileItemDataSchema,
  UrlItemDataSchema,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  DirectoryItemDataSchema
])

export const UpdateKnowledgeItemSchema = z.strictObject({
  data: UpdateKnowledgeItemDataSchema.optional(),
  status: KnowledgeItemStatusSchema.optional(),
  error: z.string().nullable().optional()
})
export type UpdateKnowledgeItemDto = z.infer<typeof UpdateKnowledgeItemSchema>
