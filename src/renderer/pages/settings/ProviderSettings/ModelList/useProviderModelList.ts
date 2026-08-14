import { usePreference } from '@data/hooks/usePreference'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import {
  calculateModelListDerivedState,
  countModelsInGroups,
  groupModels,
  type ModelGroups,
  type ModelListCapabilityCounts,
  type ModelListCapabilityFilter
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
  selectedTypeFilter: ModelListCapabilityFilter
  setSelectedTypeFilter: (filter: ModelListCapabilityFilter) => void
  typeCounts: ModelListCapabilityCounts
}

export interface ProviderModelListSectionsSurface {
  isLoading: boolean
  hasNoModels: boolean
  hasVisibleModels: boolean
  displayEnabledModelCount: number
  enabledSections: ModelListGroupSection[]
  disabled: boolean
  pendingModelIds: Set<string>
  defaultModelIds: Set<UniqueModelId>
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
  const [defaultModelId] = usePreference('chat.default_model_id')
  const [quickAssistantModelId] = usePreference('feature.quick_assistant.model_id')
  const [translateModelId] = usePreference('feature.translate.model_id')
  const [searchInputText, setSearchInputText] = useState('')
  const searchText = useDeferredValue(searchInputText)
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<ModelListCapabilityFilter>('all')
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [optimisticDeletedByModelId, setOptimisticDeletedByModelId] = useState<Record<string, true>>({})
  const [pendingModelIdMap, setPendingModelIdMap] = useState<Record<string, true>>({})
  const defaultModelIds = useMemo(
    () =>
      new Set(
        [defaultModelId, quickAssistantModelId, translateModelId].filter(
          (modelId): modelId is UniqueModelId => modelId != null
        )
      ),
    [defaultModelId, quickAssistantModelId, translateModelId]
  )

  const optimisticModels = useMemo(
    () => models.filter((model) => !optimisticDeletedByModelId[model.id]),
    [models, optimisticDeletedByModelId]
  )

  const derivedState = useMemo(
    () =>
      calculateModelListDerivedState({
        models: optimisticModels,
        searchText,
        selectedCapabilityFilter: selectedTypeFilter,
        modelStatuses: []
      }),
    [optimisticModels, searchText, selectedTypeFilter]
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
      if (defaultModelIds.has(model.id)) {
        return
      }

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
    [defaultModelIds, deleteModel]
  )

  const onDeleteModels = useCallback(
    async (modelsToDelete: Model[]) => {
      const deletableModels = modelsToDelete.filter((model) => !defaultModelIds.has(model.id))
      if (deletableModels.length === 0) {
        return
      }

      setOptimisticDeletedByModelId((current) => {
        const next = { ...current }

        for (const model of deletableModels) {
          next[model.id] = true
        }

        return next
      })
      setPendingModelIdMap((current) => {
        const next = { ...current }

        for (const model of deletableModels) {
          next[model.id] = true
        }

        return next
      })

      try {
        await deleteModels(deletableModels.map((model) => model.id))
      } catch (error) {
        setOptimisticDeletedByModelId((current) => {
          const next = { ...current }

          for (const model of deletableModels) {
            delete next[model.id]
          }

          return next
        })

        throw error
      } finally {
        setPendingModelIdMap((current) => {
          const next = { ...current }

          for (const model of deletableModels) {
            delete next[model.id]
          }

          return next
        })
      }
    },
    [defaultModelIds, deleteModels]
  )

  const enabledSections = useMemo(() => toGroupSections(displayState.groups), [displayState.groups])
  const pendingModelIds = useMemo(() => new Set(Object.keys(pendingModelIdMap)), [pendingModelIdMap])

  const header: ProviderModelListHeaderSurface = {
    modelCount: derivedState.modelCount,
    hasVisibleModels: derivedState.hasVisibleModels,
    hasNoModels: derivedState.hasNoModels,
    searchText: searchInputText,
    setSearchText: setSearchInputText,
    selectedTypeFilter,
    setSelectedTypeFilter,
    typeCounts: derivedState.capabilityModelCounts
  }

  const sections: ProviderModelListSectionsSurface = {
    isLoading: isModelsLoading && models.length === 0,
    hasNoModels: derivedState.hasNoModels,
    hasVisibleModels: derivedState.hasVisibleModels,
    displayEnabledModelCount: displayState.displayEnabledModelCount,
    enabledSections,
    disabled,
    pendingModelIds,
    defaultModelIds,
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
