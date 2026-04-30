import React, { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import HealthCheckDrawer from './HealthCheckDrawer'
import ManageModelsDrawer from './ManageModelsDrawer'
import { AddModelDrawer, EditModelDrawer } from './ModelDrawer'
import { ModelListHealthProvider } from './modelListHealthContext'
import { useModelListHealth } from './modelListHealthContext'
import ModelListHelpLinks from './ModelListHelpLinks'
import ModelListSections from './ModelListSections'
import ModelListSyncDrawer from './ModelListSyncDrawer'
import ModelListToolbar from './ModelListToolbar'
import { useOvmsModelDownloadAction } from './useOvmsModelDownloadAction'
import { useProviderModelListBrowse } from './useProviderModelListBrowse'
import { useProviderModelMembership } from './useProviderModelMembership'
import { useProviderModelPullReconcile } from './useProviderModelPullReconcile'

/** UI tokens: `modelListClasses` + typography helpers from ProviderSettingsPrimitives; parent supplies `.provider-settings-default-scope`. */

interface ModelListProps {
  providerId: string
}

function ModelListContent({ providerId }: { providerId: string }) {
  const { t } = useTranslation()
  const [addModelDrawerOpen, setAddModelDrawerOpen] = useState(false)
  const health = useModelListHealth()
  const browse = useProviderModelListBrowse({
    providerId,
    isHealthChecking: health.isHealthChecking
  })
  const membership = useProviderModelMembership()
  const pullReconcile = useProviderModelPullReconcile(providerId)
  const { openOvmsModelDownload } = useOvmsModelDownloadAction(providerId)
  const isToolbarBusy = browse.isBulkUpdating || health.isHealthChecking || pullReconcile.isBusy
  const openAddModelDrawer = useCallback(() => {
    setAddModelDrawerOpen(true)
  }, [])
  const closeAddModelDrawer = useCallback(() => {
    setAddModelDrawerOpen(false)
  }, [])

  return (
    <>
      <div className={modelListClasses.headerBlock}>
        <ModelListToolbar
          enabledModelCount={browse.header.enabledModelCount}
          modelCount={browse.header.modelCount}
          hasVisibleModels={browse.header.hasVisibleModels}
          allEnabled={browse.header.allEnabled}
          isBusy={isToolbarBusy}
          hasNoModels={browse.header.hasNoModels}
          searchText={browse.header.searchText}
          setSearchText={browse.header.setSearchText}
          selectedCapabilityFilter={browse.header.selectedCapabilityFilter}
          setSelectedCapabilityFilter={browse.header.setSelectedCapabilityFilter}
          capabilityOptions={browse.header.capabilityOptions}
          capabilityModelCounts={browse.header.capabilityModelCounts}
          showDownloadButton={providerId === 'ovms'}
          onToggleVisibleModels={browse.header.onToggleVisibleModels}
          onRunHealthCheck={health.openHealthCheck}
          onRefreshModels={pullReconcile.openPullReconcile}
          onAddModel={openAddModelDrawer}
          onOpenManageModels={membership.openMembershipDrawer}
          onDownloadModel={openOvmsModelDownload}
        />
        <ModelListSections sections={browse.sections} />
      </div>
      <AddModelDrawer providerId={providerId} open={addModelDrawerOpen} prefill={null} onClose={closeAddModelDrawer} />
      <EditModelDrawer
        providerId={providerId}
        open={browse.editDrawer.open}
        model={browse.editDrawer.model}
        onClose={browse.editDrawer.onClose}
      />
      <ManageModelsDrawer
        open={membership.membershipOpen}
        providerId={providerId}
        onClose={membership.closeMembershipDrawer}
      />
      <ModelListSyncDrawer
        open={pullReconcile.pullReconcileDrawerOpen}
        preview={pullReconcile.preview}
        isApplying={pullReconcile.isApplyingPullReconcile}
        onApply={pullReconcile.applyPullReconcile}
        onClose={pullReconcile.closePullReconcile}
      />
      <HealthCheckDrawer
        open={health.healthCheckOpen}
        title={t('settings.models.check.title')}
        apiKeys={health.availableApiKeys}
        isChecking={health.isHealthChecking}
        modelStatuses={health.modelStatuses}
        onClose={health.closeHealthCheck}
        onResetRun={health.resetHealthCheckRun}
        onStart={health.startHealthCheck}
      />
    </>
  )
}

const ModelList: React.FC<ModelListProps> = ({ providerId }) => {
  return (
    <div className={modelListClasses.cqRoot}>
      <section data-testid="provider-model-list" className={modelListClasses.section}>
        <ModelListHealthProvider providerId={providerId}>
          <ModelListContent providerId={providerId} />
        </ModelListHealthProvider>
      </section>
      <ModelListHelpLinks providerId={providerId} />
    </div>
  )
}

export default memo(ModelList)
