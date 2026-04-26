import { useModelMutations, useModels } from '@renderer/hooks/useModels'
import { useProvider } from '@renderer/hooks/useProviders'
import type { ModelWithStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'

import EditModelPopup from '../EditModelPopup/EditModelPopup'
import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import {
  applyModelFilters,
  calculateModelSections,
  MODEL_COUNT_THRESHOLD,
  type ModelGroups
} from './modelListDerivedState'
import { useModelListFilters } from './modelListFiltersContext'
import { useModelListHealth } from './modelListHealthContext'
import { getDuplicateProviderSettingModelNames } from './utils'

export interface ModelListGroupItem {
  model: Model
  modelStatus: ModelWithStatus | undefined
  showIdentifier: boolean
}

export interface ModelListGroupSection {
  groupName: string
  items: ModelListGroupItem[]
}

interface UseModelListSectionsInput {
  providerId: string
  containerWidth: number
}

const toGroupSections = (
  groups: ModelGroups,
  duplicateModelNames: Set<string>,
  modelStatusMap: Map<string, ModelWithStatus>
): ModelListGroupSection[] => {
  return Object.entries(groups).map(([groupName, models]) => ({
    groupName,
    items: models.map((model) => ({
      model,
      modelStatus: modelStatusMap.get(model.id),
      showIdentifier: duplicateModelNames.has(model.name)
    }))
  }))
}

export const useModelListSections = ({ providerId, containerWidth }: UseModelListSectionsInput) => {
  const { provider } = useProvider(providerId)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { updateModel } = useModelMutations()
  const { searchText, selectedCapabilityFilter } = useModelListFilters()
  const { isHealthChecking, modelStatusMap } = useModelListHealth()
  const [displayedModelSections, setDisplayedModelSections] = useState<ReturnType<
    typeof calculateModelSections
  > | null>(() => {
    if (models.length > MODEL_COUNT_THRESHOLD) {
      return null
    }

    return calculateModelSections(models, searchText, selectedCapabilityFilter)
  })

  useEffect(() => {
    if (models.length > MODEL_COUNT_THRESHOLD) {
      setDisplayedModelSections(null)
      startTransition(() => {
        setDisplayedModelSections(calculateModelSections(models, searchText, selectedCapabilityFilter))
      })
      return
    }

    setDisplayedModelSections(calculateModelSections(models, searchText, selectedCapabilityFilter))
  }, [models, searchText, selectedCapabilityFilter])

  const onEditModel = useCallback(
    (model: Model) => {
      if (provider) {
        void EditModelPopup.show({ provider, model })
      }
    },
    [provider]
  )

  const onToggleModel = useCallback(
    async (model: Model, enabled: boolean) => {
      const { modelId } = parseUniqueModelId(model.id)
      await updateModel(model.providerId, modelId, { isEnabled: enabled })
    },
    [updateModel]
  )

  const filteredModels = useMemo(
    () => applyModelFilters(models, searchText, selectedCapabilityFilter),
    [models, searchText, selectedCapabilityFilter]
  )
  const duplicateModelNames = useMemo(() => getDuplicateProviderSettingModelNames(models), [models])
  const enabledSections = useMemo(
    () => toGroupSections(displayedModelSections?.enabled ?? {}, duplicateModelNames, modelStatusMap),
    [displayedModelSections?.enabled, duplicateModelNames, modelStatusMap]
  )
  const disabledSections = useMemo(
    () => toGroupSections(displayedModelSections?.disabled ?? {}, duplicateModelNames, modelStatusMap),
    [displayedModelSections?.disabled, duplicateModelNames, modelStatusMap]
  )

  return {
    isLoading: displayedModelSections === null,
    hasNoModels: models.length === 0,
    hasVisibleModels: filteredModels.length > 0,
    enabledSections,
    disabledSections,
    disabledModelCount: filteredModels.filter((model) => !model.isEnabled).length,
    isCompact: containerWidth > 0 && containerWidth < 920,
    isUltraCompact: containerWidth > 0 && containerWidth < 760,
    isHealthChecking,
    onEditModel,
    onToggleModel
  }
}
