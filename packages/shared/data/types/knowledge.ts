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

export const KNOWLEDGE_ITEM_PHASES = ['preparing', 'reading', 'embedding'] as const
export const KnowledgeItemPhaseSchema = z.enum(KNOWLEDGE_ITEM_PHASES)
export type KnowledgeItemPhase = z.infer<typeof KnowledgeItemPhaseSchema>
export const KnowledgeLeafItemPhaseSchema = z.enum(['reading', 'embedding'])
export const KnowledgeContainerItemPhaseSchema = z.literal('preparing')

export const KNOWLEDGE_SEARCH_MODES = ['default', 'bm25', 'hybrid'] as const
export const KnowledgeSearchModeSchema = z.enum(KNOWLEDGE_SEARCH_MODES)
export type KnowledgeSearchMode = z.infer<typeof KnowledgeSearchModeSchema>
export const DEFAULT_KNOWLEDGE_SEARCH_MODE: KnowledgeSearchMode = 'hybrid'

export const KNOWLEDGE_SEARCH_SCORE_KINDS = ['relevance', 'ranking'] as const
export const KnowledgeSearchScoreKindSchema = z.enum(KNOWLEDGE_SEARCH_SCORE_KINDS)
export type KnowledgeSearchScoreKind = z.infer<typeof KnowledgeSearchScoreKindSchema>

export const KNOWLEDGE_BASE_STATUSES = ['completed', 'failed'] as const
export const KnowledgeBaseStatusSchema = z.enum(KNOWLEDGE_BASE_STATUSES)
export type KnowledgeBaseStatus = z.infer<typeof KnowledgeBaseStatusSchema>
export const DEFAULT_KNOWLEDGE_BASE_STATUS: KnowledgeBaseStatus = 'completed'
export const KNOWLEDGE_BASE_ERROR_CODES = ['missing_embedding_model'] as const
export const KnowledgeBaseErrorCodeSchema = z.enum(KNOWLEDGE_BASE_ERROR_CODES)
export type KnowledgeBaseErrorCode = z.infer<typeof KnowledgeBaseErrorCodeSchema>
export const KNOWLEDGE_BASE_ERROR_MISSING_EMBEDDING_MODEL: KnowledgeBaseErrorCode = 'missing_embedding_model'

export const KnowledgeChunkSizeSchema = z.number().int().positive()
export const KnowledgeChunkOverlapSchema = z.number().int().min(0)
export const KnowledgeThresholdSchema = z.number().min(0).max(1)
export const KnowledgeDocumentCountSchema = z.number().int().positive()
export const KnowledgeHybridAlphaSchema = z.number().min(0).max(1)
export const KnowledgeBaseEmojiSchema = z.emoji()
export const DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE = 1024
export const DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP = 200
export const DEFAULT_KNOWLEDGE_BASE_EMOJI = '📁'
export const KNOWLEDGE_RUNTIME_ITEMS_MAX = 100
export const KNOWLEDGE_NOTE_CONTENT_MAX = 1_000_000

// ============================================================================
// Knowledge Base Entity
// ============================================================================

/**
 * Knowledge base metadata stored in SQLite.
 */
export const KnowledgeBaseEntitySchema = z.strictObject({
  id: z.string(),
  name: z.string().trim().min(1),
  groupId: z.string().trim().min(1).nullable(),
  emoji: KnowledgeBaseEmojiSchema,
  dimensions: z.number().int().positive().nullable(),
  embeddingModelId: z.string().trim().min(1).nullable(),
  status: KnowledgeBaseStatusSchema,
  error: KnowledgeBaseErrorCodeSchema.nullable(),
  rerankModelId: z.string().nullable().optional(),
  fileProcessorId: z.string().nullable().optional(),
  chunkSize: KnowledgeChunkSizeSchema,
  chunkOverlap: KnowledgeChunkOverlapSchema,
  threshold: KnowledgeThresholdSchema.optional(),
  documentCount: KnowledgeDocumentCountSchema.optional(),
  searchMode: KnowledgeSearchModeSchema,
  hybridAlpha: KnowledgeHybridAlphaSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

export const KnowledgeBaseSchema = KnowledgeBaseEntitySchema.superRefine((value, ctx) => {
  if (value.status === 'completed') {
    if (value.embeddingModelId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['embeddingModelId'],
        message: 'Completed knowledge base requires an embedding model'
      })
    }

    if (value.error !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['error'],
        message: 'Completed knowledge base cannot have an error'
      })
    }

    if (value.dimensions === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['dimensions'],
        message: 'Completed knowledge base requires positive dimensions'
      })
    }
  }

  if (value.status === 'failed' && value.error === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['error'],
      message: 'Failed knowledge base requires an error'
    })
  }

  if (value.chunkOverlap >= value.chunkSize) {
    ctx.addIssue({
      code: 'custom',
      path: ['chunkOverlap'],
      message: 'Chunk overlap must be smaller than chunk size'
    })
  }

  if (value.hybridAlpha != null && value.searchMode !== 'hybrid') {
    ctx.addIssue({
      code: 'custom',
      path: ['hybridAlpha'],
      message: 'Hybrid alpha requires hybrid search mode'
    })
  }
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
  content: z.string().max(KNOWLEDGE_NOTE_CONTENT_MAX),
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

const KnowledgeItemEntityBaseSchema = z.strictObject({
  id: z.string(),
  baseId: z.string(),
  groupId: z.string().trim().min(1).nullable().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})

const IdleKnowledgeItemLifecycleSchema = {
  status: z.literal('idle'),
  phase: z.null(),
  error: z.null()
} as const

const ProcessingKnowledgeItemLifecycleSchema = {
  status: z.literal('processing'),
  phase: KnowledgeItemPhaseSchema.nullable(),
  error: z.null()
} as const

const LeafProcessingKnowledgeItemLifecycleSchema = {
  status: z.literal('processing'),
  phase: KnowledgeLeafItemPhaseSchema.nullable(),
  error: z.null()
} as const

const ContainerProcessingKnowledgeItemLifecycleSchema = {
  status: z.literal('processing'),
  phase: KnowledgeContainerItemPhaseSchema.nullable(),
  error: z.null()
} as const

const CompletedKnowledgeItemLifecycleSchema = {
  status: z.literal('completed'),
  phase: z.null(),
  error: z.null()
} as const

const FailedKnowledgeItemLifecycleSchema = {
  status: z.literal('failed'),
  phase: z.null(),
  error: z.string().trim().min(1)
} as const

const KnowledgeItemLifecycleSchemas = [
  z.strictObject(IdleKnowledgeItemLifecycleSchema),
  z.strictObject(ProcessingKnowledgeItemLifecycleSchema),
  z.strictObject(CompletedKnowledgeItemLifecycleSchema),
  z.strictObject(FailedKnowledgeItemLifecycleSchema)
] as const

export const KnowledgeItemLifecycleSchema = z.discriminatedUnion('status', KnowledgeItemLifecycleSchemas)
export type KnowledgeItemLifecycle = z.infer<typeof KnowledgeItemLifecycleSchema>

const createKnowledgeItemEntitySchemas = <
  TType extends KnowledgeItemType,
  TData extends z.ZodType,
  TProcessingLifecycle extends
    | typeof LeafProcessingKnowledgeItemLifecycleSchema
    | typeof ContainerProcessingKnowledgeItemLifecycleSchema
>(
  type: TType,
  data: TData,
  processingLifecycle: TProcessingLifecycle
) =>
  [
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...IdleKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...processingLifecycle
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...CompletedKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...FailedKnowledgeItemLifecycleSchema
    })
  ] as const

const FileKnowledgeItemSchema = z.discriminatedUnion(
  'status',
  createKnowledgeItemEntitySchemas('file', FileItemDataSchema, LeafProcessingKnowledgeItemLifecycleSchema)
)
const UrlKnowledgeItemSchema = z.discriminatedUnion(
  'status',
  createKnowledgeItemEntitySchemas('url', UrlItemDataSchema, LeafProcessingKnowledgeItemLifecycleSchema)
)
const NoteKnowledgeItemSchema = z.discriminatedUnion(
  'status',
  createKnowledgeItemEntitySchemas('note', NoteItemDataSchema, LeafProcessingKnowledgeItemLifecycleSchema)
)
const SitemapKnowledgeItemSchema = z.discriminatedUnion(
  'status',
  createKnowledgeItemEntitySchemas('sitemap', SitemapItemDataSchema, ContainerProcessingKnowledgeItemLifecycleSchema)
)
const DirectoryKnowledgeItemSchema = z.discriminatedUnion(
  'status',
  createKnowledgeItemEntitySchemas(
    'directory',
    DirectoryItemDataSchema,
    ContainerProcessingKnowledgeItemLifecycleSchema
  )
)

/**
 * Knowledge item record stored in SQLite.
 */
export const KnowledgeItemSchema = z.union([
  FileKnowledgeItemSchema,
  UrlKnowledgeItemSchema,
  NoteKnowledgeItemSchema,
  SitemapKnowledgeItemSchema,
  DirectoryKnowledgeItemSchema
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
  scoreKind: KnowledgeSearchScoreKindSchema,
  rank: z.number().int().positive(),
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

const KnowledgeBaseRuntimeConfigSchema = z.strictObject({
  dimensions: z.number().int().positive(),
  embeddingModelId: z.string().trim().min(1),
  rerankModelId: z.string().nullable().optional(),
  fileProcessorId: z.string().nullable().optional(),
  chunkSize: KnowledgeChunkSizeSchema.optional(),
  chunkOverlap: KnowledgeChunkOverlapSchema.optional(),
  threshold: KnowledgeThresholdSchema.optional(),
  documentCount: KnowledgeDocumentCountSchema.optional(),
  searchMode: KnowledgeSearchModeSchema.optional(),
  hybridAlpha: KnowledgeHybridAlphaSchema.optional()
})

const refineRuntimeConfig = (value: z.infer<typeof KnowledgeBaseRuntimeConfigSchema>, ctx: z.RefinementCtx): void => {
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
}

/**
 * Runtime create-base request. This is intentionally not a DataApi endpoint:
 * orchestration creates the SQLite row and initializes the vector store.
 */
export const CreateKnowledgeBaseSchema = KnowledgeBaseRuntimeConfigSchema.extend({
  name: z.string().trim().min(1),
  groupId: z.string().trim().min(1).optional(),
  emoji: KnowledgeBaseEmojiSchema.optional()
}).superRefine(refineRuntimeConfig)
export type CreateKnowledgeBaseDto = z.input<typeof CreateKnowledgeBaseSchema>

export const RestoreKnowledgeBaseSchema = z.strictObject({
  sourceBaseId: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  // Dimensions must be the resolved embedding vector size for embeddingModelId.
  // Automatic callers should fill this from AI Core dimension detection; manual
  // callers are responsible for confirming the value matches the selected model.
  // Restore validates shape only and does not probe the model again server-side.
  dimensions: z.number().int().positive(),
  embeddingModelId: z.string().trim().min(1)
})
export type RestoreKnowledgeBaseDto = z.input<typeof RestoreKnowledgeBaseSchema>

const CreateKnowledgeItemBaseSchema = z.strictObject({
  groupId: z.string().trim().min(1).nullable().optional()
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

export const KnowledgeRuntimeAddItemInputSchema = CreateKnowledgeItemSchema
export type KnowledgeRuntimeAddItemInput = CreateKnowledgeItemDto
