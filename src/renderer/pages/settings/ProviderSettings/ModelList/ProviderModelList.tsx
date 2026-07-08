import type React from 'react'

import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
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
  const providerMeta = useProviderMeta(providerId)
  const toolbarDisabled = disabled || modelList.isBulkUpdating

  return (
    <>
      <div className={modelListClasses.headerBlock}>
        <ModelListHeader
          isBusy={toolbarDisabled}
          hasNoModels={modelList.header.hasNoModels}
          searchText={modelList.header.searchText}
          setSearchText={modelList.header.setSearchText}
          docsWebsite={providerMeta.docsWebsite}
          modelsWebsite={providerMeta.modelsWebsite}
          actions={actions?.({
            disabled: toolbarDisabled,
            hasVisibleModels: modelList.header.hasVisibleModels
          })}
        />
        <ModelListSections
          isLoading={modelList.sections.isLoading}
          hasNoModels={modelList.sections.hasNoModels}
          hasVisibleModels={modelList.sections.hasVisibleModels}
          enabledSections={modelList.sections.enabledSections}
          disabledSections={modelList.sections.disabledSections}
          disabled={modelList.sections.disabled}
          pendingModelIds={modelList.sections.pendingModelIds}
          onEditModel={modelList.sections.onEditModel}
          onDeleteModel={modelList.sections.onDeleteModel}
          onDeleteModels={modelList.sections.onDeleteModels}
          onToggleModel={modelList.sections.onToggleModel}
          onToggleModels={modelList.sections.onToggleModels}
          bulkActionDisabled={toolbarDisabled}
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
