import * as z from 'zod'

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

/** `POST /search` body. */
export const KnowledgeSearchSchema = z.object({
  query: z.string().min(1, 'Query is required').max(1000, 'Query must be at most 1000 characters'),
  knowledge_base_ids: z.array(z.string().min(1, 'Knowledge base ID cannot be empty')).optional(),
  // Per-base result count, mirroring the kb_search tool's topK: overrides each base's configured
  // documentCount for this call. Optional (no forced default) so an omitted value falls back to
  // `documentCount ?? 10` inside KnowledgeService.search, instead of pinning every base to a fixed number.
  document_count: z.coerce.number().int().min(1).max(20).optional()
})

/** `GET /` pagination query. */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional()
})

/** `GET /:id` route params. */
export const KnowledgeBaseIdParamSchema = z.object({
  id: KnowledgeBaseIdSchema
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

export const SearchKnowledgeResponseSchema = z.object({
  query: z.string(),
  results: z.array(KnowledgeSearchEntry),
  total: z.number(),
  searched_bases: z.array(SearchedBase),
  warnings: z.array(z.string()).optional()
})
