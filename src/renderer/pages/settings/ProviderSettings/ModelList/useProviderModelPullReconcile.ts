import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import {
  fetchProviderCatalogModels,
  fetchResolvedProviderModels,
  toCreateModelDto
} from '@renderer/pages/settings/ProviderSettings/utils/modelSync'
import { enableProviderWhenModelsAvailable } from '@renderer/pages/settings/ProviderSettings/utils/providerEnablement'
import { toast } from '@renderer/services/toast'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getModelInUseAsDefaultUniqueModelId } from './errorMessage'

const logger = loggerService.withContext('ProviderModelManageDrawer')

function uniqueById(models: Model[]): Model[] {
  const result = new Map<string, Model>()
  for (const model of models) {
    if (!result.has(model.id)) {
      result.set(model.id, model)
    }
  }
  return Array.from(result.values())
}

async function deleteModelsSkippingDefaults(
  uniqueIds: UniqueModelId[],
  deleteModels: (ids: UniqueModelId[]) => Promise<void>
) {
  let remainingIds = uniqueIds
  const skippedIds = new Set<UniqueModelId>()

  while (remainingIds.length > 0) {
    try {
      await deleteModels(remainingIds)
      return skippedIds
    } catch (error) {
      const blockedId = getModelInUseAsDefaultUniqueModelId(error)
      if (!blockedId || !remainingIds.includes(blockedId)) {
        throw error
      }

      skippedIds.add(blockedId)
      remainingIds = remainingIds.filter((id) => id !== blockedId)
    }
  }

  return skippedIds
}

/**
 * Owns the manual provider model management drawer.
 *
 * v1 opened a model-management popup and immediately loaded the provider list;
 * this hook keeps the same semantics while using v2 DataApi-backed model CRUD.
 */
export function useProviderModelPullReconcile(providerId: string) {
  const { t } = useTranslation()
  const [pullReconcileDrawerOpen, setPullReconcileDrawerOpen] = useState(false)
  const [catalogModels, setCatalogModels] = useState<Model[]>([])
  const [fetchedModels, setFetchedModels] = useState<Model[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [hasLoadedRemoteModels, setHasLoadedRemoteModels] = useState(false)
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null)
  const { provider, updateProvider } = useProvider(providerId)
  const { models } = useModels({ providerId })
  const { createModels, deleteModels, isCreating, isDeleting, isBulkDeleting } = useModelMutations()
  const { trigger: reconcileModels, isLoading: isReconciling } = useMutation(
    'POST',
    '/providers/:providerId/models:reconcile',
    { refresh: ['/models'] }
  )

  const allModels = useMemo(
    () => uniqueById([...catalogModels, ...fetchedModels, ...models]),
    [catalogModels, fetchedModels, models]
  )
  const staleModels = useMemo(() => {
    if (!hasLoadedRemoteModels) {
      return []
    }

    const remoteIds = new Set([...catalogModels, ...fetchedModels].map((model) => model.id))
    return models.filter((model) => !remoteIds.has(model.id))
  }, [catalogModels, fetchedModels, hasLoadedRemoteModels, models])

  const loadModels = useCallback(async () => {
    setIsLoadingModels(true)
    setHasLoadedRemoteModels(false)
    setLoadErrorMessage(null)
    try {
      const [catalog, fetched] = await Promise.all([
        fetchProviderCatalogModels(providerId),
        fetchResolvedProviderModels(providerId)
      ])
      setCatalogModels(catalog.filter((model) => model.name?.trim()))
      setFetchedModels(fetched.filter((model) => model.name?.trim()))
      setHasLoadedRemoteModels(true)
    } catch (error) {
      logger.error('Failed to load provider models for manage drawer', { providerId, error })
      setLoadErrorMessage(t('settings.models.manage.sync_pull_failed'))
    } finally {
      setIsLoadingModels(false)
    }
  }, [providerId, t])

  const openPullReconcile = useCallback(() => {
    setPullReconcileDrawerOpen(true)
    void loadModels()
  }, [loadModels])

  const closePullReconcile = useCallback(() => {
    setPullReconcileDrawerOpen(false)
  }, [])

  const addModels = useCallback(
    async (nextModels: Model[]) => {
      const currentIds = new Set(models.map((model) => model.id))
      const toAdd = uniqueById(nextModels).filter((model) => !currentIds.has(model.id))
      if (toAdd.length === 0) {
        return
      }

      try {
        await createModels(toAdd.map((model) => toCreateModelDto(providerId, model)))
        await enableProviderWhenModelsAvailable(
          provider,
          updateProvider,
          models.length + toAdd.length,
          'model_manage_add'
        )
      } catch (error) {
        logger.error('Failed to add provider models from manage drawer', { providerId, count: toAdd.length, error })
        toast.error(t('settings.models.manage.operation_failed'))
      }
    },
    [createModels, models, provider, providerId, t, updateProvider]
  )

  const removeModels = useCallback(
    async (uniqueModelIds: UniqueModelId[]) => {
      const uniqueIds = Array.from(new Set(uniqueModelIds))
      if (uniqueIds.length === 0) {
        return
      }

      try {
        const skippedIds = await deleteModelsSkippingDefaults(uniqueIds, deleteModels)
        if (skippedIds.size > 0) {
          toast.warning(t('settings.models.manage.remove_skipped_default_in_use', { count: skippedIds.size }))
        }
      } catch (error) {
        logger.error('Failed to remove provider models from manage drawer', {
          providerId,
          count: uniqueIds.length,
          error
        })
        toast.error(t('settings.models.manage.operation_failed'))
      }
    },
    [deleteModels, providerId, t]
  )

  const cleanStaleModels = useCallback(async () => {
    const staleIds = staleModels.map((model) => model.id)
    if (staleIds.length === 0) {
      return
    }

    try {
      const reconciledModels = await reconcileModels({
        params: { providerId },
        body: {
          toAdd: [],
          toRemove: staleIds
        }
      })
      const reconciledIds = new Set(reconciledModels.map((model) => model.id))
      const skippedCount = staleIds.filter((id) => reconciledIds.has(id)).length

      if (skippedCount > 0) {
        toast.warning(t('settings.models.manage.remove_skipped_default_in_use', { count: skippedCount }))
      } else {
        toast.success(t('settings.models.manage.clean_stale_success', { count: staleIds.length }))
      }
    } catch (error) {
      logger.error('Failed to clean stale provider models from manage drawer', {
        providerId,
        count: staleIds.length,
        error
      })
      toast.error(t('settings.models.manage.operation_failed'))
    }
  }, [providerId, reconcileModels, staleModels, t])

  return {
    allModels,
    provider,
    localModels: models,
    staleModelCount: staleModels.length,
    staleModelIds: staleModels.map((model) => model.id),
    openPullReconcile,
    closePullReconcile,
    reloadModels: loadModels,
    pullReconcileDrawerOpen,
    addModels,
    removeModels,
    cleanStaleModels,
    isLoadingModels,
    loadErrorMessage,
    isApplyingPullReconcile: isCreating || isDeleting || isBulkDeleting || isReconciling,
    isBusy: isLoadingModels || isCreating || isDeleting || isBulkDeleting || isReconciling
  }
}
