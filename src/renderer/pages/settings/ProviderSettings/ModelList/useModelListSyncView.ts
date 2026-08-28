import type { Model, UniqueModelId } from '@shared/data/types/model'
import { useEffect, useMemo, useState } from 'react'

import type { ModelGroups, ModelListCapabilityCounts, ModelListCapabilityFilter } from './modelListDerivedState'
import { applyModelFilters, getCapabilityModelCounts, groupModels } from './modelListDerivedState'

type ModelListSyncFilter = ModelListCapabilityFilter | 'stale'

interface UseModelListSyncViewOptions {
  models: Model[]
  staleModelIds?: UniqueModelId[]
  resetKey: boolean | number | string
}

export function useModelListSyncView({ models, staleModelIds = [], resetKey }: UseModelListSyncViewOptions) {
  const [searchText, setSearchText] = useState('')
  const [actualFilter, setActualFilter] = useState<ModelListSyncFilter>('all')
  const staleModelIdSet = useMemo(() => new Set(staleModelIds), [staleModelIds])
  const searchedModels = useMemo(() => applyModelFilters(models, searchText, 'all'), [models, searchText])
  const filteredModels = useMemo(() => {
    if (actualFilter === 'stale') {
      return searchedModels.filter((model) => staleModelIdSet.has(model.id))
    }

    return applyModelFilters(searchedModels, '', actualFilter)
  }, [actualFilter, searchedModels, staleModelIdSet])
  const filteredGroups = useMemo<ModelGroups>(
    () => groupModels(filteredModels, Boolean(searchText.trim())),
    [filteredModels, searchText]
  )
  const typeCounts = useMemo<ModelListCapabilityCounts>(
    () => getCapabilityModelCounts(searchedModels),
    [searchedModels]
  )

  useEffect(() => {
    setSearchText('')
    setActualFilter('all')
  }, [resetKey])

  useEffect(() => {
    if (staleModelIds.length === 0 && actualFilter === 'stale') {
      setActualFilter('all')
    }
  }, [actualFilter, staleModelIds.length])

  return {
    actualFilter,
    filteredGroups,
    filteredModels,
    searchText,
    setActualFilter,
    setSearchText,
    staleModelIdSet,
    typeCounts
  }
}

export type ModelListSyncView = ReturnType<typeof useModelListSyncView>
