import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiError, DataApiErrorFactory, ERROR_STATUS_MAP, ErrorCode } from '@shared/data/api'
import { Elysia } from 'elysia'

import {
  KnowledgeBaseIdParamSchema,
  KnowledgeBaseResponseSchema,
  KnowledgeSearchSchema,
  ListKnowledgeBasesResponseSchema,
  PaginationQuerySchema,
  SearchKnowledgeResponseSchema
} from './schemas'

const logger = loggerService.withContext('KnowledgeRoutes')

/**
 * Knowledge base routes (Elysia plugin, mounted under `/v1`). Backed by the v2
 * data layer (`knowledgeBaseService`) + `KnowledgeService` — no
 * Redux, no renderer required. Handlers return success values (validated by the
 * `response` schemas) and throw for failures; the global `onError` shapes errors
 * (including `DataApiError` → the matching HTTP status).
 */
export const knowledgeRoutes = new Elysia({ prefix: '/knowledge-bases' })
  .get(
    '/',
    async ({ query }) => {
      // Gateway exposes a true offset/limit; the data service is page-based
      // (offset = (page-1)*limit), so a non-page-aligned offset can't be expressed
      // as a single page. Fetch the window from the start and slice the exact range.
      // The KB list is small (bounded by the user's configured bases), matching the
      // `limit: 1000` fetch-all pattern used by `/search` below.
      const limit = query.limit ?? 20
      const offset = query.offset ?? 0

      const { items, total } = await knowledgeBaseService.list({ page: 1, limit: offset + limit })
      return { knowledge_bases: items.slice(offset, offset + limit), total }
    },
    {
      query: PaginationQuerySchema,
      response: { 200: ListKnowledgeBasesResponseSchema },
      detail: { tags: ['Knowledge'], summary: 'List all knowledge bases' }
    }
  )
  .post(
    '/search',
    async ({ body }) => {
      const { query, knowledge_base_ids, document_count = 5 } = body

      // Resolve target bases: the requested ids (must exist) or every base.
      let targetBases: { id: string; name: string }[]
      if (knowledge_base_ids?.length) {
        const resolved = await Promise.all(
          knowledge_base_ids.map((id) =>
            knowledgeBaseService
              .getById(id)
              .then((base) => ({ id: base.id, name: base.name }))
              // Only a genuine "not found" maps to null (→ filtered out); real
              // service/DB failures must propagate so they aren't misreported as 404.
              .catch((error: unknown) => {
                if (error instanceof DataApiError && error.code === ErrorCode.NOT_FOUND) {
                  return null
                }
                throw error
              })
          )
        )
        targetBases = resolved.filter((base): base is { id: string; name: string } => base !== null)
        if (targetBases.length === 0) {
          throw DataApiErrorFactory.notFound('KnowledgeBase', knowledge_base_ids.join(', '))
        }
      } else {
        const { items } = await knowledgeBaseService.list({ page: 1, limit: 1000 })
        targetBases = items.map((base) => ({ id: base.id, name: base.name }))
        if (targetBases.length === 0) {
          return {
            query,
            results: [],
            total: 0,
            searched_bases: [],
            warnings: ['No knowledge bases configured. Please add knowledge bases in Cherry Studio.']
          }
        }
      }

      const orchestrator = application.get('KnowledgeService')
      const resultsPerBase = await Promise.all(
        targetBases.map(async (base) => {
          try {
            const searchResults = await orchestrator.search(base.id, query)
            return {
              base,
              results: searchResults.map((result) => ({
                ...result,
                knowledge_base_id: base.id,
                knowledge_base_name: base.name
              })),
              error: undefined as string | undefined
            }
          } catch (error) {
            logger.error(`Error searching knowledge base ${base.id}`, error as Error)
            return { base, results: [], error: (error as Error).message }
          }
        })
      )

      // Every targeted search failed (e.g. broken embedding/vector-store config). Surface a
      // retryable upstream-dependency failure (503) instead of a 200 with empty results, so
      // clients can tell infrastructure failure apart from "no matches".
      if (resultsPerBase.every((r) => r.error)) {
        throw new DataApiError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'All knowledge base searches failed',
          ERROR_STATUS_MAP[ErrorCode.SERVICE_UNAVAILABLE],
          { originalError: resultsPerBase.map((r) => r.error).join('; ') }
        )
      }

      const warnings = resultsPerBase
        .filter((r) => r.error)
        .map((r) => `Knowledge base "${r.base.name}" search failed: ${r.error}`)
      const sortedResults = resultsPerBase
        .flatMap((r) => r.results)
        .sort((a, b) => b.score - a.score)
        .slice(0, document_count)

      return {
        query,
        results: sortedResults,
        total: sortedResults.length,
        searched_bases: resultsPerBase.map((r) => ({ id: r.base.id, name: r.base.name })),
        ...(warnings.length > 0 && { warnings })
      }
    },
    {
      body: KnowledgeSearchSchema,
      response: { 200: SearchKnowledgeResponseSchema },
      detail: { tags: ['Knowledge'], summary: 'Search knowledge bases' }
    }
  )
  .get('/:id', ({ params }) => knowledgeBaseService.getById(params.id), {
    params: KnowledgeBaseIdParamSchema,
    response: { 200: KnowledgeBaseResponseSchema },
    detail: { tags: ['Knowledge'], summary: 'Get a knowledge base by ID' }
  })
