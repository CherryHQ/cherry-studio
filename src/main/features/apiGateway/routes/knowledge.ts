import { Elysia } from 'elysia'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { DataApiError, DataApiErrorFactory, ERROR_STATUS_MAP, ErrorCode } from '@shared/data/api/errors'

import { DOC_DESCRIPTIONS, DOC_TAGS } from '../openapiDocs'
import {
  AddKnowledgeDocumentsRequestSchema,
  AddKnowledgeDocumentsResponseSchema,
  CreateKnowledgeBaseRequestSchema,
  DeleteKnowledgeBaseResponseSchema,
  DeleteKnowledgeDocumentResponseSchema,
  KnowledgeBaseIdParamSchema,
  KnowledgeBaseResponseSchema,
  KnowledgeDocumentIdParamSchema,
  KnowledgeDocumentsQuerySchema,
  KnowledgeSearchSchema,
  ListKnowledgeDocumentsResponseSchema,
  ListKnowledgeBasesResponseSchema,
  PaginationQuerySchema,
  ReindexKnowledgeDocumentResponseSchema,
  SearchKnowledgeResponseSchema
} from './knowledgeSchemas'

const logger = loggerService.withContext('KnowledgeRoutes')

/**
 * Knowledge base routes (Elysia plugin, mounted under `/v1`). Backed by the v2
 * data layer (`knowledgeBaseService`) + `KnowledgeService` — no
 * Redux, no renderer required. Handlers return success values (validated by the
 * `response` schemas) and throw for failures; the global `onError` shapes errors
 * (including `DataApiError` → the matching HTTP status).
 *
 * `detail.tags`/`summary` hold i18n *keys*, not translated text — see chat.ts.
 */
export const knowledgeRoutes = new Elysia({ prefix: '/knowledge-bases' })
  .get(
    '/',
    ({ query }) => {
      // Gateway exposes a true offset/limit; the data service is page-based
      // (offset = (page-1)*limit), so a non-page-aligned offset can't be expressed
      // as a single page. Fetch the window from the start and slice the exact range.
      // The KB list is small (bounded by the user's configured bases), matching the
      // `limit: 1000` fetch-all pattern used by `/search` below.
      const limit = query.limit ?? 20
      const offset = query.offset ?? 0

      const { items, total } = knowledgeBaseService.list({ page: 1, limit: offset + limit })
      return { knowledge_bases: items.slice(offset, offset + limit), total }
    },
    {
      query: PaginationQuerySchema,
      response: { 200: ListKnowledgeBasesResponseSchema },
      detail: {
        tags: [DOC_TAGS.cherry],
        summary: 'List Knowledge Bases',
        description: DOC_DESCRIPTIONS.list_knowledge_bases
      }
    }
  )
  .post(
    '/',
    async ({ body, status }) => {
      const orchestrator = application.get('KnowledgeService')
      return status(
        201,
        await orchestrator.createBase({
          name: body.name,
          embeddingModelId: body.embedding_model_id,
          dimensions: body.dimensions
        })
      )
    },
    {
      body: CreateKnowledgeBaseRequestSchema,
      response: { 201: KnowledgeBaseResponseSchema },
      detail: {
        tags: [DOC_TAGS.cherry],
        summary: 'Create Knowledge Base',
        description: DOC_DESCRIPTIONS.manage_knowledge_bases
      }
    }
  )
  .post(
    '/search',
    async ({ body }) => {
      const { query, knowledge_base_ids, document_count } = body

      // Resolve target bases: the requested ids (must exist) or every base.
      let targetBases: { id: string; name: string }[]
      if (knowledge_base_ids?.length) {
        const resolved = knowledge_base_ids.map((id) => {
          try {
            const base = knowledgeBaseService.getById(id)
            return { id: base.id, name: base.name }
          } catch (error: unknown) {
            // Only a genuine "not found" maps to null (→ filtered out); real
            // service/DB failures must propagate so they aren't misreported as 404.
            if (error instanceof DataApiError && error.code === ErrorCode.NOT_FOUND) {
              return null
            }
            throw error
          }
        })
        targetBases = resolved.filter((base): base is { id: string; name: string } => base !== null)
        if (targetBases.length === 0) {
          throw DataApiErrorFactory.notFound('KnowledgeBase', knowledge_base_ids.join(', '))
        }
      } else {
        const { items } = knowledgeBaseService.list({ page: 1, limit: 1000 })
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
      detail: {
        tags: [DOC_TAGS.cherry],
        summary: 'Search Knowledge Bases',
        description: DOC_DESCRIPTIONS.search_knowledge_bases
      }
    }
  )
  .get(
    '/:id/documents',
    ({ params, query }) => {
      const page = knowledgeItemService.listMetadata(params.id, query)
      const documents = page.items.map((document) => ({
        id: document.id,
        type: document.type,
        status: document.status,
        group_id: document.groupId ?? null,
        source: document.source,
        error: document.error
      }))
      return { documents, total: page.total, next_cursor: page.nextCursor }
    },
    {
      params: KnowledgeBaseIdParamSchema,
      query: KnowledgeDocumentsQuerySchema,
      response: { 200: ListKnowledgeDocumentsResponseSchema },
      detail: {
        tags: [DOC_TAGS.cherry],
        summary: 'List Knowledge Documents',
        description: DOC_DESCRIPTIONS.manage_knowledge_bases
      }
    }
  )
  .post(
    '/:id/documents',
    async ({ params, body }) => {
      const orchestrator = application.get('KnowledgeService')
      const result = await orchestrator.addItems(
        params.id,
        body.documents.map((document) => ({
          type: 'note' as const,
          groupId: document.group_id,
          data: { source: document.title, content: document.content }
        })),
        'rename'
      )
      if (result.status !== 'added') {
        throw new Error('Rename conflict strategy unexpectedly returned conflicts')
      }
      return result
    },
    {
      params: KnowledgeBaseIdParamSchema,
      body: AddKnowledgeDocumentsRequestSchema,
      response: { 200: AddKnowledgeDocumentsResponseSchema },
      detail: {
        tags: [DOC_TAGS.cherry],
        summary: 'Add Raw-Text Documents',
        description: DOC_DESCRIPTIONS.manage_knowledge_bases
      }
    }
  )
  .delete(
    '/:id/documents/:documentId',
    async ({ params, status }) => {
      const document = knowledgeItemService.getById(params.documentId)
      if (document.baseId !== params.id) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', params.documentId)
      }
      const orchestrator = application.get('KnowledgeService')
      await orchestrator.deleteItems(params.id, [params.documentId])
      return status(202, { status: 'queued' as const })
    },
    {
      params: KnowledgeDocumentIdParamSchema,
      response: { 202: DeleteKnowledgeDocumentResponseSchema },
      detail: {
        tags: [DOC_TAGS.cherry],
        summary: 'Delete Knowledge Document',
        description: DOC_DESCRIPTIONS.manage_knowledge_bases
      }
    }
  )
  .post(
    '/:id/documents/:documentId/reindex',
    async ({ params, status }) => {
      const document = knowledgeItemService.getById(params.documentId)
      if (document.baseId !== params.id) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', params.documentId)
      }
      const orchestrator = application.get('KnowledgeService')
      await orchestrator.reindexItems(params.id, [params.documentId])
      return status(202, { status: 'queued' as const })
    },
    {
      params: KnowledgeDocumentIdParamSchema,
      response: { 202: ReindexKnowledgeDocumentResponseSchema },
      detail: {
        tags: [DOC_TAGS.cherry],
        summary: 'Reindex Knowledge Document',
        description: DOC_DESCRIPTIONS.manage_knowledge_bases
      }
    }
  )
  .delete(
    '/:id',
    async ({ params }) => {
      const orchestrator = application.get('KnowledgeService')
      await orchestrator.deleteBase(params.id)
      return { deleted: true as const }
    },
    {
      params: KnowledgeBaseIdParamSchema,
      response: { 200: DeleteKnowledgeBaseResponseSchema },
      detail: {
        tags: [DOC_TAGS.cherry],
        summary: 'Delete Knowledge Base',
        description: DOC_DESCRIPTIONS.manage_knowledge_bases
      }
    }
  )
  .get('/:id', ({ params }) => knowledgeBaseService.getById(params.id), {
    params: KnowledgeBaseIdParamSchema,
    response: { 200: KnowledgeBaseResponseSchema },
    detail: {
      tags: [DOC_TAGS.cherry],
      summary: 'Get Knowledge Base',
      description: DOC_DESCRIPTIONS.get_knowledge_base
    }
  })
