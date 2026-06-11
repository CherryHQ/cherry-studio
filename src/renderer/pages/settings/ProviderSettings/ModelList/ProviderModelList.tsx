import { Button, Tooltip } from '@cherrystudio/ui'
import { ToggleLeft, ToggleRight } from 'lucide-react'
import type React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { EditModelDrawer } from './ModelDrawer'
import ModelListHeader from './ModelListHeader'
import ModelListSections from './ModelListSections'
import { useProviderModelList } from './useProviderModelList'

interface ProviderModelListProps {
  providerId: string
  disabled: boolean
  actions?: (state: { disabled: boolean; hasVisibleModels: boolean }) => React.ReactNode
  enabledSectionActions?: (state: { disabled: boolean; hasVisibleModels: boolean }) => React.ReactNode
}

const ProviderModelList: React.FC<ProviderModelListProps> = ({
  providerId,
  disabled,
  actions,
  enabledSectionActions
}) => {
  const { t } = useTranslation()
  const modelList = useProviderModelList({
    providerId,
    disabled
  })
  const toolbarDisabled = disabled || modelList.isBulkUpdating
  const bulkCloseLabel = t('settings.models.bulk_disable')
  const bulkEnableLabel = t('settings.models.bulk_enable')

  const handleCloseVisibleModels = useCallback(() => {
    void Promise.resolve(modelList.header.onToggleVisibleModels(false)).catch(() => {
      window.toast.error(t('settings.models.manage.operation_failed'))
    })
  }, [modelList.header, t])

  const handleEnableVisibleModels = useCallback(() => {
    void Promise.resolve(modelList.header.onToggleVisibleModels(true)).catch(() => {
      window.toast.error(t('settings.models.manage.operation_failed'))
    })
  }, [modelList.header, t])

  return (
    <>
      <div className={modelListClasses.headerBlock}>
        <ModelListHeader
          isBusy={toolbarDisabled}
          hasNoModels={modelList.header.hasNoModels}
          searchText={modelList.header.searchText}
          setSearchText={modelList.header.setSearchText}
          selectedCapabilityFilter={modelList.header.selectedCapabilityFilter}
          setSelectedCapabilityFilter={modelList.header.setSelectedCapabilityFilter}
          capabilityOptions={modelList.header.capabilityOptions}
          capabilityModelCounts={modelList.header.capabilityModelCounts}
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
          onToggleModels={modelList.sections.onToggleModels}
          bulkActionDisabled={toolbarDisabled}
          enabledSectionActions={
            <>
              <Tooltip content={bulkCloseLabel}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={bulkCloseLabel}
                  className={modelListClasses.subsectionIconButton}
                  disabled={!modelList.header.hasVisibleModels || toolbarDisabled}
                  onClick={handleCloseVisibleModels}>
                  <ToggleLeft className={modelListClasses.subsectionIcon} />
                </Button>
              </Tooltip>
              {enabledSectionActions?.({
                disabled: toolbarDisabled,
                hasVisibleModels: modelList.header.hasVisibleModels
              })}
            </>
          }
          disabledSectionActions={
            <Tooltip content={bulkEnableLabel}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={bulkEnableLabel}
                className={modelListClasses.subsectionIconButton}
                disabled={!modelList.header.hasVisibleModels || modelList.header.allEnabled || toolbarDisabled}
                onClick={handleEnableVisibleModels}>
                <ToggleRight className={modelListClasses.subsectionIcon} />
              </Button>
            </Tooltip>
          }
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
