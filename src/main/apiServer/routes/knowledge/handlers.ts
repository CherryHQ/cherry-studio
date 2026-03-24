import { loggerService } from '@logger'
import KnowledgeService from '@main/services/KnowledgeService'
import { reduxService } from '@main/services/ReduxService'
import type { KnowledgeBase, KnowledgeBaseParams, Model } from '@types'
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
  top_n?: number
}

/**
 * Convert KnowledgeBase to KnowledgeBaseParams for search
 */
function getKnowledgeBaseParams(base: KnowledgeBase): KnowledgeBaseParams {
  // Model.provider is a string (provider ID)
  const providerId = base.model?.provider || 'ollama'

  const rerankModel = (base as any).rerankModel as Model | undefined

  // Determine embed API client params
  // For Ollama, typically use localhost:11434
  const isOllama = providerId === 'ollama'
  const embedApiClient = {
    model: base.model?.id || '',
    provider: providerId,
    apiKey: '', // Will be populated by the KnowledgeService from provider config
    baseURL: isOllama ? 'http://localhost:11434' : '' // Ollama is default
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
  if (rerankModel?.provider) {
    params.rerankApiClient = {
      model: rerankModel.id || '',
      provider: rerankModel.provider,
      apiKey: '',
      baseURL: ''
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
    const { query, knowledge_base_ids, top_n = 5 } = req.body as SearchRequest

    if (!query) {
      return res.status(400).json({
        error: {
          message: 'Search query is required',
          type: 'invalid_request_error',
          code: 'MISSING_QUERY'
        }
      })
    }

    logger.debug(`Searching knowledge bases: "${query}"`, { knowledge_base_ids, top_n })

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
        const params = getKnowledgeBaseParams(base)

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

    // Sort by score and limit to top_n
    const sortedResults = allResults.sort((a, b) => b.score - a.score).slice(0, top_n)

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
