import { useModelMutations, useModels } from '@renderer/hooks/useModel'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import {
  calculateModelListDerivedState,
  countModelsInGroups,
  groupModels,
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
  const { deleteModel, deleteModels, updateModel, updateModels } = useModelMutations()
  const [searchInputText, setSearchInputText] = useState('')
  const searchText = useDeferredValue(searchInputText)
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)
  const [optimisticEnabledByModelId, setOptimisticEnabledByModelId] = useState<Record<string, boolean>>({})
  const [optimisticDeletedByModelId, setOptimisticDeletedByModelId] = useState<Record<string, true>>({})
  const [pendingModelIdMap, setPendingModelIdMap] = useState<Record<string, true>>({})

  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models])
  const optimisticModels = useMemo(
    () =>
      models
        .filter((model) => !optimisticDeletedByModelId[model.id])
        .map((model) =>
          optimisticEnabledByModelId[model.id] === undefined
            ? model
            : { ...model, isEnabled: optimisticEnabledByModelId[model.id] }
        ),
    [models, optimisticDeletedByModelId, optimisticEnabledByModelId]
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

  const displayState = useMemo<DisplayedSectionState>(() => {
    const preserveGroupOrder = Boolean(searchText.trim())
    const enabledModels = derivedState.filteredModels

    const sections: ModelSections = {
      enabled: groupModels(enabledModels, preserveGroupOrder),
      disabled: {}
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

        throw error
      } finally {
        setPendingModelIdMap((current) => {
          const next = { ...current }
          delete next[model.id]
          return next
        })
      }
    },
    [optimisticEnabledByModelId, updateModel]
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
    [optimisticEnabledByModelId, updateModels]
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
    setSearchText: setSearchInputText
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
