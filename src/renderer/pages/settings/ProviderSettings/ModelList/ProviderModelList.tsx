import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useReorder } from '@renderer/data/hooks/useReorder'
import { toast } from '@renderer/services/toast'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { UniqueModelId } from '@shared/data/types/model'

import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { EditModelDrawer } from './ModelDrawer'
import ModelListHeader from './ModelListHeader'
import ModelListSections from './ModelListSections'
import { reorderModelGroups } from './reorderModelGroups'
import { useProviderModelList } from './useProviderModelList'

interface ProviderModelListProps {
  scrollElement?: HTMLDivElement | null
  providerId: string
  disabled: boolean
  onContinueApiSetup?: () => void
  actions?: (state: { disabled: boolean; hasVisibleModels: boolean }) => React.ReactNode
}

const ProviderModelList: React.FC<ProviderModelListProps> = ({
  scrollElement,
  providerId,
  disabled,
  onContinueApiSetup,
  actions
}) => {
  const { t } = useTranslation()
  const [groupExpansionCommand, setGroupExpansionCommand] = useState({ expanded: true, version: 0 })
  const modelList = useProviderModelList({
    providerId,
    disabled
  })
  const providerMeta = useProviderMeta(providerId)
  const showContinueApiSetup =
    providerMeta.isApiKeyFieldVisible &&
    providerMeta.provider?.authOptional !== true &&
    providerMeta.provider?.apiKeys.some((entry) => entry.isEnabled) === true
  const toolbarDisabled = disabled
  // `GET /models` is cached per provider, and a `UniqueModelId` can contain
  // `/`, so the reorder hook needs both the query and the greedy id param.
  const {
    move: moveModel,
    applyReorderedList: applyModelOrder,
    isPending: isReorderingModels
  } = useReorder('/models', {
    query: providerId ? { providerId } : undefined,
    itemIdParam: 'uniqueModelId*'
  })

  const handleReorderModel = useCallback(
    (uniqueModelId: UniqueModelId, anchor: OrderRequest) => {
      if (disabled) return
      void moveModel(uniqueModelId, anchor).catch(() => {
        // `move` already rolls the optimistic overlay back and revalidates, so
        // the only thing left to do is tell the user why the row snapped back.
        toast.error(t('settings.models.reorder_failed'))
      })
    },
    [disabled, moveModel, t]
  )

  const handleReorderGroups = useCallback(
    (activeGroupName: string, overGroupName: string) => {
      if (disabled) return
      const next = reorderModelGroups({
        models: modelList.sections.orderedModels,
        activeGroupName,
        overGroupName
      })
      if (next === modelList.sections.orderedModels) return

      void applyModelOrder(next as unknown as Array<Record<string, unknown>>).catch(() => {
        toast.error(t('settings.models.reorder_failed'))
      })
    },
    [applyModelOrder, disabled, modelList.sections.orderedModels, t]
  )

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
          hasNoModels={modelList.header.hasNoModels}
          searchText={modelList.header.searchText}
          setSearchText={modelList.header.setSearchText}
          selectedTypeFilter={modelList.header.selectedTypeFilter}
          setSelectedTypeFilter={modelList.header.setSelectedTypeFilter}
          typeCounts={modelList.header.typeCounts}
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
          scrollElement={scrollElement}
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
          onContinueApiSetup={showContinueApiSetup ? onContinueApiSetup : undefined}
          onReorderModel={disabled || isReorderingModels ? undefined : handleReorderModel}
          orderedModels={modelList.sections.orderedModels}
          onReorderGroups={disabled || isReorderingModels ? undefined : handleReorderGroups}
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
