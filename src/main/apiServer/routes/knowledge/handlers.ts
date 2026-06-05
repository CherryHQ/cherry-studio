import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { loggerService } from '@logger'
import { DataApiError } from '@shared/data/api'
import { KNOWLEDGE_BASES_MAX_LIMIT, ListKnowledgeBasesQuerySchema } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeBase, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import type { Response } from 'express'
import type * as z from 'zod'

import type { KnowledgeSearchSchema } from './validators/zodSchemas'
import type { ValidationRequest } from './validators/zodValidator'

const logger = loggerService.withContext('KnowledgeHandlers')

type ValidatedSearchBody = z.infer<typeof KnowledgeSearchSchema>

interface ApiErrorBody {
  error: {
    message: string
    type: string
    code: string
    details?: Record<string, unknown>
  }
}

interface KnowledgeSearchResponse {
  query: string
  results: KnowledgeSearchResult[]
  total: number
  searchedBases: Array<Pick<KnowledgeBase, 'id' | 'name'>>
  warnings?: string[]
}

interface SearchResultPerBase {
  base: KnowledgeBase
  results: KnowledgeSearchResult[]
  error?: string
}

async function listAllKnowledgeBases(): Promise<KnowledgeBase[]> {
  const firstPage = await knowledgeBaseService.list({ page: 1, limit: KNOWLEDGE_BASES_MAX_LIMIT })
  const bases = [...firstPage.items]
  const pageCount = Math.ceil(firstPage.total / KNOWLEDGE_BASES_MAX_LIMIT)

  for (let page = 2; page <= pageCount; page += 1) {
    const result = await knowledgeBaseService.list({ page, limit: KNOWLEDGE_BASES_MAX_LIMIT })
    bases.push(...result.items)
  }

  return bases
}

function toApiError(
  error: unknown,
  fallback: { message: string; code: string }
): { status: number; body: ApiErrorBody } {
  if (error instanceof DataApiError) {
    return {
      status: error.status,
      body: {
        error: {
          message: error.message,
          type: error.status >= 500 ? 'server_error' : 'invalid_request_error',
          code: error.code,
          details: error.details as Record<string, unknown> | undefined
        }
      }
    }
  }

  const message = error instanceof Error ? error.message : fallback.message

  return {
    status: 500,
    body: {
      error: {
        message,
        type: 'server_error',
        code: fallback.code
      }
    }
  }
}

export const listKnowledgeBases = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    const { limit = 20, offset = 0 } = req.validatedQuery ?? {}
    const page = Math.floor(offset / limit) + 1
    const query = ListKnowledgeBasesQuerySchema.parse({ page, limit })

    logger.debug('Listing v2 knowledge bases', { limit, offset, page })

    const result = await knowledgeBaseService.list(query)
    return res.json(result)
  } catch (error) {
    logger.error('Failed to list knowledge bases', error as Error)
    const { status, body } = toApiError(error, {
      message: 'Failed to list knowledge bases',
      code: 'LIST_KB_ERROR'
    })
    return res.status(status).json(body)
  }
}

export const getKnowledgeBase = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    const { id } = req.validatedParams ?? {}

    logger.debug('Getting v2 knowledge base', { id })

    const base = await knowledgeBaseService.getById(id)
    return res.json(base)
  } catch (error) {
    logger.error('Failed to get knowledge base', error as Error)
    const { status, body } = toApiError(error, {
      message: 'Failed to get knowledge base',
      code: 'GET_KB_ERROR'
    })
    return res.status(status).json(body)
  }
}

export const searchKnowledge = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    const { query, knowledge_base_ids, document_count = 5 } = (req.validatedBody ?? {}) as ValidatedSearchBody

    logger.debug('Searching v2 knowledge bases', { query, knowledge_base_ids, document_count })

    const bases = await listAllKnowledgeBases()
    if (bases.length === 0) {
      return res.json({
        query,
        results: [],
        total: 0,
        searchedBases: [],
        warnings: ['No knowledge bases configured. Please add knowledge bases in Cherry Studio.']
      } satisfies KnowledgeSearchResponse)
    }

    const targetBases = knowledge_base_ids?.length
      ? bases.filter((base) => knowledge_base_ids.includes(base.id))
      : bases

    if (knowledge_base_ids?.length && targetBases.length === 0) {
      return res.status(404).json({
        error: {
          message: 'None of the specified knowledge bases were found',
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    }

    const orchestrator = application.get('KnowledgeOrchestrationService')
    const resultsPerBase: SearchResultPerBase[] = await Promise.all(
      targetBases.map(async (base) => {
        try {
          const results = await orchestrator.search(base.id, query)
          return { base, results }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.error('Error searching v2 knowledge base', error instanceof Error ? error : new Error(message), {
            baseId: base.id
          })
          return { base, results: [], error: message }
        }
      })
    )

    const allFailed = resultsPerBase.every((result) => result.results.length === 0 && result.error)
    if (allFailed && resultsPerBase.length > 0) {
      return res.status(502).json({
        error: {
          message: 'All knowledge base searches failed. Check embedding provider configuration.',
          type: 'upstream_error',
          code: 'SEARCH_ALL_FAILED',
          failedBases: resultsPerBase.map((result) => ({
            id: result.base.id,
            name: result.base.name,
            error: result.error
          }))
        }
      })
    }

    const warnings = resultsPerBase
      .filter((result) => result.error && result.results.length === 0)
      .map((result) => `Knowledge base "${result.base.name}" search failed: ${result.error}`)

    const sortedResults = resultsPerBase
      .flatMap((result) => result.results)
      .sort((a, b) => b.score - a.score)
      .slice(0, document_count)

    logger.debug('Finished v2 knowledge search', {
      query,
      resultCount: sortedResults.length,
      searchedBaseCount: resultsPerBase.length
    })

    return res.json({
      query,
      results: sortedResults,
      total: sortedResults.length,
      searchedBases: resultsPerBase.map((result) => ({ id: result.base.id, name: result.base.name })),
      ...(warnings.length > 0 && { warnings })
    } satisfies KnowledgeSearchResponse)
  } catch (error) {
    logger.error('Failed to search knowledge bases', error as Error)
    const { status, body } = toApiError(error, {
      message: 'Failed to search knowledge bases',
      code: 'SEARCH_ERROR'
    })
    return res.status(status).json(body)
  }
}
