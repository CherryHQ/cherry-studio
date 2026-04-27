import { useModels } from '@renderer/hooks/useModels'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../hooks/providerSetting/constants'
import HealthCheckDrawer from './HealthCheckDrawer'
import ManageModelsDrawer from './ManageModelsDrawer'
import { applyModelFilters, getCapabilityModelCounts, MODEL_LIST_CAPABILITY_FILTERS } from './modelListDerivedState'
import { useModelListFilters } from './modelListFiltersContext'
import ModelListHeader from './ModelListHeader'
import { useModelListHealth } from './modelListHealthContext'
import ModelListSyncDrawer from './ModelListSyncDrawer'
import type { ModelListActionsSurface } from './useModelListActions'

interface ModelListToolbarProps {
  providerId: string
  actions: ModelListActionsSurface
}

const ModelListToolbar: React.FC<ModelListToolbarProps> = ({ providerId, actions }) => {
  const { t } = useTranslation()
  const [modelListSyncActivity, setModelListSyncActivity] = useState(false)
  const { models } = useModels({ providerId }, { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS })
  const { searchText, setSearchText, selectedCapabilityFilter, setSelectedCapabilityFilter } = useModelListFilters()
  const {
    isHealthChecking,
    availableApiKeys,
    healthCheckOpen,
    modelStatuses,
    openHealthCheck,
    closeHealthCheck,
    startHealthCheck
  } = useModelListHealth()

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
  const isBusy = actions.isBulkUpdating || actions.isSyncingModels || isHealthChecking || modelListSyncActivity

  const onToggleVisibleModels = useCallback(
    (enabled: boolean) => {
      void actions.updateVisibleModelsEnabledState(visibleModels, enabled)
    },
    [actions, visibleModels]
  )

  return (
    <>
      <ModelListHeader
        enabledModelCount={enabledModelCount}
        modelCount={modelCount}
        hasVisibleModels={modelCount > 0}
        allEnabled={allEnabled}
        isBusy={isBusy}
        hasNoModels={hasNoModels}
        searchText={searchText}
        setSearchText={setSearchText}
        selectedCapabilityFilter={selectedCapabilityFilter}
        setSelectedCapabilityFilter={setSelectedCapabilityFilter}
        capabilityOptions={MODEL_LIST_CAPABILITY_FILTERS}
        capabilityModelCounts={capabilityModelCounts}
        showDownloadButton={providerId === 'ovms'}
        onToggleVisibleModels={onToggleVisibleModels}
        onRunHealthCheck={openHealthCheck}
        onRefreshModels={actions.onRefreshModels}
        onAddModel={actions.onAddModel}
        onDownloadModel={actions.onDownloadModel}
      />
      <ManageModelsDrawer
        open={actions.manageModelsOpen}
        providerId={providerId}
        openWithInlineCustomAdd={actions.openManageWithInlineCustomAdd}
        onConsumeOpenWithInlineCustomAdd={actions.consumeOpenManageWithInlineCustomAdd}
        onClose={actions.closeManageModels}
      />
      <ModelListSyncDrawer
        open={actions.modelListSyncOpen}
        providerId={providerId}
        onClose={actions.closeModelListSync}
        onActivityChange={setModelListSyncActivity}
      />
      <HealthCheckDrawer
        open={healthCheckOpen}
        title={t('settings.models.check.title')}
        apiKeys={availableApiKeys}
        isChecking={isHealthChecking}
        modelStatuses={modelStatuses}
        onClose={closeHealthCheck}
        onStart={startHealthCheck}
      />
    </>
  )
}

export default ModelListToolbar
