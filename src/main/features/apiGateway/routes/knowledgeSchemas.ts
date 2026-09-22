import * as z from 'zod'

import {
  KNOWLEDGE_NOTE_CONTENT_MAX,
  KNOWLEDGE_RUNTIME_ITEMS_MAX,
  KnowledgeItemStatusSchema
} from '@shared/data/types/knowledge'

/**
 * Request and response schemas for the knowledge routes. Request schemas validate
 * `query`/`body`/`params`; response schemas are passed to Elysia's `response` option
 * so bodies are validated and surfaced in the OpenAPI document. All Zod (Elysia
 * Standard Schema). Errors are thrown and shaped centrally by the global `onError`
 * (see ../../errors).
 */

// ── Request schemas ─────────────────────────────────────────────────

/** Knowledge base ID — non-empty string. */
const KnowledgeBaseIdSchema = z.string().min(1, 'Knowledge base ID is required')
const KnowledgeDocumentIdSchema = z.string().min(1, 'Knowledge document ID is required')
export const KNOWLEDGE_DOCUMENT_BATCH_MAX_BYTES = 10_000_000

/** `POST /` body. A missing model pair creates a BM25-only base. */
export const CreateKnowledgeBaseRequestSchema = z.union([
  z.object({
    name: z.string().trim().min(1, 'Name is required'),
    embedding_model_id: z.string().trim().min(1),
    dimensions: z.number().int().positive()
  }),
  z.object({
    name: z.string().trim().min(1, 'Name is required'),
    embedding_model_id: z.null().optional(),
    dimensions: z.null().optional()
  })
])

const RawTextDocumentSchema = z.object({
  title: z.string().trim().min(1, 'Document title is required'),
  content: z.string().max(KNOWLEDGE_NOTE_CONTENT_MAX),
  group_id: z.string().trim().min(1).nullable().optional()
})

/** `POST /:id/documents` body. The existing workflow preserves name collisions by renaming. */
export const AddKnowledgeDocumentsRequestSchema = z
  .object({
    documents: z
      .array(RawTextDocumentSchema)
      .min(1)
      .max(KNOWLEDGE_RUNTIME_ITEMS_MAX)
      .describe(
        `The combined UTF-8 byte length of every document title, content, and group_id must not exceed ${KNOWLEDGE_DOCUMENT_BATCH_MAX_BYTES}.`
      )
  })
  .superRefine((value, ctx) => {
    const byteLength = value.documents.reduce(
      (total, document) =>
        total +
        Buffer.byteLength(document.title) +
        Buffer.byteLength(document.content) +
        Buffer.byteLength(document.group_id ?? ''),
      0
    )
    if (byteLength > KNOWLEDGE_DOCUMENT_BATCH_MAX_BYTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['documents'],
        message: `Document batch must be at most ${KNOWLEDGE_DOCUMENT_BATCH_MAX_BYTES} UTF-8 bytes`
      })
    }
  })

/** `POST /search` body. */
export const KnowledgeSearchSchema = z.object({
  query: z.string().min(1, 'Query is required').max(1000, 'Query must be at most 1000 characters'),
  knowledge_base_ids: z.array(z.string().min(1, 'Knowledge base ID cannot be empty')).optional(),
  document_count: z.coerce.number().int().min(1).max(20).default(5)
})

/** `GET /` pagination query. */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional()
})

/** `GET /:id/documents` cursor pagination query. */
export const KnowledgeDocumentsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
})

/** `GET /:id` route params. */
export const KnowledgeBaseIdParamSchema = z.object({
  id: KnowledgeBaseIdSchema
})

export const KnowledgeDocumentIdParamSchema = z.object({
  id: KnowledgeBaseIdSchema,
  documentId: KnowledgeDocumentIdSchema
})

// ── Response schemas ────────────────────────────────────────────────

/** A knowledge base entry / search result — kept loose (rich v2 shapes). */
const KnowledgeBaseEntry = z.looseObject({ id: z.string(), name: z.string() })
const KnowledgeSearchEntry = z.looseObject({ chunkId: z.string(), score: z.number() })
const SearchedBase = z.object({ id: z.string(), name: z.string() })

export const ListKnowledgeBasesResponseSchema = z.object({
  knowledge_bases: z.array(KnowledgeBaseEntry),
  total: z.number()
})

export const KnowledgeBaseResponseSchema = KnowledgeBaseEntry

export const DeleteKnowledgeBaseResponseSchema = z.object({ deleted: z.literal(true) })

const KnowledgeDocumentEntry = z.object({
  id: z.string(),
  type: z.enum(['file', 'url', 'note', 'directory']),
  status: z.string(),
  group_id: z.string().nullable(),
  source: z.string(),
  error: z.string().nullable()
})

export const ListKnowledgeDocumentsResponseSchema = z.object({
  documents: z.array(KnowledgeDocumentEntry),
  total: z.number().int().nonnegative(),
  next_cursor: z.string().optional()
})

export const AddKnowledgeDocumentsResponseSchema = z.object({
  status: z.literal('accepted'),
  documents: z.array(
    z.object({
      id: z.string(),
      status: KnowledgeItemStatusSchema,
      error: z.string().nullable()
    })
  )
})

export const KnowledgeDocumentsPayloadTooLargeResponseSchema = z.object({
  error: z.object({
    code: z.literal('PAYLOAD_TOO_LARGE'),
    message: z.string()
  })
})

export const DeleteKnowledgeDocumentResponseSchema = z.object({ status: z.literal('queued') })
export const ReindexKnowledgeDocumentResponseSchema = z.object({ status: z.literal('queued') })

export const SearchKnowledgeResponseSchema = z.object({
  query: z.string(),
  results: z.array(KnowledgeSearchEntry),
  total: z.number(),
  searched_bases: z.array(SearchedBase),
  warnings: z.array(z.string()).optional()
})
