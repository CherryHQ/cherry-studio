import type React from 'react'
import { useCallback, useEffect, useState } from 'react'

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
  const [groupExpansionCommand, setGroupExpansionCommand] = useState({ expanded: true, version: 0 })
  const modelList = useProviderModelList({
    providerId,
    disabled
  })
  const providerMeta = useProviderMeta(providerId)
  const toolbarDisabled = disabled
  const toggleGroupsExpanded = useCallback(() => {
    setGroupExpansionCommand((current) => ({
      expanded: !current.expanded,
      version: current.version + 1
    }))
  }, [])

  useEffect(() => {
    if (!modelList.header.searchText.trim()) {
      return
    }

    setGroupExpansionCommand((current) => {
      if (current.expanded) {
        return current
      }

      return {
        expanded: true,
        version: current.version + 1
      }
    })
  }, [modelList.header.searchText])

  return (
    <>
      <div className={modelListClasses.headerBlock}>
        <ModelListHeader
          isBusy={toolbarDisabled}
          hasNoModels={modelList.header.hasNoModels}
          searchText={modelList.header.searchText}
          setSearchText={modelList.header.setSearchText}
          groupsExpanded={groupExpansionCommand.expanded}
          onToggleGroupsExpanded={toggleGroupsExpanded}
          docsWebsite={providerMeta.docsWebsite}
          modelsWebsite={providerMeta.modelsWebsite}
          actions={actions?.({
            disabled: toolbarDisabled,
            hasVisibleModels: modelList.header.hasVisibleModels
          })}
        />
        <ModelListSections
          provider={providerMeta.provider}
          isLoading={modelList.sections.isLoading}
          hasNoModels={modelList.sections.hasNoModels}
          hasVisibleModels={modelList.sections.hasVisibleModels}
          enabledSections={modelList.sections.enabledSections}
          disabled={modelList.sections.disabled}
          pendingModelIds={modelList.sections.pendingModelIds}
          defaultModelIds={modelList.sections.defaultModelIds}
          onEditModel={modelList.sections.onEditModel}
          onDeleteModel={modelList.sections.onDeleteModel}
          onDeleteModels={modelList.sections.onDeleteModels}
          bulkActionDisabled={toolbarDisabled}
          expansionCommand={groupExpansionCommand}
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
