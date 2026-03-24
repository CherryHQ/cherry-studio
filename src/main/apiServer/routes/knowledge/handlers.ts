import { loggerService } from '@logger'
import KnowledgeService from '@main/services/KnowledgeService'
import { reduxService } from '@main/services/ReduxService'
import type { KnowledgeBase, KnowledgeBaseParams, Provider } from '@types'
import type { Request, Response } from 'express'

const logger = loggerService.withContext('KnowledgeHandlers')

/**
 * Get all knowledge bases
 */
export const listKnowledgeBases = async (_req: Request, res: Response): Promise<Response> => {
  try {
    logger.debug('Listing knowledge bases')

    // Get knowledge bases from Redux store
    try {
      const bases = await reduxService.select<KnowledgeBase[]>('state.knowledge.bases')
      return res.json({
        knowledge_bases: bases || [],
        total: bases?.length || 0
      })
    } catch {
      logger.warn('Redux store not available, returning empty list')
      return res.json({
        knowledge_bases: [],
        total: 0,
        warning: 'Knowledge bases are only available when Cherry Studio window is open'
      })
    }
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
export const getKnowledgeBase = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { id } = req.params

    if (!id) {
      return res.status(400).json({
        error: {
          message: 'Knowledge base ID is required',
          type: 'invalid_request_error',
          code: 'MISSING_ID'
        }
      })
    }

    logger.debug(`Getting knowledge base: ${id}`)

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

interface SearchRequest {
  query: string
  knowledge_base_ids?: string[]
  document_count?: number
}

/**
 * Get provider configuration from Redux store by provider ID
 */
async function getProviderConfig(providerId: string): Promise<{ apiKey: string; baseURL: string } | null> {
  try {
    const providers = await reduxService.select<Provider[]>('state.llm.providers')
    const provider = providers?.find((p) => p.id === providerId)
    if (!provider) {
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
  } catch {
    return null
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
    if (rerankConfig) {
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
export const searchKnowledge = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { query, knowledge_base_ids, document_count = 5 } = req.body as SearchRequest

    if (!query) {
      return res.status(400).json({
        error: {
          message: 'Search query is required',
          type: 'invalid_request_error',
          code: 'MISSING_QUERY'
        }
      })
    }

    logger.debug(`Searching knowledge bases: "${query}"`, { knowledge_base_ids, document_count })

    // Get knowledge bases from Redux
    const bases = await reduxService.select<KnowledgeBase[]>('state.knowledge.bases')

    if (!bases || bases.length === 0) {
      return res.json({
        results: [],
        total: 0,
        message: 'No knowledge bases configured. Please add knowledge bases in Cherry Studio.'
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

        // Call KnowledgeService.search directly (first param is IPC event, not used)
        const searchResults = await KnowledgeService.search({} as Electron.IpcMainInvokeEvent, {
          search: query,
          base: params
        })

        return searchResults.map((result) => ({
          ...result,
          knowledge_base_id: base.id,
          knowledge_base_name: base.name
        }))
      } catch (error) {
        logger.error(`Error searching knowledge base ${base.id}`, error as Error)
        return []
      }
    })

    const resultsPerBase = await Promise.all(searchPromises)
    const allResults = resultsPerBase.flat()

    // Sort by score and limit to document_count
    const sortedResults = allResults.sort((a, b) => b.score - a.score).slice(0, document_count)

    logger.debug(`Found ${sortedResults.length} results for query: "${query}"`)

    return res.json({
      query,
      results: sortedResults,
      total: sortedResults.length,
      searched_bases: targetBases.map((b) => ({ id: b.id, name: b.name }))
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
