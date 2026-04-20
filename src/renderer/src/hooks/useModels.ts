import { dataApiService } from '@data/DataApiService'
import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateModelDto, CreateModelsBatchDto, ListModelsQuery, UpdateModelDto } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useModels')

/** Helper to build `/models/:uniqueModelId*` concrete path.
 *  No encoding needed: greedy param `/:uniqueModelId*` handles slashes natively. */
function modelPath(providerId: string, modelId: string): ConcreteApiPaths {
  return `/models/${createUniqueModelId(providerId, modelId)}` as ConcreteApiPaths
}

const REFRESH_MODELS = ['/models'] as const
const EMPTY_MODELS: Model[] = []

// ─── Layer 1: List ────────────────────────────────────────────────────
export function useModels(query?: ListModelsQuery, options?: { fetchEnabled?: boolean }) {
  const filteredQuery = query
    ? (Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as ListModelsQuery)
    : undefined
  const hasQuery = filteredQuery && Object.keys(filteredQuery).length > 0

  const { data, isLoading, mutate } = useQuery('/models', {
    ...(hasQuery ? { query: filteredQuery } : {}),
    ...(options?.fetchEnabled !== undefined ? { enabled: options.fetchEnabled } : {})
  })

  const models = useMemo(() => data ?? EMPTY_MODELS, [data])

  return { models, isLoading, refetch: mutate }
}

// ─── Layer 2: Mutations ───────────────────────────────────────────────
export function useModelMutations() {
  const invalidate = useInvalidateCache()

  const { trigger: createTrigger } = useMutation('POST', '/models', {
    refresh: [...REFRESH_MODELS]
  })
  const { trigger: createBatchTrigger } = useMutation('POST', '/models/batch', {
    refresh: [...REFRESH_MODELS]
  })

  const createModel = useCallback(
    async (dto: CreateModelDto) => {
      try {
        return await createTrigger({ body: dto })
      } catch (error) {
        logger.error('Failed to create model', { providerId: dto.providerId, modelId: dto.modelId, error })
        throw error
      }
    },
    [createTrigger]
  )
  const createModelsBatch = useCallback(
    async (dtos: CreateModelsBatchDto['items']) => {
      try {
        return await createBatchTrigger({ body: { items: dtos } })
      } catch (error) {
        logger.error('Failed to create model batch', { count: dtos.length, error })
        throw error
      }
    },
    [createBatchTrigger]
  )

  const deleteModel = useCallback(
    async (providerId: string, modelId: string) => {
      try {
        await dataApiService.delete(modelPath(providerId, modelId))
        await invalidate('/models')
      } catch (error) {
        logger.error('Failed to delete model', { providerId, modelId, error })
        throw error
      }
    },
    [invalidate]
  )

  const updateModel = useCallback(
    async (providerId: string, modelId: string, updates: UpdateModelDto) => {
      try {
        await dataApiService.patch(modelPath(providerId, modelId), { body: updates })
        await invalidate('/models')
      } catch (error) {
        logger.error('Failed to update model', { providerId, modelId, error })
        throw error
      }
    },
    [invalidate]
  )

  return { createModel, createModelsBatch, deleteModel, updateModel }
}
