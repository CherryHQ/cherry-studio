import { dataApiService } from '@data/DataApiService'
import type { ConcreteApiPaths } from '@shared/data/api/apiTypes'
import type { CreateModelDto, CreateModelsBatchDto, UpdateModelDto } from '@shared/data/api/schemas/models'
import type { Model } from '@shared/data/types/model'
import { useCallback, useMemo } from 'react'

import { useInvalidateCache, useMutation, useQuery } from './useDataApi'

/** Helper to build `/models/:providerId/:modelId` concrete path (tsgo cannot resolve two-segment template literals) */
function modelPath(providerId: string, modelId: string): ConcreteApiPaths {
  return `/models/${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}` as ConcreteApiPaths
}

const REFRESH_MODELS = ['/models'] as const
const EMPTY_MODELS: Model[] = []

// ─── Layer 1: List ────────────────────────────────────────────────────
export function useModels(query?: { providerId?: string; enabled?: boolean }) {
  const { providerId, enabled, ...rest } = query ?? {}
  const queryParams = providerId ? { providerId, ...rest } : rest
  const hasQuery = Object.keys(queryParams).length > 0

  const { data, isLoading, mutate } = useQuery('/models', {
    ...(hasQuery ? { query: queryParams } : {}),
    ...(enabled !== undefined ? { enabled } : {})
  }) as { data: Model[] | undefined; isLoading: boolean; mutate: any }

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

  const createModel = useCallback((dto: CreateModelDto) => createTrigger({ body: dto }), [createTrigger])
  const createModelsBatch = useCallback(
    (dtos: CreateModelsBatchDto['items']) => createBatchTrigger({ body: { items: dtos } }),
    [createBatchTrigger]
  )

  const deleteModel = useCallback(
    async (providerId: string, modelId: string) => {
      await dataApiService.delete(modelPath(providerId, modelId))
      await invalidate('/models')
    },
    [invalidate]
  )

  const patchModel = useCallback(
    async (providerId: string, modelId: string, updates: UpdateModelDto) => {
      await dataApiService.patch(modelPath(providerId, modelId), { body: updates })
      await invalidate('/models')
    },
    [invalidate]
  )

  return { createModel, createModelsBatch, deleteModel, patchModel }
}
