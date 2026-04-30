import type React from 'react'

import { modelListClasses } from '../components/ProviderSettingsPrimitives'
import { EditModelDrawer } from './ModelDrawer'
import ModelListHeader from './ModelListHeader'
import ModelListSections from './ModelListSections'
import { useProviderModelList } from './useProviderModelList'

interface ProviderModelListProps {
  providerId: string
  disabled: boolean
  actions?: (state: { disabled: boolean; hasVisibleModels: boolean }) => React.ReactNode
}

const ProviderModelList: React.FC<ProviderModelListProps> = ({ providerId, disabled, actions }) => {
  const modelList = useProviderModelList({
    providerId,
    disabled
  })
  const toolbarDisabled = disabled || modelList.isBulkUpdating

  return (
    <>
      <div className={modelListClasses.headerBlock}>
        <ModelListHeader
          enabledModelCount={modelList.header.enabledModelCount}
          modelCount={modelList.header.modelCount}
          hasVisibleModels={modelList.header.hasVisibleModels}
          allEnabled={modelList.header.allEnabled}
          isBusy={toolbarDisabled}
          hasNoModels={modelList.header.hasNoModels}
          searchText={modelList.header.searchText}
          setSearchText={modelList.header.setSearchText}
          selectedCapabilityFilter={modelList.header.selectedCapabilityFilter}
          setSelectedCapabilityFilter={modelList.header.setSelectedCapabilityFilter}
          capabilityOptions={modelList.header.capabilityOptions}
          capabilityModelCounts={modelList.header.capabilityModelCounts}
          onToggleVisibleModels={modelList.header.onToggleVisibleModels}
          actions={actions?.({
            disabled: toolbarDisabled,
            hasVisibleModels: modelList.header.hasVisibleModels
          })}
        />
        <ModelListSections
          isLoading={modelList.sections.isLoading}
          hasNoModels={modelList.sections.hasNoModels}
          hasVisibleModels={modelList.sections.hasVisibleModels}
          displayEnabledModelCount={modelList.sections.displayEnabledModelCount}
          enabledSections={modelList.sections.enabledSections}
          disabledSections={modelList.sections.disabledSections}
          displayDisabledModelCount={modelList.sections.displayDisabledModelCount}
          disabled={modelList.sections.disabled}
          pendingModelIds={modelList.sections.pendingModelIds}
          onEditModel={modelList.sections.onEditModel}
          onToggleModel={modelList.sections.onToggleModel}
        />
      </div>
      <EditModelDrawer
        providerId={providerId}
        open={modelList.editDrawer.open}
        model={modelList.editDrawer.model}
        onClose={modelList.editDrawer.onClose}
      />
    </>
  )
}

export default ProviderModelList
