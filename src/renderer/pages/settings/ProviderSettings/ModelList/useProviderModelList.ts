import { useQuery } from '@data/hooks/useDataApi'
import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import { isClaudeCodeProviderId } from '@shared/data/presets/claudeCode'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import {
  calculateModelListDerivedState,
  countModelsInGroups,
  groupModels,
  MODEL_LIST_CAPABILITY_FILTERS,
  type ModelListCapabilityCounts,
  type ModelListCapabilityFilter,
  type ModelSections
} from './modelListDerivedState'
import { toCreateModelDto } from './modelSync'

export interface ModelListGroupItem {
  model: Model
}

export interface ModelListGroupSection {
  groupName: string
  items: ModelListGroupItem[]
}

export interface ProviderModelListHeaderSurface {
  enabledModelCount: number
  modelCount: number
  hasVisibleModels: boolean
  allEnabled: boolean
  hasNoModels: boolean
  searchText: string
  setSearchText: (text: string) => void
  selectedCapabilityFilter: ModelListCapabilityFilter
  setSelectedCapabilityFilter: (filter: ModelListCapabilityFilter) => void
  capabilityOptions: readonly ModelListCapabilityFilter[]
  capabilityModelCounts: ModelListCapabilityCounts
  onToggleVisibleModels: (enabled: boolean) => Promise<void>
}

export interface ProviderModelListSectionsSurface {
  isLoading: boolean
  hasNoModels: boolean
  hasVisibleModels: boolean
  displayEnabledModelCount: number
  enabledSections: ModelListGroupSection[]
  disabledSections: ModelListGroupSection[]
  displayDisabledModelCount: number
  disabled: boolean
  pendingModelIds: Set<string>
  onEditModel: (model: Model) => void
  onDeleteModel: (model: Model) => Promise<void>
  onDeleteModels: (models: Model[]) => Promise<void>
  onToggleModel: (model: Model, enabled: boolean) => Promise<void>
  onToggleModels: (models: Model[], enabled: boolean) => Promise<void>
}

interface UseProviderModelListArgs {
  providerId: string
  /** Parent-owned coordination input for the single effect of disabling list interactions. */
  disabled?: boolean
}

type DisplayedSectionState = {
  sections: ModelSections
  displayEnabledModelCount: number
  displayDisabledModelCount: number
}

const toGroupSections = (groups: ModelSections['enabled']): ModelListGroupSection[] => {
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
  const readsRegistryModels = isClaudeCodeProviderId(providerId)
  const { data: registryModels, isLoading: isRegistryModelsLoading } = useQuery(
    '/providers/:providerId/models:resolve',
    {
      params: { providerId },
      enabled: readsRegistryModels,
      swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS
    }
  )
  const { createModel, createModels, deleteModel, deleteModels, updateModel, updateModels } = useModelMutations()
  const [searchInputText, setSearchInputText] = useState('')
  const searchText = useDeferredValue(searchInputText)
  const [selectedCapabilityFilter, setSelectedCapabilityFilterState] = useState<ModelListCapabilityFilter>('all')
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)
  const [optimisticEnabledByModelId, setOptimisticEnabledByModelId] = useState<Record<string, boolean>>({})
  const [optimisticDeletedByModelId, setOptimisticDeletedByModelId] = useState<Record<string, true>>({})
  const [pendingModelIdMap, setPendingModelIdMap] = useState<Record<string, true>>({})

  const setSelectedCapabilityFilter = useCallback((filter: ModelListCapabilityFilter) => {
    startTransition(() => {
      setSelectedCapabilityFilterState(filter)
    })
  }, [])

  const persistedModelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models])
  const displayModels = useMemo(() => {
    const missingRegistryModels = (registryModels ?? [])
      .filter((model) => !persistedModelById.has(model.id))
      .map((model) => ({ ...model, isEnabled: false }))

    return [...models, ...missingRegistryModels]
  }, [models, persistedModelById, registryModels])
  const optimisticModels = useMemo(
    () =>
      displayModels
        .filter((model) => !optimisticDeletedByModelId[model.id])
        .map((model) =>
          optimisticEnabledByModelId[model.id] === undefined
            ? model
            : { ...model, isEnabled: optimisticEnabledByModelId[model.id] }
        ),
    [displayModels, optimisticDeletedByModelId, optimisticEnabledByModelId]
  )

  const derivedState = useMemo(
    () =>
      calculateModelListDerivedState({
        models: optimisticModels,
        searchText,
        selectedCapabilityFilter,
        modelStatuses: []
      }),
    [optimisticModels, searchText, selectedCapabilityFilter]
  )

  useEffect(() => {
    if (selectedCapabilityFilter === 'all') {
      return
    }

    if ((derivedState.capabilityModelCounts[selectedCapabilityFilter] ?? 0) === 0) {
      setSelectedCapabilityFilter('all')
    }
  }, [derivedState.capabilityModelCounts, selectedCapabilityFilter, setSelectedCapabilityFilter])

  useEffect(() => {
    const validModelIds = new Set(displayModels.map((model) => model.id))

    setPendingModelIdMap((current) => withPrunedModelIds(current, validModelIds))
    setOptimisticDeletedByModelId((current) => withPrunedModelIds(current, validModelIds))
    setOptimisticEnabledByModelId((current) => {
      const pruned = withPrunedModelIds(current, validModelIds)
      let changed = pruned !== current
      const next = pruned === current ? { ...current } : { ...pruned }

      for (const [modelId, optimisticEnabled] of Object.entries(next)) {
        if (pendingModelIdMap[modelId]) {
          continue
        }

        if (persistedModelById.get(modelId as Model['id'])?.isEnabled === optimisticEnabled) {
          delete next[modelId]
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [displayModels, persistedModelById, pendingModelIdMap])

  const displayState = useMemo<DisplayedSectionState>(() => {
    const enabledModels: Model[] = []
    const disabledModels: Model[] = []
    const preserveGroupOrder = Boolean(searchText.trim())

    for (const model of derivedState.filteredModels) {
      if (model.isEnabled) {
        enabledModels.push(model)
      } else {
        disabledModels.push(model)
      }
    }

    const sections: ModelSections = {
      enabled: groupModels(enabledModels, preserveGroupOrder),
      disabled: groupModels(disabledModels, preserveGroupOrder)
    }

    return {
      sections,
      displayEnabledModelCount: countModelsInGroups(sections.enabled),
      displayDisabledModelCount: countModelsInGroups(sections.disabled)
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

  const onToggleModel = useCallback(
    async (model: Model, enabled: boolean) => {
      const { modelId } = parseUniqueModelId(model.id)
      const previousEnabled = optimisticEnabledByModelId[model.id] ?? model.isEnabled

      setOptimisticEnabledByModelId((current) => ({ ...current, [model.id]: enabled }))
      setPendingModelIdMap((current) => ({ ...current, [model.id]: true }))

      try {
        if (!persistedModelById.has(model.id) && enabled) {
          await createModel(toCreateModelDto(model.providerId, model))
        } else if (persistedModelById.has(model.id)) {
          await updateModel(model.providerId, modelId, { isEnabled: enabled })
        }
      } catch (error) {
        setOptimisticEnabledByModelId((current) => {
          const next = { ...current }

          if (previousEnabled === model.isEnabled) {
            delete next[model.id]
          } else {
            next[model.id] = previousEnabled
          }

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
    [createModel, optimisticEnabledByModelId, persistedModelById, updateModel]
  )

  const onToggleModels = useCallback(
    async (modelsToToggle: Model[], enabled: boolean) => {
      const targetModels = modelsToToggle.filter((model) => model.isEnabled !== enabled)

      if (targetModels.length === 0) {
        return
      }

      const targetStates = targetModels.map((model) => {
        const previousEnabled = optimisticEnabledByModelId[model.id] ?? model.isEnabled

        return {
          model,
          previousEnabled
        }
      })

      setOptimisticEnabledByModelId((current) => {
        const next = { ...current }

        for (const { model } of targetStates) {
          next[model.id] = enabled
        }

        return next
      })
      setPendingModelIdMap((current) => {
        const next = { ...current }

        for (const { model } of targetStates) {
          next[model.id] = true
        }

        return next
      })

      setIsBulkUpdating(true)

      try {
        const persistedStates = targetStates.filter(({ model }) => persistedModelById.has(model.id))
        const missingStates = enabled ? targetStates.filter(({ model }) => !persistedModelById.has(model.id)) : []

        // `PATCH /models` is atomic for persisted rows. Claude Code registry-only
        // rows are created on first enable so ModelList can read its provider
        // registry data without requiring a seeder to pre-materialize every model.
        if (persistedStates.length > 0) {
          await updateModels(
            persistedStates.map(({ model }) => ({
              uniqueModelId: model.id,
              patch: { isEnabled: enabled }
            }))
          )
        }
        if (missingStates.length > 0) {
          await createModels(missingStates.map(({ model }) => toCreateModelDto(model.providerId, model)))
        }
      } catch (error) {
        setOptimisticEnabledByModelId((current) => {
          const next = { ...current }

          for (const { model, previousEnabled } of targetStates) {
            if (previousEnabled === model.isEnabled) {
              delete next[model.id]
            } else {
              next[model.id] = previousEnabled
            }
          }

          return next
        })

        throw error
      } finally {
        setPendingModelIdMap((current) => {
          const next = { ...current }

          for (const { model } of targetStates) {
            delete next[model.id]
          }

          return next
        })
        setIsBulkUpdating(false)
      }
    },
    [createModels, optimisticEnabledByModelId, persistedModelById, updateModels]
  )

  const onToggleVisibleModels = useCallback(
    async (enabled: boolean) => {
      await onToggleModels(derivedState.filteredModels, enabled)
    },
    [derivedState.filteredModels, onToggleModels]
  )

  const enabledSections = useMemo(() => toGroupSections(displayState.sections.enabled), [displayState.sections.enabled])
  const disabledSections = useMemo(
    () => toGroupSections(displayState.sections.disabled),
    [displayState.sections.disabled]
  )
  const pendingModelIds = useMemo(() => new Set(Object.keys(pendingModelIdMap)), [pendingModelIdMap])

  const header: ProviderModelListHeaderSurface = {
    enabledModelCount: derivedState.enabledModelCount,
    modelCount: derivedState.modelCount,
    hasVisibleModels: derivedState.hasVisibleModels,
    allEnabled: derivedState.allEnabled,
    hasNoModels: derivedState.hasNoModels,
    searchText: searchInputText,
    setSearchText: setSearchInputText,
    selectedCapabilityFilter,
    setSelectedCapabilityFilter,
    capabilityOptions: MODEL_LIST_CAPABILITY_FILTERS,
    capabilityModelCounts: derivedState.capabilityModelCounts,
    onToggleVisibleModels
  }

  const sections: ProviderModelListSectionsSurface = {
    isLoading: (isModelsLoading || isRegistryModelsLoading) && displayModels.length === 0,
    hasNoModels: derivedState.hasNoModels,
    hasVisibleModels: derivedState.hasVisibleModels,
    displayEnabledModelCount: displayState.displayEnabledModelCount,
    enabledSections,
    disabledSections,
    displayDisabledModelCount: displayState.displayDisabledModelCount,
    disabled,
    pendingModelIds,
    onEditModel: openEditModelDrawer,
    onDeleteModel,
    onDeleteModels,
    onToggleModel,
    onToggleModels
  }

  return {
    header,
    sections,
    editDrawer: {
      open: editingModel !== null,
      model: editingModel,
      onClose: closeEditModelDrawer
    },
    isBulkUpdating
  }
}

export type ProviderModelListSurface = ReturnType<typeof useProviderModelList>
