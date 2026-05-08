import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type {
  BulkUpdateModelsDto,
  CreateModelDto,
  CreateModelsDto,
  ListModelsQuery,
  UpdateModelDto
} from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import { createUniqueModelId } from '@shared/data/types/model'
import { isUndefined, omitBy } from 'lodash'
import { useCallback } from 'react'
import type { SWRConfiguration } from 'swr'

const logger = loggerService.withContext('useModels')

const EMPTY_MODELS: Model[] = []

// ─── Layer 1: List ────────────────────────────────────────────────────
export function useModels(
  query?: ListModelsQuery,
  options?: { fetchEnabled?: boolean; swrOptions?: SWRConfiguration }
) {
  const filtered = query ? (omitBy(query, isUndefined) as ListModelsQuery) : undefined
  const hasQuery = filtered && Object.keys(filtered).length > 0
  const fetchEnabledFlag = options?.fetchEnabled
  const hasEnabled = fetchEnabledFlag !== undefined

  const { data, isLoading, refetch } = useQuery(
    '/models',
    hasQuery || hasEnabled
      ? {
          ...(hasQuery && { query: filtered }),
          ...(hasEnabled && { enabled: fetchEnabledFlag }),
          ...(options?.swrOptions && { swrOptions: options.swrOptions })
        }
      : options?.swrOptions
        ? { swrOptions: options.swrOptions }
        : undefined
  )

  const models = data ?? EMPTY_MODELS

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

  const {
    trigger: bulkUpdateTrigger,
    isLoading: isBulkUpdating,
    error: bulkUpdateError
  } = useMutation('PATCH', '/models', { refresh: ['/models'] })

  const createModel = useCallback(
    async (dto: CreateModelDto) => {
      try {
        // Service/DataApi create is intentionally array-based. This wrapper keeps
        // the old single-model ergonomics at the renderer boundary.
        const [created] = await createTrigger({ body: [dto] })
        return created
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
        // forwards the array verbatim and passes the typed response through.
        return await createTrigger({ body: dtos })
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

  /**
   * Atomic batch update via `PATCH /models`.
   *
   * One IPC + one DB transaction + one `/models` revalidation. Per-item field
   * semantics match `updateModel` (only fields present in `patch` are written;
   * other columns and `userOverrides` tracking are preserved). On any failure
   * the whole batch rolls back — there is no partial-success state for
   * callers to reason about.
   */
  const updateModels = useCallback(
    async (items: BulkUpdateModelsDto) => {
      try {
        return await bulkUpdateTrigger({ body: items })
      } catch (error) {
        logger.error('Failed to bulk update models', { count: items.length, error })
        throw error
      }
    },
    [bulkUpdateTrigger]
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
    updateError,
    updateModels,
    isBulkUpdating,
    bulkUpdateError
  }
}
