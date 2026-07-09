import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import {
  calculateModelListDerivedState,
  countModelsInGroups,
  groupModels,
  type ModelGroups
} from './modelListDerivedState'

export interface ModelListGroupItem {
  model: Model
}

export interface ModelListGroupSection {
  groupName: string
  items: ModelListGroupItem[]
}

export interface ProviderModelListHeaderSurface {
  modelCount: number
  hasVisibleModels: boolean
  hasNoModels: boolean
  searchText: string
  setSearchText: (text: string) => void
}

export interface ProviderModelListSectionsSurface {
  isLoading: boolean
  hasNoModels: boolean
  hasVisibleModels: boolean
  displayEnabledModelCount: number
  enabledSections: ModelListGroupSection[]
  disabled: boolean
  pendingModelIds: Set<string>
  onEditModel: (model: Model) => void
  onDeleteModel: (model: Model) => Promise<void>
  onDeleteModels: (models: Model[]) => Promise<void>
}

interface UseProviderModelListArgs {
  providerId: string
  /** Parent-owned coordination input for the single effect of disabling list interactions. */
  disabled?: boolean
}

type DisplayedSectionState = {
  groups: ModelGroups
  displayEnabledModelCount: number
}

const toGroupSections = (groups: ModelGroups): ModelListGroupSection[] => {
  return Object.entries(groups).map(([groupName, models]) => ({
    groupName,
    items: models.map((model) => ({ model }))
  }))
}

const withPrunedModelIds = <T>(entries: Record<string, T>, validIds: Set<string>) => {
  let changed = false
  const next: Record<string, T> = {}

  for (const [modelId, value] of Object.entries(entries)) {
    if (!validIds.has(modelId)) {
      changed = true
      continue
    }

    next[modelId] = value
  }

  return changed ? next : entries
}

export function useProviderModelList({ providerId, disabled = false }: UseProviderModelListArgs) {
  const { models, isLoading: isModelsLoading } = useModels(
    { providerId },
    { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS }
  )
  const { deleteModel, deleteModels } = useModelMutations()
  const [searchInputText, setSearchInputText] = useState('')
  const searchText = useDeferredValue(searchInputText)
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [optimisticDeletedByModelId, setOptimisticDeletedByModelId] = useState<Record<string, true>>({})
  const [pendingModelIdMap, setPendingModelIdMap] = useState<Record<string, true>>({})

  const optimisticModels = useMemo(
    () => models.filter((model) => !optimisticDeletedByModelId[model.id]),
    [models, optimisticDeletedByModelId]
  )

  const derivedState = useMemo(
    () =>
      calculateModelListDerivedState({
        models: optimisticModels,
        searchText,
        selectedCapabilityFilter: 'all',
        modelStatuses: []
      }),
    [optimisticModels, searchText]
  )

  useEffect(() => {
    const validModelIds = new Set(models.map((model) => model.id))

    setPendingModelIdMap((current) => withPrunedModelIds(current, validModelIds))
    setOptimisticDeletedByModelId((current) => withPrunedModelIds(current, validModelIds))
  }, [models])

  const displayState = useMemo<DisplayedSectionState>(() => {
    const preserveGroupOrder = Boolean(searchText.trim())
    const groups = groupModels(derivedState.filteredModels, preserveGroupOrder, { preferModelGroup: true })

    return {
      groups,
      displayEnabledModelCount: countModelsInGroups(groups)
    }
  }, [derivedState.filteredModels, searchText])

  const openEditModelDrawer = useCallback((model: Model) => {
    setEditingModel(model)
  }, [])

  const closeEditModelDrawer = useCallback(() => {
    setEditingModel(null)
  }, [])

  const onDeleteModel = useCallback(
    async (model: Model) => {
      const { modelId } = parseUniqueModelId(model.id)

      setOptimisticDeletedByModelId((current) => ({ ...current, [model.id]: true }))
      setPendingModelIdMap((current) => ({ ...current, [model.id]: true }))

      try {
        await deleteModel(model.providerId, modelId)
      } catch (error) {
        setOptimisticDeletedByModelId((current) => {
          const next = { ...current }
          delete next[model.id]
          return next
        })

        throw error
      } finally {
        setPendingModelIdMap((current) => {
          const next = { ...current }
          delete next[model.id]
          return next
        })
      }
    },
    [deleteModel]
  )

  const onDeleteModels = useCallback(
    async (modelsToDelete: Model[]) => {
      if (modelsToDelete.length === 0) {
        return
      }

      setOptimisticDeletedByModelId((current) => {
        const next = { ...current }

        for (const model of modelsToDelete) {
          next[model.id] = true
        }

        return next
      })
      setPendingModelIdMap((current) => {
        const next = { ...current }

        for (const model of modelsToDelete) {
          next[model.id] = true
        }

        return next
      })

      try {
        await deleteModels(modelsToDelete.map((model) => model.id))
      } catch (error) {
        setOptimisticDeletedByModelId((current) => {
          const next = { ...current }

          for (const model of modelsToDelete) {
            delete next[model.id]
          }

          return next
        })

        throw error
      } finally {
        setPendingModelIdMap((current) => {
          const next = { ...current }

          for (const model of modelsToDelete) {
            delete next[model.id]
          }

          return next
        })
      }
    },
    [deleteModels]
  )

  const enabledSections = useMemo(() => toGroupSections(displayState.groups), [displayState.groups])
  const pendingModelIds = useMemo(() => new Set(Object.keys(pendingModelIdMap)), [pendingModelIdMap])

  const header: ProviderModelListHeaderSurface = {
    modelCount: derivedState.modelCount,
    hasVisibleModels: derivedState.hasVisibleModels,
    hasNoModels: derivedState.hasNoModels,
    searchText: searchInputText,
    setSearchText: setSearchInputText
  }

  const sections: ProviderModelListSectionsSurface = {
    isLoading: isModelsLoading && models.length === 0,
    hasNoModels: derivedState.hasNoModels,
    hasVisibleModels: derivedState.hasVisibleModels,
    displayEnabledModelCount: displayState.displayEnabledModelCount,
    enabledSections,
    disabled,
    pendingModelIds,
    onEditModel: openEditModelDrawer,
    onDeleteModel,
    onDeleteModels
  }

  return {
    header,
    sections,
    editDrawer: {
      open: editingModel !== null,
      model: editingModel,
      onClose: closeEditModelDrawer
    }
  }
}

export type ProviderModelListSurface = ReturnType<typeof useProviderModelList>
