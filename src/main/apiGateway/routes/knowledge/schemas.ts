import * as z from 'zod'

/**
 * Success response schemas for the knowledge routes — passed to Elysia's
 * `response` option so bodies are validated and surfaced in the OpenAPI document.
 * Errors are thrown and shaped centrally by the global `onError` (see ../../errors).
 */

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
