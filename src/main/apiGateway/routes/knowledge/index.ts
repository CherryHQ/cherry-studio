import { Elysia } from 'elysia'

import { getKnowledgeBase, listKnowledgeBases, searchKnowledge } from './handlers'
import { KnowledgeBaseIdParamSchema, KnowledgeSearchSchema, PaginationQuerySchema } from './validators'

/**
 * Knowledge base routes (Elysia plugin, mounted under `/v1`).
 * Reuses the existing Zod schemas (Standard Schema) for validation.
 */
export const knowledgeRoutes = new Elysia({ prefix: '/knowledge-bases' })
  .get('/', ({ query }) => listKnowledgeBases(query), {
    query: PaginationQuerySchema,
    detail: { tags: ['Knowledge'], summary: 'List all knowledge bases' }
  })
  .post('/search', ({ body }) => searchKnowledge(body), {
    body: KnowledgeSearchSchema,
    detail: { tags: ['Knowledge'], summary: 'Search knowledge bases' }
  })
  .get('/:id', ({ params }) => getKnowledgeBase(params.id), {
    params: KnowledgeBaseIdParamSchema,
    detail: { tags: ['Knowledge'], summary: 'Get a knowledge base by ID' }
  })
