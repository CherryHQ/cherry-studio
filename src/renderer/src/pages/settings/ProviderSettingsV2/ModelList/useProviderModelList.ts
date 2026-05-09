import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import {
  applyModelFilters,
  calculateModelListDerivedState,
  countModelsInGroups,
  groupModels,
  MODEL_LIST_CAPABILITY_FILTERS,
  type ModelListCapabilityCounts,
  type ModelListCapabilityFilter,
  type ModelSections
} from './modelListDerivedState'

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
  onToggleVisibleModels: (enabled: boolean) => void
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
  onToggleModel: (model: Model, enabled: boolean) => Promise<void>
}

interface UseProviderModelListArgs {
  providerId: string
  /** Parent-owned coordination input for the single effect of disabling list interactions. */
  disabled?: boolean
}

type SessionPlacement = keyof ModelSections
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

const getDisplayedPlacement = (
  model: Model,
  placementByModelId: Record<string, SessionPlacement>
): SessionPlacement => {
  return placementByModelId[model.id] ?? (model.isEnabled ? 'enabled' : 'disabled')
}

const buildDisplayedSectionState = (
  models: Model[],
  placementByModelId: Record<string, SessionPlacement>,
  searchText: string,
  selectedCapabilityFilter: ModelListCapabilityFilter
): DisplayedSectionState => {
  const filteredModels = applyModelFilters(models, searchText, selectedCapabilityFilter)
  const enabledModels: Model[] = []
  const disabledModels: Model[] = []

  for (const model of filteredModels) {
    const placement = getDisplayedPlacement(model, placementByModelId)

    if (placement === 'enabled') {
      enabledModels.push(model)
      continue
    }

    disabledModels.push(model)
  }

  const sections = {
    enabled: groupModels(enabledModels),
    disabled: groupModels(disabledModels)
  }

  return {
    sections,
    displayEnabledModelCount: countModelsInGroups(sections.enabled),
    displayDisabledModelCount: countModelsInGroups(sections.disabled)
  }
}

export function useProviderModelList({ providerId, disabled = false }: UseProviderModelListArgs) {
  const { models, isLoading: isModelsLoading } = useModels(
    { providerId },
    { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS }
  )
  const { updateModel, updateModels } = useModelMutations()
  const [searchInputText, setSearchInputText] = useState('')
  const searchText = useDeferredValue(searchInputText)
  const [selectedCapabilityFilter, setSelectedCapabilityFilterState] = useState<ModelListCapabilityFilter>('all')
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)
  const [optimisticEnabledByModelId, setOptimisticEnabledByModelId] = useState<Record<string, boolean>>({})
  const [sessionPlacementByModelId, setSessionPlacementByModelId] = useState<Record<string, SessionPlacement>>({})
  const [pendingModelIdMap, setPendingModelIdMap] = useState<Record<string, true>>({})

  const setSelectedCapabilityFilter = useCallback((filter: ModelListCapabilityFilter) => {
    startTransition(() => {
      setSelectedCapabilityFilterState(filter)
    })
  }, [])

  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models])
  const optimisticModels = useMemo(
    () =>
      models.map((model) =>
        optimisticEnabledByModelId[model.id] === undefined
          ? model
          : { ...model, isEnabled: optimisticEnabledByModelId[model.id] }
      ),
    [models, optimisticEnabledByModelId]
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
    const validModelIds = new Set(models.map((model) => model.id))

    setSessionPlacementByModelId((current) => withPrunedModelIds(current, validModelIds))
    setPendingModelIdMap((current) => withPrunedModelIds(current, validModelIds))
    setOptimisticEnabledByModelId((current) => {
      const pruned = withPrunedModelIds(current, validModelIds)
      let changed = pruned !== current
      const next = pruned === current ? { ...current } : { ...pruned }

      for (const [modelId, optimisticEnabled] of Object.entries(next)) {
        if (pendingModelIdMap[modelId]) {
          continue
        }

        if (modelById.get(modelId as Model['id'])?.isEnabled === optimisticEnabled) {
          delete next[modelId]
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [modelById, models, pendingModelIdMap])

  const displayState = useMemo(
    () => buildDisplayedSectionState(optimisticModels, sessionPlacementByModelId, searchText, selectedCapabilityFilter),
    [optimisticModels, searchText, selectedCapabilityFilter, sessionPlacementByModelId]
  )

  const openEditModelDrawer = useCallback((model: Model) => {
    setEditingModel(model)
  }, [])

  const closeEditModelDrawer = useCallback(() => {
    setEditingModel(null)
  }, [])

  const onToggleModel = useCallback(
    async (model: Model, enabled: boolean) => {
      const { modelId } = parseUniqueModelId(model.id)
      const previousEnabled = optimisticEnabledByModelId[model.id] ?? model.isEnabled
      const previousPlacement = sessionPlacementByModelId[model.id]
      const displayedPlacement = getDisplayedPlacement(model, sessionPlacementByModelId)
      const shouldKeepDisabledModelInPlace = displayedPlacement === 'enabled' && !enabled

      setOptimisticEnabledByModelId((current) => ({ ...current, [model.id]: enabled }))
      setPendingModelIdMap((current) => ({ ...current, [model.id]: true }))

      if (shouldKeepDisabledModelInPlace && previousPlacement === undefined) {
        setSessionPlacementByModelId((current) => ({ ...current, [model.id]: 'enabled' }))
      }

      try {
        await updateModel(model.providerId, modelId, { isEnabled: enabled })
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

        if (shouldKeepDisabledModelInPlace && previousPlacement === undefined) {
          setSessionPlacementByModelId((current) => {
            const next = { ...current }
            delete next[model.id]
            return next
          })
        }

        throw error
      } finally {
        setPendingModelIdMap((current) => {
          const next = { ...current }
          delete next[model.id]
          return next
        })
      }
    },
    [optimisticEnabledByModelId, sessionPlacementByModelId, updateModel]
  )

  const onToggleVisibleModels = useCallback(
    async (enabled: boolean) => {
      const targetModels = derivedState.filteredModels.filter((model) => model.isEnabled !== enabled)

      if (targetModels.length === 0) {
        return
      }

      const targetStates = targetModels.map((model) => {
        const previousEnabled = optimisticEnabledByModelId[model.id] ?? model.isEnabled
        const previousPlacement = sessionPlacementByModelId[model.id]
        const displayedPlacement = getDisplayedPlacement(model, sessionPlacementByModelId)

        return {
          model,
          previousEnabled,
          previousPlacement,
          shouldKeepDisabledModelInPlace: !enabled && displayedPlacement === 'enabled'
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

      if (!enabled) {
        setSessionPlacementByModelId((current) => {
          const next = { ...current }

          for (const { model, previousPlacement, shouldKeepDisabledModelInPlace } of targetStates) {
            if (shouldKeepDisabledModelInPlace && previousPlacement === undefined) {
              next[model.id] = 'enabled'
            }
          }

          return next
        })
      }

      setIsBulkUpdating(true)

      try {
        // `PATCH /models` is atomic: either every row commits or the whole
        // transaction rolls back, so there is no partial-failure branch.
        await updateModels(
          targetStates.map(({ model }) => ({
            uniqueModelId: model.id,
            patch: { isEnabled: enabled }
          }))
        )
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
        setSessionPlacementByModelId((current) => {
          const next = { ...current }

          for (const { model, previousPlacement, shouldKeepDisabledModelInPlace } of targetStates) {
            if (shouldKeepDisabledModelInPlace && previousPlacement === undefined) {
              delete next[model.id]
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
    [derivedState.filteredModels, optimisticEnabledByModelId, sessionPlacementByModelId, updateModels]
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
    isLoading: isModelsLoading && models.length === 0,
    hasNoModels: derivedState.hasNoModels,
    hasVisibleModels: derivedState.hasVisibleModels,
    displayEnabledModelCount: displayState.displayEnabledModelCount,
    enabledSections,
    disabledSections,
    displayDisabledModelCount: displayState.displayDisabledModelCount,
    disabled,
    pendingModelIds,
    onEditModel: openEditModelDrawer,
    onToggleModel
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
