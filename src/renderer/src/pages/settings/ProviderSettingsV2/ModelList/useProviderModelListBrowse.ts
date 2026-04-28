import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import {
  calculateModelListDerivedState,
  calculateModelSections,
  MODEL_COUNT_THRESHOLD,
  MODEL_LIST_CAPABILITY_FILTERS,
  type ModelListCapabilityCounts,
  type ModelListCapabilityFilter,
  type ModelSections
} from './modelListDerivedState'

export interface ModelListGroupItem {
  model: Model
  showIdentifier: boolean
}

export interface ModelListGroupSection {
  groupName: string
  items: ModelListGroupItem[]
}

export interface ProviderModelListBrowseHeaderSurface {
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

export interface ProviderModelListBrowseSectionsSurface {
  isLoading: boolean
  hasNoModels: boolean
  hasVisibleModels: boolean
  enabledSections: ModelListGroupSection[]
  disabledSections: ModelListGroupSection[]
  disabledModelCount: number
  editingModel: Model | null
  editModelDrawerOpen: boolean
  openEditModelDrawer: (model: Model) => void
  closeEditModelDrawer: () => void
  isHealthChecking: boolean
  onEditModel: (model: Model) => void
  onToggleModel: (model: Model, enabled: boolean) => Promise<void>
}

interface UseProviderModelListBrowseArgs {
  providerId: string
  /** Supplied by `ModelListHealthProvider` so this hook does not depend on health context. */
  isHealthChecking?: boolean
}

const toGroupSections = (
  groups: ModelSections['enabled'],
  duplicateModelNames: Set<string>
): ModelListGroupSection[] => {
  return Object.entries(groups).map(([groupName, models]) => ({
    groupName,
    items: models.map((model) => ({
      model,
      showIdentifier: duplicateModelNames.has(model.name)
    }))
  }))
}

export function useProviderModelListBrowse({ providerId, isHealthChecking = false }: UseProviderModelListBrowseArgs) {
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { updateModel } = useModelMutations()
  const [searchText, setSearchTextState] = useState('')
  const [selectedCapabilityFilter, setSelectedCapabilityFilterState] = useState<ModelListCapabilityFilter>('all')
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)

  const setSearchText = useCallback((text: string) => {
    startTransition(() => {
      setSearchTextState(text)
    })
  }, [])

  const setSelectedCapabilityFilter = useCallback((filter: ModelListCapabilityFilter) => {
    startTransition(() => {
      setSelectedCapabilityFilterState(filter)
    })
  }, [])

  const derivedState = useMemo(
    () =>
      calculateModelListDerivedState({
        models,
        searchText,
        selectedCapabilityFilter,
        modelStatuses: []
      }),
    [models, searchText, selectedCapabilityFilter]
  )

  const [displayedSections, setDisplayedSections] = useState<ModelSections | null>(() => {
    if (models.length > MODEL_COUNT_THRESHOLD) {
      return null
    }

    return derivedState.sections
  })

  useEffect(() => {
    if (selectedCapabilityFilter === 'all') {
      return
    }

    if ((derivedState.capabilityModelCounts[selectedCapabilityFilter] ?? 0) === 0) {
      setSelectedCapabilityFilter('all')
    }
  }, [derivedState.capabilityModelCounts, selectedCapabilityFilter, setSelectedCapabilityFilter])

  useEffect(() => {
    if (models.length > MODEL_COUNT_THRESHOLD) {
      setDisplayedSections(null)
      startTransition(() => {
        setDisplayedSections(calculateModelSections(models, searchText, selectedCapabilityFilter))
      })
      return
    }

    setDisplayedSections(derivedState.sections)
  }, [derivedState.sections, models, searchText, selectedCapabilityFilter])

  const openEditModelDrawer = useCallback((model: Model) => {
    setEditingModel(model)
  }, [])

  const closeEditModelDrawer = useCallback(() => {
    setEditingModel(null)
  }, [])

  const onToggleModel = useCallback(
    async (model: Model, enabled: boolean) => {
      const { modelId } = parseUniqueModelId(model.id)
      await updateModel(model.providerId, modelId, { isEnabled: enabled })
    },
    [updateModel]
  )

  const onToggleVisibleModels = useCallback(
    async (enabled: boolean) => {
      const targetModels = derivedState.filteredModels.filter((model) => model.isEnabled !== enabled)

      if (targetModels.length === 0) {
        return
      }

      setIsBulkUpdating(true)

      try {
        await Promise.all(
          targetModels.map((model) => {
            const { modelId } = parseUniqueModelId(model.id)
            return updateModel(model.providerId, modelId, { isEnabled: enabled })
          })
        )
      } finally {
        setIsBulkUpdating(false)
      }
    },
    [derivedState.filteredModels, updateModel]
  )

  const enabledSections = useMemo(
    () => toGroupSections(displayedSections?.enabled ?? {}, derivedState.duplicateModelNames),
    [derivedState.duplicateModelNames, displayedSections?.enabled]
  )
  const disabledSections = useMemo(
    () => toGroupSections(displayedSections?.disabled ?? {}, derivedState.duplicateModelNames),
    [derivedState.duplicateModelNames, displayedSections?.disabled]
  )

  const header: ProviderModelListBrowseHeaderSurface = {
    enabledModelCount: derivedState.enabledModelCount,
    modelCount: derivedState.modelCount,
    hasVisibleModels: derivedState.hasVisibleModels,
    allEnabled: derivedState.allEnabled,
    hasNoModels: derivedState.hasNoModels,
    searchText,
    setSearchText,
    selectedCapabilityFilter,
    setSelectedCapabilityFilter,
    capabilityOptions: MODEL_LIST_CAPABILITY_FILTERS,
    capabilityModelCounts: derivedState.capabilityModelCounts,
    onToggleVisibleModels
  }

  const sections: ProviderModelListBrowseSectionsSurface = {
    isLoading: displayedSections === null,
    hasNoModels: derivedState.hasNoModels,
    hasVisibleModels: derivedState.hasVisibleModels,
    enabledSections,
    disabledSections,
    disabledModelCount: derivedState.disabledModelCount,
    editingModel,
    editModelDrawerOpen: editingModel !== null,
    openEditModelDrawer,
    closeEditModelDrawer,
    isHealthChecking,
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

export type ModelListSectionsSurface = ProviderModelListBrowseSectionsSurface
export type ProviderModelListBrowseSurface = ReturnType<typeof useProviderModelListBrowse>
