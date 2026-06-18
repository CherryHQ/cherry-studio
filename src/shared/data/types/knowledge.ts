import * as z from 'zod'

import { AbsolutePathSchema } from './file'
import { GroupIdSchema } from './group'

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

export const KNOWLEDGE_ITEM_TYPES = ['file', 'url', 'note', 'directory'] as const
export const KnowledgeItemTypeSchema = z.enum(KNOWLEDGE_ITEM_TYPES)
export type KnowledgeItemType = z.infer<typeof KnowledgeItemTypeSchema>

/**
 * Persisted item lifecycle states.
 *
 * State machine:
 *
 * ```text
 * file/url/note:
 *   idle -> processing -> reading -> embedding -> completed
 *      \                    \             \          \
 *       +--------------------+-------------+-----------> failed
 *      \---------------------------------------------> deleting
 *
 * directory:
 *   idle -> preparing -> processing -> completed
 *      \        \             \          \
 *       +--------+-------------+-----------> failed
 *      \---------------------------------> deleting
 * ```
 *
 * - `idle`: item row exists but indexing has not started.
 * - `preparing`: container expansion is running; only `directory` items may use it.
 * - `processing`: work has been queued or is running before a more specific phase is known.
 * - `reading`: leaf source documents are being read; only `file` / `url` / `note` items may use it.
 * - `embedding`: leaf chunks are being embedded and written to the vector store; only `file` / `url` / `note`.
 * - `completed`: indexing or container reconciliation finished successfully.
 * - `failed`: workflow failed; `error` must be a non-empty string — either a code the
 *   UI localizes (e.g. `directory_not_migrated`, set when a v1-indexed folder's vectors
 *   could not be migrated, so the folder must be deleted and re-uploaded) or a free-form message.
 * - `deleting`: delete cleanup is in progress; default list/search/RAG reads hide the item.
 */
export const KNOWLEDGE_ITEM_STATUSES = [
  'idle',
  'preparing',
  'processing',
  'reading',
  'embedding',
  'completed',
  'failed',
  'deleting'
] as const
export const KnowledgeItemStatusSchema = z.enum(KNOWLEDGE_ITEM_STATUSES)
export type KnowledgeItemStatus = z.infer<typeof KnowledgeItemStatusSchema>

export const KNOWLEDGE_SEARCH_MODES = ['vector', 'bm25', 'hybrid'] as const
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

/**
 * Item-level error codes stored on `knowledge_item.error`. Currently only the v2
 * migration sets one: a v1-indexed `directory` whose container-level vectors could not
 * be re-attributed to per-file children (unreadable legacy sources, or no migratable
 * vectors) is marked `failed` with `directory_not_migrated`. Modeled as a zod enum (the
 * same shape as the base error codes above) so the renderer's code → i18n switch in
 * `error.ts` stays exhaustive-checkable and the code ↔ translator-key triple is tied together.
 */
export const KNOWLEDGE_ITEM_ERROR_CODES = ['directory_not_migrated'] as const
export const KnowledgeItemErrorCodeSchema = z.enum(KNOWLEDGE_ITEM_ERROR_CODES)
export type KnowledgeItemErrorCode = z.infer<typeof KnowledgeItemErrorCodeSchema>
export const KNOWLEDGE_ITEM_ERROR_DIRECTORY_NOT_MIGRATED: KnowledgeItemErrorCode = 'directory_not_migrated'

export const KnowledgeChunkSizeSchema = z.number().int().positive()
export const KnowledgeChunkOverlapSchema = z.number().int().min(0)
export const KnowledgeThresholdSchema = z.number().min(0).max(1)
export const KnowledgeDocumentCountSchema = z.number().int().positive()
export const KnowledgeHybridAlphaSchema = z.number().min(0).max(1)
export const KnowledgeBaseIdSchema = z.uuidv4()
export const KnowledgeItemIdSchema = z.uuidv7()
export const KnowledgeBaseGroupIdInputSchema = z.string().trim().pipe(GroupIdSchema)
export const DEFAULT_KNOWLEDGE_BASE_CHUNK_SIZE = 1024
export const DEFAULT_KNOWLEDGE_BASE_CHUNK_OVERLAP = 200
export const KNOWLEDGE_RUNTIME_ITEMS_MAX = 100
export const KNOWLEDGE_NOTE_CONTENT_MAX = 1_000_000

// ============================================================================
// Knowledge Base Entity
// ============================================================================

/**
 * Knowledge base metadata stored in SQLite.
 */
export const KnowledgeBaseEntitySchema = z.strictObject({
  id: KnowledgeBaseIdSchema,
  name: z.string().trim().min(1),
  groupId: GroupIdSchema.nullable(),
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

/**
 * A knowledge base that has finished embedding and is ready for vector-store
 * operations. Narrows away the states `KnowledgeBaseSchema.superRefine` already
 * rejects for `status === 'completed'` (null dimensions / embedding model, or a
 * lingering error), so consumers can read `dimensions` as a plain `number`
 * instead of re-asserting at each call site.
 */
export type CompletedKnowledgeBase = KnowledgeBase & {
  status: 'completed'
  dimensions: number
  embeddingModelId: string
  error: null
}

export function isCompletedKnowledgeBase(base: KnowledgeBase): base is CompletedKnowledgeBase {
  return (
    base.status === 'completed' &&
    typeof base.dimensions === 'number' &&
    Number.isInteger(base.dimensions) &&
    base.dimensions > 0 &&
    base.embeddingModelId !== null &&
    base.error === null
  )
}

// ============================================================================
// Knowledge Item Data
// ============================================================================

const KnowledgeItemSharedSchema = z.strictObject({
  source: z.string().trim().min(1).describe('Original user-facing source identifier for the knowledge item.')
})

/**
 * File item data.
 */
export const FileItemDataSchema = KnowledgeItemSharedSchema.extend({
  // relativePath / indexedRelativePath are always produced by main-side helpers
  // (copyFileIntoKnowledgeBaseAt, toKnowledgeRelativePath, ...), never raw caller
  // input. The base-relative, POSIX-normalized, no-traversal invariant is
  // enforced imperatively by assertSafeKnowledgeRelativePath at the filesystem
  // boundary (getKnowledgeBaseFilePath). This schema only validates shape, so a
  // refined path schema here would duplicate that check — and cannot use
  // node:path since this module also runs in the renderer.
  relativePath: z
    .string()
    .trim()
    .min(1)
    .describe('Knowledge-base-relative, POSIX-normalized path for the copied source file.'),
  indexedRelativePath: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Knowledge-base-relative, POSIX-normalized path for the file actually indexed, such as a processed markdown artifact.'
    )
})
export type FileItemData = z.infer<typeof FileItemDataSchema>

/**
 * URL item data.
 */
export const UrlItemDataSchema = KnowledgeItemSharedSchema.extend({
  url: z.string().trim().min(1).describe('URL to read and index.'),
  // Written lazily by main on first index/refresh, never by raw caller input
  // (add omits it). Same base-relative, POSIX-normalized, no-traversal invariant
  // as FileItemData.relativePath, enforced at the filesystem boundary.
  relativePath: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Knowledge-base-relative path for the captured URL snapshot markdown, written on first index.')
})

/**
 * Note item data.
 */
export const NoteItemDataSchema = KnowledgeItemSharedSchema.extend({
  content: z.string().max(KNOWLEDGE_NOTE_CONTENT_MAX).describe('Plain text note content to index.'),
  // Written lazily by main on first index, never by raw caller input (add omits
  // it). Same base-relative, POSIX-normalized, no-traversal invariant as
  // FileItemData.relativePath, enforced at the filesystem boundary.
  relativePath: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Knowledge-base-relative path for the captured note snapshot markdown, written on first index.')
})

/**
 * Directory item data.
 */
export const DirectoryItemDataSchema = KnowledgeItemSharedSchema.extend({
  relativePath: z.string().trim().min(1).describe('Directory path to expand into child file or directory items.')
})
export type DirectoryItemData = z.infer<typeof DirectoryItemDataSchema>

/**
 * JSON payload stored in `knowledge_item.data`.
 */
export const KnowledgeItemDataSchema = z.union([
  FileItemDataSchema,
  UrlItemDataSchema,
  NoteItemDataSchema,
  DirectoryItemDataSchema
])
export type KnowledgeItemData = z.infer<typeof KnowledgeItemDataSchema>

// ============================================================================
// Knowledge Item Entity
// ============================================================================

const KnowledgeItemEntityBaseSchema = z.strictObject({
  id: KnowledgeItemIdSchema.describe('Stable knowledge item identifier.'),
  baseId: KnowledgeBaseIdSchema.describe('Owning knowledge base identifier.'),
  groupId: KnowledgeItemIdSchema.nullable()
    .optional()
    .describe('Parent container item identifier; null or undefined means the item is a root item.'),
  createdAt: z.iso.datetime().describe('ISO timestamp when the item row was created.'),
  updatedAt: z.iso.datetime().describe('ISO timestamp when the item row was last updated.')
})

const IdleKnowledgeItemLifecycleSchema = {
  status: z.literal('idle').describe('Item row exists but indexing has not started.'),
  error: z.null().describe('No error is stored for non-failed lifecycle states.')
} as const

const PreparingKnowledgeItemLifecycleSchema = {
  status: z.literal('preparing').describe('Container expansion is running; only directory items use it.'),
  error: z.null().describe('No error is stored for non-failed lifecycle states.')
} as const

const ProcessingKnowledgeItemLifecycleSchema = {
  status: z.literal('processing').describe('Work has been queued or is running before a more specific phase is known.'),
  error: z.null().describe('No error is stored for non-failed lifecycle states.')
} as const

const ReadingKnowledgeItemLifecycleSchema = {
  status: z.literal('reading').describe('Leaf source documents are being read; only file, url, and note items use it.'),
  error: z.null().describe('No error is stored for non-failed lifecycle states.')
} as const

const EmbeddingKnowledgeItemLifecycleSchema = {
  status: z
    .literal('embedding')
    .describe('Leaf chunks are being embedded and written to the vector store; only file, url, and note items use it.'),
  error: z.null().describe('No error is stored for non-failed lifecycle states.')
} as const

const CompletedKnowledgeItemLifecycleSchema = {
  status: z.literal('completed').describe('Indexing or container reconciliation finished successfully.'),
  error: z.null().describe('No error is stored for non-failed lifecycle states.')
} as const

const DeletingKnowledgeItemLifecycleSchema = {
  status: z.literal('deleting').describe('Delete cleanup is in progress; default list, search, and RAG reads hide it.'),
  error: z.null().describe('No error is stored for non-failed lifecycle states.')
} as const

const FailedKnowledgeItemLifecycleSchema = {
  status: z.literal('failed').describe('Workflow failed.'),
  error: z.string().trim().min(1).describe('Non-empty failure message for failed items.')
} as const

const createLeafKnowledgeItemEntitySchemas = <TType extends KnowledgeItemType, TData extends z.ZodType>(
  type: TType,
  data: TData
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
      ...ProcessingKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...ReadingKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...EmbeddingKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...CompletedKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...DeletingKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...FailedKnowledgeItemLifecycleSchema
    })
  ] as const

const createContainerKnowledgeItemEntitySchemas = <TType extends KnowledgeItemType, TData extends z.ZodType>(
  type: TType,
  data: TData
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
      ...PreparingKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...ProcessingKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...CompletedKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...DeletingKnowledgeItemLifecycleSchema
    }),
    KnowledgeItemEntityBaseSchema.extend({
      type: z.literal(type),
      data,
      ...FailedKnowledgeItemLifecycleSchema
    })
  ] as const

const FileKnowledgeItemSchema = z.discriminatedUnion(
  'status',
  createLeafKnowledgeItemEntitySchemas('file', FileItemDataSchema)
)
const UrlKnowledgeItemSchema = z.discriminatedUnion(
  'status',
  createLeafKnowledgeItemEntitySchemas('url', UrlItemDataSchema)
)
const NoteKnowledgeItemSchema = z.discriminatedUnion(
  'status',
  createLeafKnowledgeItemEntitySchemas('note', NoteItemDataSchema)
)
const DirectoryKnowledgeItemSchema = z.discriminatedUnion(
  'status',
  createContainerKnowledgeItemEntitySchemas('directory', DirectoryItemDataSchema)
)

/**
 * Knowledge item record stored in SQLite.
 */
export const KnowledgeItemSchema = z.union([
  FileKnowledgeItemSchema,
  UrlKnowledgeItemSchema,
  NoteKnowledgeItemSchema,
  DirectoryKnowledgeItemSchema
])
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>
export type KnowledgeItemOf<T extends KnowledgeItemType> = Extract<KnowledgeItem, { type: T }>

// ============================================================================
// Runtime Search and Chunk Types
// ============================================================================

export const KnowledgeChunkMetadataSchema = z.strictObject({
  itemId: KnowledgeItemIdSchema,
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
  itemId: KnowledgeItemIdSchema.optional(),
  chunkId: z.string()
})
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResultSchema>

export const KnowledgeItemChunkSchema = z.strictObject({
  id: z.string(),
  itemId: KnowledgeItemIdSchema,
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
  groupId: KnowledgeBaseGroupIdInputSchema.optional()
}).superRefine(refineRuntimeConfig)
export type CreateKnowledgeBaseDto = z.input<typeof CreateKnowledgeBaseSchema>

export const RestoreKnowledgeBaseSchema = z.strictObject({
  sourceBaseId: z.string().trim().pipe(KnowledgeBaseIdSchema),
  name: z.string().trim().min(1),
  // Dimensions must be the resolved embedding vector size for embeddingModelId.
  // Automatic callers should fill this from AI Core dimension detection; manual
  // callers are responsible for confirming the value matches the selected model.
  // Restore validates shape only and does not probe the model again server-side.
  dimensions: z.number().int().positive(),
  embeddingModelId: z.string().trim().min(1)
})
export type RestoreKnowledgeBaseDto = z.input<typeof RestoreKnowledgeBaseSchema>

const CreateKnowledgeItemBaseSchema = z.strictObject({
  groupId: KnowledgeItemIdSchema.nullable().optional()
})

// Members shared verbatim by the persisted-create and runtime-add unions. The
// `file`, `url`, and `note` members differ between the two (persisted carries a
// main-written base-relative path the add surface must not accept), so they are
// declared separately below; the remaining `directory` member is declared once
// and reused.
const UrlItemMemberSchema = CreateKnowledgeItemBaseSchema.extend({
  type: z.literal('url'),
  data: UrlItemDataSchema
})
const NoteItemMemberSchema = CreateKnowledgeItemBaseSchema.extend({
  type: z.literal('note'),
  data: NoteItemDataSchema
})
const DirectoryItemMemberSchema = CreateKnowledgeItemBaseSchema.extend({
  type: z.literal('directory'),
  data: DirectoryItemDataSchema
})

export const CreateKnowledgeItemSchema = z.discriminatedUnion('type', [
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('file'),
    data: FileItemDataSchema
  }),
  UrlItemMemberSchema,
  NoteItemMemberSchema,
  DirectoryItemMemberSchema
])
export type CreateKnowledgeItemDto = z.infer<typeof CreateKnowledgeItemSchema>

const RuntimeFileItemDataSchema = KnowledgeItemSharedSchema.extend({
  path: AbsolutePathSchema.describe('Absolute source path selected by the user before Knowledge copies it.'),
  // Restore-only: absolute path to an already-produced processor artifact (e.g. MinerU
  // Markdown) in the source base. When present, Knowledge copies it in alongside the
  // source file and indexes from it directly, skipping the file processor.
  indexedPath: AbsolutePathSchema.optional().describe(
    'Absolute path to an already-processed artifact to copy in and index from, skipping the file processor.'
  )
})

const RuntimeUrlItemDataSchema = KnowledgeItemSharedSchema.extend({
  url: z.string().trim().min(1).describe('URL to read and index.'),
  // Restore-only: absolute path to a captured snapshot markdown in the source base.
  // When present, Knowledge copies it in and pins the item to it so the first index
  // reads the snapshot offline instead of re-fetching the (possibly changed or dead)
  // live page. Omitted by a normal add, which captures lazily on first index.
  snapshotPath: AbsolutePathSchema.optional().describe(
    'Absolute path to a captured URL snapshot markdown to copy in, skipping the live re-fetch.'
  )
})

const RuntimeUrlItemMemberSchema = CreateKnowledgeItemBaseSchema.extend({
  type: z.literal('url'),
  data: RuntimeUrlItemDataSchema
})

// Runtime note add carries only the caller-supplied content; `relativePath` is
// written lazily by main on first index (see ensureNoteSnapshot), never by raw
// caller input, so it is omitted from the add surface.
const RuntimeNoteItemDataSchema = KnowledgeItemSharedSchema.extend({
  content: z.string().max(KNOWLEDGE_NOTE_CONTENT_MAX).describe('Plain text note content to index.')
})

const RuntimeNoteItemMemberSchema = CreateKnowledgeItemBaseSchema.extend({
  type: z.literal('note'),
  data: RuntimeNoteItemDataSchema
})

export const KnowledgeAddItemInputSchema = z.discriminatedUnion('type', [
  CreateKnowledgeItemBaseSchema.extend({
    type: z.literal('file'),
    data: RuntimeFileItemDataSchema
  }),
  RuntimeUrlItemMemberSchema,
  RuntimeNoteItemMemberSchema,
  DirectoryItemMemberSchema
])
export type KnowledgeAddItemInput = z.infer<typeof KnowledgeAddItemInputSchema>
