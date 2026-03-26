// TODO(v2): All Redux store reads in this file (state.knowledge.bases, state.llm.providers)
//           should migrate to the V2 SQLite/Drizzle data layer (src/main/services/agents/).
//           Redux is blocked for new data-model features until v2.0.0.
//           See: src/main/services/agents/database/schema/index.ts

import { loggerService } from '@logger'
import KnowledgeService from '@main/services/KnowledgeService'
import { reduxService } from '@main/services/ReduxService'
import type { KnowledgeBase, KnowledgeBaseParams, Provider } from '@types'
import type { Response } from 'express'
import type * as z from 'zod'

import type { ValidationRequest } from '../agents/validators/zodValidator'
import type { KnowledgeSearchSchema } from './validators/zodSchemas'

const logger = loggerService.withContext('KnowledgeHandlers')

// Infer types from Zod schemas to avoid duplication
type ValidatedSearchBody = z.infer<typeof KnowledgeSearchSchema>

/**
 * Helper to detect Redux unavailability errors
 */
function isReduxUnavailableError(error: unknown): boolean {
  const message = (error as Error)?.message || ''
  return message.includes('Main window is not available') || message.includes('Timeout waiting for Redux store')
}

/**
 * Get all knowledge bases
 */
export const listKnowledgeBases = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    // Use Zod-validated values (defaults already applied by validator)
    const { limit = 20, offset = 0 } = req.validatedQuery ?? {}

    logger.debug('Listing knowledge bases', { limit, offset })

    // Get knowledge bases from Redux store
    // TODO(v2): Migrate to V2 knowledge base storage (SQLite/Drizzle).
    //           Redux access requires Cherry Studio window to be open.
    let bases: KnowledgeBase[]
    try {
      bases = await reduxService.select<KnowledgeBase[]>('state.knowledge.bases')
    } catch (error) {
      if (isReduxUnavailableError(error)) {
        logger.warn('Redux store not available, returning 503')
        return res.status(503).json({
          error: {
            message: 'Knowledge bases are only available when Cherry Studio window is open',
            type: 'service_unavailable',
            code: 'REDUX_UNAVAILABLE'
          }
        })
      }
      throw error // Re-throw non-Redux errors to outer catch
    }

    const total = bases?.length || 0
    const paginatedBases = (bases || []).slice(offset, offset + limit)
    return res.json({
      knowledge_bases: paginatedBases,
      total
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

    // TODO(v2): Migrate to V2 knowledge base storage (SQLite/Drizzle).
    const bases = await reduxService.select<KnowledgeBase[]>('state.knowledge.bases')
    const base = bases?.find((b) => b.id === id)

    if (!base) {
      return res.status(404).json({
        error: {
          message: `Knowledge base not found: ${id}`,
          type: 'invalid_request_error',
          code: 'KB_NOT_FOUND'
        }
      })
    }

    return res.json(base)
  } catch (error) {
    if (isReduxUnavailableError(error)) {
      return res.status(503).json({
        error: {
          message: 'Knowledge bases are only available when Cherry Studio window is open',
          type: 'service_unavailable',
          code: 'REDUX_UNAVAILABLE'
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
 * Get provider configuration from Redux store by provider ID
 *
 * TODO(v2): Migrate to V2 provider config storage (SQLite/Drizzle) so the API server
 *           can resolve embedding/rerank provider credentials without a running renderer.
 *
 * NOTE: Redux errors are allowed to propagate - they will be caught by the handler's
 *       try/catch and converted to 503 responses via isReduxUnavailableError().
 */
async function getProviderConfig(providerId: string): Promise<{ apiKey: string; baseURL: string } | null> {
  const providers = await reduxService.select<Provider[]>('state.llm.providers')
  const provider = providers?.find((p) => p.id === providerId)
  if (!provider) {
    logger.warn(`Provider not found: ${providerId}`)
    return null
  }

  // Derive baseURL from apiHost, removing trailing slashes and # suffix
  let baseURL = provider.apiHost || ''
  baseURL = baseURL.replace(/\/+$/, '')
  baseURL = baseURL.replace(/#$/, '')

  return {
    apiKey: provider.apiKey || '',
    baseURL
  }
}

/**
 * Convert KnowledgeBase to KnowledgeBaseParams for search
 */
async function getKnowledgeBaseParams(base: KnowledgeBase): Promise<KnowledgeBaseParams> {
  // Validate that embedding model provider is configured
  const embedProviderId = base.model?.provider
  if (!embedProviderId) {
    throw new Error(`Knowledge base "${base.name}" is missing embedding model provider configuration`)
  }

  const embedConfig = await getProviderConfig(embedProviderId)
  if (!embedConfig) {
    throw new Error(`Provider "${embedProviderId}" not found for knowledge base "${base.name}"`)
  }

  const embedApiClient = {
    model: base.model?.id || '',
    provider: embedProviderId,
    apiKey: embedConfig.apiKey,
    baseURL: embedConfig.baseURL
  }

  // Build the params object
  const params: KnowledgeBaseParams = {
    id: base.id,
    dimensions: base.dimensions,
    embedApiClient,
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
    documentCount: base.documentCount
  }

  // Add rerank if configured
  if (base.rerankModel?.provider) {
    const rerankConfig = await getProviderConfig(base.rerankModel.provider)
    if (!rerankConfig) {
      logger.warn(`Rerank provider not found for knowledge base "${base.name}": ${base.rerankModel.provider}`)
    } else {
      params.rerankApiClient = {
        model: base.rerankModel.id || '',
        provider: base.rerankModel.provider,
        apiKey: rerankConfig.apiKey,
        baseURL: rerankConfig.baseURL
      }
    }
  }

  return params
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

    // Get knowledge bases from Redux
    // TODO(v2): Migrate to V2 knowledge base storage (SQLite/Drizzle).
    const bases = await reduxService.select<KnowledgeBase[]>('state.knowledge.bases')

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
        const params = await getKnowledgeBaseParams(base)

        // WORKAROUND: KnowledgeService.search() expects Electron.IpcMainInvokeEvent for IPC signature.
        // The @TraceMethod decorator doesn't currently access event properties, so passing {} is safe.
        // TODO(v2): Add searchInternal() method to KnowledgeService for non-IPC calls.
        const searchResults = await KnowledgeService.search({} as Electron.IpcMainInvokeEvent, {
          search: query,
          base: params
        })

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
    if (isReduxUnavailableError(error)) {
      return res.status(503).json({
        error: {
          message: 'Knowledge bases are only available when Cherry Studio window is open',
          type: 'service_unavailable',
          code: 'REDUX_UNAVAILABLE'
        }
      })
    }
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
