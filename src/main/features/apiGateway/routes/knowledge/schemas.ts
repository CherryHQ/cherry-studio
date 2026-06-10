import { KNOWLEDGE_SEARCH_DEFAULT_TOP_K, KNOWLEDGE_SEARCH_MAX_TOP_K } from '@shared/data/types/knowledge'
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

/**
 * `POST /search` body. Strict so an unknown field fails loudly with a 422 —
 * in particular the pre-rename `document_count`, which would otherwise be
 * silently ignored and the request would run with the default `top_k`.
 */
export const KnowledgeSearchSchema = z.strictObject({
  query: z.string().min(1, 'Query is required').max(1000, 'Query must be at most 1000 characters'),
  knowledge_base_ids: z.array(z.string().min(1, 'Knowledge base ID cannot be empty')).optional(),
  // Mirrors the kb__search agent tool's `topK` contract: same ceiling and the same
  // default as KnowledgeService, so omitting `top_k` behaves like omitting `topK`.
  top_k: z.coerce.number().int().min(1).max(KNOWLEDGE_SEARCH_MAX_TOP_K).default(KNOWLEDGE_SEARCH_DEFAULT_TOP_K)
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
