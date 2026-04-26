import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { loggerService } from '@logger'
import { DataApiError } from '@shared/data/api'
import type { Response } from 'express'
import type * as z from 'zod'

import type { ValidationRequest } from '../agents/validators/zodValidator'
import type { KnowledgeSearchSchema } from './validators/zodSchemas'

const logger = loggerService.withContext('KnowledgeHandlers')

// Infer types from Zod schemas to avoid duplication
type ValidatedSearchBody = z.infer<typeof KnowledgeSearchSchema>

/**
 * Get all knowledge bases
 */
export const listKnowledgeBases = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    // Use Zod-validated values (defaults already applied by validator)
    const { limit = 20, offset = 0 } = req.validatedQuery ?? {}

    logger.debug('Listing knowledge bases', { limit, offset })

    const result = await knowledgeBaseService.list({ page: Math.floor(offset / limit) + 1, limit })

    return res.json({
      knowledge_bases: result.items,
      total: result.total
    })
  } catch (error) {
    logger.error('Failed to list knowledge bases', error as Error)
    return res.status(500).json({
      error: {
        message: 'Failed to list knowledge bases',
        type: 'internal_error',
        code: 'LIST_KB_ERROR'
      }
    })
  }
}

/**
 * Get a single knowledge base by ID
 */
export const getKnowledgeBase = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    // Zod already validated id exists and is non-empty
    const { id } = req.validatedParams ?? {}

    logger.debug(`Getting knowledge base: ${id}`)

    const base = await knowledgeBaseService.getById(id)

    return res.json(base)
  } catch (error) {
    if (error instanceof DataApiError && error.code === 'NOT_FOUND') {
      return res.status(404).json({
        error: {
          message: `Knowledge base not found: ${req.validatedParams?.id}`,
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    }
    logger.error('Failed to get knowledge base', error as Error)
    return res.status(500).json({
      error: {
        message: 'Failed to get knowledge base',
        type: 'internal_error',
        code: 'GET_KB_ERROR'
      }
    })
  }
}

/**
 * Search across knowledge bases
 *
 * This endpoint allows you to search through one or more knowledge bases
 * and retrieve relevant document chunks with similarity scores.
 */
export const searchKnowledge = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    // Use Zod-validated body (defaults already applied by validator)
    const { query, knowledge_base_ids, document_count = 5 } = (req.validatedBody ?? {}) as ValidatedSearchBody

    logger.debug(`Searching knowledge bases: "${query}"`, { knowledge_base_ids, document_count })

    const listResult = await knowledgeBaseService.list({ page: 1, limit: 100 })
    const bases = listResult.items

    if (!bases || bases.length === 0) {
      return res.json({
        query,
        results: [],
        total: 0,
        searched_bases: [],
        warnings: ['No knowledge bases configured. Please add knowledge bases in Cherry Studio.']
      })
    }

    // Filter by specified knowledge base IDs if provided
    const targetBases = knowledge_base_ids?.length ? bases.filter((b) => knowledge_base_ids.includes(b.id)) : bases

    if (knowledge_base_ids?.length && targetBases.length === 0) {
      return res.status(404).json({
        error: {
          message: 'None of the specified knowledge bases were found',
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    }

    // Search each knowledge base
    const searchPromises = targetBases.map(async (base) => {
      try {
        const runtime = application.get('KnowledgeRuntimeService')
        const searchResults = await runtime.search(base, query)

        return {
          baseId: base.id,
          baseName: base.name,
          results: searchResults.map((result) => ({
            ...result,
            knowledge_base_id: base.id,
            knowledge_base_name: base.name
          })),
          error: undefined
        }
      } catch (error) {
        logger.error(`Error searching knowledge base ${base.id}`, error as Error)
        return {
          baseId: base.id,
          baseName: base.name,
          results: [],
          error: (error as Error).message
        }
      }
    })

    const resultsPerBase = await Promise.all(searchPromises)

    // Check if all searches failed
    const allFailed = resultsPerBase.every((r) => r.results.length === 0 && r.error)
    if (allFailed && resultsPerBase.length > 0) {
      return res.status(502).json({
        error: {
          message: 'All knowledge base searches failed. Check embedding provider configuration.',
          type: 'upstream_error',
          code: 'SEARCH_ALL_FAILED',
          failed_bases: resultsPerBase.map((r) => ({ id: r.baseId, name: r.baseName, error: r.error }))
        }
      })
    }

    // Collect partial failures
    const warnings = resultsPerBase
      .filter((r) => r.error && r.results.length === 0)
      .map((r) => `Knowledge base "${r.baseName}" search failed: ${r.error}`)

    const allResults = resultsPerBase.flatMap((r) => r.results)
    const sortedResults = allResults.sort((a, b) => b.score - a.score).slice(0, document_count)

    logger.debug(`Found ${sortedResults.length} results for query: "${query}"`)

    return res.json({
      query,
      results: sortedResults,
      total: sortedResults.length,
      searched_bases: resultsPerBase.map((r) => ({ id: r.baseId, name: r.baseName })),
      ...(warnings.length > 0 && { warnings })
    })
  } catch (error) {
    logger.error('Failed to search knowledge bases', error as Error)
    return res.status(500).json({
      error: {
        message: 'Failed to search knowledge bases',
        type: 'internal_error',
        code: 'SEARCH_ERROR'
      }
    })
  }
}
