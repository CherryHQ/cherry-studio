import { useModels } from '@renderer/hooks/useModels'
import type React from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import HealthCheckDrawer from './HealthCheckDrawer'
import ManageModelsDrawer from './ManageModelsDrawer'
import ModelListCapabilityChips from './ModelListCapabilityChips'
import {
  applyModelFilters,
  getCapabilityModelCounts,
  getChipMaxWidth,
  MODEL_LIST_CAPABILITY_FILTERS
} from './modelListDerivedState'
import { useModelListFilters } from './modelListFiltersContext'
import ModelListHeader from './ModelListHeader'
import { useModelListHealth } from './modelListHealthContext'
import ModelListSearchBar from './ModelListSearchBar'
import { useModelListActions } from './useModelListActions'

interface ModelListToolbarProps {
  providerId: string
  containerWidth: number
}

const ModelListToolbar: React.FC<ModelListToolbarProps> = ({ providerId, containerWidth }) => {
  const { t } = useTranslation()
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { searchText, setSearchText, selectedCapabilityFilter, setSelectedCapabilityFilter } = useModelListFilters()
  const {
    manageModelsOpen,
    openManageModels,
    closeManageModels,
    onRefreshModels,
    onAddModel,
    onDownloadModel,
    updateVisibleModelsEnabledState,
    isBulkUpdating,
    isSyncingModels
  } = useModelListActions({ providerId, models })
  const { isHealthChecking, availableApiKeys, healthCheckOpen, openHealthCheck, closeHealthCheck, startHealthCheck } =
    useModelListHealth()

  const visibleModels = useMemo(
    () => applyModelFilters(models, searchText, selectedCapabilityFilter),
    [models, searchText, selectedCapabilityFilter]
  )
  const capabilityModelCounts = useMemo(() => getCapabilityModelCounts(models), [models])
  useEffect(() => {
    if (selectedCapabilityFilter === 'all') {
      return
    }
    if ((capabilityModelCounts[selectedCapabilityFilter] ?? 0) === 0) {
      setSelectedCapabilityFilter('all')
    }
  }, [selectedCapabilityFilter, capabilityModelCounts, setSelectedCapabilityFilter])
  const enabledModelCount = visibleModels.filter((model) => model.isEnabled).length
  const modelCount = visibleModels.length
  const hasNoModels = models.length === 0
  const allEnabled = modelCount > 0 && visibleModels.every((model) => model.isEnabled)
  const isBusy = isBulkUpdating || isSyncingModels || isHealthChecking

  const onToggleVisibleModels = useCallback(
    (enabled: boolean) => {
      void updateVisibleModelsEnabledState(visibleModels, enabled)
    },
    [updateVisibleModelsEnabledState, visibleModels]
  )

  return (
    <>
      <ModelListHeader
        enabledModelCount={enabledModelCount}
        modelCount={modelCount}
        hasVisibleModels={modelCount > 0}
        allEnabled={allEnabled}
        isBusy={isBusy}
        onToggleVisibleModels={onToggleVisibleModels}
        onRunHealthCheck={openHealthCheck}
        onManageModel={openManageModels}
      />
      <ModelListSearchBar
        showDownloadButton={providerId === 'ovms'}
        searchText={searchText}
        isBusy={isBusy}
        onSearchTextChange={setSearchText}
        onRefreshModels={onRefreshModels}
        onAddModel={onAddModel}
        onDownloadModel={onDownloadModel}
      />
      {!hasNoModels && (
        <ModelListCapabilityChips
          capabilityOptions={MODEL_LIST_CAPABILITY_FILTERS}
          selectedCapabilityFilter={selectedCapabilityFilter}
          capabilityModelCounts={capabilityModelCounts}
          chipMaxWidth={getChipMaxWidth(containerWidth)}
          onSelectCapabilityFilter={setSelectedCapabilityFilter}
        />
      )}
      <ManageModelsDrawer open={manageModelsOpen} providerId={providerId} onClose={closeManageModels} />
      <HealthCheckDrawer
        open={healthCheckOpen}
        title={t('settings.models.check.title')}
        apiKeys={availableApiKeys}
        onClose={closeHealthCheck}
        onStart={startHealthCheck}
      />
    </>
  )
}

export default ModelListToolbar
