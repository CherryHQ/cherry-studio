import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { knowledgeService } from '@main/services/KnowledgeService'
import { reduxService } from '@main/services/ReduxService'
import type { LoaderReturn } from '@shared/config/types'
import { isDataApiError } from '@shared/data/api'
import type { CreateKnowledgeItemsDto } from '@shared/data/api/schemas/knowledges'
import type {
  KnowledgeBase as V2KnowledgeBase,
  KnowledgeItem as V2KnowledgeItem,
  KnowledgeItemIngestion
} from '@shared/data/types/knowledge'
import type {
  KnowledgeBaseParams,
  KnowledgeItem as LegacyKnowledgeItem,
  KnowledgeNoteItem as LegacyKnowledgeNoteItem,
  Provider
} from '@types'
import type { Response } from 'express'
import type * as z from 'zod'

import type { ValidationRequest } from '../agents/validators/zodValidator'
import type { CreateKnowledgeItemsRequestSchema, KnowledgeSearchSchema } from './validators/zodSchemas'

const logger = loggerService.withContext('KnowledgeHandlers')

type ValidatedSearchBody = z.infer<typeof KnowledgeSearchSchema>
type ValidatedCreateKnowledgeItemsBody = z.infer<typeof CreateKnowledgeItemsRequestSchema>

type ApiKnowledgeBaseEntity = {
  id: string
  name: string
  description?: string
  model: {
    id: string
    provider: string
  }
  dimensions?: number
  chunkSize?: number
  chunkOverlap?: number
  documentCount?: number
  version: number
  threshold?: number
  rerankModel?: {
    id: string
    provider: string
  }
  preprocessProvider?: {
    type: 'preprocess'
    provider: string
  }
  items: []
  created_at: number
  updated_at: number
}

function isReduxUnavailableError(error: unknown): boolean {
  const message = (error as Error)?.message || ''
  return message.includes('Main window is not available') || message.includes('Timeout waiting for Redux store')
}

function sendReduxUnavailable(res: Response): Response {
  return res.status(503).json({
    error: {
      message: 'Provider configuration is only available when Cherry Studio window is open',
      type: 'service_unavailable',
      code: 'REDUX_UNAVAILABLE'
    }
  })
}

function sendDataApiError(res: Response, error: unknown): Response {
  if (!isDataApiError(error)) {
    throw error
  }

  return res.status(error.status).json({
    error: {
      message: error.message,
      type: 'data_api_error',
      code: error.code,
      ...(error.details ? { details: error.details } : {})
    }
  })
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function parseModelReference(modelReference?: string | null): { provider: string; id: string } | null {
  if (!modelReference) {
    return null
  }

  const trimmed = modelReference.trim()
  if (!trimmed) {
    return null
  }

  const delimiterIndex = trimmed.indexOf('::')
  if (delimiterIndex === -1) {
    return {
      provider: 'unknown',
      id: trimmed
    }
  }

  return {
    provider: trimmed.slice(0, delimiterIndex).trim(),
    id: trimmed.slice(delimiterIndex + 2).trim()
  }
}

function toApiKnowledgeBaseEntity(base: V2KnowledgeBase): ApiKnowledgeBaseEntity {
  const embeddingModel = parseModelReference(base.embeddingModelId)
  const rerankModel = parseModelReference(base.rerankModelId)

  return {
    id: base.id,
    name: base.name,
    description: base.description,
    model: embeddingModel ?? {
      id: base.embeddingModelId,
      provider: 'unknown'
    },
    dimensions: base.dimensions,
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
    documentCount: base.documentCount,
    version: 2,
    threshold: base.threshold,
    ...(rerankModel
      ? {
          rerankModel
        }
      : {}),
    ...(base.fileProcessorId
      ? {
          preprocessProvider: {
            type: 'preprocess' as const,
            provider: base.fileProcessorId
          }
        }
      : {}),
    items: [],
    created_at: Date.parse(base.createdAt),
    updated_at: Date.parse(base.updatedAt)
  }
}

async function getProviderConfigs(): Promise<Provider[]> {
  return await reduxService.select<Provider[]>('state.llm.providers')
}

function resolveProviderModel(
  modelReference: string,
  providers: Provider[]
): { providerId: string; modelId: string; provider: Provider } {
  const composite = parseModelReference(modelReference)
  if (composite && composite.provider !== 'unknown') {
    const provider = providers.find((item) => item.id === composite.provider)
    if (!provider) {
      throw new Error(`Provider "${composite.provider}" not found for model "${modelReference}"`)
    }

    return {
      providerId: composite.provider,
      modelId: composite.id,
      provider
    }
  }

  const provider = providers.find((item) => item.models.some((model) => model.id === modelReference.trim()))
  if (!provider) {
    throw new Error(`Unable to resolve provider for model "${modelReference}"`)
  }

  return {
    providerId: provider.id,
    modelId: modelReference.trim(),
    provider
  }
}

function normalizeProviderBaseURL(provider: Provider): string {
  return (provider.apiHost || '').replace(/\/+$/, '').replace(/#$/, '')
}

async function getKnowledgeBaseParams(base: V2KnowledgeBase, providers?: Provider[]): Promise<KnowledgeBaseParams> {
  const resolvedProviders = providers ?? (await getProviderConfigs())
  const embedding = resolveProviderModel(base.embeddingModelId, resolvedProviders)

  const params: KnowledgeBaseParams = {
    id: base.id,
    dimensions: base.dimensions,
    chunkSize: base.chunkSize,
    chunkOverlap: base.chunkOverlap,
    documentCount: base.documentCount,
    embedApiClient: {
      model: embedding.modelId,
      provider: embedding.providerId,
      apiKey: embedding.provider.apiKey || '',
      baseURL: normalizeProviderBaseURL(embedding.provider),
      ...(embedding.provider.apiVersion ? { apiVersion: embedding.provider.apiVersion } : {})
    }
  }

  if (base.rerankModelId) {
    const rerank = resolveProviderModel(base.rerankModelId, resolvedProviders)
    params.rerankApiClient = {
      model: rerank.modelId,
      provider: rerank.providerId,
      apiKey: rerank.provider.apiKey || '',
      baseURL: normalizeProviderBaseURL(rerank.provider),
      ...(rerank.provider.apiVersion ? { apiVersion: rerank.provider.apiVersion } : {})
    }
  }

  return params
}

function toLegacyKnowledgeItem(item: V2KnowledgeItem): LegacyKnowledgeItem | LegacyKnowledgeNoteItem {
  const timestamps = {
    created_at: Date.parse(item.createdAt),
    updated_at: Date.parse(item.updatedAt)
  }

  switch (item.type) {
    case 'file':
      return {
        id: item.id,
        baseId: item.baseId,
        type: 'file',
        content: item.data.file,
        ...timestamps
      }
    case 'url':
      return {
        id: item.id,
        baseId: item.baseId,
        type: 'url',
        content: item.data.url,
        remark: item.data.name,
        ...timestamps
      }
    case 'note':
      return {
        id: item.id,
        baseId: item.baseId,
        type: 'note',
        content: item.data.content,
        sourceUrl: item.data.sourceUrl,
        ...timestamps
      }
    case 'sitemap':
      return {
        id: item.id,
        baseId: item.baseId,
        type: 'sitemap',
        content: item.data.url,
        remark: item.data.name,
        ...timestamps
      }
    case 'directory':
      return {
        id: item.id,
        baseId: item.baseId,
        type: 'directory',
        content: item.data.path,
        ...timestamps
      }
  }
}

function buildIngestionMetadata(result: LoaderReturn): KnowledgeItemIngestion | null {
  if (result.entriesAdded <= 0) {
    return null
  }

  const normalizedLoaderIds = result.uniqueIds.filter((loaderId) => loaderId.trim() !== '')
  const normalizedLoaderId = result.uniqueId.trim() || normalizedLoaderIds[0]

  if (!normalizedLoaderId) {
    return null
  }

  return {
    loaderId: normalizedLoaderId,
    loaderIds: normalizedLoaderIds.length > 0 ? normalizedLoaderIds : [normalizedLoaderId]
  }
}

/**
 * Get all knowledge bases
 */
export const listKnowledgeBases = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    const { limit = 20, offset = 0 } = req.validatedQuery ?? {}

    logger.debug('Listing knowledge bases', { limit, offset })

    const result = await knowledgeBaseService.listWithOffset({ limit, offset })

    return res.json({
      knowledge_bases: result.items.map((base) => toApiKnowledgeBaseEntity(base)),
      total: result.total
    })
  } catch (error) {
    if (isDataApiError(error)) {
      return sendDataApiError(res, error)
    }

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
    const { id } = req.validatedParams ?? {}

    logger.debug(`Getting knowledge base: ${id}`)

    const base = await knowledgeBaseService.getById(id)
    return res.json(toApiKnowledgeBaseEntity(base))
  } catch (error) {
    if (isDataApiError(error)) {
      return sendDataApiError(res, error)
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
 * Create and ingest knowledge items into the vector store
 */
export const createKnowledgeItems = async (req: ValidationRequest, res: Response): Promise<Response> => {
  try {
    const { id } = req.validatedParams ?? {}
    const body = (req.validatedBody ?? {}) as ValidatedCreateKnowledgeItemsBody
    const dto: CreateKnowledgeItemsDto = {
      items: body.items
    }

    const [base, providers] = await Promise.all([knowledgeBaseService.getById(id), getProviderConfigs()])
    const baseParams = await getKnowledgeBaseParams(base, providers)
    const created = await knowledgeItemService.createMany(id, dto)

    const updatedItems = await Promise.all(
      created.items.map(async (item) => {
        await knowledgeItemService.update(item.id, {
          status: 'pending',
          error: null
        })

        try {
          const result = await knowledgeService.add({} as Electron.IpcMainInvokeEvent, {
            base: baseParams,
            item: toLegacyKnowledgeItem(item)
          })
          const ingestion = buildIngestionMetadata(result)

          if (!ingestion) {
            throw new Error(result.message || 'Knowledge item ingest failed')
          }

          return await knowledgeItemService.update(item.id, {
            data: {
              ...item.data,
              ingestion
            },
            status: 'completed',
            error: null
          })
        } catch (error) {
          return await knowledgeItemService.update(item.id, {
            status: 'failed',
            error: getErrorMessage(error)
          })
        }
      })
    )

    return res.status(201).json({
      items: updatedItems
    })
  } catch (error) {
    if (isReduxUnavailableError(error)) {
      return sendReduxUnavailable(res)
    }

    if (isDataApiError(error)) {
      return sendDataApiError(res, error)
    }

    logger.error('Failed to create knowledge items', error as Error)
    return res.status(500).json({
      error: {
        message: 'Failed to create knowledge items',
        type: 'internal_error',
        code: 'CREATE_KNOWLEDGE_ITEMS_ERROR'
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
    const { query, knowledge_base_ids, document_count = 5 } = (req.validatedBody ?? {}) as ValidatedSearchBody

    logger.debug(`Searching knowledge bases: "${query}"`, { knowledge_base_ids, document_count })

    const bases = await knowledgeBaseService.listAll()

    if (bases.length === 0) {
      return res.json({
        query,
        results: [],
        total: 0,
        searched_bases: [],
        warnings: ['No knowledge bases configured. Please add knowledge bases in Cherry Studio.']
      })
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

    const providers = await getProviderConfigs()
    const resultsPerBase = await Promise.all(
      targetBases.map(async (base) => {
        try {
          const params = await getKnowledgeBaseParams(base, providers)
          const searchResults = await knowledgeService.search({} as Electron.IpcMainInvokeEvent, {
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
            error: getErrorMessage(error)
          }
        }
      })
    )

    const allFailed = resultsPerBase.every((item) => item.results.length === 0 && item.error)
    if (allFailed && resultsPerBase.length > 0) {
      return res.status(502).json({
        error: {
          message: 'All knowledge base searches failed. Check embedding provider configuration.',
          type: 'upstream_error',
          code: 'SEARCH_ALL_FAILED',
          failed_bases: resultsPerBase.map((item) => ({
            id: item.baseId,
            name: item.baseName,
            error: item.error
          }))
        }
      })
    }

    const warnings = resultsPerBase
      .filter((item) => item.error && item.results.length === 0)
      .map((item) => `Knowledge base "${item.baseName}" search failed: ${item.error}`)

    const sortedResults = resultsPerBase
      .flatMap((item) => item.results)
      .sort((left, right) => right.score - left.score)
      .slice(0, document_count)

    return res.json({
      query,
      results: sortedResults,
      total: sortedResults.length,
      searched_bases: resultsPerBase.map((item) => ({
        id: item.baseId,
        name: item.baseName
      })),
      ...(warnings.length > 0 ? { warnings } : {})
    })
  } catch (error) {
    if (isReduxUnavailableError(error)) {
      return sendReduxUnavailable(res)
    }

    if (isDataApiError(error)) {
      return sendDataApiError(res, error)
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
