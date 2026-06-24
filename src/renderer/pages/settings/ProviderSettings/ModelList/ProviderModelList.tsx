import { Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ChevronsDown, ChevronsUp, MoreHorizontal, ToggleLeft, ToggleRight } from 'lucide-react'
import type React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProviderMeta } from '../hooks/providerSetting/useProviderMeta'
import { modelListClasses } from '../primitives/ProviderSettingsPrimitives'
import { EditModelDrawer } from './ModelDrawer'
import ModelListHeader from './ModelListHeader'
import ModelListSections from './ModelListSections'
import { useProviderModelList } from './useProviderModelList'

const logger = loggerService.withContext('ProviderModelList')

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
  const providerMeta = useProviderMeta(providerId)
  const toolbarDisabled = disabled || modelList.isBulkUpdating
  const bulkCloseLabel = t('settings.models.bulk_disable')
  const bulkEnableLabel = t('settings.models.bulk_enable')
  const expandAllLabel = t('settings.models.expand_all')
  const collapseAllLabel = t('settings.models.collapse_all')
  const [openMenu, setOpenMenu] = useState<'enabled' | 'disabled' | null>(null)
  const [expansionCommand, setExpansionCommand] = useState<{ expanded: boolean; version: number }>()
  const [groupsExpanded, setGroupsExpanded] = useState(false)
  const expandToggleLabel = groupsExpanded ? collapseAllLabel : expandAllLabel

  const handleCloseVisibleModels = useCallback(() => {
    setOpenMenu(null)
    void Promise.resolve(modelList.header.onToggleVisibleModels(false)).catch((error) => {
      logger.error('Failed to disable visible provider models', { providerId, error })
      window.toast.error(t('settings.models.manage.operation_failed'))
    })
  }, [modelList.header, providerId, t])

  const handleEnableVisibleModels = useCallback(() => {
    setOpenMenu(null)
    void Promise.resolve(modelList.header.onToggleVisibleModels(true)).catch((error) => {
      logger.error('Failed to enable visible provider models', { providerId, error })
      window.toast.error(t('settings.models.manage.operation_failed'))
    })
  }, [modelList.header, providerId, t])

  const handleExpandAll = useCallback(() => {
    setOpenMenu(null)
    setGroupsExpanded(true)
    setExpansionCommand((prev) => ({ expanded: true, version: (prev?.version ?? 0) + 1 }))
  }, [])

  const handleCollapseAll = useCallback(() => {
    setOpenMenu(null)
    setGroupsExpanded(false)
    setExpansionCommand((prev) => ({ expanded: false, version: (prev?.version ?? 0) + 1 }))
  }, [])

  const enabledListActionMenu = useMemo(
    () => (
      <Popover open={openMenu === 'enabled'} onOpenChange={(open) => setOpenMenu(open ? 'enabled' : null)}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.models.more_actions')}
            className={modelListClasses.listActionTriggerButton}
            disabled={!modelList.header.hasVisibleModels || toolbarDisabled}>
            <MoreHorizontal className={modelListClasses.listActionTriggerIcon} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className={modelListClasses.listActionMenu}>
          <MenuList className="gap-1">
            <MenuItem
              label={bulkCloseLabel}
              className={modelListClasses.listActionMenuItem}
              icon={<ToggleLeft className={modelListClasses.listActionMenuIcon} />}
              disabled={!modelList.header.hasVisibleModels || toolbarDisabled}
              onClick={handleCloseVisibleModels}
            />
            <MenuItem
              label={expandToggleLabel}
              className={modelListClasses.listActionMenuItem}
              icon={
                groupsExpanded ? (
                  <ChevronsUp className={modelListClasses.listActionMenuIcon} />
                ) : (
                  <ChevronsDown className={modelListClasses.listActionMenuIcon} />
                )
              }
              disabled={!modelList.header.hasVisibleModels || toolbarDisabled}
              onClick={groupsExpanded ? handleCollapseAll : handleExpandAll}
            />
          </MenuList>
        </PopoverContent>
      </Popover>
    ),
    [
      bulkCloseLabel,
      expandToggleLabel,
      groupsExpanded,
      handleCloseVisibleModels,
      handleCollapseAll,
      handleExpandAll,
      modelList.header.hasVisibleModels,
      t,
      toolbarDisabled,
      openMenu
    ]
  )

  const disabledListActionMenu = useMemo(
    () => (
      <Popover open={openMenu === 'disabled'} onOpenChange={(open) => setOpenMenu(open ? 'disabled' : null)}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('settings.models.more_actions')}
            className={modelListClasses.listActionTriggerButton}
            disabled={!modelList.header.hasVisibleModels || toolbarDisabled}>
            <MoreHorizontal className={modelListClasses.listActionTriggerIcon} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className={modelListClasses.listActionMenu}>
          <MenuList className="gap-1">
            <MenuItem
              label={bulkEnableLabel}
              className={modelListClasses.listActionMenuItem}
              icon={<ToggleRight className={modelListClasses.listActionMenuIcon} />}
              disabled={!modelList.header.hasVisibleModels || modelList.header.allEnabled || toolbarDisabled}
              onClick={handleEnableVisibleModels}
            />
            <MenuItem
              label={expandToggleLabel}
              className={modelListClasses.listActionMenuItem}
              icon={
                groupsExpanded ? (
                  <ChevronsUp className={modelListClasses.listActionMenuIcon} />
                ) : (
                  <ChevronsDown className={modelListClasses.listActionMenuIcon} />
                )
              }
              disabled={!modelList.header.hasVisibleModels || toolbarDisabled}
              onClick={groupsExpanded ? handleCollapseAll : handleExpandAll}
            />
          </MenuList>
        </PopoverContent>
      </Popover>
    ),
    [
      bulkEnableLabel,
      expandToggleLabel,
      groupsExpanded,
      handleCollapseAll,
      handleEnableVisibleModels,
      handleExpandAll,
      modelList.header.allEnabled,
      modelList.header.hasVisibleModels,
      t,
      toolbarDisabled,
      openMenu
    ]
  )

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
          displayEnabledModelCount={modelList.sections.displayEnabledModelCount}
          enabledSections={modelList.sections.enabledSections}
          disabledSections={modelList.sections.disabledSections}
          displayDisabledModelCount={modelList.sections.displayDisabledModelCount}
          disabled={modelList.sections.disabled}
          pendingModelIds={modelList.sections.pendingModelIds}
          onEditModel={modelList.sections.onEditModel}
          onDeleteModel={modelList.sections.onDeleteModel}
          onDeleteModels={modelList.sections.onDeleteModels}
          onToggleModel={modelList.sections.onToggleModel}
          onToggleModels={modelList.sections.onToggleModels}
          bulkActionDisabled={toolbarDisabled}
          expansionCommand={expansionCommand}
          enabledSectionActions={
            <>
              {enabledListActionMenu}
              {enabledSectionActions?.({
                disabled: toolbarDisabled,
                hasVisibleModels: modelList.header.hasVisibleModels
              })}
            </>
          }
          disabledSectionActions={disabledListActionMenu}
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
