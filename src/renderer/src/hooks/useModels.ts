import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { CreateModelDto, CreateModelsDto, ListModelsQuery, UpdateModelDto } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import { useCallback, useMemo } from 'react'

const logger = loggerService.withContext('useModels')

const EMPTY_MODELS: Model[] = []

// ─── Layer 1: List ────────────────────────────────────────────────────
export function useModels(query?: ListModelsQuery, options?: { fetchEnabled?: boolean }) {
  const filtered = query
    ? (Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as ListModelsQuery)
    : undefined
  const hasQuery = filtered && Object.keys(filtered).length > 0
  const fetchEnabledFlag = options?.fetchEnabled
  const hasEnabled = fetchEnabledFlag !== undefined

  const { data, isLoading, refetch } = useQuery(
    '/models',
    hasQuery || hasEnabled
      ? {
          ...(hasQuery && { query: filtered }),
          ...(hasEnabled && { enabled: fetchEnabledFlag })
        }
      : undefined
  )

  const models = useMemo(() => data ?? EMPTY_MODELS, [data])

  return { models, isLoading, refetch }
}

// ─── Layer 2: Mutations ───────────────────────────────────────────────
export function useModelMutations() {
  const {
    trigger: createTrigger,
    isLoading: isCreating,
    error: createError
  } = useMutation('POST', '/models', {
    refresh: ['/models']
  })

  const {
    trigger: deleteTrigger,
    isLoading: isDeleting,
    error: deleteError
  } = useMutation('DELETE', '/models/:uniqueModelId*', { refresh: ['/models'] })

  const {
    trigger: updateTrigger,
    isLoading: isUpdating,
    error: updateError
  } = useMutation('PATCH', '/models/:uniqueModelId*', { refresh: ['/models'] })

  const createModel = useCallback(
    async (dto: CreateModelDto) => {
      try {
        // Service/DataApi create is intentionally array-based. This wrapper keeps
        // the old single-model ergonomics at the renderer boundary.
        const created = await createTrigger({ body: [dto] })
        if (!Array.isArray(created)) {
          throw new Error('Expected an array of created models')
        }
        if (created.length !== 1) {
          throw new Error(`Expected exactly one created model, received ${created.length}`)
        }
        return created[0]
      } catch (error) {
        logger.error('Failed to create model', { providerId: dto.providerId, modelId: dto.modelId, error })
        throw error
      }
    },
    [createTrigger]
  )

  const createModels = useCallback(
    async (dtos: CreateModelsDto) => {
      try {
        // Batch callers already match the transport contract, so this path
        // forwards the array verbatim and validates the response shape.
        const created = await createTrigger({ body: dtos })
        if (!Array.isArray(created)) {
          throw new Error('Expected an array of created models')
        }
        return created
      } catch (error) {
        logger.error('Failed to create models', { count: dtos.length, error })
        throw error
      }
    },
    [createTrigger]
  )

  const deleteModel = useCallback(
    async (providerId: string, modelId: string) => {
      try {
        await deleteTrigger({ params: { uniqueModelId: createUniqueModelId(providerId, modelId) } })
      } catch (error) {
        logger.error('Failed to delete model', { providerId, modelId, error })
        throw error
      }
    },
    [deleteTrigger]
  )

  const updateModel = useCallback(
    async (providerId: string, modelId: string, updates: UpdateModelDto) => {
      try {
        await updateTrigger({ params: { uniqueModelId: createUniqueModelId(providerId, modelId) }, body: updates })
      } catch (error) {
        logger.error('Failed to update model', { providerId, modelId, error })
        throw error
      }
    },
    [updateTrigger]
  )

  return {
    createModel,
    createModels,
    isCreating,
    createError,
    deleteModel,
    isDeleting,
    deleteError,
    updateModel,
    isUpdating,
    updateError
  }
}
